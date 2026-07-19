-- webhook 파이프라인 — cron 배선 · 하트비트 · 시각 기준 만료
--
-- 지금까지는 발송 논리만 있고 주기 실행 주체가 없었다. webhook 행이 쌓이기만 하고
-- 나가지 않는 상태였다. 여기서 네 가지를 붙인다.
--
--   (1) cron 1분 주기 — 백오프 최소 단위가 1분이므로 그보다 촘촘할 이유가 없다
--   (2) 워커 토큰을 vault 로 — cron.job.command 는 평문으로 조회된다
--   (3) 하트비트 — pg_net 은 fire-and-forget 이라 호출 실패가 묻힌다
--   (4) 시각 기준 만료 — Free 티어 일시정지 후 밀린 것이 한꺼번에 나가는 것을 막는다

-- ---------------------------------------------------------------------------
-- (4) 시각 기준 만료
--
-- attempt 6회만으로는 부족하다. 프로젝트가 7일 정지됐다 재개되면 그동안 쌓인 행이
-- 전부 next_retry_at 만료 상태로 한꺼번에 나간다. 일주일 지난 order.dispatched 를
-- 지금 받는 것은 도움이 아니라 방해다 — 이미 끝난 청소에 대해 테넌트가 동작한다.
--
-- 48시간으로 잡는다. 백오프가 6회를 소진하는 데 1m+5m+15m+1h+6h+24h ≈ 31시간이
-- 걸리므로, 그보다 짧으면 정상 재시도 중인 건을 죽인다. 48시간이면 정상 재시도는
-- 끝까지 가고 며칠짜리 정지는 걸러진다.
--
-- ⚠️ 이 값은 §13 성격의 임계값이다. 운영 데이터가 쌓이면 재검토한다.
-- ---------------------------------------------------------------------------

create or replace function public.webhook_max_age()
returns interval
language sql
immutable
as $$ select interval '48 hours' $$;

comment on function public.webhook_max_age() is
  '이 시간을 넘긴 이벤트는 발송하지 않고 dead 로 보낸다.
   백오프 6회 소진(약 31시간)보다 길어야 정상 재시도를 죽이지 않는다.';

create or replace function public.expire_stale_webhooks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  update public.webhook_deliveries
     set status = 'dead',
         next_retry_at = null,
         last_error = format(
           '발생 후 %s 경과로 만료. 발송하지 않았다.', public.webhook_max_age()::text)
   where status in ('pending', 'failed')
     and occurred_at < now() - public.webhook_max_age();
  get diagnostics v_count = row_count;

  if v_count > 0 then
    raise warning 'webhook: 만료로 dead 처리 %건', v_count;
  end if;
  return v_count;
end;
$$;

-- claim 단계에서도 만료된 행은 집지 않는다.
-- expire 크론과 워커 사이의 틈에서 오래된 건이 나가는 것을 막는다.
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
      and d.occurred_at >= now() - public.webhook_max_age()
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
-- (3) 하트비트
--
-- pg_net 은 fire-and-forget 이라 호출이 실패해도 cron 은 성공으로 끝난다.
-- cron.job_run_details 를 봐도 "http_post 를 호출했다"까지만 알 수 있고
-- EF 가 실제로 돌았는지는 알 수 없다.
--
-- 그래서 워커가 스스로 흔적을 남긴다. 이 값이 오래됐다는 것은 다음 중 하나가
-- 깨졌다는 뜻이다: cron 이 안 돔 / pg_net 이 못 나감 / EF 가 죽음 / 토큰 불일치.
-- 어느 쪽이든 사람이 봐야 한다.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_worker_heartbeat (
  id            boolean primary key default true,
  last_run_at   timestamptz not null default now(),
  last_summary  jsonb       not null default '{}'::jsonb,
  constraint webhook_worker_heartbeat_single check (id)
);

grant select, insert, update on public.webhook_worker_heartbeat to service_role;
alter table public.webhook_worker_heartbeat enable row level security;

create policy webhook_worker_heartbeat_service on public.webhook_worker_heartbeat
  for all to service_role using (true) with check (true);

create or replace function public.record_webhook_worker_run(p_summary jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.webhook_worker_heartbeat (id, last_run_at, last_summary)
  values (true, now(), p_summary)
  on conflict (id) do update
    set last_run_at = now(), last_summary = excluded.last_summary;
$$;

-- ---------------------------------------------------------------------------
-- 상태 점검
--
-- 운영자 알림 경로가 아직 없으므로 Postgres 로그로 흘린다.
-- Supabase 대시보드 Logs 에서 보인다.
-- ---------------------------------------------------------------------------

create or replace function public.webhook_pipeline_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'worker_last_run_at',  (select last_run_at from public.webhook_worker_heartbeat),
    'worker_silent_for',   (select (now() - last_run_at)::text from public.webhook_worker_heartbeat),
    -- 워커가 돌고 있다면 5분 넘게 밀린 건이 있을 수 없다.
    'overdue',             (select count(*) from public.webhook_deliveries
                             where status in ('pending','failed')
                               and next_retry_at < now() - interval '5 minutes'),
    'pending',             (select count(*) from public.webhook_deliveries where status = 'pending'),
    'failed',              (select count(*) from public.webhook_deliveries where status = 'failed'),
    'dead_24h',            (select count(*) from public.webhook_deliveries
                             where status = 'dead' and created_at > now() - interval '24 hours'),
    'healthy',             (select coalesce(
                             (select last_run_at > now() - interval '5 minutes'
                                from public.webhook_worker_heartbeat), false))
  );
$$;

create or replace function public.check_webhook_pipeline()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h jsonb;
begin
  h := public.webhook_pipeline_health();

  if not (h->>'healthy')::boolean then
    raise warning 'webhook 워커가 멈췄다 — 마지막 실행 % 전, 밀린 건 %건. cron/pg_net/EF/토큰을 확인하라. %',
      coalesce(h->>'worker_silent_for', '(기록 없음)'), h->>'overdue', h;
  elsif (h->>'overdue')::int > 0 then
    raise warning 'webhook 워커는 돌고 있으나 %건이 5분 넘게 밀렸다. %', h->>'overdue', h;
  end if;
end;
$$;

revoke all on function public.expire_stale_webhooks() from public, anon, authenticated;
revoke all on function public.record_webhook_worker_run(jsonb) from public, anon, authenticated;
revoke all on function public.webhook_pipeline_health() from public, anon, authenticated;
grant execute on function public.record_webhook_worker_run(jsonb) to service_role;
grant execute on function public.webhook_pipeline_health() to service_role;

-- ---------------------------------------------------------------------------
-- (1)(2) cron 배선
--
-- ⚠️ 토큰과 URL 은 이 파일에 없다. vault 에서 이름으로 꺼낸다.
--    cron.job.command 는 평문으로 조회되므로 여기에 토큰을 박으면
--    DB 읽기 권한만으로 워커를 호출할 수 있게 된다.
--
--    배포 전에 아래를 한 번 실행해 두어야 한다(값은 커밋하지 않는다):
--      select vault.create_secret('<워커 URL>',   'webhook_worker_url');
--      select vault.create_secret('<워커 토큰>',  'webhook_worker_token');
--
--    시크릿이 없으면 http_post 가 url := null 로 불려 조용히 실패한다.
--    그래서 시크릿 존재 여부를 먼저 확인하고 없으면 경고를 남긴다.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_webhooks_via_cron()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url   text;
  v_token text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'webhook_worker_url';
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'webhook_worker_token';

  if v_url is null or v_token is null then
    raise warning 'webhook cron: vault 에 webhook_worker_url / webhook_worker_token 이 없다. 발송하지 않는다.';
    return;
  end if;

  -- pg_net 은 비동기다. 응답은 net._http_response 에 남지만 여기서 기다리지 않는다.
  -- 호출이 실제로 워커를 돌렸는지는 하트비트로 확인한다.
  perform net.http_post(
    url                  := v_url,
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'X-Worker-Token', v_token),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.dispatch_webhooks_via_cron() from public, anon, authenticated;

-- 1분 주기. 백오프 최소 단위가 1분이라 그보다 촘촘할 이유가 없다.
select cron.schedule('webhook-dispatch', '* * * * *', $$select public.dispatch_webhooks_via_cron()$$);

-- 만료 처리. 발송 경로와 분리해 워커가 죽어 있어도 큐가 무한정 자라지 않게 한다.
select cron.schedule('webhook-expire', '*/10 * * * *', $$select public.expire_stale_webhooks()$$);

-- 상태 점검. 알림 경로가 생기기 전까지는 Postgres 로그가 유일한 신호다.
select cron.schedule('webhook-health', '*/5 * * * *', $$select public.check_webhook_pipeline()$$);
