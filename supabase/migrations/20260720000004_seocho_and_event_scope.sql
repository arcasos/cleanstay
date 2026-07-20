-- 서초구 개방 + 동일 상태 이벤트의 webhook 억제

-- ---------------------------------------------------------------------------
-- 서초구(11650) 개방
-- ---------------------------------------------------------------------------

update public.region_codes set is_serviceable = true where code like '11650%';

-- ---------------------------------------------------------------------------
-- 동일 상태 이벤트는 webhook 을 발송하지 않는다
--
-- PATCH /orders/{id} 는 상태를 바꾸지 않으면서 원장에 행을 쌓는다
-- (from_status = to_status). 그런데 트리거가 to_status 만 보고 이벤트명을 정하므로,
-- accepted 상태의 발주를 PATCH 하면 order.dispatched 가 다시 나간다.
-- 배차가 다시 일어난 것처럼 보이는 가짜 통지다.
--
-- webhook 이벤트는 **상태 전이**를 알리는 것이다. 전이가 없으면 보내지 않는다.
--
-- ⚠️ 그럼 PATCH 로 바뀐 값은 테넌트가 어떻게 아는가:
--    reconciliation(GET /orders?updated_since=)이 잡는다. updated_at 이 갱신되고
--    sequence 도 오르므로(20260719000005) 대사에서 드러난다. webhook 유실 대비
--    백스톱이 원래 그 용도다.
--
--    스펙의 order.rescheduled(scheduled_at 변경 통지)는 아직 미구현이다.
--    그것도 동일 상태 이벤트라 여기서 함께 막히므로, 구현 시 to_status 가 아니라
--    "무엇이 바뀌었는가"를 근거로 이벤트명을 정하도록 트리거를 확장해야 한다.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_webhook_delivery()
returns trigger
language plpgsql
as $$
declare
  v_event   text;
  v_order   public.orders%rowtype;
  v_url     text;
begin
  -- 상태 전이가 아니면 통지 대상이 아니다.
  if new.from_status is not null and new.from_status = new.to_status then
    return new;
  end if;

  v_event := public.webhook_event_for(new.to_status);
  if v_event is null then
    return new;
  end if;

  select * into v_order from public.orders where id = new.order_id;
  if not found then
    return new;
  end if;

  select t.webhook_url into v_url from public.tenants t where t.id = v_order.tenant_id;
  if v_url is null or v_url = '' then
    return new;
  end if;

  insert into public.webhook_deliveries
    (tenant_id, order_id, event, sequence, occurred_at, payload, status, next_retry_at)
  values (
    v_order.tenant_id,
    v_order.id,
    v_event,
    v_order.sequence,
    new.at,
    jsonb_build_object(
      'event',       v_event,
      'sequence',    v_order.sequence,
      'occurred_at', new.at,
      'stage',       public.webhook_stage_for(new.to_status),
      'data',        public.webhook_order_payload(v_order.id)
    ),
    'pending',
    now()
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- property.activated — 커버리지 확장으로 매물이 열렸을 때의 통지
--
-- 발주 상태 전이가 아니므로 order_events 트리거로는 잡히지 않는다.
-- PATCH /properties 가 pending_coverage -> active 전이를 만들면 호출한다.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_property_activated(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public   -- 권한 상승 방지
as $$
declare
  v_prop public.properties%rowtype;
  v_url  text;
begin
  select * into v_prop from public.properties where id = p_property_id;
  if not found then return; end if;

  select t.webhook_url into v_url from public.tenants t where t.id = v_prop.tenant_id;
  if v_url is null or v_url = '' then return; end if;

  insert into public.webhook_deliveries
    (tenant_id, order_id, event, sequence, occurred_at, payload, status, next_retry_at)
  values (
    v_prop.tenant_id,
    null,                      -- 발주에 걸린 이벤트가 아니다
    'property.activated',
    null,                      -- 발주별 순서 개념이 적용되지 않는다
    now(),
    jsonb_build_object(
      'event',       'property.activated',
      'occurred_at', now(),
      'data', jsonb_build_object(
        'property_id',         v_prop.id,
        'tenant_property_ref', v_prop.tenant_property_ref,
        'region_code',         v_prop.region_code,
        'status',              v_prop.status
      )
    ),
    'pending',
    now()
  );
end;
$$;

revoke all on function public.enqueue_property_activated(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_property_activated(uuid) to service_role;
