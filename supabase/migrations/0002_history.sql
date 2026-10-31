-- FR-013 (spec 001): 자료가 바뀔 때마다 업무 이력을 남기고, 이력은 아무도 고치거나 지울 수 없다.

-- 행동 이름은 GLOSSARY·spec 001의 말을 쓴다 (화면에 그대로 보인다)
create or replace function private.history_action(table_name text, operation text, old_row jsonb, new_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when table_name = 'measurement' then '측정값 입력'
    when table_name = 'process_record' then '공정 조건 입력'
    when table_name = 'quality_issue' and operation = 'INSERT' then '품질 이슈 생성'
    when table_name = 'quality_issue' and new_row->>'status' = 'closed' and old_row->>'status' <> 'closed' then '품질 이슈 닫기'
    when table_name = 'batch' and operation = 'INSERT' then '배치 등록'
    when table_name = 'batch' and new_row->>'status' = 'on_hold'
         and new_row->>'hold_reason' is not null
         and new_row->>'hold_reason' is distinct from old_row->>'hold_reason' then '배치 보류'
    when table_name = 'batch' and new_row->>'status' is distinct from old_row->>'status' then '배치 상태 변경'
    when table_name = 'specification' and operation = 'INSERT' then '기준값 등록'
    when table_name = 'specification' then '기준값 수정'
    when table_name = 'profile' and new_row->>'role' is distinct from old_row->>'role' then '역할 지정'
    when table_name = 'product' and operation = 'INSERT' then '제품 등록'
    when table_name = 'action_request' and operation = 'INSERT' then '조치 요청 등록'
    else table_name || ' ' || lower(operation)
  end
$$;

create or replace function private.record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profile;
  old_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_row jsonb := to_jsonb(new);
  related_batch uuid;
begin
  -- 로그인한 사람이 없는 변경(설치용 예시 자료, 첫 로그인 시 profile 생성)은 남기지 않는다
  if auth.uid() is null then
    return new;
  end if;
  select * into actor from public.profile where id = auth.uid();
  if actor.id is null then
    return new;
  end if;
  -- 바뀐 것이 없는 수정은 남기지 않는다
  if tg_op = 'UPDATE' and old_row = new_row then
    return new;
  end if;

  related_batch := case tg_table_name
    when 'batch' then (new_row->>'id')::uuid
    when 'measurement' then (new_row->>'batch_id')::uuid
    when 'process_record' then (new_row->>'batch_id')::uuid
    when 'quality_issue' then (new_row->>'batch_id')::uuid
    when 'action_request' then (select q.batch_id from public.quality_issue q where q.id = (new_row->>'quality_issue_id')::uuid)
    else null
  end;

  insert into public.work_history (actor_id, actor_name, actor_role, action, target_table, target_id, batch_id, before_data, after_data)
  values (actor.id, actor.display_name, actor.role::text,
          private.history_action(tg_table_name, tg_op, old_row, new_row),
          tg_table_name, (new_row->>'id')::uuid, related_batch, old_row, new_row);
  return new;
end;
$$;

create trigger record_history after insert or update on public.batch
  for each row execute function private.record_history();
create trigger record_history after insert on public.measurement
  for each row execute function private.record_history();
create trigger record_history after insert on public.process_record
  for each row execute function private.record_history();
create trigger record_history after insert or update on public.quality_issue
  for each row execute function private.record_history();
create trigger record_history after insert or update on public.specification
  for each row execute function private.record_history();
create trigger record_history after insert or update on public.product
  for each row execute function private.record_history();
create trigger record_history after update of role on public.profile
  for each row execute function private.record_history();
create trigger record_history after insert or update on public.action_request
  for each row execute function private.record_history();

-- 이력 고치기·지우기 막기 (postgres·service 키 포함)
create or replace function private.reject_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '업무 이력은 고치거나 지울 수 없습니다.' using errcode = '42501';
end;
$$;

create trigger reject_change before update or delete on public.work_history
  for each row execute function private.reject_history_change();
create trigger reject_truncate before truncate on public.work_history
  for each statement execute function private.reject_history_change();
