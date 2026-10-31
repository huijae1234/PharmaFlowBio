-- spec 009 1단계 (plan 009 §2, ADR 0003): 담당자 슬랙 알림. 데이터베이스는 알림을 "대기"로 만들기만 하고,
-- 보내기는 Vercel 함수(api/notify.js)가 한다. 업무 함수는 고치지 않고 트리거만 더한다.
-- 트리거는 받는 사람을 찾고 글을 만드는 일만 하며, 오류가 나도 업무 저장을 막지 않는다 (FR-004).

create type public.notification_status as enum ('pending', 'sending', 'sent', 'sent_channel', 'failed');

create table public.notification (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profile (id),
  kind text not null check (kind in ('sample_sent', 'sample_returned', 'approval_waiting', 'action_assigned', 'returned_back', 'out_of_spec')),
  -- 로트는 번호 글자로만 남긴다 (예시 자료 되돌리기 때 로트가 지워져도 기록은 남게)
  batch_number text,
  link_path text not null check (link_path ~ '^#/'),
  message text not null check (length(message) between 1 and 500),
  created_by uuid not null references public.profile (id),
  created_at timestamptz not null default clock_timestamp(),
  status public.notification_status not null default 'pending',
  reason text check (length(reason) <= 200),
  sent_at timestamptz
);
create index notification_created_by_status on public.notification (created_by, status);

-- FR-005: 읽기는 QA 관리자만, 쓰기는 트리거와 아래 함수로만
alter table public.notification enable row level security;
create policy "QA 관리자는 읽기" on public.notification for select to authenticated
  using (exists (select 1 from public.profile p where p.id = auth.uid() and p.role = 'qa_manager'));
grant select on public.notification to authenticated;

-- 사람 입력 글: 공백 정리, 100자까지, 슬랙 서식 기호(& < >)는 글자 그대로 보이게 (spec 경계 상황)
create or replace function private.notify_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(
           case when length(t) > 100 then left(t, 100) || '…' else t end,
           '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
    from (select btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')) as t) s
$$;

-- 역할의 모든 사람 (같은 역할이 여러 명이면 모두, FR-001)
create or replace function private.role_members(p_role public.user_role)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}') from public.profile p where p.role = p_role
$$;

create or replace function private.team_role(p_team public.sample_team)
returns public.user_role
language sql
immutable
set search_path = ''
as $$
  select case p_team when 'production' then 'production_operator'::public.user_role
                     when 'qc' then 'qc_analyst'::public.user_role
                     else 'qa_manager'::public.user_role end
$$;

create or replace function private.actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.display_name from public.profile p where p.id = auth.uid()), '')
$$;

-- 알림 만들기: 본인 빼기, 받는 사람 없으면 안 만듦, 되돌리기 중·로그인 없음이면 안 만듦 (FR-001, FR-004)
create or replace function private.add_notification(p_recipients uuid[], p_kind text, p_batch uuid, p_path text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('pharmaflow.resetting', true) = 'on' or auth.uid() is null
     or not exists (select 1 from public.profile p where p.id = auth.uid()) then
    return;
  end if;
  insert into public.notification (recipient_id, kind, batch_number, link_path, message, created_by)
  select distinct r, p_kind, (select b.batch_number from public.batch b where b.id = p_batch), p_path, left(p_message, 500), auth.uid()
    from unnest(p_recipients) r
   where r is not null and r <> auth.uid() and exists (select 1 from public.profile p where p.id = r);
end;
$$;

create or replace function private.action_type_label(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type when 'retest' then '재시험' when 'equipment_check' then '설비 점검'
                     when 'material_check' then '원료 확인' when 'batch_discard' then '로트 폐기' else p_type end
$$;

-- 검체 전달 → 받는 팀, 반납 → 보낸 팀
create or replace function private.notify_sample()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot text := (select b.batch_number from public.batch b where b.id = new.batch_id);
begin
  if tg_op = 'INSERT' then
    perform private.add_notification(private.role_members(private.team_role(new.to_team)), 'sample_sent', new.batch_id, '#/samples',
      '검체 인수 확인이 필요합니다 · ' || lot || ' · ' || private.sample_route_text(to_jsonb(new)) || ' · 보낸 사람 ' || private.actor_name());
  elsif new.status = 'return_pending' and old.status <> 'return_pending' then
    perform private.add_notification(private.role_members(private.team_role(new.from_team)), 'sample_returned', new.batch_id, '#/samples',
      '검체 반납 확인이 필요합니다 · ' || lot || ' · ' || private.sample_route_text(to_jsonb(new)) || ' · 반납자 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '검체 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- 조치 요청: 등록·다시 제출 → QA 관리자, 승인(배정) → 담당자, 반려 → 요청자
create or replace function private.notify_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot_id uuid := (select q.batch_id from public.quality_issue q where q.id = new.quality_issue_id);
  lot text := (select b.batch_number from public.batch b where b.id = lot_id);
  what text := private.action_type_label(new.action_type::text);
  path text := '#/issues/' || new.quality_issue_id;
begin
  if new.status = 'pending_approval' and (tg_op = 'INSERT' or old.status <> 'pending_approval') then
    perform private.add_notification(private.role_members('qa_manager'), 'approval_waiting', lot_id, path,
      '승인 대기: 조치 요청 · ' || lot || ' · ' || what || ' · 요청자 ' || private.actor_name());
  elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status <> 'approved' then
    perform private.add_notification(array[new.assignee_id], 'action_assigned', lot_id, path,
      '조치가 배정되었습니다 · ' || lot || ' · ' || what || ' · 승인 ' || private.actor_name());
  elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.status <> 'rejected' then
    perform private.add_notification(array[new.requested_by], 'returned_back', lot_id, path,
      '조치 요청이 반려되었습니다 · ' || lot || ' · ' || what || ' · 사유 ' || private.notify_text(new.rejection_reason));
  end if;
  return null;
exception when others then
  raise warning '조치 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- 품질 영향 평가: 검토 요청·다시 제출 → QA 관리자, 반려·보완 요청 → 요청자
create or replace function private.notify_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot_id uuid := (select q.batch_id from public.quality_issue q where q.id = new.quality_issue_id);
  lot text := (select b.batch_number from public.batch b where b.id = lot_id);
  path text := '#/issues/' || new.quality_issue_id;
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then
    perform private.add_notification(private.role_members('qa_manager'), 'approval_waiting', lot_id, path,
      '승인 대기: 품질 영향 평가 · ' || lot || ' · 요청자 ' || private.actor_name());
  elsif tg_op = 'UPDATE' and new.status in ('rejected', 'revision_requested') and old.status is distinct from new.status then
    perform private.add_notification(array[new.requested_by], 'returned_back', lot_id, path,
      '품질 영향 평가 ' || case when new.status = 'rejected' then '반려' else '보완 요청' end || ' · ' || lot
      || ' · 사유 ' || private.notify_text(new.review_comment));
  end if;
  return null;
exception when others then
  raise warning '평가 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- 규격 이탈 판정 → QA 관리자 (관리기준 이탈은 알림 없음, spec FR-001 수용 기준 3)
create or replace function private.notify_out_of_spec()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  spec public.specification;
begin
  if new.result <> 'out_of_spec' then
    return null;
  end if;
  select s.* into spec from public.specification s where s.id = new.specification_id;
  perform private.add_notification(private.role_members('qa_manager'), 'out_of_spec', new.batch_id, '#/batches/' || new.batch_id,
    '규격 이탈 · ' || (select b.batch_number from public.batch b where b.id = new.batch_id) || ' · ' || spec.item_name || ' '
    || trim(to_char(new.value, 'FM999999990.######'), '.') || coalesce(spec.unit, '') || ' · 입력 ' || private.actor_name());
  return null;
exception when others then
  raise warning '규격 이탈 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

create trigger notify_sample after insert or update on public.sample_transfer
  for each row execute function private.notify_sample();
create trigger notify_action after insert or update on public.action_request
  for each row execute function private.notify_action();
create trigger notify_review after insert or update on public.deviation_review
  for each row execute function private.notify_review();
create trigger notify_out_of_spec after insert on public.measurement
  for each row execute function private.notify_out_of_spec();

-- FR-002~004: 내가 일으킨 대기 알림을 "보내는 중"으로 바꾸며 가져간다 (한 번에 20건, 10분 넘게 멈춘 것도 다시)
-- 받는 사람 이메일은 내가 일으킨 알림의 받는 사람 것만 나간다 (plan 009 §5 보안)
create or replace function public.claim_my_notifications()
returns table (notification_id uuid, recipient_name text, recipient_email text, body text, path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  return query
  with picked as (
    select n.id from public.notification n
     where n.created_by = auth.uid()
       and (n.status = 'pending' or (n.status = 'sending' and n.created_at < now() - interval '10 minutes'))
     order by n.created_at
     limit 20
     for update skip locked
  )
  update public.notification n set status = 'sending'
    from picked
   where n.id = picked.id
  returning n.id,
            (select p.display_name from public.profile p where p.id = n.recipient_id),
            (select coalesce(p.email, u.email::text) from public.profile p left join auth.users u on u.id = p.id where p.id = n.recipient_id),
            n.message,
            n.link_path;
end;
$$;

-- 보낸 결과: 내가 가져간("보내는 중") 알림만
create or replace function public.finish_notification(p_id uuid, p_status public.notification_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'sent_channel', 'failed') then
    raise exception '알림 결과는 보냄·채널로 보냄·보내지 못함 중 하나여야 합니다.';
  end if;
  update public.notification
     set status = p_status,
         reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 200),
         sent_at = case when p_status = 'failed' then null else clock_timestamp() end
   where id = p_id and created_by = auth.uid() and status = 'sending';
  if not found then
    raise exception '이 알림을 마칠 수 없습니다. 이미 끝났거나 다른 사람이 만든 알림입니다.';
  end if;
end;
$$;

revoke execute on function private.notify_text(text), private.role_members(public.user_role), private.team_role(public.sample_team),
  private.actor_name(), private.add_notification(uuid[], text, uuid, text, text), private.action_type_label(text)
  from public, anon, authenticated;
revoke execute on function public.claim_my_notifications(), public.finish_notification(uuid, public.notification_status, text) from public, anon;
grant execute on function public.claim_my_notifications(), public.finish_notification(uuid, public.notification_status, text) to authenticated;
