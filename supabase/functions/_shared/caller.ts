// caller 판별 — tenant / provider / operator
//
// 지금까지 EF 는 테넌트 API 키만 봤다. 공급자 온보딩은 세 종류의 caller 가 섞인다:
//   · 테넌트  — ck_* API 키 (발주하는 플랫폼)
//   · 운영자  — Supabase Auth JWT, app_metadata.role = 'operator'
//   · 공급자  — Supabase Auth JWT, providers.auth_user_id 매칭
//
// ## 왜 운영자를 별도 env 토큰이 아니라 Supabase Auth 로 하는가
//
// 별도 토큰이면 "누가 승인했는가"가 원장에 안 남는다. actor 가 'operator:unknown'
// 이 된다. §14 C 는 정지·반려에 사유를 필수로 요구하는데, 그 사유를 누가 적었는지
// 모르면 감사 가치가 절반이다. 운영자가 1인일 때는 괜찮아 보이지만 늘면 소급이
// 불가능하다. JWT 의 sub(user id)를 actor 에 박아 누가 했는지 남긴다.
//
// ⚠️ app_metadata.role 을 본다. user_metadata 가 아니다 —
//    후자는 클라이언트가 고칠 수 있어 누구나 운영자가 된다.
//
// ## RLS 의 is_operator() 를 쓰지 않는 이유
//
// is_operator() 는 auth.jwt() 를 보는데, 우리 EF 는 service_role 로 붙어 RLS 를
// 우회한다. 그 컨텍스트에서 auth.jwt() 는 caller 가 아니라 service_role 을 가리킨다.
// 그래서 여기서 auth.getUser(jwt) 로 직접 검증한다. is_operator() 는 RLS 정책용이다.

import { authenticateTenant, type Env } from "./auth.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type CallerKind = "tenant" | "provider" | "operator";

export interface Caller {
  kind: CallerKind;
  /** tenant → tenant_id, operator → auth user id, provider → provider id */
  id: string;
  /** tenant 만 env 를 갖는다. 공급자·운영자는 공급 측이라 env 개념이 없다. */
  env: Env | null;
  /** 원장 actor 문자열. operator:<uuid> 처럼 누구인지 남긴다. */
  actor: string;
}

/** JWT 형식인가 (ck_* 가 아니고 점 두 개로 나뉜 형태). */
function looksLikeJwt(token: string): boolean {
  return !token.startsWith("ck_") && token.split(".").length === 3;
}

function bearer(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

/**
 * caller 를 판별한다.
 *
 * @returns 판별 성공 시 Caller, 실패 시 null (호출부가 401)
 */
export async function resolveCaller(
  req: Request,
  db: SupabaseClient,
): Promise<Caller | null> {
  const token = bearer(req);
  if (!token) return null;

  // --- 테넌트: ck_* API 키 ------------------------------------------------
  if (token.startsWith("ck_")) {
    const ctx = await authenticateTenant(req, db);
    if (!ctx) return null;
    return {
      kind: "tenant",
      id: ctx.tenantId,
      env: ctx.env,
      actor: "tenant",
    };
  }

  // --- Supabase Auth JWT: operator 또는 provider --------------------------
  if (!looksLikeJwt(token)) return null;

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const user = data.user;

  // ⚠️ app_metadata 다. user_metadata 가 아니다.
  const role = (user.app_metadata as { role?: string } | null)?.role;
  if (role === "operator") {
    return {
      kind: "operator",
      id: user.id,
      env: null,
      actor: `operator:${user.id}`,
    };
  }

  // 운영자가 아니면 공급자 계정인지 본다.
  const { data: prov } = await db.from("providers")
    .select("id").eq("auth_user_id", user.id).maybeSingle();
  if (prov) {
    const providerId = (prov as { id: string }).id;
    return {
      kind: "provider",
      id: providerId,
      env: null,
      actor: `provider:${providerId}`,
    };
  }

  // JWT 는 유효하지만 운영자도 공급자도 아니다. 접근 권한 없음.
  return null;
}

/** caller 가 허용된 kind 중 하나인지. */
export function callerAllowed(
  caller: Caller,
  allowed: CallerKind[],
): boolean {
  return allowed.includes(caller.kind);
}
