-- spec 004 1단계 (plan 004 §2): 세 단계 판정, 기준 버전, 이슈 종류, 규격 이탈만 보류, 재시험 종류 올리기, 출하 조건.
-- 관리기준이 비어 있으면 판정·이슈·보류·출하가 지금(0007·0008)과 똑같다.

-- FR-003 (spec 004): 판정 규칙 한 곳. 경계값은 범위 안
create or replace function private.judge(p_value numeric, p_spec public.specification)
returns public.measurement_result
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value not between p_spec.min_value and p_spec.max_value then 'out_of_spec'::public.measurement_result
    when p_spec.alert_min_value is not null
         and p_value not between p_spec.alert_min_value and p_spec.alert_max_value then 'out_of_alert'::public.measurement_result
    else 'pass'::public.measurement_result
  end
$$;
revoke execute on function private.judge(numeric, public.specification) from public, anon, authenticated;

-- FR-001·002 (spec 004): 관리기준을 받고, 값이 바뀔 때만 버전 +1. 인자가 늘어 옛 7인자 함수는 지운다.
-- 관리기준 인자는 기본값 null이라 7개만 넘기는 기존 호출도 이 함수로 온다(관리기준 없음으로 저장)
drop function public.save_specification(uuid, uuid, public.spec_category, text, text, numeric, numeric);

create or replace function public.save_specification(
  p_id uuid, p_product_id uuid, p_category public.spec_category,
  p_item_name text, p_unit text, p_min numeric, p_max numeric,
  p_alert_min numeric default null, p_alert_max numeric default null)
returns public.specification
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(coalesce(p_item_name, ''));
  clean_unit text := nullif(btrim(p_unit), '');
  existing public.specification;
  saved public.specification;
begin
  perform private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if clean_name = '' then
    raise exception '항목 이름을 입력해 주세요.';
  end if;
  if p_min is null or p_max is null then
    raise exception '숫자로 입력해 주세요.';
  end if;
  if p_min > p_max then
    raise exception '최솟값이 최댓값보다 클 수 없습니다.';
  end if;
  -- judgement-rules.js checkAlertRange와 같은 규칙
  if not ((p_alert_min is null and p_alert_max is null)
          or (p_alert_min is not null and p_alert_max is not null
              and p_min <= p_alert_min and p_alert_min <= p_alert_max and p_alert_max <= p_max)) then
    raise exception '사내 관리기준은 시험 규격 안쪽 범위로, 최솟값과 최댓값을 함께 입력해 주세요.';
  end if;

  if p_id is null then
    insert into public.specification (product_id, category, item_name, unit, min_value, max_value, alert_min_value, alert_max_value)
    values (p_product_id, p_category, clean_name, clean_unit, p_min, p_max, p_alert_min, p_alert_max)
    returning * into saved;
    return saved;
  end if;

  select * into existing from public.specification where id = p_id and product_id = p_product_id for update;
  if existing.id is null then
    raise exception '기준을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
  -- FR-002 수용 기준 2: 아무것도 바뀌지 않았으면 버전도 이력도 그대로
  if existing.category = p_category and existing.item_name = clean_name and existing.unit is not distinct from clean_unit
     and existing.min_value = p_min and existing.max_value = p_max
     and existing.alert_min_value is not distinct from p_alert_min and existing.alert_max_value is not distinct from p_alert_max then
    return existing;
  end if;

  update public.specification
     set category = p_category, item_name = clean_name, unit = clean_unit,
         min_value = p_min, max_value = p_max, alert_min_value = p_alert_min, alert_max_value = p_alert_max,
         version = version + case
           when min_value = p_min and max_value = p_max
                and alert_min_value is not distinct from p_alert_min and alert_max_value is not distinct from p_alert_max
           then 0 else 1 end
   where id = existing.id
  returning * into saved;
  return saved;
exception
  when unique_violation then
    raise exception '이미 있는 항목입니다.' using errcode = '23505';
end;
$$;
revoke execute on function public.save_specification(uuid, uuid, public.spec_category, text, text, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.save_specification(uuid, uuid, public.spec_category, text, text, numeric, numeric, numeric, numeric) to authenticated;

-- FR-003·004·005 (spec 004): 세 단계 판정, 그때 기준·버전 저장, 규격 이탈만 보류
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
  -- Q10: 같은 시험 항목은 일반 입력으로 한 번만. 다시 재는 것은 재시험 조치로
  if exists (select 1 from public.measurement
             where batch_id = target.id and specification_id = spec.id and action_request_id is null) then
    raise exception '이미 입력한 시험 항목입니다. 다시 재려면 재시험 조치를 요청해 주세요.';
  end if;

  verdict := private.judge(p_value, spec);
  if verdict <> 'pass' then
    insert into public.quality_issue (batch_id, source, kind)
    values (target.id, 'test', case when verdict = 'out_of_spec' then 'spec' else 'alert' end::public.issue_kind)
    returning id into issue_id;
  end if;
  insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, measured_by,
                                  applied_min_value, applied_max_value, applied_alert_min_value, applied_alert_max_value, applied_spec_version)
  values (target.id, spec.id, p_value, verdict, issue_id, me.id,
          spec.min_value, spec.max_value, spec.alert_min_value, spec.alert_max_value, spec.version)
  returning id into measurement_id;

  -- ERD 로트 상태 규칙 v0.7: 규격 이탈 → 보류, 첫 시험값 → 시험 중 (Q1). 관리기준 이탈은 보류하지 않음 (D6)
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

-- FR-006 (spec 004): 항목마다 세 단계, 이탈이 있으면 이슈 1개. 규격 이탈·설비 이상이 하나라도 있으면 규격 이탈
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
  verdict public.measurement_result;
  any_spec boolean := p_equipment_status = 'abnormal';
  any_alert boolean := false;
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
    verdict := private.judge((entry->>'value')::numeric, spec);
    any_spec := any_spec or verdict = 'out_of_spec';
    any_alert := any_alert or verdict = 'out_of_alert';
  end loop;

  insert into public.process_record (batch_id, production_quantity, equipment_status, recorded_by)
  values (target.id, p_production_quantity, p_equipment_status, me.id)
  returning id into record_id;

  if any_spec or any_alert then
    insert into public.quality_issue (batch_id, source, process_record_id, kind)
    values (target.id, 'process', record_id, case when any_spec then 'spec' else 'alert' end::public.issue_kind)
    returning id into issue_id;
  end if;

  insert into public.measurement (batch_id, specification_id, value, result, process_record_id, quality_issue_id, measured_by,
                                  applied_min_value, applied_max_value, applied_alert_min_value, applied_alert_max_value, applied_spec_version)
  select target.id, s.id, j.value, j.verdict, record_id,
         case when j.verdict = 'pass' then null else issue_id end,
         me.id, s.min_value, s.max_value, s.alert_min_value, s.alert_max_value, s.version
    from jsonb_array_elements(entries) e
    join public.specification s on s.id = (e->>'specification_id')::uuid
    cross join lateral (select (e->>'value')::numeric as value, private.judge((e->>'value')::numeric, s) as verdict) j;

  next_status := case when any_spec then 'on_hold'::public.batch_status else target.status end;
  if next_status <> target.status then
    update public.batch set status = next_status where id = target.id;
  end if;

  return jsonb_build_object('process_record_id', record_id, 'quality_issue_id', issue_id, 'batch_status', next_status);
end;
$$;

-- FR-007 (spec 004): 재시험 세 단계. 관리기준 이탈 이슈가 규격 이탈로 나빠지면 종류를 올리고 보류. 내리지는 않음 (Q28)
create or replace function public.complete_action_request(p_request_id uuid, p_result_note text, p_retest_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  request public.action_request;
  issue public.quality_issue;
  spec public.specification;
  verdict public.measurement_result;
  note text := private.clean_text(p_result_note, '조치 결과');
begin
  select * into me from public.profile where id = auth.uid();
  select * into request from public.action_request where id = p_request_id for update;
  if request.id is null then
    raise exception '조치 요청을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
  if me.id is null or me.role = 'viewer' or not (me.role = 'qa_manager' or request.assignee_id = me.id) then
    raise exception '이 작업은 배정된 담당자나 QA 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if request.status <> 'approved' then
    raise exception '승인된 조치 요청만 결과를 넣을 수 있습니다.';
  end if;
  issue := private.lock_issue_for_action(request.quality_issue_id);

  if request.action_type = 'retest' then
    if p_retest_value is null then
      raise exception '숫자로 입력해 주세요.';
    end if;
    -- Q20: 이 이슈를 연 이탈 측정값의 시험 항목을 다시 잰다 (관리기준 이탈 포함)
    select s.* into spec
      from public.measurement m join public.specification s on s.id = m.specification_id
     where m.quality_issue_id = issue.id and m.action_request_id is null and m.result in ('out_of_spec', 'out_of_alert')
     order by m.measured_at
     limit 1;
    if spec.id is null then
      raise exception '다시 잴 시험 항목을 찾을 수 없습니다. QA 관리자에게 알려 주세요.';
    end if;
    verdict := private.judge(p_retest_value, spec);
    -- 재이탈이어도 새 이슈를 만들지 않고 같은 이슈에 붙는다 (PRD FR-14)
    insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, action_request_id, measured_by,
                                    applied_min_value, applied_max_value, applied_alert_min_value, applied_alert_max_value, applied_spec_version)
    values (issue.batch_id, spec.id, p_retest_value, verdict, issue.id, request.id, me.id,
            spec.min_value, spec.max_value, spec.alert_min_value, spec.alert_max_value, spec.version);
    if verdict = 'out_of_spec' and issue.kind = 'alert' then
      update public.quality_issue set kind = 'spec' where id = issue.id;
      update public.batch set status = 'on_hold'
       where id = issue.batch_id and status in ('in_production', 'in_testing');
    end if;
  elsif note is null then
    raise exception '조치 결과를 입력해 주세요.';
  end if;

  update public.action_request
     set status = 'completed', result_note = note, completed_at = now()
   where id = request.id;
  return jsonb_build_object('request_status', 'completed', 'result', verdict, 'issue_status', issue.status);
end;
$$;

-- FR-008 (spec 004): 마지막 측정값이 정상 또는 관리기준 이탈(규격 안)이면 시험 끝. 열린 이슈는 종류 상관없이 막는다 (D6)
create or replace function public.decide_release(p_batch_id uuid, p_decision public.batch_status)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.batch;
  open_issues int;
  unfinished text;
begin
  perform private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if p_decision is null or p_decision not in ('releasable', 'discarded') then
    raise exception '출하 가능 또는 폐기를 골라 주세요.';
  end if;
  target := private.lock_editable_batch(p_batch_id);

  if p_decision = 'releasable' then
    select count(*) into open_issues from public.quality_issue where batch_id = target.id and status = 'open';
    if open_issues > 0 then
      raise exception '열린 품질 이슈가 %건 있어 출하할 수 없습니다.', open_issues;
    end if;
    if not (target.status = 'in_testing' or (target.status = 'on_hold' and target.hold_reason is not null)) then
      raise exception '시험 중인 배치만 출하할 수 있습니다.';
    end if;
    select string_agg(s.item_name, ', ' order by s.item_name) into unfinished
      from public.specification s
     where s.product_id = target.product_id and s.category = 'test'
       and coalesce((select m.result from public.measurement m
                      where m.batch_id = target.id and m.specification_id = s.id
                      order by m.measured_at desc limit 1), 'out_of_spec') not in ('pass', 'out_of_alert');
    if unfinished is not null then
      raise exception '시험이 끝나지 않은 항목이 있습니다: %', unfinished;
    end if;
  end if;

  update public.batch set status = p_decision where id = target.id returning * into target;
  return target;
end;
$$;

-- 업무 이력 행동 이름: 이슈 종류가 바뀐 것 (FR-007 수용 기준 1). 나머지는 0010과 같다 (용어는 4단계에서)
create or replace function private.history_action(table_name text, operation text, old_row jsonb, new_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when table_name = 'measurement' and new_row->>'action_request_id' is not null then '재시험 측정값 입력'
    when table_name = 'measurement' then '측정값 입력'
    when table_name = 'process_record' then '공정 조건 입력'
    when table_name = 'quality_issue' and operation = 'INSERT' then '품질 이슈 생성'
    when table_name = 'quality_issue' and new_row->>'status' = 'closed' and old_row->>'status' <> 'closed' then '품질 이슈 닫기'
    when table_name = 'quality_issue' and new_row->>'kind' is distinct from old_row->>'kind' then '품질 이슈 종류 변경'
    when table_name = 'batch' and operation = 'INSERT' then '배치 등록'
    when table_name = 'batch' and new_row->>'status' in ('releasable', 'discarded')
         and new_row->>'status' is distinct from old_row->>'status' then '출하 판정'
    when table_name = 'batch' and new_row->>'status' = 'on_hold'
         and new_row->>'hold_reason' is not null
         and new_row->>'hold_reason' is distinct from old_row->>'hold_reason' then '배치 보류'
    when table_name = 'batch' and new_row->>'status' is distinct from old_row->>'status' then '배치 상태 변경'
    when table_name = 'specification' and operation = 'INSERT' then '기준값 등록'
    when table_name = 'specification' then '기준값 수정'
    when table_name = 'profile' and new_row->>'role' is distinct from old_row->>'role' then '역할 지정'
    when table_name = 'product' and operation = 'INSERT' then '제품 등록'
    when table_name = 'handling_check' and operation = 'INSERT' then '취급점검 기록'
    when table_name = 'action_request' and operation = 'INSERT' then '조치 요청 등록'
    when table_name = 'action_request' and new_row->>'status' = 'approved' then '조치 요청 승인'
    when table_name = 'action_request' and new_row->>'status' = 'rejected' then '조치 요청 반려'
    when table_name = 'action_request' and new_row->>'status' = 'pending_approval' then '조치 요청 다시 제출'
    when table_name = 'action_request' and new_row->>'status' = 'completed' then '조치 완료'
    else table_name || ' ' || lower(operation)
  end
$$;
