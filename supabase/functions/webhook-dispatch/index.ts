// webhook 발송 워커
//
// cron 이 주기적으로 호출한다. 한 번 호출될 때마다 발송 대기 중인 행을 집어
// 보내고 결과를 원장에 기록한다.
//
// R6 — fire-and-forget 금지. 이 함수 자체가 백스톱이다.
//   · 발송 실패는 next_retry_at 으로 큐에 남는다. 유실되지 않는다
//   · 워커가 중간에 죽어도 claim 시 걸어둔 리스가 만료되면 다시 대상이 된다
//   · 따라서 이 함수를 몇 번을 호출하든, 호출이 실패하든, 결과는 수렴한다
//
// ⚠️ 이 함수는 테넌트 API가 아니다. 워커 토큰으로 보호한다.
//    service_role 로 도는 EF이므로 R4에 따라 진입 즉시 caller를 검증한다.

import { serviceClient } from "../_shared/auth.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 수신 측이 5초 안에 응답하지 못하면 실패로 본다. */
const DELIVERY_TIMEOUT_MS = 5_000;

/** 한 배치에서 집어올 최대 건수. */
const BATCH_SIZE = 20;

/**
 * 한 번 호출에서 돌릴 최대 배치 수.
 *
 * 순서 보장 때문에 한 배치는 발주당 1건만 집어온다 — 낮은 sequence가 미완료면
 * 뒤가 막히기 때문이다. 그래서 배치 한 번으로 끝내면 4건짜리 버스트에 cron 4틱이
 * 걸린다. 큐가 빌 때까지 돌려 한 호출로 소진시킨다.
 *
 * 상한을 두는 이유는 EF 실행 시간 제한 때문이다. 다 못 비워도 다음 cron 이
 * 이어받으므로 유실되지 않는다.
 */
const MAX_BATCHES = 25;

/** 전체 실행 시간 예산. 초과하면 남은 건 다음 호출로 넘긴다. */
const RUN_BUDGET_MS = 50_000;

interface Claimed {
  id: string;
  tenant_id: string;
  event: string;
  sequence: number;
  payload: Record<string, unknown>;
  attempt: number;
  webhook_url: string;
  webhook_secret: string | null;
}

/**
 * HMAC-SHA256(secret, "{timestamp}.{raw_body}") 를 hex 로.
 *
 * timestamp 를 서명에 포함해야 재전송 공격을 막을 수 있다. body만 서명하면
 * 공격자가 과거 요청을 그대로 재생할 수 있다.
 */
async function sign(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface Outcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

async function deliver(row: Claimed): Promise<Outcome> {
  if (!row.webhook_secret) {
    // 서명할 수 없으면 보내지 않는다. 수신 측이 검증할 수 없는 요청을 만드느니
    // 실패로 남겨 사람이 보게 한다.
    return { ok: false, statusCode: 400, error: "tenants.webhook_secret 미설정" };
  }

  // delivered_at 은 이 요청의 발송 시각이다. 재시도마다 갱신된다.
  const body = JSON.stringify({
    ...row.payload,
    delivered_at: new Date().toISOString(),
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await sign(row.webhook_secret, timestamp, body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const res = await fetch(row.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cleancall-Signature": signature,
        "X-Cleancall-Timestamp": timestamp,
        "X-Cleancall-Delivery": row.id,
      },
      body,
      signal: ctrl.signal,
    });
    // 2xx 만 성공이다. 3xx 는 리다이렉트를 따라간 뒤의 최종 상태가 온다.
    return {
      ok: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      error: res.status >= 200 && res.status < 300 ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return {
      ok: false,
      // 타임아웃·네트워크 오류는 상태 코드가 없다. null 이면 5xx 와 같은 취급
      // (백오프 후 재시도)을 받는다.
      statusCode: null,
      error: aborted
        ? `타임아웃 ${DELIVERY_TIMEOUT_MS}ms`
        : `네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runBatch(db: SupabaseClient): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("claim_webhook_deliveries", {
    p_limit: BATCH_SIZE,
  });
  if (error) {
    console.error(`claim 실패: ${JSON.stringify(error)}`);
    return { claimed: 0, error: "claim_failed" };
  }

  const rows = (data ?? []) as Claimed[];
  const summary = { claimed: rows.length, delivered: 0, failed: 0, dead: 0 };

  // 같은 order_id 는 sequence 순서를 지켜야 하므로 병렬로 보내지 않는다.
  // claim 이 sequence 순으로 정렬해 돌려주고, 여기서 순차로 소비한다.
  for (const row of rows) {
    const outcome = await deliver(row);

    const { data: status } = await db.rpc("complete_webhook_delivery", {
      p_id: row.id,
      p_ok: outcome.ok,
      p_status_code: outcome.statusCode,
      p_error: outcome.error,
    });

    if (status === "delivered") summary.delivered++;
    else if (status === "dead") {
      summary.dead++;
      // 운영자 알림은 아직 없다. 로그로만 남긴다.
      console.error(
        `webhook dead: delivery=${row.id} tenant=${row.tenant_id} ` +
          `event=${row.event} seq=${row.sequence} attempt=${row.attempt} ` +
          `code=${outcome.statusCode} error=${outcome.error}`,
      );
    } else summary.failed++;
  }

  return summary;
}

Deno.serve(async (req) => {
  // R4 — service_role 로 도는 함수다. 진입 즉시 caller를 검증한다.
  // 테넌트 API 키가 아니라 워커 전용 토큰이다. 외부에 노출되면 안 된다.
  const expected = Deno.env.get("WEBHOOK_WORKER_TOKEN");
  if (!expected) {
    console.error("WEBHOOK_WORKER_TOKEN 미설정 — 워커를 실행하지 않는다");
    return new Response(JSON.stringify({ error: "worker_not_configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.headers.get("X-Worker-Token") !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = serviceClient();
  const started = Date.now();
  const total = { batches: 0, claimed: 0, delivered: 0, failed: 0, dead: 0 };

  // 큐가 빌 때까지, 또는 예산이 다할 때까지 반복한다.
  // 매 배치마다 순서 조건을 다시 평가하므로 순서 보장은 유지된다.
  for (let i = 0; i < MAX_BATCHES; i++) {
    if (Date.now() - started > RUN_BUDGET_MS) break;

    const s = await runBatch(db) as {
      claimed: number;
      delivered?: number;
      failed?: number;
      dead?: number;
    };
    total.batches++;
    total.claimed += s.claimed;
    total.delivered += s.delivered ?? 0;
    total.failed += s.failed ?? 0;
    total.dead += s.dead ?? 0;

    // 더 집을 게 없으면 끝이다. 실패만 남은 경우도 여기서 멈춘다 —
    // 실패한 건은 next_retry_at 이 미래라 다음 배치에서 집히지 않는다.
    if (s.claimed === 0) break;
  }

  // 하트비트. pg_net 은 fire-and-forget 이라 cron 쪽에서는 호출 실패가 묻힌다.
  // 워커가 실제로 돌았다는 증거는 여기밖에 없다. check_webhook_pipeline() 이 읽는다.
  const { error: hbErr } = await db.rpc("record_webhook_worker_run", {
    p_summary: total,
  });
  if (hbErr) console.error(`하트비트 기록 실패: ${JSON.stringify(hbErr)}`);

  return new Response(JSON.stringify(total), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
