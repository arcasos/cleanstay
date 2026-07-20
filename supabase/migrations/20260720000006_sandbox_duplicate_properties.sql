-- sandbox 검증 중 생긴 중복 매물 정리 (아르카 §3-2)
--
-- 같은 매물이 세 번 등록됐다. PATCH 부재 + 멱등 무반영이 겹쳐,
-- 잘못 등록된 것을 고칠 수 없어 ref 에 -v2, -v3 를 붙여 새로 만든 결과다.
-- 그 원인은 20260720000004 이후 PATCH /properties 로 해소됐다.
--
--   5ea79aa6  live  pending_coverage  ref=172808d2-...        <- 정리 대상
--   52342499  live  inactive          ref=172808d2-...-v2     <- 20260720000005 에서 처리
--   b044008a  test  active            ref=172808d2-...-v3     <- 유지. 아르카가 쓰는 것
--
-- ## 삭제하지 않는 이유
--
-- 20260720000005 와 같다. 발주가 걸려 있으면 order_events(R5 append-only)까지
-- 지워야 하고, "sandbox 검증이 live env 를 건드렸다"는 사실 자체가 감사 기록이다.
-- inactive 는 발주를 막으므로 무력화에 충분하다.
--
-- ## 참고 — 5ea79aa6 은 지금 판정하면 active 다
--
-- region_code 가 1165010800(서초동)인데 서초구는 20260720000004 에서 개방됐다.
-- 즉 이 매물의 pending_coverage 는 **개방 전 판정이 굳어 있는 상태**다.
-- PATCH 로 좌표·코드를 다시 보내면 재판정되지만, 어차피 정리 대상이라 두지 않는다.
-- 커버리지가 넓어져도 기존 매물이 자동으로 열리지 않는다는 점은 기억해 둘 것 —
-- 커버리지 확장 시 pending_coverage 매물을 일괄 재판정하는 경로가 아직 없다.
--
-- 신규 DB 에서는 0행이 갱신된다.

update public.properties
   set status = 'inactive'
 where id = '5ea79aa6-b789-4834-a4f6-029e8da6c14e';
