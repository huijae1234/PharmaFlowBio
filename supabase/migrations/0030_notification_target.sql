-- spec 009 v0.7 FR-009 (plan 009 8단계): 알림에 "어느 기록에서 나온 알림인지"를 남겨, 슬랙 확인을 그 기록 줄 옆에 보인다.
-- 알림 글·받는 사람 규칙은 바꾸지 않는다. 트리거가 부르는 add_notification( 를 기록을 함께 넘기는 add_notification_for( 로 바꿀 뿐이다.

alter table public.notification add column target_table text check (length(target_table) <= 40);
alter table public.notification add column target_id uuid;
create index notification_target on public.notification (target_table, target_id);

-- Q74: 받는 사람·QA 관리자에 더해, 알림을 일으킨 사람도 자기 알림을 읽는다 (정책은 "또는"으로 합쳐진다)
create policy "알림을 일으킨 사람은 읽기" on public.notification for select to authenticated
  using (created_by = auth.uid());

-- 지금 add_notification 본문 그대로 + 기록 표 이름·id
create or replace function private.add_notification_for(p_target_table text, p_target_id uuid, p_recipients uuid[], p_kind text,
                                                        p_batch uuid, p_path text, p_message text)
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
  insert into public.notification (recipient_id, kind, batch_number, link_path, message, created_by, target_table, target_id)
  select distinct r, p_kind, (select b.batch_number from public.batch b where b.id = p_batch), p_path, left(p_message, 500), auth.uid(),
         p_target_table, p_target_id
    from unnest(p_recipients) r
   where r is not null and r <> auth.uid() and exists (select 1 from public.profile p where p.id = r);
end;
$$;

-- 이름은 그대로 두고 껍데기로 (같은 이름 함수가 두 개 생기지 않게 인자는 그대로)
create or replace function private.add_notification(p_recipients uuid[], p_kind text, p_batch uuid, p_path text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.add_notification_for(null, null, p_recipients, p_kind, p_batch, p_path, p_message);
end;
$$;

revoke execute on function private.add_notification_for(text, uuid, uuid[], text, uuid, text, text) from public, anon, authenticated;

-- 알림 트리거 7개: 지금 정의에서 add_notification( → add_notification_for(tg_table_name, new.id, . 바꾼 수가 지금 부르는 수와 다르면 멈춘다
do $notify$
declare
  item record;
  definition text;
  changed text;
  calls integer;
begin
  for item in select * from (values
    ('notify_sample', 4), ('notify_action', 4), ('notify_review', 3), ('notify_out_of_spec', 1),
    ('notify_issue', 2), ('notify_batch', 2), ('notify_work_order', 2)) as t(fn, expected)
  loop
    definition := pg_get_functiondef(format('private.%I()', item.fn)::regprocedure);
    if position('add_notification_for(' in definition) > 0 then
      continue; -- 이미 바꿈
    end if;
    changed := replace(definition, 'private.add_notification(', 'private.add_notification_for(tg_table_name, new.id, ');
    calls := (length(changed) - length(replace(changed, 'add_notification_for(', ''))) / length('add_notification_for(');
    if calls <> item.expected or position('private.add_notification(' in changed) > 0 then
      raise exception '% 알림 호출 수가 다릅니다: 기대 %, 바꾼 수 %', item.fn, item.expected, calls;
    end if;
    execute changed;
  end loop;
end
$notify$;
