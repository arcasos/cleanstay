// 공급자 검증 — 사업자 진위확인 / 본인인증
//
// ⚠️ 지금은 **스텁이다.** 공공데이터포털 API 키가 아직 없다.
//
// ## 경계
//
// 이 모듈의 **반환 타입이 계약**이다. 스텁이든 실제 호출이든 호출부는 같은 형태만
// 본다. 나중에 실제 호출로 바꿀 때 이 파일 안쪽만 고치고 호출부는 건드리지 않는다.
//
// ## 스텁이 위험한 지점
//
// 결과가 틀리는 것이 아니라 **검증된 것처럼 보이는 것**이다.
// 그래서 모든 반환값에 `source` 를 넣는다. 이 값이 컬럼과 원장에 함께 기록되고,
// 운영자 승인 화면은 `source === "stub"` 이면 경고를 띄운다.
//
// 그리고 **스텁이 무조건 valid 를 주지 않는다.** 사업자등록번호 체크섬은 실제로
// 계산한다. 형식이 틀리면 invalid 다. 그래야 스텁 상태에서도 입력 검증 경로가
// 함께 검증된다 — 전부 통과시키는 스텁은 아무것도 확인해주지 않는다.

export type VerifySource = "stub" | "nts" | "pass";

export interface BusinessVerifyResult {
  /** 진위확인 결과. 번호·대표자·개업일이 일치하는가. */
  valid: boolean;
  /** 사업 상태. 계속사업자만 승인 후보다. */
  bizStatus: "active" | "closed" | "suspended_tax" | null;
  source: VerifySource;
  checkedAt: string;
  /** 사람이 읽을 사유. 반려 안내에 그대로 쓴다. */
  reason: string;
}

export interface IdentityVerifyResult {
  verified: boolean;
  source: VerifySource;
  checkedAt: string;
  reason: string;
}

/**
 * 사업자등록번호 체크섬.
 *
 * 국세청 표준 알고리즘이다. API 없이도 **형식적으로 불가능한 번호**는 걸러낸다.
 * 가중치 [1,3,7,1,3,7,1,3,5] 를 앞 9자리에 곱해 더하고,
 * 9번째 자리는 5를 곱한 값의 십의 자리를 추가로 더한 뒤,
 * (10 - 합%10) % 10 이 마지막 자리와 같아야 한다.
 */
export function isValidBusinessNo(bizNo: string): boolean {
  if (!/^[0-9]{10}$/.test(bizNo)) return false;

  // 전부 0 인 번호는 체크섬을 통과한다(합=0, 검증숫자=0). 알고리즘상 맞지만
  // 실재할 수 없는 번호다. 스텁이 이걸 valid 로 넘기면 "검증했다"는 인상만 남는다.
  if (/^0{10}$/.test(bizNo)) return false;

  const d = bizNo.split("").map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * w[i];
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 사업자 진위확인 + 상태조회.
 *
 * 실제 구현 시 국세청 두 API 를 호출한다:
 *   · 사업자등록정보 진위확인 — 번호+대표자+개업일 일치 여부
 *   · 사업자등록 상태조회     — 계속사업자 / 휴업 / 폐업
 * 일일 호출 한도가 있으므로 결과를 캐시해야 한다(시드 §14 A).
 */
export async function verifyBusiness(input: {
  businessNo: string;
  repName: string;
  openDate: string;
}): Promise<BusinessVerifyResult> {
  const apiKey = Deno.env.get("NTS_API_KEY");

  if (!apiKey) {
    // --- 스텁 경로 ---------------------------------------------------------
    // 체크섬만 본다. 대표자·개업일은 확인할 방법이 없다.
    const checksumOk = isValidBusinessNo(input.businessNo);
    return {
      valid: checksumOk,
      // 국세청에 묻지 않았으므로 사업 상태를 **모른다.** active 라고 하면 거짓말이다.
      bizStatus: null,
      source: "stub",
      checkedAt: nowIso(),
      reason: checksumOk
        ? "국세청 미검증. 사업자등록번호 체크섬만 확인했다. 대표자·개업일·휴폐업 여부는 확인되지 않았다."
        : "사업자등록번호 체크섬이 올바르지 않다.",
    };
  }

  // --- 실제 호출 경로 (API 키 확보 후 구현) ---------------------------------
  // 반환 타입은 위와 동일하다. 호출부는 바뀌지 않는다.
  throw new Error(
    "NTS_API_KEY 가 설정됐으나 국세청 연동이 아직 구현되지 않았다. " +
      "verify.ts 의 실제 호출 경로를 구현할 것.",
  );
}

/**
 * 본인인증 (개인 공급자).
 *
 * 실제 구현 시 PASS/휴대폰 인증 + 계좌 실명확인을 붙인다.
 */
export async function verifyIdentity(input: {
  phone: string;
  name: string;
}): Promise<IdentityVerifyResult> {
  const provider = Deno.env.get("IDENTITY_VERIFY_PROVIDER");

  if (!provider) {
    // 스텁은 통과시키지 않는다. 본인인증은 체크섬처럼 형식으로 갈음할 수 있는
    // 것이 없다 — 통과시키면 아무나 개인 공급자가 된다.
    // 운영자가 수동 확인 후 승인하는 경로(§13 #10)로 보낸다.
    return {
      verified: false,
      source: "stub",
      checkedAt: nowIso(),
      reason:
        "본인인증 연동이 없다. 운영자가 수동으로 확인한 뒤 승인해야 한다.",
    };
  }

  throw new Error(
    "IDENTITY_VERIFY_PROVIDER 가 설정됐으나 본인인증 연동이 아직 구현되지 않았다.",
  );
}

/** 검증 결과를 운영자 화면에 띄울 경고로 바꾼다. null 이면 경고 없음. */
export function verificationWarning(
  source: string | null,
): { code: string; message: string } | null {
  if (source !== "stub") return null;
  return {
    code: "unverified_stub",
    message:
      "국세청 미검증 — 수동 확인 필요. 이 결과는 형식 검사만 거쳤으며 " +
      "대표자·개업일·휴폐업 여부는 확인되지 않았습니다.",
  };
}
