-- spec 002 FR-009 (Q17 "마지막 측정값"): 한 저장(트랜잭션) 안의 측정값도 순서가 갈리도록
-- measured_at 기본값을 now()(트랜잭션 시작 시각)에서 clock_timestamp()(행을 넣는 순간)로 바꾼다.
-- work_history.created_at과 같은 방식. 이미 있는 값은 그대로 둔다.
alter table public.measurement alter column measured_at set default clock_timestamp();
