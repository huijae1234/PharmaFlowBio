-- spec 001 저장 함수. 화면은 이 함수들로만 쓴다 (0003에서 표 쓰기 권한을 회수함).
-- 함수마다 역할을 다시 확인하고, 한 함수 안의 저장은 한꺼번에 되거나 한꺼번에 안 된다 (FR-006, FR-014).

-- FR-003: 처음 로그인하면 열람자 profile을 만든다
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profile (id, display_name, email)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      '이름 없음'),
    coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- FR-006: 역할 확인. 문구는 spec 001 FR-006 수용 기준 3
create or replace function private.require_role(allowed public.user_role[], who text)
returns public.profile
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profile;
begin
  select * into me from public.profile where id = auth.uid();
  if me.id is null or not (me.role = any (allowed)) then
    raise exception '이 작업은 %만 할 수 있습니다.', who using errcode = '42501';
  end if;
  return me;
end;
$$;

-- Q11: 출하 판정이 끝난 배치는 바꿀 수 없다. 동시에 두 번 저장되지 않게 배치를 잠근다 (FR-009 수용 기준 4)
create or replace function private.lock_editable_batch(p_batch_id uuid)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.batch;
begin
  select * into target from public.batch where id = p_batch_id for update;
  if target.id is null then
    raise exception '배치를 찾을 수 없습니다. 목록에서 다시 골라 주세요.' using errcode = 'P0002';
  end if;
  if target.status in ('releasable', 'discarded') then
    raise exception '출하 판정이 끝난 배치는 바꿀 수 없습니다.';
  end if;
  return target;
end;
$$;

-- FR-008: 배치 등록
create or replace function public.create_batch(p_batch_number text, p_product_id uuid)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  created public.batch;
  clean_number text := btrim(coalesce(p_batch_number, ''));
begin
  me := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  if clean_number = '' then
    raise exception '배치번호를 입력해 주세요.';
  end if;
  if not exists (select 1 from public.product where id = p_product_id) then
    raise exception '제품을 골라 주세요.';
  end if;
  insert into public.batch (batch_number, product_id, created_by)
  values (clean_number, p_product_id, me.id)
  returning * into created;
  return created;
exception
  when unique_violation then
    raise exception '이미 있는 배치번호입니다.' using errcode = '23505';
end;
$$;

-- FR-009, FR-010: 시험값 저장 + 판정 + (이탈이면) 품질 이슈 + 배치 상태를 한꺼번에
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
  insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, measured_by)
  values (target.id, spec.id, p_value, verdict, issue_id, me.id)
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

-- FR-011: 공정 조건 저장. 하나라도 이탈이거나 설비 이상이면 품질 이슈 1개 + 보류
-- p_values: [{"specification_id": uuid, "value": number}, ...]
-- 이 함수는 0006에서 바뀌었다: 공정 이슈에 quality_issue.process_record_id를 함께 넣는다 (Q15)
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
    insert into public.quality_issue (batch_id, source) values (target.id, 'process') returning id into issue_id;
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

-- FR-012: 사유를 적어 직접 보류
create or replace function public.hold_batch(p_batch_id uuid, p_reason text)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text := btrim(coalesce(p_reason, ''));
  target public.batch;
begin
  perform private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  if reason = '' then
    raise exception '보류 사유를 입력해 주세요.';
  end if;
  target := private.lock_editable_batch(p_batch_id);
  update public.batch set status = 'on_hold', hold_reason = reason where id = target.id returning * into target;
  return target;
end;
$$;

-- FR-004: QA 관리자의 역할 지정. 자기 역할은 못 바꾼다 (QA 관리자 0명 방지)
create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
begin
  me := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if p_user_id = me.id then
    raise exception 'QA 관리자는 자기 역할을 바꿀 수 없습니다.';
  end if;
  update public.profile set role = p_role where id = p_user_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
end;
$$;

-- FR-004: 사용자·역할 화면 (이메일 포함, QA 관리자만)
create or replace function public.list_users()
returns table (id uuid, display_name text, email text, role public.user_role, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  return query
    select p.id, p.display_name, p.email, p.role, p.created_at
      from public.profile p
     order by p.created_at desc;
end;
$$;

-- FR-007: 기준값 등록·수정 (QA 관리자만). 이미 있는 측정값의 판정은 바뀌지 않는다 (measurement.result에 저장됨)
create or replace function public.save_specification(
  p_id uuid, p_product_id uuid, p_category public.spec_category,
  p_item_name text, p_unit text, p_min numeric, p_max numeric)
returns public.specification
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(coalesce(p_item_name, ''));
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

  if p_id is null then
    insert into public.specification (product_id, category, item_name, unit, min_value, max_value)
    values (p_product_id, p_category, clean_name, nullif(btrim(p_unit), ''), p_min, p_max)
    returning * into saved;
  else
    update public.specification
       set category = p_category, item_name = clean_name, unit = nullif(btrim(p_unit), ''),
           min_value = p_min, max_value = p_max
     where id = p_id and product_id = p_product_id
    returning * into saved;
    if saved.id is null then
      raise exception '기준값을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
    end if;
  end if;
  return saved;
exception
  when unique_violation then
    raise exception '이미 있는 항목입니다.' using errcode = '23505';
end;
$$;

-- 함수 실행 권한: 로그인한 사람만 (함수 안에서 역할을 다시 확인한다)
revoke execute on function public.create_batch(text, uuid) from public, anon;
revoke execute on function public.record_test_measurement(uuid, uuid, numeric) from public, anon;
revoke execute on function public.record_process_conditions(uuid, numeric, public.equipment_status, jsonb) from public, anon;
revoke execute on function public.hold_batch(uuid, text) from public, anon;
revoke execute on function public.set_user_role(uuid, public.user_role) from public, anon;
revoke execute on function public.list_users() from public, anon;
revoke execute on function public.save_specification(uuid, uuid, public.spec_category, text, text, numeric, numeric) from public, anon;
grant execute on function public.create_batch(text, uuid) to authenticated;
grant execute on function public.record_test_measurement(uuid, uuid, numeric) to authenticated;
grant execute on function public.record_process_conditions(uuid, numeric, public.equipment_status, jsonb) to authenticated;
grant execute on function public.hold_batch(uuid, text) to authenticated;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;
grant execute on function public.list_users() to authenticated;
grant execute on function public.save_specification(uuid, uuid, public.spec_category, text, text, numeric, numeric) to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_user_role() to authenticated;
