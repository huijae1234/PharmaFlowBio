-- spec 009 v0.3 FR-007 (plan 009 4단계): 앱 안 알림 함. 슬랙과 같은 알림 줄을 받는 사람이 앱에서 읽는다.
-- 더하기만 한다: 읽은 시각 칸, 받는 사람 읽기 정책, 읽음 처리 함수.

alter table public.notification add column read_at timestamptz;
create index notification_recipient_unread on public.notification (recipient_id) where read_at is null;

-- FR-007 수용 기준 5: 받는 사람은 자기 알림만 읽는다 (QA 관리자는 지금처럼 전체 — 정책은 "또는"으로 합쳐진다)
create policy "받는 사람은 자기 알림 읽기" on public.notification for select to authenticated
  using (recipient_id = auth.uid());

-- FR-007 수용 기준 3·4: 읽음 처리. 번호를 주면 그것만, null이면 내 안 읽은 알림 모두. 내 것이 아니면 세지 않는다
create or replace function public.mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  update public.notification
     set read_at = clock_timestamp()
   where recipient_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
