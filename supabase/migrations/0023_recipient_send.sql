-- spec 009 v0.4 Q51 해결 (plan 009 5단계): 받는 사람 앱이 열려 있으면 그쪽에서도 대기 알림을 슬랙으로 보낸다.
-- 일으킨 사람 화면이 보내기를 부르지 못했을 때(예전 탭·바로 닫음) 받는 사람 쪽 1분 확인이 대신 보낸다.
-- 받는 사람으로 가져갈 때 나가는 이메일은 그 사람 자신의 것뿐이다.

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
     where (n.created_by = auth.uid() or n.recipient_id = auth.uid())
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

-- 결과는 가져간 쪽(일으킨 사람 또는 받는 사람)이 적는다
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
   where id = p_id and (created_by = auth.uid() or recipient_id = auth.uid()) and status = 'sending';
  if not found then
    raise exception '이 알림을 마칠 수 없습니다. 이미 끝났거나 다른 사람이 만든 알림입니다.';
  end if;
end;
$$;
