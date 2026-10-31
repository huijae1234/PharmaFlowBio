-- spec 009 v0.6 FR-008 (plan 009 7단계): 슬랙 [확인] 버튼. 받은 슬랙 사용자와 확인 시각 칸을 더하고,
-- 보내기 결과에 슬랙 사용자를 적게 하며, 확인 기록 함수 하나를 Vercel 함수(service_role)에만 연다.
-- 업무 표(검체·평가·조치·로트)는 건드리지 않는다. 확인은 "봤다"는 뜻뿐이다 (Q65).

alter table public.notification add column slack_user_id text check (length(slack_user_id) <= 40);
alter table public.notification add column slack_acknowledged_at timestamptz;

-- 같은 이름 함수가 두 개 생기지 않게 지우고 인자를 하나 더해 다시 만든다. 규칙은 0023 그대로
drop function public.finish_notification(uuid, public.notification_status, text);
create function public.finish_notification(p_id uuid, p_status public.notification_status, p_reason text,
                                           p_slack_user text default null)
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
         sent_at = case when p_status = 'failed' then null else clock_timestamp() end,
         -- 개인 메시지로 보낸 경우만: [확인]을 누른 사람이 받는 사람인지 맞춰 볼 때 쓴다
         slack_user_id = case when p_status = 'sent' then left(nullif(btrim(coalesce(p_slack_user, '')), ''), 40) end
   where id = p_id and (created_by = auth.uid() or recipient_id = auth.uid()) and status = 'sending';
  if not found then
    raise exception '이 알림을 마칠 수 없습니다. 이미 끝났거나 다른 사람이 만든 알림입니다.';
  end if;
end;
$$;
revoke execute on function public.finish_notification(uuid, public.notification_status, text, text) from public, anon;
grant execute on function public.finish_notification(uuid, public.notification_status, text, text) to authenticated;

-- FR-008: 받은 슬랙 사용자가 누를 때만 처음 한 번 확인 시각을 적고, 읽은 시각이 비어 있으면 같은 시각으로 채운다
create or replace function public.acknowledge_notification(p_id uuid, p_slack_user text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_found public.notification;
  at_time timestamptz := clock_timestamp();
begin
  select * into row_found from public.notification where id = p_id for update;
  if row_found.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if row_found.slack_user_id is null or row_found.slack_user_id is distinct from p_slack_user then
    return jsonb_build_object('status', 'not_recipient');
  end if;
  if row_found.slack_acknowledged_at is null then
    update public.notification
       set slack_acknowledged_at = at_time, read_at = coalesce(read_at, at_time)
     where id = p_id
    returning * into row_found;
  end if;
  return jsonb_build_object('status', 'acknowledged', 'acknowledged_at', row_found.slack_acknowledged_at);
end;
$$;
revoke execute on function public.acknowledge_notification(uuid, text) from public, anon, authenticated;
grant execute on function public.acknowledge_notification(uuid, text) to service_role;
