-- 0039·0040 게스트 로그인 데이터베이스 시험 (포트폴리오 사본). Supabase SQL에서 postgres로 실행한다.
-- 맨 끝에서 결과를 담은 오류를 일부러 일으켜 모든 변경을 되돌린다. 자료가 남지 않는다.
-- 결과 읽는 법: 오류 문구가 "PF_TEST 통과 N/N"이면 통과, "PF_TEST 실패"면 실패 목록이 함께 나온다.
do $test$
declare
  qa uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  guest uuid := gen_random_uuid();
  old_guest uuid := gen_random_uuid();
  n int;
  v text;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa39@test.local', '{"full_name":"시험 QA"}'),
    (member, 'member39@test.local', '{"full_name":"시험 직원"}');
  insert into auth.users (id, is_anonymous, raw_user_meta_data, created_at) values
    (guest, true, '{}', now()),
    (old_guest, true, '{}', now() - interval '2 days');
  update public.profile set role = 'qa_manager' where id = qa;
  insert into public.usage_log (user_id, event_type, path, success) values (old_guest, 'page_view', '/batches', true);

  total := total + 1; -- 게스트는 이름 "게스트", 열람자로 생긴다
  select count(*) into n from public.profile where id = guest and display_name = '게스트' and role = 'viewer';
  if n <> 1 then failures := failures || '게스트 profile 이름·역할'; end if;

  -- QA 관리자로
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1; -- 사용자·역할 목록에 게스트는 없고 직원은 있다
  select count(*) into n from public.list_users() where id in (guest, old_guest);
  if n <> 0 then failures := failures || '목록에 게스트가 보임'; end if;
  select count(*) into n from public.list_users() where id = member;
  if n <> 1 then failures := failures || '목록에 직원이 안 보임'; end if;

  total := total + 1; -- 게스트에게는 역할을 줄 수 없다
  begin
    perform public.set_user_role(guest, 'production_operator');
    failures := failures || '게스트 역할 변경이 막히지 않음';
  exception when others then
    if sqlerrm <> '게스트에게는 역할을 줄 수 없습니다.' then failures := failures || ('게스트 역할 문구: ' || sqlerrm); end if;
  end;

  total := total + 1; -- 직원 역할 바꾸기는 그대로 된다
  perform public.set_user_role(member, 'qc_analyst');
  select role::text into v from public.profile where id = member;
  if v <> 'qc_analyst' then failures := failures || '직원 역할 변경 안 됨'; end if;

  total := total + 1; -- 게스트가 아닌 사람이 delete_guest를 불러도 아무도 지워지지 않는다
  perform public.delete_guest();
  execute 'reset role';
  select count(*) into n from auth.users where id = qa;
  if n <> 1 then failures := failures || '게스트 아닌 계정이 지워짐'; end if;

  total := total + 1; -- 게스트 본인이 부르면 계정과 profile이 지워진다
  perform set_config('request.jwt.claims', json_build_object('sub', guest, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.delete_guest();
  execute 'reset role';
  select count(*) into n from public.profile where id = guest;
  if n <> 0 then failures := failures || '게스트 삭제 안 됨'; end if;

  total := total + 1; -- 매일 정리: 하루 지난 게스트는 사용 기록과 함께 지우고, 직원은 남긴다
  perform private.purge_stale_guests();
  select count(*) into n from auth.users where id = old_guest;
  if n <> 0 then failures := failures || '하루 지난 게스트가 남음'; end if;
  select count(*) into n from public.usage_log where user_id = old_guest;
  if n <> 0 then failures := failures || '게스트 사용 기록이 남음'; end if;
  select count(*) into n from auth.users where id in (qa, member);
  if n <> 2 then failures := failures || '정리가 직원 계정을 지움'; end if;

  total := total + 1; -- 로그인한 사람은 정리 함수를 직접 부를 수 없다
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform private.purge_stale_guests();
    failures := failures || '정리 함수를 로그인한 사람이 부름';
  exception when others then null;
  end;
  execute 'reset role';

  ----------------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
