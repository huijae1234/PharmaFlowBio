-- spec 018 데이터베이스 시험 (plan 018 §4). 001~017과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 0033이 먼저 적용돼 있어야 한다. 알림은 이 시험의 로트(Q18-…)만 본다.
do $test$
declare
  qa uuid := gen_random_uuid();
  qa2 uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  pid uuid;
  lot1 uuid;
  lot2 uuid;
  lot3 uuid;
  lot4 uuid;
  r1 uuid;
  r2 uuid;
  r3 uuid;
  r4 uuid;
  t1 uuid;
  lend uuid;
  res jsonb;
  row_t public.sample_transfer;
  n int;
  m int;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa18@test.local', '{"full_name":"시험 QA18"}'),
    (qa2, 'qa18b@test.local', '{"full_name":"시험 QA18b"}'),
    (qc, 'qc18@test.local', '{"full_name":"시험 QC18"}'),
    (prod, 'prod18@test.local', '{"full_name":"시험 생산18"}'),
    (viewer, 'viewer18@test.local', '{"full_name":"시험 열람18"}');
  update public.profile set role = 'viewer' where id not in (qa, qa2, qc, prod);
  update public.profile set role = 'qa_manager' where id in (qa, qa2);
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;
  insert into public.product (item_name) values ('시험 백신 018 (교육용 가상)') returning id into pid;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  lot1 := (public.create_batch('Q18-001', pid)).id;
  lot2 := (public.create_batch('Q18-002', pid)).id;
  lot3 := (public.create_batch('Q18-003', pid)).id;
  lot4 := (public.create_batch('Q18-004', pid)).id;
  execute 'reset role';

  -- 생산이 보존 검체 4 바이알씩 QA로, 시험 검체 하나는 QC로
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r1 := (public.send_sample(lot1, '{"from_team":"production","to_team":"qa","sample_kind":"retention","quantity":"4","unit":"바이알"}')).id;
  r2 := (public.send_sample(lot2, '{"from_team":"production","to_team":"qa","sample_kind":"retention","quantity":"4","unit":"바이알"}')).id;
  r3 := (public.send_sample(lot3, '{"from_team":"production","to_team":"qa","sample_kind":"retention","quantity":"4","unit":"바이알"}')).id;
  r4 := (public.send_sample(lot4, '{"from_team":"production","to_team":"qa","sample_kind":"retention","quantity":"4","unit":"바이알"}')).id;
  t1 := (public.send_sample(lot1, '{"from_team":"production","to_team":"qc","sample_kind":"test","quantity":"6","unit":"바이알"}')).id;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.receive_sample(r1, '시험 냉장고 1');
  perform public.receive_sample(r2, '시험 냉장고 1');
  perform public.receive_sample(r3, '시험 냉장고 1');
  perform public.receive_sample(r4, '시험 냉장고 1');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.receive_sample(t1, 'QC 냉장고');
  execute 'reset role';

  -- 인수 시각을 과거로 (시험 준비라 이력은 남기지 않는다)
  perform set_config('pharmaflow.resetting', 'on', true);
  update public.sample_transfer set received_at = now() - interval '2 years 1 day' where id in (r1, t1);
  update public.sample_transfer set received_at = now() - interval '2 years' + interval '2 days' where id = r2;
  update public.sample_transfer set received_at = timestamptz '2024-02-29 10:00+09' where id = r3;
  update public.sample_transfer set received_at = now() - interval '3 years' where id = r4;
  perform set_config('pharmaflow.resetting', 'off', true);

  ----------------------------------------------------------------------------
  total := total + 1; -- FR-002, Q80: 기한 식 (한국 날짜 + 2년, 2월 29일 → 2월 28일)
  if private.retention_due(timestamptz '2024-02-29 10:00+09') <> date '2026-02-28'
     or private.retention_due(timestamptz '2026-10-11 15:30:00+00') <> date '2028-10-12'
     or private.retention_due(timestamptz '2026-10-11 14:59:00+00') <> date '2028-10-11' then
    failures := failures || '보관 기한 식'::text;
  end if;

  ----------------------------------------------------------------------------
  -- FR-003: 기한 도래 알림
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.notify_due_retention();
  m := public.notify_due_retention();
  execute 'reset role';
  total := total + 1; -- 지난 3건(r1·r3·r4)만, 두 번째는 0
  if n <> 3 or m <> 0 then failures := failures || format('알림 함수 결과 %s, 다시 %s', n, m); end if;
  total := total + 1; -- QA 관리자 2명(부른 qa 포함)에게 한 줄씩, 기한 전 r2는 없음
  if (select count(*) from public.notification where kind = 'retention_due' and target_id = r1) <> 2
     or not exists (select 1 from public.notification where kind = 'retention_due' and target_id = r1 and recipient_id = qa)
     or exists (select 1 from public.notification where kind = 'retention_due' and target_id = r2)
     or exists (select 1 from public.notification where kind = 'retention_due' and recipient_id in (qc, prod, viewer)) then
    failures := failures || '알림 받는 사람'::text;
  end if;
  total := total + 1; -- 글·이동·대상
  if not exists (select 1 from public.notification where kind = 'retention_due' and target_id = r3
                   and message = '보관 기한 도래 · Q18-003 · 보존 검체 4 바이알 (기한 2026-02-28)'
                   and link_path = '#/samples?status=held' and target_table = 'sample_transfer' and batch_number = 'Q18-003') then
    failures := failures || '알림 글'::text;
  end if;
  total := total + 1; -- 열람자가 불러도 되고 새로 만들지 않음
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.notify_due_retention();
  execute 'reset role';
  if n <> 0 then failures := failures || '열람자 호출에서 알림이 또 생김'::text; end if;

  ----------------------------------------------------------------------------
  -- FR-004: 폐기 권한·조건
  total := total + 1; -- QC·생산은 42501
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.dispose_sample(r3, now(), null);
    failures := failures || 'QC가 폐기함'::text;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.dispose_sample(r3, now(), null);
    failures := failures || '생산이 폐기함'::text;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 기한 전
  begin
    perform public.dispose_sample(r2, now(), null);
    failures := failures || '기한 전 폐기됨'::text;
  exception when others then
    if sqlerrm not like '보관 기한(%)이 지난 검체만 폐기할 수 있습니다.' then failures := failures || ('기한 전 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 시험 검체
  begin
    perform public.dispose_sample(t1, now(), null);
    failures := failures || '시험 검체 폐기됨'::text;
  exception when others then
    if sqlerrm <> '보관 기한이 있는 보존 검체만 폐기할 수 있습니다.' then failures := failures || ('시험 검체 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 입력 검사: 빈 일시·미래·기한 전·메모 201자
  begin
    perform public.dispose_sample(r3, null, null);
    failures := failures || '빈 일시 통과'::text;
  exception when others then
    if sqlerrm <> '폐기 일시를 입력해 주세요.' then failures := failures || ('빈 일시: ' || sqlerrm); end if;
  end;
  begin
    perform public.dispose_sample(r3, now() + interval '1 day', null);
    failures := failures || '미래 일시 통과'::text;
  exception when others then
    if sqlerrm <> '폐기 일시는 지금보다 뒤일 수 없습니다.' then failures := failures || ('미래: ' || sqlerrm); end if;
  end;
  begin
    perform public.dispose_sample(r3, timestamptz '2026-02-27 23:00+09', null);
    failures := failures || '기한 전 일시 통과'::text;
  exception when others then
    if sqlerrm <> '폐기 일시는 보관 기한 뒤여야 합니다.' then failures := failures || ('기한 전 일시: ' || sqlerrm); end if;
  end;
  begin
    perform public.dispose_sample(r3, now(), repeat('가', 201));
    failures := failures || '메모 201자 통과'::text;
  exception when others then
    if sqlerrm <> '메모는 200자까지 입력해 주세요.' then failures := failures || ('메모: ' || sqlerrm); end if;
  end;
  execute 'reset role';
  total := total + 1; -- 실패한 시도는 아무것도 바꾸지 않음
  if (select status from public.sample_transfer where id = r3) <> 'held' then failures := failures || '실패 뒤 상태가 바뀜'::text; end if;

  ----------------------------------------------------------------------------
  -- FR-004·006: 성공
  select count(*) into m from public.notification where target_id = r3;
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.dispose_sample(r3, timestamptz '2026-02-28 00:10+09', '  소각 위탁  ');
  execute 'reset role';
  select * into row_t from public.sample_transfer where id = r3;
  total := total + 1; -- 상태·칸·폐기 수량
  if row_t.status <> 'disposed' or row_t.disposed_by <> qa or row_t.disposed_at <> timestamptz '2026-02-28 00:10+09'
     or row_t.disposed_quantity <> 4 or row_t.dispose_note <> '소각 위탁' or (res->>'disposed_quantity')::int <> 4 then
    failures := failures || format('폐기 저장 %s %s %s', row_t.status, row_t.disposed_quantity, res);
  end if;
  total := total + 1; -- QA 보관 수 0
  if private.qa_retained_quantity(lot3) <> 0 then failures := failures || format('폐기 뒤 보관 수 %s', private.qa_retained_quantity(lot3)); end if;
  total := total + 1; -- 이력 "검체 폐기"
  if not exists (select 1 from public.work_history where target_id = r3 and actor_id = qa
                   and action = '검체 폐기 (생산 → QA, 보존 검체 4 바이알)') then
    failures := failures || '이력 검체 폐기'::text;
  end if;
  total := total + 1; -- 폐기로 검체 알림(인계 알림)은 새로 생기지 않음
  if (select count(*) from public.notification where target_id = r3) <> m then failures := failures || '폐기 때 알림이 생김'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 두 번째 폐기 거부
  begin
    perform public.dispose_sample(r3, now(), null);
    failures := failures || '두 번 폐기됨'::text;
  exception when others then
    if sqlerrm <> '이미 처리된 검체입니다. 화면을 새로 고쳐 주세요.' then failures := failures || ('두 번째: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 폐기 뒤 반납 거부
  begin
    perform public.return_sample(r3, 1);
    failures := failures || '폐기 뒤 반납됨'::text;
  exception when others then
    if sqlerrm not like '보관 중인 검체만 반납할 수 있습니다.%' then failures := failures || ('폐기 뒤 반납: ' || sqlerrm); end if;
  end;
  execute 'reset role';
  total := total + 1; -- 표 검사: 칸 없이 상태만 폐기로 바꿀 수 없음
  begin
    perform set_config('pharmaflow.resetting', 'on', true);
    update public.sample_transfer set status = 'disposed' where id = r2;
    failures := failures || '칸 없이 폐기 상태가 됨'::text;
  exception when check_violation then null;
  end;
  perform set_config('pharmaflow.resetting', 'off', true);

  ----------------------------------------------------------------------------
  -- FR-004 수용 기준 3, Q82: QC에 빌려준 것이 안 돌아오면 막고, 돌아온 뒤 폐기 수량은 작은 값
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  lend := (public.send_sample(lot1, '{"from_team":"qa","to_team":"qc","sample_kind":"retention","quantity":"2","unit":"바이알"}')).id;
  total := total + 1;
  begin
    perform public.dispose_sample(r1, now(), null);
    failures := failures || '빌려준 것이 인수 대기인데 폐기됨'::text;
  exception when others then
    if sqlerrm <> 'QC에 넘긴 보존 검체가 돌아오지 않았습니다. 반납 확인 뒤 폐기해 주세요.' then failures := failures || ('빌려줌: ' || sqlerrm); end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.receive_sample(lend, 'QC 냉장고');
  perform public.return_sample(lend, 1);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 반납 대기도 막힘
  begin
    perform public.dispose_sample(r1, now(), null);
    failures := failures || '반납 대기인데 폐기됨'::text;
  exception when others then
    if sqlerrm not like 'QC에 넘긴 보존 검체가%' then failures := failures || ('반납 대기: ' || sqlerrm); end if;
  end;
  perform public.confirm_sample_return(lend);
  res := public.dispose_sample(r1, now(), null);
  execute 'reset role';
  total := total + 1; -- 반납 확인 뒤 됨, 폐기 수량 least(4, 4 − 2 + 1) = 3, 보관 수 0
  if (res->>'disposed_quantity')::int <> 3 or private.qa_retained_quantity(lot1) <> 0 then
    failures := failures || format('빌려준 뒤 폐기 수량 %s, 보관 수 %s', res, private.qa_retained_quantity(lot1));
  end if;
  total := total + 1; -- 이력 글은 폐기 수량
  if not exists (select 1 from public.work_history where target_id = r1 and action = '검체 폐기 (생산 → QA, 보존 검체 3 바이알)') then
    failures := failures || '빌려준 뒤 이력 글'::text;
  end if;

  ----------------------------------------------------------------------------
  total := total + 1; -- 출하 완료 로트의 보존 검체도 폐기할 수 있음 (spec 경계 상황)
  perform set_config('pharmaflow.resetting', 'on', true);
  update public.batch set status = 'shipped', shipped_at = now() - interval '2 years', shipped_by = prod,
                          ship_recorded_at = now() - interval '2 years' where id = lot4;
  perform set_config('pharmaflow.resetting', 'off', true);
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.dispose_sample(r4, now(), null);
  exception when others then
    failures := failures || ('출하 완료 로트 폐기: ' || sqlerrm);
  end;
  total := total + 1; -- 폐기한 건으로 알림이 다시 생기지 않음
  n := public.notify_due_retention();
  execute 'reset role';
  if n <> 0 then failures := failures || format('폐기 뒤 알림 %s건', n); end if;

  ----------------------------------------------------------------------------
  -- FR-007: 되돌리기 뒤 기한 지난 예시
  -- 실제 자료에는 앱을 열 때 이미 만든 예시 알림이 있을 수 있어, 되돌리기 전후 수를 비교한다
  select count(*) into m from public.notification where kind = 'retention_due';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.reset_sample_data();
  execute 'reset role';
  total := total + 1;
  select t.* into row_t from public.sample_transfer t join public.batch b on b.id = t.batch_id where b.batch_number = 'IFV-2410-001';
  if (select status from public.batch where batch_number = 'IFV-2410-001') is distinct from 'shipped'
     or row_t.status <> 'held' or row_t.quantity <> 4 or row_t.from_team <> 'production' or row_t.to_team <> 'qa'
     or private.retention_due(row_t.received_at) <> date '2026-10-15' then
    failures := failures || '되돌린 뒤 IFV-2410-001 예시'::text;
  end if;
  total := total + 1; -- 시험값 3개 정상, 로트 9·검체 10
  if (select count(*) from public.measurement m join public.batch b on b.id = m.batch_id
       where b.batch_number = 'IFV-2410-001' and m.result = 'pass') <> 3
     or (select count(*) from public.batch) <> 9 or (select count(*) from public.sample_transfer) <> 10 then
    failures := failures || format('되돌린 뒤 수: 로트 %s, 검체 %s', (select count(*) from public.batch), (select count(*) from public.sample_transfer));
  end if;
  total := total + 1; -- 예시를 넣을 때는 알림을 만들지 않는다 (앱을 열 때 만든다)
  if (select count(*) from public.notification where kind = 'retention_due') <> m then
    failures := failures || '되돌리기 때 기한 알림이 생김'::text;
  end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
