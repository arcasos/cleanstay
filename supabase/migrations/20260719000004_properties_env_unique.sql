-- properties 유니크 제약에 env 추가
--
-- 기존: UNIQUE (tenant_id, tenant_property_ref)
-- 변경: UNIQUE (tenant_id, tenant_property_ref, env)
--
-- orders는 이미 (tenant_id, tenant_ref, trigger_type, env)로 env를 포함하는데
-- properties만 빠져 있었다. 그래서 같은 테넌트가 같은 property_ref를
-- live와 test 양쪽에 가질 수 없었고, env 분리가 매물 층에서 무너져 있었다.
--
-- 실제로 test 키로 등록을 시도하면 live 매물이 200으로 반환됐다.
-- 실패가 아니라 "잘못된 성공"이라 눈에 띄지 않는다 — 20260719000003과 같은 종류다.

alter table public.properties
  drop constraint properties_tenant_id_tenant_property_ref_key;

alter table public.properties
  add constraint properties_tenant_ref_env_key
  unique (tenant_id, tenant_property_ref, env);

comment on constraint properties_tenant_ref_env_key on public.properties is
  'env를 포함한다. live와 test는 별도 데이터 공간이므로 같은 property_ref가
   양쪽에 독립적으로 존재할 수 있어야 한다.';
