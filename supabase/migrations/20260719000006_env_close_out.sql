-- env 분리 마무리 — hosts·billing_keys에 env 추가 + 교차 env 참조를 DB가 막게 한다
--
-- env 누락 버그가 세 번 연속 나왔다:
--   ① properties UNIQUE에 env 누락      (20260719000004)
--   ② 멱등/경합 재조회에 env 필터 누락   (코드)
--   ③ GET /properties/{id}에 env 필터 누락 (코드)
--
-- 셋 다 "코드가 env를 빠뜨렸다"는 같은 원인이고, 전부 실패가 아니라 잘못된 성공이라
-- 테스트를 통과했다. 규율로 막는 건 네 번째를 부를 뿐이다. DB가 거부하게 만든다.
--
-- 두 층으로 닫는다.
--   (A) hosts·billing_keys에 env를 준다. 지금은 test 발주가 live 호스트에 붙고,
--       그 호스트의 live billing_keys가 보여 sandbox 발주가 실제 결제수단을 근거로
--       billing_verified가 될 수 있다.
--   (B) 복합 FK로 env가 어긋난 참조를 원천 차단한다. 지금은 FK가 id만 보므로
--       env='test' 발주가 env='live' 매물을 가리켜도 DB가 받아준다.
--       코드 필터가 유일한 방어선이었고, 그게 세 번 뚫렸다.
--
-- 범위 판단: env 컬럼이 필요한 건 부모에서 env를 유도할 수 없는 테이블뿐이다.
--   claims·order_issues·order_events·order_access_info·payments·payouts·
--   access_info_views·property_access_info·order_offers -> orders/properties로 유도 가능
--   access_update_tokens -> property_id/order_id로 유도 가능
--   webhook_deliveries   -> order_id/claim_id로 유도 가능
--   providers 계열       -> 공급 측. 테넌트 데이터가 아니다
--   tenants              -> 두 env에 걸친다. env를 주면 안 된다
-- 중복 저장은 드리프트를 만든다. 유도 가능한 곳에는 넣지 않는다.

-- ---------------------------------------------------------------------------
-- (A) hosts · billing_keys 에 env
-- ---------------------------------------------------------------------------

-- 백필용으로 DEFAULT를 잠깐 쓰고 곧바로 뗀다.
-- DEFAULT를 남기면 호출자가 빠뜨렸을 때 조용히 live로 떨어진다(20260719000003 참조).
alter table public.hosts        add column env text not null default 'live';
alter table public.billing_keys add column env text not null default 'live';

alter table public.hosts        alter column env drop default;
alter table public.billing_keys alter column env drop default;

alter table public.hosts
  add constraint hosts_env_check check (env in ('live','test'));
alter table public.billing_keys
  add constraint billing_keys_env_check check (env in ('live','test'));

comment on column public.hosts.env is
  'live | test. DEFAULT 없음 — 호출자가 반드시 명시.';
comment on column public.billing_keys.env is
  'live | test. DEFAULT 없음 — 호출자가 반드시 명시.
   host_id가 env를 함축하지만, 복합 FK로 정합을 강제하기 위해 컬럼을 갖는다.';

-- ---------------------------------------------------------------------------
-- hosts 자연키에 env 포함
--
-- ⚠️ 아래 데이터 정합보다 먼저 와야 한다. 기존 제약은 (tenant_id, tenant_host_ref)라
--    같은 ref의 test 호스트를 만들 수 없다.
-- ---------------------------------------------------------------------------

alter table public.hosts
  drop constraint hosts_tenant_id_tenant_host_ref_key;
alter table public.hosts
  add constraint hosts_tenant_ref_env_key
  unique (tenant_id, tenant_host_ref, env);

-- billing_keys의 host별 active 부분 유니크는 그대로 둔다.
-- host_id가 이미 env를 함축하므로 env를 더해도 의미가 바뀌지 않는다.

-- ---------------------------------------------------------------------------
-- 데이터 정합 — test env 자식이 참조하는 호스트를 test 호스트로 분기
--
-- 신규 DB에서는 아무 행도 없어 no-op다. 기존 dev DB에는 검증 잔여물이 있고,
-- 그대로 두면 아래 복합 FK가 걸린다.
-- ---------------------------------------------------------------------------

insert into public.hosts (tenant_id, tenant_host_ref, display_name, phone, email, status, env)
select distinct h.tenant_id, h.tenant_host_ref, h.display_name, h.phone, h.email, h.status, 'test'
from public.hosts h
where h.env = 'live'
  and (exists (select 1 from public.properties p where p.host_id = h.id and p.env = 'test')
       or exists (select 1 from public.orders o where o.host_id = h.id and o.env = 'test'));

update public.properties p
set host_id = th.id
from public.hosts lh
join public.hosts th
  on th.tenant_id = lh.tenant_id and th.tenant_host_ref = lh.tenant_host_ref and th.env = 'test'
where p.host_id = lh.id and lh.env = 'live' and p.env = 'test';

update public.orders o
set host_id = th.id
from public.hosts lh
join public.hosts th
  on th.tenant_id = lh.tenant_id and th.tenant_host_ref = lh.tenant_host_ref and th.env = 'test'
where o.host_id = lh.id and lh.env = 'live' and o.env = 'test';

-- ---------------------------------------------------------------------------
-- (B) 복합 FK — env가 어긋난 참조를 DB가 거부하게 한다
--
-- (id, env) 유니크가 있어야 복합 FK의 참조 대상이 될 수 있다.
-- id가 이미 PK라 이 유니크는 중복이지만, FK 대상으로 필요하다.
-- ---------------------------------------------------------------------------

alter table public.hosts      add constraint hosts_id_env_key      unique (id, env);
alter table public.properties add constraint properties_id_env_key unique (id, env);

-- properties.host_id -> hosts
alter table public.properties drop constraint properties_host_id_fkey;
alter table public.properties
  add constraint properties_host_env_fkey
  foreign key (host_id, env) references public.hosts (id, env) on delete restrict;

-- billing_keys.host_id -> hosts
alter table public.billing_keys drop constraint billing_keys_host_id_fkey;
alter table public.billing_keys
  add constraint billing_keys_host_env_fkey
  foreign key (host_id, env) references public.hosts (id, env) on delete cascade;

-- orders.host_id -> hosts
alter table public.orders drop constraint orders_host_id_fkey;
alter table public.orders
  add constraint orders_host_env_fkey
  foreign key (host_id, env) references public.hosts (id, env) on delete restrict;

-- orders.property_id -> properties
alter table public.orders drop constraint orders_property_id_fkey;
alter table public.orders
  add constraint orders_property_env_fkey
  foreign key (property_id, env) references public.properties (id, env) on delete restrict;

comment on constraint orders_property_env_fkey on public.orders is
  'env를 포함한 복합 FK. env가 어긋난 참조를 DB가 거부한다 —
   코드의 env 필터가 유일한 방어선이 되지 않도록.';
