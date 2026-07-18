// 오류 코드 체계 — OpenAPI v0.3.1 `Error` 스키마
//
// 응답 형태는 항상 { error: { code, message, details[] } } 다.
//
// ⚠️ 타 테넌트 리소스는 403이 아니라 404를 반환한다.
//    403은 "그 ID가 존재한다"를 알려주는 셈이라 테넌트 간 ID 열거가 가능해진다.

import { jsonResponse } from "./cors.ts";

export const ERROR_STATUS = {
  unauthorized: 401,
  sandbox_requires_test_key: 403,
  property_not_found: 404,
  order_not_found: 404,
  property_inactive: 409,
  property_pending_coverage: 409,
  invalid_state_transition: 409,
  claim_window_closed: 409,
  validation_failed: 422,
  region_unresolved: 422,
  rate_limited: 429,
  db_error: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  unauthorized: "API 키가 없거나 유효하지 않습니다.",
  sandbox_requires_test_key: "sandbox 엔드포인트는 테스트 키로만 호출할 수 있습니다.",
  property_not_found: "매물을 찾을 수 없습니다.",
  order_not_found: "발주를 찾을 수 없습니다.",
  property_inactive: "비활성 매물입니다.",
  property_pending_coverage: "아직 서비스하지 않는 지역의 매물입니다.",
  invalid_state_transition: "현재 상태에서 불가능한 요청입니다.",
  claim_window_closed: "클레임 접수 기한(완료 후 7일)이 지났습니다.",
  validation_failed: "입력값이 올바르지 않습니다.",
  region_unresolved: "주소 또는 좌표로 지역을 해석하지 못했습니다.",
  rate_limited: "요청이 너무 많습니다.",
  db_error: "일시적인 오류가 발생했습니다.",
};

export function errorResponse(
  req: Request,
  code: ErrorCode,
  opts: { message?: string; details?: string[]; headers?: Record<string, string> } = {},
): Response {
  return jsonResponse(
    req,
    ERROR_STATUS[code],
    {
      error: {
        code,
        message: opts.message ?? DEFAULT_MESSAGE[code],
        details: opts.details ?? [],
      },
    },
    opts.headers ?? {},
  );
}
