-- webhook 발송 파이프라인
--
-- ## 트리거 경로 선택 — DB 트리거로 간다
--
-- EF에서 명시적으로 넣는 쪽이 제어는 명확하지만, "이벤트를 쌓을 때마다 webhook 행도
-- 만들어야 한다"를 사람이 기억해야 한다. env 누락이 세 번 연속 나온 것과 같은 구조다.
-- 새 EF(취소·클레임·배차 엔진)를 쓸 때마다 같은 실수의 기회가 생긴다.
--
-- 트리거는 원장과 같은 트랜잭션에서 돈다. order_events에 행이 쌓였는데 webhook이
-- 안 생기는 상태가 원천적으로 불가능하다. 원장이 이미 append-only(R5)이므로
-- "이벤트 = 사실"이라는 성질을 그대로 물려받는다.
--
-- 대가는 매핑이 SQL에 산다는 것이다. 상태→이벤트명 매핑은 스펙에 고정돼 있고
-- 자주 바뀌지 않으므로 감수한다.

-- ---------------------------------------------------------------------------
-- 상태 -> webhook 이벤트명
--
-- 매핑이 없는 상태는 발송하지 않는다:
--   created      발주 생성. 테넌트가 방금 요청한 것이므로 알릴 것이 없다
--   broadcasting 내부 진행 상태
--   paid_out     공급자 지급. 스펙상 테넌트에 통지하지 않는다
-- ---------------------------------------------------------------------------

create or replace function public.webhook_event_for(p_status public.order_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'billing_verified' then 'order.dispatch_unblocked'
    when 'accepted'         then 'order.dispatched'
    when 'backup_dispatch'  then 'order.dispatched'
    when 'in_progress'      then 'order.in_progress'
    when 'completed'        then 'order.completed'
    when 'confirmed'        then 'order.confirmed'
    when 'charged'          then 'order.charged'
    when 'cancelled'        then 'order.cancelled'
    when 'failed'           then 'order.failed'
    when 'escalated'        then 'order.failed'
    when 'reassigning'      then 'order.failed'
    else null
  end;
$$;

/** order.failed 의 세부 단계. 그 외에는 null. */
create or replace function public.webhook_stage_for(p_status public.order_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'escalated'   then 'escalated'
    when 'reassigning' then 'reassigning'
    when 'failed'      then 'final'
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 발주 payload
--
-- 테넌트에게 노출되는 필드만 담는다. provider_id·payout_gross 같은 내부 필드는
-- 넣지 않는다. 출입 정보 값은 어떤 경우에도 반환하지 않으며 상태만 알린다.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 트리거 — order_events INSERT 시 webhook_deliveries 행 생성
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
  v_event := public.webhook_event_for(new.to_status);
  if v_event is null then
    return new;  -- 통지 대상이 아닌 상태
  end if;

  select * into v_order from public.orders where id = new.order_id;
  if not found then
    return new;
  end if;

  -- webhook_url 이 없는 테넌트는 큐에 넣지 않는다.
  -- 넣어두면 영원히 실패하다 dead가 되어 원장을 오염시킨다.
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
    now()          -- 즉시 발송 대상
  );

  return new;
end;
$$;

create trigger order_events_enqueue_webhook
  after insert on public.order_events
  for each row execute function public.enqueue_webhook_delivery();

-- ---------------------------------------------------------------------------
-- 재시도 백오프 — 1m, 5m, 15m, 1h, 6h, 24h. 6회 후 dead.
-- ---------------------------------------------------------------------------

create or replace function public.webhook_backoff(p_attempt int)
returns interval
language sql
immutable
as $$
  select case p_attempt
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '15 minutes'
    when 4 then interval '1 hour'
    when 5 then interval '6 hours'
    else        interval '24 hours'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 워커가 집어갈 행을 잠그고 반환한다
--
-- 두 가지를 동시에 해결한다.
--
-- (1) 중복 발송 — FOR UPDATE SKIP LOCKED 로 다른 워커가 잡은 행을 건너뛴다.
--     다만 행 잠금은 이 함수의 트랜잭션이 끝나면 풀린다. 워커가 HTTP를 보내는
--     동안은 잠금이 없으므로, claim 시점에 next_retry_at 을 리스 기간만큼 밀어
--     그 사이 다른 워커가 집지 못하게 한다. 워커가 죽으면 리스 만료 후 재시도된다.
--
-- (2) 순서 보장 — 같은 order_id 에 더 낮은 sequence 가 아직 미완료(pending·failed)면
--     이 행을 내보내지 않는다. sequence 3이 재시도 대기 중인데 4가 먼저 나가면
--     수신 측이 4를 처리한 뒤 3을 "작거나 같으면 무시" 규칙으로 버린다.
-- ---------------------------------------------------------------------------

create or replace function public.claim_webhook_deliveries(
  p_limit int default 20,
  p_lease interval default interval '1 minute'
)
returns table (
  id uuid,
  tenant_id uuid,
  event text,
  sequence int,
  payload jsonb,
  attempt smallint,
  webhook_url text,
  webhook_secret text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select d.id
    from public.webhook_deliveries d
    where d.status in ('pending', 'failed')
      and (d.next_retry_at is null or d.next_retry_at <= now())
      and not exists (
        select 1 from public.webhook_deliveries e
        where e.order_id is not null
          and e.order_id = d.order_id
          and e.sequence < d.sequence
          and e.status in ('pending', 'failed')
      )
    order by d.order_id, d.sequence, d.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.webhook_deliveries w
       set attempt       = w.attempt + 1,
           -- 리스. 이 시간 안에 결과가 보고되지 않으면 다시 대상이 된다.
           next_retry_at = now() + p_lease
      from candidate c
     where w.id = c.id
     returning w.id, w.tenant_id, w.event, w.sequence, w.payload, w.attempt
  )
  select c.id, c.tenant_id, c.event, c.sequence, c.payload, c.attempt,
         t.webhook_url, t.webhook_secret
    from claimed c
    join public.tenants t on t.id = c.tenant_id
   order by c.sequence;
end;
$$;

-- ---------------------------------------------------------------------------
-- 발송 결과 기록
--
-- 4xx 는 재시도하지 않는다. 요청 자체가 잘못됐다는 뜻이므로 같은 요청을 다시
-- 보내도 결과가 같다. 즉시 dead 로 보내고 사람이 보게 한다.
-- 5xx·타임아웃은 일시적일 수 있으므로 백오프 후 재시도한다.
-- ---------------------------------------------------------------------------

create or replace function public.complete_webhook_delivery(
  p_id uuid,
  p_ok boolean,
  p_status_code int default null,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt smallint;
  v_status  text;
begin
  select attempt into v_attempt from public.webhook_deliveries where id = p_id;
  if v_attempt is null then
    return null;  -- 없는 행. 조용히 무시한다.
  end if;

  if p_ok then
    v_status := 'delivered';
    update public.webhook_deliveries
       set status = v_status, delivered_at = now(),
           last_status_code = p_status_code, last_error = null,
           next_retry_at = null
     where id = p_id;

  elsif p_status_code between 400 and 499 then
    v_status := 'dead';
    update public.webhook_deliveries
       set status = v_status, last_status_code = p_status_code,
           last_error = coalesce(p_error, '4xx — 재시도하지 않는다'),
           next_retry_at = null
     where id = p_id;

  elsif v_attempt >= 6 then
    v_status := 'dead';
    update public.webhook_deliveries
       set status = v_status, last_status_code = p_status_code,
           last_error = coalesce(p_error, '재시도 6회 초과'),
           next_retry_at = null
     where id = p_id;

  else
    v_status := 'failed';
    update public.webhook_deliveries
       set status = v_status, last_status_code = p_status_code,
           last_error = p_error,
           next_retry_at = now() + public.webhook_backoff(v_attempt)
     where id = p_id;
  end if;

  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- GRANT — R3. service_role 만 호출한다. 워커 EF 전용이다.
-- ---------------------------------------------------------------------------

revoke all on function public.claim_webhook_deliveries(int, interval) from public, anon, authenticated;
revoke all on function public.complete_webhook_delivery(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(int, interval) to service_role;
grant execute on function public.complete_webhook_delivery(uuid, boolean, int, text) to service_role;

-- 순서 판정 subquery가 매번 도는 인덱스.
create index if not exists webhook_order_seq_idx
  on public.webhook_deliveries (order_id, sequence)
  where status in ('pending', 'failed');
