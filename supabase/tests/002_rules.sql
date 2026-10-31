-- spec 002 데이터베이스 시험 (plan 002 §4). 001_rules.sql과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  qc2 uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  product_id uuid;
  s_purity uuid; s_assay uuid; s_temp uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid;
  i1 uuid; i2 uuid; i3 uuid;
  r_retest uuid; r_equip uuid; r_retest2 uuid; r_b3 uuid;
  r jsonb;
  n int;
  v text;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa@test.local', '{"full_name":"시험 QA"}'),
    (qc, 'qc@test.local', '{"full_name":"시험 QC"}'),
    (qc2, 'qc2@test.local', '{"full_name":"시험 QC2"}'),
    (prod, 'prod@test.local', '{"full_name":"시험 생산"}'),
    (viewer, 'viewer@test.local', '{"full_name":"시험 열람"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id in (qc, qc2);
  update public.profile set role = 'production_operator' where id = prod;

  insert into public.product (item_name) values ('시험정 002') returning id into product_id;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value)
    values (product_id, 'test', '순도', '%', 98.0, 102.0) returning id into s_purity;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value)
    values (product_id, 'test', '함량', '%', 95.0, 105.0) returning id into s_assay;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value)
    values (product_id, 'process', '공정 온도', '℃', 20, 25) returning id into s_temp;

  -- 배치 4개 (QA)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  b1 := (public.create_batch('Q2-001', product_id)).id;
  b2 := (public.create_batch('Q2-002', product_id)).id;
  b3 := (public.create_batch('Q2-003', product_id)).id;
  b4 := (public.create_batch('Q2-004', product_id)).id;
  execute 'reset role';

  -- QC: 시험값 (b1 순도 이탈 → i1, 함량 적합 / b3 순도 이탈 → i3 / b4 순도 적합만)
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  i1 := (public.record_test_measurement(b1, s_purity, 97.2)->>'quality_issue_id')::uuid;
  perform public.record_test_measurement(b1, s_assay, 100);
  i3 := (public.record_test_measurement(b3, s_purity, 97.0)->>'quality_issue_id')::uuid;
  perform public.record_test_measurement(b4, s_purity, 99.0);
  execute 'reset role';

  -- 생산: b2 공정 이탈 → i2 (공정 이슈)
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  i2 := (public.record_process_conditions(b2, null, 'normal',
          jsonb_build_array(jsonb_build_object('specification_id', s_temp, 'value', 27)))->>'quality_issue_id')::uuid;
  execute 'reset role';
  -- spec 005 FR-004: 이슈를 닫으려면 승인된 품질 영향 평가가 있어야 한다. 이 시험은 조치·닫기 규칙을 보므로 승인된 평가를 미리 넣는다
  insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action,
                                       requested_by, reviewed_by, reviewed_at)
  select id, 'approved', '시험', '시험', '시험', '시험', qa, qa, now() from public.quality_issue where id in (i1, i2, i3);

  ----------------------------------------------------------------------------
  -- Q16 / FR-014: 측정 당시 기준 저장
  total := total + 1;
  select count(*) into n from public.measurement where batch_id = b1 and specification_id = s_purity
     and applied_min_value = 98.0 and applied_max_value = 102.0;
  if n <> 1 then failures := failures || '시험값에 당시 기준이 저장되지 않음'::text; end if;
  total := total + 1;
  select count(*) into n from public.measurement where batch_id = b2 and applied_min_value = 20 and applied_max_value = 25;
  if n <> 1 then failures := failures || '공정값에 당시 기준이 저장되지 않음'::text; end if;
  total := total + 1; -- 기준을 바꿔도 남음
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.save_specification(s_purity, product_id, 'test', '순도', '%', 97.0, 102.0);
  perform public.save_specification(s_purity, product_id, 'test', '순도', '%', 98.0, 102.0);
  execute 'reset role';
  select count(*) into n from public.measurement where batch_id = b1 and specification_id = s_purity and applied_min_value = 98.0;
  if n <> 1 then failures := failures || '기준 변경 뒤 당시 기준이 바뀜'::text; end if;
  total := total + 1; -- 모든 측정값에 당시 기준이 있음 (기존 자료 채움 포함)
  select count(*) into n from public.measurement where applied_min_value is null or applied_max_value is null;
  if n <> 0 then failures := failures || format('당시 기준 빈 측정값 %s개', n); end if;

  ----------------------------------------------------------------------------
  -- FR-003 조치 요청 등록
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  r_retest := (public.submit_action_request(i1, 'retest', '순도 재시험 요청')).id;
  select count(*) into n from public.action_request where id = r_retest and status = 'pending_approval';
  if n <> 1 then failures := failures || '재시험 요청이 승인 대기가 아님'::text; end if;
  total := total + 1; -- 종류 없으면 거부
  begin
    perform public.submit_action_request(i1, null, '종류 없음');
    failures := failures || '조치 종류 없이 등록됨'::text;
  exception when others then
    if sqlerrm not like '%조치 종류를 골라 주세요%' then failures := failures || ('종류 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 재시험은 시험 이슈만 (Q20)
  begin
    perform public.submit_action_request(i2, 'retest', '공정 이슈 재시험');
    failures := failures || '공정 이슈에 재시험이 등록됨'::text;
  exception when others then
    if sqlerrm not like '%재시험은 시험 이슈에만%' then failures := failures || ('Q20 문구: ' || sqlerrm); end if;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 생산 담당자도 등록 (같은 이슈에 여러 요청 허용)
  r_equip := (public.submit_action_request(i1, 'equipment_check', '시험 장비 점검')).id;
  if r_equip is null then failures := failures || '생산 담당자 등록 실패'::text; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 열람자 거부
  begin
    perform public.submit_action_request(i1, 'material_check', '열람자');
    failures := failures || '열람자가 조치 요청을 등록함'::text;
  exception when others then null;
  end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-004 승인·배정, FR-006 동시 처리
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- QA만
  begin
    perform public.approve_action_request(r_retest, qc);
    failures := failures || '생산 담당자가 승인함'::text;
  exception when others then
    if sqlerrm not like '%이 작업은%만 할 수 있습니다%' then failures := failures || ('승인 권한 문구: ' || sqlerrm); end if;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 담당자 필수
  begin
    perform public.approve_action_request(r_retest, null);
    failures := failures || '담당자 없이 승인됨'::text;
  exception when others then
    if sqlerrm not like '%담당자를 골라 주세요%' then failures := failures || ('담당자 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 재시험에 생산 담당자 배정 거부 (Q18)
  begin
    perform public.approve_action_request(r_retest, prod);
    failures := failures || '재시험에 생산 담당자가 배정됨'::text;
  exception when others then
    if sqlerrm not like '%배정할 수 없는 사람%' then failures := failures || ('Q18 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 승인
  perform public.approve_action_request(r_retest, qc);
  select count(*) into n from public.action_request where id = r_retest and status = 'approved' and assignee_id = qc and reviewed_by = qa;
  if n <> 1 then failures := failures || '승인·배정이 저장되지 않음'::text; end if;
  total := total + 1; -- 이미 처리된 요청 (FR-006)
  begin
    perform public.reject_action_request(r_retest, '늦은 반려');
    failures := failures || '이미 승인된 요청이 반려됨'::text;
  exception when others then
    if sqlerrm not like '%다른 사람이 먼저 처리했습니다%' then failures := failures || ('동시 처리 문구: ' || sqlerrm); end if;
  end;

  ----------------------------------------------------------------------------
  -- FR-005 반려와 다시 제출
  total := total + 1; -- 사유 필수
  begin
    perform public.reject_action_request(r_equip, '   ');
    failures := failures || '빈 사유로 반려됨'::text;
  exception when others then
    if sqlerrm not like '%반려 사유를 입력해 주세요%' then failures := failures || ('반려 문구: ' || sqlerrm); end if;
  end;
  perform public.reject_action_request(r_equip, '시험 장비가 아니라 원료 문제로 보임');
  execute 'reset role';
  total := total + 1;
  select count(*) into n from public.action_request where id = r_equip and status = 'rejected' and rejection_reason like '%원료 문제%';
  if n <> 1 then failures := failures || '반려가 저장되지 않음'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 요청자만 다시 제출
  begin
    perform public.resubmit_action_request(r_equip, 'material_check', '다른 사람 재제출');
    failures := failures || '요청자가 아닌 사람이 다시 제출함'::text;
  exception when others then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 다시 제출 → 승인 대기 (Q21: 종류·내용 바꿈)
  perform public.resubmit_action_request(r_equip, 'material_check', '원료 확인으로 바꿈');
  execute 'reset role';
  select count(*) into n from public.action_request
   where id = r_equip and status = 'pending_approval' and action_type = 'material_check' and rejection_reason is null;
  if n <> 1 then failures := failures || '다시 제출이 승인 대기가 아님'::text; end if;
  -- 다시 반려해 둔다 (이슈 닫기 시험에서 반려됨은 끝난 요청)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.reject_action_request(r_equip, '재시험으로 충분');
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-007 조치 결과
  perform set_config('request.jwt.claims', json_build_object('sub', qc2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 배정 안 된 QC 거부
  begin
    perform public.complete_action_request(r_retest, null, 99.0);
    failures := failures || '배정 안 된 사람이 결과를 넣음'::text;
  exception when others then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 재시험 값 필수
  begin
    perform public.complete_action_request(r_retest, null, null);
    failures := failures || '재시험 값 없이 완료됨'::text;
  exception when others then
    if sqlerrm not like '%숫자로 입력해 주세요%' then failures := failures || ('재시험 값 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 재시험 재이탈 → 같은 이슈, 열린 채
  r := public.complete_action_request(r_retest, '1차 재시험', 97.5);
  if r->>'result' <> 'out_of_spec' or r->>'issue_status' <> 'open' then failures := failures || ('재이탈: ' || r::text); end if;
  execute 'reset role';
  select count(*) into n from public.quality_issue where batch_id = b1;
  if n <> 1 then failures := failures || format('재이탈 뒤 이슈 수 %s', n); end if;
  total := total + 1;
  select count(*) into n from public.measurement
   where quality_issue_id = i1 and action_request_id = r_retest and specification_id = s_purity and applied_min_value = 98.0;
  if n <> 1 then failures := failures || '재시험 측정값이 이슈·요청에 붙지 않음'::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 완료된 요청은 다시 못 넣음
  begin
    perform public.complete_action_request(r_retest, null, 99.0);
    failures := failures || '완료된 요청에 결과를 또 넣음'::text;
  exception when others then
    if sqlerrm not like '%승인된 조치 요청만%' then failures := failures || ('완료 후 문구: ' || sqlerrm); end if;
  end;
  -- 2차 재시험 요청
  r_retest2 := (public.submit_action_request(i1, 'retest', '2차 재시험')).id;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.approve_action_request(r_retest2, qc);
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-008 이슈 닫기
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 승인됨 요청이 남아 있으면 거부
  begin
    perform public.close_quality_issue(i1);
    failures := failures || '열린 요청이 있는데 닫힘'::text;
  exception when others then
    if sqlerrm not like '%끝나지 않은 조치 요청이 있어%' then failures := failures || ('닫기 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 재시험 적합
  r := public.complete_action_request(r_retest2, '2차 재시험', 99.6);
  if r->>'result' <> 'pass' then failures := failures || ('재시험 적합: ' || r::text); end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 배정된 적 없는 생산 담당자 거부 (Q19)
  begin
    perform public.close_quality_issue(i1);
    failures := failures || '배정된 적 없는 사람이 닫음'::text;
  exception when others then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 닫기 → 마지막 이슈라 배치 보류 → 시험 중 (Q2)
  r := public.close_quality_issue(i1);
  if r->>'issue_status' <> 'closed' or r->>'batch_status' <> 'in_testing' then failures := failures || ('닫기: ' || r::text); end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 완료 요청이 없으면 QA도 못 닫음
  begin
    perform public.close_quality_issue(i2);
    failures := failures || '완료 요청 없이 닫힘'::text;
  exception when others then
    if sqlerrm not like '%완료된 조치 요청이 없어%' then failures := failures || ('완료 없음 문구: ' || sqlerrm); end if;
  end;
  execute 'reset role';

  -- 직접 보류 사유가 있으면 마지막 이슈를 닫아도 보류 유지
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.hold_batch(b3, '라인 점검');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r_b3 := (public.submit_action_request(i3, 'retest', 'b3 재시험')).id;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.approve_action_request(r_b3, qc);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.complete_action_request(r_b3, null, 99.0);
  total := total + 1;
  r := public.close_quality_issue(i3);
  if r->>'batch_status' <> 'on_hold' then failures := failures || ('직접 보류 유지: ' || r::text); end if;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-009 출하 판정 (Q17)
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- QA만
  begin
    perform public.decide_release(b1, 'releasable');
    failures := failures || '생산 담당자가 출하 판정함'::text;
  exception when others then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 열린 이슈 있으면 출하 가능 거부
  begin
    perform public.decide_release(b2, 'releasable');
    failures := failures || '열린 이슈가 있는데 출하됨'::text;
  exception when others then
    if sqlerrm not like '%처리 중인 품질 이슈가 1건 있어%' then failures := failures || ('열린 이슈 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 시험 안 끝난 항목 거부
  begin
    perform public.decide_release(b4, 'releasable');
    failures := failures || '함량 시험 없이 출하됨'::text;
  exception when others then
    if sqlerrm not like '%시험이 끝나지 않은 항목%함량%' then failures := failures || ('미측정 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 조건 충족 → 출하 가능 (마지막 값 99.6 적합, 함량 적합)
  perform public.decide_release(b1, 'releasable');
  total := total + 1; -- 0035: 폐기는 사유가 필수 (빈칸·공백은 거부)
  begin
    perform public.decide_release(b2, 'discarded', '   ');
    failures := failures || '사유 없이 폐기됨'::text;
  exception when others then
    if sqlerrm <> '폐기 사유를 적어 주세요.' then failures := failures || ('폐기 사유 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 0035: 사유는 200자까지
  begin
    perform public.decide_release(b2, 'discarded', repeat('가', 201));
    failures := failures || '201자 사유로 폐기됨'::text;
  exception when others then
    if sqlerrm <> '사유는 200자까지 쓸 수 있습니다.' then failures := failures || ('사유 길이 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 폐기는 열린 이슈가 있어도 가능, 사유는 로트에 남는다 (0035)
  perform public.decide_release(b2, 'discarded', '  원료 이물 확인  ');
  if (select release_reason from public.batch where id = b2) is distinct from '원료 이물 확인' then
    failures := failures || '폐기 사유가 로트에 안 남음'::text;
  end if;
  execute 'reset role';
  select count(*) into n from public.batch where (id = b1 and status = 'releasable') or (id = b2 and status = 'discarded');
  if n <> 2 then failures := failures || format('출하 판정 반영 %s/2', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 판정 끝난 배치의 이슈에는 조치 요청 불가 (Q11)
  begin
    perform public.submit_action_request(i2, 'material_check', '폐기 배치');
    failures := failures || '폐기 배치 이슈에 조치 요청됨'::text;
  exception when others then
    if sqlerrm not like '%내부 출하 검토가 끝난 로트%' then failures := failures || ('판정 후 요청 문구: ' || sqlerrm); end if;
  end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- 업무 이력 (FR-013 대상 행동)
  total := total + 1;
  select string_agg(distinct a, ', ') into v from (
    select unnest(array['조치 요청 등록', '조치 요청 승인', '조치 요청 반려', '조치 요청 다시 제출', '조치 완료',
                        '재시험 측정값 입력', '품질 이슈 종결', '내부 출하 검토']) as a) x
   where not exists (select 1 from public.work_history w where w.action = x.a and w.created_at > now() - interval '1 minute');
  if v is not null then failures := failures || ('이력에 없는 행동: ' || v); end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
