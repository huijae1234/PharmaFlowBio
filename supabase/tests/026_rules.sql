-- spec 026 데이터베이스 시험 (plan 026 §3 2단계). 001~008과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 실제 DB에 이미 있는 자료가 있으므로 개수는 "넣기 전과 뒤의 차이"로 본다.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  product_id uuid;
  lot_test uuid; lot_proc uuid;
  i_test uuid; i_proc uuid;
  before_qa jsonb; before_qc jsonb; before_prod jsonb;
  after_qa jsonb; after_qc jsonb; after_prod jsonb;
  today date := (now() at time zone 'Asia/Seoul')::date;
  total int := 0;
  failures text[] := '{}';
  first_time boolean; second_time boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa26@test.local', '{"full_name":"시험 QA26"}'),
    (qc, 'qc26@test.local', '{"full_name":"시험 QC26"}'),
    (prod, 'prod26@test.local', '{"full_name":"시험 생산26"}'),
    (viewer, 'viewer26@test.local', '{"full_name":"시험 열람26"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;

  before_qa := public.morning_briefing_items(qa);
  before_qc := public.morning_briefing_items(qc);
  before_prod := public.morning_briefing_items(prod);

  -- 가짜 자료: 시험 이슈(검토 대기 평가) 1, 공정 이슈(승인 대기 조치·QC에게 배정된 시험 조치 없음) 1, 보류 로트 1, 종료일 지난 작업지시 1, 발행된 작업지시 1
  insert into public.product (item_name) values ('시험 백신 026 (교육용 가상)') returning id into product_id;
  insert into public.batch (batch_number, product_id, status, created_by) values ('B26-001', product_id, 'on_hold', qa) returning id into lot_test;
  insert into public.batch (batch_number, product_id, status, created_by) values ('B26-002', product_id, 'in_production', qa) returning id into lot_proc;
  insert into public.quality_issue (batch_id, source, status, kind, opened_at) values (lot_test, 'test', 'open', 'spec', now() - interval '3 days') returning id into i_test;
  insert into public.quality_issue (batch_id, source, status, kind, opened_at) values (lot_proc, 'process', 'open', 'alert', now() - interval '1 day') returning id into i_proc;
  insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action, requested_by)
    values (i_test, 'submitted', '요약', '원인', '영향', '조치', qc);
  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by, assignee_id)
    values (i_proc, 'equipment_check', '설비 점검', 'pending_approval', prod, prod);
  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by, assignee_id, reviewed_by, reviewed_at)
    values (i_test, 'retest', '재시험', 'approved', qc, qc, qa, now());
  insert into public.work_order (order_number, product_id, planned_quantity, unit, planned_start, planned_end, status, created_by)
    values ('WO-2699-001', product_id, 100, '바이알', today - 10, today - 2, 'released', prod),
           ('WO-2699-002', product_id, 100, '바이알', today, today + 5, 'released', prod);

  after_qa := public.morning_briefing_items(qa);
  after_qc := public.morning_briefing_items(qc);
  after_prod := public.morning_briefing_items(prod);

  ----------------------------------------------------------------------------
  -- FR-002: 직원만 (열람자·없는 사람은 null)
  total := total + 1;
  if public.morning_briefing_items(viewer) is not null or public.morning_briefing_items(gen_random_uuid()) is not null then failures := failures || '열람자·없는 사람에게 항목'; end if;

  -- FR-003~005: 직무별 절만 (사용자 표, briefing-rules.js ROLE_SECTIONS와 같은 순서)
  total := total + 1;
  if (select array_agg(s->>'key' order by o) from jsonb_array_elements(after_qa->'sections') with ordinality t(s, o)) <> array['qa_waiting_issues','qa_submitted_reviews','qa_done_actions','qa_schedule','counts'] then failures := failures || 'QA 절 순서'; end if;
  total := total + 1;
  if (select array_agg(s->>'key' order by o) from jsonb_array_elements(after_qc->'sections') with ordinality t(s, o)) <> array['test_issues','my_reviews','my_test_actions','counts'] then failures := failures || 'QC 절 순서'; end if;
  total := total + 1; -- FR-010: 생산에게 QA 전용 절 없음
  if (select array_agg(s->>'key' order by o) from jsonb_array_elements(after_prod->'sections') with ordinality t(s, o)) <> array['process_issues','my_reviews','my_process_actions','my_turn','counts'] then failures := failures || '생산 절 순서'; end if;

  -- 개수 차이 (넣은 가짜 자료만큼 늘었나)
  total := total + 1; -- QA: 검토·승인 대기 이슈 +2(평가 제출 1, 조치 승인 대기 1), 제출된 평가서 +1, 종료일·시작일 지난 작업지시 +1
  if private.briefing_count(after_qa, 'qa_waiting_issues') - private.briefing_count(before_qa, 'qa_waiting_issues') <> 2
     or private.briefing_count(after_qa, 'qa_submitted_reviews') - private.briefing_count(before_qa, 'qa_submitted_reviews') <> 1
     or private.briefing_count(after_qa, 'qa_schedule') - private.briefing_count(before_qa, 'qa_schedule') < 1 then failures := failures || 'QA 개수'; end if;
  total := total + 1; -- QC: 시험 이슈 +1, 내 시험 조치 +1(본인 배정만)
  if private.briefing_count(after_qc, 'test_issues') - private.briefing_count(before_qc, 'test_issues') <> 1
     or private.briefing_count(after_qc, 'my_test_actions') - private.briefing_count(before_qc, 'my_test_actions') <> 1 then failures := failures || 'QC 개수'; end if;
  total := total + 1; -- 생산: 공정 이슈 +1, 내 공정 조치는 승인 전이라 0(미완료 = 승인됨), 내 차례 작업 +2(발행된 작업지시 2)
  if private.briefing_count(after_prod, 'process_issues') - private.briefing_count(before_prod, 'process_issues') <> 1
     or private.briefing_count(after_prod, 'my_process_actions') - private.briefing_count(before_prod, 'my_process_actions') <> 0
     or private.briefing_count(after_prod, 'my_turn') - private.briefing_count(before_prod, 'my_turn') <> 2 then failures := failures || '생산 개수'; end if;
  total := total + 1; -- "내 조치"는 그 사람 것만: QC 조치가 생산의 개수 한 줄에 들어가지 않는다
  if (select (p->>'count')::int from jsonb_array_elements(after_prod->'sections') s, jsonb_array_elements(s->'parts') p where s->>'key' = 'counts' and p->>'key' = 'my_actions')
     <> (select (p->>'count')::int from jsonb_array_elements(before_prod->'sections') s, jsonb_array_elements(s->'parts') p where s->>'key' = 'counts' and p->>'key' = 'my_actions') then failures := failures || '내 조치 범위'; end if;

  -- 앞 3건: 오래된 순, 앱 안 경로, 다른 사람 이름·이메일 없음
  total := total + 1;
  if exists (select 1 from jsonb_array_elements(after_qa->'sections') s, jsonb_array_elements(coalesce(s->'top', '[]')) r
             where r->>'path' !~ '^#/' or r->>'text' ~ '@' or r->>'text' like '%시험 QC26%') then failures := failures || '앞 3건 경로·이름'; end if;
  total := total + 1;
  if exists (select 1 from jsonb_array_elements(after_qa->'sections') s where jsonb_array_length(coalesce(s->'top', '[]')) > 3) then failures := failures || '앞 3건 넘음'; end if;

  -- FR-008·FR-001 수용 기준 2: 발송 기록은 같은 날 한 번, 상태는 sent(슬랙 대기 알림으로 다시 보내지지 않게), 내용 없음
  first_time := public.record_morning_briefing(qa, today, 'sent');
  second_time := public.record_morning_briefing(qa, today, 'sent');
  total := total + 1;
  if not first_time or second_time or (select count(*) from public.notification where recipient_id = qa and kind = 'morning_briefing') <> 1 then failures := failures || '같은 날 한 번'; end if;
  total := total + 1;
  if (select status::text || '|' || link_path from public.notification where recipient_id = qa and kind = 'morning_briefing') <> 'sent|#/home/qa' then failures := failures || '알림 상태·경로'; end if;
  total := total + 1;
  perform public.record_morning_briefing(qc, today, 'failed');
  if (select status::text from public.notification where recipient_id = qc and kind = 'morning_briefing') <> 'failed'
     or (select message from public.notification where recipient_id = qc and kind = 'morning_briefing') not like '%보내지 못했습니다%' then failures := failures || '못 보냄 안내'; end if;
  total := total + 1;
  if public.morning_briefing_already_sent(qa, today) is not true or public.morning_briefing_already_sent(prod, today) is not false then failures := failures || '보냈는지 확인'; end if;

  -- 받는 사람 목록: 직원만, 이메일은 슬랙 찾기용으로만
  total := total + 1;
  if exists (select 1 from public.morning_briefing_recipients() r where r.id = viewer)
     or not exists (select 1 from public.morning_briefing_recipients() r where r.id = prod and r.role = 'production_operator') then failures := failures || '받는 사람'; end if;

  -- FR-010: 관리자 키(service_role)만 실행. 화면 로그인(authenticated)·익명(anon)은 실행할 수 없다
  total := total + 1;
  if has_function_privilege('anon', 'public.morning_briefing_items(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.morning_briefing_items(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.record_morning_briefing(uuid, date, text)', 'execute')
     or has_function_privilege('authenticated', 'public.morning_briefing_recipients()', 'execute')
     or has_function_privilege('authenticated', 'public.morning_briefing_already_sent(uuid, date)', 'execute')
     or not has_function_privilege('service_role', 'public.morning_briefing_items(uuid)', 'execute') then failures := failures || '실행 권한'; end if;

  raise exception 'PF_TEST 통과 %/% %', total - coalesce(array_length(failures, 1), 0), total, array_to_string(failures, ', ');
end
$test$;
