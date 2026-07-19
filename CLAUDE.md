# CLEANCALL — Claude Code 작업 규약

> 이 파일은 매 세션 자동으로 읽힌다. **상세 설계는 `docs/클린콜_프로젝트시드_v4.md`(SSOT)를 참조**하되,
> 아래 "절대 규칙"은 시드를 읽지 않고도 항상 지킨다.

---

## 0. 제품 한 줄

STR(단기임대) 체크아웃 청소를 자동 발주·배차하는 **API 레이어**. UI 앱이 아니라 인프라 제품(Stripe/Twilio 계열).
공개 API + webhook이 본체이고, 관리 콘솔·공급자 앱은 보조다.

수요 #1 = ARCASOS(별도 서비스, 별도 레포·별도 Supabase) / 공급 #1 = 창업자 직영 청소업.

---

## 1. 절대 규칙 (위반 시 되돌리기 비쌈)

### R1. 강제 배정 금지 — 원칙 D
플랫폼은 **오퍼를 보내고 공급자가 수락**한다. `auto_assign`, `force_assign`, "배정 완료" 같은
코드·API·UI 문구를 만들지 않는다. 이걸 어기면 공급자의 독립계약자 지위(3.3% 원천징수, 직접고용 회피)가
법적으로 무너진다. 편의상 자동 배정 경로를 추가하고 싶어지면 **먼저 사람에게 묻는다.**

### R2. 디자인 시스템 — 아르카소스 것을 쓰지 않는다
- 클린콜 = **라이트 + 파랑**, 자체 시맨틱 토큰. SSOT는 `src/index.css`의 oklch 변수.
- 아르카소스의 **Linear Dark를 재사용하지 않는다.** `design-agent` 스킬을 이 레포에 적용하지 않는다.
- 금지: 원시 Tailwind 팔레트(`bg-blue-500` 등), 하드코딩 hex, `transition-all`, `font-bold`(→ `font-semibold`까지).
- 폰트 `Noto Sans KR` 단일. 아이콘 remixicon(`ri-*`).
- primary(파랑) = 브랜드·액션·진행 / accent(초록) = 성공·완료 전용 / red·amber = 실패·경고.

### R3. Supabase 4단계 SQL
테이블을 만들 때마다 반드시 네 단계를 모두 쓴다. 하나라도 빠지면 PostgREST가 `42501`을 뱉는다.
```
(1) CREATE TABLE  (2) GRANT  (3) ALTER TABLE ... ENABLE ROW LEVEL SECURITY  (4) CREATE POLICY
```

### R4. SEC-04 — service_role EF는 caller를 자체 검증
`SUPABASE_SERVICE_ROLE_KEY`를 쓰는 Edge Function은 RLS를 우회한다.
따라서 **모든 EF는 진입 즉시 caller 신원을 검증**하고, 통과 못 한 요청은 DB에 접근하지 않는다.
- 테넌트 = API 키(`_shared/auth.ts`의 `authenticateTenant`)
- 공급자 = 세션 토큰
- service_role 키를 프론트엔드 번들에 넣지 않는다. EF 환경변수 전용.

### R5. append-only 원장
`order_events`, `provider_events`는 **UPDATE·DELETE 금지**(DB 트리거로도 막혀 있다).
상태 변화는 항상 새 행을 쌓는다. 이게 §8 보상 대사와 §14 배차정지 감사의 근거다.

### R6. 임계 플로우에 fire-and-forget 금지
배차·결제·보상·webhook은 **재시도 + reconciliation 백스톱**이 있어야 한다.
`pg_net` 단발 호출로 끝내지 않는다. (ARCASOS에서 실제로 물린 적 있는 패턴)

### R7. CORS `*` 금지
`ALLOWED_ORIGINS` 화이트리스트만. 서버 간 호출(Origin 헤더 없음)은 통과시키되 API 키로 검증한다.

### R8. 금액·시각
- 금액은 **원(KRW) 정수, bigint**. 부동소수점 금지.
- 시각은 **timestamptz**. 표시만 Asia/Seoul.

---

## 2. 스택 / 구조

```
프론트  React + TypeScript + Vite + Tailwind
백엔드  Supabase (독립 인스턴스) + Deno Edge Functions

repo/
  docs/                          시드 v4(SSOT), 디자인 애드덤
  supabase/
    migrations/                  타임스탬프 순 SQL. 적용된 마이그레이션은 수정하지 않는다.
    seed/                        region_codes 등 참조 데이터
    functions/
      _shared/                   cors.ts, auth.ts
      orders-create/             POST /v1/orders
  src/
    index.css                    ⚠️ 디자인 토큰 SSOT — 임의 수정 금지
```

**Supabase 프로젝트**: `cleancall-dev` / ref `eufiudomekvefcldglap` / ap-northeast-2 (Seoul) / Free

---

## 3. 작업 규약

- 코드 수정 후 **항상 `npx tsc --noEmit`** 통과 확인하고 결과를 보고한다.
- 이미 적용된 마이그레이션 파일은 **수정하지 않는다.** 변경은 새 마이그레이션으로 추가한다.
- 시드 문서에서 "미정"인 항목(§13)에 부딪히면 **임의로 정하지 말고 사람에게 묻는다.**
  특히 금액·기간·임계값·부담 주체.
- 커밋은 논리 단위로 쪼갠다. 한 커밋에 스키마 + EF + UI를 섞지 않는다.
- 비밀값(service_role 키, PG 키, API 키 평문)을 파일·커밋·로그에 남기지 않는다.

### 환경
Windows / PowerShell 5.1. 셸 명령은 `&&` 대신 `;`를 쓴다. 경로 구분자는 `\`.

### 커밋 전 grep 체크
```
grep -rn "bg-\(blue\|green\|red\|gray\|slate\)-[0-9]" src/     # 원시 팔레트
grep -rn "#[0-9a-fA-F]\{6\}" src/ --include="*.tsx"            # 하드코딩 hex
grep -rn "transition-all\|font-bold" src/                       # 금지 유틸
grep -rn "auto_assign\|force_assign" src/ supabase/             # 원칙 D 위반
```

---

## 4. 확정된 결정 (재논의 금지)

| 항목 | 결정 |
|---|---|
| 배차 모델 | 예약형 랭크드 오퍼 웨이브 1~4. MVP는 Wave 1 생략 가능하되 랭킹 필드는 유지 |
| 결제 흐름 | 호스트 → 클린콜 직결제(빌링키). 아르카는 청소비 흐름에 관여 안 함 |
| 결제 타이밍 | 발주 시 = 유효성 검증(청구 X) / 완료 후 = 실제 청구. 취소는 청구 자체가 없음(환불 로직 불필요) |
| 공급자 승인 (§13 #10) | **운영자 최종 승인.** 진위 valid + 계속사업자여도 `pending_review` 경유 |
| 완료 자동확정 (§13 #4) | `greatest( least(completed_at + 6h, checkin_at - 1h), completed_at + 30m )` |
| 활동지역 | 법정동코드 **접두 매칭**. 반경(km) 지오 매칭은 범위 밖 |
| 지역 범위 | 서울만(`11` 접두). 확장은 나중 |

## 5. 아직 미정 (부딪히면 물어볼 것)

`#1` 도메인 · `#3` 긴급 프리미엄 부담 주체 · `#5` claim 보상 정책 ·
`#6` 공급자 앱 형태(웹앱 권장) · `#8` PG 상담 결과 · `#9` 다크모드 시점 ·
`#11` 자동 정지 임계값 · `#12` Wave 파라미터(T1, 인원수, 인센티브)

---

## 6. 현재 상태 (2026-07-19)

> 새 개발 머신에서 이어받는 경우 **§6.4 환경 셋업**부터 읽는다.

### 6.1 완료

**DB**
- Supabase 프로젝트 (Seoul, ref `eufiudomekvefcldglap`)
- 스키마 21개 테이블, 4단계 SQL 적용
- 마이그레이션 4개, 원격 이력과 동기화됨
  | 버전 | 내용 |
  |---|---|
  | `20260718225806_remote_schema` | baseline (pg_dump 회수) |
  | `20260719000003_env_no_default` | orders/properties `env` DEFAULT 제거 |
  | `20260719000004_properties_env_unique` | properties UNIQUE에 `env` 추가 |
  | `20260719000005_sequence_bump_scope` | `bump_order_sequence` 조건 확장 |
  | `20260719000006_env_close_out` | hosts·billing_keys `env` + 복합 FK |
- `region_codes` 서울 493행 (시도 1 + 자치구 25 + 법정동 467), `supabase/seed/01_region_codes.sql`

**Edge Functions**
- `_shared/cors.ts` — R7 화이트리스트 CORS
- `_shared/auth.ts` — 테넌트 API 키 검증 (`authenticateTenant`, `issueApiKey`)
- `_shared/errors.ts` — 오류코드 ↔ HTTP 매핑
- `_shared/region.ts` — 법정동코드 해석 (카카오 `coord2regioncode`)
- `_shared/tokens.ts` — 출입정보 갱신 토큰 (property/order scope)
- `properties-create/` — `POST /v1/properties`, `GET /v1/properties/{id}`
- `orders-create/` — `POST /v1/orders` (배차 없음, `billing_verified`까지)
- `sandbox-transition/` — `POST /v1/sandbox/orders/{id}/transition` (test 키 전용)

**아직 배포 안 했다.** 전부 로컬 기동 + 실제 HTTP로만 검증했다.
`supabase functions deploy`는 수행된 적 없다.

**개발 시드** — `supabase/seed/bootstrap.ts`
테넌트 `arcasos` + API 키 2개 + **live·test 각각 호스트 1 + 매물 2** + 커버리지(강남구 `11680` 접두만 개방).

### 6.2 미완료

우선순위 순.

1. **webhook 발송 EF** — 아르카가 수신 엔드포인트를 만들고 있어 이게 없으면
   발주만 넣고 상태 변화를 못 받는다. `webhook_deliveries` 원장 기반.
   - HMAC-SHA256(secret, `"{timestamp}.{raw_body}"`)
   - 헤더 `X-Cleancall-Signature` / `-Timestamp` / `-Delivery`
   - payload에 `sequence`, `occurred_at`
   - 재시도 1m→5m→15m→1h→6h→24h, 6회 후 `dead`. 5초 타임아웃.
     4xx는 재시도 안 함, 5xx·타임아웃은 재시도
   - secret 로테이션 시 구 secret 24시간 동시 유효 (`webhook_secret_prev`)
   - **R6** — fire-and-forget 금지. cron으로 `next_retry_at` 스캔하는 백스톱 필수
2. 나머지 조회·변경 API (`GET /orders`, `PATCH`, `cancel`, `messages`, `claims`, `coverage`)
3. 배차 엔진 EF (오퍼 웨이브). **원칙 D** — 오퍼를 보내고 공급자가 수락한다
4. 공급자 온보딩 EF
5. 호스트 설정 페이지 (출입정보·결제수단 등록). 현재 토큰만 발급되고 페이지가 없다
6. 프론트 일체(랜딩 제외)

### 6.3 미해결 이슈

**`SETUP_BASE_URL` 기본값이 `https://setup.cleancall.local`이다.** §13 #1 도메인 미정.
발급된 링크가 실제로 열리지 않는다. 도메인 확정 시 EF 시크릿에 넣는다.

**dev DB에 검증 잔여물이 있다.** 발주 5건 + `order_events` 다수.
R5 append-only 트리거가 DELETE를 막아 지우려면 트리거를 일시 비활성해야 한다.

### 6.3.1 env 분리 — 닫혔다 (20260719000006)

env 누락 버그가 **세 번 연속** 나왔다. 셋 다 코드가 `env`를 빠뜨린 것이고, 전부
실패가 아니라 잘못된 성공이라 테스트를 통과했다. 규율로 막으면 네 번째가 오므로
**DB가 거부하게** 만들었다.

- `env` 컬럼 보유: `tenants`(제외) 외 → `orders`, `properties`, `hosts`,
  `billing_keys`, `tenant_api_keys`. 전부 **DEFAULT 없음**
- 자연키에 `env` 포함: `properties`, `hosts`
- **복합 FK로 교차 env 참조 차단**
  ```
  properties.(host_id, env)   -> hosts.(id, env)
  billing_keys.(host_id, env) -> hosts.(id, env)
  orders.(host_id, env)       -> hosts.(id, env)
  orders.(property_id, env)   -> properties.(id, env)
  ```

**나머지 테이블에 `env`를 넣지 않은 것은 의도다.** 부모에서 유도 가능하기 때문이다
(`claims`·`order_issues`·`order_events`·`order_access_info`·`payments`·`payouts`·
`access_info_views`·`property_access_info`·`order_offers` → `orders`/`properties`,
`access_update_tokens` → `property_id`/`order_id`, `webhook_deliveries` → `order_id`/`claim_id`).
중복 저장은 드리프트를 만든다. `providers` 계열은 공급 측이라 대상이 아니고,
`tenants`는 두 env에 걸치므로 `env`를 주면 안 된다.

⚠️ **`hosts`는 env별로 별개 행이다.** `host_test_001`이 live·test 각각 존재한다.
호스트를 조회·생성하는 코드는 반드시 `env`로 걸러야 한다.

### 6.4 환경 셋업 (새 머신에서 이어받을 때)

**1. 계정** — Supabase 프로젝트는 **`cleancall911@gmail.com`** 소유다.
`jasonjo2011@gmail.com`으로는 보이지 않고 link 시 403이 난다.
`npx supabase projects list`로 계정부터 확인한다.
브라우저 로그인은 **Claude Code 안에서 안 된다**(non-TTY, `!` 접두 포함).
별도 터미널에서 `npx supabase login --token <PAT>`.

**2. link**
```
npx supabase link --project-ref eufiudomekvefcldglap
```

**3. `.env.local`** (git 무시됨, 루트에 생성)
```
SUPABASE_URL=https://eufiudomekvefcldglap.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<대시보드 Settings > API Keys > service_role>
KAKAO_REST_API_KEY=<developers.kakao.com REST 키>
```
⚠️ PowerShell 5.1의 `Out-File -Encoding utf8`은 **BOM을 붙여 CLI가 파싱에 실패한다.**
`Set-Content -Encoding ascii`를 쓴다.

**4. 로컬 실행**
```
# 시드
deno run --allow-env --allow-net --config supabase/functions/deno.json supabase/seed/bootstrap.ts
# EF 기동 (포트 8000)
deno run --allow-env --allow-net --config supabase/functions/deno.json supabase/functions/orders-create/index.ts
```
`ALLOWED_ORIGINS`, `SETUP_BASE_URL`도 export해야 한다.

**5. 배포 시 EF 시크릿** — `SUPABASE_SERVICE_ROLE_KEY`는 자동 주입되지만
`KAKAO_REST_API_KEY` / `ALLOWED_ORIGINS` / `SETUP_BASE_URL`은 직접 넣어야 한다.
```
npx supabase secrets set KAKAO_REST_API_KEY=... ALLOWED_ORIGINS=... SETUP_BASE_URL=...
```

### 6.5 이 환경에서 물린 함정들

- **Docker가 없다.** `supabase db pull`·`db diff`는 shadow DB를 띄우느라 실패한다.
  `db push`는 Docker 없이 동작한다(카탈로그 캐싱 경고만 뜬다).
  스키마 회수는 `pg_dump`로 한다:
  ```
  pg_dump -h aws-1-ap-northeast-2.pooler.supabase.com -p 5432 \
    -U postgres.eufiudomekvefcldglap -d postgres --schema=public --schema-only --no-owner
  ```
  `--no-privileges`를 쓰면 **R3의 GRANT가 통째로 빠진다.** 쓰지 않는다.
  PG18 pg_dump가 넣는 `\restrict`/`\unrestrict`는 `grep -F`로 제거한다
  (정규식 `^\restrict`는 셸을 거치며 빗나간다 — 실제로 당했다).
- **CLI 명령에 항상 `SUPABASE_DB_PASSWORD`를 넘긴다.** 빠뜨리면 management API 경로로
  빠져 403(`LegacyDbConfigLoginRoleStatusError`)이 나는데 계정 문제로 오인하기 쉽다.
- **`curl`이 외부 HTTPS를 못 나간다**(supabase.co도 `000`). localhost는 된다.
  외부 API 검증은 `deno eval`로 한다.
- **psql `-c`에 한글을 넣으면 인코딩 오류**가 난다. heredoc을 쓰거나 ASCII로 쓴다.
- **`curl -d`로 한글 JSON을 보내면 깨진다.** 파일에 쓰고 `--data-binary @file`.
- **PostgREST 행 타입이 `never`로 추론된다**(생성된 `Database` 타입이 없어서).
  헬퍼를 추론에서 분리하고 호출부가 형태를 명시하거나 `as unknown as T`로 경유한다.

### 6.6 검증 규율

- **검증은 test 키로만 한다.** live env를 오염시키지 않는다.
- 일회용 키는 `label='tmp-verify'`로 만들고 끝나면 지운다.
- 검증 후 생성 데이터는 정리한다. 단 `order_events`는 R5로 지워지지 않는다.
- **`env` 필터를 빠뜨리지 않았는지 매번 확인한다.** 세 번 연속 나왔다:
  ① `properties` UNIQUE에 env 누락 ② 멱등/경합 재조회에 env 필터 누락
  ③ `GET /properties/{id}`에 env 필터 누락.
  전부 실패가 아니라 **"잘못된 성공"**이라 테스트가 통과해버린다.
  새 쿼리를 쓸 때마다 `env` 컬럼이 있는 테이블인지 먼저 본다(§6.3.1).
  이제 복합 FK가 교차 참조를 막지만, **조회 누락은 여전히 코드 책임이다** —
  FK는 쓰기를 막을 뿐 `SELECT`가 남의 env를 읽는 것은 막지 못한다.
- 새 EF를 쓸 때 검증 체크리스트: 조회에 `env`, 삽입에 `env`,
  **경합 재조회(23505 catch)에도 `env`**, 타 테넌트·타 env는 404.

