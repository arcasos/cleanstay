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
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

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
  env: string,
  host: HostInput,
): Promise<string | null> {
  const ref = host.tenant_host_ref as string;

  // env로도 걸러야 한다. 호스트는 env별로 별개 행이며, 자연키는
  // (tenant_id, tenant_host_ref, env)다.
  const { data: found } = await db.from("hosts").select("id")
    .eq("tenant_id", tenantId).eq("tenant_host_ref", ref)
    .eq("env", env).maybeSingle();
  if (found) return (found as { id: string }).id;

  const insert: Record<string, unknown> = {
    tenant_id: tenantId,
    tenant_host_ref: ref,
    // env는 DEFAULT가 없다. 빠뜨리면 not-null 위반으로 즉시 실패한다.
    env,
  };
  if (isStr(host.display_name)) insert.display_name = host.display_name;
  if (isStr(host.phone)) insert.phone = host.phone;
  if (isStr(host.email)) insert.email = host.email;

  const { data, error } = await db.from("hosts").insert(insert).select("id")
    .single();

  if (error) {
    // 동시 요청이 같은 호스트를 만들면 unique 위반(23505)이 난다. 재조회로 수렴시킨다.
    const { data: raced } = await db.from("hosts").select("id")
      .eq("tenant_id", tenantId).eq("tenant_host_ref", ref)
      .eq("env", env).maybeSingle();
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
  // env로도 걸러야 한다. 빠뜨리면 test 키가 live 매물을 받아간다.
  const { data: existing } = await db.from("properties").select(PROPERTY_COLS)
    .eq("tenant_id", ctx.tenantId).eq("tenant_property_ref", ref)
    .eq("env", ctx.env).maybeSingle();
  if (existing) {
    // ⚠️ 갱신하지 않는다(upsert 아님). POST 는 생성이고, 재호출로 조용히 값을
    //    덮으면 의도치 않은 변경이 눈에 안 띈다. 수정은 PATCH 가 한다.
    //    대신 idempotent_replay 로 "새로 만들지 않았다"를 분명히 알린다 —
    //    이게 없어서 아르카가 "재등록했는데 반영 안 됨"을 몰랐다.
    return jsonResponse(req, 200, {
      ...await toDetail(db, existing as PropertyRow, null),
      idempotent_replay: true,
    });
  }

  // 지역 해석. 실패는 오류(422)지만, 미지원 지역은 오류가 아니라 pending_coverage다.
  const region = await resolveRegion(db, {
    region_code: body.region_code as string | null,
    lat: body.lat as number | null,
    lng: body.lng as number | null,
    address: body.address as string,
  });
  if (!region) {
    // 무엇을 보냈는지에 따라 사유를 구분한다. 좌표를 보낸 테넌트에게
    // "좌표가 필요합니다"라고 답하면 무엇을 고쳐야 할지 알 수 없다.
    const gaveCode = body.region_code != null;
    const gaveCoords = isNum(body.lat) && isNum(body.lng);
    const detail = gaveCode
      ? `region_code '${body.region_code}' 는 서비스 대상 지역이 아닙니다. ` +
        "현재 서울(법정동코드 11 접두)만 지원합니다."
      : gaveCoords
      ? "좌표를 법정동코드로 해석하지 못했습니다. " +
        "현재 서울(법정동코드 11 접두)만 지원하며, 좌표계는 WGS84여야 합니다."
      : "region_code 또는 lat/lng 좌표가 필요합니다. " +
        "주소 문자열만으로는 지역을 해석하지 않습니다.";
    return errorResponse(req, "region_unresolved", { details: [detail] });
  }

  const hostId = await upsertHost(
    db,
    ctx.tenantId,
    ctx.env,
    body.host as HostInput,
  );
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
      .eq("tenant_id", ctx.tenantId).eq("tenant_property_ref", ref)
      .eq("env", ctx.env).maybeSingle();
    if (raced) {
      return jsonResponse(req, 200, {
        ...await toDetail(db, raced as PropertyRow, null),
        idempotent_replay: true,
      });
    }
    console.error(`매물 생성 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  const row = created as PropertyRow;
  const token = await issuePropertySetupToken(db, {
    propertyId: row.id,
    hostId,
  });

  return jsonResponse(req, 201, {
    ...await toDetail(db, row, token?.url ?? null),
    idempotent_replay: false,
  });
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
  //
  // env도 같은 이유로 필터한다. 빠뜨리면 test 키가 live 매물 UUID를 알고 있을 때
  // 그대로 읽어간다 — 테넌트 간 격리와 같은 급의 누출이다.
  const { data } = await db.from("properties").select(PROPERTY_COLS)
    .eq("id", propertyId).eq("tenant_id", ctx.tenantId)
    .eq("env", ctx.env).maybeSingle();

  if (!data) return errorResponse(req, "property_not_found");
  return jsonResponse(req, 200, await toDetail(db, data as PropertyRow, null));
}

// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// PATCH /v1/properties/{id}
// ---------------------------------------------------------------------------

/** 클라이언트가 직접 지정할 수 있는 상태. */
const SETTABLE_STATUS = ["active", "inactive"];

/**
 * 지역에 영향을 주는 필드.
 *
 * 하나라도 바뀌면 재해석하고 serviceable 을 다시 판정한다.
 * active <-> pending_coverage 전이가 여기서 발생한다.
 */
const REGION_FIELDS = ["address", "lat", "lng", "region_code"];

interface PropertyPatchBody {
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
  status?: unknown;
}

/**
 * 배차된 발주가 걸린 매물의 주소를 바꿀 때.
 *
 * ## 판단: in_progress 만 막고 나머지는 허용한다
 *
 * 막고 싶은 유혹이 있다 — 배차된 공급자는 옛 주소를 들고 있고, 조용히 바뀌면
 * 엉뚱한 곳으로 간다. 하지만 **전면 차단은 아르카가 방금 겪은 문제를 재생산한다.**
 * 잘못 등록된 매물을 고칠 방법이 없어지는 것이 더 큰 사고다. 호스트가 주소를
 * 정정하는 것은 실서비스에서 반드시 일어난다.
 *
 * 그래서 경계를 "공급자가 이미 현장에 있는가"로 잡는다.
 *   · in_progress  — 청소가 진행 중이다. 지금 주소를 바꾸는 건 의미가 없고
 *                    원장만 어지럽힌다. 409 로 막는다
 *   · accepted     — 배차됐지만 아직 도착 전이다. 정정이 가능해야 한다.
 *                    대신 응답 warnings 로 "공급자에게 알리라"고 명시한다
 *   · 그 외        — 자유롭게 허용
 *
 * 침묵이 문제였지 변경 자체가 문제가 아니다. 그래서 막는 대신 드러낸다.
 */
async function regionChangeBlockers(
  db: SupabaseClient,
  propertyId: string,
): Promise<{ blocked: string[]; dispatched: string[] }> {
  const { data } = await db.from("orders").select("id, status, tenant_ref")
    .eq("property_id", propertyId)
    .in("status", ["accepted", "in_progress"]);

  const rows = (data ?? []) as Array<
    { id: string; status: string; tenant_ref: string }
  >;
  return {
    blocked: rows.filter((o) => o.status === "in_progress").map((o) => o.id),
    dispatched: rows.filter((o) => o.status === "accepted").map((o) => o.id),
  };
}

async function patchProperty(
  req: Request,
  db: SupabaseClient,
  ctx: TenantContext,
  propertyId: string,
): Promise<Response> {
  let body: PropertyPatchBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "validation_failed", {
      details: ["요청 본문이 올바른 JSON이 아닙니다."],
    });
  }

  // env 필터. 같은 유형의 누락이 세 번 나왔다.
  const { data: found } = await db.from("properties")
    .select(PROPERTY_COLS + ", lat, lng, address_detail")
    .eq("id", propertyId).eq("tenant_id", ctx.tenantId).eq("env", ctx.env)
    .maybeSingle();
  if (!found) return errorResponse(req, "property_not_found");
  const prop = found as unknown as PropertyRow & {
    lat: number | null;
    lng: number | null;
  };

  const details: string[] = [];
  if (body.status != null) {
    if (!isStr(body.status) || !SETTABLE_STATUS.includes(body.status)) {
      // pending_coverage 는 서버 판정 결과지 입력값이 아니다.
      // 클라이언트가 직접 지정하면 커버리지 판정이 무의미해진다.
      details.push(
        `status는 ${SETTABLE_STATUS.join(" | ")} 중 하나여야 합니다. ` +
          "pending_coverage는 서버가 지역 해석 결과로 정합니다.",
      );
    }
  }
  if (body.address != null && !isStr(body.address)) {
    details.push("address는 문자열이어야 합니다.");
  }
  if (body.lat != null && !isNum(body.lat)) details.push("lat은 숫자여야 합니다.");
  if (body.lng != null && !isNum(body.lng)) details.push("lng는 숫자여야 합니다.");
  if (body.base_price != null && !isInt(body.base_price)) {
    details.push("base_price는 정수(원)여야 합니다.");
  }
  if (body.cleaning_deadline_hours != null) {
    if (!isInt(body.cleaning_deadline_hours) || body.cleaning_deadline_hours <= 0) {
      details.push("cleaning_deadline_hours는 양의 정수여야 합니다.");
    }
  }
  if (body.size_pyeong != null && !isNum(body.size_pyeong)) {
    details.push("size_pyeong은 숫자여야 합니다.");
  }
  if (
    body.spec != null &&
    (typeof body.spec !== "object" || Array.isArray(body.spec))
  ) {
    details.push("spec은 객체여야 합니다.");
  }
  if (details.length > 0) {
    return errorResponse(req, "validation_failed", { details });
  }

  const patch: Record<string, unknown> = {};
  if (isStr(body.name)) patch.name = body.name;
  if (body.address_detail !== undefined) {
    patch.address_detail = isStr(body.address_detail) ? body.address_detail : null;
  }
  if (isNum(body.size_pyeong)) patch.size_pyeong = body.size_pyeong;
  if (isInt(body.base_price)) patch.base_price = body.base_price;
  if (isInt(body.cleaning_deadline_hours)) {
    patch.cleaning_deadline_hours = body.cleaning_deadline_hours;
  }
  if (body.spec && typeof body.spec === "object") patch.spec = body.spec;

  const warnings: Array<Record<string, string>> = [];
  const touchesRegion = REGION_FIELDS.some((f) =>
    (body as Record<string, unknown>)[f] !== undefined
  );

  let activated = false;

  if (touchesRegion) {
    const blockers = await regionChangeBlockers(db, prop.id);
    if (blockers.blocked.length > 0) {
      return errorResponse(req, "invalid_state_transition", {
        details: [
          "청소가 진행 중인 발주가 있어 주소·좌표를 변경할 수 없습니다. " +
            `(${blockers.blocked.join(", ")})`,
        ],
      });
    }
    if (blockers.dispatched.length > 0) {
      warnings.push({
        code: "dispatched_orders_affected",
        message:
          `배차 확정된 발주 ${blockers.dispatched.length}건이 이 매물을 참조합니다. ` +
          "공급자는 변경 전 주소를 안내받았습니다.",
        next_action:
          "공급자에게 주소 변경을 알리십시오. POST /v1/orders/{id}/messages 를 사용할 수 있습니다.",
      });
    }

    // POST 와 같은 해석 로직을 쓰되, **입력으로 준 것만** 근거로 삼는다.
    //
    // ⚠️ 저장된 region_code 로 폴백하면 안 된다. resolveRegion 의 우선순위가
    //    region_code > lat/lng 이므로, 폴백하면 새로 준 좌표가 옛 코드에 밀린다.
    //    좌표로는 영영 고칠 수 없게 되고, 그게 아르카가 겪은 상황이다.
    //    region_code 는 해석 결과(파생값)지 입력이 아니다.
    let region = null;
    let regionSkipped = false;

    if (body.region_code !== undefined) {
      // 1순위 — 명시된 코드
      region = await resolveRegion(db, {
        region_code: body.region_code as string | null,
      });
    } else if (body.lat !== undefined || body.lng !== undefined) {
      // 2순위 — 좌표. 한쪽만 줬으면 나머지는 기존 값으로 채운다.
      region = await resolveRegion(db, {
        lat: (body.lat !== undefined ? body.lat : prop.lat) as number | null,
        lng: (body.lng !== undefined ? body.lng : prop.lng) as number | null,
      });
    } else {
      // address 만 바뀌었다. 지오코딩은 범위 밖이라 재해석할 근거가 없다.
      // 기존 지역을 유지하되, 재해석하지 않았다는 사실을 숨기지 않는다 —
      // "강남구 -> 종로구"처럼 지역이 실제로 바뀌는 정정일 수 있다.
      regionSkipped = true;
    }

    if (regionSkipped) {
      warnings.push({
        code: "region_not_reresolved",
        message:
          "주소 문자열만 변경되어 지역을 재해석하지 않았습니다. " +
          `region_code 는 ${prop.region_code} 그대로입니다.`,
        next_action:
          "지역이 실제로 바뀌었다면 lat/lng 또는 region_code 를 함께 보내십시오.",
      });
      if (isStr(body.address)) patch.address = body.address;
      if (isStr(body.status)) patch.status = body.status;
    } else if (!region) {
      const gaveCode = body.region_code != null;
      const gaveCoords = isNum(body.lat) && isNum(body.lng);
      return errorResponse(req, "region_unresolved", {
        details: [
          gaveCode
            ? `region_code '${body.region_code}' 는 서비스 대상 지역이 아닙니다.`
            : gaveCoords
            ? "좌표를 법정동코드로 해석하지 못했습니다. 현재 서울만 지원하며 좌표계는 WGS84여야 합니다."
            : "region_code 또는 lat/lng 좌표가 필요합니다.",
        ],
      });
    } else {
      patch.region_code = region.regionCode;
      if (isStr(body.address)) patch.address = body.address;
      if (isNum(body.lat)) patch.lat = body.lat;
      if (isNum(body.lng)) patch.lng = body.lng;

      // 커버리지 재판정. 클라이언트가 status 를 명시했어도 서버 판정이 우선한다 —
      // 미지원 지역을 active 로 바꿔놓으면 발주가 통과해버린다.
      if (!region.isServiceable) {
        patch.status = "pending_coverage";
      } else if (prop.status === "pending_coverage") {
        patch.status = "active";
        activated = true;
      } else if (isStr(body.status)) {
        patch.status = body.status;
      }
    }
  } else if (isStr(body.status)) {
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse(req, "validation_failed", {
      details: ["변경할 필드가 없습니다."],
    });
  }

  const { data: updated, error } = await db.from("properties").update(patch)
    .eq("id", prop.id).select(PROPERTY_COLS).single();
  if (error) {
    console.error(`매물 변경 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  // pending_coverage -> active 는 테넌트가 기다리던 전이다. 통지한다.
  if (activated) {
    const { error: whErr } = await db.rpc("enqueue_property_activated", {
      p_property_id: prop.id,
    });
    if (whErr) {
      console.error(`property.activated 큐 실패: ${JSON.stringify(whErr)}`);
    }
  }

  const detail = await toDetail(db, updated as PropertyRow, null);
  return jsonResponse(req, 200, { ...detail, warnings });
}

// ---------------------------------------------------------------------------

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
    .replace(/\/+$/, "");

  if (req.method === "POST" && (path === "/properties" || path === "")) {
    return await createProperty(req, db, ctx);
  }

  const m = path.match(/^\/properties\/([^/]+)$/);
  if (m && !UUID_PATTERN.test(m[1])) {
    return errorResponse(req, "property_not_found");
  }
  if (req.method === "GET" && m) return await getProperty(req, db, ctx, m[1]);
  if (req.method === "PATCH" && m) {
    return await patchProperty(req, db, ctx, m[1]);
  }

  return errorResponse(req, "property_not_found", {
    details: [`${req.method} ${path} 은(는) 정의되지 않은 경로입니다.`],
  });
});
