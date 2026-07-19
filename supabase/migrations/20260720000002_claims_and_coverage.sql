-- estimated_amount 를 null 로 · 클레임 접수 기한 · 커버리지 조회
--
-- (1) estimated_amount: 0 -> null
--     0은 "보상 없음"으로 읽히고 null 은 "미정"으로 읽힌다.
--     compensation_applies=true + estimated_amount=null 조합이
--     "보상은 발생하나 금액 정책이 미확정"을 정확히 표현한다(§13 #5).
--
-- (2) claim 접수 기한: 완료 보고 후 7일. 상수를 EF 에 흩뿌리지 않는다.
--
-- (3) 커버리지 조회: region_codes 에서 서비스 지역만 추려 계층으로 돌려준다.

-- ---------------------------------------------------------------------------
-- (1) estimated_amount -> null
-- ---------------------------------------------------------------------------

create or replace function public.compensation_preview(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o        public.orders%rowtype;
  v_applies boolean;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    return null;
  end if;

  v_applies := o.scheduled_at is not null
               and o.free_change_until is not null
               and now() > o.free_change_until;

  return jsonb_build_object(
    'compensation_applies', v_applies,
    -- ⚠️ §13 #5 미정이므로 null 이다. 0이 아니다 —
    --    0은 "보상 없음", null 은 "금액 미정"으로 읽힌다.
    --    보상 발생 여부는 compensation_applies 가 단독으로 나타낸다.
    'estimated_amount',     null,
    'free_until',           o.free_change_until,
    'fault',                case when v_applies then 'tenant' else 'none' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (2) 클레임 접수 기한
-- ---------------------------------------------------------------------------

create or replace function public.claim_window()
returns interval
language sql
immutable
as $$ select interval '7 days' $$;

comment on function public.claim_window() is
  '완료 보고(completed_at) 후 클레임을 접수할 수 있는 기간.
   공급자 지급도 이 기간이 지난 뒤에 이루어진다. 바뀌면 여기만 고친다.';

/**
 * 클레임 접수 가능 여부.
 *
 * confirmed·charged 이후에도 접수할 수 있다 — 확정은 청구를 진행시키는 절차일
 * 뿐이고 보상은 별도 트랙이다. 다음 게스트가 입주한 뒤 불량이 발견되는 경우를
 * 고려한 설계다. 따라서 기준은 상태가 아니라 completed_at 이다.
 */
create or replace function public.claim_window_open(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- 완료 전이면 아직 접수 대상이 아니다(청소가 끝나야 불량을 말할 수 있다).
    when o.completed_at is null then false
    else now() <= o.completed_at + public.claim_window()
  end
  from public.orders o where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- (3) 커버리지
--
-- 서비스 가능한 지역만 계층으로 돌려준다. 공급자 확보 상황에 따라 변하므로
-- 테넌트가 자체 판단 로직을 들고 있지 말고 이걸 참조해야 한다.
--
-- 레벨은 코드 형태로 결정된다 — 시도는 뒤 8자리가 0, 자치구는 뒤 5자리가 0.
-- ---------------------------------------------------------------------------

create or replace function public.serviceable_regions()
returns table (region_code text, name text, level text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when r.sigungu is null      then left(r.code, 2)
      when r.eupmyeondong is null then left(r.code, 5)
      else r.code
    end,
    r.full_name,
    case
      when r.sigungu is null      then 'city'
      when r.eupmyeondong is null then 'gu'
      else 'dong'
    end
  from public.region_codes r
  where r.is_active and r.is_serviceable
  order by r.code;
$$;

-- 커버리지는 인증 없이 열려 있다(스펙 security: []).
-- 서비스 지역 목록은 공개 정보이며, 매물 등록 전에 미리 확인하는 용도다.
grant execute on function public.serviceable_regions() to anon, authenticated, service_role;
grant execute on function public.claim_window_open(uuid) to service_role;
grant execute on function public.claim_window() to service_role;
