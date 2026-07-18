import { issueApiKey, sha256Hex } from "./auth.ts";
import { corsHeaders, handlePreflight } from "./cors.ts";
import { errorResponse } from "./errors.ts";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };

// --- API 키 생성 ---
const k = await issueApiKey("live");
ok(/^ck_live_[0-9a-f]{48}$/.test(k.plain), `형식 ck_live_<48hex>: ${k.plain.slice(0,20)}...`);
ok(k.keyPrefix === k.plain.slice(0,16) && k.keyPrefix.length === 16, `key_prefix 16자: ${k.keyPrefix}`);
ok(k.keyHash === await sha256Hex(k.plain), "key_hash = sha256(평문)");
ok(k.keyHash.length === 64, "sha256 hex 64자");
const t = await issueApiKey("test");
ok(t.plain.startsWith("ck_test_"), "test env 접두");
ok((await issueApiKey("live")).plain !== k.plain, "매번 다른 키");

// sha256 알려진 벡터
ok(await sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256('abc') 표준 벡터");

// --- CORS ---
const withOrigin = (o: string|null) => new Request("https://x/v1/orders", { headers: o ? { Origin: o } : {} });
const h1 = corsHeaders(withOrigin("https://cleancall.readdy.co"));
ok(h1["Access-Control-Allow-Origin"] === "https://cleancall.readdy.co", "허용 origin 반사");
ok(h1["Vary"] === "Origin", "Vary: Origin 항상 포함");
const h2 = corsHeaders(withOrigin("https://evil.example"));
ok(h2["Access-Control-Allow-Origin"] === undefined, "미허용 origin은 헤더 없음");
ok(h2["Vary"] === "Origin", "미허용도 Vary 포함");
const h3 = corsHeaders(withOrigin(null));
ok(h3["Access-Control-Allow-Origin"] === undefined, "Origin 없으면(서버간) 헤더 없음");
ok(!Object.values({...h1,...h2,...h3}).includes("*"), "와일드카드 * 미사용 (R7)");

const pre = handlePreflight(new Request("https://x", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" }}));
ok(pre?.status === 204, "preflight 204");
ok(pre?.headers.get("Access-Control-Allow-Origin") === "http://localhost:5173", "preflight origin 반사");
ok(handlePreflight(new Request("https://x", { method: "POST" })) === null, "POST는 preflight 아님");

// --- 오류 응답 ---
const e = errorResponse(withOrigin("https://cleancall.readdy.co"), "unauthorized");
ok(e.status === 401, "unauthorized -> 401");
const body = await e.json();
ok(body.error.code === "unauthorized" && Array.isArray(body.error.details), "Error 스키마 { code, message, details[] }");
ok((await errorResponse(withOrigin(null), "property_not_found").json()).error.code === "property_not_found", "타 테넌트 리소스용 404 코드");
ok(errorResponse(withOrigin(null), "property_not_found").status === 404, "property_not_found -> 404 (403 아님)");
ok(errorResponse(withOrigin(null), "sandbox_requires_test_key").status === 403, "sandbox_requires_test_key -> 403");
ok(errorResponse(withOrigin(null), "rate_limited", { headers: { "Retry-After": "30" }}).headers.get("Retry-After") === "30", "429 Retry-After 헤더");

console.log(fail === 0 ? "\n=== 전부 통과 ===" : `\n=== ${fail}건 실패 ===`);
Deno.exit(fail === 0 ? 0 : 1);
