// POST /v1/orders — 발주 생성
//
// OpenAPI v0.3.1 `/orders` 참조.
//
// ⚠️ 이 함수는 배차하지 않는다. billing_verified 까지가 끝이다.
//    오퍼 웨이브는 별도 EF이며, 원칙 D(강제 배정 금지)상 이 함수에 공급자를 고르는
//    경로가 있어서는 안 된다.

import {
  authenticateTenant,
  serviceClient,
  type TenantContext,
} from "../_shared/auth.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";
import { issueOrderAccessToken } from "../_shared/tokens.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const TRIGGER_TYPES = ["scheduled", "early_checkout", "rework"] as const;
const PRIORITIES = ["normal", "urgent"] as const;

type TriggerType = typeof TRIGGER_TYPES[number];

interface OrderCreateBody {
  tenant_ref?: unknown;
  property_ref?: unknown;
  property_id?: unknown;
  checkin_at?: unknown;
  checkout_at?: unknown;
  next_checkin_at?: unknown;
  trigger_type?: unknown;
  priority?: unknown;
  spec?: unknown;
  base_amount?: unknown;
}

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);

/** ISO8601 파싱. 실패 시 null. */
function parseTs(v: unknown): Date | null {
  if (!isStr(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------

interface PropertyRow {
  id: string;
  host_id: string;
  status: string;
  base_price: number | null;
  cleaning_deadline_hours: number;
}

interface OrderRow {
  id: string;
  tenant_ref: string;
  property_id: string;
  host_id: string;
  status: string;
  trigger_type: string;
  priority: string;
  checkin_at: string;
  checkout_at: string;
  next_checkin_at: string | null;
  deadline_at: string | null;
  scheduled_at: string | null;
  arrival_at: string | null;
  base_amount: number;
  urgent_premium: number;
  charge_amount: number;
  charged_at: string | null;
  fault: string;
  free_change_until: string | null;
  sequence: number;
  updated_at: string;
}

const ORDER_COLS =
  "id, tenant_ref, property_id, host_id, status, trigger_type, priority, " +
  "checkin_at, checkout_at, next_checkin_at, deadline_at, scheduled_at, arrival_at, " +
  "base_amount, urgent_premium, charge_amount, charged_at, fault, free_change_until, " +
  "sequence, updated_at";

interface Warning {
  code: string;
  message: string;
  next_action: string;
}

/** 배차 게이트 상태. 둘 다 충족되어야 billing_verified 로 넘어간다. */
interface Gates {
  billingLinked: boolean;
  accessRegistered: boolean;
  accessUpdatedAt: string | null;
}

async function checkGates(
  db: SupabaseClient,
  hostId: string,
  propertyId: string,
): Promise<Gates> {
  const [billing, access] = await Promise.all([
    db.from("billing_keys").select("id").eq("host_id", hostId)
      .eq("status", "active").is("revoked_at", null).limit(1),
    db.from("property_access_info").select("updated_at")
      .eq("property_id", propertyId).maybeSingle(),
  ]);

  const a = access.data as { updated_at: string } | null;
  return {
    billingLinked: ((billing.data as unknown[] | null) ?? []).length > 0,
    accessRegistered: a !== null,
    accessUpdatedAt: a?.updated_at ?? null,
  };
}

function warningsFor(g: Gates): Warning[] {
  const w: Warning[] = [];
  if (!g.billingLinked) {
    w.push({
      code: "billing_key_required",
      message: "호스트의 결제수단이 등록되지 않아 배차가 보류됩니다.",
      next_action: "호스트에게 결제수단 등록 링크를 안내하십시오.",
    });
  }
  if (!g.accessRegistered) {
    w.push({
      code: "access_info_required",
      message: "출입 정보가 등록되지 않아 배차가 보류됩니다.",
      next_action:
        "access_update_url 을 호스트에게 전달해 출입 정보를 등록하게 하십시오.",
    });
  }
  return w;
}

function toOrder(row: OrderRow, g: Gates): Record<string, unknown> {
  return {
    order_id: row.id,
    tenant_ref: row.tenant_ref,
    property_id: row.property_id,
    status: row.status,
    trigger_type: row.trigger_type,
    priority: row.priority,
    checkin_at: row.checkin_at,
    checkout_at: row.checkout_at,
    next_checkin_at: row.next_checkin_at,
    deadline_at: row.deadline_at,
    scheduled_at: row.scheduled_at,
    arrival_at: row.arrival_at,
    charge_amount: row.charge_amount,
    charged_at: row.charged_at,
    fault: row.fault,
    // 배차 전에는 null이며 언제든 무보상이다. 배차 후 scheduled_at - 24h 로 채워진다.
    free_change_until: row.free_change_until,
    access_info: {
      status: g.accessRegistered ? "registered" : "not_registered",
      updated_at: g.accessUpdatedAt,
    },
    sequence: row.sequence,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------

function validate(body: OrderCreateBody): string[] {
  const d: string[] = [];

  if (!isStr(body.tenant_ref)) d.push("tenant_ref는 필수 문자열입니다.");
  if (!isStr(body.property_id) && !isStr(body.property_ref)) {
    d.push("property_id 또는 property_ref 중 하나는 필수입니다.");
  }

  const checkin = parseTs(body.checkin_at);
  const checkout = parseTs(body.checkout_at);
  if (!checkin) d.push("checkin_at은 필수 ISO8601 시각입니다.");
  if (!checkout) d.push("checkout_at은 필수 ISO8601 시각입니다.");

  // 체크인이 먼저다. 체크아웃 = 청소 시작 가능 시각.
  if (checkin && checkout && checkin.getTime() >= checkout.getTime()) {
    d.push("checkout_at은 checkin_at보다 뒤여야 합니다.");
  }

  if (body.next_checkin_at != null && !parseTs(body.next_checkin_at)) {
    d.push("next_checkin_at은 ISO8601 시각이거나 null이어야 합니다.");
  }
  if (
    body.trigger_type != null &&
    !TRIGGER_TYPES.includes(body.trigger_type as TriggerType)
  ) {
    d.push(`trigger_type은 ${TRIGGER_TYPES.join(" | ")} 중 하나여야 합니다.`);
  }
  if (
    body.priority != null &&
    !PRIORITIES.includes(body.priority as typeof PRIORITIES[number])
  ) {
    d.push(`priority는 ${PRIORITIES.join(" | ")} 중 하나여야 합니다.`);
  }
  if (body.base_amount != null && (!isInt(body.base_amount) || body.base_amount < 0)) {
    d.push("base_amount는 0 이상의 정수(원)여야 합니다.");
  }
  if (
    body.spec != null &&
    (typeof body.spec !== "object" || Array.isArray(body.spec))
  ) {
    d.push("spec은 객체여야 합니다.");
  }

  return d;
}

// ---------------------------------------------------------------------------

async function createOrder(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
): Promise<Response> {
  let body: OrderCreateBody;
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

  const tenantRef = body.tenant_ref as string;
  const triggerType = (body.trigger_type as TriggerType) ?? "scheduled";

  // --- 멱등 1차: INSERT 전 조회 -------------------------------------------
  // 키는 (tenant_id, tenant_ref, trigger_type, env). rework는 scheduled와
  // 키가 분리되므로 같은 tenant_ref로도 별도 발주가 생성된다.
  const replay = await findExisting(req, db, ctx, tenantRef, triggerType);
  if (replay) return replay;

  // --- 매물 --------------------------------------------------------------
  let q = db.from("properties")
    .select("id, host_id, status, base_price, cleaning_deadline_hours")
    .eq("tenant_id", ctx.tenantId)
    .eq("env", ctx.env);
  q = isStr(body.property_id)
    ? q.eq("id", body.property_id)
    : q.eq("tenant_property_ref", body.property_ref as string);

  const { data: propData } = await q.maybeSingle();
  // 타 테넌트 소유도 여기서 걸러져 404가 된다(존재 여부 비노출).
  if (!propData) return errorResponse(req, "property_not_found");
  const property = propData as PropertyRow;

  if (property.status === "pending_coverage") {
    return errorResponse(req, "property_pending_coverage");
  }
  if (property.status !== "active") {
    return errorResponse(req, "property_inactive");
  }

  // --- 마감 기한 ----------------------------------------------------------
  // next_checkin_at 이 있으면 그것이 마감. 없으면 checkout_at + 매물별 N시간.
  const checkoutAt = parseTs(body.checkout_at)!;
  const nextCheckin = parseTs(body.next_checkin_at);
  const deadlineAt = nextCheckin ??
    new Date(
      checkoutAt.getTime() + property.cleaning_deadline_hours * 60 * 60 * 1000,
    );

  // --- 게이트 -------------------------------------------------------------
  const gates = await checkGates(db, property.host_id, property.id);
  const warnings = warningsFor(gates);
  const dispatchReady = gates.billingLinked && gates.accessRegistered;

  // --- 금액 ---------------------------------------------------------------
  // 원(KRW) 정수. urgent_premium은 정책상 현재 항상 0이다.
  const baseAmount = isInt(body.base_amount)
    ? body.base_amount
    : (property.base_price ?? 0);
  const urgentPremium = 0;

  // --- 생성 ---------------------------------------------------------------
  // 항상 created로 만든다. billing_verified 전이는 아래에서 UPDATE로 태운다 —
  // sequence 트리거가 UPDATE에서만 올라가므로 원장과 sequence가 어긋나지 않는다.
  const { data: createdData, error } = await db.from("orders").insert({
    tenant_id: ctx.tenantId,
    property_id: property.id,
    host_id: property.host_id,
    tenant_ref: tenantRef,
    status: "created",
    trigger_type: triggerType,
    priority: (body.priority as string) ?? "normal",
    checkin_at: (parseTs(body.checkin_at)!).toISOString(),
    checkout_at: checkoutAt.toISOString(),
    next_checkin_at: nextCheckin?.toISOString() ?? null,
    deadline_at: deadlineAt.toISOString(),
    base_amount: baseAmount,
    urgent_premium: urgentPremium,
    charge_amount: baseAmount + urgentPremium,
    spec: (body.spec as Record<string, unknown>) ?? {},
    // env는 DEFAULT가 없다. 키의 env를 그대로 박는다.
    env: ctx.env,
  }).select(ORDER_COLS).single();

  if (error) {
    // --- 멱등 2차: 동시 요청 경합 -----------------------------------------
    // 1차 조회를 통과한 두 요청이 동시에 INSERT하면 unique 위반(23505)이 난다.
    // 재조회해 멱등 응답으로 수렴시킨다.
    const raced = await findExisting(req, db, ctx, tenantRef, triggerType);
    if (raced) return raced;
    console.error(`발주 생성 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  let order = createdData as unknown as OrderRow;

  // 원장 — 생성 이벤트. append-only 이므로 항상 새 행을 쌓는다.
  await appendEvent(db, order.id, null, "created");

  // --- 배차 게이트 통과 시 billing_verified 로 전이 ------------------------
  // 여기까지다. 배차(broadcasting)는 별도 EF의 몫이다.
  if (dispatchReady) {
    const { data: updated } = await db.from("orders")
      .update({
        status: "billing_verified",
        billing_verified_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .select(ORDER_COLS).single();
    if (updated) {
      order = updated as unknown as OrderRow;
      await appendEvent(db, order.id, "created", "billing_verified");
    }
  }

  const token = await issueOrderAccessToken(db, {
    orderId: order.id,
    hostId: property.host_id,
    deadlineAt: deadlineAt.toISOString(),
  });

  return jsonResponse(req, 201, {
    ...toOrder(order, gates),
    billing_verified: dispatchReady,
    idempotent_replay: false,
    warnings,
    access_update_url: token?.url ?? null,
  });
}

/**
 * 멱등키로 기존 발주를 찾아 200 응답을 만든다.
 *
 * ⚠️ 멱등 재요청은 order_events를 추가로 쌓지 않는다. 원장도 멱등이어야 한다.
 *    여기서 이벤트를 쌓으면 §8 보상 대사에서 같은 발주가 여러 번 생성된 것처럼 보인다.
 */
async function findExisting(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  tenantRef: string,
  triggerType: TriggerType,
): Promise<Response | null> {
  const { data } = await db.from("orders").select(ORDER_COLS)
    .eq("tenant_id", ctx.tenantId)
    .eq("tenant_ref", tenantRef)
    .eq("trigger_type", triggerType)
    .eq("env", ctx.env)
    .maybeSingle();
  if (!data) return null;

  const order = data as unknown as OrderRow;
  const gates = await checkGates(db, order.host_id, order.property_id);

  return jsonResponse(req, 200, {
    ...toOrder(order, gates),
    billing_verified: order.status !== "created",
    idempotent_replay: true,
    warnings: warningsFor(gates),
    access_update_url: null,
  });
}

/** append-only 원장. UPDATE·DELETE는 DB 트리거로도 막혀 있다. */
async function appendEvent(
  db: SupabaseClient,
  orderId: string,
  from: string | null,
  to: string,
): Promise<void> {
  const { error } = await db.from("order_events").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    actor: "tenant",
  });
  if (error) console.error(`원장 기록 실패: ${JSON.stringify(error)}`);
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  // R4 — service_role은 RLS를 우회한다. 진입 즉시 caller를 검증한다.
  const db = serviceClient();
  const ctx = await authenticateTenant(req, db);
  if (!ctx) return errorResponse(req, "unauthorized");

  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/v1/, "")
    .replace(/^\/orders-create/, "/orders")
    .replace(/\/+$/, "");

  if (req.method === "POST" && (path === "/orders" || path === "")) {
    return await createOrder(req, db, ctx);
  }

  return errorResponse(req, "order_not_found", {
    details: [`${req.method} ${path} 은(는) 정의되지 않은 경로입니다.`],
  });
});
