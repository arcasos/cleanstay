// POST /v1/sandbox/orders/{order_id}/transition — 발주 상태 강제 전이 (테스트 전용)
//
// OpenAPI v0.3.1 `/sandbox/orders/{order_id}/transition` 참조.
//
// 실제 공급자 없이 상태를 진행시켜 연동을 검증한다.
// ⚠️ 이건 배차가 아니다. 공급자를 고르지 않고, 존재하지도 않는 전이를 흉내 낼 뿐이다.
//    원칙 D와 무관하다 — 여기서 accepted로 보내도 provider_id는 비어 있다.

import {
  authenticateTenant,
  serviceClient,
  type TenantContext,
} from "../_shared/auth.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const ORDER_STATUSES = [
  "created",
  "billing_verified",
  "broadcasting",
  "accepted",
  "in_progress",
  "completed",
  "confirmed",
  "charged",
  "paid_out",
  "escalated",
  "reassigning",
  "backup_dispatch",
  "cancelled",
  "failed",
] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

const FAULT_PARTIES = [
  "tenant",
  "provider",
  "host",
  "guest",
  "platform",
  "none",
] as const;

/** 상태별로 함께 찍히는 시각 컬럼. */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  billing_verified: "billing_verified_at",
  broadcasting: "broadcast_at",
  accepted: "accepted_at",
  in_progress: "started_at",
  completed: "completed_at",
  confirmed: "confirmed_at",
  charged: "charged_at",
  paid_out: "paid_out_at",
  cancelled: "cancelled_at",
};

const AUTO_CONFIRM_MIN_MS = 6 * 60 * 60 * 1000;

interface TransitionBody {
  to_status?: unknown;
  fault?: unknown;
  failure_code?: unknown;
  failure_reason?: unknown;
  reason?: unknown;
  scheduled_at?: unknown;
  completed_at?: unknown;
}

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

function parseTs(v: unknown): Date | null {
  if (!isStr(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface OrderRow {
  id: string;
  tenant_ref: string;
  property_id: string;
  host_id: string;
  status: OrderStatus;
  trigger_type: string;
  priority: string;
  checkin_at: string;
  checkout_at: string;
  next_checkin_at: string | null;
  deadline_at: string | null;
  scheduled_at: string | null;
  arrival_at: string | null;
  completed_at: string | null;
  auto_confirm_at: string | null;
  base_amount: number;
  urgent_premium: number;
  charge_amount: number;
  charged_at: string | null;
  fault: string;
  failure_code: string | null;
  failure_reason: string | null;
  cancel_reason: string | null;
  free_change_until: string | null;
  sequence: number;
  updated_at: string;
}

const ORDER_COLS =
  "id, tenant_ref, property_id, host_id, status, trigger_type, priority, " +
  "checkin_at, checkout_at, next_checkin_at, deadline_at, scheduled_at, arrival_at, " +
  "completed_at, auto_confirm_at, base_amount, urgent_premium, charge_amount, " +
  "charged_at, fault, failure_code, failure_reason, cancel_reason, " +
  "free_change_until, sequence, updated_at";

// ---------------------------------------------------------------------------

function validate(body: TransitionBody): string[] {
  const d: string[] = [];

  if (!isStr(body.to_status)) {
    d.push("to_status는 필수입니다.");
  } else if (!ORDER_STATUSES.includes(body.to_status as OrderStatus)) {
    d.push(`to_status는 ${ORDER_STATUSES.join(" | ")} 중 하나여야 합니다.`);
  }
  if (body.fault != null && !FAULT_PARTIES.includes(body.fault as never)) {
    d.push(`fault는 ${FAULT_PARTIES.join(" | ")} 중 하나여야 합니다.`);
  }
  // 과거 시각도 허용된다 — 24시간 경계를 넘나드는 케이스를 만들기 위한 것이다.
  if (body.scheduled_at != null && !parseTs(body.scheduled_at)) {
    d.push("scheduled_at은 ISO8601 시각이어야 합니다.");
  }
  if (body.completed_at != null && !parseTs(body.completed_at)) {
    d.push("completed_at은 ISO8601 시각이어야 합니다.");
  }
  return d;
}

/**
 * 무보상 변경·취소 시한.
 *
 * 규칙(리드타임 24h, 불리한 소급 금지)은 DB의 `compute_free_change_until()` 하나에
 * 있다. §13 #13 이 제안값이라 바뀔 수 있으므로 상수를 EF에 흩뿌리지 않는다.
 */
async function nextFreeChangeUntil(
  db: SupabaseClient,
  current: string | null,
  scheduledAt: Date,
): Promise<string | null> {
  const { data, error } = await db.rpc("compute_free_change_until", {
    p_current: current,
    p_scheduled_at: scheduledAt.toISOString(),
  });
  if (error) {
    console.error(`free_change_until 계산 실패: ${JSON.stringify(error)}`);
    return current;
  }
  return data as string | null;
}

/**
 * 자동 확정 시각 = max( completed_at + 6h, deadline_at )
 *
 * deadline_at 이전에는 확정되지 않는다. 불량이 발견될 수 있는 최초 시점 전에
 * 확정하면 검증 기회가 사라진다. 하한 6시간은 호스트가 완료 알림을 받고
 * 확인할 최소 시간이다.
 */
function autoConfirmAt(completedAt: Date, deadlineAt: string | null): string {
  const lower = completedAt.getTime() + AUTO_CONFIRM_MIN_MS;
  const deadline = deadlineAt ? new Date(deadlineAt).getTime() : 0;
  return new Date(Math.max(lower, deadline)).toISOString();
}

// ---------------------------------------------------------------------------

async function transition(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
): Promise<Response> {
  let body: TransitionBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "validation_failed", {
      details: ["요청 본문이 올바른 JSON이 아닙니다."],
    });
  }

  const details = validate(body);
  if (details.length > 0) {
    return errorResponse(req, "validation_failed", { details });
  }

  // tenant_id·env로 함께 걸러 타 테넌트·타 env 발주는 404가 되게 한다.
  const { data: found } = await db.from("orders").select(ORDER_COLS)
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenantId)
    .eq("env", ctx.env)
    .maybeSingle();
  if (!found) return errorResponse(req, "order_not_found");

  const order = found as unknown as OrderRow;
  const toStatus = body.to_status as OrderStatus;
  const now = new Date();

  // --- 변경분 조립 --------------------------------------------------------
  // 상태 검증은 하지 않는다. 이건 강제 전이 API다.
  const patch: Record<string, unknown> = { status: toStatus };

  const tsCol = STATUS_TIMESTAMP[toStatus];
  if (tsCol) patch[tsCol] = now.toISOString();

  if (isStr(body.fault)) patch.fault = body.fault;
  if (isStr(body.failure_code)) patch.failure_code = body.failure_code;
  if (isStr(body.failure_reason)) patch.failure_reason = body.failure_reason;

  // scheduled_at 오버라이드. 이 값이 바뀌면 sequence 트리거도 함께 올라간다.
  const scheduledOverride = parseTs(body.scheduled_at);
  const effectiveScheduled = scheduledOverride ??
    (toStatus === "accepted" && !order.scheduled_at ? now : null);
  if (effectiveScheduled) {
    patch.scheduled_at = effectiveScheduled.toISOString();
    patch.free_change_until = await nextFreeChangeUntil(
      db,
      order.free_change_until,
      effectiveScheduled,
    );
  }

  // completed_at 오버라이드 — 자동 확정 시한 검증용.
  const completedOverride = parseTs(body.completed_at);
  const effectiveCompleted = completedOverride ??
    (toStatus === "completed" ? now : null);
  if (effectiveCompleted) {
    patch.completed_at = effectiveCompleted.toISOString();
    patch.auto_confirm_at = autoConfirmAt(effectiveCompleted, order.deadline_at);
  }

  if (toStatus === "in_progress" && !order.arrival_at) {
    patch.arrival_at = now.toISOString();
  }

  const { data: updated, error } = await db.from("orders").update(patch)
    .eq("id", order.id).select(ORDER_COLS).single();

  if (error) {
    console.error(`sandbox 전이 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }
  const next = updated as unknown as OrderRow;

  // --- 원장 ---------------------------------------------------------------
  // append-only. 정상 경로와 동일하게 한 전이당 한 행을 쌓는다.
  //
  // actor는 'system'이다. 테넌트가 호출하지만 이 전이가 흉내 내는 것은
  // 공급자·시스템의 행위이고, metadata.sandbox 로 시뮬레이션임을 남긴다.
  // 원장만 보고도 실제 전이와 구분할 수 있어야 한다.
  const { error: evErr } = await db.from("order_events").insert({
    order_id: order.id,
    from_status: order.status,
    to_status: toStatus,
    actor: "system",
    reason: isStr(body.reason) ? body.reason : "sandbox_forced_transition",
    fault: isStr(body.fault) ? body.fault : null,
    metadata: {
      sandbox: true,
      scheduled_at_override: scheduledOverride?.toISOString() ?? null,
      completed_at_override: completedOverride?.toISOString() ?? null,
    },
  });
  if (evErr) console.error(`원장 기록 실패: ${JSON.stringify(evErr)}`);

  // --- 응답 ---------------------------------------------------------------
  const { data: events } = await db.from("order_events")
    .select("sequence, to_status, actor, reason, at")
    .eq("order_id", order.id).order("id", { ascending: true });

  return jsonResponse(req, 200, {
    order_id: next.id,
    tenant_ref: next.tenant_ref,
    property_id: next.property_id,
    status: next.status,
    trigger_type: next.trigger_type,
    priority: next.priority,
    checkin_at: next.checkin_at,
    checkout_at: next.checkout_at,
    next_checkin_at: next.next_checkin_at,
    deadline_at: next.deadline_at,
    scheduled_at: next.scheduled_at,
    arrival_at: next.arrival_at,
    auto_confirm_at: next.auto_confirm_at,
    charge_amount: next.charge_amount,
    charged_at: next.charged_at,
    fault: next.fault,
    free_change_until: next.free_change_until,
    // orders EF 와 같은 파생 규칙. 값은 그대로 두고 상태만 따로 준다 —
    // null 이 "배차 전 = 언제든 무보상"을 뜻하므로 시한 경과에 null 을 쓸 수 없다.
    free_change_status: next.free_change_until === null
      ? "unlimited"
      : (Date.now() <= new Date(next.free_change_until).getTime()
        ? "until"
        : "expired"),
    // 공급자는 배차되지 않았다. sandbox 전이는 공급자를 만들지 않는다.
    provider: null,
    amounts: {
      base_amount: next.base_amount,
      urgent_premium: next.urgent_premium,
      charge_amount: next.charge_amount,
    },
    completion: next.completed_at
      ? { photos: [], checklist: {}, completed_at: next.completed_at }
      : null,
    failure_code: next.failure_code,
    failure_reason: next.failure_reason,
    cancel_reason: next.cancel_reason,
    sequence: next.sequence,
    updated_at: next.updated_at,
    events: events ?? [],
  });
}

// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  // R4 — service_role은 RLS를 우회한다. 진입 즉시 caller를 검증한다.
  const db = serviceClient();
  const ctx = await authenticateTenant(req, db);
  if (!ctx) return errorResponse(req, "unauthorized");

  // sandbox 는 테스트 키 전용이다. 운영 키로는 상태를 조작할 수 없다.
  if (ctx.env !== "test") {
    return errorResponse(req, "sandbox_requires_test_key");
  }

  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/v1/, "")
    .replace(/\/+$/, "");

  const m = path.match(/^\/sandbox\/orders\/([^/]+)\/transition$/);
  if (req.method === "POST" && m) {
    if (!UUID_PATTERN.test(m[1])) return errorResponse(req, "order_not_found");
    return await transition(req, db, ctx, m[1]);
  }

  return errorResponse(req, "order_not_found", {
    details: [`${req.method} ${path} 은(는) 정의되지 않은 경로입니다.`],
  });
});
