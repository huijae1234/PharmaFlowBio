-- spec 003 데이터베이스 시험 (plan 003 §4). 001·002_rules.sql과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 되돌리기(FR-010) 사례는 맨 끝 (실제 자료를 모두 바꾸므로 마지막에, 끝에서 모두 되돌림).
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  sample_product uuid;
  p1 uuid;
  b1 uuid;
  h1 uuid;
  n int;
  history_before int; profiles_before int; usage_before int; reset_started timestamptz;
  v text;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa3@test.local', '{"full_name":"시험 QA3"}'),
    (qc, 'qc3@test.local', '{"full_name":"시험 QC3"}'),
    (prod, 'prod3@test.local', '{"full_name":"시험 생산3"}'),
    (viewer, 'viewer3@test.local', '{"full_name":"시험 열람3"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;

  ----------------------------------------------------------------------------
  -- FR-001 허가정보로 제품 등록 (QA만, 같은 품목기준코드 거부, Q26)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  p1 := (public.create_product('  시험타이레놀정  ', 'Acetaminophen', '시험제약', 'T3-000001')).id;
  select count(*) into n from public.product where id = p1 and item_name = '시험타이레놀정'
     and main_ingredient = 'Acetaminophen' and manufacturer = '시험제약' and permit_item_code = 'T3-000001';
  if n <> 1 then failures := failures || '제품 등록 값이 다름(앞뒤 공백 정리 포함)'::text; end if;
  total := total + 1;
  select count(*) into n from public.work_history where target_id = p1 and action = '제품 등록' and actor_id = qa;
  if n <> 1 then failures := failures || '업무 이력에 "제품 등록"이 없음'::text; end if;
  total := total + 1; -- 같은 품목은 다시 등록 못 함
  begin
    perform public.create_product('시험타이레놀정', null, null, 'T3-000001');
    failures := failures || '같은 품목기준코드가 다시 등록됨'::text;
  exception when others then
    if sqlerrm not like '%이미 등록된 제품입니다%' then failures := failures || ('중복 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 품목명 빈 값
  begin
    perform public.create_product('   ', null, null, 'T3-000002');
    failures := failures || '빈 품목명이 등록됨'::text;
  exception when others then
    if sqlerrm not like '%품목명을 입력해 주세요%' then failures := failures || ('빈 품목명 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 품목기준코드 빈 값 (허가정보 검색으로만 등록, Q26)
  begin
    perform public.create_product('코드없는정', null, null, '');
    failures := failures || '품목기준코드 없이 등록됨'::text;
  exception when others then
    if sqlerrm not like '%허가정보에서 제품을 골라 주세요%' then failures := failures || ('코드 문구: ' || sqlerrm); end if;
  end;
  -- 배치 하나 (업무 이력 batch_number 확인용)
  sample_product := p1;
  b1 := (public.create_batch('Q3-001', sample_product)).id;
  execute 'reset role';

  total := total + 1; -- QA가 아니면 거부
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.create_product('QC등록정', null, null, 'T3-000003');
    failures := failures || 'QC가 제품을 등록함'::text;
  exception when others then
    if sqlstate <> '42501' then failures := failures || ('QC 제품 등록 거부 코드: ' || sqlstate); end if;
  end;

  ----------------------------------------------------------------------------
  -- FR-007 취급점검 기록 (QC·생산·QA, 빈 값 거부, 열람자 거부)
  total := total + 1;
  h1 := (public.save_handling_check('000001', '벤젠', '71-43-2', '  보관함 밀폐 상태 확인  ', '보호장갑·보안경 착용')).id;
  select count(*) into n from public.handling_check where id = h1 and checked_by = qc
     and check_content = '보관함 밀폐 상태 확인' and chem_name = '벤젠' and cas_no = '71-43-2';
  if n <> 1 then failures := failures || 'QC 취급점검 기록 값이 다름'::text; end if;
  total := total + 1;
  begin
    perform public.save_handling_check('000001', '벤젠', null, '   ', '보호장갑');
    failures := failures || '빈 점검 내용이 저장됨'::text;
  exception when others then
    if sqlerrm not like '%점검 내용을 입력해 주세요%' then failures := failures || ('빈 점검 내용 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.save_handling_check('000001', '벤젠', null, '밀폐 확인', '');
    failures := failures || '빈 보호조치가 저장됨'::text;
  exception when others then
    if sqlerrm not like '%보호조치를 입력해 주세요%' then failures := failures || ('빈 보호조치 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.save_handling_check('000001', '벤젠', null, repeat('가', 501), '보호장갑');
    failures := failures || '501자 점검 내용이 저장됨'::text;
  exception when others then
    if sqlerrm not like '%500자까지%' then failures := failures || ('500자 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 물질 식별값·이름 없음
  begin
    perform public.save_handling_check('', '벤젠', null, '밀폐 확인', '보호장갑');
    failures := failures || '물질 식별값 없이 저장됨'::text;
  exception when others then
    if sqlerrm not like '%물질을 다시 골라 주세요%' then failures := failures || ('물질 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 표에 직접 쓰기는 막힘
  begin
    insert into public.handling_check (chem_id, chem_name, check_content, protective_measures, checked_by)
      values ('000001', '벤젠', '직접', '직접', qc);
    failures := failures || '취급점검 표에 직접 쓰기가 됨'::text;
  exception when others then
    null;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  perform public.save_handling_check('000001', '벤젠', '71-43-2', '환기 장치 작동 확인', '방독 마스크');
  select count(*) into n from public.handling_check where chem_id = '000001' and checked_by = prod;
  if n <> 1 then failures := failures || '생산 담당자 취급점검 기록이 안 됨'::text; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.save_handling_check('000001', '벤젠', null, '열람자 점검', '없음');
    failures := failures || '열람자가 취급점검 기록을 씀'::text;
  exception when others then
    if sqlstate <> '42501' then failures := failures || ('열람자 거부 코드: ' || sqlstate); end if;
  end;
  execute 'reset role';

  -- 배치 없는 이력은 QA 관리자만 읽으므로(RLS) 역할을 되돌린 뒤 본다
  total := total + 1;
  select count(*) into n from public.work_history where target_id = h1 and action = '취급점검 기록' and batch_id is null;
  if n <> 1 then failures := failures || '업무 이력에 "취급점검 기록"이 없음'::text; end if;

  ----------------------------------------------------------------------------
  -- Q27 / ERD v0.6: 업무 이력에 배치번호를 글로 남긴다
  total := total + 1;
  select count(*) into n from public.work_history where batch_id = b1 and batch_number = 'Q3-001';
  if n < 1 then failures := failures || '새 이력에 batch_number가 없음'::text; end if;
  total := total + 1; -- 기존 이력도 채워짐
  select count(*) into n from public.work_history where batch_id is not null and batch_number is null;
  if n <> 0 then failures := failures || format('batch_number 빈 이력 %s줄', n); end if;
  total := total + 1; -- 배치와 상관없는 이력은 비어 있음
  select count(*) into n from public.work_history where target_id = p1 and batch_number is not null;
  if n <> 0 then failures := failures || '제품 등록 이력에 batch_number가 채워짐'::text; end if;

  ----------------------------------------------------------------------------
  -- FR-008·009 사용 기록 (RLS: 본인 기록 추가만, 읽기는 QA 관리자만, 고치기 불가)
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  select count(*) into n from public.usage_log;
  if n <> 0 then failures := failures || format('QC가 사용 기록 %s줄을 읽음', n); end if;
  total := total + 1;
  insert into public.usage_log (user_id, event_type, path) values (qc, 'page_view', '#/batches');
  total := total + 1;
  begin
    insert into public.usage_log (user_id, event_type) values (qa, 'login');
    failures := failures || '남의 사용 기록을 남김'::text;
  exception when others then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 열람자도 본인 기록은 남긴다
  insert into public.usage_log (user_id, event_type, path) values (viewer, 'page_view', '#/batches');
  total := total + 1;
  begin
    update public.usage_log set path = 'x' where user_id = viewer;
    get diagnostics n = row_count;
    if n > 0 then failures := failures || '사용 기록이 고쳐짐'::text; end if;
  exception when others then null;
  end;
  execute 'reset role';
  total := total + 1;
  select count(*) into n from public.usage_log where user_id in (qc, viewer);
  if n <> 2 then failures := failures || format('본인 기록 %s/2', n); end if;

  ----------------------------------------------------------------------------
  -- FR-010 예시 자료 되돌리기 (Q26·Q27, SC-006)
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- QA 관리자만
  begin
    perform public.reset_sample_data();
    failures := failures || 'QC가 되돌리기를 함'::text;
  exception when others then
    if sqlstate <> '42501' then failures := failures || ('되돌리기 거부 코드: ' || sqlstate); end if;
  end;
  execute 'reset role';

  select count(*) into history_before from public.work_history;
  select count(*) into profiles_before from public.profile;
  select count(*) into usage_before from public.usage_log;
  reset_started := clock_timestamp();
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.reset_sample_data();
  execute 'reset role';

  total := total + 1; -- 예시 로트는 새 예시 8개 + 기한 지난 예시 IFV-2410-001 (spec 007 FR-004, Q41, spec 018 FR-007. 자세한 모양은 007_rules)
  select string_agg(batch_number || ':' || status, ' ' order by batch_number) into v from public.batch;
  if v is distinct from 'HBV-2610-001:on_hold HBV-2610-002:in_testing HBV-2610-003:discarded IFV-2410-001:shipped IFV-2610-001:in_production '
                     || 'IFV-2610-002:in_testing IFV-2610-003:in_testing IFV-2610-004:releasable TDP-2610-001:on_hold' then
    failures := failures || ('되돌린 뒤 로트: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 예시 제품은 가상 백신 3개, 허가정보로 등록한 제품은 남음 (spec 007 Q42, 예전 Q26을 바꿈)
  if (select count(*) from public.product where permit_item_code is null) <> 3
     or exists (select 1 from public.product where permit_item_code is null and item_name not like '%(가상)')
     or not exists (select 1 from public.product where permit_item_code = 'T3-000001') then
    failures := failures || format('되돌린 뒤 제품 %s개', (select count(*) from public.product));
  end if;
  total := total + 1; -- 예시 기준 처음 값 v1 (제품 3개 기준 15개, 모두 관리기준)
  select count(*) into n from public.specification s join public.product p on p.id = s.product_id
   where p.permit_item_code is null and s.version = 1 and s.alert_min_value is not null;
  if n <> 15 then failures := failures || format('예시 기준 %s/15', n); end if;
  total := total + 1; -- 취급점검은 지우고, 조치 요청은 새 예시 것(2건)만
  if exists (select 1 from public.handling_check) or (select count(*) from public.action_request) <> 2 then
    failures := failures || '취급점검이 남거나 조치 요청 수가 다름'::text;
  end if;
  total := total + 1; -- 사용자·역할과 사용 기록은 그대로
  if (select count(*) from public.profile) <> profiles_before or (select count(*) from public.usage_log) <> usage_before
     or not exists (select 1 from public.profile where id = qa and role = 'qa_manager') then
    failures := failures || '사용자·역할이나 사용 기록이 바뀜'::text;
  end if;
  total := total + 1; -- 업무 이력은 줄지 않고 "예시 자료 되돌리기" 1줄 + 새 예시 이력(로트에 연결된 줄)만 더해짐 (spec 007 FR-004 수용 기준 3)
  select count(*) into n from public.work_history;
  -- 예시 작업지시의 작성·발행·취소 이력은 로트가 없다 (spec 010 3단계): 되돌린 뒤 남은 작업지시의 줄만 더 센다
  if n <> history_before + 1 + (select count(*) from public.work_history where batch_id is not null)
          + (select count(*) from public.work_history h where h.batch_id is null and h.target_table = 'work_order'
              and h.target_id in (select w.id from public.work_order w))
          -- 예시 공정 단계 정의 이력도 로트가 없다 (spec 011 3단계)
          + (select count(*) from public.work_history h where h.batch_id is null and h.target_table = 'process_step'
              and h.target_id in (select s.id from public.process_step s)) then
    failures := failures || format('업무 이력 %s → %s줄', history_before, n);
  end if;
  select count(*) into n from public.work_history where action = '예시 자료 되돌리기' and actor_id = qa and created_at >= reset_started;
  if n <> 1 then failures := failures || format('"예시 자료 되돌리기" 이력 %s줄', n); end if;
  total := total + 1; -- 지워진 배치의 이력: 연결은 비우고 배치번호 글자는 남음 (Q27)
  select count(*) into n from public.work_history where batch_number = 'Q3-001' and batch_id is null;
  if n < 1 then failures := failures || 'Q3-001 이력의 배치번호가 사라짐'::text; end if;
  if exists (select 1 from public.work_history w where w.batch_id is not null
             and not exists (select 1 from public.batch b where b.id = w.batch_id)) then
    failures := failures || '없는 배치를 가리키는 이력이 있음'::text;
  end if;
  total := total + 1; -- 되돌린 뒤에도 이력은 고칠 수 없음
  begin
    update public.work_history set action = '변조' where batch_number = 'Q3-001';
    failures := failures || '되돌린 뒤 이력이 고쳐짐'::text;
  exception when others then null;
  end;
  total := total + 1; -- 되돌린 뒤 핵심 흐름이 다시 됨: IFV-2610-002에 역가 규격 이탈 → 이슈·보류
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (public.record_test_measurement(b.id, s.id, 79)->>'batch_status') into v
    from public.batch b join public.specification s on s.product_id = b.product_id and s.item_name = '역가'
   where b.batch_number = 'IFV-2610-002';
  execute 'reset role';
  if v is distinct from 'on_hold' then failures := failures || ('되돌린 뒤 판정: ' || coalesce(v, 'null')); end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
