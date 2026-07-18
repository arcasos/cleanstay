// CORS — CLAUDE.md R7
//
// 와일드카드 `*`는 어떤 경우에도 쓰지 않는다.
// ALLOWED_ORIGINS 화이트리스트만 반사(reflect)한다.
//
// Origin 헤더가 없는 요청(서버 간 호출)은 그대로 통과시킨다. 브라우저가 아니므로
// CORS가 애초에 적용되지 않고, 방어선은 API 키다.

const ALLOWED_ORIGINS: string[] = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

/** 화이트리스트에 있으면 그 origin을, 없으면 null. */
function resolveOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

/**
 * 응답에 붙일 CORS 헤더.
 *
 * Vary: Origin 은 항상 포함한다. 응답이 Origin에 따라 달라지므로
 * 이게 없으면 중간 캐시가 A origin의 응답을 B origin에 재사용할 수 있다.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = { "Vary": "Origin" };

  const allowed = resolveOrigin(req.headers.get("Origin"));
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = allowed;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "authorization, x-api-key, content-type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  // 화이트리스트에 없는 Origin이면 CORS 헤더를 아예 붙이지 않는다.
  // 브라우저가 알아서 차단한다. 서버 간 호출은 영향받지 않는다.

  return headers;
}

/** OPTIONS preflight 응답. preflight 아니면 null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** JSON 응답 + CORS 헤더. */
export function jsonResponse(
  req: Request,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
