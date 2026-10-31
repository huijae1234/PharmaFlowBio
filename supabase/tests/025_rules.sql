-- spec 025 v0.5 8단계 데이터베이스 시험: my_briefing_items(). 끝에서 오류를 일으켜 모두 되돌린다. "PF_TEST 통과 N/N"이면 통과.
do $test$
declare
  qa uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  mine jsonb;
  total int := 0;
  failures text[] := '{}';
  blocked boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa25@test.local', '{"full_name":"시험 QA25"}'),
    (prod, 'prod25@test.local', '{"full_name":"시험 생산25"}'),
    (viewer, 'viewer25@test.local', '{"full_name":"시험 열람25"}');
  update public.profile set role = 'qa_manager' where id = qa;
  update public.profile set role = 'production_operator' where id = prod;

  -- 생산 담당자로 로그인: 자기 역할 절만 (아침 브리핑과 같은 항목)
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  mine := public.my_briefing_items();
  total := total + 1;
  if (select array_agg(s->>'key' order by o) from jsonb_array_elements(mine->'sections') with ordinality t(s, o)) <> array['process_issues','my_reviews','my_process_actions','my_turn','counts']
     or mine->>'role' <> 'production_operator' then failures := failures || '생산 절'; end if;

  -- 로그인한 사람은 관리자 키 전용 함수(남의 id를 넣는 함수)를 직접 부를 수 없다
  total := total + 1;
  blocked := false;
  begin
    perform public.morning_briefing_items(qa);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then failures := failures || '남의 항목을 읽음'; end if;
  execute 'reset role';

  -- QA로 로그인하면 QA 절
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  if (public.my_briefing_items())->>'role' <> 'qa_manager' then failures := failures || 'QA 절'; end if;
  execute 'reset role';

  -- 열람자는 null
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  if public.my_briefing_items() is not null then failures := failures || '열람자에게 항목'; end if;
  execute 'reset role';

  -- 실행 권한: authenticated만, anon은 못 함
  total := total + 1;
  if has_function_privilege('anon', 'public.my_briefing_items()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_briefing_items()', 'execute') then failures := failures || '실행 권한'; end if;

  raise exception 'PF_TEST 통과 %/% %', total - coalesce(array_length(failures, 1), 0), total, array_to_string(failures, ', ');
end
$test$;
