-- bump_order_sequence — 테넌트에게 노출되는 필드가 바뀌면 sequence를 올린다
--
-- 기존 조건은 status 와 scheduled_at 둘뿐이었다. 그래서 completed_at 만 바뀌는
-- 전이(sandbox 시각 오버라이드, PATCH 로 next_checkin_at 만 갱신 등)는
-- order_events 에 행을 쌓으면서 sequence 는 그대로 뒀다.
--
-- 문제는 webhook 순서 판정이다. 스펙은 수신 측에 "이미 처리한 값보다 작거나 같으면
-- 무시하라"고 지시하는데, 두 이벤트가 같은 sequence 를 공유하면 두 번째가 버려진다.
-- 유실이 아니라 정상 처리로 보이므로 눈에 띄지 않는다.
--
-- 판단 기준은 "테넌트가 관측할 수 있는 변화인가"다. OrderDetail 로 나가는 필드가
-- 바뀌면 올린다. provider_id·payout_gross 같은 내부 필드는 제외한다 —
-- 테넌트에게 보이지 않는 변화로 webhook 을 만들 이유가 없다.
--
-- 한 UPDATE 는 몇 개 필드가 바뀌든 sequence 를 1만 올린다. 조건을 넓혀도
-- 중복 증가는 생기지 않는다.

create or replace function public.bump_order_sequence()
returns trigger
language plpgsql
as $function$
begin
  if new.status            is distinct from old.status
     or new.scheduled_at      is distinct from old.scheduled_at
     or new.completed_at      is distinct from old.completed_at
     or new.arrival_at        is distinct from old.arrival_at
     or new.next_checkin_at   is distinct from old.next_checkin_at
     or new.deadline_at       is distinct from old.deadline_at
     or new.free_change_until is distinct from old.free_change_until
     or new.fault             is distinct from old.fault
     or new.failure_code      is distinct from old.failure_code
     or new.failure_reason    is distinct from old.failure_reason
     or new.cancel_reason     is distinct from old.cancel_reason
     or new.charge_amount     is distinct from old.charge_amount
     or new.charged_at        is distinct from old.charged_at
  then
    new.sequence := old.sequence + 1;
  end if;
  return new;
end;
$function$;

comment on function public.bump_order_sequence() is
  '테넌트에게 노출되는 필드(OrderDetail)가 바뀌면 sequence를 1 올린다.
   webhook 순서 판정의 근거이므로, 원장에 행이 쌓이는데 sequence가 그대로면
   수신 측이 두 번째 이벤트를 중복으로 보고 버린다.
   내부 필드(provider_id, payout_gross 등)는 제외한다.';
