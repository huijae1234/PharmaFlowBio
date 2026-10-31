-- spec 010 1단계 (plan 010 §2): 작업지시(ERD work_order). 작성 → 발행 → 착수(로트 생성) → 진행 중, 착수 전 취소.
-- 더하기만 한다. 예외 하나: 로트 직접 등록(create_batch)을 QA 관리자로 좁힌다 (spec 010 FR-007, MES 설계 Q54).

create type public.work_order_status as enum ('draft', 'released', 'in_progress', 'completed', 'cancelled');

create table public.work_order (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique check (order_number ~ '^WO-\d{4}-\d{3}$'),
  product_id uuid not null references public.product (id),
  planned_quantity numeric not null check (planned_quantity > 0 and planned_quantity <= 1000000),
  unit text not null check (unit in ('바이알', 'mL', 'L', '개')),
  planned_start date not null,
  planned_end date not null,
  note text check (length(note) <= 200),
  status public.work_order_status not null default 'draft',
  batch_id uuid unique references public.batch (id),
  created_by uuid not null references public.profile (id),
  created_at timestamptz not null default clock_timestamp(),
  released_by uuid references public.profile (id),
  released_at timestamptz,
  started_by uuid references public.profile (id),
  started_at timestamptz,
  cancelled_by uuid references public.profile (id),
  cancelled_at timestamptz,
  cancel_reason text check (btrim(cancel_reason) <> '' and length(cancel_reason) <= 200),
  constraint work_order_period check (planned_start <= planned_end),
  -- 착수한 작업지시는 로트가 있어야 하고, 취소는 사유가 있어야 한다
  constraint work_order_started_has_batch check (status not in ('in_progress', 'completed') or batch_id is not null),
  constraint work_order_cancel_has_reason check (status <> 'cancelled' or cancel_reason is not null)
);
create index work_order_status_index on public.work_order (status);

-- 읽기는 로그인한 사람 모두, 쓰기는 아래 함수로만 (ADR 0002)
alter table public.work_order enable row level security;
create policy "로그인한 사람은 읽기" on public.work_order for select to authenticated using (true);
grant select on public.work_order to authenticated;

create trigger record_history after insert or update on public.work_order
  for each row execute function private.record_history();

-- 로트 만들기 규칙 한곳: QA 관리자 로트 등록과 작업지시 착수가 함께 쓴다 (문구는 지금 create_batch 그대로)
create or replace function private.insert_batch(p_number text, p_product uuid, p_by uuid)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_number text := btrim(coalesce(p_number, ''));
  created public.batch;
begin
  if clean_number = '' then
    raise exception '로트번호를 입력해 주세요.';
  end if;
  if not exists (select 1 from public.product where id = p_product) then
    raise exception '제품을 골라 주세요.';
  end if;
  insert into public.batch (batch_number, product_id, created_by)
  values (clean_number, p_product, p_by)
  returning * into created;
  return created;
exception
  when unique_violation then
    raise exception '이미 있는 로트번호입니다.' using errcode = '23505';
end;
$$;

-- FR-007: 로트 직접 등록은 QA 관리자만 (예외용). 인자·반환값·문구는 그대로
create or replace function public.create_batch(p_batch_number text, p_product_id uuid)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
begin
  return private.insert_batch(p_batch_number, p_product_id, me.id);
end;
$$;

-- FR-001: 작성. 번호는 계획 시작일 연월로 매기고(Q61), 같은 달은 한 번에 하나씩 매긴다
create or replace function public.create_work_order(p_input jsonb)
returns public.work_order
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  quantity_text text := btrim(coalesce(p_input->>'planned_quantity', ''));
  note_text text := nullif(btrim(coalesce(p_input->>'note', '')), '');
  start_day date;
  end_day date;
  month_key text;
  next_seq integer;
  saved public.work_order;
begin
  if not exists (select 1 from public.product where id = (nullif(p_input->>'product_id', ''))::uuid) then
    raise exception '제품을 골라 주세요.';
  end if;
  if quantity_text !~ '^\d+(\.\d+)?$' or quantity_text::numeric <= 0 then
    raise exception '계획 수량은 0보다 큰 숫자로 입력해 주세요.';
  end if;
  if quantity_text::numeric > 1000000 then
    raise exception '계획 수량이 너무 큽니다. 1,000,000 이하로 입력해 주세요.';
  end if;
  if coalesce(p_input->>'unit', '') not in ('바이알', 'mL', 'L', '개') then
    raise exception '단위를 골라 주세요.';
  end if;
  begin
    start_day := (p_input->>'planned_start')::date;
    end_day := (p_input->>'planned_end')::date;
  exception when others then
    start_day := null;
  end;
  if start_day is null or end_day is null then
    raise exception '계획 시작일과 종료일을 입력해 주세요.';
  end if;
  if end_day < start_day then
    raise exception '계획 종료일은 시작일과 같거나 뒤여야 합니다.';
  end if;
  if length(note_text) > 200 then
    raise exception '메모는 200자까지 입력해 주세요.';
  end if;

  month_key := to_char(start_day, 'YYMM');
  perform pg_advisory_xact_lock(hashtext('work_order:' || month_key));
  select coalesce(max(substr(w.order_number, 9)::integer), 0) + 1 into next_seq
    from public.work_order w where w.order_number like 'WO-' || month_key || '-%';
  if next_seq > 999 then
    raise exception '이번 달 작업지시 번호를 다 썼습니다. 관리자에게 알려 주세요.';
  end if;

  insert into public.work_order (order_number, product_id, planned_quantity, unit, planned_start, planned_end, note, created_by)
  values ('WO-' || month_key || '-' || lpad(next_seq::text, 3, '0'), (p_input->>'product_id')::uuid, quantity_text::numeric,
          p_input->>'unit', start_day, end_day, note_text, me.id)
  returning * into saved;
  return saved;
end;
$$;

-- FR-002: 발행은 QA 관리자만 (Q55). 자기가 작성한 것도 된다 (Q59)
create or replace function public.release_work_order(p_id uuid)
returns public.work_order
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  saved public.work_order;
begin
  select * into saved from public.work_order where id = p_id for update;
  if saved.id is null then
    raise exception '작업지시를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  if saved.status <> 'draft' then
    raise exception '작성 상태인 작업지시만 발행할 수 있습니다.';
  end if;
  update public.work_order set status = 'released', released_by = me.id, released_at = clock_timestamp()
   where id = p_id returning * into saved;
  return saved;
end;
$$;

-- FR-003: 착수. 로트 만들기와 작업지시 바꾸기는 한 저장 안에서 (로트번호가 겹치면 둘 다 되돌아감)
create or replace function public.start_work_order(p_id uuid, p_batch_number text)
returns public.work_order
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  saved public.work_order;
  created public.batch;
begin
  select * into saved from public.work_order where id = p_id for update;
  if saved.id is null then
    raise exception '작업지시를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  if saved.status <> 'released' then
    raise exception '발행된 작업지시만 착수할 수 있습니다.';
  end if;
  created := private.insert_batch(p_batch_number, saved.product_id, me.id);
  update public.work_order set status = 'in_progress', batch_id = created.id, started_by = me.id, started_at = clock_timestamp()
   where id = p_id returning * into saved;
  return saved;
end;
$$;

-- FR-004: 착수 전(작성·발행)만 사유를 적어 취소
create or replace function public.cancel_work_order(p_id uuid, p_reason text)
returns public.work_order
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  reason_text text := btrim(coalesce(p_reason, ''));
  saved public.work_order;
begin
  select * into saved from public.work_order where id = p_id for update;
  if saved.id is null then
    raise exception '작업지시를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  if saved.status in ('in_progress', 'completed') then
    raise exception '착수한 작업지시는 취소할 수 없습니다. 로트를 그만두려면 품질 이슈에서 로트 폐기 조치를 요청해 주세요.';
  end if;
  if saved.status = 'cancelled' then
    raise exception '이미 취소된 작업지시입니다.';
  end if;
  if reason_text = '' then
    raise exception '취소 사유를 입력해 주세요.';
  end if;
  if length(reason_text) > 200 then
    raise exception '취소 사유는 200자까지 입력해 주세요.';
  end if;
  update public.work_order set status = 'cancelled', cancelled_by = me.id, cancelled_at = clock_timestamp(), cancel_reason = reason_text
   where id = p_id returning * into saved;
  return saved;
end;
$$;

-- FR-009: 발행 → 생산 담당자 모두 (spec 009 틀). 오류가 나도 발행은 막지 않는다
alter table public.notification drop constraint notification_kind_check;
alter table public.notification add constraint notification_kind_check check (kind in (
  'sample_sent', 'sample_returned', 'approval_waiting', 'action_assigned', 'returned_back', 'out_of_spec',
  'issue_opened', 'review_approved', 'action_completed', 'issue_closed', 'release_decided', 'lot_held',
  'sample_received', 'sample_return_confirmed', 'work_order_released'));

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
  end if;
  return null;
exception when others then
  raise warning '작업지시 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

create trigger notify_work_order after update on public.work_order
  for each row execute function private.notify_work_order();

-- FR-008: 업무 이력에 로트를 잇고(착수 줄은 그 로트 이력에도) 행동 이름을 더한다. 0019처럼 지금 정의에서 그 줄만 바꾼다
do $history$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.record_history()'::regprocedure);
  if position('''work_order''' in definition) = 0 then
    definition := replace(definition, E'    else null\n  end;',
      E'    when ''work_order'' then (new_row->>''batch_id'')::uuid\n    else null\n  end;');
    if position('''work_order''' in definition) = 0 then
      raise exception 'record_history에 작업지시 연결을 넣지 못했습니다';
    end if;
    execute definition;
  end if;

  definition := pg_get_functiondef('private.history_action(text, text, jsonb, jsonb)'::regprocedure);
  if position('작업지시' in definition) = 0 then
    definition := replace(definition, E'    else table_name || '' '' || lower(operation)',
      E'    when table_name = ''work_order'' then\n' ||
      E'      case when operation = ''INSERT'' then ''작업지시 작성''\n' ||
      E'           when new_row->>''status'' = ''released'' then ''작업지시 발행''\n' ||
      E'           when new_row->>''status'' = ''in_progress'' then ''작업지시 착수''\n' ||
      E'           when new_row->>''status'' = ''completed'' then ''작업지시 완료''\n' ||
      E'           when new_row->>''status'' = ''cancelled'' then ''작업지시 취소''\n' ||
      E'           else ''작업지시 변경'' end\n' ||
      E'      || '' ('' || (new_row->>''order_number'') || '')''\n' ||
      E'    else table_name || '' '' || lower(operation)');
    if position('작업지시' in definition) = 0 then
      raise exception 'history_action에 작업지시 행동 이름을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$history$;

revoke execute on function private.insert_batch(text, uuid, uuid), private.notify_work_order() from public, anon, authenticated;
revoke execute on function public.create_work_order(jsonb), public.release_work_order(uuid), public.start_work_order(uuid, text),
  public.cancel_work_order(uuid, text) from public, anon;
grant execute on function public.create_work_order(jsonb), public.release_work_order(uuid), public.start_work_order(uuid, text),
  public.cancel_work_order(uuid, text) to authenticated;
