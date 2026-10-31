-- spec 011 데이터베이스 시험 (plan 011 §4). 001~010과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 알림·이력 비교는 이 시험이 만든 것만 본다. 작업지시 계획일은 2099년.
do $test$
declare
  qa uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  pid uuid;
  spec_a uuid;
  spec_b uuid;
  spec_c uuid;
  s1 public.process_step;
  s2 public.process_step;
  s3 public.process_step;
  s4 public.process_step;
  wo public.work_order;
  wo2 public.work_order;
  lot uuid;
  lot2 uuid;
  old_lot uuid;
  r1 public.step_run;
  r2 public.step_run;
  r3 public.step_run;
  res jsonb;
  all4 jsonb := '["no_previous_material", "no_previous_label", "equipment_cleaned", "area_clean"]';
  v text;
  n int;
  total int := 0;
  failures text[] := '{}';

begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa11@test.local', '{"full_name":"시험 QA11"}'),
    (qc, 'qc11@test.local', '{"full_name":"시험 QC11"}'),
    (prod, 'prod11@test.local', '{"full_name":"시험 생산11"}'),
    (viewer, 'viewer11@test.local', '{"full_name":"시험 열람11"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;
  update public.profile set role = 'viewer' where id not in (qa, qc, prod, viewer);
  insert into public.product (item_name) values ('시험 백신 011 (교육용 가상)') returning id into pid;

  ----------------------------------------------------------------------------
  -- FR-001·002: QA가 단계를 정하고 기준을 잇는다
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  spec_a := (public.save_specification(null, pid, 'process', '배양 온도', '℃', 30, 40, 32, 38)).id;
  spec_b := (public.save_specification(null, pid, 'process', '충전량', 'mL', 2, 8, 3, 7)).id;
  spec_c := (public.save_specification(null, pid, 'process', 'pH', '', 6, 8, null, null)).id;
  s1 := public.save_process_step(null, pid, ' 배양 ');
  s2 := public.save_process_step(null, pid, '여과');
  s3 := public.save_process_step(null, pid, '충전');
  s4 := public.save_process_step(null, pid, '임시');
  total := total + 1;
  if (s1.name, s1.step_order, s2.step_order, s3.step_order, s4.step_order) is distinct from ('배양', 1, 2, 3, 4) then
    failures := failures || '단계 등록 순서·이름 정리'::text;
  end if;
  total := total + 1;
  begin
    perform public.save_process_step(null, pid, '여과');
    failures := failures || '같은 이름 단계가 들어감'::text;
  exception when others then
    if sqlerrm <> '같은 이름의 단계가 이미 있습니다.' then failures := failures || ('중복 이름 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.save_process_step(null, pid, '   ');
    failures := failures || '빈 이름이 들어감'::text;
  exception when others then
    if sqlerrm <> '단계 이름을 입력해 주세요.' then failures := failures || ('빈 이름 문구: ' || sqlerrm); end if;
  end;
  s2 := public.save_process_step(s2.id, pid, '정제 여과');
  perform public.move_process_step(s3.id, 'up');
  total := total + 1; -- 위로 한 칸 → 맞바꿈, 다시 아래로
  if (select string_agg(name, '>' order by step_order) from public.process_step ps where ps.product_id = pid) is distinct from '배양>충전>정제 여과>임시' then
    failures := failures || ('순서 바꾸기: ' || (select string_agg(name, '>' order by step_order) from public.process_step ps where ps.product_id = pid));
  end if;
  perform public.move_process_step(s3.id, 'down');
  perform public.retire_process_step(s4.id);
  total := total + 1;
  begin
    perform public.retire_process_step(s4.id);
    failures := failures || '두 번 쓰지 않음'::text;
  exception when others then null;
  end;
  perform public.set_specification_step(spec_a, s1.id);
  perform public.set_specification_step(spec_b, s3.id);
  total := total + 1;
  begin
    perform public.set_specification_step(spec_c, s4.id);
    failures := failures || '쓰지 않는 단계에 기준을 이음'::text;
  exception when others then
    if sqlerrm not like '이 제품에 없는 단계입니다%' then failures := failures || ('쓰지 않는 단계 잇기 문구: ' || sqlerrm); end if;
  end;
  total := total + 1; -- 기준을 단계에 이어도 버전은 그대로
  if (select version from public.specification where id = spec_a) <> 1 then failures := failures || '기준 잇기로 버전이 바뀜'::text; end if;
  old_lot := (public.create_batch('Q11-OLD', pid)).id; -- 작업지시 없는 로트 (FR-008)

  -- 생산 담당자·QC는 단계 정의·기준 잇기를 못 한다
  for v in select unnest(array[prod::text, qc::text]) loop
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    total := total + 1;
    begin
      perform public.save_process_step(null, pid, '몰래');
      failures := failures || '생산·QC가 단계를 등록함'::text;
    exception when others then if sqlstate <> '42501' then failures := failures || ('단계 등록 권한 오류: ' || sqlerrm); end if;
    end;
    total := total + 1;
    begin
      perform public.set_specification_step(spec_c, s1.id);
      failures := failures || '생산·QC가 기준을 이음'::text;
    exception when others then if sqlstate <> '42501' then failures := failures || ('기준 잇기 권한 오류: ' || sqlerrm); end if;
    end;
  end loop;

  ----------------------------------------------------------------------------
  -- 작업지시 두 개 착수 (생산·QA)
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  wo := public.create_work_order(jsonb_build_object('product_id', pid, 'planned_quantity', '1000', 'unit', '바이알',
                                                    'planned_start', '2099-10-01', 'planned_end', '2099-10-03'));
  wo2 := public.create_work_order(jsonb_build_object('product_id', pid, 'planned_quantity', '1000', 'unit', '바이알',
                                                     'planned_start', '2099-10-01', 'planned_end', '2099-10-03'));
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.release_work_order(wo.id);
  perform public.release_work_order(wo2.id);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  lot := (public.start_work_order(wo.id, 'Q11-001')).batch_id;
  lot2 := (public.start_work_order(wo2.id, 'Q11-002')).batch_id;

  -- FR-008: 단계가 있는 작업지시 로트는 예전 공정 조건 입력을 막고, 작업지시 없는 로트는 그대로
  total := total + 1;
  begin
    perform public.record_process_conditions(lot, null, 'normal', '[]');
    failures := failures || '단계 로트에 예전 공정 조건 입력이 됨'::text;
  exception when others then
    if sqlerrm <> '공정 단계 탭에서 단계를 완료해 주세요.' then failures := failures || ('예전 입력 막힘 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  res := public.record_process_conditions(old_lot, 100, 'normal', jsonb_build_array(jsonb_build_object('specification_id', spec_a, 'value', 35)));
  if res->>'batch_status' <> 'in_production' or res ? 'step_run_id' then failures := failures || ('예전 로트 공정 조건: ' || res::text); end if;

  ----------------------------------------------------------------------------
  -- FR-004 착수
  total := total + 1;
  begin
    perform public.start_step(lot, s2.id, all4);
    failures := failures || '앞 단계 전에 착수됨'::text;
  exception when others then
    if sqlerrm <> '앞 단계를 완료한 뒤 착수할 수 있습니다.' then failures := failures || ('앞 단계 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.start_step(lot, s1.id, '["no_previous_material", "no_previous_label", "equipment_cleaned"]');
    failures := failures || '라인 클리어런스 3가지로 착수됨'::text;
  exception when others then
    if sqlerrm <> '라인 클리어런스 4가지를 모두 확인해 주세요.' then failures := failures || ('클리어런스 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.start_step(old_lot, s1.id, all4);
    failures := failures || '작업지시 없는 로트에서 착수됨'::text;
  exception when others then
    if sqlerrm <> '작업지시로 만든 로트만 공정 단계를 진행할 수 있습니다.' then failures := failures || ('작업지시 없음 문구: ' || sqlerrm); end if;
  end;
  r1 := public.start_step(lot, s1.id, all4);
  total := total + 1; -- 쓰지 않음 단계는 번호에서 빠진다
  if r1.status <> 'in_progress' or r1.step_label <> '1/3 배양' or r1.started_by <> prod or cardinality(r1.line_clearance) <> 4 then
    failures := failures || ('착수 결과: ' || r1.step_label);
  end if;
  total := total + 1;
  begin
    perform public.start_step(lot, s1.id, all4);
    failures := failures || '같은 단계 두 번 착수'::text;
  exception when others then
    if sqlerrm <> '이미 착수한 단계입니다.' then failures := failures || ('두 번 착수 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.start_step(lot, s2.id, all4);
    failures := failures || '진행 중 단계가 있는데 다음 단계 착수'::text;
  exception when others then
    if sqlerrm <> '앞 단계를 완료한 뒤 착수할 수 있습니다.' then failures := failures || ('진행 중 다음 착수 문구: ' || sqlerrm); end if;
  end;

  -- FR-005 완료: 이 단계 기준만, 모두
  total := total + 1;
  begin
    perform public.complete_step(r1.id, null, 'normal', jsonb_build_array(jsonb_build_object('specification_id', spec_b, 'value', 5)));
    failures := failures || '다른 단계 기준으로 완료됨'::text;
  exception when others then
    if sqlerrm not like '이 단계에 없는 공정 기준입니다%' then failures := failures || ('다른 단계 기준 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.complete_step(r1.id, null, 'normal', '[]');
    failures := failures || '기준 값 없이 완료됨'::text;
  exception when others then
    if sqlerrm <> '이 단계의 공정 기준 값을 모두 입력해 주세요.' then failures := failures || ('값 없음 문구: ' || sqlerrm); end if;
  end;
  res := public.complete_step(r1.id, null, 'normal', jsonb_build_array(jsonb_build_object('specification_id', spec_a, 'value', 35)));
  total := total + 1;
  if (select status from public.step_run where id = r1.id) <> 'completed'
     or (select step_run_id from public.process_record where id = (res->>'process_record_id')::uuid) <> r1.id
     or (res->>'work_order_completed')::boolean then
    failures := failures || ('1단계 완료: ' || res::text);
  end if;
  total := total + 1;
  begin
    perform public.complete_step(r1.id, null, 'normal', jsonb_build_array(jsonb_build_object('specification_id', spec_a, 'value', 35)));
    failures := failures || '두 번 완료됨'::text;
  exception when others then
    if sqlerrm <> '이미 완료한 단계입니다.' then failures := failures || ('두 번 완료 문구: ' || sqlerrm); end if;
  end;
  -- 2단계: 이어진 기준 없음 → 설비 상태만. QA도 완료할 수 있다(교대, Q72)
  r2 := public.start_step(lot, s2.id, all4);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.complete_step(r2.id, 500, 'normal', '[]');
  total := total + 1;
  if (select completed_by from public.step_run where id = r2.id) <> qa then failures := failures || '다른 사람이 완료하지 못함'::text; end if;
  -- 3단계(마지막): 이 단계 기준 + 미지정 기준. 관리기준 밖·규격 안 → 이슈만, 작업지시 완료, 로트 생산 중
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r3 := public.start_step(lot, s3.id, all4);
  total := total + 1;
  begin
    perform public.complete_step(r3.id, null, 'normal', jsonb_build_array(jsonb_build_object('specification_id', spec_b, 'value', 5)));
    failures := failures || '마지막 단계에서 미지정 기준 없이 완료됨'::text;
  exception when others then
    if sqlerrm <> '이 단계의 공정 기준 값을 모두 입력해 주세요.' then failures := failures || ('미지정 기준 문구: ' || sqlerrm); end if;
  end;
  res := public.complete_step(r3.id, 950, 'normal', jsonb_build_array(
    jsonb_build_object('specification_id', spec_b, 'value', 7.5), jsonb_build_object('specification_id', spec_c, 'value', 7)));
  total := total + 1;
  if res->>'batch_status' <> 'in_production' or res->>'quality_issue_id' is null or not (res->>'work_order_completed')::boolean
     or (select kind from public.quality_issue where id = (res->>'quality_issue_id')::uuid) <> 'alert' then
    failures := failures || ('마지막 단계 관리기준 이탈: ' || res::text);
  end if;
  total := total + 1;
  if (select status::text || ':' || (completed_by = prod)::text || ':' || (completed_at is not null)::text from public.work_order where id = wo.id)
     <> 'completed:true:true' then
    failures := failures || '작업지시 완료가 안 됨'::text;
  end if;

  ----------------------------------------------------------------------------
  -- 둘째 로트: 1단계에서 규격 이탈 → 보류, 다음 단계 착수 막힘 (평가와 상관없이)
  r1 := public.start_step(lot2, s1.id, all4);
  res := public.complete_step(r1.id, null, 'normal', jsonb_build_array(jsonb_build_object('specification_id', spec_a, 'value', 45)));
  total := total + 1;
  if res->>'batch_status' <> 'on_hold' or (select status from public.step_run where id = r1.id) <> 'completed' then
    failures := failures || ('규격 이탈 완료: ' || res::text);
  end if;
  total := total + 1;
  begin
    perform public.start_step(lot2, s2.id, all4);
    failures := failures || '보류 로트에서 다음 단계 착수됨'::text;
  exception when others then
    if sqlerrm <> '로트가 보류 중입니다. 품질 이슈를 처리하고 보류가 풀린 뒤 진행해 주세요.' then failures := failures || ('보류 문구: ' || sqlerrm); end if;
  end;
  execute 'reset role';
  -- 평가가 승인돼도 보류면 막힌다 (문지아 혼선): 평가를 승인 상태로 바로 넣고 다시 시도
  insert into public.deviation_review (quality_issue_id, requested_by, deviation_summary, probable_cause, impact_assessment,
                                       proposed_action, evidence, status, reviewed_by, reviewed_at)
  values ((res->>'quality_issue_id')::uuid, prod, '배양 온도 규격 이탈', '온도계', '영향 없음', '재측정', '기록', 'approved', qa, now());
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.start_step(lot2, s2.id, all4);
    failures := failures || '평가 승인 뒤 보류 로트에서 착수됨'::text;
  exception when others then
    if sqlerrm not like '로트가 보류 중입니다%' then failures := failures || ('승인 뒤 보류 문구: ' || sqlerrm); end if;
  end;

  -- 실행 기록이 생긴 단계·제품은 이름·순서를 바꾸지 않는다
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.save_process_step(s1.id, pid, '배양 1');
    failures := failures || '실행된 단계 이름이 바뀜'::text;
  exception when others then
    if sqlerrm <> '실행 기록이 있는 단계는 바꿀 수 없습니다. 쓰지 않음으로 표시해 주세요.' then failures := failures || ('실행 단계 이름 문구: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    perform public.move_process_step(s3.id, 'up');
    failures := failures || '실행된 제품 순서가 바뀜'::text;
  exception when others then
    if sqlerrm <> '실행 기록이 있는 제품은 단계 순서를 바꿀 수 없습니다.' then failures := failures || ('실행 제품 순서 문구: ' || sqlerrm); end if;
  end;
  -- QC·열람자는 착수·완료 못 함, 표 직접 쓰기 막힘
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.start_step(lot, s1.id, all4);
    failures := failures || 'QC가 착수함'::text;
  exception when others then if sqlstate <> '42501' then failures := failures || ('QC 착수 오류: ' || sqlerrm); end if;
  end;
  total := total + 1;
  begin
    insert into public.step_run (batch_id, process_step_id, step_label, line_clearance, started_by)
    values (lot, s1.id, 'x', array['a', 'b', 'c', 'd'], qc);
    failures := failures || '표에 직접 넣어짐'::text;
  exception when others then null;
  end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  -- FR-009 이력, FR-006 알림
  total := total + 1;
  select string_agg(action, ' | ' order by created_at, id) into v
    from public.work_history where batch_id = lot and (target_table in ('step_run', 'work_order'));
  if v is distinct from '작업지시 착수 (' || wo.order_number || ') | 공정 단계 착수 (1/3 배양, 라인 클리어런스 확인) | 공정 단계 완료 (1/3 배양) | '
                     || '공정 단계 착수 (2/3 정제 여과, 라인 클리어런스 확인) | 공정 단계 완료 (2/3 정제 여과) | '
                     || '공정 단계 착수 (3/3 충전, 라인 클리어런스 확인) | 공정 단계 완료 (3/3 충전) | 작업지시 완료 (' || wo.order_number || ')' then
    failures := failures || ('로트 이력: ' || coalesce(v, '없음'));
  end if;
  total := total + 1;
  select count(*) into n from public.work_history
   where target_table = 'process_step' and target_id in (s1.id, s2.id, s3.id, s4.id) and actor_id = qa;
  if n <> 10 then failures := failures || ('단계 정의 이력 ' || n || '/10'); end if; -- 등록 4 + 이름 바꾸기 1 + 순서 바꾸기 2번×2줄 + 쓰지 않음 1
  total := total + 1;
  select string_agg(p.display_name || ':' || n2.message, ' | ' order by p.display_name) into v
    from public.notification n2 join public.profile p on p.id = n2.recipient_id
   where n2.kind = 'production_completed' and n2.created_by in (qa, qc, prod, viewer);
  if v is distinct from '시험 QA11:생산 완료 · Q11-001 · 시험 백신 011 (교육용 가상) · ' || wo.order_number || ' · 완료 시험 생산11'
                     || ' | 시험 QC11:생산 완료 · Q11-001 · 시험 백신 011 (교육용 가상) · ' || wo.order_number || ' · 완료 시험 생산11' then
    failures := failures || ('생산 완료 알림: ' || coalesce(v, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- FR-010 (3단계): 되돌리기 뒤 예시 공정 단계·실행
  execute 'reset role';
  perform private.replace_sample_data(qa);
  total := total + 1;
  select string_agg(p.item_name || ':' || (select string_agg(s.name, '>' order by s.step_order) from public.process_step s where s.product_id = p.id), ' | ' order by p.item_name)
    into v from public.product p where p.permit_item_code is null;
  if v is distinct from 'B형간염 백신 주 (가상):발효>정제>원액 여과>충전>포장 | Tdap 혼합 백신 주 (가상):원액 혼합>무균 여과>충전>포장 | '
                     || '인플루엔자 4가 백신 프리필드주 (가상):세포 배양>정제>원액 여과>충전>포장' then
    failures := failures || ('예시 단계: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 로트마다 완료 단계 수와 작업지시 상태
  select string_agg(b.batch_number || ':' || b.status || ':' ||
           (select count(*) from public.step_run r where r.batch_id = b.id and r.status = 'completed') || ':' || w.status, ' ' order by b.batch_number)
    into v from public.batch b join public.work_order w on w.batch_id = b.id;
  if v is distinct from 'HBV-2610-001:on_hold:5:completed HBV-2610-002:in_testing:5:completed HBV-2610-003:discarded:5:completed '
                     || 'IFV-2610-001:in_production:2:in_progress IFV-2610-002:in_testing:5:completed IFV-2610-003:in_testing:5:completed '
                     || 'IFV-2610-004:releasable:5:completed TDP-2610-001:on_hold:3:in_progress' then
    failures := failures || ('예시 실행: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 1단계 기록에는 배양·발효 온도, 충전 기록에는 보관 온도 (예전 기록을 나눔, Q71). 단계 기록이 없는 측정값 없음
  select count(*) into n from public.step_run r join public.process_step s on s.id = r.process_step_id
   where r.status = 'completed' and s.step_order = 1 and s.name <> '원액 혼합'
     and not exists (select 1 from public.process_record pr join public.measurement m on m.process_record_id = pr.id
                       join public.specification sp on sp.id = m.specification_id
                      where pr.step_run_id = r.id and sp.item_name in ('배양 온도', '발효 온도'));
  select n + count(*) into n from public.measurement m join public.specification sp on sp.id = m.specification_id
    join public.process_record pr on pr.id = m.process_record_id
   where sp.category = 'process' and (pr.step_run_id is null
      or sp.process_step_id is distinct from (select r.process_step_id from public.step_run r where r.id = pr.step_run_id));
  if n <> 0 then failures := failures || ('예시 공정 기록이 단계와 맞지 않음 ' || n); end if;
  total := total + 1; -- 미래 시각 없음, 단계 순서대로 시각이 늘어남, 다음 착수 가능한 로트는 IFV-2610-001 원액 여과
  if exists (select 1 from public.step_run where greatest(started_at, completed_at) > now())
     or exists (select 1 from public.step_run a join public.step_run b on a.batch_id = b.batch_id
                  join public.process_step sa on sa.id = a.process_step_id join public.process_step sb on sb.id = b.process_step_id
                 where sa.step_order < sb.step_order and a.completed_at > b.started_at) then
    failures := failures || '예시 단계 시각 순서가 맞지 않음'::text;
  end if;
  total := total + 1; -- 한 번 더 불러도 늘지 않는다
  select count(*) into n from public.step_run;
  perform private.seed_process_steps(qa);
  if (select count(*) from public.step_run) <> n or n <> 35 then failures := failures || ('예시 실행 수 ' || n || '/35'); end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
