// POST /v1/properties — 매물 등록
// GET  /v1/properties/{property_id} — 매물 조회
//
// OpenAPI v0.3.1 `/properties` 참조.
//
// 발주하려면 매물이 먼저 등록되어야 한다. 호스트는 별도 가입 절차 없이 이 요청으로
// 자동 생성된다.

import {
  authenticateTenant,
  serviceClient,
  type TenantContext,
} from "../_shared/auth.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";
import { resolveRegion } from "../_shared/region.ts";
import { issuePropertySetupToken } from "../_shared/tokens.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// 입력 검증
// ---------------------------------------------------------------------------

interface HostInput {
  tenant_host_ref?: unknown;
  display_name?: unknown;
  phone?: unknown;
  email?: unknown;
}

interface PropertyCreateBody {
  tenant_property_ref?: unknown;
  name?: unknown;
  address?: unknown;
  address_detail?: unknown;
  region_code?: unknown;
  lat?: unknown;
  lng?: unknown;
  size_pyeong?: unknown;
  base_price?: unknown;
  cleaning_deadline_hours?: unknown;
  spec?: unknown;
  host?: HostInput;
}

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

/** @returns 위반 사유 목록. 비어 있으면 통과. */
function validate(body: PropertyCreateBody): string[] {
  const d: string[] = [];

  if (!isStr(body.tenant_property_ref)) {
    d.push("tenant_property_ref는 필수 문자열입니다.");
  }
  if (!isStr(body.address)) d.push("address는 필수 문자열입니다.");

  if (!body.host || typeof body.host !== "object") {
    d.push("host는 필수 객체입니다.");
  } else if (!isStr(body.host.tenant_host_ref)) {
    d.push("host.tenant_host_ref는 필수 문자열입니다.");
  }

  if (body.region_code != null && !isStr(body.region_code)) {
    d.push("region_code는 문자열이거나 null이어야 합니다.");
  }
  if (body.lat != null && !isNum(body.lat)) d.push("lat은 숫자여야 합니다.");
  if (body.lng != null && !isNum(body.lng)) d.push("lng는 숫자여야 합니다.");

  // 금액은 원(KRW) 정수다. 부동소수점을 받지 않는다.
  if (body.base_price != null && !isInt(body.base_price)) {
    d.push("base_price는 정수(원)여야 합니다.");
  }
  if (body.cleaning_deadline_hours != null) {
    if (!isInt(body.cleaning_deadline_hours) || body.cleaning_deadline_hours <= 0) {
      d.push("cleaning_deadline_hours는 양의 정수여야 합니다.");
    }
  }
  if (body.size_pyeong != null && !isNum(body.size_pyeong)) {
    d.push("size_pyeong은 숫자여야 합니다.");
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
// 응답 조립
// ---------------------------------------------------------------------------

interface PropertyRow {
  id: string;
  tenant_property_ref: string;
  host_id: string;
  name: string | null;
  address: string;
  region_code: string | null;
  base_price: number | null;
  cleaning_deadline_hours: number;
  status: string;
  created_at: string;
}

/**
 * PropertyDetail 조립.
 *
 * billing_status·access_info는 각각 billing_keys·property_access_info에서 온다.
 * 출입정보 값 자체는 어떤 경우에도 테넌트에게 반환하지 않는다 — updated_at만
 * 노출해 갱신 독려 판단에 쓰게 한다.
 */
async function toDetail(
  db: SupabaseClient,
  row: PropertyRow,
  setupUrl: string | null,
): Promise<Record<string, unknown>> {
  const [regionRes, billingRes, accessRes] = await Promise.all([
    row.region_code
      ? db.from("region_codes").select("full_name").eq("code", row.region_code)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("billing_keys").select("id").eq("host_id", row.host_id)
      .eq("status", "active").is("revoked_at", null).limit(1),
    db.from("property_access_info").select("updated_at")
      .eq("property_id", row.id).maybeSingle(),
  ]);

  const regionName =
    (regionRes.data as { full_name: string } | null)?.full_name ?? null;
  const billingLinked = ((billingRes.data as unknown[] | null) ?? []).length > 0;
  const access = accessRes.data as { updated_at: string } | null;

  return {
    property_id: row.id,
    tenant_property_ref: row.tenant_property_ref,
    host_id: row.host_id,
    name: row.name,
    address: row.address,
    region_code: row.region_code,
    region_name: regionName,
    base_price: row.base_price,
    cleaning_deadline_hours: row.cleaning_deadline_hours,
    status: row.status,
    created_at: row.created_at,
    billing_status: billingLinked ? "linked" : "not_linked",
    access_info: {
      status: access ? "registered" : "not_registered",
      updated_at: access?.updated_at ?? null,
    },
    setup_link_url: setupUrl,
  };
}

const PROPERTY_COLS =
  "id, tenant_property_ref, host_id, name, address, region_code, base_price, cleaning_deadline_hours, status, created_at";

// ---------------------------------------------------------------------------
// 호스트 자동 프로비저닝
// ---------------------------------------------------------------------------

/**
 * tenant_host_ref 기준으로 호스트를 찾고 없으면 만든다.
 *
 * phone/email은 선택이며 미전송이 기본이다. 전송된 경우에만 채우고, 이미 있는
 * 호스트의 값을 빈 값으로 덮어쓰지 않는다.
 */
async function upsertHost(
  db: SupabaseClient,
  tenantId: string,
  host: HostInput,
): Promise<string | null> {
  const ref = host.tenant_host_ref as string;

  const { data: found } = await db.from("hosts").select("id")
    .eq("tenant_id", tenantId).eq("tenant_host_ref", ref).maybeSingle();
  if (found) return (found as { id: string }).id;

  const insert: Record<string, unknown> = {
    tenant_id: tenantId,
    tenant_host_ref: ref,
  };
  if (isStr(host.display_name)) insert.display_name = host.display_name;
  if (isStr(host.phone)) insert.phone = host.phone;
  if (isStr(host.email)) insert.email = host.email;

  const { data, error } = await db.from("hosts").insert(insert).select("id")
    .single();

  if (error) {
    // 동시 요청이 같은 호스트를 만들면 unique 위반(23505)이 난다. 재조회로 수렴시킨다.
    const { data: raced } = await db.from("hosts").select("id")
      .eq("tenant_id", tenantId).eq("tenant_host_ref", ref).maybeSingle();
    return raced ? (raced as { id: string }).id : null;
  }
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// POST /v1/properties
// ---------------------------------------------------------------------------

async function createProperty(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
): Promise<Response> {
  let body: PropertyCreateBody;
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

  const ref = body.tenant_property_ref as string;

  // 멱등 — 이미 등록된 매물이면 기존 값을 200으로 반환한다(201 아님).
  const { data: existing } = await db.from("properties").select(PROPERTY_COLS)
    .eq("tenant_id", ctx.tenantId).eq("tenant_property_ref", ref).maybeSingle();
  if (existing) {
    return jsonResponse(
      req,
      200,
      await toDetail(db, existing as PropertyRow, null),
    );
  }

  // 지역 해석. 실패는 오류(422)지만, 미지원 지역은 오류가 아니라 pending_coverage다.
  const region = await resolveRegion(db, {
    region_code: body.region_code as string | null,
    lat: body.lat as number | null,
    lng: body.lng as number | null,
    address: body.address as string,
  });
  if (!region) {
    return errorResponse(req, "region_unresolved", {
      details: [
        "region_code, 또는 lat/lng 좌표가 필요합니다. " +
        "주소 문자열만으로는 지역을 해석하지 않습니다.",
      ],
    });
  }

  const hostId = await upsertHost(db, ctx.tenantId, body.host as HostInput);
  if (!hostId) return errorResponse(req, "db_error");

  const insert: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    host_id: hostId,
    tenant_property_ref: ref,
    address: body.address,
    region_code: region.regionCode,
    // 미지원 지역도 등록은 받는다. 발주만 불가하다.
    status: region.isServiceable ? "active" : "pending_coverage",
    // env는 DEFAULT가 없다. 키의 env를 그대로 박는다.
    env: ctx.env,
  };
  if (isStr(body.name)) insert.name = body.name;
  if (isStr(body.address_detail)) insert.address_detail = body.address_detail;
  if (isNum(body.lat)) insert.lat = body.lat;
  if (isNum(body.lng)) insert.lng = body.lng;
  if (isNum(body.size_pyeong)) insert.size_pyeong = body.size_pyeong;
  if (isInt(body.base_price)) insert.base_price = body.base_price;
  if (isInt(body.cleaning_deadline_hours)) {
    insert.cleaning_deadline_hours = body.cleaning_deadline_hours;
  }
  if (body.spec && typeof body.spec === "object") insert.spec = body.spec;

  const { data: created, error } = await db.from("properties").insert(insert)
    .select(PROPERTY_COLS).single();

  if (error) {
    // 동시 요청 경합 — unique 위반이면 재조회해 멱등 응답으로 수렴시킨다.
    const { data: raced } = await db.from("properties").select(PROPERTY_COLS)
      .eq("tenant_id", ctx.tenantId).eq("tenant_property_ref", ref).maybeSingle();
    if (raced) {
      return jsonResponse(req, 200, await toDetail(db, raced as PropertyRow, null));
    }
    console.error(`매물 생성 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  const row = created as PropertyRow;
  const token = await issuePropertySetupToken(db, {
    propertyId: row.id,
    hostId,
  });

  return jsonResponse(req, 201, await toDetail(db, row, token?.url ?? null));
}

// ---------------------------------------------------------------------------
// GET /v1/properties/{property_id}
// ---------------------------------------------------------------------------

async function getProperty(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  propertyId: string,
): Promise<Response> {
  // tenant_id로 함께 걸러 타 테넌트 리소스는 404가 되게 한다.
  // 403을 주면 "그 ID가 존재한다"를 알려주는 셈이라 테넌트 간 ID 열거가 가능해진다.
  const { data } = await db.from("properties").select(PROPERTY_COLS)
    .eq("id", propertyId).eq("tenant_id", ctx.tenantId).maybeSingle();

  if (!data) return errorResponse(req, "property_not_found");
  return jsonResponse(req, 200, await toDetail(db, data as PropertyRow, null));
}

// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  // R4 — service_role은 RLS를 우회한다. 진입 즉시 caller를 검증하고,
  // 통과 못 한 요청은 DB에 접근하지 않는다.
  const db = serviceClient();
  const ctx = await authenticateTenant(req, db);
  if (!ctx) return errorResponse(req, "unauthorized");

  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/v1/, "")
    .replace(/^\/properties-create/, "/properties")
    .replace(/\/+$/, "");

  if (req.method === "POST" && (path === "/properties" || path === "")) {
    return await createProperty(req, db, ctx);
  }

  const m = path.match(/^\/properties\/([^/]+)$/);
  if (req.method === "GET" && m) {
    if (!UUID_PATTERN.test(m[1])) return errorResponse(req, "property_not_found");
    return await getProperty(req, db, ctx, m[1]);
  }

  return errorResponse(req, "property_not_found", {
    details: [`${req.method} ${path} 은(는) 정의되지 않은 경로입니다.`],
  });
});
