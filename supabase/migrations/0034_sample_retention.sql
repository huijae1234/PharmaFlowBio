-- spec 018 2단계 (plan 018 §2): 보존 검체 보관 기한·기한 도래 알림·검체 폐기, 기한 지난 예시.
-- 0033에서 더한 검체 상태 'disposed'를 쓴다. 기존 길·상태·버튼 규칙과 자료는 바꾸지 않고 더하기만 한다.

-- ── 폐기 칸 (ERD sample_transfer v0.17) ──
alter table public.sample_transfer
  add column disposed_by uuid references public.profile (id),
  add column disposed_at timestamptz,
  add column disposed_quantity integer check (disposed_quantity >= 0 and disposed_quantity <= quantity),
  add column dispose_note text check (length(dispose_note) <= 200),
  -- FR-004: 폐기는 생산 → QA 보존 검체만, 폐기면 처리자·일시·수량이 모두 있다
  add constraint sample_disposed_fields check (
    (status = 'disposed') = (disposed_by is not null and disposed_at is not null and disposed_quantity is not null)
    and (status <> 'disposed' or (from_team = 'production' and to_team = 'qa')));

-- ── 알림 종류: 보관 기한 도래 (FR-003) ──
alter table public.notification drop constraint notification_kind_check;
alter table public.notification add constraint notification_kind_check check (kind in (
  'sample_sent', 'sample_returned', 'approval_waiting', 'action_assigned', 'returned_back', 'out_of_spec',
  'issue_opened', 'review_approved', 'action_completed', 'issue_closed', 'release_decided', 'lot_held',
  'sample_received', 'sample_return_confirmed', 'work_order_released', 'production_completed',
  'tests_completed', 'lot_shipped', 'retention_due'));

-- FR-002, Q80: 보관 기한 = 인수 확인한 한국 날짜 + 2년 (2월 29일은 2월 28일). 화면 sample-rules.js retentionDueDate와 같은 식
create or replace function private.retention_due(p_received timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select ((p_received at time zone 'Asia/Seoul')::date + interval '2 years')::date
$$;

-- Q82: 폐기한 기록은 폐기하지 않은 몫만 남는다 (화면 retainedQuantity와 같은 식)
create or replace function private.qa_retained_quantity(p_batch uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case
           when from_team = 'production' and to_team = 'qa' and status = 'held' then quantity
           when from_team = 'production' and to_team = 'qa' and status = 'disposed' then quantity - disposed_quantity
           when from_team = 'qa' and to_team = 'qc' then -quantity + case when status = 'returned' then returned_quantity else 0 end
           else 0 end), 0)::integer
    from public.sample_transfer where batch_id = p_batch
$$;

-- 이력·알림 문구 "생산 → QA, 보존 검체 3 바이알". 폐기 뒤에는 폐기 수량
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
                      when row_data->>'status' = 'disposed' then row_data->>'disposed_quantity'
                      else row_data->>'quantity' end)
      || ' ' || (row_data->>'unit')
$$;

-- FR-006: 업무 이력 이름 "검체 폐기 (생산 → QA, 보존 검체 N 바이알)". 지금 정의에서 한 줄만 더한다 (0030 방식)
do $history$
declare
  definition text := pg_get_functiondef('private.history_action(text, text, jsonb, jsonb)'::regprocedure);
  marker text := 'when new_row->>''status'' = ''consumed'' then ''검체 소진''';
  changed text;
begin
  if position('검체 폐기' in definition) > 0 then
    return;
  end if;
  changed := replace(definition, marker, marker || E'\n           when new_row->>''status'' = ''disposed'' then ''검체 폐기''');
  if changed = definition or (length(changed) - length(replace(changed, '검체 폐기', ''))) / length('검체 폐기') <> 1 then
    raise exception 'history_action에 검체 폐기 이름을 넣지 못했습니다';
  end if;
  execute changed;
end;
$history$;

-- FR-004: 보존 검체 폐기 (QA 관리자). 기한 지난 보관 중 생산 → QA 보존 검체만, QC에 넘긴 것이 다 돌아온 뒤에만
create or replace function public.dispose_sample(p_id uuid, p_disposed_at timestamptz, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  lot uuid := (select t.batch_id from public.sample_transfer t where t.id = p_id);
  target public.sample_transfer;
  due date;
  today date := (now() at time zone 'Asia/Seoul')::date;
  clean_note text := nullif(btrim(coalesce(p_note, '')), ''); -- 칸 이름 dispose_note와 겹치지 않게
  quantity_left integer;
begin
  if lot is null then
    raise exception '검체 기록을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  -- 로트를 먼저 잠근다 (send_sample과 같은 순서, 보관 수를 세는 동안 다른 처리가 끼지 않게)
  perform 1 from public.batch where id = lot for update;
  target := private.lock_sample(p_id);
  if target.from_team <> 'production' or target.to_team <> 'qa' then
    raise exception '보관 기한이 있는 보존 검체만 폐기할 수 있습니다.';
  end if;
  if target.status <> 'held' then
    raise exception '이미 처리된 검체입니다. 화면을 새로 고쳐 주세요.';
  end if;
  due := private.retention_due(target.received_at);
  if today < due then
    raise exception '보관 기한(%)이 지난 검체만 폐기할 수 있습니다.', to_char(due, 'YYYY-MM-DD');
  end if;
  if exists (select 1 from public.sample_transfer t
              where t.batch_id = lot and t.from_team = 'qa' and t.to_team = 'qc'
                and t.status in ('pending', 'held', 'return_pending')) then
    raise exception 'QC에 넘긴 보존 검체가 돌아오지 않았습니다. 반납 확인 뒤 폐기해 주세요.';
  end if;
  if p_disposed_at is null then
    raise exception '폐기 일시를 입력해 주세요.';
  end if;
  if p_disposed_at > now() + interval '1 minute' then
    raise exception '폐기 일시는 지금보다 뒤일 수 없습니다.';
  end if;
  if (p_disposed_at at time zone 'Asia/Seoul')::date < due then
    raise exception '폐기 일시는 보관 기한 뒤여야 합니다.';
  end if;
  if length(clean_note) > 200 then
    raise exception '메모는 200자까지 입력해 주세요.';
  end if;
  -- Q82: 기록 수량과 그 로트 QA 보관 수 중 작은 값
  quantity_left := least(target.quantity, private.qa_retained_quantity(lot));
  if quantity_left <= 0 then
    raise exception '보관 중인 보존 검체가 없습니다.';
  end if;
  update public.sample_transfer
     set status = 'disposed', disposed_by = me.id, disposed_at = p_disposed_at,
         disposed_quantity = quantity_left, dispose_note = clean_note
   where id = p_id;
  return jsonb_build_object('disposed_quantity', quantity_left);
end;
$$;

-- FR-003: 보관 기한이 된 보관 중 보존 검체마다 QA 관리자 전원에게 한 번. 앱이 열려 있는 동안 알림 함이 부른다(Q4 결정).
-- 일을 한 사람을 빼는 add_notification_for와 달리 부른 사람도 받는다(부른 사람이 한 일이 아니므로)
create or replace function public.notify_due_retention()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  made integer := 0;
  item record;
begin
  if current_setting('pharmaflow.resetting', true) = 'on' or auth.uid() is null
     or not exists (select 1 from public.profile p where p.id = auth.uid()) then
    return 0;
  end if;
  -- 두 사람이 동시에 열어도 같은 검체로 두 번 만들지 않는다
  perform pg_advisory_xact_lock(hashtext('pharmaflow.retention_due'));
  for item in
    select t.id, t.quantity, t.unit, b.batch_number, private.retention_due(t.received_at) as due
      from public.sample_transfer t join public.batch b on b.id = t.batch_id
     where t.from_team = 'production' and t.to_team = 'qa' and t.status = 'held'
       and private.retention_due(t.received_at) <= today
       and not exists (select 1 from public.notification n
                        where n.target_table = 'sample_transfer' and n.target_id = t.id and n.kind = 'retention_due')
  loop
    insert into public.notification (recipient_id, kind, batch_number, link_path, message, created_by, target_table, target_id)
    select p.id, 'retention_due', item.batch_number, '#/samples?status=held',
           '보관 기한 도래 · ' || item.batch_number || ' · 보존 검체 ' || item.quantity || ' ' || item.unit
             || ' (기한 ' || to_char(item.due, 'YYYY-MM-DD') || ')',
           auth.uid(), 'sample_transfer', item.id
      from public.profile p where p.role = 'qa_manager';
    made := made + 1;
  end loop;
  return made;
end;
$$;

-- ── FR-007, Q83: 기한 지난 예시. 2년 전 가상 로트 IFV-2410-001(출하 완료)과 보존 검체 4 바이알 ──
create or replace function private.seed_old_retention(p_qa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qa uuid := p_qa;
  qc uuid := coalesce((select id from public.profile where role = 'qc_analyst' order by created_at limit 1), p_qa);
  prod uuid := coalesce((select id from public.profile where role = 'production_operator' order by created_at limit 1), p_qa);
  lot uuid;
  t uuid;
begin
  lot := private.seed_lot('IFV-2410-001', '인플루엔자 4가 백신 프리필드주 (가상)', prod, timestamptz '2024-10-08 09:00+09');
  -- 공정 기록은 넣지 않는다 (공정 단계 기능 전 로트라 단계 기록과 맞출 수 없다, spec 011 예시 규칙)
  perform private.seed_value(lot, 'test', '역가', 104, qc, timestamptz '2024-10-16 10:00+09');
  perform private.seed_value(lot, 'test', '엔도톡신', 1.4, qc, timestamptz '2024-10-16 11:00+09');
  perform private.seed_value(lot, 'test', 'pH', 7.2, qc, timestamptz '2024-10-16 11:00+09');
  update public.batch set status = 'releasable' where id = lot;
  perform private.seed_history(qa, '내부 출하 검토', 'batch', lot, lot, timestamptz '2024-10-25 15:00+09');
  update public.batch set status = 'shipped', shipped_at = timestamptz '2024-11-01 10:00+09', shipped_by = prod,
                          ship_recorded_at = timestamptz '2024-11-01 10:05+09'
   where id = lot;
  perform private.seed_history(prod, '출하 완료', 'batch', lot, lot, timestamptz '2024-11-01 10:05+09');
  t := private.seed_transfer('IFV-2410-001', 'production', 'qa', 4, prod, timestamptz '2024-10-15 09:00+09');
  perform private.seed_transfer_step(t, 'held', qa, timestamptz '2024-10-15 14:00+09', '보존검체실 냉장고 R-03 1단');
end;
$$;

-- 되돌리기: 예시 검체 다음에 기한 지난 예시를 넣는다. 지금 정의에서 한 줄만 바꾼다
do $reset$
declare
  definition text := pg_get_functiondef('private.replace_sample_data(uuid)'::regprocedure);
  marker text := 'perform private.seed_sample_transfers(p_qa);';
  changed text;
begin
  if position('seed_old_retention' in definition) > 0 then
    return;
  end if;
  changed := replace(definition, marker, marker || E'\n  perform private.seed_old_retention(p_qa);');
  if changed = definition or (length(changed) - length(replace(changed, 'seed_old_retention', ''))) / length('seed_old_retention') <> 1 then
    raise exception 'replace_sample_data에 기한 지난 예시를 넣지 못했습니다';
  end if;
  execute changed;
end;
$reset$;

revoke execute on function private.retention_due(timestamptz), private.seed_old_retention(uuid) from public, anon, authenticated;
revoke execute on function public.dispose_sample(uuid, timestamptz, text), public.notify_due_retention() from public, anon;
grant execute on function public.dispose_sample(uuid, timestamptz, text), public.notify_due_retention() to authenticated;
