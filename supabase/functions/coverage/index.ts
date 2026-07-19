// GET  /v1/coverage        — 서비스 지원 지역 조회
// POST /v1/coverage/check  — 주소·좌표의 지원 여부 확인
//
// OpenAPI v0.3.1 `/coverage` 참조.
//
// ⚠️ 이 엔드포인트는 **인증이 없다**(스펙 `security: []`).
//    서비스 지역 목록은 공개 정보이고, 호스트 대시보드가 "우리 지역 지원 여부"를
//    표시하는 용도라 매물 등록 전(=API 키를 쓰기 전)에 불려야 한다.
//
//    R4 는 "caller 를 검증하라"이지 "모두 인증하라"가 아니다. 여기서 검증할
//    caller 가 없다는 것이 설계다. 대신 아래를 지킨다.
//      · 테넌트 데이터를 일절 읽지 않는다. region_codes 참조 데이터만 본다
//      · 쓰기 경로가 없다
//      · service_role 로 DB 에 붙지 않는다 — anon 권한으로 충분하다
//
//    커버리지는 공급자 확보 상황에 따라 변한다. 테넌트가 자체 판단 로직을 들고
//    있지 말고 이 엔드포인트를 참조해야 한다.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";
import { resolveRegion } from "../_shared/region.ts";

/**
 * anon 클라이언트.
 *
 * service_role 을 쓰지 않는다. 이 함수는 caller 를 검증하지 않으므로
 * RLS 를 우회할 권한을 들고 있으면 안 된다. 필요한 건 참조 데이터 읽기뿐이다.
 */
function anonClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY 미설정");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface RegionRow {
  region_code: string;
  name: string;
  level: string;
}

async function getCoverage(req: Request): Promise<Response> {
  const db = anonClient();
  const { data, error } = await db.rpc("serviceable_regions");

  if (error) {
    console.error(`커버리지 조회 실패: ${JSON.stringify(error)}`);
    return errorResponse(req, "db_error");
  }

  const rows = (data ?? []) as RegionRow[];
  return jsonResponse(req, 200, {
    regions: rows.map((r) => ({
      region_code: r.region_code,
      name: r.name,
      level: r.level,
    })),
    // 커버리지가 언제 기준인지 알려준다. 테넌트가 캐시 주기를 정하는 근거다.
    updated_at: new Date().toISOString(),
  });
}

interface CheckBody {
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
  region_code?: unknown;
}

async function checkCoverage(req: Request): Promise<Response> {
  let body: CheckBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "validation_failed", {
      details: ["요청 본문이 올바른 JSON이 아닙니다."],
    });
  }

  const db = anonClient();
  const region = await resolveRegion(db, {
    region_code: body.region_code as string | null,
    lat: typeof body.lat === "number" ? body.lat : null,
    lng: typeof body.lng === "number" ? body.lng : null,
    address: body.address as string | null,
  });

  // ⚠️ 해석 실패는 serviceable=false 가 아니라 region_code=null 이다.
  //    "모르는 지역"과 "아는데 아직 공급자가 없는 동"은 다르다.
  //    전자는 우리가 판단할 수 없다는 뜻이고, 후자는 곧 열릴 수 있다는 뜻이다.
  //    둘을 false 하나로 뭉개면 호스트가 "왜 안 되는지"를 알 수 없다.
  if (!region) {
    return jsonResponse(req, 200, {
      region_code: null,
      region_name: null,
      serviceable: false,
    });
  }

  return jsonResponse(req, 200, {
    region_code: region.regionCode,
    region_name: region.regionName,
    serviceable: region.isServiceable,
  });
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/v1/, "")
    .replace(/\/+$/, "");

  if (req.method === "GET" && (path === "/coverage" || path === "")) {
    return await getCoverage(req);
  }
  if (req.method === "POST" && path === "/coverage/check") {
    return await checkCoverage(req);
  }

  return errorResponse(req, "property_not_found", {
    details: [`${req.method} ${path} 은(는) 정의되지 않은 경로입니다.`],
  });
});
