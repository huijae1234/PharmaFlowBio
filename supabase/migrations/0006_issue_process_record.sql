-- Q15 (Intent, ERD v0.4): 공정 이탈 품질 이슈에 출처 공정 기록을 둔다.
-- 설비 상태만 "이상"이면 연결된 측정값이 없어서, 같은 시각으로 찾던 임시 처리를 없앤다.

alter table public.quality_issue
  add column process_record_id uuid references public.process_record (id);
create index on public.quality_issue (process_record_id);

-- FR-011 (spec 001): 0004의 함수에서 이슈를 만들 때 공정 기록을 함께 넣는 것만 바뀐다
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

  insert into public.measurement (batch_id, specification_id, value, result, process_record_id, quality_issue_id, measured_by)
  select target.id, s.id, (e->>'value')::numeric,
         case when (e->>'value')::numeric between s.min_value and s.max_value
              then 'pass'::public.measurement_result else 'out_of_spec'::public.measurement_result end,
         record_id,
         case when (e->>'value')::numeric between s.min_value and s.max_value then null else issue_id end,
         me.id
    from jsonb_array_elements(entries) e
    join public.specification s on s.id = (e->>'specification_id')::uuid;

  next_status := case when issue_id is not null then 'on_hold'::public.batch_status else target.status end;
  if next_status <> target.status then
    update public.batch set status = next_status where id = target.id;
  end if;

  return jsonb_build_object('process_record_id', record_id, 'quality_issue_id', issue_id, 'batch_status', next_status);
end;
$$;

revoke execute on function public.record_process_conditions(uuid, numeric, public.equipment_status, jsonb) from public, anon;
grant execute on function public.record_process_conditions(uuid, numeric, public.equipment_status, jsonb) to authenticated;
