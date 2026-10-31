-- spec 007 데이터베이스 시험 (plan 007 §4). 001~005와 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 새 예시를 이 시험 안에서 다시 넣어 모양을 본다.
do $test$
declare
  qa uuid := gen_random_uuid();
  profiles_before int := (select count(*) from public.profile);
  usage_before int := (select count(*) from public.usage_log);
  permit_before int := (select count(*) from public.product where permit_item_code is not null);
  issue uuid;
  lot uuid;
  n int;
  v text;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values (qa, 'qa7@test.local', '{"full_name":"시험 QA7"}');
  update public.profile set role = 'qa_manager' where id = qa;
  profiles_before := profiles_before + 1;

  perform private.replace_sample_data(qa);

  total := total + 1; -- FR-004: 로트 8개와 상태 (spec 핵심 자료 표) + spec 018 FR-007 기한 지난 예시 로트
  select string_agg(batch_number || ':' || status, ' ' order by batch_number) into v from public.batch;
  if v is distinct from 'HBV-2610-001:on_hold HBV-2610-002:in_testing HBV-2610-003:discarded IFV-2410-001:shipped IFV-2610-001:in_production '
                     || 'IFV-2610-002:in_testing IFV-2610-003:in_testing IFV-2610-004:releasable TDP-2610-001:on_hold' then
    failures := failures || ('로트 상태: ' || coalesce(v, '없음'));
  end if;

  total := total + 1; -- 제품 3개 기준 수 5·6·4, 모두 관리기준·버전 1
  select string_agg(p.item_name || '=' || (select count(*) from public.specification s
                                            where s.product_id = p.id and s.alert_min_value is not null and s.version = 1), ' ' order by p.item_name)
    into v from public.product p where p.permit_item_code is null;
  if v is distinct from 'B형간염 백신 주 (가상)=6 Tdap 혼합 백신 주 (가상)=4 인플루엔자 4가 백신 프리필드주 (가상)=5' then
    failures := failures || ('제품 기준: ' || coalesce(v, '없음'));
  end if;

  total := total + 1; -- IFV-2610-002: 역가가 비어 있어 시연에서 넣을 수 있다
  select count(*) into n from public.measurement m join public.batch b on b.id = m.batch_id
    join public.specification s on s.id = m.specification_id
   where b.batch_number = 'IFV-2610-002' and s.item_name = '역가';
  if n <> 0 then failures := failures || 'IFV-2610-002에 역가가 있음'::text; end if;

  total := total + 1; -- 처리 중 이슈·평가·조치 상태 (로트별)
  select string_agg(b.batch_number || ':' || q.source || '/' || q.kind || '/' || q.status || '/' || coalesce(d.status::text, '-')
                    || '/' || coalesce((select string_agg(a.action_type || '=' || a.status || case when a.assignee_id is null then '' else '+배정' end, ',')
                                         from public.action_request a where a.quality_issue_id = q.id), '-'), ' ' order by b.batch_number)
    into v from public.quality_issue q join public.batch b on b.id = q.batch_id left join public.deviation_review d on d.quality_issue_id = q.id;
  if v is distinct from 'HBV-2610-001:test/spec/open/submitted/- HBV-2610-002:test/alert/open/approved/retest=approved+배정 '
                     || 'HBV-2610-003:test/spec/closed/approved/material_check=completed+배정 TDP-2610-001:process/spec/open/revision_requested/-' then
    failures := failures || ('이슈 상태: ' || coalesce(v, '없음'));
  end if;

  total := total + 1; -- 업무 규칙: 종결된 이슈는 종결 조건을, 처리 중인 규격 이탈 로트는 보류를, 시험 중 로트는 처리 중 규격 이탈 없음
  select count(*) into n from public.quality_issue q
   where (q.status = 'closed' and (not exists (select 1 from public.deviation_review d where d.quality_issue_id = q.id and d.status = 'approved')
                                   or (q.kind = 'spec' and not exists (select 1 from public.action_request a where a.quality_issue_id = q.id and a.status = 'completed'))
                                   or q.closed_by is null or q.closed_at is null))
      or (q.status = 'open' and q.kind = 'spec' and (select b.status from public.batch b where b.id = q.batch_id) <> 'on_hold');
  if n <> 0 then failures := failures || format('업무 규칙과 어긋난 이슈 %s건', n); end if;

  total := total + 1; -- 측정값 판정이 그때 기준과 맞고, 이탈 측정값은 이슈에 붙어 있다
  select count(*) into n from public.measurement m
   where m.result <> case when m.value not between m.applied_min_value and m.applied_max_value then 'out_of_spec'::public.measurement_result
                          when m.applied_alert_min_value is not null and m.value not between m.applied_alert_min_value and m.applied_alert_max_value
                            then 'out_of_alert'::public.measurement_result
                          else 'pass'::public.measurement_result end
      or (m.result <> 'pass' and m.quality_issue_id is null);
  if n <> 0 then failures := failures || format('판정이 맞지 않는 측정값 %s건', n); end if;

  total := total + 1; -- 이력: 로트마다 첫 줄이 로트 등록, 모두 지금보다 앞, 이슈마다 생성 이력
  select count(*) into n from public.batch b
   where (select h.action from public.work_history h where h.batch_id = b.id order by h.created_at, h.id limit 1) is distinct from '로트 등록'
      or exists (select 1 from public.work_history h where h.batch_id = b.id and h.created_at > now());
  select n + count(*) into n from public.quality_issue q
   where not exists (select 1 from public.work_history h where h.target_id = q.id and h.action = '품질 이슈 생성');
  if n <> 0 then failures := failures || format('이력이 맞지 않는 로트·이슈 %s', n); end if;

  total := total + 1; -- 사용자·사용 기록·허가정보 등록 제품은 그대로 (FR-004 수용 기준 4, Q42)
  if (select count(*) from public.profile) <> profiles_before or (select count(*) from public.usage_log) <> usage_before
     or (select count(*) from public.product where permit_item_code is not null) <> permit_before then
    failures := failures || '사용자·사용 기록·허가정보 제품이 바뀜'::text;
  end if;

  total := total + 1; -- FR-005: 새 업무 이력 이름 "품질 이슈 종결"
  if private.history_action('quality_issue', 'UPDATE', '{"status":"open"}', '{"status":"closed"}') <> '품질 이슈 종결' then
    failures := failures || '이력 이름이 품질 이슈 종결이 아님'::text;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1; -- FR-005: 종결할 수 없는 이유 문구 (평가가 승인 전)
  select q.id into issue from public.quality_issue q join public.batch b on b.id = q.batch_id where b.batch_number = 'HBV-2610-001';
  begin
    perform public.close_quality_issue(issue);
    failures := failures || '승인 전 평가로 종결됨'::text;
  exception when others then
    if sqlerrm not like '%종결할 수 없습니다%' then failures := failures || ('종결 문구: ' || sqlerrm); end if;
  end;

  total := total + 1; -- FR-005: 출하 막는 이유 문구 (처리 중인 관리기준 이탈 이슈)
  select id into lot from public.batch where batch_number = 'HBV-2610-002';
  begin
    perform public.decide_release(lot, 'releasable');
    failures := failures || '처리 중 이슈가 있는데 출하 가능'::text;
  exception when others then
    if sqlerrm not like '%처리 중인 품질 이슈가 1건%' then failures := failures || ('출하 문구: ' || sqlerrm); end if;
  end;

  total := total + 1; -- FR-003: 되돌리기(QA 관리자)는 같은 새 예시로
  perform public.reset_sample_data();
  execute 'reset role';
  select count(*) into n from public.batch where batch_number ~ '^(IFV|HBV|TDP)-2610-00[1-4]$';
  -- spec 018 FR-007: 기한 지난 예시 로트 IFV-2410-001이 더해져 모두 9개 (2610 예시 8개는 그대로)
  if n <> 8 or (select count(*) from public.batch) <> 9 then failures := failures || format('되돌린 뒤 로트 %s개', n); end if;

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
