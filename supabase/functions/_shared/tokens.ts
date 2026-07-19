// 출입정보 갱신 토큰
//
// 호스트가 로그인 없이 자기 매물·발주의 출입 정보를 등록·갱신하는 링크에 쓴다.
// 평문 토큰은 URL에만 실리고 DB에는 sha256 해시만 저장한다 — API 키와 같은 규율이다.
// (DB가 유출돼도 링크를 복원할 수 없어야 한다.)
//
// ⚠️ 호스트 설정 페이지는 아직 없다. 지금은 토큰 발급과 URL 형태만 확정한다.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sha256Hex } from "./auth.ts";

export type TokenScope = "property" | "order";

/** 매물 단위 출입정보는 고정값이라 만료를 길게 잡는다. */
const PROPERTY_TOKEN_TTL_DAYS = 365;

function setupBaseUrl(): string {
  // 자체 도메인 확정 전까지는 환경변수로 받는다(§13 #1 도메인 미정).
  return Deno.env.get("SETUP_BASE_URL") ?? "https://setup.cleancall.local";
}

export interface IssuedToken {
  url: string;
  expiresAt: string;
}

/**
 * 매물 단위 출입정보 갱신 토큰 발급.
 *
 * 이미 살아 있는 토큰이 있으면 재사용하지 않고 새로 발급한다. 평문을 복구할 수
 * 없으므로 재사용하려면 평문을 저장해야 하는데, 그건 이 설계가 피하려는 것이다.
 */
export async function issuePropertySetupToken(
  db: SupabaseClient,
  opts: { propertyId: string; hostId: string },
): Promise<IssuedToken | null> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const plain = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expiresAt = new Date(
    Date.now() + PROPERTY_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await db.from("access_update_tokens").insert({
    token_hash: await sha256Hex(plain),
    scope: "property",
    property_id: opts.propertyId,
    host_id: opts.hostId,
    expires_at: expiresAt,
  });

  // 토큰 발급 실패로 매물 등록 자체를 되돌리지는 않는다. 링크는 재발급할 수 있고,
  // 매물이 없는 것보다 링크가 없는 편이 복구하기 쉽다.
  if (error) {
    console.error(`setup 토큰 발급 실패: ${JSON.stringify(error)}`);
    return null;
  }

  return { url: `${setupBaseUrl()}/access/${plain}`, expiresAt };
}

/**
 * 발주 단위 출입정보 갱신 토큰 발급.
 *
 * 도어락 비밀번호처럼 게스트마다 바뀌는 값을 그 발주 건에만 적용해 갱신한다.
 * 링크는 해당 발주의 청소 완료 시점까지 유효해야 하므로, 완료 시점을 알 수 없는
 * 생성 시점에서는 마감 기한에 여유를 더해 잡는다.
 */
export async function issueOrderAccessToken(
  db: SupabaseClient,
  opts: { orderId: string; hostId: string; deadlineAt: string },
): Promise<IssuedToken | null> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const plain = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // 마감 + 7일. 재청소·지연을 흡수하되 무기한으로 열어두지는 않는다.
  const expiresAt = new Date(
    new Date(opts.deadlineAt).getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await db.from("access_update_tokens").insert({
    token_hash: await sha256Hex(plain),
    scope: "order",
    order_id: opts.orderId,
    host_id: opts.hostId,
    expires_at: expiresAt,
  });

  if (error) {
    console.error(`발주 출입정보 토큰 발급 실패: ${JSON.stringify(error)}`);
    return null;
  }

  return { url: `${setupBaseUrl()}/access/${plain}`, expiresAt };
}
