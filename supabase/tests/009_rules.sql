-- spec 009 데이터베이스 시험 (plan 009 §4). 001~008과 같은 방식: 끝에서 오류를 일으켜 모두 되돌린다.
-- 결과 문구가 "PF_TEST 통과 N/N"이면 통과. 알림 비교는 이 시험이 만든 사람의 알림만 본다(실제 자료에 알림이 쌓여 있어도 되게, 2026-10-27). 조치·평가는 업무 함수 대신 표에 바로 넣어 트리거만 본다(되돌림).
do $test$
declare
  qa uuid := gen_random_uuid();
  qa2 uuid := gen_random_uuid();
  qc uuid := gen_random_uuid();
  prod uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  product_id uuid;
  lot uuid;
  lot2 uuid;
  s_potency uuid;
  issue uuid;
  t uuid;
  req uuid;
  rv uuid;
  before_count int;
  off_count int;
  t_sample uuid;
  req_assigned uuid;
  claimed uuid[];
  n int;
  v text;
  ack_creator uuid;
  ack_at timestamptz;
  ack jsonb;
  history_before int;
  total int := 0;
  failures text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (qa, 'qa9@test.local', '{"full_name":"시험 QA9"}'),
    (qa2, 'qa9b@test.local', '{"full_name":"시험 QA9B"}'),
    (qc, 'qc9@test.local', '{"full_name":"시험 QC9"}'),
    (prod, 'prod9@test.local', '{"full_name":"시험 생산9"}'),
    (viewer, 'viewer9@test.local', '{"full_name":"시험 열람9"}');
  update public.profile set role = 'qa_manager' where id in (qa, qa2);
  update public.profile set role = 'qc_analyst' where id = qc;
  update public.profile set role = 'production_operator' where id = prod;
  -- 역할의 모든 사람에게 보내므로(FR-001) 실제 계정은 이 시험 안에서만 열람자로 둔다 (끝에서 되돌림)
  update public.profile set role = 'viewer' where id not in (qa, qa2, qc, prod, viewer);
  insert into public.product (item_name) values ('시험 백신 009 (교육용 가상)') returning id into product_id;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  s_potency := (public.save_specification(null, product_id, 'test', '역가', '%', 80, 125, 90, 115)).id;
  lot := (public.create_batch('Q9-001', product_id)).id;
  lot2 := (public.create_batch('Q9-002', product_id)).id;
  execute 'reset role';
  total := total + 1; -- 기준 등록·로트 등록은 알림 대상이 아니다
  if exists (select 1 from public.notification where created_by in (qa, qa2, qc, prod, viewer)) then
    failures := failures || '준비 단계에서 알림이 생김'::text;
  end if;

  ----------------------------------------------------------------------------
  -- FR-001 검체 전달 → 받는 팀(QA 2명), 본인(생산) 없음
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  t := (public.send_sample(lot, jsonb_build_object('from_team', 'production', 'to_team', 'qa', 'sample_kind', 'retention',
                                                  'quantity', 4, 'unit', '바이알'))).id;
  t_sample := t;
  perform public.send_sample(lot, jsonb_build_object('from_team', 'production', 'to_team', 'qc', 'sample_kind', 'test',
                                                    'quantity', 6, 'unit', '바이알'));
  execute 'reset role';
  total := total + 1;
  select string_agg(p.display_name || ':' || n.kind || ':' || n.link_path, ' ' order by p.display_name) into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.created_by = prod;
  if v is distinct from '시험 QA9:sample_sent:#/samples 시험 QA9B:sample_sent:#/samples 시험 QC9:sample_sent:#/samples' then
    failures := failures || ('검체 전달 받는 사람: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 내용: 할 일·로트·길·보낸 사람, 상태 대기, 로트번호
  select count(*) into n from public.notification
   where created_by = prod and status = 'pending' and batch_number = 'Q9-001'
     and message = '검체 인수 확인이 필요합니다 · Q9-001 · 생산 → QA, 보존 검체 4 바이알 · 보낸 사람 시험 생산9';
  if n <> 2 then failures := failures || format('검체 전달 내용 %s/2', n); end if;

  -- 검체 반납 → 보낸 팀(생산)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.receive_sample(t, '보존검체실 냉장고 R-02');
  perform public.return_sample(t, 2);
  execute 'reset role';
  total := total + 1; -- 인수 확인은 알림 없음, 반납은 생산 1명에게만
  select string_agg(p.display_name || ':' || n.kind || ':' || n.message, ' | ') into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.created_by = qa and n.kind = 'sample_returned';
  if v is distinct from '시험 생산9:sample_returned:검체 반납 확인이 필요합니다 · Q9-001 · 생산 → QA, 보존 검체 2 바이알 · 반납자 시험 QA9' then
    failures := failures || ('검체 반납: ' || coalesce(v, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- 측정값: 관리기준 이탈은 '품질 이슈 생김'(v0.5), 규격 이탈은 '규격 이탈'만 — 둘 다 QA 관리자에게
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- 같은 로트·항목은 한 번만 입력할 수 있어(Q10) 규격 이탈은 두 번째 로트에. 조치·평가는 이 관리기준 이탈 이슈로 본다
  issue := (public.record_test_measurement(lot, s_potency, 85)->>'quality_issue_id')::uuid;
  perform public.record_test_measurement(lot2, s_potency, 76);
  execute 'reset role';
  total := total + 1; -- v0.5: 관리기준 이탈로 이슈가 생기면 QA 관리자에게, 규격 이탈 로트에는 이슈 생김 알림이 따로 없다(중복 없음)
  select string_agg(p.display_name || ':' || n.link_path || ':' || n.message, ' | ' order by p.display_name) into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.created_by = qc and n.kind = 'issue_opened';
  if v is distinct from format('시험 QA9:#/issues/%s:품질 이슈 생김(관리기준 이탈) · Q9-001 · 시험 · 입력 시험 QC9 | '
                               || '시험 QA9B:#/issues/%s:품질 이슈 생김(관리기준 이탈) · Q9-001 · 시험 · 입력 시험 QC9', issue, issue) then
    failures := failures || ('관리기준 이탈 이슈: ' || coalesce(v, '없음'));
  end if;
  total := total + 1;
  select string_agg(p.display_name || ':' || n.kind || ':' || n.link_path || ':' || n.message, ' | ' order by p.display_name) into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.created_by = qc and n.kind = 'out_of_spec';
  if v is distinct from format('시험 QA9:out_of_spec:#/batches/%s:규격 이탈 · Q9-002 · 역가 76%% · 입력 시험 QC9 | '
                               || '시험 QA9B:out_of_spec:#/batches/%s:규격 이탈 · Q9-002 · 역가 76%% · 입력 시험 QC9', lot2, lot2) then
    failures := failures || ('규격 이탈: ' || coalesce(v, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- 조치 요청: 등록 → QA 관리자, 승인(배정) → 배정된 사람, 반려 → 요청자 (트리거만 보려고 표에 바로)
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by)
  values (issue, 'retest', '재시험', 'pending_approval', qc) returning id into req;
  total := total + 1;
  select count(*) into n from public.notification
   where created_by = qc and kind = 'approval_waiting' and link_path = '#/issues/' || issue
     and message = '승인 대기: 조치 요청 · Q9-001 · 재시험 · 요청자 시험 QC9';
  if n <> 2 then failures := failures || format('조치 승인 대기 %s/2', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  update public.action_request set status = 'approved', assignee_id = prod, reviewed_by = qa, reviewed_at = now() where id = req;
  req_assigned := req;
  total := total + 1;
  select string_agg(p.display_name || ':' || n.message, ' | ') into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.created_by = qa and n.kind = 'action_assigned';
  if v is distinct from '시험 생산9:조치가 배정되었습니다 · Q9-001 · 재시험 · 승인 시험 QA9' then
    failures := failures || ('조치 배정: ' || coalesce(v, '없음'));
  end if;

  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by)
  values (issue, 'equipment_check', '설비 점검', 'pending_approval', qc) returning id into req;
  update public.action_request set status = 'rejected', rejection_reason = '  재시험으로   충분 <@U123> ' || repeat('가', 120),
         reviewed_by = qa, reviewed_at = now() where id = req;
  total := total + 1; -- 반려 → 요청자. 사람 입력은 공백 정리·100자, 슬랙 기호는 글자로
  select n.message into v from public.notification n where n.created_by = qa and n.kind = 'returned_back' and n.recipient_id = qc;
  if v is distinct from '조치 요청이 반려되었습니다 · Q9-001 · 설비 점검 · 사유 재시험으로 충분 &lt;@U123&gt; ' || repeat('가', 83) || '…' then
    failures := failures || ('조치 반려: ' || coalesce(v, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- 품질 영향 평가: 검토 요청 → QA 관리자, 보완 요청 → 요청자, 다시 제출 → QA 관리자
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  insert into public.deviation_review (quality_issue_id, deviation_summary, probable_cause, impact_assessment, proposed_action, requested_by)
  values (issue, '역가 76%', '시료 보관', '규격 밖', '재시험', prod) returning id into rv;
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  update public.deviation_review set status = 'revision_requested', review_comment = '근거 보완', reviewed_by = qa, reviewed_at = now() where id = rv;
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  update public.deviation_review set status = 'submitted', reviewed_by = null, reviewed_at = null where id = rv;
  total := total + 1;
  select string_agg(x.line, ' | ' order by x.line) into v from (
    select p.display_name || ':' || n.kind || ':' || n.message || ' x' || count(*) as line
      from public.notification n join public.profile p on p.id = n.recipient_id
     where n.message like '%품질 영향 평가%' and n.created_by in (qa, qa2, qc, prod, viewer) group by p.display_name, n.kind, n.message) x;
  if v is distinct from '시험 QA9:approval_waiting:승인 대기: 품질 영향 평가 · Q9-001 · 요청자 시험 생산9 x2 | '
                     || '시험 QA9B:approval_waiting:승인 대기: 품질 영향 평가 · Q9-001 · 요청자 시험 생산9 x2 | '
                     || '시험 생산9:returned_back:품질 영향 평가 보완 요청 · Q9-001 · 사유 근거 보완 x1' then
    failures := failures || ('평가: ' || coalesce(v, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- FR-004: 되돌리기 중·로그인 없음이면 만들지 않는다
  total := total + 1;
  select count(*) into before_count from public.notification;
  perform set_config('pharmaflow.resetting', 'on', true);
  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by)
  values (issue, 'retest', '되돌리기 중', 'pending_approval', qc);
  perform set_config('pharmaflow.resetting', 'off', true);
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by)
  values (issue, 'retest', '로그인 없음', 'pending_approval', qc);
  if (select count(*) from public.notification) <> before_count then failures := failures || '되돌리기 중·로그인 없음에 알림이 생김'::text; end if;

  ----------------------------------------------------------------------------
  -- claim: 내가 만든 대기 알림만 "보내는 중"으로, 받는 사람 이메일과 함께. finish: 내가 claim한 것만
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  select string_agg(c.recipient_name || '<' || c.recipient_email || '>', ' ' order by c.recipient_name) into v
    from public.claim_my_notifications() c where c.body like '검체 인수 확인이%';
  if v is distinct from '시험 QA9<qa9@test.local> 시험 QA9B<qa9b@test.local> 시험 QC9<qc9@test.local>' then
    failures := failures || ('claim: ' || coalesce(v, '없음'));
  end if;
  total := total + 1; -- 다시 부르면 이미 가져간 것은 없다
  if exists (select 1 from public.claim_my_notifications()) then failures := failures || '두 번 claim됨'::text; end if;
  execute 'reset role';
  -- v0.4 Q51: 받는 사람도 자기에게 온 대기 알림을 가져간다(남이 만든 것 포함). 그때 이메일은 자기 것만
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select array_agg(c.notification_id) into claimed from public.claim_my_notifications() c;
  execute 'reset role';
  select count(*) filter (where created_by <> qa and recipient_id <> qa), count(*) filter (where created_by <> qa and recipient_id = qa)
    into before_count, off_count from public.notification where id = any (claimed);
  if before_count <> 0 or off_count = 0 then
    failures := failures || format('받는 사람 쪽 가져가기: 남의 것 %s, 나에게 온 것 %s', before_count, off_count);
  end if;
  -- 남이 만들어 내게 온 알림의 이메일은 내 것뿐
  if exists (select 1 from public.notification x join public.profile p on p.id = x.recipient_id
              where x.id = any (claimed) and x.created_by <> qa and p.id <> qa) then
    failures := failures || '남이 만든 알림에서 다른 사람 이메일이 나감'::text;
  end if;
  total := total + 1; -- 받는 사람이 가져간 알림(남이 만든 것)은 받는 사람이 결과를 적는다
  select x.id into t from public.notification x where x.id = any (claimed) and x.created_by <> qa limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.finish_notification(t, 'sent', null);
  exception when others then failures := failures || ('받는 사람 결과 적기: ' || sqlerrm); end;
  execute 'reset role';
  if (select status::text from public.notification where id = t) <> 'sent' then failures := failures || '받는 사람 결과가 안 적힘'::text; end if;
  select id into t from public.notification where created_by = prod and status = 'sending' and recipient_id <> qc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 남의 알림은 finish 못 함
  begin
    perform public.finish_notification(t, 'sent', null);
    failures := failures || '남의 알림을 끝냄'::text;
  exception when others then if sqlerrm not like '%이 알림을 마칠 수 없습니다%' then failures := failures || ('남의 finish 문구: ' || sqlerrm); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1; -- 내 알림은 끝냄: 보냄·시각, 보내지 못함·이유 200자
  perform public.finish_notification(t, 'sent', null);
  begin
    perform public.finish_notification(t, 'failed', 'x');
    failures := failures || '끝난 알림을 다시 끝냄'::text;
  exception when others then null; end;
  execute 'reset role';
  if (select status::text || ':' || (sent_at is not null)::text from public.notification where id = t) <> 'sent:true' then
    failures := failures || '보냄 기록이 맞지 않음'::text;
  end if;

  ----------------------------------------------------------------------------
  -- FR-005: 전체 기록은 QA 관리자만, FR-007(v0.3): 다른 사람은 자기에게 온 알림만 읽는다. 표에 직접 쓰기 막힘
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- v0.7 Q74: 받는 사람(자기 것)에 더해 자기가 일으킨 알림도 읽는다. 받지도 일으키지도 않은 알림은 0이어야 한다
  select count(*) filter (where recipient_id <> qc and created_by <> qc), count(*) filter (where recipient_id = qc) into n, before_count from public.notification;
  begin
    insert into public.notification (recipient_id, kind, link_path, message, created_by) values (qc, 'sample_sent', '#/samples', 'x', qc);
    n := n + 1000;
  exception when others then null; end;
  execute 'reset role';
  if n <> 0 or before_count <> (select count(*) from public.notification where recipient_id = qc) or before_count = 0 then
    failures := failures || format('QC 읽기: 남의 것 %s, 자기 것 %s', n, before_count);
  end if;
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into before_count from public.notification;
  execute 'reset role';
  if before_count <> (select count(*) from public.notification) then failures := failures || format('QA 관리자 전체 읽기 %s', before_count); end if;

  -- FR-007: 읽음 처리는 받는 사람 본인 것만. 번호를 주면 그것만, 안 주면 모두
  total := total + 1;
  select id into t from public.notification where recipient_id = qa limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', qc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.mark_notifications_read(array[t]); -- 남의 알림 번호
  before_count := public.mark_notifications_read(null);
  execute 'reset role';
  if n <> 0 or before_count <> (select count(*) from public.notification where recipient_id = qc)
     or exists (select 1 from public.notification where recipient_id = qc and read_at is null)
     or (select read_at from public.notification where id = t) is not null then
    failures := failures || format('읽음 처리: 남의 것 %s, 내 것 %s', n, before_count);
  end if;
  total := total + 1; -- 하나만 읽음, 이미 읽은 것은 다시 세지 않음
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.mark_notifications_read(array[t]);
  before_count := public.mark_notifications_read(array[t]);
  execute 'reset role';
  if n <> 1 or before_count <> 0 or (select count(*) from public.notification where recipient_id = qa and read_at is null) = 0 then
    failures := failures || format('하나 읽음: %s, 다시 %s', n, before_count);
  end if;

  ----------------------------------------------------------------------------
  -- v0.5: 보낼 일 8가지 더함 (표에 바로 바꿔 트리거만 본다)
  -- 검체 인수 확인 → 보낸 팀 (앞에서 QA가 생산 → QA 검체 t_sample을 인수 확인함)
  total := total + 1;
  select string_agg(p.display_name || ':' || n.message, ' | ') into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.kind = 'sample_received' and n.created_by in (qa, qa2, qc, prod, viewer);
  if v is distinct from '시험 생산9:검체 인수됨 · Q9-001 · 생산 → QA, 보존 검체 4 바이알 · 보관 위치 보존검체실 냉장고 R-02 · 인수자 시험 QA9' then
    failures := failures || ('검체 인수됨: ' || coalesce(v, '없음'));
  end if;
  -- 검체 반납 확인 → 받았던 팀 (생산이 반납 대기 건을 확인)
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  update public.sample_transfer set status = 'returned', return_confirmed_by = prod, returned_at = now() where id = t_sample;
  total := total + 1;
  select string_agg(p.display_name || ':' || n.message, ' | ' order by p.display_name) into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.kind = 'sample_return_confirmed' and n.created_by in (qa, qa2, qc, prod, viewer);
  if v is distinct from '시험 QA9:검체 반납 확인됨 · Q9-001 · 생산 → QA, 보존 검체 2 바이알 · 확인 시험 생산9 | '
                     || '시험 QA9B:검체 반납 확인됨 · Q9-001 · 생산 → QA, 보존 검체 2 바이알 · 확인 시험 생산9' then
    failures := failures || ('검체 반납 확인됨: ' || coalesce(v, '없음'));
  end if;
  -- 평가 승인 → 작성자
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  update public.deviation_review set status = 'approved', reviewed_by = qa, reviewed_at = now() where id = rv;
  total := total + 1;
  select string_agg(p.display_name || ':' || n.link_path || ':' || n.message, ' | ') into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.kind = 'review_approved' and n.created_by in (qa, qa2, qc, prod, viewer);
  if v is distinct from format('시험 생산9:#/issues/%s:품질 영향 평가 승인 · Q9-001 · 승인 시험 QA9', issue) then
    failures := failures || ('평가 승인: ' || coalesce(v, '없음'));
  end if;
  -- 조치 완료 → QA 관리자 (승인된 재시험 조치 req_assigned, 담당 생산)
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  update public.action_request set status = 'completed', result_note = '재시험 정상', completed_at = now() where id = req_assigned;
  total := total + 1;
  select count(*) into n from public.notification
   where kind = 'action_completed' and message = '조치 완료 · Q9-001 · 재시험 · 이슈 종결 검토가 필요합니다 · 입력 시험 생산9';
  if n <> 2 then failures := failures || format('조치 완료 %s/2', n); end if;
  -- 이슈 종결 → 평가 작성자·조치 담당자(같은 사람이면 한 번)
  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  update public.quality_issue set status = 'closed', closed_by = qa, closed_at = now() where id = issue;
  total := total + 1;
  select string_agg(p.display_name || ':' || n.message, ' | ') into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.kind = 'issue_closed' and n.created_by in (qa, qa2, qc, prod, viewer);
  if v is distinct from '시험 생산9:품질 이슈 종결 · Q9-001 · 종결 시험 QA9' then
    failures := failures || ('이슈 종결: ' || coalesce(v, '없음'));
  end if;
  -- 내부 출하 검토 결과 → 생산 담당자, 직접 보류(사유) → 생산·QC, 자동 보류(사유 없음)는 보류 알림 없음
  update public.batch set status = 'releasable' where id = lot;
  update public.batch set hold_reason = '  설비 점검 중  ' where id = lot2;
  total := total + 1;
  select string_agg(p.display_name || ':' || n.kind || ':' || n.message, ' | ' order by n.kind, p.display_name) into v
    from public.notification n join public.profile p on p.id = n.recipient_id where n.kind in ('release_decided', 'lot_held') and n.created_by in (qa, qa2, qc, prod, viewer);
  if v is distinct from '시험 QC9:lot_held:로트 보류 · Q9-002 · 사유 설비 점검 중 · 보류 시험 QA9 | 시험 생산9:lot_held:로트 보류 · Q9-002 · 사유 설비 점검 중 · 보류 시험 QA9 | '
                     || '시험 생산9:release_decided:내부 출하 검토 결과 · Q9-001 · 출하 가능 · 검토 시험 QA9' then
    failures := failures || ('출하 검토·보류: ' || coalesce(v, '없음'));
  end if;

  ----------------------------------------------------------------------------
  -- v0.6 FR-008: 슬랙 [확인]. 보낼 때 받은 슬랙 사용자를 적고, 그 사람이 누를 때만 확인 시각·읽은 시각을 적는다
  select id, created_by into t, ack_creator from public.notification
   where created_by in (qa, qa2, qc, prod, viewer) and recipient_id = qa2 order by created_at limit 1;
  update public.notification set status = 'sending', read_at = null where id = t;
  perform set_config('request.jwt.claims', json_build_object('sub', ack_creator, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  begin
    perform public.finish_notification(t, 'sent', null, 'U-QA9B');
  exception when others then failures := failures || ('슬랙 사용자 적기: ' || sqlerrm); end;
  total := total + 1; -- 로그인한 사람(authenticated)은 확인 기록 함수를 못 부른다
  begin
    perform public.acknowledge_notification(t, 'U-QA9B');
    failures := failures || '로그인한 사람이 확인 기록 함수를 부름'::text;
  exception when others then null; end;
  execute 'reset role';
  total := total + 1;
  if (select slack_user_id from public.notification where id = t) is distinct from 'U-QA9B' then
    failures := failures || '받은 슬랙 사용자가 안 적힘'::text;
  end if;
  select count(*) into history_before from public.work_history;
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
  ack := public.acknowledge_notification(t, 'U-OTHER');
  total := total + 1; -- 받는 사람이 아닌 슬랙 사용자
  if ack->>'status' is distinct from 'not_recipient' then failures := failures || ('다른 사람 확인: ' || ack::text); end if;
  ack := public.acknowledge_notification(gen_random_uuid(), 'U-QA9B');
  total := total + 1;
  if ack->>'status' is distinct from 'not_found' then failures := failures || ('없는 알림 확인: ' || ack::text); end if;
  ack := public.acknowledge_notification(t, 'U-QA9B');
  ack_at := (ack->>'acknowledged_at')::timestamptz;
  total := total + 1; -- 받는 사람이 누름: 확인 시각, 읽은 시각도 같은 시각으로
  if ack->>'status' is distinct from 'acknowledged' or ack_at is null then failures := failures || ('받는 사람 확인: ' || ack::text); end if;
  ack := public.acknowledge_notification(t, 'U-QA9B');
  total := total + 1; -- 다시 눌러도 처음 시각 그대로
  if (ack->>'acknowledged_at')::timestamptz is distinct from ack_at then failures := failures || '다시 누르면 시각이 바뀜'::text; end if;
  execute 'reset role';
  total := total + 1;
  if (select slack_acknowledged_at = ack_at and read_at = ack_at from public.notification where id = t) is not true then
    failures := failures || '확인 시각·읽은 시각이 맞지 않음'::text;
  end if;
  total := total + 1; -- 앱에서 먼저 읽은 알림은 읽은 시각을 그대로 둔다
  select id into t from public.notification where created_by in (qa, qa2, qc, prod, viewer) and recipient_id = qa2 and id <> t limit 1;
  update public.notification set slack_user_id = 'U-QA9B', read_at = '2026-01-01T00:00:00Z' where id = t;
  execute 'set local role service_role';
  perform public.acknowledge_notification(t, 'U-QA9B');
  execute 'reset role';
  if (select read_at = '2026-01-01T00:00:00Z' and slack_acknowledged_at is not null from public.notification where id = t) is not true then
    failures := failures || '먼저 읽은 시각이 바뀜'::text;
  end if;
  total := total + 1; -- 확인은 업무 이력을 남기지 않는다(업무 표를 건드리지 않음, FR-008 수용 기준 5)
  if (select count(*) from public.work_history) <> history_before then failures := failures || '확인이 업무 이력을 남김'::text; end if;

  ----------------------------------------------------------------------------
  -- v0.7 FR-009: 알림에 어느 기록에서 나왔는지 (검체·조치·평가·이탈), 일으킨 사람 읽기, 제3자 못 읽음
  execute 'reset role';
  total := total + 1;
  select string_agg(distinct n.kind || '>' || n.target_table, ' ' order by n.kind || '>' || n.target_table) into v
    from public.notification n where n.created_by in (qa, qa2, qc, prod, viewer)
     and n.kind in ('sample_sent', 'approval_waiting', 'action_assigned', 'out_of_spec', 'review_approved', 'lot_held', 'issue_opened');
  if v is distinct from 'action_assigned>action_request approval_waiting>action_request approval_waiting>deviation_review issue_opened>quality_issue '
                     || 'lot_held>batch out_of_spec>measurement review_approved>deviation_review sample_sent>sample_transfer' then
    failures := failures || ('알림 기록 표: ' || coalesce(v, '없음'));
  end if;
  total := total + 1;
  if exists (select 1 from public.notification n where n.created_by in (qa, qa2, qc, prod, viewer) and n.kind = 'sample_sent'
              and n.target_id is distinct from (select t2.id from public.sample_transfer t2 where t2.id = n.target_id and t2.batch_id in (lot, lot2)))
     or not exists (select 1 from public.notification where target_id = t_sample and kind = 'sample_sent') then
    failures := failures || '검체 알림의 기록 id가 그 검체가 아님'::text;
  end if;
  -- 껍데기 add_notification으로 만든 알림은 기록이 비어 있다 (예전 알림과 같음)
  perform set_config('request.jwt.claims', json_build_object('sub', prod, 'role', 'authenticated')::text, true);
  perform private.add_notification(array[qa], 'sample_sent', lot, '#/samples', '예전 방식 알림');
  total := total + 1;
  if (select count(*) from public.notification where message = '예전 방식 알림' and target_table is null and target_id is null) <> 1 then
    failures := failures || '껍데기 알림에 기록이 들어감'::text;
  end if;
  -- 일으킨 사람(생산)은 자기가 일으킨 알림을 읽는다. 받는 사람도 일으킨 사람도 아닌 열람자는 못 읽는다
  execute 'set local role authenticated';
  total := total + 1;
  select count(*) into n from public.notification where created_by = prod and recipient_id <> prod;
  if n = 0 then failures := failures || '일으킨 사람이 자기 알림을 못 읽음'::text; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  select count(*) into n from public.notification where created_by in (qa, qa2, qc, prod);
  if n <> 0 then failures := failures || ('열람자가 남의 알림 ' || n || '건을 읽음'); end if;
  execute 'reset role';

  if array_length(failures, 1) is null then
    raise exception 'PF_TEST 통과 %/% (모든 변경은 되돌림)', total, total;
  else
    raise exception 'PF_TEST 실패 %/%: %', array_length(failures, 1), total, array_to_string(failures, ' | ');
  end if;
end
$test$;
