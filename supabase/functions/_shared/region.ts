// 법정동코드 해석
//
// 우선순위: region_code > lat/lng > address
//
// 주소 문자열 → 좌표 지오코딩은 범위 밖이다. address만 오면 해석하지 않고
// region_unresolved로 떨군다. 테넌트(아르카)가 카카오맵 좌표를 이미 보유하고 있어
// 실무상 문제가 없다는 회신(§2-4)에 근거한다.
//
// 좌표 → 법정동코드는 카카오 로컬 API `coord2regioncode`를 쓴다. 좌표계는 WGS84로
// 양쪽이 일치한다. 반환된 B코드(법정동)를 region_codes와 대조해 우리가 아는 코드일
// 때만 채택한다 — 서울(11 접두) 밖이면 미지원이 아니라 해석 실패다.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const KAKAO_COORD2REGION =
  "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";

export interface RegionInput {
  region_code?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

export interface ResolvedRegion {
  regionCode: string;
  regionName: string;
  isServiceable: boolean;
}

const CODE_PATTERN = /^[0-9]{10}$/;

/**
 * 코드 조회 경로.
 *
 * - `table` — region_codes 를 직접 읽는다. service_role 로 도는 EF 용.
 * - `rpc`   — resolve_region_public() 을 호출한다. **인증 없는 경로(coverage) 용.**
 *             anon 에게 region_codes 테이블 권한이 없으므로 이 경로여야 한다.
 *             SECURITY DEFINER 함수가 세 컬럼만 돌려준다.
 */
export type LookupMode = "table" | "rpc";

/** region_codes에 있는 코드만 채택한다. 없으면 null. */
async function lookup(
  db: SupabaseClient,
  code: string,
  mode: LookupMode,
): Promise<ResolvedRegion | null> {
  if (mode === "rpc") {
    const { data, error } = await db.rpc("resolve_region_public", {
      p_code: code,
    });
    if (error) {
      console.error(`지역 해석 RPC 실패: ${JSON.stringify(error)}`);
      return null;
    }
    const rows = (data ?? []) as Array<
      { region_code: string; region_name: string; serviceable: boolean }
    >;
    if (rows.length === 0) return null;
    return {
      regionCode: rows[0].region_code,
      regionName: rows[0].region_name,
      isServiceable: rows[0].serviceable,
    };
  }

  const { data, error } = await db
    .from("region_codes")
    .select("code, full_name, is_serviceable, is_active")
    .eq("code", code)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    code: string;
    full_name: string;
    is_serviceable: boolean;
    is_active: boolean;
  };
  if (!row.is_active) return null;

  return {
    regionCode: row.code,
    regionName: row.full_name,
    isServiceable: row.is_serviceable,
  };
}

/**
 * 좌표 → 법정동코드. 카카오 로컬 API.
 *
 * 실패(키 미설정·네트워크·미지원 좌표)는 전부 null로 수렴시킨다. 호출부는
 * region_unresolved(422)로 응답한다. 여기서 예외를 던지면 500이 되는데,
 * 해외 좌표 같은 정상적인 입력 오류를 서버 오류로 보고하게 된다.
 */
async function fromCoords(
  db: SupabaseClient,
  lat: number,
  lng: number,
  mode: LookupMode,
): Promise<ResolvedRegion | null> {
  const apiKey = Deno.env.get("KAKAO_REST_API_KEY");
  if (!apiKey) {
    console.error("KAKAO_REST_API_KEY 미설정 — 좌표 해석 불가");
    return null;
  }

  let payload: { documents?: Array<{ region_type: string; code: string }> };
  try {
    const res = await fetch(`${KAKAO_COORD2REGION}?x=${lng}&y=${lat}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });
    if (!res.ok) {
      console.error(`카카오 coord2regioncode ${res.status}`);
      return null;
    }
    payload = await res.json();
  } catch (e) {
    console.error(`카카오 호출 실패: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  // region_type 'B' = 법정동. 'H'(행정동)는 코드 체계가 다르므로 쓰지 않는다.
  const b = payload.documents?.find((d) => d.region_type === "B");
  if (!b || !CODE_PATTERN.test(b.code)) return null;

  return await lookup(db, b.code, mode);
}

/**
 * 지역 해석.
 *
 * @returns 해석 성공 시 ResolvedRegion, 실패 시 null (호출부가 422 region_unresolved)
 */
export async function resolveRegion(
  db: SupabaseClient,
  input: RegionInput,
  mode: LookupMode = "table",
): Promise<ResolvedRegion | null> {
  // 1순위 — 명시된 region_code. 형식이 맞아도 우리가 모르는 코드면 실패다.
  if (input.region_code) {
    if (!CODE_PATTERN.test(input.region_code)) return null;
    return await lookup(db, input.region_code, mode);
  }

  // 2순위 — 좌표. 주소 문자열 파싱보다 정확하다.
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    if (
      !Number.isFinite(input.lat) || !Number.isFinite(input.lng) ||
      input.lat < -90 || input.lat > 90 ||
      input.lng < -180 || input.lng > 180
    ) {
      return null;
    }
    return await fromCoords(db, input.lat, input.lng, mode);
  }

  // 3순위 — address만. 지오코딩은 범위 밖이므로 해석하지 않는다.
  return null;
}
