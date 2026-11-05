-- 0040 게스트는 사용자·역할 목록에서 빼고, 역할을 줄 수 없게 막는다 (포트폴리오 사본, 0039 이어서)
-- 게스트에게 쓰기 역할을 주면 업무 이력이 계정을 붙잡아 로그아웃·매일 정리로 지울 수 없게 된다

create or replace function public.list_users()
returns table (id uuid, display_name text, email text, role public.user_role, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  return query
    select p.id, p.display_name, p.email, p.role, p.created_at
      from public.profile p
      join auth.users u on u.id = p.id
     where not u.is_anonymous
     order by p.created_at desc;
end;
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
begin
  me := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if p_user_id = me.id then
    raise exception 'QA 관리자는 자기 역할을 바꿀 수 없습니다.';
  end if;
  if exists (select 1 from auth.users where id = p_user_id and is_anonymous) then
    raise exception '게스트에게는 역할을 줄 수 없습니다.';
  end if;
  update public.profile set role = p_role where id = p_user_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
end;
$$;
