-- spec 009 v0.5 (plan 009 6단계): 보낼 일 8가지를 더한다. 업무 함수는 고치지 않고 트리거만 고치거나 더한다.
-- 관리기준 이탈 이슈, 평가 승인, 조치 완료, 이슈 종결, 내부 출하 검토 결과, 로트 직접 보류, 검체 인수 확인·반납 확인

alter table public.notification drop constraint notification_kind_check;
alter table public.notification add constraint notification_kind_check check (kind in (
  'sample_sent', 'sample_returned', 'approval_waiting', 'action_assigned', 'returned_back', 'out_of_spec',
  'issue_opened', 'review_approved', 'action_completed', 'issue_closed', 'release_decided', 'lot_held',
  'sample_received', 'sample_return_confirmed'));

-- 검체: 전달 → 받는 팀, 반납 → 보낸 팀, (v0.5) 인수 확인 → 보낸 팀, 반납 확인 → 받았던 팀
create or replace function private.notify_sample()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot text := (select b.batch_number from public.batch b where b.id = new.batch_id);
  route text := private.sample_route_text(to_jsonb(new));
begin
  if tg_op = 'INSERT' then
    perform private.add_notification(private.role_members(private.team_role(new.to_team)), 'sample_sent', new.batch_id, '#/samples',
      '검체 인수 확인이 필요합니다 · ' || lot || ' · ' || route || ' · 보낸 사람 ' || private.actor_name());
  elsif new.status = old.status then
    return null;
  elsif new.status = 'held' then
    perform private.add_notification(private.role_members(private.team_role(new.from_team)), 'sample_received', new.batch_id, '#/samples',
      '검체 인수됨 · ' || lot || ' · ' || route || ' · 보관 위치 ' || private.notify_text(new.storage_location) || ' · 인수자 ' || private.actor_name());
  elsif new.status = 'return_pending' then
    perform private.add_notification(private.role_members(private.team_role(new.from_team)), 'sample_returned', new.batch_id, '#/samples',
      '검체 반납 확인이 필요합니다 · ' || lot || ' · ' || route || ' · 반납자 ' || private.actor_name());
  elsif new.status = 'returned' then
    perform private.add_notification(private.role_members(private.team_role(new.to_team)), 'sample_return_confirmed', new.batch_id, '#/samples',
      '검체 반납 확인됨 · ' || lot || ' · ' || route || ' · 확인 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '검체 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- 조치: 등록·다시 제출 → QA 관리자, 승인 → 담당자, 반려 → 요청자, (v0.5) 완료 → QA 관리자
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
  elsif tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
    perform private.add_notification(private.role_members('qa_manager'), 'action_completed', lot_id, path,
      '조치 완료 · ' || lot || ' · ' || what || ' · 이슈 종결 검토가 필요합니다 · 입력 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '조치 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- 평가: 검토 요청·다시 제출 → QA 관리자, 반려·보완 요청 → 작성자, (v0.5) 승인 → 작성자
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
  elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status <> 'approved' then
    perform private.add_notification(array[new.requested_by], 'review_approved', lot_id, path,
      '품질 영향 평가 승인 · ' || lot || ' · 승인 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '평가 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- (v0.5) 품질 이슈: 관리기준 이탈로 생김 → QA 관리자 (규격 이탈은 측정값의 '규격 이탈' 알림만), 종결 → 평가 작성자·조치 담당자
create or replace function private.notify_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot text := (select b.batch_number from public.batch b where b.id = new.batch_id);
  path text := '#/issues/' || new.id;
begin
  if tg_op = 'INSERT' and new.kind = 'alert' then
    perform private.add_notification(private.role_members('qa_manager'), 'issue_opened', new.batch_id, path,
      '품질 이슈 생김(관리기준 이탈) · ' || lot || ' · ' || case when new.source = 'process' then '공정' else '시험' end
      || ' · 입력 ' || private.actor_name());
  elsif tg_op = 'UPDATE' and new.status = 'closed' and old.status <> 'closed' then
    perform private.add_notification(
      array(select d.requested_by from public.deviation_review d where d.quality_issue_id = new.id
            union select a.assignee_id from public.action_request a where a.quality_issue_id = new.id and a.assignee_id is not null),
      'issue_closed', new.batch_id, path, '품질 이슈 종결 · ' || lot || ' · 종결 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '품질 이슈 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

-- (v0.5) 로트: 내부 출하 검토 결과(출하 가능·폐기) → 생산 담당자, 직접 보류(사유가 새로 적힘) → 생산·QC
-- 규격 이탈 자동 보류는 사유가 없어 여기서 보내지 않는다 (측정값의 '규격 이탈' 알림이 감)
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
    perform private.add_notification(private.role_members('production_operator'), 'release_decided', new.id, path,
      '내부 출하 검토 결과 · ' || new.batch_number || ' · ' || case when new.status = 'releasable' then '출하 가능' else '폐기' end
      || ' · 검토 ' || private.actor_name());
  elsif new.status = 'on_hold' and new.hold_reason is not null and new.hold_reason is distinct from old.hold_reason then
    perform private.add_notification(private.role_members('production_operator') || private.role_members('qc_analyst'), 'lot_held', new.id, path,
      '로트 보류 · ' || new.batch_number || ' · 사유 ' || private.notify_text(new.hold_reason) || ' · 보류 ' || private.actor_name());
  end if;
  return null;
exception when others then
  raise warning '로트 알림을 만들지 못함: %', sqlerrm;
  return null;
end;
$$;

create trigger notify_issue after insert or update on public.quality_issue
  for each row execute function private.notify_issue();
create trigger notify_batch after update on public.batch
  for each row execute function private.notify_batch();
