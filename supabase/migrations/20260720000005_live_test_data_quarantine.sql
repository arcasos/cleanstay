-- live env 에 들어온 sandbox 테스트 데이터 격리
--
-- 아르카 sandbox 1차 검증 중 live 키(당시 라벨 `arcasos-dev`)로 발주·매물이
-- 생성됐다. 라벨이 "dev" 로 읽혀 test 키로 오인된 것이 원인이다(조치 #4에서 개명).
--
-- ## 삭제하지 않고 상태 전환하는 이유
--
-- order_events 는 append-only(R5)라 발주를 지우면 원장도 함께 지워야 한다.
-- 그리고 "live 에 테스트 데이터가 들어왔다"는 사실 자체가 감사 기록이다.
-- 지우면 사고가 없었던 것처럼 보인다. 남기고 무력화한다.
--
-- ## 신규 DB 에서는 no-op
--
-- 특정 id 를 지목하므로 다른 DB 에서는 0행이 갱신된다.

update public.orders
   set status        = 'cancelled',
       cancel_reason = 'test_data_in_live_env',
       fault         = 'tenant',
       cancelled_at  = now()
 where id = 'd1a84a14-4eb3-43db-ad5a-58b595a99cb8'
   and status not in ('cancelled', 'charged', 'paid_out');

update public.properties
   set status = 'inactive'
 where id = '52342499-ecb3-44b6-804e-4e950f84e462';
