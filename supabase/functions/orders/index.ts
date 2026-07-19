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
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const TRIGGER_TYPES = ["scheduled", "early_checkout", "rework"] as const;
const PRIORITIES = ["normal", "urgent"] as const;

/** 목록 필터용. 전이는 이 함수의 책임이 아니므로 값 검증에만 쓴다. */
const ORDER_STATUSES: string[] = [
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
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  provider_id: string | null;
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
  "id, tenant_ref, property_id, host_id, provider_id, status, trigger_type, priority, " +
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
  opts: {
    reason?: string;
    fault?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const { error } = await db.from("order_events").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    actor: "tenant",
    reason: opts.reason ?? null,
    fault: opts.fault ?? null,
    metadata: opts.metadata ?? {},
  });
  if (error) console.error(`원장 기록 실패: ${JSON.stringify(error)}`);
}

// ---------------------------------------------------------------------------
// 조회 — reconciliation
// ---------------------------------------------------------------------------

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

/**
 * 커서 = (updated_at, order_id) 복합 키를 base64url 로 인코딩한 것.
 *
 * 단일 컬럼(updated_at)만으로는 커서가 성립하지 않는다. 같은 시각에 여러 건이
 * 갱신되면 경계에서 건너뛰거나 무한 반복한다. order_id 를 tie-breaker 로 붙인다.
 */
function encodeCursor(updatedAt: string, id: string): string {
  return btoa(`${updatedAt}|${id}`).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor(c: string): { updatedAt: string; id: string } | null {
  try {
    const padded = c.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
    const i = raw.lastIndexOf("|");
    if (i < 0) return null;
    const updatedAt = raw.slice(0, i);
    const id = raw.slice(i + 1);
    if (!updatedAt || !UUID_PATTERN.test(id)) return null;
    if (Number.isNaN(new Date(updatedAt).getTime())) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

/**
 * GET /v1/orders — webhook 유실 대비 대조용 목록.
 *
 * `updated_since` 는 **`>=`** 로 동작한다. 경계 건이 중복 수신될 수 있으나
 * 누락되지 않는다. 대사(reconciliation)에서 중복은 무해하고 누락은 치명적이다.
 */
async function listOrders(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
): Promise<Response> {
  const url = new URL(req.url);
  const details: string[] = [];

  const rawLimit = url.searchParams.get("limit");
  let limit = LIST_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > LIST_LIMIT_MAX) {
      details.push(`limit은 1~${LIST_LIMIT_MAX} 사이 정수여야 합니다.`);
    } else limit = n;
  }

  const updatedSince = url.searchParams.get("updated_since");
  if (updatedSince !== null && !parseTs(updatedSince)) {
    details.push("updated_since는 ISO8601 시각이어야 합니다.");
  }

  const status = url.searchParams.get("status");
  if (status !== null && !ORDER_STATUSES.includes(status)) {
    details.push(`status는 ${ORDER_STATUSES.join(" | ")} 중 하나여야 합니다.`);
  }

  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) details.push("cursor가 올바르지 않습니다.");

  if (details.length > 0) {
    return errorResponse(req, "validation_failed", { details });
  }

  // env 필터를 빠뜨리면 test 키가 live 발주를 읽어간다. 같은 유형의 버그가
  // 세 번 나왔다 — 조회는 복합 FK로도 막히지 않으므로 여기서 반드시 건다.
  let q = db.from("orders").select(ORDER_COLS)
    .eq("tenant_id", ctx.tenantId)
    .eq("env", ctx.env);

  if (updatedSince) q = q.gte("updated_at", updatedSince);
  if (status) q = q.eq("status", status);
  if (cursor) {
    // (updated_at, id) > (cursor.updatedAt, cursor.id) 의 키셋 비교.
    // PostgREST 는 행 값 비교를 직접 지원하지 않아 or/and 로 편다.
    q = q.or(
      `updated_at.gt.${cursor.updatedAt},` +
        `and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`,
    );
  }

  // 한 건 더 읽어 다음 페이지 존재 여부를 판정한다.
  const { data, error } = await q
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (error) {
    console.error(`발주 목록 조회 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  const rows = (data ?? []) as unknown as OrderRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const gatesList = await Promise.all(
    page.map((o) => checkGates(db, o.host_id, o.property_id)),
  );

  return jsonResponse(req, 200, {
    orders: page.map((o, i) => toOrder(o, gatesList[i])),
    // 마지막 페이지면 null. 클라이언트는 이걸로 종료를 판정한다.
    next_cursor: hasMore
      ? encodeCursor(page[page.length - 1].updated_at, page[page.length - 1].id)
      : null,
  });
}

/** OrderDetail 조립. 목록용 Order 에 상세 필드를 더한다. */
async function toOrderDetail(
  db: SupabaseClient,
  row: OrderRow,
  opts: { withAccessUrl: boolean },
): Promise<Record<string, unknown>> {
  const [gates, providerRes, eventsRes, extraRes] = await Promise.all([
    checkGates(db, row.host_id, row.property_id),
    row.provider_id
      ? db.from("providers").select("display_name, type").eq("id", row.provider_id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("order_events").select("sequence, to_status, actor, reason, at")
      .eq("order_id", row.id).order("id", { ascending: true }),
    db.from("orders")
      .select("completion_photos, checklist, completed_at, failure_code, failure_reason, cancel_reason")
      .eq("id", row.id).maybeSingle(),
  ]);

  const provider = providerRes.data as
    | { display_name: string; type: string }
    | null;
  const extra = extraRes.data as {
    completion_photos: unknown[];
    checklist: Record<string, unknown>;
    completed_at: string | null;
    failure_code: string | null;
    failure_reason: string | null;
    cancel_reason: string | null;
  } | null;

  // 출입정보 갱신 링크는 평문을 저장하지 않으므로 기존 링크를 복원할 수 없다.
  // 단건 조회에서만 새로 발급한다. 스펙상 링크 자체는 민감정보가 아니며
  // (입력 페이지) 이전 링크도 만료 전까지 함께 유효하다.
  let accessUrl: string | null = null;
  if (opts.withAccessUrl && row.deadline_at) {
    const t = await issueOrderAccessToken(db, {
      orderId: row.id,
      hostId: row.host_id,
      deadlineAt: row.deadline_at,
    });
    accessUrl = t?.url ?? null;
  }

  return {
    ...toOrder(row, gates),
    provider: provider
      ? { display_name: provider.display_name, type: provider.type }
      : null,
    amounts: {
      base_amount: row.base_amount,
      urgent_premium: row.urgent_premium,
      charge_amount: row.charge_amount,
    },
    completion: extra?.completed_at
      ? {
        photos: extra.completion_photos ?? [],
        checklist: extra.checklist ?? {},
        completed_at: extra.completed_at,
      }
      : null,
    // 세금계산서 발행 EF가 아직 없다. 필드 자리만 유지한다.
    tax_invoice: null,
    access_update_url: accessUrl,
    failure_code: extra?.failure_code ?? null,
    failure_reason: extra?.failure_reason ?? null,
    cancel_reason: extra?.cancel_reason ?? null,
    events: eventsRes.data ?? [],
  };
}

async function getOrder(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
): Promise<Response> {
  const { data } = await db.from("orders").select(ORDER_COLS)
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenantId)
    .eq("env", ctx.env)
    .maybeSingle();
  if (!data) return errorResponse(req, "order_not_found");

  return jsonResponse(
    req,
    200,
    await toOrderDetail(db, data as unknown as OrderRow, { withAccessUrl: true }),
  );
}

/**
 * GET /v1/orders/by-ref/{tenant_ref}
 *
 * 한 예약에 복수 발주가 있을 수 있다 — 중도퇴실 긴급 발주, 재청소(rework).
 * 멱등키가 `(tenant_id, tenant_ref, trigger_type, env)` 이므로 `tenant_ref`
 * 하나로는 유일하지 않다. 배열로 돌려준다.
 */
async function getOrdersByRef(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  tenantRef: string,
): Promise<Response> {
  const { data } = await db.from("orders").select(ORDER_COLS)
    .eq("tenant_id", ctx.tenantId)
    .eq("tenant_ref", tenantRef)
    .eq("env", ctx.env)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as OrderRow[];
  if (rows.length === 0) return errorResponse(req, "order_not_found");

  const orders = [];
  for (const r of rows) {
    orders.push(await toOrderDetail(db, r, { withAccessUrl: false }));
  }
  return jsonResponse(req, 200, { orders });
}

// ---------------------------------------------------------------------------
// 변경 · 취소
// ---------------------------------------------------------------------------

/** 이 상태들에서는 더 이상 변경·취소를 받지 않는다. */
const TERMINAL_STATES = [
  "completed",
  "confirmed",
  "charged",
  "paid_out",
  "cancelled",
  "failed",
];

interface ChangePreview {
  compensation_applies: boolean;
  estimated_amount: number;
  free_until: string | null;
  fault: string;
}

/**
 * 보상 발생 여부.
 *
 * dry_run 과 실제 실행이 **같은 DB 함수**를 본다. 미리보기와 실행이 다른 계산을
 * 쓰면 "예상과 다른 청구"가 나온다.
 *
 * ⚠️ 계산만 한다. claims 행을 만들지 않는다 — 보상 정책이 §13 #5 로 미정이고,
 *    공급자 약관과 함께 확정될 때까지 집행하지 않는다(v0.3.1).
 */
async function previewCompensation(
  db: SupabaseClient,
  orderId: string,
): Promise<ChangePreview> {
  const { data, error } = await db.rpc("compensation_preview", {
    p_order_id: orderId,
  });
  if (error || !data) {
    console.error(`보상 미리보기 실패: ${JSON.stringify(error)}`);
    return {
      compensation_applies: false,
      estimated_amount: 0,
      free_until: null,
      fault: "none",
    };
  }
  return data as ChangePreview;
}

interface PatchBody {
  checkout_at?: unknown;
  next_checkin_at?: unknown;
  spec?: unknown;
  dry_run?: unknown;
}

async function patchOrder(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
): Promise<Response> {
  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "validation_failed", {
      details: ["요청 본문이 올바른 JSON이 아닙니다."],
    });
  }

  const { data: found } = await db.from("orders").select(ORDER_COLS)
    .eq("id", orderId).eq("tenant_id", ctx.tenantId).eq("env", ctx.env)
    .maybeSingle();
  if (!found) return errorResponse(req, "order_not_found");
  const order = found as unknown as OrderRow;

  if (TERMINAL_STATES.includes(order.status)) {
    return errorResponse(req, "invalid_state_transition", {
      details: [`${order.status} 상태에서는 변경할 수 없습니다.`],
    });
  }

  const details: string[] = [];
  const newCheckout = body.checkout_at != null ? parseTs(body.checkout_at) : null;
  if (body.checkout_at != null && !newCheckout) {
    details.push("checkout_at은 ISO8601 시각이어야 합니다.");
  }
  // null 을 명시적으로 보내면 "다음 예약 없음"으로 지운다. undefined 는 무변경.
  const clearNext = body.next_checkin_at === null;
  const newNext = body.next_checkin_at != null
    ? parseTs(body.next_checkin_at)
    : null;
  if (body.next_checkin_at != null && !newNext) {
    details.push("next_checkin_at은 ISO8601 시각이거나 null이어야 합니다.");
  }
  if (
    body.spec != null &&
    (typeof body.spec !== "object" || Array.isArray(body.spec))
  ) {
    details.push("spec은 객체여야 합니다.");
  }

  const effCheckout = newCheckout ?? new Date(order.checkout_at);
  if (new Date(order.checkin_at).getTime() >= effCheckout.getTime()) {
    details.push("checkout_at은 checkin_at보다 뒤여야 합니다.");
  }
  if (details.length > 0) {
    return errorResponse(req, "validation_failed", { details });
  }

  const preview = await previewCompensation(db, order.id);

  // dry_run — 실제 변경 없이 보상 발생 여부만 돌려준다.
  // 호스트에게 사전 안내한 뒤 실제로 호출하라는 것이 이 필드의 취지다.
  if (body.dry_run === true) {
    return jsonResponse(req, 200, preview);
  }

  // deadline_at 재계산. next_checkin_at 이 있으면 그것이 마감이고,
  // 없으면 checkout_at + 매물별 N시간이다.
  const { data: propData } = await db.from("properties")
    .select("cleaning_deadline_hours").eq("id", order.property_id).maybeSingle();
  const hours =
    (propData as { cleaning_deadline_hours: number } | null)
      ?.cleaning_deadline_hours ?? 24;

  const effNext = clearNext
    ? null
    : (newNext ?? (order.next_checkin_at ? new Date(order.next_checkin_at) : null));
  const deadline = effNext ??
    new Date(effCheckout.getTime() + hours * 60 * 60 * 1000);

  const patch: Record<string, unknown> = {
    checkout_at: effCheckout.toISOString(),
    next_checkin_at: effNext?.toISOString() ?? null,
    deadline_at: deadline.toISOString(),
  };
  if (body.spec && typeof body.spec === "object") patch.spec = body.spec;

  const { data: updated, error } = await db.from("orders").update(patch)
    .eq("id", order.id).select(ORDER_COLS).single();
  if (error) {
    console.error(`발주 변경 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  // 원장에 남긴다. 상태는 그대로지만 테넌트가 관측하는 값이 바뀌었다.
  // 보상이 발생하는 변경이면 그 사실도 함께 기록한다 — 나중에 집행할 때의 근거다.
  await appendEvent(db, order.id, order.status, order.status, {
    reason: "tenant_patch",
    metadata: {
      compensation_applies: preview.compensation_applies,
      free_until: preview.free_until,
      // ⚠️ claims 는 만들지 않는다. 정책 확정 전까지 계산만 한다.
      claim_created: false,
    },
  });

  return jsonResponse(
    req,
    200,
    await toOrderDetail(db, updated as unknown as OrderRow, {
      withAccessUrl: false,
    }),
  );
}

interface CancelBody {
  reason?: unknown;
  fault?: unknown;
  dry_run?: unknown;
}

async function cancelOrder(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
): Promise<Response> {
  let body: CancelBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "validation_failed", {
      details: ["요청 본문이 올바른 JSON이 아닙니다."],
    });
  }

  if (!isStr(body.reason)) {
    return errorResponse(req, "validation_failed", {
      details: ["reason은 필수 문자열입니다."],
    });
  }

  const { data: found } = await db.from("orders").select(ORDER_COLS)
    .eq("id", orderId).eq("tenant_id", ctx.tenantId).eq("env", ctx.env)
    .maybeSingle();
  if (!found) return errorResponse(req, "order_not_found");
  const order = found as unknown as OrderRow;

  if (TERMINAL_STATES.includes(order.status)) {
    return errorResponse(req, "invalid_state_transition", {
      details: [`${order.status} 상태에서는 취소할 수 없습니다.`],
    });
  }

  const preview = await previewCompensation(db, order.id);
  if (body.dry_run === true) {
    return jsonResponse(req, 200, preview);
  }

  // 청구는 애초에 없다. 환불 처리가 불필요하다(v0.3.1).
  const { data: updated, error } = await db.from("orders").update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancel_reason: body.reason,
    // 테넌트가 보낸 fault 는 참고값이다. 최종 판정은 클린콜이 원장을 근거로 한다.
    tenant_reported_fault: isStr(body.fault) ? body.fault : null,
    fault: preview.fault,
  }).eq("id", order.id).select(ORDER_COLS).single();

  if (error) {
    console.error(`발주 취소 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  await appendEvent(db, order.id, order.status, "cancelled", {
    reason: body.reason,
    fault: preview.fault,
    metadata: {
      compensation_applies: preview.compensation_applies,
      free_until: preview.free_until,
      tenant_reported_fault: isStr(body.fault) ? body.fault : null,
      // ⚠️ 취소보상 claim 을 자동 생성하지 않는다.
      //    정책이 공급자 약관과 함께 확정될 때까지 계산만 하고 집행하지 않는다.
      claim_created: false,
    },
  });

  return jsonResponse(
    req,
    200,
    await toOrderDetail(db, updated as unknown as OrderRow, {
      withAccessUrl: false,
    }),
  );
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
    .replace(/\/+$/, "");

  if (path === "/orders" || path === "") {
    if (req.method === "POST") return await createOrder(req, db, ctx);
    if (req.method === "GET") return await listOrders(req, db, ctx);
  }

  // by-ref 를 {order_id} 보다 먼저 본다. 아래 패턴이 "by-ref" 를
  // order_id 로 삼키지 않도록.
  const byRef = path.match(/^\/orders\/by-ref\/(.+)$/);
  if (req.method === "GET" && byRef) {
    return await getOrdersByRef(req, db, ctx, decodeURIComponent(byRef[1]));
  }

  const cancel = path.match(/^\/orders\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancel) {
    if (!UUID_PATTERN.test(cancel[1])) {
      return errorResponse(req, "order_not_found");
    }
    return await cancelOrder(req, db, ctx, cancel[1]);
  }

  const one = path.match(/^\/orders\/([^/]+)$/);
  if (one && !UUID_PATTERN.test(one[1])) {
    return errorResponse(req, "order_not_found");
  }
  if (req.method === "GET" && one) return await getOrder(req, db, ctx, one[1]);
  if (req.method === "PATCH" && one) {
    return await patchOrder(req, db, ctx, one[1]);
  }

  return errorResponse(req, "order_not_found", {
    details: [`${req.method} ${path} 은(는) 정의되지 않은 경로입니다.`],
  });
});
