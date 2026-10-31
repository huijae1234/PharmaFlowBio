-- spec 005 데이터베이스 시험 (plan 005 §4). 001~004와 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과.
do $test$
declare
  qa uuid := gen_random_uuid();
  qa2 uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  product_id uuid;
  s_potency uuid; s_ph uuid;
  b_alert uuid; b_spec uuid; b_up uuid; b_rel uuid; b_done uuid;
  i_alert uuid; i_spec uuid; i_up uuid; i_rel uuid; i_done uuid;
  rv uuid; rv_spec uuid; rv_up uuid; rv_rel uuid; rv_done uuid;
  req uuid;
  fields jsonb := jsonb_build_object('deviation_summary', '역가 85%', 'probable_cause', '시료 보관 편차',
                                     'impact_assessment', '규격 안', 'proposed_action', '재시험', 'evidence', '');
  n int;
  v text;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa5@test.local', '{"full_name":"시험 QA"}'),
    (qa2, 'qa5b@test.local', '{"full_name":"시험 QA2"}'),
    (qc, 'qc5@test.local', '{"full_name":"시험 QC"}'),
    (prod, 'prod5@test.local', '{"full_name":"시험 생산"}'),
    (viewer, 'viewer5@test.local', '{"full_name":"시험 열람"}');
  update public.profile set role = 'qa_manager' where id in (qa, qa2);
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;
  insert into public.product (item_name) values ('시험 백신 005 (교육용 가상)') returning id into product_id;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  s_potency := (public.save_specification(null, product_id, 'test', '역가', '%', 80, 125, 90, 115)).id;
  s_ph := (public.save_specification(null, product_id, 'test', 'pH', null, 6.8, 7.6)).id;
  b_alert := (public.create_batch('Q5-A', product_id)).id;
  b_spec := (public.create_batch('Q5-S', product_id)).id;
  b_up := (public.create_batch('Q5-U', product_id)).id;
  b_rel := (public.create_batch('Q5-R', product_id)).id;
  b_done := (public.create_batch('Q5-D', product_id)).id;
  i_alert := (public.record_test_measurement(b_alert, s_potency, 85)->>'quality_issue_id')::uuid;
  i_spec := (public.record_test_measurement(b_spec, s_potency, 79)->>'quality_issue_id')::uuid;
  i_up := (public.record_test_measurement(b_up, s_potency, 85)->>'quality_issue_id')::uuid;
  i_rel := (public.record_test_measurement(b_rel, s_potency, 79)->>'quality_issue_id')::uuid;
  perform public.record_test_measurement(b_rel, s_ph, 7.2);
  i_done := (public.record_test_measurement(b_done, s_potency, 79)->>'quality_issue_id')::uuid;
  perform public.record_test_measurement(b_done, s_ph, 7.2);
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-001 작성
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 열람자 거부
  begin
    perform public.submit_deviation_review(i_alert, fields);
    failures := failures || '열람자가 평가를 씀'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('열람자 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 필수 칸 빈·공백·1,001자
  n := 0;
  begin perform public.submit_deviation_review(i_alert, fields || '{"deviation_summary": "   "}');
  exception when others then if sqlerrm like '%이탈 내용을 입력해 주세요%' then n := n + 1; end if; end;
  begin perform public.submit_deviation_review(i_alert, fields - 'proposed_action');
  exception when others then if sqlerrm like '%제안 후속 조치를 입력해 주세요%' then n := n + 1; end if; end;
  begin perform public.submit_deviation_review(i_alert, fields || jsonb_build_object('evidence', repeat('가', 1001)));
  exception when others then if sqlerrm like '%근거는 1,000자까지%' then n := n + 1; end if; end;
  if n <> 3 then failures := failures || format('필수 칸 거부 %s/3', n); end if;
  total := total + 1; -- 제출 → 검토 요청, 근거 비움 허용, 앞뒤 공백 정리
  rv := (public.submit_deviation_review(i_alert, fields || '{"deviation_summary": "  역가 85%  "}')).id;
  select count(*) into n from public.deviation_review where id = rv and status = 'submitted' and requested_by = qc
     and deviation_summary = '역가 85%' and evidence is null and quality_issue_id = i_alert;
  if n <> 1 then failures := failures || '평가 제출 값이 다름'::text; end if;
  total := total + 1; -- 이슈당 하나
  begin
    perform public.submit_deviation_review(i_alert, fields);
    failures := failures || '두 번째 평가가 저장됨'::text;
  exception when others then if sqlerrm not like '%이미 품질 영향 평가가 있습니다%' then failures := failures || ('중복 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 생산 담당자도 작성
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  rv_spec := (public.submit_deviation_review(i_spec, fields)).id;
  if rv_spec is null then failures := failures || '생산 담당자 작성 실패'::text; end if;
  total := total + 1; -- 표에 직접 쓰기 거부
  begin
    insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action, requested_by)
    values (i_up, 'approved', 'x', 'x', 'x', 'x', prod);
    failures := failures || '평가 표에 직접 쓰기가 됨'::text;
  exception when others then null; end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-002 검토, FR-003 다시 제출
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- QC는 검토 못 함
  begin
    perform public.review_deviation_review(rv, 'approved', null);
    failures := failures || 'QC가 검토함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('QC 검토 거부 코드: ' || sqlstate); end if; end;
  total := total + 1; -- 검토 요청 중에는 다시 제출 못 함 (Q34)
  begin
    perform public.resubmit_deviation_review(rv, fields);
    failures := failures || '검토 요청 중에 다시 제출됨'::text;
  exception when others then if sqlerrm not like '%보완 요청이나 반려된 평가만%' then failures := failures || ('Q34 문구: ' || sqlerrm); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 보완 요청·반려는 사유 필수
  n := 0;
  begin perform public.review_deviation_review(rv, 'revision_requested', '  ');
  exception when others then if sqlerrm like '%사유를 입력해 주세요%' then n := n + 1; end if; end;
  begin perform public.review_deviation_review(rv, 'rejected', null);
  exception when others then if sqlerrm like '%사유를 입력해 주세요%' then n := n + 1; end if; end;
  if n <> 2 then failures := failures || format('사유 없는 검토 거부 %s/2', n); end if;
  total := total + 1; -- 보완 요청 저장
  perform public.review_deviation_review(rv, 'revision_requested', '원인 근거를 더 적어 주세요');
  select count(*) into n from public.deviation_review where id = rv and status = 'revision_requested' and reviewed_by = qa
     and reviewed_at is not null and review_comment = '원인 근거를 더 적어 주세요';
  if n <> 1 then failures := failures || '보완 요청이 저장되지 않음'::text; end if;
  total := total + 1; -- 이미 처리된 평가 (동시 처리)
  begin
    perform public.review_deviation_review(rv, 'approved', null);
    failures := failures || '보완 요청된 평가가 승인됨'::text;
  exception when others then if sqlerrm not like '%다른 사람이 먼저 처리했습니다%' then failures := failures || ('동시 처리 문구: ' || sqlerrm); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 요청자가 아니면 다시 제출 못 함
  begin
    perform public.resubmit_deviation_review(rv, fields);
    failures := failures || '요청자가 아닌 사람이 다시 제출함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('다시 제출 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 요청자가 고쳐 다시 제출 → 검토 요청, 검토 칸 비움
  perform public.resubmit_deviation_review(rv, fields || '{"evidence": "보관 기록 SOP-001"}');
  select count(*) into n from public.deviation_review where id = rv and status = 'submitted' and reviewed_by is null
     and review_comment is null and evidence = '보관 기록 SOP-001';
  if n <> 1 then failures := failures || '다시 제출 뒤 상태·검토 칸이 다름'::text; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qa2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 승인
  perform public.review_deviation_review(rv, 'approved', null);
  select count(*) into n from public.deviation_review where id = rv and status = 'approved' and reviewed_by = qa2;
  if n <> 1 then failures := failures || '승인이 저장되지 않음'::text; end if;
  total := total + 1; -- 승인은 최종
  begin
    perform public.review_deviation_review(rv, 'rejected', '늦은 반려');
    failures := failures || '승인된 평가가 반려됨'::text;
  exception when others then if sqlerrm not like '%다른 사람이 먼저 처리했습니다%' then failures := failures || ('승인 뒤 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 반려 → 요청자가 다시 제출할 수 있다 (FR-003 수용 기준 4)
  perform public.review_deviation_review(rv_spec, 'rejected', '평가 방향이 맞지 않음');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.resubmit_deviation_review(rv_spec, fields);
  execute 'reset role';
  select status::text into v from public.deviation_review where id = rv_spec;
  if v <> 'submitted' then failures := failures || ('반려 뒤 다시 제출: ' || v); end if;

  ----------------------------------------------------------------------------
  -- FR-004 닫기
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 미승인 평가로는 못 닫음
  begin
    perform public.close_quality_issue(i_spec);
    failures := failures || '미승인 평가로 닫힘'::text;
  exception when others then if sqlerrm not like '%승인된 품질 영향 평가가 없어%' then failures := failures || ('미승인 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 평가 없는 이슈도 못 닫음
  begin
    perform public.close_quality_issue(i_up);
    failures := failures || '평가 없이 닫힘'::text;
  exception when others then if sqlerrm not like '%승인된 품질 영향 평가가 없어%' then failures := failures || ('평가 없음 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 관리기준 이탈: 평가 승인만으로 닫힘
  begin
    perform public.close_quality_issue(i_alert);
  exception when others then failures := failures || ('관리기준 이탈 닫기 거부: ' || sqlerrm); end;
  total := total + 1; -- 규격 이탈: 평가 승인, 완료된 조치 없음 → 거부
  perform public.review_deviation_review(rv_spec, 'approved', null);
  begin
    perform public.close_quality_issue(i_spec);
    failures := failures || '규격 이탈이 완료된 조치 없이 닫힘'::text;
  exception when others then if sqlerrm not like '%완료된 조치 요청이 없어%' then failures := failures || ('완료 없음 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 열린 조치가 있으면 거부
  req := (public.submit_action_request(i_spec, 'retest', '역가 재시험')).id;
  begin
    perform public.close_quality_issue(i_spec);
    failures := failures || '열린 조치가 있는데 닫힘'::text;
  exception when others then if sqlerrm not like '%끝나지 않은 조치 요청이 있어%' then failures := failures || ('열린 조치 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 규격 이탈: 평가 승인 + 완료된 조치 → 닫히고 보류 → 시험 중
  perform public.approve_action_request(req, qa);
  perform public.complete_action_request(req, null, 100);
  perform public.close_quality_issue(i_spec);
  execute 'reset role';
  select status::text into v from public.batch where id = b_spec;
  if v <> 'in_testing' then failures := failures || ('규격 이탈 닫은 뒤 로트: ' || v); end if;

  total := total + 1; -- Q35: 평가 승인 뒤 종류가 규격 이탈로 바뀌면 완료된 조치가 필요 (평가는 다시 받지 않음)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  rv_up := (public.submit_deviation_review(i_up, fields)).id;
  perform public.review_deviation_review(rv_up, 'approved', null);
  req := (public.submit_action_request(i_up, 'retest', '역가 재시험')).id;
  perform public.approve_action_request(req, qa);
  perform public.complete_action_request(req, null, 79); -- alert → spec
  perform public.close_quality_issue(i_up); -- 완료된 조치가 있어 닫힘
  execute 'reset role';
  select q.kind::text || ':' || q.status::text || ':' || d.status::text into v
    from public.quality_issue q join public.deviation_review d on d.quality_issue_id = q.id where q.id = i_up;
  if v <> 'spec:closed:approved' then failures := failures || ('Q35: ' || v); end if;

  ----------------------------------------------------------------------------
  -- FR-005 평가 승인은 출하 승인이 아님 (E8)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  rv_rel := (public.submit_deviation_review(i_rel, fields)).id;
  perform public.review_deviation_review(rv_rel, 'approved', null);
  total := total + 1; -- 평가 승인, 조치 미완료 → 열린 이슈로 막힘
  begin
    perform public.decide_release(b_rel, 'releasable');
    failures := failures || '평가 승인만으로 출하됨'::text;
  exception when others then if sqlerrm not like '%처리 중인 품질 이슈가 1건%' then failures := failures || ('E8 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 닫았지만 마지막 값이 규격 이탈 → 막힘
  rv_done := (public.submit_deviation_review(i_done, fields)).id;
  perform public.review_deviation_review(rv_done, 'approved', null);
  req := (public.submit_action_request(i_done, 'retest', '역가 재시험')).id;
  perform public.approve_action_request(req, qa);
  perform public.complete_action_request(req, null, 78);
  perform public.close_quality_issue(i_done);
  perform public.hold_batch(b_done, '시험 확인용'); -- 보류 로트도 직접 보류면 검토 대상
  begin
    perform public.decide_release(b_done, 'releasable');
    failures := failures || '마지막 값 규격 이탈인데 출하됨'::text;
  exception when others then if sqlerrm not like '%시험이 끝나지 않은 항목이 있습니다: 역가%' then failures := failures || ('마지막 값 문구: ' || sqlerrm); end if; end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- 업무 이력: 행동 이름 5개, 로트 연결
  total := total + 1;
  select string_agg(a, ', ') into v from unnest(array['품질 영향 평가 검토 요청', '품질 영향 평가 승인', '품질 영향 평가 반려',
                                                     '품질 영향 평가 보완 요청', '품질 영향 평가 다시 제출']) a
   where not exists (select 1 from public.work_history w where w.action = a and w.target_table = 'deviation_review'
                     and w.created_at > now() - interval '1 minute');
  if v is not null then failures := failures || ('이력에 없는 행동: ' || v); end if;
  total := total + 1;
  select count(*) into n from public.work_history where target_id = rv and batch_id = b_alert and batch_number = 'Q5-A';
  if n < 4 then failures := failures || format('평가 이력의 로트 연결 %s줄 (4줄 이상)', n); end if;
  total := total + 1; -- 로그인한 사람은 평가를 읽음, 로그인하지 않은 사람은 못 읽음
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.deviation_review where id = rv;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    select count(*) into v from public.deviation_review;
  exception when others then v := '0'; end;
  execute 'reset role';
  if n <> 1 or v <> '0' then failures := failures || format('읽기 권한: 열람자 %s, anon %s', n, v); end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
