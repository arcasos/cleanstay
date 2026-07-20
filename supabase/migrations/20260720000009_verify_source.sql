-- 검증 출처(source) 추적 — 스텁 결과를 "검증된 것"처럼 보이지 않게 한다
--
-- 공공데이터포털 API 키가 아직 없어 사업자 진위확인·상태조회를 스텁으로 둔다.
--
-- ## 스텁의 진짜 위험
--
-- 결과가 틀리는 것이 아니다. **검증된 것처럼 보이는 것**이다.
-- 운영자 승인 화면에 `biz_verify_status = valid` 만 뜨면, 그게 국세청이 확인한
-- 것인지 우리가 형식만 보고 통과시킨 것인지 구분할 수 없다. 운영자는
-- "verified" 라는 글자만 보고 승인한다.
--
-- 그래서 출처를 **컬럼으로** 남긴다. provider_events.metadata 에만 두면
-- 화면이 최신 이벤트를 찾아 들어가야 해서 실무상 안 쓰인다.
--   · 컬럼   = 현재 상태. 운영자 화면이 바로 읽고 경고를 띄운다
--   · 이벤트 = 이력. 감사와 재검증 대상 추출에 쓴다
-- orders 가 status 와 order_events 를 함께 갖는 것과 같은 구조다.

alter table public.providers
  add column biz_verify_source      text,
  add column identity_verify_source text;

alter table public.providers
  add constraint providers_biz_verify_source_check
  check (biz_verify_source is null or biz_verify_source in ('stub', 'nts'));

alter table public.providers
  add constraint providers_identity_verify_source_check
  check (identity_verify_source is null or identity_verify_source in ('stub', 'pass'));

comment on column public.providers.biz_verify_source is
  '사업자 진위확인의 출처. stub = 국세청 미검증(형식·체크섬만 확인).
   nts = 국세청 API 확인. 운영자 승인 화면은 stub 일 때 경고를 띄워야 한다.';
comment on column public.providers.identity_verify_source is
  '본인인증의 출처. stub = 미검증. pass = PASS/휴대폰 인증 완료.';

-- ---------------------------------------------------------------------------
-- 재검증 대상
--
-- API 키가 나온 뒤 다시 확인해야 할 공급자들이다.
-- 컬럼과 이벤트 양쪽을 본다 — 컬럼은 현재 상태라 빠르고, 이벤트는
-- "스텁으로 검증된 적이 있는가"라는 이력 질문에 답한다.
-- 컬럼이 나중에 덮여도 이벤트는 남으므로 누락이 없다.
-- ---------------------------------------------------------------------------

create or replace view public.providers_needing_reverification as
select
  p.id,
  p.type,
  p.status,
  p.display_name,
  p.business_no,
  p.biz_verify_status,
  p.biz_verify_source,
  p.identity_verify_source,
  p.biz_verified_at,
  -- 스텁으로 검증된 이력이 있는가. 컬럼이 덮여도 이건 남는다.
  exists (
    select 1 from public.provider_events e
    where e.provider_id = p.id
      and e.event = 'verified'
      and e.metadata->>'source' = 'stub'
  ) as had_stub_verification
from public.providers p
where p.biz_verify_source = 'stub'
   or p.identity_verify_source = 'stub'
   or exists (
     select 1 from public.provider_events e
     where e.provider_id = p.id
       and e.event = 'verified'
       and e.metadata->>'source' = 'stub'
   );

comment on view public.providers_needing_reverification is
  '공공데이터포털 API 키 확보 후 재검증해야 할 공급자.
   스텁으로 통과시킨 건들이다. 실제 검증으로 바꾸면 이 뷰가 비어야 한다.';

grant select on public.providers_needing_reverification to service_role;
