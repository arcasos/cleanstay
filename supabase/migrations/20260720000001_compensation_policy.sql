-- 무보상 시한 · 보상 산정 — 정책을 한 곳에 격리한다
--
-- §13 #13 은 24시간을 **제안값**으로 둔다. 공급자 약관과 함께 확정되기 전까지
-- 바뀔 수 있으므로, 상수를 EF 코드에 흩뿌리지 않고 여기 하나로 모은다.
-- webhook_max_age() 와 같은 패턴이다.
--
-- ⚠️ 이 파일은 **계산만** 한다. 실제 보상 청구(claims 행 생성)는 하지 않는다.
--    v0.3.1 이 명시한 대로, 정책이 확정될 때까지는 계산하되 집행하지 않는다.

-- ---------------------------------------------------------------------------
-- 무보상 변경·취소 시한의 리드타임
-- ---------------------------------------------------------------------------

create or replace function public.free_change_lead()
returns interval
language sql
immutable
as $$ select interval '24 hours' $$;

comment on function public.free_change_lead() is
  '배차 후 무보상 변경·취소가 가능한 시한의 리드타임.
   free_change_until = scheduled_at - 이 값.
   §13 #13 — 제안값이며 공급자 약관과 함께 확정된다. 바뀌면 여기만 고친다.';

-- ---------------------------------------------------------------------------
-- free_change_until 계산
--
-- 배차 전에는 null이며 언제든 무보상이다. 배차 후에는 scheduled_at - lead 다.
--
-- ⚠️ 불리한 소급 없음(v0.3.1) — 기존 값보다 앞당겨지지 않는다.
--    공급자 사유로 scheduled_at 이 앞당겨져도 호스트의 무보상 시한은 줄지 않는다.
--    호스트가 아무것도 하지 않았는데 보상 대상 구간에 들어가는 일은 없어야 한다.
--    뒤로 미뤄지는 경우는 호스트에게 유리하므로 그대로 갱신한다.
-- ---------------------------------------------------------------------------

create or replace function public.compute_free_change_until(
  p_current      timestamptz,
  p_scheduled_at timestamptz
)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_scheduled_at is null then p_current
    when p_current is null      then p_scheduled_at - public.free_change_lead()
    else greatest(p_current, p_scheduled_at - public.free_change_lead())
  end;
$$;

-- ---------------------------------------------------------------------------
-- 보상 발생 여부 미리보기
--
-- PATCH·cancel 의 dry_run 과 실제 실행이 **같은 함수**를 본다.
-- 미리보기와 실행이 다른 계산을 쓰면 "예상과 다른 청구"가 나온다.
--
-- ⚠️ estimated_amount 는 현재 항상 0이다.
--    보상 금액 정책이 §13 #5 로 미정이기 때문이다. compensation_applies 는
--    "무보상 구간을 벗어났는가"를 정확히 반영하지만, 얼마를 물릴지는 정해지지 않았다.
--    근거 없는 금액을 넣느니 0을 반환하고 정책 확정 시 여기만 고친다.
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

  -- 배차 전(scheduled_at 없음)은 언제든 무보상이다.
  -- 배차 후에는 free_change_until 을 지났는지로 판단한다.
  v_applies := o.scheduled_at is not null
               and o.free_change_until is not null
               and now() > o.free_change_until;

  return jsonb_build_object(
    'compensation_applies', v_applies,
    -- §13 #5 미정. 정책 확정 전까지 0.
    'estimated_amount',     0,
    'free_until',           o.free_change_until,
    -- 무보상 구간 안이면 귀책이 없다. 벗어난 뒤 테넌트가 바꾸면 테넌트 귀책이다.
    -- 최종 판정은 클린콜이 원장을 근거로 하며 이건 참고값이다.
    'fault',                case when v_applies then 'tenant' else 'none' end
  );
end;
$$;

revoke all on function public.compensation_preview(uuid) from public, anon, authenticated;
grant execute on function public.compensation_preview(uuid) to service_role;
grant execute on function public.compute_free_change_until(timestamptz, timestamptz) to service_role;
grant execute on function public.free_change_lead() to service_role;
