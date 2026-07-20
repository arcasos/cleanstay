-- 멱등키에서 취소·실패 발주를 제외한다 (아르카 A-1)
--
-- ## 문제
--
-- 멱등키가 (tenant_id, tenant_ref, trigger_type, env) 전체 유니크라,
-- **취소된 발주가 키를 영구 점유**한다. 같은 예약으로 재발주가 불가능하다.
--   · 예약이 취소됐다 되살아나는 경우
--   · 운영자가 잘못 취소한 경우
-- 둘 다 막힌다. PATCH /properties 가 없던 때와 같은 구조다 —
-- 되돌릴 수 없는 상태에 갇힌다.
--
-- ## 해법
--
-- 부분 유니크 인덱스로 바꾼다. 살아 있는 발주만 키를 점유한다.
-- 취소·실패한 것은 이력으로 남되 키를 놓아준다.
--
-- 조회 쪽은 변경이 없다 — by-ref 가 이미 배열을 반환하므로
-- 같은 tenant_ref 에 여러 발주(취소된 것 + 새 것)가 그대로 나온다.
--
-- ## 왜 DB 제약을 먼저 바꿔야 하는가
--
-- EF 의 멱등 조회만 고치면 새 발주를 INSERT 하려는 순간 기존 유니크 인덱스가
-- 23505 로 막는다. 그러면 경합 재조회 경로로 빠져 취소된 발주를 그대로 반환한다 —
-- 고치기 전과 동작이 같아지고, 원인은 더 찾기 어려워진다.

drop index if exists public.orders_idempotency_idx;

create unique index orders_idempotency_idx
  on public.orders (tenant_id, tenant_ref, trigger_type, env)
  where status not in ('cancelled', 'failed');

comment on index public.orders_idempotency_idx is
  '멱등키. cancelled·failed 는 제외한다 — 종료된 발주가 키를 점유하면
   같은 예약으로 재발주할 수 없다. EF 의 멱등 조회도 같은 조건을 쓴다.';
