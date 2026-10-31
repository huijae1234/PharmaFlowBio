-- spec 004 데이터베이스 시험 (plan 004 §4). 001~003과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 예시·되돌리기 사례는 spec 007부터 007_rules.sql로 옮김.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  product_id uuid;
  s_potency uuid; s_content uuid; s_ph uuid; s_culture uuid; s_storage uuid;
  spec public.specification;
  b uuid; b_alert uuid; b_spec uuid; b_rel uuid; pr1 uuid; pr2 uuid; pr3 uuid;
  i_alert uuid; i_spec uuid; i_rel uuid;
  req uuid;
  r jsonb;
  n int;
  v text;
  history_before int;
  potency numeric[] := array[100, 85, 79, 90, 115, 80, 125];
  potency_expect text[] := array['pass', 'out_of_alert', 'out_of_spec', 'pass', 'pass', 'out_of_alert', 'out_of_alert'];
  content numeric[] := array[94, 95, 105, 106];
  content_expect text[] := array['out_of_spec', 'pass', 'pass', 'out_of_spec'];
  batches uuid[] := '{}';
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa4@test.local', '{"full_name":"시험 QA"}'),
    (qc, 'qc4@test.local', '{"full_name":"시험 QC"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id = qc;
  insert into public.product (item_name) values ('시험 백신 004 (교육용 가상)') returning id into product_id;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  ----------------------------------------------------------------------------
  -- FR-001: 관리기준 저장과 거부
  total := total + 1;
  spec := public.save_specification(null, product_id, 'test', '역가', '%', 80, 125, 90, 115);
  s_potency := spec.id;
  if spec.alert_min_value <> 90 or spec.alert_max_value <> 115 or spec.version <> 1 then
    failures := failures || ('관리기준 저장: ' || row_to_json(spec)::text);
  end if;
  total := total + 1; -- 관리기준 없음 (인자 7개, 기존 호출 모양)
  spec := public.save_specification(null, product_id, 'test', '함량', '%', 95, 105);
  s_content := spec.id;
  if spec.alert_min_value is not null or spec.version <> 1 then failures := failures || '관리기준 없음 저장'::text; end if;
  s_culture := (public.save_specification(null, product_id, 'process', '배양 온도', '℃', 35, 38, 36, 37.5)).id;
  s_storage := (public.save_specification(null, product_id, 'process', '보관 온도', '℃', 2, 8, 3, 7)).id;
  total := total + 1; -- 규격과 같은 관리기준은 허용
  begin
    s_ph := (public.save_specification(null, product_id, 'test', 'pH', null, 6.8, 7.6, 6.8, 7.6)).id;
  exception when others then failures := failures || ('규격과 같은 관리기준 거부됨: ' || sqlerrm); end;

  total := total + 1; -- 한쪽만, 규격 밖, 뒤집힘
  n := 0;
  begin perform public.save_specification(s_potency, product_id, 'test', '역가', '%', 80, 125, 90, null);
  exception when others then if sqlerrm like '%사내 관리기준은 시험 규격 안쪽%' then n := n + 1; end if; end;
  begin perform public.save_specification(s_potency, product_id, 'test', '역가', '%', 80, 125, 70, 115);
  exception when others then if sqlerrm like '%사내 관리기준은 시험 규격 안쪽%' then n := n + 1; end if; end;
  begin perform public.save_specification(s_potency, product_id, 'test', '역가', '%', 80, 125, 115, 90);
  exception when others then if sqlerrm like '%사내 관리기준은 시험 규격 안쪽%' then n := n + 1; end if; end;
  if n <> 3 then failures := failures || format('잘못된 관리기준 거부 %s/3', n); end if;
  total := total + 1; -- 표에 직접 써도 제약이 막는다
  execute 'reset role';
  begin
    update public.specification set alert_min_value = 70 where id = s_potency;
    failures := failures || '제약 없이 관리기준이 규격 밖으로 저장됨'::text;
  exception when check_violation then null; end;

  total := total + 1; -- QC는 기준을 못 고친다
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.save_specification(s_potency, product_id, 'test', '역가', '%', 80, 125, 92, 113);
    failures := failures || 'QC가 기준을 고침'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('QC 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-003·005: 경계값과 이슈 종류·보류 (역가 7개, 함량 4개)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for k in 1..7 loop
    batches := batches || (public.create_batch('Q4-' || k, product_id)).id;
  end loop;
  total := total + 1;
  for k in 1..7 loop
    r := public.record_test_measurement(batches[k], s_potency, potency[k]);
    if r->>'result' <> potency_expect[k] then
      failures := failures || format('역가 %s → %s (기대 %s)', potency[k], r->>'result', potency_expect[k]);
    end if;
  end loop;
  total := total + 1;
  for k in 1..4 loop
    r := public.record_test_measurement(batches[k], s_content, content[k]);
    if r->>'result' <> content_expect[k] then
      failures := failures || format('함량 %s → %s (기대 %s)', content[k], r->>'result', content_expect[k]);
    end if;
  end loop;
  execute 'reset role';
  b_alert := batches[2]; b_spec := batches[3];

  total := total + 1; -- 관리기준 이탈: 이슈 1개(alert), 보류 없음
  select count(*) into n from public.quality_issue where batch_id = b_alert and kind = 'alert';
  select status::text into v from public.batch where id = b_alert;
  if n <> 1 or v <> 'in_testing' then failures := failures || format('관리기준 이탈 이슈 %s개·상태 %s', n, v); end if;
  select id into i_alert from public.quality_issue where batch_id = b_alert;
  total := total + 1; -- 규격 이탈: 이슈 1개(spec), 보류
  select count(*) into n from public.quality_issue where batch_id = b_spec and kind = 'spec';
  select status::text into v from public.batch where id = b_spec;
  if n <> 1 or v <> 'on_hold' then failures := failures || format('규격 이탈 이슈 %s개·상태 %s', n, v); end if;
  select id into i_spec from public.quality_issue where batch_id = b_spec and status = 'open' limit 1;
  total := total + 1; -- 정상 경계값(115)은 이슈 없음, 역가 정상(90)이어도 함량 106은 규격 이탈 이슈 1개
  select count(*) into n from public.quality_issue where batch_id = batches[5];
  if n <> 0 then failures := failures || format('정상 경계값인데 이슈 %s개', n); end if;
  select count(*) into n from public.quality_issue where batch_id = batches[4] and kind = 'spec';
  if n <> 1 then failures := failures || format('함량 106 규격 이탈 이슈 %s개', n); end if;
  total := total + 1; -- 함량(관리기준 없음) 94는 규격 이탈 이슈, 95는 정상
  select count(*) into n from public.quality_issue where batch_id = batches[1] and kind = 'spec';
  if n <> 1 then failures := failures || format('관리기준 없음 규격 이탈 이슈 %s개', n); end if;

  ----------------------------------------------------------------------------
  -- FR-004·002: 그때 기준과 버전
  total := total + 1;
  select count(*) into n from public.measurement where batch_id = b_alert and specification_id = s_potency
     and applied_min_value = 80 and applied_max_value = 125 and applied_alert_min_value = 90 and applied_alert_max_value = 115
     and applied_spec_version = 1;
  if n <> 1 then failures := failures || '측정값에 그때 관리기준·버전이 없음'::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 바뀐 것 없으면 버전·이력 그대로
  select count(*) into history_before from public.work_history where target_id = s_potency;
  spec := public.save_specification(s_potency, product_id, 'test', '역가', '%', 80, 125, 90, 115);
  select count(*) into n from public.work_history where target_id = s_potency;
  if spec.version <> 1 or n <> history_before then failures := failures || format('그대로 저장 → 버전 %s, 이력 +%s', spec.version, n - history_before); end if;
  total := total + 1; -- 이름만 바뀌면 버전 그대로
  spec := public.save_specification(s_potency, product_id, 'test', '역가 ', '%', 80, 125, 90, 115);
  if spec.version <> 1 then failures := failures || '이름 공백만 바뀌었는데 버전 오름'::text; end if;
  total := total + 1; -- 관리기준을 바꾸면 버전 2, 이력 남음
  spec := public.save_specification(s_potency, product_id, 'test', '역가', '%', 80, 125, 92, 113);
  select count(*) into n from public.work_history where target_id = s_potency and action = '기준 수정';
  if spec.version <> 2 or n < 1 then failures := failures || format('관리기준 수정 → 버전 %s, 이력 %s', spec.version, n); end if;
  total := total + 1; -- 새 측정값은 v2, 예전 측정값은 v1 그대로
  b := (public.create_batch('Q4-8', product_id)).id;
  r := public.record_test_measurement(b, s_potency, 91);
  execute 'reset role';
  select count(*) into n from public.measurement where batch_id = b and applied_spec_version = 2 and applied_alert_min_value = 92 and result = 'out_of_alert';
  if n <> 1 then failures := failures || ('v2 측정값: ' || r::text); end if;
  select count(*) into n from public.measurement where batch_id = b_alert and specification_id = s_potency and applied_spec_version = 1 and applied_alert_min_value = 90;
  if n <> 1 then failures := failures || '기준 변경 뒤 예전 측정값의 그때 기준이 바뀜'::text; end if;
  total := total + 1; -- 이 기능 전부터 있던 행: 기준 v1·관리기준 없음, 이슈 spec (기본값)
  select count(*) into n from public.specification where version < 1 or (alert_min_value is null) <> (alert_max_value is null);
  if n <> 0 then failures := failures || format('버전·관리기준이 어긋난 기준 %s개', n); end if;

  ----------------------------------------------------------------------------
  -- FR-006: 공정 조건
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  pr1 := (public.create_batch('Q4-P1', product_id)).id;
  pr2 := (public.create_batch('Q4-P2', product_id)).id;
  pr3 := (public.create_batch('Q4-P3', product_id)).id;
  perform public.record_process_conditions(pr1, null, 'normal', jsonb_build_array(
    jsonb_build_object('specification_id', s_culture, 'value', 35.5), jsonb_build_object('specification_id', s_storage, 'value', 5)));
  perform public.record_process_conditions(pr2, null, 'normal', jsonb_build_array(
    jsonb_build_object('specification_id', s_culture, 'value', 35.5), jsonb_build_object('specification_id', s_storage, 'value', 9)));
  perform public.record_process_conditions(pr3, null, 'abnormal', jsonb_build_array(
    jsonb_build_object('specification_id', s_culture, 'value', 37), jsonb_build_object('specification_id', s_storage, 'value', 5)));
  execute 'reset role';
  total := total + 1;
  select string_agg(format('%s:%s:%s', x.batch_number, x.kinds, x.status), ' ') into v from (
    select bt.batch_number, bt.status::text as status,
           (select string_agg(q.kind::text, ',') from public.quality_issue q where q.batch_id = bt.id) as kinds
      from public.batch bt where bt.id in (pr1, pr2, pr3) order by bt.batch_number) x;
  if v <> 'Q4-P1:alert:in_production Q4-P2:spec:on_hold Q4-P3:spec:on_hold' then failures := failures || ('공정 판정: ' || v); end if;
  total := total + 1; -- 섞인 공정 기록: 이탈 항목 2개 모두 이슈에 연결
  select count(*) into n from public.measurement where batch_id = pr2 and quality_issue_id is not null;
  if n <> 2 then failures := failures || format('섞인 공정 기록 이탈 항목 %s/2', n); end if;

  ----------------------------------------------------------------------------
  -- FR-007: 재시험
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 관리기준 이탈 이슈 → 재시험 규격 이탈 → 종류 올림·보류·새 이슈 없음
  req := (public.submit_action_request(i_alert, 'retest', '역가 재시험')).id;
  perform public.approve_action_request(req, qa);
  r := public.complete_action_request(req, null, 79);
  execute 'reset role';
  select count(*) into n from public.quality_issue where batch_id = b_alert;
  select kind::text || ':' || (select status::text from public.batch where id = b_alert) into v from public.quality_issue where id = i_alert;
  if n <> 1 or v <> 'spec:on_hold' or r->>'result' <> 'out_of_spec' then
    failures := failures || format('종류 올리기: 이슈 %s개, %s, %s', n, v, r::text);
  end if;
  total := total + 1;
  select count(*) into n from public.work_history where target_id = i_alert and action = '품질 이슈 종류 변경';
  if n <> 1 then failures := failures || '종류 변경 이력 없음'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 규격 이탈 이슈 → 재시험 관리기준 이탈 → 종류 그대로, 완료 (Q28)
  req := (public.submit_action_request(i_spec, 'retest', '역가 재시험')).id;
  perform public.approve_action_request(req, qa);
  r := public.complete_action_request(req, null, 85);
  execute 'reset role';
  select kind::text into v from public.quality_issue where id = i_spec;
  select count(*) into n from public.action_request where id = req and status = 'completed';
  if v <> 'spec' or n <> 1 or r->>'result' <> 'out_of_alert' then failures := failures || format('Q28: %s, 완료 %s, %s', v, n, r::text); end if;

  ----------------------------------------------------------------------------
  -- FR-008: 내부 출하 검토 조건
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  b_rel := (public.create_batch('Q4-R1', product_id)).id;
  i_rel := (public.record_test_measurement(b_rel, s_potency, 91)->>'quality_issue_id')::uuid; -- v2 관리기준 92~113 → 관리기준 이탈
  perform public.record_test_measurement(b_rel, s_content, 100);
  perform public.record_test_measurement(b_rel, s_ph, 7.2);
  total := total + 1; -- 관리기준 이탈 이슈가 열려 있으면 막힘
  begin
    perform public.decide_release(b_rel, 'releasable');
    failures := failures || '열린 관리기준 이탈 이슈가 있는데 출하됨'::text;
  exception when others then
    if sqlerrm not like '%처리 중인 품질 이슈가 1건%' then failures := failures || ('열린 이슈 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 재시험 관리기준 이탈(이슈 종류 alert 그대로) → 닫기 → 마지막 값이 관리기준 이탈이어도 출하 가능
  -- spec 005 FR-004: 닫으려면 승인된 품질 영향 평가가 있어야 한다 (이 시험은 출하 조건을 보므로 미리 넣는다)
  execute 'reset role';
  insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action,
                                       requested_by, reviewed_by, reviewed_at)
  values (i_rel, 'approved', '시험', '시험', '시험', '시험', qa, qa, now());
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  req := (public.submit_action_request(i_rel, 'retest', '역가 재시험')).id;
  perform public.approve_action_request(req, qa);
  r := public.complete_action_request(req, null, 113.5); -- v2 관리기준 92~113 밖, 규격 안
  perform public.close_quality_issue(i_rel);
  begin
    perform public.decide_release(b_rel, 'releasable');
  exception when others then failures := failures || ('관리기준 이탈 마지막 값 출하 거부: ' || sqlerrm); end;
  execute 'reset role';
  select kind::text || ':' || (select status::text from public.batch where id = b_rel) into v from public.quality_issue where id = i_rel;
  if v <> 'alert:releasable' or r->>'result' <> 'out_of_alert' then failures := failures || ('출하 뒤 상태: ' || v || ' ' || r::text); end if;

  ----------------------------------------------------------------------------
  -- 업무 이력: 새 칸이 들어간 저장도 이력이 남는다
  total := total + 1;
  select count(*) into n from public.work_history where target_table = 'quality_issue' and action = '품질 이슈 생성'
     and created_at > now() - interval '1 minute';
  if n < 9 then failures := failures || format('이슈 생성 이력 %s개 (9개 이상 기대)', n); end if;

  ----------------------------------------------------------------------------
  -- spec 004 FR-010·011(가상 백신 A·B, VX-2610-001~004 예시와 되돌리기)은 spec 007 FR-004가 새 예시로 바꿨다.
  -- 새 예시·되돌리기 시험은 supabase/tests/007_rules.sql에 있다.

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
