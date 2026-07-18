// 테넌트 인증 — CLAUDE.md R4 (SEC-04)
//
// service_role 키를 쓰는 EF는 RLS를 우회한다. 따라서 모든 EF는 진입 즉시 caller를
// 자체 검증하고, 통과 못 한 요청은 DB에 접근하지 않는다.
//
// 키 형식:  ck_live_<48 hex>  /  ck_test_<48 hex>
// 저장:     key_hash = sha256(전체 평문) hex, UNIQUE
//           key_prefix = 평문 앞 16자 (식별·조회용)
// 평문은 발급 시 1회만 반환하고 저장하지 않는다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Env = "live" | "test";

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  apiKeyId: string;
  /** 키의 env가 그 요청의 데이터 공간을 결정한다. 생성물에 이 값을 박는다. */
  env: Env;
}

const KEY_PATTERN = /^ck_(live|test)_[0-9a-f]{48}$/;

/** service_role 클라이언트. RLS를 우회하므로 caller 검증 이후에만 쓴다. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Authorization: Bearer <key> 또는 X-API-Key: <key> 에서 평문 키를 뽑는다.
 * 둘 다 받는다. 형식이 어긋나면 null.
 */
function extractKey(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(\S+)$/i);
    if (m && KEY_PATTERN.test(m[1])) return m[1];
  }
  const header = req.headers.get("X-API-Key");
  if (header && KEY_PATTERN.test(header.trim())) return header.trim();
  return null;
}

/** sha256 → hex. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * caller 신원 검증.
 *
 * 실패 사유를 세분화해 알려주지 않는다(키 열거 방지). 키 없음·형식 오류·
 * 미존재·폐기·테넌트 비활성 전부 동일하게 null을 반환하고, 호출부는 401로 응답한다.
 *
 * @returns 검증 통과 시 TenantContext, 실패 시 null
 */
export async function authenticateTenant(
  req: Request,
  db: SupabaseClient,
): Promise<TenantContext | null> {
  const plain = extractKey(req);
  if (!plain) return null;

  const keyHash = await sha256Hex(plain);

  const { data, error } = await db
    .from("tenant_api_keys")
    .select("id, tenant_id, env, revoked_at, tenants(id, slug, status)")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at !== null) return null;

  // PostgREST 임베드는 관계 형태에 따라 객체/배열로 온다. 둘 다 받는다.
  const tenant = Array.isArray(data.tenants) ? data.tenants[0] : data.tenants;
  if (!tenant || tenant.status !== "active") return null;

  // last_used_at 갱신은 비임계다. 실패해도 요청은 진행한다.
  db.from("tenant_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {}, () => {});

  return {
    tenantId: data.tenant_id,
    tenantSlug: tenant.slug,
    apiKeyId: data.id,
    env: data.env as Env,
  };
}

/**
 * 새 API 키 발급용 재료 생성.
 *
 * 평문은 호출부가 응답으로 1회 반환하고 버린다. 저장하지 않는다.
 */
export async function generateApiKey(
  env: Env,
): Promise<{ plain: string; keyHash: string; keyPrefix: string }> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const plain = `ck_${env}_${hex}`;
  return {
    plain,
    keyHash: await sha256Hex(plain),
    keyPrefix: plain.slice(0, 16),
  };
}
