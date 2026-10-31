-- spec 019 데이터베이스 시험 (plan 019 §4): 시험용 자료(fixtures/measurements.json, fixtures/broken/measurements.json)의 값으로
-- 판정·저장·중복·권한을 본다. 값과 기대 결과는 자료 파일과 같게 적었다(바꾸면 함께 바꾼다). 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 자료별 결과는 docs/test-data.md.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  pid uuid;
  spec_ids jsonb := '{}';
  item record;
  lot uuid;
  r jsonb;
  got text;
  n int;
  lots_before int := (select count(*) from public.batch);
  values_before int := (select count(*) from public.measurement);
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa19@test.local', '{"full_name":"시험 QA19"}'),
    (qc, 'qc19@test.local', '{"full_name":"시험 QC19"}'),
    (prod, 'prod19@test.local', '{"full_name":"시험 생산19"}'),
    (viewer, 'viewer19@test.local', '{"full_name":"시험 열람19"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;

  -- 자료 파일의 specs와 같은 기준 (예시 제품 인플루엔자 4가 v1과 같은 값)
  insert into public.product (item_name) values ('시험 백신 019 (교육용 가상)') returning id into pid;
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  spec_ids := spec_ids || jsonb_build_object('역가', (public.save_specification(null, pid, 'test', '역가', '%', 80, 125, 90, 115)).id);
  spec_ids := spec_ids || jsonb_build_object('엔도톡신', (public.save_specification(null, pid, 'test', '엔도톡신', 'EU/mL', 0, 10, 0, 5)).id);
  spec_ids := spec_ids || jsonb_build_object('pH', (public.save_specification(null, pid, 'test', 'pH', '', 6.8, 7.6, 7.0, 7.4)).id);
  spec_ids := spec_ids || jsonb_build_object('보관 온도', (public.save_specification(null, pid, 'process', '보관 온도', '℃', 2, 8, 3, 7)).id);
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- 정상·위험·음수·경계값: 자료마다 로트 하나에 저장하고 판정을 본다
  for item in select * from (values
    ('N-01', '역가', 100::numeric, 'pass'), ('N-02', '엔도톡신', 1.5, 'pass'), ('N-03', 'pH', 7.2, 'pass'), ('N-04', '보관 온도', 4.8, 'pass'),
    ('R-01', '역가', 85, 'out_of_alert'), ('R-02', '역가', 130, 'out_of_spec'), ('R-03', '엔도톡신', 7.2, 'out_of_alert'),
    ('R-04', '엔도톡신', 12, 'out_of_spec'), ('R-05', 'pH', 6.5, 'out_of_spec'), ('R-06', '보관 온도', 9.2, 'out_of_spec'),
    ('B-06', '엔도톡신', -1, 'out_of_spec'), ('B-07', '보관 온도', -0.5, 'out_of_spec'),
    ('B-08', '역가', 80, 'out_of_alert'), ('B-09', '역가', 125, 'out_of_alert'), ('B-10', '역가', 90, 'pass'), ('B-11', '역가', 115, 'pass'),
    ('B-12', '역가', 79.99, 'out_of_spec'), ('B-13', '엔도톡신', 0, 'pass'), ('B-14', '엔도톡신', 10, 'out_of_alert'),
    ('B-15', '엔도톡신', 10.01, 'out_of_spec'), ('B-16', '보관 온도', 8, 'out_of_alert'), ('B-17', '보관 온도', 8.1, 'out_of_spec')
  ) as t(id, spec_item, value, expect)
  loop
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    lot := (public.create_batch('Q19-' || item.id, pid)).id;
    execute 'reset role';
    begin
      if item.spec_item = '보관 온도' then
        perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        perform public.record_process_conditions(lot, 1000, 'normal',
          jsonb_build_array(jsonb_build_object('specification_id', spec_ids->>item.spec_item, 'value', item.value)));
      else
        perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        perform public.record_test_measurement(lot, (spec_ids->>item.spec_item)::uuid, item.value);
      end if;
      execute 'reset role';
      select m.result::text into got from public.measurement m where m.batch_id = lot;
      if got is distinct from item.expect then failures := failures || format('%s 판정 %s (기대 %s)', item.id, got, item.expect); end if;
    exception when others then
      execute 'reset role';
      failures := failures || format('%s 저장 오류: %s', item.id, sqlerrm);
    end;
  end loop;

  ----------------------------------------------------------------------------
  -- 저장 결과: 규격 이탈은 이슈 + 보류, 관리기준 이탈은 이슈만, 정상은 이슈 없음 (spec 004)
  total := total + 1;
  select string_agg(b.batch_number || ':' || b.status || ':' ||
           coalesce((select string_agg(q.kind::text, ',') from public.quality_issue q where q.batch_id = b.id), '-'), ' ' order by b.batch_number)
    into got from public.batch b where b.batch_number in ('Q19-N-01', 'Q19-R-01', 'Q19-R-02', 'Q19-R-06');
  if got is distinct from 'Q19-N-01:in_testing:- Q19-R-01:in_testing:alert Q19-R-02:on_hold:spec Q19-R-06:on_hold:spec' then
    failures := failures || ('저장 결과: ' || coalesce(got, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- 데이터 오류: 빈 값·단위 붙은 값·쉼표는 저장하지 않는다 (한 번에 입력 함수에 글자로 넣음)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  lot := (public.create_batch('Q19-BROKEN', pid)).id;
  execute 'reset role';
  for item in select * from (values
    ('B-01', '역가', ''), ('B-02', '역가', '   '), ('B-03', '엔도톡신', '1.5 EU/mL'), ('B-04', '역가', '100%'), ('B-05', 'pH', '7,2')
  ) as t(id, spec_item, input)
  loop
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.record_test_measurements(lot,
        jsonb_build_array(jsonb_build_object('specification_id', spec_ids->>item.spec_item, 'value', item.input)));
      failures := failures || format('%s 저장됨', item.id);
    exception when others then
      if sqlerrm <> '숫자로 입력해 주세요.' then failures := failures || format('%s 문구: %s', item.id, sqlerrm); end if;
    end;
    execute 'reset role';
  end loop;
  total := total + 1;
  if exists (select 1 from public.measurement where batch_id = lot) then failures := failures || '틀린 값이 남음'::text; end if;

  -- 중복 B-18: 같은 항목 두 번이면 아무것도 저장하지 않는다 (spec 017)
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.record_test_measurements(lot, jsonb_build_array(
      jsonb_build_object('specification_id', spec_ids->>'역가', 'value', 100),
      jsonb_build_object('specification_id', spec_ids->>'역가', 'value', 101)));
    failures := failures || 'B-18 중복 저장됨'::text;
  exception when others then
    if sqlerrm <> '이미 입력된 시험 항목이 있습니다. 창을 닫고 다시 열어 주세요.' then failures := failures || ('B-18 문구: ' || sqlerrm); end if;
  end;
  execute 'reset role';
  if exists (select 1 from public.measurement where batch_id = lot) then failures := failures || 'B-18 뒤 값이 남음'::text; end if;

  ----------------------------------------------------------------------------
  -- 권한: 시험값은 QC·QA만, 공정 조건은 생산·QA만 (spec 001)
  total := total + 1;
  for item in select * from (values (viewer, 'test'), (prod, 'test'), (viewer, 'process'), (qc, 'process')) as t(who, what)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', item.who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      if item.what = 'test' then
        perform public.record_test_measurement(lot, (spec_ids->>'역가')::uuid, 100);
      else
        perform public.record_process_conditions(lot, 1000, 'normal',
          jsonb_build_array(jsonb_build_object('specification_id', spec_ids->>'보관 온도', 'value', 5)));
      end if;
      failures := failures || format('권한 없는 저장 %s %s', item.who, item.what);
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
  end loop;
  total := total + 1;
  if exists (select 1 from public.measurement where batch_id = lot) then failures := failures || '권한 없는 값이 남음'::text; end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림, 시작 때 로트 %·측정값 %)', total, total, lots_before, values_before;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
