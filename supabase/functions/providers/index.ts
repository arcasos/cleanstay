// 공급자 온보딩 — /v1/providers/*
//
// OpenAPI v0.3.1 공급측 표면 참조. 시드 §14 A(온보딩) / B(활동지역) / C(정지).
//
// ## 1차 범위 — 셀프 가입은 아직 열지 않는다
//
// 익명 POST 를 열면 스팸이 들어온다. 초기 공급자는 직영팀 한 곳뿐이라 운영자가
// 대신 등록하면 된다. 공급자 앱(§13 #6)이 생기면 provider 분기가 실제로 쓰이기
// 시작하지만, resolveCaller 가 이미 그 경로를 판별하므로 코드 변경 없이 열린다.
//
// ## 인증
//
// 운영자 = Supabase Auth JWT (app_metadata.role='operator').
// actor 에 operator:<uuid> 를 박아 "누가 승인했는가"를 원장에 남긴다(§14 C).

import { serviceClient } from "../_shared/auth.ts";
import { type Caller, callerAllowed, resolveCaller } from "../_shared/caller.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";
import {
  isValidBusinessNo,
  verificationWarning,
  verifyBusiness,
  verifyIdentity,
} from "../_shared/verify.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const PROVIDER_TYPES = ["business", "individual"];
const SERVICE_LEVELS: Record<number, string> = { 2: "city", 5: "gu", 10: "dong" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

interface ProviderRow {
  id: string;
  type: string;
  status: string;
  display_name: string;
  phone: string;
  business_no: string | null;
  rep_name: string | null;
  biz_verify_status: string | null;
  biz_verify_source: string | null;
  identity_verify_source: string | null;
  auth_user_id: string | null;
}

const PROVIDER_COLS =
  "id, type, status, display_name, phone, business_no, rep_name, " +
  "biz_verify_status, biz_verify_source, identity_verify_source, auth_user_id";

function toProvider(p: ProviderRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider_id: p.id,
    type: p.type,
    status: p.status,
    display_name: p.display_name,
    biz_verify_status: p.biz_verify_status,
    verify_source: {
      business: p.biz_verify_source,
      identity: p.identity_verify_source,
    },
  };
  // 스텁 검증이면 경고를 함께 실어 운영자 화면이 "verified" 글자만 보고
  // 승인하지 않게 한다.
  const w = verificationWarning(p.biz_verify_source ?? p.identity_verify_source);
  if (w) out.warnings = [w];
  return out;
}

async function loadProvider(
  db: SupabaseClient,
  id: string,
): Promise<ProviderRow | null> {
  const { data } = await db.from("providers").select(PROVIDER_COLS)
    .eq("id", id).maybeSingle();
  return data ? (data as unknown as ProviderRow) : null;
}

/** append-only 공급자 원장. actor 로 누가 했는지 남긴다. */
async function appendEvent(
  db: SupabaseClient,
  providerId: string,
  event: string,
  actor: string,
  opts: { reason?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const { error } = await db.from("provider_events").insert({
    provider_id: providerId,
    event,
    actor,
    reason: opts.reason ?? null,
    metadata: opts.metadata ?? {},
  });
  if (error) console.error(`공급자 원장 기록 실패: ${JSON.stringify(error)}`);
}

// ---------------------------------------------------------------------------
// POST /v1/providers — 가입 (운영자 대행)
// ---------------------------------------------------------------------------

interface CreateBody {
  type?: unknown;
  display_name?: unknown;
  phone?: unknown;
  email?: unknown;
  business_no?: unknown;
  rep_name?: unknown;
  open_date?: unknown;
}

async function createProvider(
  req: Request,
  db: SupabaseClient,
  caller: Caller,
): Promise<Response> {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "validation_failed", {
      details: ["요청 본문이 올바른 JSON이 아닙니다."],
    });
  }

  const d: string[] = [];
  if (!isStr(body.type) || !PROVIDER_TYPES.includes(body.type)) {
    d.push(`type은 ${PROVIDER_TYPES.join(" | ")} 중 하나여야 합니다.`);
  }
  if (!isStr(body.display_name)) d.push("display_name은 필수입니다.");
  if (!isStr(body.phone)) d.push("phone은 필수입니다.");

  // 업체는 사업자 3종 필수. DB 제약(providers_business_fields)과 같은 요구지만
  // 여기서 먼저 걸러 422 로 안내한다(제약 위반은 db_error 로 뭉개진다).
  if (body.type === "business") {
    if (!isStr(body.business_no) || !isValidBusinessNo(body.business_no)) {
      d.push("business_no는 유효한 사업자등록번호(10자리)여야 합니다.");
    }
    if (!isStr(body.rep_name)) d.push("업체는 rep_name이 필수입니다.");
    if (!isStr(body.open_date)) d.push("업체는 open_date가 필수입니다.");
  }
  if (d.length > 0) return errorResponse(req, "validation_failed", { details: d });

  const insert: Record<string, unknown> = {
    type: body.type,
    status: "registered",
    display_name: body.display_name,
    phone: body.phone,
  };
  if (isStr(body.email)) insert.email = body.email;
  if (body.type === "business") {
    insert.business_no = body.business_no;
    insert.rep_name = body.rep_name;
    insert.open_date = body.open_date;
  }

  const { data: created, error } = await db.from("providers").insert(insert)
    .select(PROVIDER_COLS).single();
  if (error) {
    console.error(`공급자 생성 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }
  const prov = created as unknown as ProviderRow;

  await appendEvent(db, prov.id, "registered", caller.actor, {
    metadata: { type: prov.type },
  });

  return jsonResponse(req, 201, toProvider(prov));
}

// ---------------------------------------------------------------------------
// POST /v1/providers/{id}/verify-business
// ---------------------------------------------------------------------------

async function verifyBusinessEndpoint(
  req: Request,
  db: SupabaseClient,
  caller: Caller,
  id: string,
): Promise<Response> {
  const prov = await loadProvider(db, id);
  if (!prov) return errorResponse(req, "provider_not_found");
  if (prov.type !== "business") {
    return errorResponse(req, "validation_failed", {
      details: ["개인 공급자는 사업자 진위확인 대상이 아닙니다."],
    });
  }

  const result = await verifyBusiness({
    businessNo: prov.business_no!,
    repName: prov.rep_name!,
    openDate: "", // 스텁은 개업일을 쓰지 않는다. 실제 호출 시 로드해 넘긴다.
  });

  await db.from("providers").update({
    biz_verify_status: result.valid ? "valid" : "invalid",
    biz_status: result.bizStatus,
    biz_verify_source: result.source,
    biz_verified_at: result.checkedAt,
    // 진위 valid + 계속사업자여도 자동 active 로 보내지 않는다(§13 #10).
    // 운영자 최종 승인을 위해 pending_review 로 올린다.
    status: result.valid ? "pending_review" : "rejected",
    status_reason: result.valid ? null : result.reason,
  }).eq("id", id);

  await appendEvent(
    db,
    id,
    result.valid ? "verified" : "rejected",
    caller.actor,
    {
      reason: result.reason,
      // ⚠️ source 를 원장에 남긴다. 재검증 대상 추출과 감사의 근거다.
      metadata: { kind: "business", source: result.source, valid: result.valid },
    },
  );

  const updated = await loadProvider(db, id);
  return jsonResponse(req, 200, toProvider(updated!));
}

async function verifyIdentityEndpoint(
  req: Request,
  db: SupabaseClient,
  caller: Caller,
  id: string,
): Promise<Response> {
  const prov = await loadProvider(db, id);
  if (!prov) return errorResponse(req, "provider_not_found");
  if (prov.type !== "individual") {
    return errorResponse(req, "validation_failed", {
      details: ["업체는 본인인증 대상이 아닙니다."],
    });
  }

  const result = await verifyIdentity({
    phone: prov.phone,
    name: prov.display_name,
  });

  await db.from("providers").update({
    identity_verify_source: result.source,
    identity_verified_at: result.verified ? result.checkedAt : null,
    // 스텁은 verified=false 이므로 자동 전이하지 않는다. 운영자가 수동 확인 후
    // 승인 경로(approve)로 pending_review → active 시킨다.
    status: "pending_review",
  }).eq("id", id);

  await appendEvent(db, id, "verified", caller.actor, {
    reason: result.reason,
    metadata: {
      kind: "identity",
      source: result.source,
      verified: result.verified,
    },
  });

  const updated = await loadProvider(db, id);
  return jsonResponse(req, 200, toProvider(updated!));
}

// ---------------------------------------------------------------------------
// PUT /v1/providers/{id}/service-areas
// ---------------------------------------------------------------------------

interface AreaInput {
  region_code?: unknown;
}

async function setServiceAreas(
  req: Request,
  db: SupabaseClient,
  caller: Caller,
  id: string,
): Promise<Response> {
  // provider 는 본인만. operator 는 아무나.
  if (caller.kind === "provider" && caller.id !== id) {
    return errorResponse(req, "provider_not_found");
  }
  const prov = await loadProvider(db, id);
  if (!prov) return errorResponse(req, "provider_not_found");

  let body: { areas?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "validation_failed", {
      details: ["요청 본문이 올바른 JSON이 아닙니다."],
    });
  }
  if (!Array.isArray(body.areas)) {
    return errorResponse(req, "validation_failed", {
      details: ["areas는 { region_code } 배열이어야 합니다."],
    });
  }

  // 서비스 지역의 접두만 허용한다. is_serviceable=true 인 코드로 시작하지 않는
  // 접두를 등록하면 배차 대상이 안 되는 공급자가 생긴다.
  const { data: svc } = await db.from("region_codes").select("code")
    .eq("is_serviceable", true);
  const serviceablePrefixes = new Set(
    ((svc ?? []) as Array<{ code: string }>).map((r) => r.code),
  );
  // 접두 매칭: 등록하려는 코드가 serviceable 코드의 접두이거나,
  // serviceable 코드가 등록 코드의 접두면 커버리지가 겹친다.
  const coversServiceable = (code: string): boolean => {
    for (const s of serviceablePrefixes) {
      if (s.startsWith(code) || code.startsWith(s)) return true;
    }
    return false;
  };

  const rows: Array<{ provider_id: string; region_code: string; level: string }> =
    [];
  const details: string[] = [];
  for (const a of body.areas as AreaInput[]) {
    const code = a?.region_code;
    if (!isStr(code) || !/^[0-9]{2,10}$/.test(code)) {
      details.push(`region_code '${code}' 형식 오류(2·5·10자리 숫자).`);
      continue;
    }
    const level = SERVICE_LEVELS[code.length];
    if (!level) {
      details.push(`region_code '${code}' 길이는 2·5·10 중 하나여야 합니다.`);
      continue;
    }
    if (!coversServiceable(code)) {
      details.push(
        `region_code '${code}' 는 서비스 지역과 겹치지 않습니다. ` +
          "현재 강남구(11680)·서초구(11650)만 배차 대상입니다.",
      );
      continue;
    }
    rows.push({ provider_id: id, region_code: code, level });
  }
  if (details.length > 0) {
    return errorResponse(req, "validation_failed", { details });
  }

  // 전량 교체 — PUT 의미. 기존을 지우고 새로 넣는다.
  await db.from("provider_service_areas").delete().eq("provider_id", id);
  if (rows.length > 0) {
    const { error } = await db.from("provider_service_areas").insert(rows);
    if (error) {
      console.error(`활동지역 등록 실패: ${JSON.stringify(error)}`);
      return errorResponse(req, "db_error");
    }
  }

  return jsonResponse(req, 200, {
    provider_id: id,
    service_areas: rows.map((r) => ({ region_code: r.region_code, level: r.level })),
  });
}

// ---------------------------------------------------------------------------
// POST /v1/providers/{id}/approve · /reject
// ---------------------------------------------------------------------------

async function approveProvider(
  req: Request,
  db: SupabaseClient,
  caller: Caller,
  id: string,
): Promise<Response> {
  const prov = await loadProvider(db, id);
  if (!prov) return errorResponse(req, "provider_not_found");
  if (prov.status !== "pending_review") {
    return errorResponse(req, "invalid_state_transition", {
      details: [`${prov.status} 상태에서는 승인할 수 없습니다. pending_review만 승인됩니다.`],
    });
  }

  let body: { acknowledge_unverified?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // ⚠️ 스텁 검증이면 확인 플래그를 요구한다. 화면 경고만으로는 운영자가 지나친다.
  //    스텁이 위험한 건 결과가 틀려서가 아니라 검증된 것처럼 보여서다 —
  //    승인 요청 자체에 "미검증임을 인지했다"를 명시하게 만든다.
  const stubbed = prov.biz_verify_source === "stub" ||
    prov.identity_verify_source === "stub";
  if (stubbed && body.acknowledge_unverified !== true) {
    return errorResponse(req, "validation_failed", {
      details: [
        "이 공급자는 국세청/본인인증 미검증(stub)입니다. 수동 확인 후 " +
        "acknowledge_unverified: true 를 함께 보내야 승인됩니다.",
      ],
    });
  }

  await db.from("providers").update({
    status: "active",
    status_reason: null,
  }).eq("id", id);

  await appendEvent(db, id, "activated", caller.actor, {
    metadata: {
      acknowledged_unverified: stubbed ? true : undefined,
      biz_verify_source: prov.biz_verify_source,
    },
  });

  const updated = await loadProvider(db, id);
  return jsonResponse(req, 200, toProvider(updated!));
}

async function rejectProvider(
  req: Request,
  db: SupabaseClient,
  caller: Caller,
  id: string,
): Promise<Response> {
  const prov = await loadProvider(db, id);
  if (!prov) return errorResponse(req, "provider_not_found");

  let body: { reason?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  // §14 C — 반려는 사유 필수. DB 제약(provider_events_reason_required)과 같은 요구.
  if (!isStr(body.reason)) {
    return errorResponse(req, "validation_failed", {
      details: ["reason은 필수입니다. 반려 사유를 기록해야 합니다."],
    });
  }

  await db.from("providers").update({
    status: "rejected",
    status_reason: body.reason,
  }).eq("id", id);

  await appendEvent(db, id, "rejected", caller.actor, { reason: body.reason });

  const updated = await loadProvider(db, id);
  return jsonResponse(req, 200, toProvider(updated!));
}

// ---------------------------------------------------------------------------
// GET /v1/providers/{id}/events
// ---------------------------------------------------------------------------

async function listEvents(
  req: Request,
  db: SupabaseClient,
  caller: Caller,
  id: string,
): Promise<Response> {
  if (caller.kind === "provider" && caller.id !== id) {
    return errorResponse(req, "provider_not_found");
  }
  const prov = await loadProvider(db, id);
  if (!prov) return errorResponse(req, "provider_not_found");

  const { data } = await db.from("provider_events")
    .select("event, reason, actor, metadata, at")
    .eq("provider_id", id).order("at", { ascending: true });

  return jsonResponse(req, 200, { events: data ?? [] });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const db = serviceClient();
  const caller = await resolveCaller(req, db);
  if (!caller) return errorResponse(req, "unauthorized");

  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/v1/, "")
    .replace(/\/+$/, "");

  // 각 라우트가 요구 kind 를 선언한다. 공급자 앱이 생기면 provider 분기만
  // 실제로 쓰이기 시작한다 — 코드 변경 없이.
  const require = (kinds: Parameters<typeof callerAllowed>[1]): boolean =>
    callerAllowed(caller, kinds);

  // POST /providers
  if (req.method === "POST" && (path === "/providers" || path === "")) {
    if (!require(["operator"])) return errorResponse(req, "unauthorized");
    return await createProvider(req, db, caller);
  }

  const sub = path.match(/^\/providers\/([^/]+)\/([^/]+)$/);
  if (sub) {
    const [, pid, action] = sub;
    if (!UUID_PATTERN.test(pid)) return errorResponse(req, "property_not_found");

    if (req.method === "POST" && action === "verify-business") {
      if (!require(["operator"])) return errorResponse(req, "unauthorized");
      return await verifyBusinessEndpoint(req, db, caller, pid);
    }
    if (req.method === "POST" && action === "verify-identity") {
      if (!require(["operator"])) return errorResponse(req, "unauthorized");
      return await verifyIdentityEndpoint(req, db, caller, pid);
    }
    if (req.method === "PUT" && action === "service-areas") {
      if (!require(["operator", "provider"])) {
        return errorResponse(req, "unauthorized");
      }
      return await setServiceAreas(req, db, caller, pid);
    }
    if (req.method === "POST" && action === "approve") {
      if (!require(["operator"])) return errorResponse(req, "unauthorized");
      return await approveProvider(req, db, caller, pid);
    }
    if (req.method === "POST" && action === "reject") {
      if (!require(["operator"])) return errorResponse(req, "unauthorized");
      return await rejectProvider(req, db, caller, pid);
    }
    if (req.method === "GET" && action === "events") {
      if (!require(["operator", "provider"])) {
        return errorResponse(req, "unauthorized");
      }
      return await listEvents(req, db, caller, pid);
    }
  }

  return errorResponse(req, "property_not_found", {
    details: [`${req.method} ${path} 은(는) 정의되지 않은 경로입니다.`],
  });
});
