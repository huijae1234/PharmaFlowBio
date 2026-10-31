-- spec 005 1단계 (plan 005 §2): 품질 영향 평가(ERD v0.7 deviation_review)와 이슈 종류별 닫기 조건 (D7·D8).
-- 더하기만 한다. 기존 이슈·자료는 바꾸지 않는다 (D11). 이미 닫힌 이슈는 그대로, 열린 이슈는 평가를 받아야 닫힌다.

-- ERD deviation_review.status. 임시 저장(작성 중)은 없다 (spec 005 Q36)
create type public.deviation_status as enum ('submitted', 'approved', 'rejected', 'revision_requested');

create table public.deviation_review (
  id uuid primary key default gen_random_uuid(),
  quality_issue_id uuid not null unique references public.quality_issue (id),
  status public.deviation_status not null default 'submitted',
  deviation_summary text not null check (btrim(deviation_summary) <> '' and length(deviation_summary) <= 1000),
  probable_cause text not null check (btrim(probable_cause) <> '' and length(probable_cause) <= 1000),
  impact_assessment text not null check (btrim(impact_assessment) <> '' and length(impact_assessment) <= 1000),
  proposed_action text not null check (btrim(proposed_action) <> '' and length(proposed_action) <= 1000),
  evidence text check (length(evidence) <= 1000),
  requested_by uuid not null references public.profile (id),
  requested_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid references public.profile (id),
  reviewed_at timestamptz,
  review_comment text check (length(review_comment) <= 1000)
);

-- 읽기는 로그인한 사람 모두, 쓰기는 아래 함수로만 (ERD 권한 요약, ADR 0002)
alter table public.deviation_review enable row level security;
create policy "로그인한 사람은 읽기" on public.deviation_review for select to authenticated using (true);
grant select on public.deviation_review to authenticated;

create trigger record_history after insert or update on public.deviation_review
  for each row execute function private.record_history();

-- 업무 이력: 평가도 이슈를 거쳐 로트에 잇고, 행동 이름 5개를 더한다. 0014처럼 지금 정의에서 그 줄만 바꿔 다시 만든다
do $history$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.record_history()'::regprocedure);
  if position('''deviation_review''' in definition) = 0 then
    definition := replace(definition, E'    else null\n  end;',
      E'    when ''deviation_review'' then (select q.batch_id from public.quality_issue q where q.id = (new_row->>''quality_issue_id'')::uuid)\n    else null\n  end;');
    if position('''deviation_review''' in definition) = 0 then
      raise exception 'record_history에 평가 연결을 넣지 못했습니다';
    end if;
    execute definition;
  end if;

  definition := pg_get_functiondef('private.history_action(text, text, jsonb, jsonb)'::regprocedure);
  if position('품질 영향 평가' in definition) = 0 then
    definition := replace(definition, E'    else table_name || '' '' || lower(operation)',
      E'    when table_name = ''deviation_review'' and operation = ''INSERT'' then ''품질 영향 평가 검토 요청''\n' ||
      E'    when table_name = ''deviation_review'' and new_row->>''status'' = ''approved'' then ''품질 영향 평가 승인''\n' ||
      E'    when table_name = ''deviation_review'' and new_row->>''status'' = ''rejected'' then ''품질 영향 평가 반려''\n' ||
      E'    when table_name = ''deviation_review'' and new_row->>''status'' = ''revision_requested'' then ''품질 영향 평가 보완 요청''\n' ||
      E'    when table_name = ''deviation_review'' and new_row->>''status'' = ''submitted'' then ''품질 영향 평가 다시 제출''\n' ||
      E'    else table_name || '' '' || lower(operation)');
    if position('품질 영향 평가' in definition) = 0 then
      raise exception 'history_action에 평가 행동 이름을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$history$;

-- FR-001 수용 기준 2 (spec 005): 필수 4칸, 각 1,000자, 공백만은 빈 칸 (review-rules.js checkReviewFields와 같은 문구)
create or replace function private.clean_review_fields(p_fields jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  spec record;
  cleaned jsonb := '{}'::jsonb;
  text_value text;
begin
  for spec in select * from (values
      ('deviation_summary', '이탈 내용을', '이탈 내용은', true),
      ('probable_cause', '추정 원인을', '추정 원인은', true),
      ('impact_assessment', '품질 영향 평가를', '품질 영향 평가는', true),
      ('proposed_action', '제안 후속 조치를', '제안 후속 조치는', true),
      ('evidence', '근거를', '근거는', false)) as f(key, object_label, topic_label, required) loop
    text_value := nullif(btrim(coalesce(p_fields->>spec.key, '')), '');
    if spec.required and text_value is null then
      raise exception '% 입력해 주세요.', spec.object_label;
    end if;
    if length(text_value) > 1000 then
      raise exception '% 1,000자까지 입력할 수 있습니다.', spec.topic_label;
    end if;
    cleaned := cleaned || jsonb_build_object(spec.key, text_value);
  end loop;
  return cleaned;
end;
$$;

-- 열린 이슈이고 그 로트가 내부 출하 검토 전인지 확인하며 이슈를 잠근다
create or replace function private.lock_open_issue(p_issue_id uuid)
returns public.quality_issue
language plpgsql
security definer
set search_path = ''
as $$
declare
  issue public.quality_issue := private.lock_issue_for_action(p_issue_id);
begin
  if issue.status <> 'open' then
    raise exception '닫힌 품질 이슈입니다. 화면을 새로 고쳐 주세요.';
  end if;
  return issue;
end;
$$;

-- FR-001: 작성 → 검토 요청 (QC 시험 담당자·생산 담당자·QA 관리자). 이슈당 하나
create or replace function public.submit_deviation_review(p_issue_id uuid, p_fields jsonb)
returns public.deviation_review
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qc_analyst', 'production_operator', 'qa_manager']::public.user_role[],
                                            'QC 시험 담당자·생산 담당자·QA 관리자');
  issue public.quality_issue := private.lock_open_issue(p_issue_id);
  fields jsonb := private.clean_review_fields(p_fields);
  created public.deviation_review;
begin
  if exists (select 1 from public.deviation_review where quality_issue_id = issue.id) then
    raise exception '이미 품질 영향 평가가 있습니다. 화면을 새로 고칩니다.';
  end if;
  insert into public.deviation_review (quality_issue_id, deviation_summary, probable_cause, impact_assessment, proposed_action, evidence, requested_by)
  values (issue.id, fields->>'deviation_summary', fields->>'probable_cause', fields->>'impact_assessment',
          fields->>'proposed_action', fields->>'evidence', me.id)
  returning * into created;
  return created;
exception
  when unique_violation then
    raise exception '이미 품질 영향 평가가 있습니다. 화면을 새로 고칩니다.';
end;
$$;

-- FR-003: 보완 요청·반려된 평가를 요청자 본인이 고쳐 다시 제출. 검토 요청 중에는 못 고친다 (Q34)
create or replace function public.resubmit_deviation_review(p_review_id uuid, p_fields jsonb)
returns public.deviation_review
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qc_analyst', 'production_operator', 'qa_manager']::public.user_role[],
                                            'QC 시험 담당자·생산 담당자·QA 관리자');
  review public.deviation_review;
  fields jsonb;
begin
  select * into review from public.deviation_review where id = p_review_id for update;
  if review.id is null then
    raise exception '품질 영향 평가를 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
  if review.requested_by <> me.id then
    raise exception '이 작업은 평가를 요청한 사람만 할 수 있습니다.' using errcode = '42501';
  end if;
  if review.status not in ('rejected', 'revision_requested') then
    raise exception '보완 요청이나 반려된 평가만 고쳐 다시 제출할 수 있습니다.';
  end if;
  perform private.lock_open_issue(review.quality_issue_id);
  fields := private.clean_review_fields(p_fields);
  -- 지난 검토 사유는 업무 이력(바뀌기 전 값)에 남는다
  update public.deviation_review
     set deviation_summary = fields->>'deviation_summary', probable_cause = fields->>'probable_cause',
         impact_assessment = fields->>'impact_assessment', proposed_action = fields->>'proposed_action',
         evidence = fields->>'evidence', status = 'submitted', requested_at = clock_timestamp(),
         reviewed_by = null, reviewed_at = null, review_comment = null
   where id = review.id
  returning * into review;
  return review;
end;
$$;

-- FR-002: QA 관리자가 승인·반려·보완 요청. 검토 요청 상태일 때만(동시 처리 막기), 반려·보완은 사유 필수, 승인은 최종
create or replace function public.review_deviation_review(p_review_id uuid, p_decision public.deviation_status, p_comment text)
returns public.deviation_review
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  review public.deviation_review;
  reason text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_decision is null or p_decision = 'submitted' then
    raise exception '승인·반려·보완 요청 중 하나를 골라 주세요.';
  end if;
  select * into review from public.deviation_review where id = p_review_id for update;
  if review.id is null then
    raise exception '품질 영향 평가를 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
  if review.status <> 'submitted' then
    raise exception '다른 사람이 먼저 처리했습니다. 화면을 새로 고칩니다.';
  end if;
  perform private.lock_open_issue(review.quality_issue_id);
  if p_decision in ('rejected', 'revision_requested') and reason is null then
    raise exception '사유를 입력해 주세요.';
  end if;
  if length(reason) > 1000 then
    raise exception '사유는 1,000자까지 입력할 수 있습니다.';
  end if;
  update public.deviation_review
     set status = p_decision, reviewed_by = me.id, reviewed_at = clock_timestamp(), review_comment = reason
   where id = review.id
  returning * into review;
  return review;
end;
$$;

-- FR-004 (spec 005), D8: 공통 — 승인된 평가, 열린 조치 없음. 규격 이탈 — 완료된 조치 1건 이상.
-- 승인 뒤 종류가 규격 이탈로 바뀌어도 평가는 다시 받지 않는다 (Q35). 마지막 열린 이슈면 보류 → 시험 중 (ERD Q2, 직접 보류 사유가 없을 때)
create or replace function public.close_quality_issue(p_issue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  issue public.quality_issue;
  target public.batch;
begin
  select * into me from public.profile where id = auth.uid();
  issue := private.lock_issue_for_action(p_issue_id);
  if me.id is null or me.role = 'viewer' or not (
       me.role = 'qa_manager'
       or exists (select 1 from public.action_request where quality_issue_id = issue.id and assignee_id = me.id)) then
    raise exception '이 작업은 배정된 담당자나 QA 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if issue.status <> 'open' then
    raise exception '이미 닫힌 품질 이슈입니다.';
  end if;
  if not exists (select 1 from public.deviation_review where quality_issue_id = issue.id and status = 'approved') then
    raise exception '승인된 품질 영향 평가가 없어 닫을 수 없습니다.';
  end if;
  if exists (select 1 from public.action_request
             where quality_issue_id = issue.id and status in ('pending_approval', 'approved')) then
    raise exception '끝나지 않은 조치 요청이 있어 닫을 수 없습니다.';
  end if;
  if issue.kind = 'spec'
     and not exists (select 1 from public.action_request where quality_issue_id = issue.id and status = 'completed') then
    raise exception '완료된 조치 요청이 없어 닫을 수 없습니다. 먼저 조치 결과를 넣어 주세요.';
  end if;

  update public.quality_issue set status = 'closed', closed_by = me.id, closed_at = now() where id = issue.id;

  select * into target from public.batch where id = issue.batch_id;
  if target.status = 'on_hold' and target.hold_reason is null
     and not exists (select 1 from public.quality_issue where batch_id = target.id and status = 'open') then
    update public.batch set status = 'in_testing' where id = target.id returning * into target;
  end if;
  return jsonb_build_object('issue_status', 'closed', 'batch_status', target.status);
end;
$$;

revoke execute on function private.clean_review_fields(jsonb) from public, anon, authenticated;
revoke execute on function private.lock_open_issue(uuid) from public, anon, authenticated;
revoke execute on function public.submit_deviation_review(uuid, jsonb) from public, anon;
revoke execute on function public.resubmit_deviation_review(uuid, jsonb) from public, anon;
revoke execute on function public.review_deviation_review(uuid, public.deviation_status, text) from public, anon;
grant execute on function public.submit_deviation_review(uuid, jsonb) to authenticated;
grant execute on function public.resubmit_deviation_review(uuid, jsonb) to authenticated;
grant execute on function public.review_deviation_review(uuid, public.deviation_status, text) to authenticated;
