-- spec 010 데이터베이스 시험 (plan 010 §4). 001~009와 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 알림·이력 비교는 이 시험이 만든 것만 본다(실제 자료가 있어도 되게). 번호가 실제 자료와 겹치지 않게 계획 시작일은 2099년으로 둔다.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  product_id uuid;
  w1 public.work_order;
  w2 public.work_order;
  w3 public.work_order;
  w4 public.work_order;
  started public.work_order;
  lot public.batch;
  base jsonb;
  bad record;
  v text;
  n int;
  before_n int;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa10@test.local', '{"full_name":"시험 QA10"}'),
    (qc, 'qc10@test.local', '{"full_name":"시험 QC10"}'),
    (prod, 'prod10@test.local', '{"full_name":"시험 생산10"}'),
    (viewer, 'viewer10@test.local', '{"full_name":"시험 열람10"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;
  -- 발행 알림은 생산 담당자 모두에게 가므로 실제 계정은 이 시험 안에서만 열람자로 둔다 (끝에서 되돌림)
  update public.profile set role = 'viewer' where id not in (qa, qc, prod, viewer);
  insert into public.product (item_name) values ('시험 백신 010 (교육용 가상)') returning id into product_id;
  base := jsonb_build_object('product_id', product_id, 'planned_quantity', '5000', 'unit', '바이알',
                             'planned_start', '2099-11-02', 'planned_end', '2099-11-06');

  ----------------------------------------------------------------------------
  -- FR-001 작성: 생산 담당자, 번호는 시작일 연월 + 순번 (Q61)
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  w1 := public.create_work_order(base || '{"note":"  첫 지시  "}');
  w2 := public.create_work_order(base);
  w3 := public.create_work_order(base || '{"planned_start":"2099-12-01","planned_end":"2099-12-01","unit":"L","planned_quantity":"0.5"}');
  total := total + 1;
  if (w1.order_number, w2.order_number, w3.order_number) is distinct from ('WO-9911-001', 'WO-9911-002', 'WO-9912-001') then
    failures := failures || ('번호: ' || w1.order_number || ',' || w2.order_number || ',' || w3.order_number);
  end if;
  total := total + 1;
  if w1.status <> 'draft' or w1.created_by <> prod or w1.note <> '첫 지시' or w3.planned_quantity <> 0.5 then
    failures := failures || '작성 결과(상태·작성자·메모 정리·소수 수량)가 다름'::text;
  end if;

  -- 경계 상황: 입력 검사 문구
  for bad in select * from (values
    (base || '{"planned_quantity":"0"}', '계획 수량은 0보다 큰 숫자로 입력해 주세요.'),
    (base || '{"planned_quantity":"-1"}', '계획 수량은 0보다 큰 숫자로 입력해 주세요.'),
    (base || '{"planned_quantity":"abc"}', '계획 수량은 0보다 큰 숫자로 입력해 주세요.'),
    (base || '{"planned_quantity":""}', '계획 수량은 0보다 큰 숫자로 입력해 주세요.'),
    (base || '{"planned_quantity":"1000001"}', '계획 수량이 너무 큽니다. 1,000,000 이하로 입력해 주세요.'),
    (base || '{"unit":"g"}', '단위를 골라 주세요.'),
    (base || '{"planned_end":"2099-11-01"}', '계획 종료일은 시작일과 같거나 뒤여야 합니다.'),
    (base || '{"planned_start":""}', '계획 시작일과 종료일을 입력해 주세요.'),
    (base || '{"planned_end":"아무거나"}', '계획 시작일과 종료일을 입력해 주세요.'),
    (base || jsonb_build_object('product_id', gen_random_uuid()), '제품을 골라 주세요.'),
    (base || jsonb_build_object('note', repeat('가', 201)), '메모는 200자까지 입력해 주세요.')
  ) as t(input, message) loop
    total := total + 1;
    begin
      perform public.create_work_order(bad.input);
      failures := failures || ('막히지 않음: ' || bad.message);
    exception when others then
      if sqlerrm <> bad.message then failures := failures || ('문구 다름: ' || sqlerrm); end if;
    end;
  end loop;

  -- FR-002 수용 기준 2: 생산 담당자는 발행 못 함. FR-007: 로트 직접 등록 못 함
  total := total + 1;
  begin
    perform public.release_work_order(w1.id);
    failures := failures || '생산 담당자가 발행함'::text;
  exception when others then
    if sqlstate <> '42501' then failures := failures || ('생산 발행 오류 종류: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.create_batch('Q10-DIRECT', product_id);
    failures := failures || '생산 담당자가 로트를 직접 등록함'::text;
  exception when others then
    if sqlstate <> '42501' then failures := failures || ('생산 로트 등록 오류 종류: ' || sqlerrm); end if;
  end;
  -- 표에 직접 쓰기 막힘 (ADR 0002)
  total := total + 1;
  begin
    insert into public.work_order (order_number, product_id, planned_quantity, unit, planned_start, planned_end, created_by)
    values ('WO-9911-999', product_id, 1, '개', '2099-11-01', '2099-11-01', prod);
    failures := failures || '표에 직접 넣어짐'::text;
  exception when others then null;
  end;
  -- FR-003 수용 기준 3: 작성 상태는 착수 못 함
  total := total + 1;
  begin
    perform public.start_work_order(w1.id, 'Q10-001');
    failures := failures || '작성 상태가 착수됨'::text;
  exception when others then
    if sqlerrm <> '발행된 작업지시만 착수할 수 있습니다.' then failures := failures || ('작성 착수 문구: ' || sqlerrm); end if;
  end;

  -- FR-001 수용 기준 3: QC·열람자는 작성·착수·취소 못 함
  for v in select unnest(array[qc::text, viewer::text]) loop
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    total := total + 1;
    begin
      perform public.create_work_order(base);
      failures := failures || 'QC·열람자가 작성함'::text;
    exception when others then
      if sqlstate <> '42501' then failures := failures || ('QC·열람 작성 오류 종류: ' || sqlerrm); end if;
    end;
    total := total + 1;
    begin
      perform public.cancel_work_order(w2.id, '사유');
      failures := failures || 'QC·열람자가 취소함'::text;
    exception when others then
      if sqlstate <> '42501' then failures := failures || ('QC·열람 취소 오류 종류: ' || sqlerrm); end if;
    end;
  end loop;

  ----------------------------------------------------------------------------
  -- FR-002 발행 (QA), 두 번 발행 막힘
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  lot := public.create_batch('Q10-EXIST', product_id); -- FR-007 수용 기준 2: QA는 지금처럼 된다
  w1 := public.release_work_order(w1.id);
  w2 := public.release_work_order(w2.id);
  total := total + 1;
  if w1.status <> 'released' or w1.released_by <> qa or w1.released_at is null then
    failures := failures || '발행 결과가 다름'::text;
  end if;
  total := total + 1;
  begin
    perform public.release_work_order(w1.id);
    failures := failures || '두 번 발행됨'::text;
  exception when others then
    if sqlerrm <> '작성 상태인 작업지시만 발행할 수 있습니다.' then failures := failures || ('재발행 문구: ' || sqlerrm); end if;
  end;
  -- Q59: QA가 자기가 작성한 것도 발행
  w4 := public.create_work_order(base || '{"planned_start":"2099-11-20","planned_end":"2099-11-21"}');
  total := total + 1;
  begin
    perform public.release_work_order(w4.id);
  exception when others then
    failures := failures || ('QA 자기 작성 발행 실패: ' || sqlerrm);
  end;

  ----------------------------------------------------------------------------
  -- FR-003 착수 (생산): 겹치는 로트번호면 작업지시·로트 그대로, 새 번호면 로트 생성·연결
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.start_work_order(w1.id, '  Q10-EXIST ');
    failures := failures || '겹치는 로트번호로 착수됨'::text;
  exception when others then
    if sqlerrm <> '이미 있는 로트번호입니다.' then failures := failures || ('겹침 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  select count(*) into n from public.batch where batch_number like 'Q10-%';
  if (select status from public.work_order where id = w1.id) <> 'released' or n <> 1 then
    failures := failures || '겹침 뒤 작업지시나 로트가 바뀜'::text;
  end if;
  total := total + 1;
  begin
    perform public.start_work_order(w1.id, '   ');
    failures := failures || '빈 로트번호로 착수됨'::text;
  exception when others then
    if sqlerrm <> '로트번호를 입력해 주세요.' then failures := failures || ('빈 로트번호 문구: ' || sqlerrm); end if;
  end;
  started := public.start_work_order(w1.id, ' Q10-001 ');
  select * into lot from public.batch where id = started.batch_id;
  total := total + 1;
  if started.status <> 'in_progress' or started.started_by <> prod or lot.batch_number <> 'Q10-001'
     or lot.status <> 'in_production' or lot.product_id <> product_id or lot.created_by <> prod then
    failures := failures || '착수 결과(진행 중·로트 생성·제품·만든 사람)가 다름'::text;
  end if;
  total := total + 1;
  begin
    perform public.start_work_order(w1.id, 'Q10-002');
    failures := failures || '두 번 착수됨'::text;
  exception when others then
    if sqlerrm <> '발행된 작업지시만 착수할 수 있습니다.' then failures := failures || ('재착수 문구: ' || sqlerrm); end if;
  end;

  ----------------------------------------------------------------------------
  -- FR-004 취소: 진행 중 막힘, 사유 필수, 발행·작성은 됨
  total := total + 1;
  begin
    perform public.cancel_work_order(w1.id, '사유');
    failures := failures || '진행 중이 취소됨'::text;
  exception when others then
    if sqlerrm <> '착수한 작업지시는 취소할 수 없습니다. 로트를 그만두려면 품질 이슈에서 로트 폐기 조치를 요청해 주세요.' then
      failures := failures || ('진행 중 취소 문구: ' || sqlerrm);
    end if;
  end;
  total := total + 1;
  begin
    perform public.cancel_work_order(w2.id, '   ');
    failures := failures || '사유 없이 취소됨'::text;
  exception when others then
    if sqlerrm <> '취소 사유를 입력해 주세요.' then failures := failures || ('빈 사유 문구: ' || sqlerrm); end if;
  end;
  w2 := public.cancel_work_order(w2.id, ' 수량 오기 ');
  w3 := public.cancel_work_order(w3.id, '계획 변경');
  total := total + 1;
  if w2.status <> 'cancelled' or w2.cancel_reason <> '수량 오기' or w2.cancelled_by <> prod or w3.status <> 'cancelled' then
    failures := failures || '취소 결과가 다름'::text;
  end if;
  total := total + 1;
  begin
    perform public.cancel_work_order(w2.id, '또');
    failures := failures || '두 번 취소됨'::text;
  exception when others then
    if sqlerrm <> '이미 취소된 작업지시입니다.' then failures := failures || ('재취소 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.release_work_order(w3.id);
    failures := failures || '취소된 것이 발행됨'::text;
  exception when others then null;
  end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-008 업무 이력: 작성·발행·착수·취소, 착수는 로트 이력에도
  total := total + 1;
  select string_agg(h.action, ' | ' order by h.created_at) into v
    from public.work_history h where h.target_table = 'work_order' and h.target_id = w1.id;
  if v is distinct from '작업지시 작성 (WO-9911-001) | 작업지시 발행 (WO-9911-001) | 작업지시 착수 (WO-9911-001)' then
    failures := failures || ('작업지시 이력: ' || coalesce(v, '없음'));
  end if;
  total := total + 1;
  select string_agg(h.action || '@' || h.batch_number, ' | ' order by h.created_at) into v
    from public.work_history h where h.batch_id = started.batch_id;
  if v is distinct from '로트 등록@Q10-001 | 작업지시 착수 (WO-9911-001)@Q10-001' then
    failures := failures || ('로트 이력: ' || coalesce(v, '없음'));
  end if;
  total := total + 1;
  if not exists (select 1 from public.work_history h where h.target_id = w2.id and h.action = '작업지시 취소 (WO-9911-002)' and h.actor_id = prod) then
    failures := failures || '취소 이력 없음'::text;
  end if;

  -- FR-009 발행 알림: 생산 담당자에게만 한 건씩, 발행한 QA·QC·열람자 없음
  total := total + 1;
  select string_agg(p.display_name || ':' || n2.message || ':' || n2.link_path, ' | ' order by n2.message) into v
    from public.notification n2 join public.profile p on p.id = n2.recipient_id
   where n2.kind = 'work_order_released' and n2.created_by in (qa, qc, prod, viewer);
  if v is distinct from '시험 생산10:작업지시 발행 · WO-9911-001 · 시험 백신 010 (교육용 가상) 5,000 바이알 · 시작 11-02 · 발행 시험 QA10:#/work-orders?q=WO-9911-001'
                     || ' | 시험 생산10:작업지시 발행 · WO-9911-002 · 시험 백신 010 (교육용 가상) 5,000 바이알 · 시작 11-02 · 발행 시험 QA10:#/work-orders?q=WO-9911-002'
                     || ' | 시험 생산10:작업지시 발행 · WO-9911-003 · 시험 백신 010 (교육용 가상) 5,000 바이알 · 시작 11-20 · 발행 시험 QA10:#/work-orders?q=WO-9911-003' then
    failures := failures || ('발행 알림: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 작성·착수·취소는 알림이 없다
  select count(*) into n from public.notification where kind <> 'work_order_released' and created_by in (qa, qc, prod, viewer);
  if n <> 0 then
    failures := failures || ('발행 말고 알림이 생김: ' || n);
  end if;

  ----------------------------------------------------------------------------
  -- FR-010 (3단계): 되돌리기 뒤 예시 작업지시 — 진행 중 8(예시 로트마다)·작성 1·발행 2·취소 1, 미래 시각 없음
  execute 'reset role';
  perform private.replace_sample_data(qa);
  total := total + 1;
  select string_agg(status::text || ' ' || cnt::text, ', ' order by status) into v
    from (select status, count(*) as cnt from public.work_order group by status) c;
  -- spec 011 3단계: 모든 공정 단계를 마친 예시 로트 6개의 작업지시는 완료 (IFV-2610-001·TDP-2610-001만 진행 중)
  if v is distinct from 'draft 1, released 2, in_progress 2, completed 6, cancelled 1' then failures := failures || ('예시 상태: ' || coalesce(v, '없음')); end if;
  total := total + 1;
  select count(*) into n from public.batch b join public.work_order w on w.batch_id = b.id
   where b.batch_number in ('IFV-2610-001', 'IFV-2610-002', 'IFV-2610-003', 'IFV-2610-004', 'HBV-2610-001', 'HBV-2610-002', 'HBV-2610-003', 'TDP-2610-001')
     and w.started_at = b.created_at + interval '1 second' and w.product_id = b.product_id;
  if n <> 8 then failures := failures || ('예시 로트 연결: ' || n || '/8'); end if;
  total := total + 1;
  if exists (select 1 from public.work_order where greatest(created_at, released_at, started_at, cancelled_at) > now())
     or exists (select 1 from public.work_history where target_table = 'work_order' and created_at > now()
                  and target_id in (select id from public.work_order)) then
    failures := failures || '예시 작업지시에 미래 시각'::text;
  end if;
  total := total + 1; -- 착수 이력은 그 로트에도, 이력 수 = 작성 12 + 발행 10 + 착수 8 + 취소 1 + 완료 6 (spec 011)
  select count(*), count(*) filter (where action like '작업지시 착수%' and batch_id is not null) into n, before_n
    from public.work_history where target_table = 'work_order' and target_id in (select id from public.work_order);
  if n <> 37 or before_n <> 8 then failures := failures || format('예시 이력 %s줄, 착수 로트 연결 %s', n, before_n); end if;
  total := total + 1; -- 한 번 더 불러도 늘지 않는다 (지금 자료에 더할 때와 같은 규칙)
  perform private.seed_work_orders(qa);
  if (select count(*) from public.work_order) <> 12 then failures := failures || '예시를 두 번 넣음'::text; end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
