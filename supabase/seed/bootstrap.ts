/**
 * 개발 시드 부트스트랩
 * =============================================================================
 *
 * 테넌트 · API 키 · 호스트 · 매물 · 커버리지를 개발용으로 채운다.
 * region_codes 참조 데이터는 `01_region_codes.sql`이 담당한다 — 이 스크립트는
 * 그 위에 얹히는 개발 계정 데이터다.
 *
 * ## 실행
 *
 * ```powershell
 * $env:SUPABASE_URL = "https://eufiudomekvefcldglap.supabase.co"
 * $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role 키>"
 * deno run --allow-env --allow-net `
 *   --config supabase/functions/deno.json `
 *   supabase/seed/bootstrap.ts
 * ```
 *
 * `--config`가 필요하다. 이 파일은 `../functions/_shared/auth.ts`를 재사용하는데
 * 그 모듈이 `@supabase/supabase-js` 베어 스펙파이어를 쓰고, 그 매핑이
 * `supabase/functions/deno.json`에 있기 때문이다.
 *
 * ## 옵션
 *
 * - `--rotate` — 기존 API 키를 폐기(revoke)하고 새로 발급한다.
 *
 *   키 평문은 발급 시 1회만 존재하고 DB에는 sha256 해시만 남는다. 따라서
 *   재실행해도 **기존 키의 평문을 복구할 수 없다.** 평문을 잃었으면 이 옵션으로
 *   재발급해야 한다. 기존 키는 revoked_at이 찍혀 즉시 무효가 된다.
 *
 * ## ⚠️ 출력된 API 키 평문
 *
 * stdout에만 나온다. **파일·커밋·로그에 남기지 마라.** 터미널에서 바로 복사해
 * 안전한 곳에 보관한다. 유출 시 `--rotate`로 재발급한다.
 *
 * ## 멱등성
 *
 * 재실행해도 중복이 생기지 않는다. 테넌트·호스트·매물은 자연키로 조회 후
 * 없을 때만 생성한다. API 키는 살아 있는 키가 있으면 건너뛴다(`--rotate` 제외).
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { issueApiKey, type Env } from "../functions/_shared/auth.ts";

// ---------------------------------------------------------------------------
// 시드 상수
// ---------------------------------------------------------------------------

const TENANT = { slug: "arcasos", name: "ARCASOS", status: "active" };

const API_KEYS: Array<{ env: Env; label: string }> = [
  { env: "live", label: "arcasos-live" },
  { env: "test", label: "arcasos-test" },
];

const HOST = { tenant_host_ref: "host_test_001", display_name: "테스트호스트" };

/** 서비스 지역으로 열 구역. 법정동코드 접두 매칭(CLAUDE.md §4). */
const SERVICEABLE_PREFIXES = ["11680", "11650"]; // 강남구, 서초구

const PROPERTIES = [
  {
    tenant_property_ref: "prop_test_001",
    name: "역삼 테스트 매물",
    address: "서울특별시 강남구 역삼동 123-45",
    address_detail: "101동 1001호",
    region_code: "1168010100", // 역삼동 — 강남구라 위에서 serviceable이 된다
    lat: 37.5006,
    lng: 127.0366,
    size_pyeong: 24,
    base_price: 80000,
    status: "active",
  },
  {
    tenant_property_ref: "prop_test_002",
    name: "청운 미지원지역 매물",
    address: "서울특별시 종로구 청운동 1-1",
    address_detail: null,
    region_code: "1111010100", // 청운동 — 강남구 밖이라 is_serviceable=false 유지
    lat: 37.5866,
    lng: 126.9695,
    size_pyeong: 18,
    base_price: 70000,
    // POST /orders 의 409 property_pending_coverage 경로 테스트용
    status: "pending_coverage",
  },
];

// ---------------------------------------------------------------------------

const ROTATE = Deno.args.includes("--rotate");

function db(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요하다.\n" +
        "service_role 키는 하드코딩하지 않는다. 파일 상단 실행법 참조.",
    );
    Deno.exit(1);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// 생성된 Database 타입이 없어 PostgREST가 행 타입을 never로 추론한다.
// 헬퍼를 그 추론에서 떼어내고, 호출부가 기대 형태를 명시한다.
type Result = { data: unknown; error: unknown };

interface IdRow {
  id: string;
}
interface TenantRow extends IdRow {
  status: string;
}
interface ApiKeyRow extends IdRow {
  key_prefix: string;
}
interface PropertyRow extends IdRow {
  status: string;
}

/**
 * PostgREST 오류를 그대로 던져 조용한 실패를 막는다.
 * 결과가 없을 수 있는 조회(maybeSingle)용 — null을 그대로 돌려준다.
 */
function must<T>(res: Result, what: string): T | null {
  if (res.error) {
    throw new Error(`${what} 실패: ${JSON.stringify(res.error)}`);
  }
  return (res.data ?? null) as T | null;
}

/** 반드시 행이 나와야 하는 경우(insert/update ... returning)용. */
function mustRow<T>(res: Result, what: string): T {
  const data = must<T>(res, what);
  if (data === null) {
    throw new Error(`${what} 실패: 반환된 행이 없다`);
  }
  return data;
}

const log = (s: string) => console.log(s);

// ---------------------------------------------------------------------------

async function seedTenant(sb: SupabaseClient): Promise<string> {
  const existing = must<TenantRow>(
    await sb.from("tenants").select("id, status").eq("slug", TENANT.slug)
      .maybeSingle(),
    "테넌트 조회",
  );
  if (existing) {
    log(`  테넌트      기존 사용  ${TENANT.slug} (${existing.id})`);
    return existing.id;
  }
  const created = mustRow<IdRow>(
    await sb.from("tenants").insert(TENANT).select("id").single(),
    "테넌트 생성",
  );
  log(`  테넌트      생성       ${TENANT.slug} (${created.id})`);
  return created.id;
}

interface IssuedKey {
  env: Env;
  label: string;
  plain: string | null;
  prefix: string;
  note: string;
}

async function seedApiKeys(
  sb: SupabaseClient,
  tenantId: string,
): Promise<IssuedKey[]> {
  const out: IssuedKey[] = [];

  for (const spec of API_KEYS) {
    const live = must<ApiKeyRow>(
      await sb.from("tenant_api_keys")
        .select("id, key_prefix")
        .eq("tenant_id", tenantId)
        .eq("env", spec.env)
        .eq("label", spec.label)
        .is("revoked_at", null)
        .maybeSingle(),
      "API 키 조회",
    );

    if (live && !ROTATE) {
      out.push({
        env: spec.env,
        label: spec.label,
        plain: null,
        prefix: live.key_prefix,
        note: "기존 키 유지 — 평문은 복구 불가. 필요하면 --rotate",
      });
      continue;
    }

    if (live && ROTATE) {
      mustRow<IdRow[]>(
        await sb.from("tenant_api_keys")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", live.id)
          .select("id"),
        "기존 키 폐기",
      );
    }

    const { plain, keyHash, keyPrefix } = await issueApiKey(spec.env);
    mustRow<IdRow>(
      await sb.from("tenant_api_keys").insert({
        tenant_id: tenantId,
        env: spec.env,
        label: spec.label,
        key_hash: keyHash,
        key_prefix: keyPrefix,
      }).select("id").single(),
      "API 키 생성",
    );

    out.push({
      env: spec.env,
      label: spec.label,
      plain,
      prefix: keyPrefix,
      note: live ? "재발급 (기존 키 폐기됨)" : "신규 발급",
    });
  }

  return out;
}

/**
 * 호스트는 env별로 별개 행이다. 자연키가 (tenant_id, tenant_host_ref, env)이고
 * `env`에는 DEFAULT가 없다 — 빠뜨리면 not-null 위반으로 즉시 실패한다.
 */
async function seedHost(
  sb: SupabaseClient,
  tenantId: string,
  env: Env,
): Promise<string> {
  const existing = must<TenantRow>(
    await sb.from("hosts").select("id")
      .eq("tenant_id", tenantId)
      .eq("tenant_host_ref", HOST.tenant_host_ref)
      .eq("env", env)
      .maybeSingle(),
    "호스트 조회",
  );
  if (existing) {
    log(`  호스트      기존 사용  ${HOST.tenant_host_ref} [${env}] (${existing.id})`);
    return existing.id;
  }
  // phone/email은 선택 필드이며 미전송이 기본이다(개인정보 제3자 제공 회피).
  const created = mustRow<IdRow>(
    await sb.from("hosts").insert({ tenant_id: tenantId, env, ...HOST })
      .select("id").single(),
    "호스트 생성",
  );
  log(`  호스트      생성       ${HOST.tenant_host_ref} [${env}] (${created.id})`);
  return created.id;
}

async function seedCoverage(sb: SupabaseClient): Promise<void> {
  // 지정한 구만 열고 나머지는 닫는다.
  // 커버리지 테스트에는 지원·미지원 지역이 **둘 다** 필요하다 —
  // pending_coverage 경로와 422 경로를 구분해 검증해야 하기 때문이다.
  let opened = 0;
  for (const prefix of SERVICEABLE_PREFIXES) {
    const rows = mustRow<IdRow[]>(
      await sb.from("region_codes")
        .update({ is_serviceable: true })
        .like("code", `${prefix}%`)
        .select("code"),
      `커버리지 개방(${prefix})`,
    );
    opened += rows.length;
  }

  // 목록 밖인데 열려 있는 것을 닫는다. PostgREST 에 "여러 like 를 모두 부정"이
  // 없으므로 전체를 훑어 접두로 거른다.
  const all = mustRow<Array<{ code: string }>>(
    await sb.from("region_codes").select("code").eq("is_serviceable", true),
    "커버리지 현황 조회",
  );
  const stale = all
    .map((r) => r.code)
    .filter((c) => !SERVICEABLE_PREFIXES.some((p) => c.startsWith(p)));
  if (stale.length > 0) {
    mustRow<IdRow[]>(
      await sb.from("region_codes")
        .update({ is_serviceable: false })
        .in("code", stale)
        .select("code"),
      "커버리지 차단",
    );
  }

  log(
    `  커버리지    ${SERVICEABLE_PREFIXES.join("+")} 접두 ${opened}건 개방` +
      (stale.length ? `, 범위 밖 ${stale.length}건 차단` : ""),
  );
}

async function seedProperties(
  sb: SupabaseClient,
  tenantId: string,
  hostId: string,
  env: Env,
): Promise<void> {
  for (const p of PROPERTIES) {
    const existing = must<PropertyRow>(
      await sb.from("properties").select("id, status")
        .eq("tenant_id", tenantId)
        .eq("tenant_property_ref", p.tenant_property_ref)
        .eq("env", env)
        .maybeSingle(),
      "매물 조회",
    );
    if (existing) {
      log(
        `  매물        기존 사용  ${p.tenant_property_ref} [${env}] ` +
          `(${existing.id}, ${existing.status})`,
      );
      continue;
    }
    // env에는 DEFAULT가 없다. 빠뜨리면 not-null 위반으로 즉시 실패한다.
    // host_id도 같은 env의 호스트여야 한다 — 복합 FK가 강제한다.
    const created = mustRow<IdRow>(
      await sb.from("properties").insert({
        tenant_id: tenantId,
        host_id: hostId,
        env,
        ...p,
      }).select("id").single(),
      "매물 생성",
    );
    log(
      `  매물        생성       ${p.tenant_property_ref} [${env}] ` +
        `(${created.id}, ${p.status})`,
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const sb = db();

  log("\n=== CLEANCALL 개발 시드 ===\n");
  if (ROTATE) log("  [--rotate] 기존 API 키를 폐기하고 재발급한다.\n");

  const tenantId = await seedTenant(sb);
  await seedCoverage(sb);

  // live·test 양쪽에 호스트와 매물을 만든다.
  // 검증은 test 키로만 하므로(CLAUDE.md §6.6) test env에도 데이터가 있어야 한다.
  // 호스트·매물·발주는 env별로 완전히 분리된 행이며, 복합 FK가 교차 참조를 막는다.
  for (const env of ["live", "test"] as Env[]) {
    const hostId = await seedHost(sb, tenantId, env);
    await seedProperties(sb, tenantId, hostId, env);
  }

  const keys = await seedApiKeys(sb, tenantId);

  log("\n=== API 키 ===\n");
  for (const k of keys) {
    log(`  [${k.env}] ${k.label}`);
    log(`    prefix : ${k.prefix}`);
    if (k.plain) {
      log(`    평문   : ${k.plain}`);
    }
    log(`    비고   : ${k.note}\n`);
  }

  if (keys.some((k) => k.plain)) {
    log("  ⚠️  평문 키는 지금 이 화면에만 존재한다. DB에는 sha256 해시만 남는다.");
    log("      복사해서 안전한 곳에 두고, 파일·커밋·로그에는 남기지 마라.\n");
  }

  log("=== 완료 ===\n");
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(`\n시드 실패: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}
