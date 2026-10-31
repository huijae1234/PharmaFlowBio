-- Q16 (Intent, ERD v0.5, spec 002 FR-014): 측정값마다 판정에 쓴 그때의 기준(최솟값·최댓값)을 저장한다.
-- 기존 측정값은 지금 기준값으로 채운다 (기능 001 시험에서 바꾼 기준은 되돌려 두었으므로 같다).

alter table public.measurement
  add column applied_min_value numeric,
  add column applied_max_value numeric;

update public.measurement m
   set applied_min_value = s.min_value, applied_max_value = s.max_value
  from public.specification s
 where s.id = m.specification_id and m.applied_min_value is null;

alter table public.measurement
  alter column applied_min_value set not null,
  alter column applied_max_value set not null;

-- 아래 세 함수는 0004·0005·0006과 같고, 측정값을 넣을 때 기준 두 칸을 함께 넣는 것만 바뀐다

create or replace function public.record_test_measurement(p_batch_id uuid, p_specification_id uuid, p_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  target public.batch;
  spec public.specification;
  verdict public.measurement_result;
  issue_id uuid;
  measurement_id uuid;
  next_status public.batch_status;
begin
  me := private.require_role(array['qc_analyst', 'qa_manager']::public.user_role[], 'QC 시험 담당자·QA 관리자');
  if p_value is null then
    raise exception '숫자로 입력해 주세요.';
  end if;
  target := private.lock_editable_batch(p_batch_id);

  select * into spec from public.specification where id = p_specification_id;
  if spec.id is null or spec.category <> 'test' or spec.product_id <> target.product_id then
    raise exception '이 배치의 제품에 없는 시험 항목입니다. 시험 항목을 다시 골라 주세요.';
  end if;
  -- Q10: 같은 시험 항목은 일반 입력으로 한 번만. 다시 재는 것은 재시험 조치(기능 002)로
  if exists (select 1 from public.measurement
             where batch_id = target.id and specification_id = spec.id and action_request_id is null) then
    raise exception '이미 입력한 시험 항목입니다. 다시 재려면 재시험 조치를 요청해 주세요.';
  end if;

  -- 경계값(최솟값·최댓값과 같음)은 적합 (PRD FR-08)
  verdict := case when p_value between spec.min_value and spec.max_value then 'pass' else 'out_of_spec' end;
  if verdict = 'out_of_spec' then
    insert into public.quality_issue (batch_id, source) values (target.id, 'test') returning id into issue_id;
  end if;
  -- Q16 (ERD v0.5): 판정에 쓴 그때의 기준을 함께 저장
  insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, measured_by, applied_min_value, applied_max_value)
  values (target.id, spec.id, p_value, verdict, issue_id, me.id, spec.min_value, spec.max_value)
  returning id into measurement_id;

  -- ERD 배치 상태 규칙: 이탈 → 보류, 첫 시험값 → 시험 중 (Q1)
  next_status := case
    when verdict = 'out_of_spec' then 'on_hold'::public.batch_status
    when target.status = 'in_production' then 'in_testing'::public.batch_status
    else target.status
  end;
  if next_status <> target.status then
    update public.batch set status = next_status where id = target.id;
  end if;

  return jsonb_build_object('measurement_id', measurement_id, 'result', verdict,
                            'quality_issue_id', issue_id, 'batch_status', next_status);
end;
$$;

create or replace function public.record_process_conditions(
  p_batch_id uuid, p_production_quantity numeric, p_equipment_status public.equipment_status, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  target public.batch;
  entries jsonb := coalesce(p_values, '[]'::jsonb);
  entry jsonb;
  spec public.specification;
  seen uuid[] := '{}';
  any_out_of_spec boolean := false;
  record_id uuid;
  issue_id uuid;
  next_status public.batch_status;
begin
  me := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  if p_equipment_status is null then
    raise exception '설비 상태를 골라 주세요.';
  end if;
  if jsonb_typeof(entries) <> 'array' then
    raise exception '공정 조건 형식이 맞지 않습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.';
  end if;
  target := private.lock_editable_batch(p_batch_id);

  -- 먼저 모두 검사하고 판정한다. 하나라도 잘못되면 아무것도 저장하지 않는다
  for entry in select * from jsonb_array_elements(entries) loop
    select * into spec from public.specification where id = (entry->>'specification_id')::uuid;
    if spec.id is null or spec.category <> 'process' or spec.product_id <> target.product_id then
      raise exception '이 배치의 제품에 없는 공정 조건 항목입니다. 화면을 새로 고친 뒤 다시 입력해 주세요.';
    end if;
    if spec.id = any (seen) then
      raise exception '같은 공정 조건 항목이 두 번 들어 있습니다.';
    end if;
    seen := seen || spec.id;
    if jsonb_typeof(entry->'value') is distinct from 'number' then
      raise exception '숫자로 입력해 주세요.';
    end if;
    if (entry->>'value')::numeric not between spec.min_value and spec.max_value then
      any_out_of_spec := true;
    end if;
  end loop;

  insert into public.process_record (batch_id, production_quantity, equipment_status, recorded_by)
  values (target.id, p_production_quantity, p_equipment_status, me.id)
  returning id into record_id;

  -- 설비 상태 "이상"은 기준 이탈 (PRD FR-09). 여러 항목이 이탈해도 이슈는 1개
  if any_out_of_spec or p_equipment_status = 'abnormal' then
    insert into public.quality_issue (batch_id, source, process_record_id)
    values (target.id, 'process', record_id)
    returning id into issue_id;
  end if;

  -- Q16 (ERD v0.5): 판정에 쓴 그때의 기준을 함께 저장
  insert into public.measurement (batch_id, specification_id, value, result, process_record_id, quality_issue_id, measured_by, applied_min_value, applied_max_value)
  select target.id, s.id, (e->>'value')::numeric,
         case when (e->>'value')::numeric between s.min_value and s.max_value
              then 'pass'::public.measurement_result else 'out_of_spec'::public.measurement_result end,
         record_id,
         case when (e->>'value')::numeric between s.min_value and s.max_value then null else issue_id end,
         me.id, s.min_value, s.max_value
    from jsonb_array_elements(entries) e
    join public.specification s on s.id = (e->>'specification_id')::uuid;

  next_status := case when issue_id is not null then 'on_hold'::public.batch_status else target.status end;
  if next_status <> target.status then
    update public.batch set status = next_status where id = target.id;
  end if;

  return jsonb_build_object('process_record_id', record_id, 'quality_issue_id', issue_id, 'batch_status', next_status);
end;
$$;

create or replace function private.seed_sample_batches(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_a uuid := (select id from public.product where item_name = '파마플로정 500mg (가상)');
  product_b uuid := (select id from public.product where item_name = '가상큐어캡슐 250mg (가상)');
  product_c uuid := (select id from public.product where item_name = '샘플린정 10mg (가상)');
  batch_id uuid;
  issue_id uuid;
begin
  if not exists (select 1 from public.profile where id = p_owner) then
    raise exception '예시 배치를 등록할 사용자가 없습니다.';
  end if;
  if exists (select 1 from public.batch where batch_number like 'PF-2610-%') then
    return;
  end if;

  -- 생산 중
  insert into public.batch (batch_number, product_id, created_by) values ('PF-2610-001', product_a, p_owner);
  insert into public.batch (batch_number, product_id, created_by) values ('PF-2610-004', product_c, p_owner);

  -- 시험 중: 시험값 일부 적합
  insert into public.batch (batch_number, product_id, status, created_by)
  values ('PF-2610-002', product_a, 'in_testing', p_owner) returning id into batch_id;
  insert into public.measurement (batch_id, specification_id, value, result, measured_by, applied_min_value, applied_max_value)
  select batch_id, s.id, v.value, 'pass', p_owner, s.min_value, s.max_value
    from (values ('함량', 100.2), ('순도', 99.4)) as v(item_name, value)
    join public.specification s on s.product_id = product_a and s.category = 'test' and s.item_name = v.item_name;

  insert into public.batch (batch_number, product_id, status, created_by)
  values ('PF-2610-005', product_b, 'in_testing', p_owner) returning id into batch_id;
  insert into public.measurement (batch_id, specification_id, value, result, measured_by, applied_min_value, applied_max_value)
  select batch_id, s.id, 88, 'pass', p_owner, s.min_value, s.max_value
    from public.specification s where s.product_id = product_b and s.category = 'test' and s.item_name = '용출률';

  -- 보류: 순도 기준 이탈로 품질 이슈가 열려 있음
  insert into public.batch (batch_number, product_id, status, created_by)
  values ('PF-2610-003', product_b, 'on_hold', p_owner) returning id into batch_id;
  insert into public.quality_issue (batch_id, source) values (batch_id, 'test') returning id into issue_id;
  insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, measured_by, applied_min_value, applied_max_value)
  select batch_id, s.id, 97.1, 'out_of_spec', issue_id, p_owner, s.min_value, s.max_value
    from public.specification s where s.product_id = product_b and s.category = 'test' and s.item_name = '순도';
end;
$$;

revoke execute on function public.record_test_measurement(uuid, uuid, numeric) from public, anon;
grant execute on function public.record_test_measurement(uuid, uuid, numeric) to authenticated;
revoke execute on function public.record_process_conditions(uuid, numeric, public.equipment_status, jsonb) from public, anon;
grant execute on function public.record_process_conditions(uuid, numeric, public.equipment_status, jsonb) to authenticated;
revoke execute on function private.seed_sample_batches(uuid) from public, anon, authenticated;
