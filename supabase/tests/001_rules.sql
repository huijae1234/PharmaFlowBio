-- spec 001 데이터베이스 시험 (plan 001 §4). Supabase SQL에서 postgres로 실행한다.
-- 맨 끝에서 결과를 담은 오류를 일부러 일으켜 모든 변경을 되돌린다. 자료가 남지 않는다.
-- 결과 읽는 법: 오류 문구가 "PF_TEST 통과 N/N"이면 통과, "PF_TEST 실패"면 실패 목록이 함께 나온다.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  qa2 uuid := gen_random_uuid();
  product_id uuid;
  s_purity uuid; s_assay uuid; s_temp uuid; s_humidity uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid;
  r jsonb;
  n int;
  v text;
  t_min timestamptz; t_max timestamptz;
  total int := 0;
  failures text[] := '{}';
begin
  -- 준비: 가짜 사용자 5명 (auth.users에 넣으면 profile이 열람자로 생긴다)
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa@test.local', '{"full_name":"시험 QA"}'),
    (qc, 'qc@test.local', '{"full_name":"시험 QC"}'),
    (prod, 'prod@test.local', '{"full_name":"시험 생산"}'),
    (viewer, 'viewer@test.local', '{"full_name":"시험 열람"}'),
    (qa2, 'qa2@test.local', '{"full_name":"시험 QA2"}');

  total := total + 1; -- 첫 로그인은 열람자 (FR-003)
  select count(*) into n from public.profile where id in (qa, qc, prod, viewer, qa2) and role = 'viewer';
  if n <> 5 then failures := failures || format('첫 로그인 열람자: %s/5', n); end if;

  update public.profile set role = 'qa_manager' where id in (qa, qa2);

  -- 준비: 시험용 제품과 기준값 (postgres로 직접)
  insert into public.product (item_name) values ('시험정') returning id into product_id;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value) values
    (product_id, 'test', '순도', '%', 98.0, 102.0) returning id into s_purity;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value) values
    (product_id, 'test', '함량', '%', 95.0, 105.0) returning id into s_assay;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value) values
    (product_id, 'process', '공정 온도', '℃', 20, 25) returning id into s_temp;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value) values
    (product_id, 'process', '습도', '%', 30, 50) returning id into s_humidity;

  ----------------------------------------------------------------------------
  -- QA 관리자로: 역할 지정 (FR-004)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  perform public.set_user_role(qc, 'qc_analyst');
  perform public.set_user_role(prod, 'production_operator');
  total := total + 1; -- 자기 역할 변경 거부
  begin
    perform public.set_user_role(qa, 'viewer');
    failures := failures || '자기 역할 변경이 거부되지 않음'::text;
  exception when others then
    if sqlerrm not like '%자기 역할%' then failures := failures || ('자기 역할 변경 문구: ' || sqlerrm); end if;
  end;

  total := total + 1; -- 사용자 목록(이메일)은 QA 관리자만
  select count(*) into n from public.list_users() where email like '%@test.local';
  if n <> 5 then failures := failures || format('QA 사용자 목록: %s/5', n); end if;

  total := total + 1; -- 기준값 범위 검사 (FR-007)
  begin
    perform public.save_specification(null, product_id, 'test', '용출률', '%', 102, 98);
    failures := failures || '최솟값 > 최댓값이 저장됨'::text;
  exception when others then
    if sqlerrm not like '%최솟값이 최댓값보다 클 수 없습니다%' then failures := failures || ('범위 문구: ' || sqlerrm); end if;
  end;

  -- 배치 등록 (FR-008)
  b1 := (public.create_batch('T-001', product_id)).id;
  b2 := (public.create_batch('T-002', product_id)).id;
  b3 := (public.create_batch('T-003', product_id)).id;
  b4 := (public.create_batch('T-004', product_id)).id;
  b5 := (public.create_batch('T-005', product_id)).id;
  total := total + 1; -- 배치번호 중복
  begin
    perform public.create_batch('T-001', product_id);
    failures := failures || '배치번호 중복이 저장됨'::text;
  exception when others then
    if sqlerrm not like '%이미 있는 로트번호입니다%' then failures := failures || ('중복 문구: ' || sqlerrm); end if;
  end;

  execute 'reset role';
  total := total + 1; -- 역할 지정이 반영됨
  select count(*) into n from public.profile where (id = qc and role = 'qc_analyst') or (id = prod and role = 'production_operator');
  if n <> 2 then failures := failures || format('역할 지정 반영: %s/2', n); end if;

  ----------------------------------------------------------------------------
  -- QC 시험 담당자로: 시험값 판정 (FR-009, FR-010)
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1; -- 경계값 98.0 적합 + 생산 중 → 시험 중
  r := public.record_test_measurement(b1, s_purity, 98.0);
  if r->>'result' <> 'pass' or r->>'batch_status' <> 'in_testing' or r->>'quality_issue_id' is not null then
    failures := failures || ('경계값 98.0: ' || r::text);
  end if;
  total := total + 1; -- 경계값 102.0 적합
  r := public.record_test_measurement(b2, s_purity, 102.0);
  if r->>'result' <> 'pass' then failures := failures || ('경계값 102.0: ' || r::text); end if;
  total := total + 1; -- 97.99 이탈
  r := public.record_test_measurement(b3, s_purity, 97.99);
  if r->>'result' <> 'out_of_spec' then failures := failures || ('97.99: ' || r::text); end if;
  total := total + 1; -- 102.01 이탈
  r := public.record_test_measurement(b4, s_purity, 102.01);
  if r->>'result' <> 'out_of_spec' then failures := failures || ('102.01: ' || r::text); end if;

  total := total + 1; -- 이탈 1건: 생산 중 배치에 97.2 → 이슈 1개, 보류
  r := public.record_test_measurement(b5, s_purity, 97.2);
  if r->>'result' <> 'out_of_spec' or r->>'batch_status' <> 'on_hold' or r->>'quality_issue_id' is null then
    failures := failures || ('이탈 97.2: ' || r::text);
  end if;
  total := total + 1; -- Q15: 시험 이슈에는 공정 기록이 없음
  select count(*) into n from public.quality_issue where id = (r->>'quality_issue_id')::uuid and process_record_id is null;
  if n <> 1 then failures := failures || '시험 이슈에 공정 기록이 붙음'::text; end if;

  total := total + 1; -- 같은 시험 항목 재입력 거부 (Q10)
  begin
    perform public.record_test_measurement(b5, s_purity, 99.0);
    failures := failures || '같은 시험 항목 재입력이 저장됨'::text;
  exception when others then
    if sqlerrm not like '%이미 입력한 시험 항목%' then failures := failures || ('Q10 문구: ' || sqlerrm); end if;
  end;

  total := total + 1; -- 다른 시험 항목 이탈 → 이슈 1개 더
  r := public.record_test_measurement(b5, s_assay, 90);
  if r->>'quality_issue_id' is null then failures := failures || ('다른 항목 이탈: ' || r::text); end if;

  total := total + 1; -- 공정 기준으로 시험값 저장 거부
  begin
    perform public.record_test_measurement(b1, s_temp, 22);
    failures := failures || '공정 기준이 시험값으로 저장됨'::text;
  exception when others then null;
  end;

  total := total + 1; -- QC 시험 담당자는 공정 조건 입력 불가 (FR-006)
  begin
    perform public.record_process_conditions(b1, 100, 'normal', '[]'::jsonb);
    failures := failures || 'QC가 공정 조건을 저장함'::text;
  exception when others then
    if sqlerrm not like '%이 작업은%만 할 수 있습니다%' then failures := failures || ('QC 공정 문구: ' || sqlerrm); end if;
  end;

  total := total + 1; -- QC 시험 담당자는 기준값 저장 불가
  begin
    perform public.save_specification(null, product_id, 'test', '경도', 'kp', 4, 8);
    failures := failures || 'QC가 기준값을 저장함'::text;
  exception when others then null;
  end;

  total := total + 1; -- 표에 직접 쓰기 거부 (화면 우회)
  begin
    -- 0007 이후 당시 기준 두 칸이 필수라 함께 넣는다 (그래야 권한 때문에 거부되는지를 본다)
    insert into public.measurement (batch_id, specification_id, value, result, measured_by, applied_min_value, applied_max_value)
      values (b1, s_assay, 100, 'pass', qc, 95, 105);
    failures := failures || '표에 직접 쓰기가 저장됨'::text;
  exception when others then null;
  end;

  ----------------------------------------------------------------------------
  -- 생산 담당자로: 공정 조건과 보류 (FR-011, FR-012)
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1; -- 생산 담당자는 시험값 저장 불가 (SC-004)
  begin
    perform public.record_test_measurement(b1, s_assay, 100);
    failures := failures || '생산 담당자가 시험값을 저장함'::text;
  exception when others then
    if sqlerrm not like '%이 작업은%만 할 수 있습니다%' then failures := failures || ('생산 시험 문구: ' || sqlerrm); end if;
  end;

  total := total + 1; -- 공정 동시 이탈 1건: 온도 27 + 설비 이상 → 이슈 1개, 보류
  r := public.record_process_conditions(b1, 1000, 'abnormal',
    jsonb_build_array(jsonb_build_object('specification_id', s_temp, 'value', 27),
                      jsonb_build_object('specification_id', s_humidity, 'value', 40)));
  if r->>'quality_issue_id' is null or r->>'batch_status' <> 'on_hold' then
    failures := failures || ('공정 동시 이탈: ' || r::text);
  end if;
  execute 'reset role';
  select count(*) into n from public.quality_issue where batch_id = b1;
  if n <> 1 then failures := failures || format('공정 동시 이탈 이슈 수: %s', n); end if;
  total := total + 1; -- 이탈 측정값만 이슈에 연결
  select count(*) into n from public.measurement where batch_id = b1 and quality_issue_id is not null;
  if n <> 1 then failures := failures || format('공정 이탈 측정값 연결: %s/1', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 설비 이상만 → 이슈 1개
  r := public.record_process_conditions(b2, 1000, 'abnormal',
    jsonb_build_array(jsonb_build_object('specification_id', s_temp, 'value', 22)));
  if r->>'quality_issue_id' is null then failures := failures || ('설비 이상만: ' || r::text); end if;
  total := total + 1; -- Q15: 공정 이슈에 출처 공정 기록이 연결됨 (측정값 연결이 없어도)
  select count(*) into n from public.quality_issue
   where id = (r->>'quality_issue_id')::uuid and process_record_id = (r->>'process_record_id')::uuid;
  if n <> 1 then failures := failures || ('공정 이슈의 공정 기록 연결: ' || r::text); end if;

  total := total + 1; -- 정상 공정 조건 → 이슈 없음, 생산량은 기준 없이 기록 (Q4)
  r := public.record_process_conditions(b3, 500, 'normal',
    jsonb_build_array(jsonb_build_object('specification_id', s_temp, 'value', 22)));
  if r->>'quality_issue_id' is not null then failures := failures || ('정상 공정: ' || r::text); end if;

  total := total + 1; -- 직접 보류: 빈 사유 거부
  begin
    perform public.hold_batch(b2, '   ');
    failures := failures || '빈 보류 사유가 저장됨'::text;
  exception when others then
    if sqlerrm not like '%보류 사유를 입력해 주세요%' then failures := failures || ('보류 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 직접 보류: 사유 있으면 보류
  perform public.hold_batch(b2, '포장 라인 점검');

  ----------------------------------------------------------------------------
  -- 열람자로: 모든 쓰기 거부, 읽기는 됨 (FR-003, FR-006)
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.create_batch('V-001', product_id);
    failures := failures || '열람자가 배치를 등록함'::text;
  exception when others then null;
  end;
  total := total + 1;
  begin
    perform public.hold_batch(b3, '열람자 보류');
    failures := failures || '열람자가 보류함'::text;
  exception when others then null;
  end;
  total := total + 1; -- 열람자는 읽을 수 있음
  select count(*) into n from public.batch where id in (b1, b2, b3, b4, b5);
  if n <> 5 then failures := failures || format('열람자 배치 읽기: %s/5', n); end if;
  total := total + 1; -- 열람자는 이메일을 못 봄
  begin
    select email into v from public.profile where id = viewer;
    failures := failures || '열람자가 이메일을 읽음'::text;
  exception when others then null;
  end;
  total := total + 1;
  begin
    perform public.list_users();
    failures := failures || '열람자가 사용자 목록을 읽음'::text;
  exception when others then null;
  end;

  ----------------------------------------------------------------------------
  -- 업무 이력 (FR-013, SC-009)
  execute 'reset role';
  total := total + 1; -- 이탈 저장 → 측정값 입력·품질 이슈 생성·상태 변경 3줄
  select count(*), min(created_at), max(created_at) into n, t_min, t_max
    from public.work_history
   where batch_id = b5 and action in ('측정값 입력', '품질 이슈 생성', '로트 상태 변경')
     and created_at >= (select min(created_at) from public.work_history where batch_id = b5 and action = '측정값 입력');
  if n < 3 then failures := failures || format('이탈 이력 줄 수: %s', n); end if;
  total := total + 1; -- 세 줄이 같은 저장에서 (1초 안)
  if t_max - t_min > interval '1 second' then failures := failures || format('이탈 이력 시각 차이: %s', t_max - t_min); end if;
  total := total + 1; -- 이름·역할이 남음
  select count(*) into n from public.work_history where batch_id = b5 and actor_name = '시험 QC' and actor_role = 'qc_analyst';
  if n < 3 then failures := failures || format('이력 이름·역할: %s', n); end if;
  total := total + 1; -- 역할 지정도 이력에
  select count(*) into n from public.work_history where action = '역할 지정' and target_id in (qc, prod);
  if n <> 2 then failures := failures || format('역할 지정 이력: %s/2', n); end if;
  total := total + 1; -- 직접 보류 이력
  select count(*) into n from public.work_history where batch_id = b2 and action = '로트 보류';
  if n <> 1 then failures := failures || format('직접 보류 이력: %s/1', n); end if;

  total := total + 1; -- 이력은 postgres도 고칠 수 없음
  begin
    update public.work_history set action = '변조' where batch_id = b5;
    failures := failures || '업무 이력이 고쳐짐'::text;
  exception when others then null;
  end;
  total := total + 1;
  begin
    delete from public.work_history where batch_id = b5;
    failures := failures || '업무 이력이 지워짐'::text;
  exception when others then null;
  end;

  ----------------------------------------------------------------------------
  -- 기준값 변경 후 기존 판정 유지 (FR-007, SC-006)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.save_specification(s_purity, product_id, 'test', '순도', '%', 97.0, 102.0);
  execute 'reset role';
  total := total + 1;
  select result::text into v from public.measurement where batch_id = b5 and specification_id = s_purity;
  if v <> 'out_of_spec' then failures := failures || ('기준 변경 후 기존 판정: ' || v); end if;

  ----------------------------------------------------------------------------
  -- 출하 판정이 끝난 배치는 입력 불가 (Q11)
  update public.batch set status = 'releasable' where id = b4;
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.record_test_measurement(b4, s_assay, 100);
    failures := failures || '출하 가능 배치에 시험값이 저장됨'::text;
  exception when others then
    if sqlerrm not like '%내부 출하 검토가 끝난 로트%' then failures := failures || ('Q11 문구: ' || sqlerrm); end if;
  end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- 로그인하지 않은 사용자(anon)는 아무것도 읽지 못함
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  total := total + 1;
  begin
    select count(*) into n from public.batch;
    if n > 0 then failures := failures || format('anon이 배치 %s개를 읽음', n); end if;
  exception when others then null;
  end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
