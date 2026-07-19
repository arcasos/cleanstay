-- 커버리지 공개 조회 — SECURITY DEFINER 함수 하나로 통일한다
--
-- ## anon grant/policy 를 추가하지 않는 이유
--
-- serviceable_regions() 가 이미 SECURITY DEFINER 이므로, anon 은 region_codes 에
-- 대한 SELECT 권한 없이도 이 함수를 통해 서비스 지역 목록을 받는다. 실측:
--
--   set role anon;
--   select count(*) from serviceable_regions();  -> 15      (통과)
--   select count(*) from region_codes;           -> denied  (권한 없음)
--
-- 여기에 `grant select on region_codes to anon` + RLS 정책을 더하면 같은 데이터에
-- 도달하는 경로가 둘이 된다. 나중에 한쪽만 고치는 사고가 난다 —
-- 예컨대 정책의 is_serviceable 조건을 바꾸고 함수를 안 고치면 두 응답이 갈린다.
--
-- 그래서 **테이블 권한은 열지 않고 함수만 연다.** 노출면도 이쪽이 좁다:
-- anon 은 우리가 반환하기로 한 컬럼만 보고, 테이블 전체를 훑을 수 없다.
--
-- ## SECURITY DEFINER 에 search_path 를 고정하는 이유
--
-- SECURITY DEFINER 함수는 **소유자(postgres) 권한으로** 실행된다. search_path 를
-- 고정하지 않으면 호출자가 자기 search_path 를 앞에 끼워 넣어, 함수 본문이
-- 참조하는 `public.region_codes` 대신 자기가 만든 동명 객체를 실행시킬 수 있다.
-- 그 코드는 postgres 권한으로 돈다 — 전형적인 권한 상승 경로다.
-- `set search_path = public` 은 그 치환을 막는다. 이 파일의 모든 SECURITY DEFINER
-- 함수에 예외 없이 붙인다.

-- ---------------------------------------------------------------------------
-- 코드 하나를 해석한다 (POST /coverage/check 전용)
--
-- 목록과 달리 **미지원 지역도 조회 대상**이다. is_serviceable=false 인 동을
-- "모르는 지역"으로 뭉개면 호스트가 왜 안 되는지 알 수 없다.
--   · 서울 안, 공급자 없는 동  -> region_code 있음 + serviceable=false
--   · 서울 밖 / 없는 코드      -> 0행 (호출부가 region_code=null 로 응답)
--
-- 반환은 해석 결과 세 컬럼뿐이다. 테이블을 훑는 경로가 열리지 않는다.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_region_public(p_code text)
returns table (region_code text, region_name text, serviceable boolean)
language sql
stable
security definer
set search_path = public   -- 권한 상승 방지. 위 주석 참조
as $$
  select r.code, r.full_name, r.is_serviceable
  from public.region_codes r
  where r.code = p_code and r.is_active;
$$;

comment on function public.resolve_region_public(text) is
  'POST /coverage/check 전용 코드 해석. 인증 없이 호출된다.
   미지원 지역도 반환한다 — "모르는 지역"과 "공급자 없는 동"은 다르다.
   SECURITY DEFINER + search_path 고정: region_codes 에 대한 테이블 권한을
   anon 에게 열지 않고 이 함수만 연다. 노출면을 세 컬럼으로 한정한다.';

revoke all on function public.resolve_region_public(text) from public;
grant execute on function public.resolve_region_public(text) to anon, authenticated, service_role;

-- serviceable_regions() 에도 같은 근거를 남긴다. 두 함수가 커버리지 공개 경로의
-- 전부이며, region_codes 에 대한 anon 테이블 권한은 존재하지 않는다.
comment on function public.serviceable_regions() is
  'GET /coverage 전용 서비스 지역 목록. 인증 없이 호출된다.
   SECURITY DEFINER + search_path 고정 — anon 에게 region_codes SELECT 를
   주지 않고 이 함수만 연다. grant/policy 를 따로 두면 같은 데이터에 이르는
   경로가 둘이 되어 한쪽만 고치는 사고가 난다.';
