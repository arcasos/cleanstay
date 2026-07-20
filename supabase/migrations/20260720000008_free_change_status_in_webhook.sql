-- webhook payload 에도 free_change_status 를 넣는다 (아르카 §5)
--
-- ## 왜 필요한가
--
-- 아르카는 호스트 화면을 **webhook 미러**로 그린다. API 응답에만 상태를 주면
-- 화면을 그리는 쪽에는 여전히 free_change_until 밖에 없다. 같은 분기 문제가 남는다.
--
-- ## 왜 저장하지 않고 payload 에만 넣는가
--
-- 이 값은 시간 함수다 — until 은 시간이 지나면 expired 가 된다.
-- 컬럼으로 저장하면 즉시 낡고, 갱신하려면 cron 이 또 필요하다.
-- payload 는 "발생 시점의 스냅샷"이라는 성격이 이미 있으므로 그 안에서는 정합하다.
--
-- ⚠️ 수신 측 주의: payload 의 free_change_status 는 occurred_at 기준이다.
--    호스트 화면을 실시간으로 그린다면 free_change_until 로 다시 계산해야 한다.
--    이 주의는 OpenAPI 에 명시한다.

create or replace function public.webhook_order_payload(p_order_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'order_id',          o.id,
    'tenant_ref',        o.tenant_ref,
    'property_id',       o.property_id,
    'status',            o.status,
    'trigger_type',      o.trigger_type,
    'priority',          o.priority,
    'checkin_at',        o.checkin_at,
    'checkout_at',       o.checkout_at,
    'next_checkin_at',   o.next_checkin_at,
    'deadline_at',       o.deadline_at,
    'scheduled_at',      o.scheduled_at,
    'arrival_at',        o.arrival_at,
    'auto_confirm_at',   o.auto_confirm_at,
    'charge_amount',     o.charge_amount,
    'charged_at',        o.charged_at,
    'fault',             o.fault,
    'free_change_until', o.free_change_until,
    -- 배차 전 null = 언제든 무보상. 시한 경과도 값은 과거 시각 그대로 유지한다 —
    -- 지우면 "언제까지였는지"가 사라져 호스트에게 설명할 수 없다.
    'free_change_status',
      case
        when o.free_change_until is null then 'unlimited'
        when now() <= o.free_change_until then 'until'
        else 'expired'
      end,
    'failure_code',      o.failure_code,
    'failure_reason',    o.failure_reason,
    'cancel_reason',     o.cancel_reason,
    'sequence',          o.sequence,
    'updated_at',        o.updated_at,
    'amounts', jsonb_build_object(
      'base_amount',    o.base_amount,
      'urgent_premium', o.urgent_premium,
      'charge_amount',  o.charge_amount
    ),
    'access_info', jsonb_build_object(
      'status', case when exists (
          select 1 from public.property_access_info a where a.property_id = o.property_id
        ) then 'registered' else 'not_registered' end
    )
  )
  from public.orders o where o.id = p_order_id;
$$;
