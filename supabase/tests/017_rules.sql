-- spec 017 데이터베이스 시험 (plan 017 §4). 001~011과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 알림·이력은 이 시험의 로트(Q17-…)만 본다. 0031이 먼저 적용돼 있어야 한다.
do $test$
declare
  qa uuid := gen_random_uuid();
  qa2 uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  pid uuid;
  pid0 uuid;
  s1 uuid;
  s2 uuid;
  s3 uuid;
  s4 uuid;
  lot1 uuid;
  lot2 uuid;
  lot3 uuid;
  lot4 uuid;
  lot5 uuid;
  lot6 uuid;
  issue uuid;
  req uuid;
  transfer uuid;
  res jsonb;
  row_b public.batch;
  v text;
  n int;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa17@test.local', '{"full_name":"시험 QA17"}'),
    (qa2, 'qa17b@test.local', '{"full_name":"시험 QA17b"}'),
    (qc, 'qc17@test.local', '{"full_name":"시험 QC17"}'),
    (prod, 'prod17@test.local', '{"full_name":"시험 생산17"}'),
    (viewer, 'viewer17@test.local', '{"full_name":"시험 열람17"}');
  update public.profile set role = 'viewer' where id not in (qa, qa2, qc, prod);
  update public.profile set role = 'qa_manager' where id in (qa, qa2);
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;
  insert into public.product (item_name) values ('시험 백신 017 (교육용 가상)') returning id into pid;
  insert into public.product (item_name) values ('시험 백신 017 시험 항목 없음 (교육용 가상)') returning id into pid0;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  s1 := (public.save_specification(null, pid, 'test', '역가', '%', 80, 125, 90, 115)).id;
  s2 := (public.save_specification(null, pid, 'test', '엔도톡신', 'EU/mL', 0, 10, 0, 5)).id;
  s3 := (public.save_specification(null, pid, 'test', 'pH', '', 6, 8, null, null)).id;
  perform public.save_specification(null, pid0, 'process', '배양 온도', '℃', 30, 40, null, null);
  lot1 := (public.create_batch('Q17-001', pid)).id;
  lot2 := (public.create_batch('Q17-002', pid)).id;
  lot3 := (public.create_batch('Q17-003', pid)).id;
  lot4 := (public.create_batch('Q17-004', pid)).id;
  lot5 := (public.create_batch('Q17-005', pid)).id;
  lot6 := (public.create_batch('Q17-006', pid0)).id;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-001·002: 단건으로 마지막 항목을 넣을 때 한 번
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.record_test_measurement(lot1, s1, 100);
  perform public.record_test_measurement(lot1, s2, 1);
  execute 'reset role';
  total := total + 1; -- 중간에는 알림 없음, 첫 값으로 시험 중
  if exists (select 1 from public.notification where kind = 'tests_completed' and batch_number = 'Q17-001')
     or (select status from public.batch where id = lot1) <> 'in_testing' then
    failures := failures || '중간에 시험 완료 알림이 갔거나 시험 중이 아님'::text;
  end if;
  execute 'set local role authenticated';
  perform public.record_test_measurement(lot1, s3, 7);
  execute 'reset role';
  total := total + 1; -- QA 두 명에게 한 건씩, 저장한 QC에게는 없음
  select count(*) into n from public.notification where kind = 'tests_completed' and batch_number = 'Q17-001';
  if n <> 2 or exists (select 1 from public.notification where kind = 'tests_completed' and batch_number = 'Q17-001'
                        and recipient_id not in (qa, qa2)) then
    failures := failures || ('시험 완료 알림 받는 사람 ' || n || '/2');
  end if;
  total := total + 1; -- 글·이동 주소·대상
  select message into v from public.notification where kind = 'tests_completed' and batch_number = 'Q17-001' and recipient_id = qa;
  if v is distinct from '시험 완료 · Q17-001 · 정상 3 · 이탈 0'
     or not exists (select 1 from public.notification where kind = 'tests_completed' and batch_number = 'Q17-001'
                     and link_path = '#/batches/' || lot1 and target_table = 'batch' and target_id = lot1) then
    failures := failures || ('시험 완료 글: ' || coalesce(v, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- FR-004: 한 번에 저장
  execute 'set local role authenticated';
  res := public.record_test_measurements(lot2, jsonb_build_array(
    jsonb_build_object('specification_id', s1, 'value', 100), jsonb_build_object('specification_id', s2, 'value', 7)));
  execute 'reset role';
  total := total + 1; -- 항목별 결과·항목 id, 아직 시험 완료 아님
  if jsonb_array_length(res) <> 2 or res->0->>'specification_id' <> s1::text or res->0->>'result' <> 'pass'
     or res->1->>'result' <> 'out_of_alert' or res->1->>'quality_issue_id' is null
     or exists (select 1 from public.notification where kind = 'tests_completed' and batch_number = 'Q17-002') then
    failures := failures || ('한 번에 저장 결과: ' || res::text);
  end if;
  execute 'set local role authenticated';
  perform public.record_test_measurements(lot2, jsonb_build_array(jsonb_build_object('specification_id', s3, 'value', 7)));
  res := public.record_test_measurements(lot3, jsonb_build_array(
    jsonb_build_object('specification_id', s1, 'value', 100), jsonb_build_object('specification_id', s2, 'value', 1),
    jsonb_build_object('specification_id', s3, 'value', 7)));
  execute 'reset role';
  total := total + 1; -- 나머지를 채우면 이탈 수와 함께
  select message into v from public.notification where kind = 'tests_completed' and batch_number = 'Q17-002' and recipient_id = qa;
  if v is distinct from '시험 완료 · Q17-002 · 정상 2 · 이탈 1' then
    failures := failures || ('이탈 있는 시험 완료 글: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 한 번에 셋을 넣어도 한 건
  select count(*) into n from public.notification where kind = 'tests_completed' and batch_number = 'Q17-003' and recipient_id = qa;
  if n <> 1 or jsonb_array_length(res) <> 3 or (select status from public.batch where id = lot3) <> 'in_testing' then
    failures := failures || ('한 번에 셋 저장 알림 ' || n || '/1');
  end if;

  -- FR-004 수용 기준 3·4·6: 하나라도 안 되면 아무것도 남지 않는다
  execute 'set local role authenticated';
  perform public.record_test_measurement(lot4, s1, 100);
  total := total + 1;
  begin perform public.record_test_measurements(lot4, '[]');
    failures := failures || '빈 배열이 저장됨'::text;
  exception when others then if sqlerrm <> '시험값을 하나 이상 입력해 주세요.' then failures := failures || ('빈 배열 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 이미 입력된 항목이 섞임
  begin perform public.record_test_measurements(lot4, jsonb_build_array(
      jsonb_build_object('specification_id', s2, 'value', 1), jsonb_build_object('specification_id', s1, 'value', 100)));
    failures := failures || '이미 입력된 항목이 섞여도 저장됨'::text;
  exception when others then if sqlerrm <> '이미 입력된 시험 항목이 있습니다. 창을 닫고 다시 열어 주세요.' then failures := failures || ('중복 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 같은 항목 두 번
  begin perform public.record_test_measurements(lot4, jsonb_build_array(
      jsonb_build_object('specification_id', s2, 'value', 1), jsonb_build_object('specification_id', s2, 'value', 2)));
    failures := failures || '같은 항목 두 번이 저장됨'::text;
  exception when others then if sqlerrm <> '이미 입력된 시험 항목이 있습니다. 창을 닫고 다시 열어 주세요.' then failures := failures || ('같은 항목 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 숫자 아님
  begin perform public.record_test_measurements(lot4, jsonb_build_array(
      jsonb_build_object('specification_id', s2, 'value', 1), jsonb_build_object('specification_id', s3, 'value', '12a')));
    failures := failures || '숫자 아닌 값이 저장됨'::text;
  exception when others then if sqlerrm <> '숫자로 입력해 주세요.' then failures := failures || ('숫자 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 다른 제품의 항목이 섞임 → 앞 항목도 되돌려짐
  begin perform public.record_test_measurements(lot6, jsonb_build_array(jsonb_build_object('specification_id', s1, 'value', 100)));
    failures := failures || '다른 제품 항목이 저장됨'::text;
  exception when others then if sqlerrm <> '이 로트의 제품에 없는 시험 항목입니다. 시험 항목을 다시 골라 주세요.' then failures := failures || ('다른 제품 문구: ' || sqlerrm); end if; end;
  execute 'reset role';
  total := total + 1; -- 실패한 저장은 하나도 남지 않고 이슈·알림도 없음
  if (select count(*) from public.measurement where batch_id = lot4) <> 1
     or (select count(*) from public.measurement where batch_id = lot6) <> 0
     or exists (select 1 from public.notification where kind = 'tests_completed' and batch_number in ('Q17-004', 'Q17-006')) then
    failures := failures || '실패한 한 번에 저장이 일부 남음'::text;
  end if;

  -- FR-004 수용 기준 5: 규격 이탈 둘 → 이슈 둘·보류, 단건 함수 결과 모양 그대로
  execute 'set local role authenticated';
  res := public.record_test_measurements(lot5, jsonb_build_array(
    jsonb_build_object('specification_id', s1, 'value', 200), jsonb_build_object('specification_id', s2, 'value', 20)));
  execute 'reset role';
  total := total + 1;
  if (select count(*) from public.quality_issue where batch_id = lot5 and kind = 'spec') <> 2
     or (select status from public.batch where id = lot5) <> 'on_hold' or res->1->>'batch_status' <> 'on_hold' then
    failures := failures || '규격 이탈 둘의 이슈·보류'::text;
  end if;
  execute 'set local role authenticated';
  res := public.record_test_measurement(lot5, s3, 7);
  execute 'reset role';
  total := total + 1;
  if (select array_agg(k order by k) from jsonb_object_keys(res) k) <> array['batch_status', 'measurement_id', 'quality_issue_id', 'result'] then
    failures := failures || ('단건 결과 모양: ' || res::text);
  end if;
  total := total + 1; -- 보류 로트도 시험이 끝나면 알린다
  select message into v from public.notification where kind = 'tests_completed' and batch_number = 'Q17-005' and recipient_id = qa;
  if v is distinct from '시험 완료 · Q17-005 · 정상 1 · 이탈 2' then
    failures := failures || ('보류 로트 시험 완료 글: ' || coalesce(v, '없음'));
  end if;

  -- 역할: 생산·열람자는 시험값을 넣지 못한다
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.record_test_measurements(lot4, jsonb_build_array(jsonb_build_object('specification_id', s2, 'value', 1)));
    failures := failures || '생산이 시험값을 넣음'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('생산 시험값 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  -- FR-001 수용 기준 3: 재시험은 세지 않는다
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select quality_issue_id into issue from public.measurement where batch_id = lot2 and specification_id = s2;
  req := (public.submit_action_request(issue, 'retest', '엔도톡신 재시험')).id;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.approve_action_request(req, qc);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.complete_action_request(req, null, 3);
  execute 'reset role';
  total := total + 1;
  select count(*) into n from public.notification where kind = 'tests_completed' and batch_number = 'Q17-002' and recipient_id = qa;
  if n <> 1 then failures := failures || ('재시험 뒤 시험 완료 알림 ' || n || '/1'); end if;

  ----------------------------------------------------------------------------
  -- FR-005~007: 출하 완료
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  transfer := (public.send_sample(lot1, jsonb_build_object('from_team', 'production', 'to_team', 'qa', 'sample_kind', 'retention',
                                                         'quantity', 4, 'unit', '바이알', 'note', '보존 검체'))).id;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.receive_sample(transfer, '냉장고');
  perform public.decide_release(lot1, 'releasable');
  total := total + 1; -- QA는 출하 완료를 기록하지 못한다
  begin perform public.ship_batch(lot1, clock_timestamp(), null);
    failures := failures || 'QA가 출하 완료를 기록함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('QA 출하 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin perform public.ship_batch(lot1, clock_timestamp(), null);
    failures := failures || 'QC가 출하 완료를 기록함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('QC 출하 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 출하 가능이 아닌 로트
  begin perform public.ship_batch(lot3, clock_timestamp(), null);
    failures := failures || '시험 중 로트가 출하 완료됨'::text;
  exception when others then if sqlerrm <> '출하 가능 로트만 출하 완료로 기록할 수 있습니다.' then failures := failures || ('시험 중 출하 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 일시 빈칸
  begin perform public.ship_batch(lot1, null, null);
    failures := failures || '일시 없이 출하 완료됨'::text;
  exception when others then if sqlerrm <> '출하 일시를 입력해 주세요.' then failures := failures || ('빈 일시 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 앞으로의 시각
  begin perform public.ship_batch(lot1, clock_timestamp() + interval '2 hours', null);
    failures := failures || '앞으로의 시각으로 출하 완료됨'::text;
  exception when others then if sqlerrm <> '출하 일시는 지금보다 뒤일 수 없습니다.' then failures := failures || ('미래 일시 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 출하 가능 판정 전 시각
  begin perform public.ship_batch(lot1, timestamptz '2000-01-01 09:00+09', null);
    failures := failures || '판정 전 시각으로 출하 완료됨'::text;
  exception when others then if sqlerrm <> '출하 일시는 출하 가능 판정 뒤여야 합니다.' then failures := failures || ('판정 전 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- 메모 201자
  begin perform public.ship_batch(lot1, clock_timestamp(), repeat('가', 201));
    failures := failures || '201자 메모로 출하 완료됨'::text;
  exception when others then if sqlerrm <> '메모는 200자까지 입력해 주세요.' then failures := failures || ('메모 문구: ' || sqlerrm); end if; end;
  row_b := public.ship_batch(lot1, clock_timestamp(), '  1차 출고 ');
  total := total + 1; -- 두 번째는 막힘
  begin perform public.ship_batch(lot1, clock_timestamp(), null);
    failures := failures || '출하 완료 두 번'::text;
  exception when others then if sqlerrm <> '출하 가능 로트만 출하 완료로 기록할 수 있습니다.' then failures := failures || ('두 번째 출하 문구: ' || sqlerrm); end if; end;
  execute 'reset role';
  total := total + 1; -- 상태·칸
  if row_b.status <> 'shipped' or row_b.ship_note is distinct from '1차 출고' or row_b.shipped_by <> prod
     or row_b.shipped_at is null or row_b.ship_recorded_at is null then
    failures := failures || '출하 완료 상태·칸'::text;
  end if;
  total := total + 1; -- 업무 이력 "출하 완료"
  if (select count(*) from public.work_history where target_id = lot1 and action = '출하 완료' and actor_id = prod) <> 1 then
    failures := failures || '출하 완료 이력'::text;
  end if;
  total := total + 1; -- QA 두 명에게 알림, 생산에게는 없음
  select count(*) into n from public.notification where kind = 'lot_shipped' and batch_number = 'Q17-001';
  select message into v from public.notification where kind = 'lot_shipped' and batch_number = 'Q17-001' and recipient_id = qa;
  if n <> 2 or v not like '출하 완료 · Q17-001 · %' then
    failures := failures || ('출하 완료 알림 ' || n || '/2 ' || coalesce(v, '없음'));
  end if;

  -- FR-006: 출하 완료 로트는 바꿀 수 없다. 검체 반납은 된다(Q77)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin perform public.decide_release(lot1, 'discarded');
    failures := failures || '출하 완료 로트를 다시 검토함'::text;
  exception when others then if sqlerrm <> '내부 출하 검토가 끝난 로트는 바꿀 수 없습니다.' then failures := failures || ('다시 검토 문구: ' || sqlerrm); end if; end;
  total := total + 1;
  begin perform public.hold_batch(lot1, '확인');
    failures := failures || '출하 완료 로트를 보류함'::text;
  exception when others then if sqlerrm <> '내부 출하 검토가 끝난 로트는 바꿀 수 없습니다.' then failures := failures || ('보류 문구: ' || sqlerrm); end if; end;
  total := total + 1;
  begin perform public.return_sample(transfer, 1);
  exception when others then failures := failures || ('출하 완료 로트 검체 반납 막힘: ' || sqlerrm); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin perform public.record_test_measurements(lot1, jsonb_build_array(jsonb_build_object('specification_id', s1, 'value', 100)));
    failures := failures || '출하 완료 로트에 시험값'::text;
  exception when others then if sqlerrm <> '내부 출하 검토가 끝난 로트는 바꿀 수 없습니다.' then failures := failures || ('시험값 문구: ' || sqlerrm); end if; end;
  execute 'reset role';
  total := total + 1; -- 칸 없는 출하 완료는 표가 거부
  begin update public.batch set status = 'shipped' where id = lot3;
    failures := failures || '칸 없이 출하 완료 상태가 됨'::text;
  exception when check_violation then null; end;

  -- Q79: 시험 항목이 늘면 새 항목이 채워질 때 다시 알린다
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  s4 := (public.save_specification(null, pid, 'test', '함량', 'mg', 1, 2, null, null)).id;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.record_test_measurement(lot3, s4, 1.5);
  execute 'reset role';
  total := total + 1;
  select count(*) into n from public.notification where kind = 'tests_completed' and batch_number = 'Q17-003' and recipient_id = qa;
  if n <> 2 or not exists (select 1 from public.notification where kind = 'tests_completed' and batch_number = 'Q17-003'
                            and recipient_id = qa and message = '시험 완료 · Q17-003 · 정상 4 · 이탈 0') then
    failures := failures || ('항목 추가 뒤 시험 완료 ' || n || '/2');
  end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
