-- spec 008 1단계 (plan 008 §2): 검체 인계 기록(ERD sample_transfer).
-- 더하기만 한다. 기존 표·자료·판정·출하 규칙은 바꾸지 않는다 (spec 008 "연결 안 함").

create type public.sample_team as enum ('production', 'qc', 'qa');
create type public.sample_kind as enum ('test', 'retention');
create type public.sample_status as enum ('pending', 'held', 'return_pending', 'returned', 'consumed');

create table public.sample_transfer (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id),
  sample_kind public.sample_kind not null,
  from_team public.sample_team not null,
  to_team public.sample_team not null,
  quantity integer not null check (quantity between 1 and 9999),
  unit text not null check (unit in ('바이알', 'mL', 'g', '개')),
  note text check (length(note) <= 200),
  status public.sample_status not null default 'pending',
  sent_by uuid not null references public.profile (id),
  sent_at timestamptz not null default clock_timestamp(),
  received_by uuid references public.profile (id),
  received_at timestamptz,
  storage_location text check (btrim(storage_location) <> '' and length(storage_location) <= 60),
  returned_quantity integer check (returned_quantity >= 1 and returned_quantity <= quantity),
  return_requested_by uuid references public.profile (id),
  return_requested_at timestamptz,
  return_confirmed_by uuid references public.profile (id),
  returned_at timestamptz,
  consumed_by uuid references public.profile (id),
  consumed_at timestamptz,
  -- FR-001: 길은 세 가지만
  constraint sample_route check (
    (from_team = 'production' and to_team = 'qc' and sample_kind = 'test')
    or (from_team = 'production' and to_team = 'qa' and sample_kind = 'retention')
    or (from_team = 'qa' and to_team = 'qc' and sample_kind = 'retention'))
);
create index sample_transfer_batch_id on public.sample_transfer (batch_id);

-- 읽기는 로그인한 사람 모두, 쓰기는 아래 함수로만 (ADR 0002)
alter table public.sample_transfer enable row level security;
create policy "로그인한 사람은 읽기" on public.sample_transfer for select to authenticated using (true);
grant select on public.sample_transfer to authenticated;

create trigger record_history after insert or update on public.sample_transfer
  for each row execute function private.record_history();

-- 이력·안내 문구에 쓰는 "QA → QC, 보존 검체 2 바이알". 반납 뒤에는 반납 수량
create or replace function private.sample_route_text(row_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select (case row_data->>'from_team' when 'production' then '생산' when 'qc' then 'QC' else 'QA' end)
      || ' → ' || (case row_data->>'to_team' when 'production' then '생산' when 'qc' then 'QC' else 'QA' end)
      || ', ' || (case row_data->>'sample_kind' when 'test' then '시험 검체' else '보존 검체' end)
      || ' ' || (case when row_data->>'status' in ('return_pending', 'returned') then row_data->>'returned_quantity'
                      else row_data->>'quantity' end)
      || ' ' || (row_data->>'unit')
$$;

-- FR-007: 업무 이력에 로트를 잇고 행동 이름을 더한다. 0016처럼 지금 정의에서 그 줄만 바꿔 다시 만든다
do $history$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.record_history()'::regprocedure);
  if position('''sample_transfer''' in definition) = 0 then
    definition := replace(definition, E'    else null\n  end;',
      E'    when ''sample_transfer'' then (new_row->>''batch_id'')::uuid\n    else null\n  end;');
    if position('''sample_transfer''' in definition) = 0 then
      raise exception 'record_history에 검체 연결을 넣지 못했습니다';
    end if;
    execute definition;
  end if;

  definition := pg_get_functiondef('private.history_action(text, text, jsonb, jsonb)'::regprocedure);
  if position('검체' in definition) = 0 then
    definition := replace(definition, E'    else table_name || '' '' || lower(operation)',
      E'    when table_name = ''sample_transfer'' then\n' ||
      E'      case when operation = ''INSERT'' then ''검체 전달''\n' ||
      E'           when new_row->>''status'' = ''held'' then ''검체 인수 확인''\n' ||
      E'           when new_row->>''status'' = ''return_pending'' then ''검체 반납''\n' ||
      E'           when new_row->>''status'' = ''returned'' then ''검체 반납 확인''\n' ||
      E'           when new_row->>''status'' = ''consumed'' then ''검체 소진''\n' ||
      E'           else ''검체 기록 변경'' end\n' ||
      E'      || '' ('' || private.sample_route_text(new_row) || '')''\n' ||
      E'    else table_name || '' '' || lower(operation)');
    if position('검체' in definition) = 0 then
      raise exception 'history_action에 검체 행동 이름을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$history$;

-- 역할 → 팀 (spec 008 2절). 열람자는 팀이 없다
create or replace function private.team_of(p_role public.user_role)
returns public.sample_team
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'production_operator' then 'production'::public.sample_team
                     when 'qc_analyst' then 'qc'::public.sample_team
                     when 'qa_manager' then 'qa'::public.sample_team end
$$;

-- FR-006, Q47: 로트마다 QA가 보관 중인 보존 검체 수 (domain sample-rules.js retainedQuantity와 같은 식)
create or replace function private.qa_retained_quantity(p_batch uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case
           when from_team = 'production' and to_team = 'qa' and status = 'held' then quantity
           when from_team = 'qa' and to_team = 'qc' then -quantity + case when status = 'returned' then returned_quantity else 0 end
           else 0 end), 0)::integer
    from public.sample_transfer where batch_id = p_batch
$$;

-- 처리할 기록을 잠그고 읽는다. 두 사람이 거의 동시에 눌러도 한 사람만 상태를 바꾼다 (spec 경계 상황)
create or replace function private.lock_sample(p_id uuid)
returns public.sample_transfer
language plpgsql
set search_path = ''
as $$
declare
  locked public.sample_transfer;
begin
  select * into locked from public.sample_transfer where id = p_id for update;
  if locked.id is null then
    raise exception '검체 기록을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  return locked;
end;
$$;

-- FR-001 검체 전달 등록
create or replace function public.send_sample(p_batch uuid, p_input jsonb)
returns public.sample_transfer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  route_ok boolean;
  quantity_text text := btrim(coalesce(p_input->>'quantity', ''));
  note_text text := nullif(btrim(coalesce(p_input->>'note', '')), '');
  held integer;
  saved public.sample_transfer;
begin
  if not exists (select 1 from public.batch where id = p_batch) then
    raise exception '로트를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  route_ok := (p_input->>'from_team') = private.team_of(me.role)::text
    and ((p_input->>'from_team' = 'production' and p_input->>'to_team' = 'qc' and p_input->>'sample_kind' = 'test')
      or (p_input->>'from_team' = 'production' and p_input->>'to_team' = 'qa' and p_input->>'sample_kind' = 'retention')
      or (p_input->>'from_team' = 'qa' and p_input->>'to_team' = 'qc' and p_input->>'sample_kind' = 'retention'));
  if not coalesce(route_ok, false) then
    raise exception '보낼 수 있는 길이 아닙니다. 생산 담당자는 생산 → QC(시험 검체)·생산 → QA(보존 검체), QA 관리자는 QA → QC(보존 검체)로 보냅니다.';
  end if;
  if quantity_text !~ '^\d{1,4}$' or quantity_text::integer < 1 then
    raise exception '수량은 1부터 9999까지 숫자로 입력해 주세요.';
  end if;
  if coalesce(p_input->>'unit', '') not in ('바이알', 'mL', 'g', '개') then
    raise exception '단위는 바이알·mL·g·개 중에서 골라 주세요.';
  end if;
  if length(note_text) > 200 then
    raise exception '메모는 200자까지 입력해 주세요.';
  end if;
  if p_input->>'from_team' = 'qa' then
    -- 같은 로트의 QA 보관 수를 동시에 넘기지 않게 로트 줄을 잠근다
    perform 1 from public.batch where id = p_batch for update;
    held := private.qa_retained_quantity(p_batch);
    if quantity_text::integer > held then
      raise exception '보관 중인 보존 검체가 % %이라 그보다 많이 넘길 수 없습니다.', held, p_input->>'unit';
    end if;
  end if;

  insert into public.sample_transfer (batch_id, sample_kind, from_team, to_team, quantity, unit, note, sent_by)
  values (p_batch, (p_input->>'sample_kind')::public.sample_kind, (p_input->>'from_team')::public.sample_team,
          (p_input->>'to_team')::public.sample_team, quantity_text::integer, p_input->>'unit', note_text, me.id)
  returning * into saved;
  return saved;
end;
$$;

-- FR-002 인수 확인: 받는 팀만
create or replace function public.receive_sample(p_id uuid, p_location text)
returns public.sample_transfer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qc_analyst', 'qa_manager']::public.user_role[], '생산 담당자·QC 시험 담당자·QA 관리자');
  target public.sample_transfer := private.lock_sample(p_id);
  location_text text := btrim(coalesce(p_location, ''));
begin
  if private.team_of(me.role) is distinct from target.to_team then
    raise exception '받는 팀만 인수 확인할 수 있습니다.' using errcode = '42501';
  end if;
  if target.status <> 'pending' then
    raise exception '이미 인수 확인된 검체입니다. 목록을 새로 고쳐 주세요.';
  end if;
  if location_text = '' then
    raise exception '보관 위치를 입력해 주세요. 예: 보존검체실 냉장고 R-02 3단';
  end if;
  if length(location_text) > 60 then
    raise exception '보관 위치는 60자까지 입력해 주세요.';
  end if;
  update public.sample_transfer
     set status = 'held', received_by = me.id, received_at = clock_timestamp(), storage_location = location_text
   where id = p_id returning * into target;
  return target;
end;
$$;

-- FR-003 반납: 받은 팀이 남은 검체를 보낸 팀에 돌려준다
create or replace function public.return_sample(p_id uuid, p_quantity integer)
returns public.sample_transfer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qc_analyst', 'qa_manager']::public.user_role[], '생산 담당자·QC 시험 담당자·QA 관리자');
  target public.sample_transfer := private.lock_sample(p_id);
begin
  if private.team_of(me.role) is distinct from target.to_team then
    raise exception '검체를 받은 팀만 반납할 수 있습니다.' using errcode = '42501';
  end if;
  if target.status <> 'held' then
    raise exception '보관 중인 검체만 반납할 수 있습니다. 목록을 새로 고쳐 주세요.';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > target.quantity then
    raise exception '반납 수량은 1부터 받은 수량(%)까지 입력해 주세요.', target.quantity;
  end if;
  update public.sample_transfer
     set status = 'return_pending', returned_quantity = p_quantity, return_requested_by = me.id, return_requested_at = clock_timestamp()
   where id = p_id returning * into target;
  return target;
end;
$$;

-- FR-003 반납 확인: 보낸 팀이 실물을 받고 확인한다
create or replace function public.confirm_sample_return(p_id uuid)
returns public.sample_transfer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['production_operator', 'qc_analyst', 'qa_manager']::public.user_role[], '생산 담당자·QC 시험 담당자·QA 관리자');
  target public.sample_transfer := private.lock_sample(p_id);
begin
  if private.team_of(me.role) is distinct from target.from_team then
    raise exception '검체를 보낸 팀만 반납 확인할 수 있습니다.' using errcode = '42501';
  end if;
  if target.status <> 'return_pending' then
    raise exception '반납 대기인 검체만 반납 확인할 수 있습니다. 목록을 새로 고쳐 주세요.';
  end if;
  update public.sample_transfer
     set status = 'returned', return_confirmed_by = me.id, returned_at = clock_timestamp()
   where id = p_id returning * into target;
  return target;
end;
$$;

-- FR-004 소진: QC가 받은 검체를 시험에 다 썼을 때 (Q44)
create or replace function public.consume_sample(p_id uuid)
returns public.sample_transfer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qc_analyst', 'qa_manager']::public.user_role[], 'QC 시험 담당자');
  target public.sample_transfer := private.lock_sample(p_id);
begin
  if private.team_of(me.role) is distinct from 'qc' or target.to_team <> 'qc' then
    raise exception '검체 소진은 QC가 받은 검체에만 QC 시험 담당자가 할 수 있습니다.' using errcode = '42501';
  end if;
  if target.status <> 'held' then
    raise exception '보관 중인 검체만 소진 처리할 수 있습니다. 목록을 새로 고쳐 주세요.';
  end if;
  update public.sample_transfer
     set status = 'consumed', consumed_by = me.id, consumed_at = clock_timestamp()
   where id = p_id returning * into target;
  return target;
end;
$$;

revoke execute on function private.sample_route_text(jsonb), private.team_of(public.user_role),
  private.qa_retained_quantity(uuid), private.lock_sample(uuid) from public, anon, authenticated;
revoke execute on function public.send_sample(uuid, jsonb), public.receive_sample(uuid, text), public.return_sample(uuid, integer),
  public.confirm_sample_return(uuid), public.consume_sample(uuid) from public, anon;
grant execute on function public.send_sample(uuid, jsonb), public.receive_sample(uuid, text), public.return_sample(uuid, integer),
  public.confirm_sample_return(uuid), public.consume_sample(uuid) to authenticated;
