-- 0039 게스트(익명) 로그인 (포트폴리오 사본 전용): 이름, 로그아웃 때 본인 삭제, 매일 정리
-- 게스트는 열람자(읽기 전용)로만 들어온다. 새 profile 기본 역할이 열람자라서 따로 권한을 주지 않는다.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profile (id, display_name, email)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      case when new.is_anonymous then '게스트' else '이름 없음' end),
    coalesce(new.email, ''));
  return new;
end;
$$;

-- 사용 기록이 profile을 막고 있어서(no action) 게스트가 남긴 기록을 먼저 지운다. 업무 이력은 열람자가 만들 수 없다
create or replace function private.remove_guest(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_id and is_anonymous) then
    return;
  end if;
  delete from public.usage_log where user_id = p_id;
  delete from auth.users where id = p_id;
end;
$$;
revoke all on function private.remove_guest(uuid) from public, anon, authenticated;

-- 화면의 로그아웃이 부른다. 익명 계정이 아니면 아무것도 지우지 않는다
create or replace function public.delete_guest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.remove_guest(auth.uid());
end;
$$;
revoke execute on function public.delete_guest() from public, anon;
grant execute on function public.delete_guest() to authenticated;

-- 로그아웃 없이 떠난 게스트를 하루가 지나면 지운다. 다른 표가 붙잡은 계정은 건너뛴다
create or replace function private.purge_stale_guests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  removed integer := 0;
begin
  for r in select id from auth.users where is_anonymous and created_at < now() - interval '1 day' loop
    begin
      perform private.remove_guest(r.id);
      removed := removed + 1;
    exception when foreign_key_violation then
      null;
    end;
  end loop;
  return removed;
end;
$$;
revoke all on function private.purge_stale_guests() from public, anon, authenticated;

-- 매일 한국 시각 03시 (UTC 18시)
create extension if not exists pg_cron;
select cron.schedule('purge-stale-guests', '0 18 * * *', 'select private.purge_stale_guests()');
