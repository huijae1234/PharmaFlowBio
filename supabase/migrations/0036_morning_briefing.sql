-- spec 026 아침 브리핑 (plan 026 2단계). 평일 오전 8시 서버(Vercel Cron)가 Supabase 관리자 키로 부르는 함수들.
-- 관리자 키는 RLS를 건너뛰므로, 서버는 표를 직접 읽지 않고 이 함수들만 부른다. 범위 거르기(역할·"내 것")는 여기서 한다.
--
-- 바뀌는 것
--  1. 알림 종류에 'morning_briefing' 추가 (기존 값은 그대로)
--  2. public.morning_briefing_recipients(): 직원 역할(QA·QC·생산)의 id·이름·이메일·역할. 이메일은 슬랙 계정 찾기에만 쓴다
--  3. public.morning_briefing_items(p_user): 그 사람 역할의 절만 계산해 돌려준다 (개수·앞 3건·앱 안 경로). 읽기만 한다(stable)
--  4. public.morning_briefing_already_sent(p_user, p_day) / public.record_morning_briefing(p_user, p_day, p_status):
--     같은 한국 날짜에 한 번만 알림 한 줄. 상태는 sent·failed로 넣어 spec 009 슬랙 대기 알림으로 다시 보내지지 않게 한다
--  5. 위 함수는 모두 service_role만 실행 (anon·authenticated 회수)
--
-- 적용 방법: Supabase SQL Editor에서 이 파일 전체를 실행 (공유 데이터베이스: 적용 전 사람이 확인)
-- 되돌리기: 맨 아래 블록

alter table public.notification drop constraint notification_kind_check;
alter table public.notification add constraint notification_kind_check check (kind = any (array[
  'sample_sent', 'sample_returned', 'approval_waiting', 'action_assigned', 'returned_back', 'out_of_spec', 'issue_opened',
  'review_approved', 'action_completed', 'issue_closed', 'release_decided', 'lot_held', 'sample_received',
  'sample_return_confirmed', 'work_order_released', 'production_completed', 'tests_completed', 'lot_shipped', 'retention_due',
  'morning_briefing'
]));

-- 목록 절 하나: 정렬된 줄 배열에서 개수와 앞 3건
create or replace function private.briefing_list(p_key text, p_rows jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', p_key, 'state', 'ok', 'count', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
    'top', coalesce((select jsonb_agg(r order by o) from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality t(r, o) where o <= 3), '[]'::jsonb));
$$;

-- 시험·서버가 절의 개수를 읽는 도우미
create or replace function private.briefing_count(p_items jsonb, p_key text)
returns int language sql immutable set search_path = '' as $$
  select coalesce((select (s->>'count')::int from jsonb_array_elements(p_items->'sections') s where s->>'key' = p_key), 0);
$$;

create or replace function private.briefing_days(p_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select (((now() at time zone 'Asia/Seoul')::date - (p_at at time zone 'Asia/Seoul')::date) + 1)::text || '일째';
$$;

create or replace function public.morning_briefing_recipients()
returns table (id uuid, display_name text, email text, role public.user_role)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.email, p.role from public.profile p
   where p.role in ('qa_manager', 'qc_analyst', 'production_operator') order by p.role, p.created_at;
$$;

create or replace function public.morning_briefing_items(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profile;
  today date := (now() at time zone 'Asia/Seoul')::date;
  prev date; -- 지난 평일 (월요일이면 금요일)
  src public.issue_source;
  sections jsonb := '[]'::jsonb;
  action_names constant jsonb := '{"retest":"재시험","equipment_check":"설비 점검","material_check":"원료 확인","batch_discard":"로트 폐기"}';
begin
  select * into me from public.profile where profile.id = p_user;
  if me.id is null or me.role not in ('qa_manager', 'qc_analyst', 'production_operator') then return null; end if;
  prev := today - case extract(isodow from today) when 1 then 3 when 7 then 2 else 1 end;
  src := case me.role when 'qc_analyst' then 'test'::public.issue_source when 'production_operator' then 'process'::public.issue_source end;

  if me.role = 'qa_manager' then
    -- ① 평가서 검토나 조치 승인을 기다리는 이슈
    sections := sections || private.briefing_list('qa_waiting_issues', (
      select jsonb_agg(jsonb_build_object('text', b.batch_number || ' · ' || private.briefing_days(qi.opened_at), 'path', '#/issues/' || qi.id) order by qi.opened_at)
        from public.quality_issue qi join public.batch b on b.id = qi.batch_id
       where qi.status = 'open'
         and (exists (select 1 from public.deviation_review r where r.quality_issue_id = qi.id and r.status = 'submitted')
              or exists (select 1 from public.action_request a where a.quality_issue_id = qi.id and a.status = 'pending_approval'))));
    -- ② 검토할 제출된 평가서
    sections := sections || private.briefing_list('qa_submitted_reviews', (
      select jsonb_agg(jsonb_build_object('text', b.batch_number || ' · 평가서 ' || private.briefing_days(r.requested_at), 'path', '#/issues/' || qi.id) order by r.requested_at)
        from public.deviation_review r join public.quality_issue qi on qi.id = r.quality_issue_id join public.batch b on b.id = qi.batch_id
       where r.status = 'submitted'));
    -- ③ 어제(지난 평일) 완료된 조치 전체
    sections := sections || private.briefing_list('qa_done_actions', (
      select jsonb_agg(jsonb_build_object('text', b.batch_number || ' · ' || coalesce(action_names->>a.action_type::text, a.action_type::text), 'path', '#/issues/' || qi.id) order by a.completed_at)
        from public.action_request a join public.quality_issue qi on qi.id = a.quality_issue_id join public.batch b on b.id = qi.batch_id
       where a.status = 'completed' and (a.completed_at at time zone 'Asia/Seoul')::date >= prev and (a.completed_at at time zone 'Asia/Seoul')::date < today));
    -- ⑤ 작업 일정: 종료일 지남·시작일 지남·보류 로트·열린 이슈 (예측·배정 없음, spec 024 ⑤)
    sections := sections || private.briefing_list('qa_schedule', (
      select jsonb_agg(jsonb_build_object('text', w.order_number || ' · ' || concat_ws(', ',
                 case when w.planned_end < today then '종료일 지남' end,
                 case when w.status in ('draft', 'released') and w.planned_start < today then '시작일 지남' end,
                 case when b.status = 'on_hold' then '로트 보류' end,
                 case when exists (select 1 from public.quality_issue qi where qi.batch_id = w.batch_id and qi.status = 'open') then '열린 이슈' end),
               'path', '#/work-orders') order by w.planned_end)
        from public.work_order w left join public.batch b on b.id = w.batch_id
       where w.status in ('draft', 'released', 'in_progress')
         and (w.planned_end < today or (w.status in ('draft', 'released') and w.planned_start < today) or b.status = 'on_hold'
              or exists (select 1 from public.quality_issue qi where qi.batch_id = w.batch_id and qi.status = 'open'))));
  else
    -- ① 처리 중인 시험(QC)·공정(생산) 이슈
    sections := sections || private.briefing_list(case when src = 'test' then 'test_issues' else 'process_issues' end, (
      select jsonb_agg(jsonb_build_object('text', b.batch_number || ' · ' || private.briefing_days(qi.opened_at), 'path', '#/issues/' || qi.id) order by qi.opened_at)
        from public.quality_issue qi join public.batch b on b.id = qi.batch_id
       where qi.status = 'open' and qi.source = src));
    -- ② 내가 작성·수정할 평가서: 평가서가 아직 없는 내 직무 이슈 + 나에게 되돌아온 평가서(보완 요청·반려)
    sections := sections || private.briefing_list('my_reviews', (
      select jsonb_agg(x.item order by x.sort_at) from (
        select jsonb_build_object('text', b.batch_number || ' · 평가서 작성', 'path', '#/issues/' || qi.id) item, qi.opened_at as sort_at
          from public.quality_issue qi join public.batch b on b.id = qi.batch_id
         where qi.status = 'open' and qi.source = src and b.status not in ('releasable', 'discarded', 'shipped')
           and not exists (select 1 from public.deviation_review r where r.quality_issue_id = qi.id)
        union all
        select jsonb_build_object('text', b.batch_number || ' · ' || case r.status when 'revision_requested' then '보완 요청' else '반려' end, 'path', '#/issues/' || qi.id), coalesce(r.reviewed_at, r.requested_at) as sort_at
          from public.deviation_review r join public.quality_issue qi on qi.id = r.quality_issue_id join public.batch b on b.id = qi.batch_id
         where r.requested_by = me.id and r.status in ('revision_requested', 'rejected') and qi.status = 'open') x));
    -- ③ 내가 담당한 시험·공정 이슈의 조치 (승인됐고 아직 안 끝남)
    sections := sections || private.briefing_list(case when src = 'test' then 'my_test_actions' else 'my_process_actions' end, (
      select jsonb_agg(jsonb_build_object('text', b.batch_number || ' · ' || coalesce(action_names->>a.action_type::text, a.action_type::text), 'path', '#/issues/' || qi.id) order by a.reviewed_at)
        from public.action_request a join public.quality_issue qi on qi.id = a.quality_issue_id join public.batch b on b.id = qi.batch_id
       where a.assignee_id = me.id and a.status = 'approved' and qi.source = src));
    -- ⑤ 생산만: 내 차례 작업 (착수할 발행된 작업지시 + 진행 중 단계)
    if me.role = 'production_operator' then
      sections := sections || private.briefing_list('my_turn', (
        select jsonb_agg(x.item order by x.sort_at) from (
          select jsonb_build_object('text', w.order_number || ' · 착수 대기', 'path', '#/work-orders') item, w.planned_start::timestamptz as sort_at
            from public.work_order w where w.status = 'released'
          union all
          select jsonb_build_object('text', b.batch_number || ' · ' || s.step_label || ' 진행 중', 'path', '#/batches/' || b.id), s.started_at as sort_at
            from public.step_run s join public.batch b on b.id = s.batch_id where s.status = 'in_progress') x));
    end if;
  end if;

  -- ⑥ 개수 한 줄 (업무 찾아보기 기능이 아니라 코드가 세는 개수)
  sections := sections || jsonb_build_object('key', 'counts', 'state', 'ok', 'count', 0, 'top', '[]'::jsonb, 'parts', (
    select jsonb_agg(p order by o) from (
      select 1 o, jsonb_build_object('key', 'held_lots', 'count', (select count(*) from public.batch where status = 'on_hold')) p
      union all select 2, jsonb_build_object('key', 'pending_reviews', 'count', (select count(*) from public.deviation_review where status = 'submitted')) where me.role = 'qa_manager'
      union all select 3, jsonb_build_object('key', 'my_actions', 'count', (select count(*) from public.action_request where assignee_id = me.id and status = 'approved'))
      union all select 4, jsonb_build_object('key', 'overdue_orders', 'count', (select count(*) from public.work_order where status in ('draft', 'released', 'in_progress') and planned_end < today))
        where me.role in ('qa_manager', 'production_operator')) t));

  return jsonb_build_object('role', me.role, 'day', today, 'sections', sections);
end;
$$;

create or replace function public.morning_briefing_already_sent(p_user uuid, p_day date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.notification n where n.recipient_id = p_user and n.kind = 'morning_briefing'
                  and (n.created_at at time zone 'Asia/Seoul')::date = p_day);
$$;

create or replace function public.record_morning_briefing(p_user uuid, p_day date, p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me public.profile;
begin
  if p_status not in ('sent', 'failed') then raise exception '발송 결과는 sent 또는 failed입니다.'; end if;
  select * into me from public.profile where profile.id = p_user;
  if me.id is null then raise exception '받는 사람을 찾지 못했습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('morning_briefing:' || p_user || ':' || p_day, 0)); -- 같은 사람·같은 날 두 번 실행이 겹쳐도 한 줄
  if public.morning_briefing_already_sent(p_user, p_day) then return false; end if;
  insert into public.notification (recipient_id, kind, link_path, message, created_by, status, sent_at, reason)
  values (p_user, 'morning_briefing',
          case me.role when 'qa_manager' then '#/home/qa' when 'qc_analyst' then '#/home/qc' else '#/home/production' end,
          case p_status when 'sent' then '아침 브리핑을 슬랙으로 보냈습니다.' else '아침 브리핑을 슬랙으로 보내지 못했습니다. 앱에서 확인해 주세요.' end,
          p_user, p_status::public.notification_status, case p_status when 'sent' then clock_timestamp() end,
          case p_status when 'failed' then '슬랙 계정을 찾지 못했거나 보내기 실패' end);
  return true;
end;
$$;

revoke execute on function public.morning_briefing_recipients() from public, anon, authenticated;
revoke execute on function public.morning_briefing_items(uuid) from public, anon, authenticated;
revoke execute on function public.morning_briefing_already_sent(uuid, date) from public, anon, authenticated;
revoke execute on function public.record_morning_briefing(uuid, date, text) from public, anon, authenticated;
revoke execute on function private.briefing_list(text, jsonb) from public, anon, authenticated;
revoke execute on function private.briefing_count(jsonb, text) from public, anon, authenticated;
revoke execute on function private.briefing_days(timestamptz) from public, anon, authenticated;
grant execute on function public.morning_briefing_recipients() to service_role;
grant execute on function public.morning_briefing_items(uuid) to service_role;
grant execute on function public.morning_briefing_already_sent(uuid, date) to service_role;
grant execute on function public.record_morning_briefing(uuid, date, text) to service_role;
grant execute on function private.briefing_list(text, jsonb) to service_role;
grant execute on function private.briefing_count(jsonb, text) to service_role;
grant execute on function private.briefing_days(timestamptz) to service_role;

-- 되돌리기 (필요하면 따로 실행):
--   drop function if exists public.record_morning_briefing(uuid, date, text);
--   drop function if exists public.morning_briefing_already_sent(uuid, date);
--   drop function if exists public.morning_briefing_items(uuid);
--   drop function if exists public.morning_briefing_recipients();
--   drop function if exists private.briefing_list(text, jsonb); drop function if exists private.briefing_count(jsonb, text); drop function if exists private.briefing_days(timestamptz);
--   delete from public.notification where kind = 'morning_briefing';  -- 종류 제약을 되돌리기 전에
--   0034의 notification_kind_check 정의로 다시 만든다
