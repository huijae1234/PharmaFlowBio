-- spec 011 1단계 (plan 011 §2): 공정 단계 실행. 제품별 단계(process_step), 로트별 단계 실행(step_run).
-- 판정 로직은 하나만 둔다: record_process_conditions 본문을 private.record_process로 옮기고, 지금 함수와 단계 완료가 함께 쓴다.
-- 기존 표에는 빈 값 허용 칸만 더한다. record_process_conditions의 인자·결과·문구·권한은 그대로다 (단계가 있는 작업지시 로트만 막음, FR-008).

create type public.step_run_status as enum ('in_progress', 'completed');

create table public.process_step (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (id),
  step_order integer not null check (step_order between 1 and 20),
  name text not null check (btrim(name) = name and length(name) between 1 and 40),
  retired_at timestamptz,
  created_by uuid not null references public.profile (id),
  created_at timestamptz not null default clock_timestamp(),
  constraint process_step_name_unique unique (product_id, name),
  -- 순서 바꾸기에서 두 줄을 맞바꿀 때 잠깐 겹치므로 저장 끝에 검사한다
  constraint process_step_order_unique unique (product_id, step_order) deferrable initially deferred
);

create table public.step_run (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id),
  process_step_id uuid not null references public.process_step (id),
  status public.step_run_status not null default 'in_progress',
  step_label text not null check (length(step_label) between 1 and 60),
  line_clearance text[] not null check (cardinality(line_clearance) = 4),
  started_by uuid not null references public.profile (id),
  started_at timestamptz not null default clock_timestamp(),
  completed_by uuid references public.profile (id),
  completed_at timestamptz,
  constraint step_run_once unique (batch_id, process_step_id),
  constraint step_run_completed check (status <> 'completed' or (completed_by is not null and completed_at is not null))
);
-- 한 로트에 진행 중 단계는 하나뿐
create unique index step_run_one_running on public.step_run (batch_id) where status = 'in_progress';

alter table public.process_record add column step_run_id uuid references public.step_run (id);
alter table public.specification add column process_step_id uuid references public.process_step (id);
alter table public.work_order add column completed_by uuid references public.profile (id);
alter table public.work_order add column completed_at timestamptz;
alter table public.work_order add constraint work_order_completed_at check (status <> 'completed' or completed_at is not null);

alter table public.process_step enable row level security;
alter table public.step_run enable row level security;
create policy "로그인한 사람은 읽기" on public.process_step for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.step_run for select to authenticated using (true);
grant select on public.process_step, public.step_run to authenticated;

create trigger record_history after insert or update on public.process_step
  for each row execute function private.record_history();
create trigger record_history after insert or update on public.step_run
  for each row execute function private.record_history();

-- 지금 record_process_conditions 본문 그대로 (역할 확인만 부르는 쪽으로). 공정 기록에 단계 실행을 잇는다
create or replace function private.record_process(p_batch_id uuid, p_production_quantity numeric,
  p_equipment_status public.equipment_status, p_values jsonb, p_step_run_id uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  if p_equipment_status is null then
    raise exception '설비 상태를 골라 주세요.';
  end if;
  if jsonb_typeof(entries) <> 'array' then
    raise exception '공정 조건 형식이 맞지 않습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.';
  end if;
  target := private.lock_editable_batch(p_batch_id);

  for entry in select * from jsonb_array_elements(entries) loop
    select * into spec from public.specification where id = (entry->>'specification_id')::uuid;
    if spec.id is null or spec.category <> 'process' or spec.product_id <> target.product_id then
      raise exception '이 로트의 제품에 없는 공정 조건 항목입니다. 화면을 새로 고친 뒤 다시 입력해 주세요.';
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

  insert into public.process_record (batch_id, production_quantity, equipment_status, recorded_by, step_run_id)
  values (target.id, p_production_quantity, p_equipment_status, p_by, p_step_run_id)
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
         p_by, s.min_value, s.max_value, s.alert_min_value, s.alert_max_value, s.version
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

-- 지금 함수: 인자·결과 그대로. FR-008: 단계가 있는 제품의 작업지시 로트는 단계 탭에서
create or replace function public.record_process_conditions(
  p_batch_id uuid, p_production_quantity numeric, p_equipment_status public.equipment_status, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
begin
  if exists (select 1 from public.work_order w where w.batch_id = p_batch_id)
     and exists (select 1 from public.process_step s join public.batch b on b.product_id = s.product_id
                  where b.id = p_batch_id and s.retired_at is null) then
    raise exception '공정 단계 탭에서 단계를 완료해 주세요.';
  end if;
  return private.record_process(p_batch_id, p_production_quantity, p_equipment_status, p_values, null, me.id);
end;
$$;

-- FR-001: 단계 등록(id 없음)·이름 바꾸기. 실행 기록이 있는 단계는 바꾸지 않는다
create or replace function public.save_process_step(p_id uuid, p_product_id uuid, p_name text)
returns public.process_step
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  clean_name text := btrim(coalesce(p_name, ''));
  saved public.process_step;
begin
  if clean_name = '' then
    raise exception '단계 이름을 입력해 주세요.';
  end if;
  if length(clean_name) > 40 then
    raise exception '단계 이름은 40자까지 입력해 주세요.';
  end if;
  if p_id is null then
    if not exists (select 1 from public.product where id = p_product_id) then
      raise exception '제품을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
    end if;
    perform 1 from public.product where id = p_product_id for update;
    if (select count(*) from public.process_step where product_id = p_product_id) >= 20 then
      raise exception '단계는 20개까지 등록할 수 있습니다.';
    end if;
    insert into public.process_step (product_id, step_order, name, created_by)
    values (p_product_id, coalesce((select max(step_order) from public.process_step where product_id = p_product_id), 0) + 1,
            clean_name, me.id)
    returning * into saved;
  else
    select * into saved from public.process_step where id = p_id for update;
    if saved.id is null then
      raise exception '단계를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
    end if;
    if exists (select 1 from public.step_run where process_step_id = p_id) then
      raise exception '실행 기록이 있는 단계는 바꿀 수 없습니다. 쓰지 않음으로 표시해 주세요.';
    end if;
    update public.process_step set name = clean_name where id = p_id returning * into saved;
  end if;
  return saved;
exception
  when unique_violation then
    raise exception '같은 이름의 단계가 이미 있습니다.' using errcode = '23505';
end;
$$;

-- FR-001: 위·아래 한 칸. 실행 기록이 있는 제품은 순서를 바꾸지 않는다 (진행된 로트의 순서가 흔들리지 않게)
create or replace function public.move_process_step(p_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  current_step public.process_step;
  neighbor public.process_step;
begin
  select * into current_step from public.process_step where id = p_id for update;
  if current_step.id is null then
    raise exception '단계를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  if exists (select 1 from public.step_run r join public.process_step s on s.id = r.process_step_id
              where s.product_id = current_step.product_id) then
    raise exception '실행 기록이 있는 제품은 단계 순서를 바꿀 수 없습니다.';
  end if;
  select * into neighbor from public.process_step
   where product_id = current_step.product_id
     and case when p_direction = 'up' then step_order < current_step.step_order else step_order > current_step.step_order end
   order by case when p_direction = 'up' then -step_order else step_order end
   limit 1 for update;
  if neighbor.id is null then
    return; -- 맨 위·맨 아래면 그대로
  end if;
  update public.process_step set step_order = neighbor.step_order where id = current_step.id;
  update public.process_step set step_order = current_step.step_order where id = neighbor.id;
end;
$$;

-- FR-001: 쓰지 않음 표시. 이미 실행한 로트의 기록은 그대로 보인다
create or replace function public.retire_process_step(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
begin
  update public.process_step set retired_at = clock_timestamp() where id = p_id and retired_at is null;
  if not found then
    raise exception '이미 쓰지 않음으로 표시했거나 없는 단계입니다.';
  end if;
end;
$$;

-- FR-002: 공정 기준을 단계에 잇기 (빈 값이면 미지정 → 마지막 단계에서 받음). 기준 버전은 바꾸지 않는다
create or replace function public.set_specification_step(p_specification_id uuid, p_step_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  spec public.specification;
begin
  select * into spec from public.specification where id = p_specification_id for update;
  if spec.id is null or spec.category <> 'process' then
    raise exception '공정 기준만 단계에 이을 수 있습니다.';
  end if;
  if p_step_id is not null and not exists (
       select 1 from public.process_step where id = p_step_id and product_id = spec.product_id and retired_at is null) then
    raise exception '이 제품에 없는 단계입니다. 화면을 새로 고친 뒤 다시 골라 주세요.';
  end if;
  update public.specification set process_step_id = p_step_id where id = spec.id;
end;
$$;

-- 쓰는 단계(쓰지 않음 빼고) 중 이 단계의 번호: "3/5 원액 여과"
create or replace function private.step_label(p_step_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select position_no || '/' || total || ' ' || s.name
    from public.process_step s
    cross join lateral (
      select count(*) filter (where o.step_order <= s.step_order) as position_no, count(*) as total
        from public.process_step o where o.product_id = s.product_id and o.retired_at is null) c
   where s.id = p_step_id
$$;

-- FR-004: 착수. 로트를 잠그고 작업지시·로트 상태·앞 단계·진행 중 단계·라인 클리어런스 4가지를 확인한다
create or replace function public.start_step(p_batch_id uuid, p_step_id uuid, p_clearance jsonb)
returns public.step_run
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  target public.batch;
  chosen public.process_step;
  saved public.step_run;
  required text[] := array['no_previous_material', 'no_previous_label', 'equipment_cleaned', 'area_clean'];
begin
  select * into target from public.batch where id = p_batch_id for update;
  if target.id is null then
    raise exception '로트를 찾을 수 없습니다. 목록에서 다시 골라 주세요.';
  end if;
  if not exists (select 1 from public.work_order where batch_id = target.id) then
    raise exception '작업지시로 만든 로트만 공정 단계를 진행할 수 있습니다.';
  end if;
  select * into chosen from public.process_step where id = p_step_id and product_id = target.product_id and retired_at is null;
  if chosen.id is null then
    raise exception '이 로트의 제품에 없는 단계입니다. 화면을 새로 고친 뒤 다시 골라 주세요.';
  end if;
  if target.status = 'on_hold' then
    raise exception '로트가 보류 중입니다. 품질 이슈를 처리하고 보류가 풀린 뒤 진행해 주세요.';
  end if;
  if target.status <> 'in_production' then
    raise exception '생산 중인 로트만 진행할 수 있습니다.';
  end if;
  if exists (select 1 from public.step_run where batch_id = target.id and process_step_id = chosen.id) then
    raise exception '이미 착수한 단계입니다.';
  end if;
  if exists (select 1 from public.process_step s
              where s.product_id = target.product_id and s.retired_at is null and s.step_order < chosen.step_order
                and not exists (select 1 from public.step_run r where r.batch_id = target.id and r.process_step_id = s.id
                                  and r.status = 'completed')) then
    raise exception '앞 단계를 완료한 뒤 착수할 수 있습니다.';
  end if;
  if exists (select 1 from public.step_run where batch_id = target.id and status = 'in_progress') then
    raise exception '진행 중인 단계를 먼저 완료해 주세요.';
  end if;
  if jsonb_typeof(p_clearance) is distinct from 'array' then
    raise exception '라인 클리어런스 4가지를 모두 확인해 주세요.';
  end if;
  if not (array(select jsonb_array_elements_text(p_clearance)) @> required) then
    raise exception '라인 클리어런스 4가지를 모두 확인해 주세요.';
  end if;

  insert into public.step_run (batch_id, process_step_id, step_label, line_clearance, started_by)
  values (target.id, chosen.id, private.step_label(chosen.id), required, me.id)
  returning * into saved;
  return saved;
end;
$$;

-- FR-005·006: 완료. 이 단계 기준 값만(마지막 단계는 미지정 기준도) 받아 같은 판정 로직으로. 쓰는 단계가 모두 끝나면 작업지시 완료
create or replace function public.complete_step(p_step_run_id uuid, p_production_quantity numeric,
  p_equipment_status public.equipment_status, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  run public.step_run;
  target public.batch;
  chosen public.process_step;
  is_last boolean;
  allowed uuid[];
  given uuid[];
  outcome jsonb;
  finished boolean;
begin
  select * into run from public.step_run where id = p_step_run_id for update;
  if run.id is null then
    raise exception '단계 기록을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.';
  end if;
  if run.status = 'completed' then
    raise exception '이미 완료한 단계입니다.';
  end if;
  select * into target from public.batch where id = run.batch_id for update;
  if target.status = 'on_hold' then
    raise exception '로트가 보류 중입니다. 품질 이슈를 처리하고 보류가 풀린 뒤 진행해 주세요.';
  end if;
  if target.status <> 'in_production' then
    raise exception '생산 중인 로트만 진행할 수 있습니다.';
  end if;
  select * into chosen from public.process_step where id = run.process_step_id;
  is_last := not exists (select 1 from public.process_step where product_id = chosen.product_id and retired_at is null
                                                          and step_order > chosen.step_order);
  allowed := array(select s.id from public.specification s
                    where s.product_id = target.product_id and s.category = 'process'
                      and (s.process_step_id = chosen.id or (is_last and s.process_step_id is null)));
  if jsonb_typeof(coalesce(p_values, '[]'::jsonb)) <> 'array' then
    raise exception '공정 조건 형식이 맞지 않습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.';
  end if;
  given := array(select (e->>'specification_id')::uuid from jsonb_array_elements(coalesce(p_values, '[]'::jsonb)) e);
  if not (given <@ allowed) then
    raise exception '이 단계에 없는 공정 기준입니다. 화면을 새로 고친 뒤 다시 입력해 주세요.';
  end if;
  if not (allowed <@ given) then
    raise exception '이 단계의 공정 기준 값을 모두 입력해 주세요.';
  end if;

  outcome := private.record_process(target.id, p_production_quantity, p_equipment_status, p_values, run.id, me.id);
  update public.step_run set status = 'completed', completed_by = me.id, completed_at = clock_timestamp() where id = run.id;

  finished := not exists (
    select 1 from public.process_step s
     where s.product_id = target.product_id and s.retired_at is null
       and not exists (select 1 from public.step_run r where r.batch_id = target.id and r.process_step_id = s.id and r.status = 'completed'));
  if finished then
    update public.work_order set status = 'completed', completed_by = me.id, completed_at = clock_timestamp()
     where batch_id = target.id and status = 'in_progress';
  end if;
  return outcome || jsonb_build_object('step_run_id', run.id, 'work_order_completed', finished);
end;
$$;

-- FR-006 알림: 발행(010) 그대로 + 작업지시 완료 → QA 관리자·QC 시험 담당자
alter table public.notification drop constraint notification_kind_check;
alter table public.notification add constraint notification_kind_check check (kind in (
  'sample_sent', 'sample_returned', 'approval_waiting', 'action_assigned', 'returned_back', 'out_of_spec',
  'issue_opened', 'review_approved', 'action_completed', 'issue_closed', 'release_decided', 'lot_held',
  'sample_received', 'sample_return_confirmed', 'work_order_released', 'production_completed'));

create or replace function private.notify_work_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'released' and old.status = 'draft' then
    perform private.add_notification(private.role_members('production_operator'), 'work_order_released', null,
      '#/work-orders?q=' || new.order_number,
      '작업지시 발행 · ' || new.order_number || ' · ' || (select p.item_name from public.product p where p.id = new.product_id)
      || ' ' || rtrim(to_char(new.planned_quantity, 'FM999,999,990.###'), '.') || ' ' || new.unit
      || ' · 시작 ' || to_char(new.planned_start, 'MM-DD') || ' · 발행 ' || private.actor_name());
  elsif new.status = 'completed' and old.status = 'in_progress' then
    perform private.add_notification(private.role_members('qa_manager') || private.role_members('qc_analyst'),
      'production_completed', new.batch_id, '#/batches/' || new.batch_id,
      '생산 완료 · ' || (select b.batch_number from public.batch b where b.id = new.batch_id) || ' · '
      || (select p.item_name from public.product p where p.id = new.product_id) || ' · ' || new.order_number
      || ' · 완료 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '작업지시 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- FR-009: 업무 이력에 단계 실행을 로트에 잇고 행동 이름을 더한다 (0019·0025처럼 그 줄만)
do $history$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.record_history()'::regprocedure);
  if position('''step_run''' in definition) = 0 then
    definition := replace(definition, E'    else null\n  end;',
      E'    when ''step_run'' then (new_row->>''batch_id'')::uuid\n    else null\n  end;');
    if position('''step_run''' in definition) = 0 then
      raise exception 'record_history에 단계 실행 연결을 넣지 못했습니다';
    end if;
    execute definition;
  end if;

  definition := pg_get_functiondef('private.history_action(text, text, jsonb, jsonb)'::regprocedure);
  if position('공정 단계' in definition) = 0 then
    definition := replace(definition, E'    else table_name || '' '' || lower(operation)',
      E'    when table_name = ''process_step'' then\n' ||
      E'      case when operation = ''INSERT'' then ''공정 단계 등록''\n' ||
      E'           when new_row->>''retired_at'' is not null and old_row->>''retired_at'' is null then ''공정 단계 쓰지 않음''\n' ||
      E'           when new_row->>''step_order'' is distinct from old_row->>''step_order'' then ''공정 단계 순서 변경''\n' ||
      E'           else ''공정 단계 수정'' end\n' ||
      E'      || '' ('' || (new_row->>''name'') || '')''\n' ||
      E'    when table_name = ''step_run'' and operation = ''INSERT'' then\n' ||
      E'      ''공정 단계 착수 ('' || (new_row->>''step_label'') || '', 라인 클리어런스 확인)''\n' ||
      E'    when table_name = ''step_run'' and new_row->>''status'' = ''completed'' then\n' ||
      E'      ''공정 단계 완료 ('' || (new_row->>''step_label'') || '')''\n' ||
      E'    else table_name || '' '' || lower(operation)');
    if position('공정 단계' in definition) = 0 then
      raise exception 'history_action에 공정 단계 행동 이름을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$history$;

-- 되돌리기: 로트를 지우기 전에 단계 실행을, 예시 제품을 지우기 전에 그 단계를 지운다 (예시 단계는 0029에서 다시 넣는다)
do $reset$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.replace_sample_data(uuid)'::regprocedure);
  if position('step_run' in definition) = 0 then
    definition := replace(definition, E'  delete from public.batch;\n',
                          E'  delete from public.step_run;\n  delete from public.batch;\n');
    definition := replace(definition, E'  delete from public.product where permit_item_code is null;\n',
                          E'  delete from public.process_step s using public.product p where s.product_id = p.id and p.permit_item_code is null;\n'
                          || E'  delete from public.product where permit_item_code is null;\n');
    if position('step_run' in definition) = 0 or position('process_step' in definition) = 0 then
      raise exception 'replace_sample_data에 공정 단계 줄을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$reset$;

revoke execute on function private.record_process(uuid, numeric, public.equipment_status, jsonb, uuid, uuid),
  private.step_label(uuid) from public, anon, authenticated;
revoke execute on function public.save_process_step(uuid, uuid, text), public.move_process_step(uuid, text),
  public.retire_process_step(uuid), public.set_specification_step(uuid, uuid), public.start_step(uuid, uuid, jsonb),
  public.complete_step(uuid, numeric, public.equipment_status, jsonb) from public, anon;
grant execute on function public.save_process_step(uuid, uuid, text), public.move_process_step(uuid, text),
  public.retire_process_step(uuid), public.set_specification_step(uuid, uuid), public.start_step(uuid, uuid, jsonb),
  public.complete_step(uuid, numeric, public.equipment_status, jsonb) to authenticated;
