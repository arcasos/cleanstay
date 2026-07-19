-- env DEFAULT 제거 — 누락 시 조용히 live로 떨어지는 것을 막는다.
-- 실패가 아니라 "잘못된 성공"이라 눈에 띄지 않는 종류의 버그다.
-- sandbox 테스트 발주가 live 배차 큐에 섞여 실제 공급자에게 오퍼가 나가는 시나리오이며,
-- 발견될 때쯤이면 이미 사고다.
-- EF가 아직 없어 DEFAULT에 의존하는 코드가 하나도 없는 지금이 가장 싸다.
--
-- tenant_api_keys.env는 DEFAULT를 유지한다. 키 발급은 운영자가 하는 일이고
-- 실수해도 즉시 드러난다.

alter table public.orders     alter column env drop default;
alter table public.properties alter column env drop default;

comment on column public.orders.env is
  'live | test. DEFAULT 없음 — 호출자가 반드시 명시해야 한다.
   누락 시 not-null 위반으로 즉시 실패하는 것이 의도된 동작이다.';
comment on column public.properties.env is
  'live | test. DEFAULT 없음 — 호출자가 반드시 명시.';
