-- spec 017 (plan 017 1단계): 시험 완료 알림(FR-001·002), 시험값 한 번에 저장(FR-004), 출하 완료 기록(FR-005~007).
-- 0031(로트 상태 'shipped')이 먼저 적용돼 있어야 한다. 판정·자동 보류·출하 가능 조건은 바꾸지 않는다.

-- ERD batch: 출하 완료 칸 (spec 017 핵심 자료)
alter table public.batch add column shipped_at timestamptz;
alter table public.batch add column ship_note text check (length(ship_note) <= 200);
alter table public.batch add column shipped_by uuid references public.profile (id);
alter table public.batch add column ship_recorded_at timestamptz;
alter table public.batch add constraint batch_shipped_fields
  check (status <> 'shipped' or (shipped_at is not null and shipped_by is not null and ship_recorded_at is not null));

-- 알림 종류 둘 더함: 시험 완료(FR-002), 출하 완료(FR-007)
alter table public.notification drop constraint notification_kind_check;
alter table public.notification add constraint notification_kind_check check (kind = any (array[
  'sample_sent', 'sample_returned', 'approval_waiting', 'action_assigned', 'returned_back', 'out_of_spec', 'issue_opened',
  'review_approved', 'action_completed', 'issue_closed', 'release_decided', 'lot_held', 'sample_received',
  'sample_return_confirmed', 'work_order_released', 'production_completed', 'tests_completed', 'lot_shipped']));

-- FR-006: 출하 완료 로트도 출하 가능·폐기처럼 바꿀 수 없다
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
    raise exception '로트를 찾을 수 없습니다. 목록에서 다시 골라 주세요.' using errcode = 'P0002';
  end if;
  if target.status in ('releasable', 'discarded', 'shipped') then
    raise exception '내부 출하 검토가 끝난 로트는 바꿀 수 없습니다.';
  end if;
  return target;
end;
$$;

-- 판정 로직은 하나만: 지금 record_test_measurement 본문을 그대로 옮긴다(역할 확인만 밖으로). 결과 모양·문구 그대로
create or replace function private.record_test(p_batch_id uuid, p_specification_id uuid, p_value numeric, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.batch;
  spec public.specification;
  verdict public.measurement_result;
  issue_id uuid;
  measurement_id uuid;
  next_status public.batch_status;
begin
  if p_value is null then
    raise exception '숫자로 입력해 주세요.';
  end if;
  target := private.lock_editable_batch(p_batch_id);

  select * into spec from public.specification where id = p_specification_id;
  if spec.id is null or spec.category <> 'test' or spec.product_id <> target.product_id then
    raise exception '이 로트의 제품에 없는 시험 항목입니다. 시험 항목을 다시 골라 주세요.';
  end if;
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
  values (target.id, spec.id, p_value, verdict, issue_id, p_by,
          spec.min_value, spec.max_value, spec.alert_min_value, spec.alert_max_value, spec.version)
  returning id into measurement_id;

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

create or replace function public.record_test_measurement(p_batch_id uuid, p_specification_id uuid, p_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
begin
  me := private.require_role(array['qc_analyst', 'qa_manager']::public.user_role[], 'QC 시험 담당자·QA 관리자');
  return private.record_test(p_batch_id, p_specification_id, p_value, me.id);
end;
$$;

-- FR-004: 여러 항목을 한 번에. 함수 하나 안에서 도니까 하나라도 실패하면 모두 되돌려진다
create or replace function public.record_test_measurements(p_batch_id uuid, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  item jsonb;
  results jsonb := '[]'::jsonb;
begin
  me := private.require_role(array['qc_analyst', 'qa_manager']::public.user_role[], 'QC 시험 담당자·QA 관리자');
  if p_values is null or jsonb_typeof(p_values) <> 'array' or jsonb_array_length(p_values) = 0 then
    raise exception '시험값을 하나 이상 입력해 주세요.';
  end if;
  perform private.lock_editable_batch(p_batch_id); -- 같은 로트 저장을 차례로 세워 동시 입력을 막는다

  if (select count(*) <> count(distinct e->>'specification_id') from jsonb_array_elements(p_values) e)
     or exists (select 1 from jsonb_array_elements(p_values) e
                  join public.measurement m on m.specification_id::text = e->>'specification_id'
                 where m.batch_id = p_batch_id and m.action_request_id is null) then
    raise exception '이미 입력된 시험 항목이 있습니다. 창을 닫고 다시 열어 주세요.';
  end if;

  for item in select e from jsonb_array_elements(p_values) e loop
    if jsonb_typeof(item->'value') is distinct from 'number' then
      raise exception '숫자로 입력해 주세요.';
    end if;
    results := results || jsonb_build_array(
      private.record_test(p_batch_id, (item->>'specification_id')::uuid, (item->>'value')::numeric, me.id)
      || jsonb_build_object('specification_id', item->>'specification_id'));
  end loop;
  return results;
end;
$$;

-- FR-001·002: 재시험이 아닌 측정값이 들어올 때, 이번 줄로 제품의 시험 항목이 모두 채워졌으면 QA 관리자에게 한 번 알린다.
-- 항목마다 첫 측정값은 하나뿐이라(위 함수가 막음) 모두 채워지는 줄은 하나다. 항목이 늘면 새 항목이 채워질 때 다시 맞아떨어진다(Q79)
create or replace function private.notify_tests_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot public.batch;
  total int;
  done int;
  passed int;
begin
  if new.action_request_id is not null then
    return null;
  end if;
  select * into lot from public.batch where id = new.batch_id;
  if not exists (select 1 from public.specification s
                  where s.id = new.specification_id and s.category = 'test' and s.product_id = lot.product_id) then
    return null;
  end if;
  select count(*) into total from public.specification s where s.product_id = lot.product_id and s.category = 'test';
  select count(distinct m.specification_id), count(distinct m.specification_id) filter (where m.result = 'pass')
    into done, passed
    from public.measurement m
    join public.specification s on s.id = m.specification_id and s.product_id = lot.product_id and s.category = 'test'
   where m.batch_id = lot.id and m.action_request_id is null;
  if done <> total then
    return null;
  end if;
  perform private.add_notification_for('batch', lot.id, private.role_members('qa_manager'), 'tests_completed', lot.id,
    '#/batches/' || lot.id, '시험 완료 · ' || lot.batch_number || ' · 정상 ' || passed || ' · 이탈 ' || (done - passed));
  return null;
exception when others then
  raise warning '시험 완료 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

create trigger notify_tests_complete after insert on public.measurement
  for each row execute function private.notify_tests_complete();

-- FR-005: 출하 완료 기록. 생산 담당자만, 출하 가능 로트만
create or replace function public.ship_batch(p_batch_id uuid, p_shipped_at timestamptz, p_note text)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  target public.batch;
  released_at timestamptz;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  me := private.require_role(array['production_operator']::public.user_role[], '생산 담당자');
  select * into target from public.batch where id = p_batch_id for update;
  if target.id is null then
    raise exception '로트를 찾을 수 없습니다. 목록에서 다시 골라 주세요.' using errcode = 'P0002';
  end if;
  if target.status <> 'releasable' then
    raise exception '출하 가능 로트만 출하 완료로 기록할 수 있습니다.';
  end if;
  if p_shipped_at is null then
    raise exception '출하 일시를 입력해 주세요.';
  end if;
  if p_shipped_at > clock_timestamp() + interval '1 minute' then -- 화면 시계가 조금 빠른 경우만 봐준다
    raise exception '출하 일시는 지금보다 뒤일 수 없습니다.';
  end if;
  -- 출하 가능이 된 시각은 업무 이력에만 있다. 화면은 분 단위로 넣으므로 분으로 비교한다
  select max(h.created_at) into released_at from public.work_history h
   where h.target_table = 'batch' and h.target_id = target.id and h.after_data->>'status' = 'releasable';
  if released_at is not null and p_shipped_at < date_trunc('minute', released_at) then
    raise exception '출하 일시는 출하 가능 판정 뒤여야 합니다.';
  end if;
  if length(note) > 200 then
    raise exception '메모는 200자까지 입력해 주세요.';
  end if;

  update public.batch
     set status = 'shipped', shipped_at = p_shipped_at, ship_note = note, shipped_by = me.id, ship_recorded_at = clock_timestamp()
   where id = target.id
  returning * into target;
  return target;
end;
$$;

-- FR-007: 출하 완료 → QA 관리자 알림. 나머지 두 갈래는 지금 그대로
create or replace function private.notify_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  path text := '#/batches/' || new.id;
begin
  if new.status in ('releasable', 'discarded') and new.status is distinct from old.status then
    perform private.add_notification_for(tg_table_name, new.id, private.role_members('production_operator'), 'release_decided', new.id, path,
      '내부 출하 검토 결과 · ' || new.batch_number || ' · ' || case when new.status = 'releasable' then '출하 가능' else '폐기' end
      || ' · 검토 ' || private.actor_name());
  elsif new.status = 'shipped' and new.status is distinct from old.status then
    perform private.add_notification_for(tg_table_name, new.id, private.role_members('qa_manager'), 'lot_shipped', new.id, path,
      '출하 완료 · ' || new.batch_number || ' · ' || private.actor_name());
  elsif new.status = 'on_hold' and new.hold_reason is not null and new.hold_reason is distinct from old.hold_reason then
    perform private.add_notification_for(tg_table_name, new.id, private.role_members('production_operator') || private.role_members('qc_analyst'), 'lot_held', new.id, path,
      '로트 보류 · ' || new.batch_number || ' · 사유 ' || private.notify_text(new.hold_reason) || ' · 보류 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '로트 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- FR-007: 업무 이력 이름 "출하 완료". 지금 정의에 한 줄만 끼운다(바꾼 수가 1이 아니면 멈춘다)
do $history$
declare
  definition text := pg_get_functiondef('private.history_action(text,text,jsonb,jsonb)'::regprocedure);
  anchor text := E'    when table_name = ''batch'' and new_row->>''status'' in (''releasable'', ''discarded'')';
  changed text;
begin
  if position('출하 완료' in definition) > 0 then
    return;
  end if;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'history_action에서 로트 출하 검토 줄을 하나로 찾지 못함';
  end if;
  changed := replace(definition, anchor,
    E'    when table_name = ''batch'' and new_row->>''status'' = ''shipped''\n         and new_row->>''status'' is distinct from old_row->>''status'' then ''출하 완료''\n' || anchor);
  execute changed;
end
$history$;

revoke execute on function private.record_test(uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.record_test_measurements(uuid, jsonb), public.ship_batch(uuid, timestamptz, text) from public, anon;
grant execute on function public.record_test_measurements(uuid, jsonb), public.ship_batch(uuid, timestamptz, text) to authenticated;
