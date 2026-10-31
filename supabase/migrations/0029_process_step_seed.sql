-- spec 011 3단계 (plan 011 §3, FR-010): 예시 공정 단계와 단계 실행. 모두 가상 자료 (Q70).
-- 인플루엔자·B형간염: 배양(발효) → 정제 → 원액 여과 → 충전 → 포장, Tdap: 원액 혼합 → 무균 여과 → 충전 → 포장.
-- 배양·발효 온도는 1단계, 보관 온도는 충전 단계에서 잰다. 예전 공정 기록 한 줄에 두 값이 함께 있으면 1단계 값을 새 기록으로 나눈다 (Q71).
-- IFV-2610-001(생산 중)은 2단계까지, TDP-2610-001(보류)은 이탈이 난 충전까지, 나머지 예시 로트는 모두 완료 → 작업지시 완료.

-- 제품 하나의 단계를 순서대로 넣고 공정 기준을 단계에 잇는다. 단계 id를 순서대로 돌려준다
create or replace function private.seed_product_steps(p_product text, p_names text[], p_spec_steps jsonb, p_qa uuid, p_at timestamptz)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid := (select p.id from public.product p where p.item_name = p_product);
  ids uuid[] := '{}';
  saved public.process_step;
  i integer;
begin
  if pid is null or exists (select 1 from public.process_step where product_id = pid) then
    return null; -- 예시 제품이 없거나 이미 단계가 있으면 건너뛴다
  end if;
  for i in 1 .. array_length(p_names, 1) loop
    insert into public.process_step (product_id, step_order, name, created_by, created_at)
    values (pid, i, p_names[i], p_qa, p_at + (i || ' minutes')::interval)
    returning * into saved;
    ids := ids || saved.id;
    perform private.seed_history(p_qa, private.history_action('process_step', 'INSERT', null, to_jsonb(saved)),
                                 'process_step', saved.id, null, saved.created_at);
  end loop;
  update public.specification s set process_step_id = ids[(p_spec_steps->>s.item_name)::integer]
   where s.product_id = pid and s.category = 'process' and p_spec_steps ? s.item_name;
  return ids;
end;
$$;

-- 단계 실행 한 건 (완료 시각이 없으면 진행 중). 공정 기록을 이 실행에 잇고, 이력도 실제 처리와 같은 이름으로
create or replace function private.seed_step_run(p_lot uuid, p_step uuid, p_by uuid, p_start timestamptz, p_end timestamptz,
                                                 p_record uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.step_run;
begin
  insert into public.step_run (batch_id, process_step_id, step_label, line_clearance, started_by, started_at)
  values (p_lot, p_step, private.step_label(p_step),
          array['no_previous_material', 'no_previous_label', 'equipment_cleaned', 'area_clean'], p_by, p_start)
  returning * into saved;
  perform private.seed_history(p_by, private.history_action('step_run', 'INSERT', null, to_jsonb(saved)), 'step_run', saved.id, p_lot, p_start);
  if p_end is not null then
    update public.step_run set status = 'completed', completed_by = p_by, completed_at = p_end where id = saved.id returning * into saved;
    perform private.seed_history(p_by, private.history_action('step_run', 'UPDATE', null, to_jsonb(saved)), 'step_run', saved.id, p_lot, p_end);
  end if;
  if p_record is not null then
    update public.process_record set step_run_id = saved.id where id = p_record;
  end if;
end;
$$;

-- 예전 공정 기록에서 한 기준의 값을 새 기록으로 옮긴다 (1단계 값을 1단계 기록으로). 새 기록 id
create or replace function private.seed_split_record(p_record uuid, p_spec_item text, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_record public.process_record := (select r from public.process_record r where r.id = p_record);
  new_id uuid;
begin
  if old_record.id is null or not exists (
       select 1 from public.measurement m join public.specification s on s.id = m.specification_id
        where m.process_record_id = p_record and s.item_name = p_spec_item) then
    return null;
  end if;
  insert into public.process_record (batch_id, production_quantity, equipment_status, recorded_by, recorded_at)
  values (old_record.batch_id, null, 'normal', old_record.recorded_by, p_at)
  returning id into new_id;
  update public.measurement m set process_record_id = new_id, measured_at = p_at
    from public.specification s
   where s.id = m.specification_id and m.process_record_id = p_record and s.item_name = p_spec_item;
  return new_id;
end;
$$;

-- 다섯 단계 제품의 다 끝난 로트: 1단계(배양·발효 온도) → 정제 → 원액 여과 → 충전(보관 온도, 예전 기록 시각) → 포장 → 작업지시 완료
create or replace function private.seed_finished_lot(p_lot text, p_steps uuid[], p_first_item text, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot public.batch := (select b from public.batch b where b.batch_number = p_lot);
  rec public.process_record;
  day0 timestamptz;
  first_record uuid;
  saved public.work_order;
begin
  if lot.id is null or exists (select 1 from public.step_run where batch_id = lot.id) then
    return;
  end if;
  select * into rec from public.process_record where batch_id = lot.id and step_run_id is null order by recorded_at limit 1;
  day0 := date_trunc('day', lot.created_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  first_record := private.seed_split_record(rec.id, p_first_item, day0 + interval '18 hours');
  perform private.seed_step_run(lot.id, p_steps[1], p_by, lot.created_at + interval '1 second', day0 + interval '18 hours', first_record);
  perform private.seed_step_run(lot.id, p_steps[2], p_by, day0 + interval '1 day 9 hours', day0 + interval '1 day 9 hours 40 minutes');
  perform private.seed_step_run(lot.id, p_steps[3], p_by, day0 + interval '1 day 9 hours 50 minutes', day0 + interval '1 day 10 hours 30 minutes');
  perform private.seed_step_run(lot.id, p_steps[4], p_by, rec.recorded_at - interval '1 hour', rec.recorded_at, rec.id);
  perform private.seed_step_run(lot.id, p_steps[5], p_by, rec.recorded_at + interval '30 minutes', rec.recorded_at + interval '90 minutes');
  update public.work_order set status = 'completed', completed_by = p_by, completed_at = rec.recorded_at + interval '90 minutes'
   where batch_id = lot.id and status = 'in_progress'
  returning * into saved;
  if saved.id is not null then
    perform private.seed_history(p_by, private.history_action('work_order', 'UPDATE', null, to_jsonb(saved)),
                                 'work_order', saved.id, lot.id, saved.completed_at);
  end if;
end;
$$;

-- spec 011 FR-010: 예시 제품 3개 단계, 예시 로트 단계 실행
create or replace function private.seed_process_steps(p_qa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  prod uuid := coalesce((select id from public.profile where role = 'production_operator' order by created_at limit 1), p_qa);
  defined_at timestamptz := (select min(created_at) from public.batch) - interval '3 days';
  ifv uuid[];
  hbv uuid[];
  tdp uuid[];
  lot public.batch;
  rec public.process_record;
  day0 timestamptz;
  first_record uuid;
begin
  ifv := private.seed_product_steps('인플루엔자 4가 백신 프리필드주 (가상)', array['세포 배양', '정제', '원액 여과', '충전', '포장'],
                                    '{"배양 온도": 1, "보관 온도": 4}', p_qa, defined_at);
  hbv := private.seed_product_steps('B형간염 백신 주 (가상)', array['발효', '정제', '원액 여과', '충전', '포장'],
                                    '{"발효 온도": 1, "보관 온도": 4}', p_qa, defined_at + interval '1 hour');
  tdp := private.seed_product_steps('Tdap 혼합 백신 주 (가상)', array['원액 혼합', '무균 여과', '충전', '포장'],
                                    '{"보관 온도": 3}', p_qa, defined_at + interval '2 hours');

  if ifv is not null then
    perform private.seed_finished_lot('IFV-2610-004', ifv, '배양 온도', prod);
    perform private.seed_finished_lot('IFV-2610-003', ifv, '배양 온도', prod);
    perform private.seed_finished_lot('IFV-2610-002', ifv, '배양 온도', prod);
    -- IFV-2610-001 생산 중: 세포 배양(값 기록)·정제까지 완료, 원액 여과를 착수할 차례
    select * into lot from public.batch where batch_number = 'IFV-2610-001';
    if lot.id is not null and not exists (select 1 from public.step_run where batch_id = lot.id) then
      day0 := date_trunc('day', lot.created_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
      insert into public.process_record (batch_id, production_quantity, equipment_status, recorded_by, recorded_at)
      values (lot.id, null, 'normal', prod, day0 + interval '17 hours 30 minutes')
      returning id into first_record;
      perform private.seed_history(prod, '공정 조건 입력', 'process_record', first_record, lot.id, day0 + interval '17 hours 30 minutes');
      perform private.seed_value(lot.id, 'process', '배양 온도', 36.8, prod, day0 + interval '17 hours 30 minutes', null, first_record);
      perform private.seed_step_run(lot.id, ifv[1], prod, lot.created_at + interval '1 second', day0 + interval '17 hours 30 minutes', first_record);
      perform private.seed_step_run(lot.id, ifv[2], prod, day0 + interval '1 day 9 hours', day0 + interval '1 day 10 hours');
    end if;
  end if;
  if hbv is not null then
    perform private.seed_finished_lot('HBV-2610-003', hbv, '발효 온도', prod);
    perform private.seed_finished_lot('HBV-2610-002', hbv, '발효 온도', prod);
    perform private.seed_finished_lot('HBV-2610-001', hbv, '발효 온도', prod);
  end if;
  if tdp is not null then
    -- TDP-2610-001 보류: 원액 혼합·무균 여과 뒤 충전에서 보관 온도 규격 이탈 → 포장은 보류가 풀릴 때까지 못 함
    select * into lot from public.batch where batch_number = 'TDP-2610-001';
    if lot.id is not null and not exists (select 1 from public.step_run where batch_id = lot.id) then
      select * into rec from public.process_record where batch_id = lot.id and step_run_id is null order by recorded_at limit 1;
      day0 := date_trunc('day', lot.created_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
      perform private.seed_step_run(lot.id, tdp[1], prod, lot.created_at + interval '1 second', day0 + interval '18 hours');
      perform private.seed_step_run(lot.id, tdp[2], prod, day0 + interval '1 day 9 hours', day0 + interval '1 day 9 hours 40 minutes');
      if rec.id is not null then
        perform private.seed_step_run(lot.id, tdp[3], prod, rec.recorded_at - interval '1 hour', rec.recorded_at, rec.id);
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function private.seed_product_steps(text, text[], jsonb, uuid, timestamptz),
  private.seed_step_run(uuid, uuid, uuid, timestamptz, timestamptz, uuid), private.seed_split_record(uuid, text, timestamptz),
  private.seed_finished_lot(text, uuid[], text, uuid), private.seed_process_steps(uuid) from public, anon, authenticated;

-- 되돌리기: 예시 작업지시 뒤에 예시 공정 단계를 넣는다 (0027처럼 그 줄만)
do $reset$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.replace_sample_data(uuid)'::regprocedure);
  if position('seed_process_steps' in definition) = 0 then
    definition := replace(definition, E'  perform private.seed_work_orders(p_qa);\n',
                          E'  perform private.seed_work_orders(p_qa);\n  perform private.seed_process_steps(p_qa);\n');
    if position('seed_process_steps' in definition) = 0 then
      raise exception 'replace_sample_data에 예시 공정 단계 줄을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$reset$;

-- 지금 자료에는 예시 제품에 단계가 없을 때만 더한다 (확인용 제품·사용자 로트는 그대로)
select private.seed_process_steps((select id from public.profile where role = 'qa_manager' order by created_at limit 1));
