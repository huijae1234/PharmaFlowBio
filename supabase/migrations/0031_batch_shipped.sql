-- spec 017 FR-005·006 (plan 017 1단계): 로트 상태 "출하 완료".
-- Postgres는 enum에 새 값을 더한 같은 거래 안에서 그 값을 쓰지 못한다. 그래서 값 하나만 먼저 더하고, 쓰는 함수는 0032에 둔다.
-- 이 값만 있을 때는 어떤 함수도 로트를 이 상태로 바꾸지 않으므로 지금 동작은 그대로다.
alter type public.batch_status add value if not exists 'shipped';
