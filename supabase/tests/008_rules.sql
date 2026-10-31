-- spec 008 데이터베이스 시험 (plan 008 §4). 001~007과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  product_id uuid;
  lot uuid;
  t_qa uuid; t_qc uuid; t_test uuid;
  row_out public.sample_transfer;
  input jsonb := jsonb_build_object('from_team', 'production', 'to_team', 'qa', 'sample_kind', 'retention',
                                    'quantity', 4, 'unit', '바이알', 'note', '보존 검체');
  n int;
  v text;
  total int := 0;
  off_hours int;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa8@test.local', '{"full_name":"시험 QA8"}'),
    (qc, 'qc8@test.local', '{"full_name":"시험 QC8"}'),
    (prod, 'prod8@test.local', '{"full_name":"시험 생산8"}'),
    (viewer, 'viewer8@test.local', '{"full_name":"시험 열람8"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;
  insert into public.product (item_name) values ('시험 백신 008 (교육용 가상)') returning id into product_id;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  lot := (public.create_batch('Q8-001', product_id)).id;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-001 전달 등록: 역할·길·입력 검사
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 열람자 거부
  begin
    perform public.send_sample(lot, input);
    failures := failures || '열람자가 검체를 보냄'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('열람자 거부 코드: ' || sqlstate); end if; end;
  total := total + 1; -- 표에 직접 쓰기 막힘
  begin
    insert into public.sample_transfer (batch_id, sample_kind, from_team, to_team, quantity, unit, sent_by)
    values (lot, 'retention', 'production', 'qa', 1, '바이알', viewer);
    failures := failures || '표에 직접 씀'::text;
  exception when others then null; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- QC는 보낼 길이 없다
  begin
    perform public.send_sample(lot, input || '{"from_team":"qc","to_team":"qa"}');
    failures := failures || 'QC가 검체를 보냄'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('QC 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 생산은 QA → QC 길·종류 엇갈림을 못 쓴다
  n := 0;
  begin perform public.send_sample(lot, input || '{"from_team":"qa","to_team":"qc"}');
  exception when others then if sqlerrm like '%보낼 수 있는 길이 아닙니다%' then n := n + 1; end if; end;
  begin perform public.send_sample(lot, input || '{"sample_kind":"test"}');
  exception when others then if sqlerrm like '%보낼 수 있는 길이 아닙니다%' then n := n + 1; end if; end;
  if n <> 2 then failures := failures || format('길 막기 %s/2', n); end if;
  total := total + 1; -- 수량 0·10000·1.5·빈 값, 단위, 메모 201자, 없는 로트
  n := 0;
  begin perform public.send_sample(lot, input || '{"quantity":0}');
  exception when others then if sqlerrm like '%수량은 1부터 9999까지%' then n := n + 1; end if; end;
  begin perform public.send_sample(lot, input || '{"quantity":10000}');
  exception when others then if sqlerrm like '%수량은 1부터 9999까지%' then n := n + 1; end if; end;
  begin perform public.send_sample(lot, input || '{"quantity":1.5}');
  exception when others then if sqlerrm like '%수량은 1부터 9999까지%' then n := n + 1; end if; end;
  begin perform public.send_sample(lot, input - 'quantity');
  exception when others then if sqlerrm like '%수량은 1부터 9999까지%' then n := n + 1; end if; end;
  begin perform public.send_sample(lot, input || '{"unit":"상자"}');
  exception when others then if sqlerrm like '%단위는 바이알%' then n := n + 1; end if; end;
  begin perform public.send_sample(lot, input || jsonb_build_object('note', repeat('가', 201)));
  exception when others then if sqlerrm like '%메모는 200자까지%' then n := n + 1; end if; end;
  begin perform public.send_sample(gen_random_uuid(), input);
  exception when others then if sqlerrm like '%로트를 찾을 수 없습니다%' then n := n + 1; end if; end;
  if n <> 7 then failures := failures || format('입력 검사 %s/7', n); end if;

  total := total + 1; -- 생산 → QA 보존 검체 4 바이알: 인수 대기, 보낸 사람 자동
  row_out := public.send_sample(lot, input || '{"note":"  보존 검체  "}');
  t_qa := row_out.id;
  if row_out.status <> 'pending' or row_out.sent_by <> prod or row_out.sent_at is null or row_out.note <> '보존 검체' then
    failures := failures || format('전달 등록: %s %s', row_out.status, row_out.note);
  end if;
  t_test := (public.send_sample(lot, jsonb_build_object('from_team', 'production', 'to_team', 'qc', 'sample_kind', 'test',
                                                        'quantity', 6, 'unit', '바이알'))).id;

  ----------------------------------------------------------------------------
  -- FR-002 인수 확인
  total := total + 1; -- 보낸 팀은 인수 확인 못 함
  begin
    perform public.receive_sample(t_qa, '냉장고');
    failures := failures || '생산이 QA 검체를 인수 확인함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('인수 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 보관 위치 빈칸·61자
  n := 0;
  begin perform public.receive_sample(t_qa, '   ');
  exception when others then if sqlerrm like '%보관 위치를 입력해 주세요%' then n := n + 1; end if; end;
  begin perform public.receive_sample(t_qa, repeat('가', 61));
  exception when others then if sqlerrm like '%보관 위치는 60자까지%' then n := n + 1; end if; end;
  if n <> 2 then failures := failures || format('보관 위치 검사 %s/2', n); end if;
  total := total + 1; -- QA 인수: 보관 중·인수자·위치
  row_out := public.receive_sample(t_qa, ' 보존검체실 냉장고 R-02 1단 ');
  if row_out.status <> 'held' or row_out.received_by <> qa or row_out.received_at is null
     or row_out.storage_location <> '보존검체실 냉장고 R-02 1단' then
    failures := failures || format('인수 확인: %s %s', row_out.status, row_out.storage_location);
  end if;
  total := total + 1; -- 같은 건 두 번 인수 막힘
  begin
    perform public.receive_sample(t_qa, '냉장고');
    failures := failures || '두 번 인수됨'::text;
  exception when others then if sqlerrm not like '%이미 인수 확인된 검체입니다%' then failures := failures || ('두 번 인수 문구: ' || sqlerrm); end if; end;

  ----------------------------------------------------------------------------
  -- QA → QC: 보관 수 넘으면 막힘, 반납·반납 확인 (FR-003, Q47)
  total := total + 1;
  begin
    perform public.send_sample(lot, jsonb_build_object('from_team', 'qa', 'to_team', 'qc', 'sample_kind', 'retention', 'quantity', 5, 'unit', '바이알'));
    failures := failures || '보관 수보다 많이 보냄'::text;
  exception when others then if sqlerrm not like '%보관 중인 보존 검체가 4 바이알이라%' then failures := failures || ('보관 수 문구: ' || sqlerrm); end if; end;
  t_qc := (public.send_sample(lot, jsonb_build_object('from_team', 'qa', 'to_team', 'qc', 'sample_kind', 'retention', 'quantity', 2, 'unit', '바이알'))).id;
  execute 'reset role';
  total := total + 1;
  if private.qa_retained_quantity(lot) <> 2 then failures := failures || format('보관 수(넘긴 뒤) %s', private.qa_retained_quantity(lot)); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.receive_sample(t_qc, 'QC 시험실 냉장고 R-01');
  total := total + 1; -- 반납 수량 0·3 막힘, 1은 반납 대기
  n := 0;
  begin perform public.return_sample(t_qc, 0);
  exception when others then if sqlerrm like '%반납 수량은 1부터 받은 수량(2)까지%' then n := n + 1; end if; end;
  begin perform public.return_sample(t_qc, 3);
  exception when others then if sqlerrm like '%반납 수량은 1부터 받은 수량(2)까지%' then n := n + 1; end if; end;
  row_out := public.return_sample(t_qc, 1);
  if n <> 2 or row_out.status <> 'return_pending' or row_out.returned_quantity <> 1 or row_out.return_requested_by <> qc then
    failures := failures || format('반납: 막기 %s/2, %s', n, row_out.status);
  end if;
  total := total + 1; -- 받은 팀은 반납 확인 못 함
  begin
    perform public.confirm_sample_return(t_qc);
    failures := failures || 'QC가 반납 확인함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('반납 확인 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- QA 반납 확인: 반납 완료·확인자·반납 일시, 보관 수 3
  row_out := public.confirm_sample_return(t_qc);
  execute 'reset role';
  n := private.qa_retained_quantity(lot);
  execute 'set local role authenticated';
  if row_out.status <> 'returned' or row_out.return_confirmed_by <> qa or row_out.returned_at is null or n <> 3 then
    failures := failures || format('반납 확인: %s, 보관 수 %s', row_out.status, n);
  end if;
  total := total + 1; -- 끝난 건 다시 반납 확인 막힘
  begin
    perform public.confirm_sample_return(t_qc);
    failures := failures || '두 번 반납 확인됨'::text;
  exception when others then if sqlerrm not like '%반납 대기인 검체만%' then failures := failures || ('두 번 반납 확인 문구: ' || sqlerrm); end if; end;
  total := total + 1; -- QA가 보관한 검체는 소진 못 함 (QC가 받은 건만)
  begin
    perform public.consume_sample(t_qa);
    failures := failures || 'QA가 소진함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('QA 소진 거부 코드: ' || sqlstate); end if; end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-004 소진
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 인수 대기 건은 소진 못 함, 인수 뒤 소진
  begin
    perform public.consume_sample(t_test);
    failures := failures || '인수 전에 소진됨'::text;
  exception when others then if sqlerrm not like '%보관 중인 검체만 소진%' then failures := failures || ('소진 상태 문구: ' || sqlerrm); end if; end;
  perform public.receive_sample(t_test, 'QC 시험실 냉장고 R-01');
  row_out := public.consume_sample(t_test);
  if row_out.status <> 'consumed' or row_out.consumed_by <> qc or row_out.consumed_at is null then
    failures := failures || format('소진: %s', row_out.status);
  end if;
  total := total + 1; -- 소진된 건은 반납 못 함
  begin
    perform public.return_sample(t_test, 1);
    failures := failures || '소진된 검체를 반납함'::text;
  exception when others then if sqlerrm not like '%보관 중인 검체만 반납%' then failures := failures || ('소진 뒤 반납 문구: ' || sqlerrm); end if; end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-007 업무 이력
  total := total + 1;
  select string_agg(action, ' | ' order by created_at, id) into v from public.work_history
   where batch_id = lot and target_table = 'sample_transfer' and target_id = t_qc;
  if v is distinct from '검체 전달 (QA → QC, 보존 검체 2 바이알) | 검체 인수 확인 (QA → QC, 보존 검체 2 바이알) | '
                     || '검체 반납 (QA → QC, 보존 검체 1 바이알) | 검체 반납 확인 (QA → QC, 보존 검체 1 바이알)' then
    failures := failures || ('이력: ' || coalesce(v, '없음'));
  end if;
  total := total + 1;
  select count(*) into n from public.work_history
   where target_id = t_test and action = '검체 소진 (생산 → QC, 시험 검체 6 바이알)' and batch_number = 'Q8-001';
  if n <> 1 then failures := failures || format('소진 이력 %s줄', n); end if;

  total := total + 1; -- 로그인한 사람은 읽음, 로그인하지 않은 사람은 못 읽음
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.sample_transfer where batch_id = lot;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    select count(*) into v from public.sample_transfer;
  exception when others then v := '0'; end;
  execute 'reset role';
  if n <> 3 or v <> '0' then failures := failures || format('읽기 권한: 열람자 %s, anon %s', n, v); end if;

  ----------------------------------------------------------------------------
  -- FR-008 예시 자료 (3단계): 되돌리기가 검체가 붙은 로트도 지우고, 예시 검체 9건을 다시 넣는다
  perform private.replace_sample_data(qa);
  total := total + 1; -- 핵심 자료 표와 같은 9건·다섯 상태 + spec 018 FR-007 기한 지난 보존 검체 1건
  select string_agg(b.batch_number || ':' || t.from_team || '>' || t.to_team || ':' || t.status, ' '
                    order by b.batch_number, t.sent_at, t.to_team::text) into v
    from public.sample_transfer t join public.batch b on b.id = t.batch_id;
  if v is distinct from 'HBV-2610-001:production>qc:pending HBV-2610-002:production>qa:held HBV-2610-002:qa>qc:return_pending '
                     || 'HBV-2610-003:production>qa:held HBV-2610-003:qa>qc:returned IFV-2410-001:production>qa:held IFV-2610-003:production>qc:held '
                     || 'IFV-2610-003:production>qa:pending IFV-2610-004:production>qa:held IFV-2610-004:production>qc:consumed' then
    failures := failures || ('예시 검체: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- QA 보관 수: IFV-004 4, HBV-002 2, HBV-003 3, IFV-003 0
  select string_agg(b.batch_number || '=' || private.qa_retained_quantity(b.id), ' ' order by b.batch_number) into v
    from public.batch b where b.batch_number in ('IFV-2610-003', 'IFV-2610-004', 'HBV-2610-002', 'HBV-2610-003');
  if v is distinct from 'HBV-2610-002=2 HBV-2610-003=3 IFV-2610-003=0 IFV-2610-004=4' then
    failures := failures || ('예시 보관 수: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 이력 22줄(전달 10 + 처리 12, spec 018 예시 2줄 포함), 모두 근무 시간(한국 시각 8~18시)이고 지금보다 앞
  select count(*), count(*) filter (where extract(hour from created_at at time zone 'Asia/Seoul') not between 8 and 17 or created_at > now())
    into n, off_hours from public.work_history h
   where h.target_table = 'sample_transfer' and h.target_id in (select id from public.sample_transfer);
  if n <> 22 or off_hours <> 0 then failures := failures || format('예시 검체 이력 %s줄, 근무 시간 밖 %s', n, off_hours); end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
