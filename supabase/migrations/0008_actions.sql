-- spec 002: 조치 요청·승인·반려·결과·이슈 닫기·출하 판정. 화면은 이 함수들로만 쓴다 (0003 표 쓰기 권한 없음).
-- 함수마다 역할·배정·상태를 다시 확인하고, 한 함수 안의 변경은 한꺼번에 된다 (UJ E1).

-- Q18 (spec 002): 조치 종류별로 배정할 수 있는 역할
create or replace function private.assignable_roles(p_action_type public.action_type)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_action_type
    when 'retest' then array['qc_analyst', 'qa_manager']::public.user_role[]
    when 'equipment_check' then array['production_operator', 'qa_manager']::public.user_role[]
    when 'material_check' then array['qc_analyst', 'production_operator', 'qa_manager']::public.user_role[]
    when 'batch_discard' then array['qa_manager']::public.user_role[]
  end
$$;

-- 조치 요청 내용·사유 같은 사람 입력: 공백만이면 빈 값, 500자까지
create or replace function private.clean_text(p_text text, p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if length(cleaned) > 500 then
    raise exception '%은(는) 500자까지 쓸 수 있습니다.', p_label;
  end if;
  return cleaned;
end;
$$;

-- 이슈를 잠그고, 그 배치가 판정 전인지(Q11) 확인한다
create or replace function private.lock_issue_for_action(p_issue_id uuid)
returns public.quality_issue
language plpgsql
security definer
set search_path = ''
as $$
declare
  issue public.quality_issue;
begin
  select * into issue from public.quality_issue where id = p_issue_id for update;
  if issue.id is null then
    raise exception '품질 이슈를 찾을 수 없습니다. 목록에서 다시 골라 주세요.' using errcode = 'P0002';
  end if;
  perform private.lock_editable_batch(issue.batch_id);
  return issue;
end;
$$;

-- FR-003: 조치 요청 등록 (QC 시험 담당자·생산 담당자·QA 관리자)
create or replace function public.submit_action_request(p_issue_id uuid, p_action_type public.action_type, p_description text)
returns public.action_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  issue public.quality_issue;
  created public.action_request;
begin
  me := private.require_role(array['qc_analyst', 'production_operator', 'qa_manager']::public.user_role[],
                             'QC 시험 담당자·생산 담당자·QA 관리자');
  if p_action_type is null then
    raise exception '조치 종류를 골라 주세요.';
  end if;
  issue := private.lock_issue_for_action(p_issue_id);
  if issue.status <> 'open' then
    raise exception '닫힌 품질 이슈에는 조치를 요청할 수 없습니다.';
  end if;
  -- Q20: 재시험은 시험 이슈에만
  if p_action_type = 'retest' and issue.source <> 'test' then
    raise exception '재시험은 시험 이슈에만 요청할 수 있습니다.';
  end if;
  insert into public.action_request (quality_issue_id, action_type, description, requested_by)
  values (issue.id, p_action_type, private.clean_text(p_description, '요청 내용'), me.id)
  returning * into created;
  return created;
end;
$$;

-- FR-005: 반려된 요청을 요청자 본인이 고쳐 다시 제출 (Q21: 종류·내용 모두 바꿀 수 있음)
create or replace function public.resubmit_action_request(p_request_id uuid, p_action_type public.action_type, p_description text)
returns public.action_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  request public.action_request;
  issue public.quality_issue;
begin
  me := private.require_role(array['qc_analyst', 'production_operator', 'qa_manager']::public.user_role[],
                             'QC 시험 담당자·생산 담당자·QA 관리자');
  select * into request from public.action_request where id = p_request_id for update;
  if request.id is null then
    raise exception '조치 요청을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
  if request.requested_by <> me.id then
    raise exception '이 작업은 요청한 사람만 할 수 있습니다.' using errcode = '42501';
  end if;
  if request.status <> 'rejected' then
    raise exception '반려된 요청만 다시 낼 수 있습니다.';
  end if;
  if p_action_type is null then
    raise exception '조치 종류를 골라 주세요.';
  end if;
  issue := private.lock_issue_for_action(request.quality_issue_id);
  if issue.status <> 'open' then
    raise exception '닫힌 품질 이슈에는 조치를 요청할 수 없습니다.';
  end if;
  if p_action_type = 'retest' and issue.source <> 'test' then
    raise exception '재시험은 시험 이슈에만 요청할 수 있습니다.';
  end if;
  update public.action_request
     set action_type = p_action_type, description = private.clean_text(p_description, '요청 내용'),
         status = 'pending_approval', requested_at = now(),
         rejection_reason = null, reviewed_by = null, reviewed_at = null
   where id = request.id
  returning * into request;
  return request;
end;
$$;

-- 승인·반려 공통: QA 관리자, 승인 대기만 (FR-006 동시 처리 막기)
create or replace function private.lock_pending_request(p_request_id uuid)
returns public.action_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.action_request;
begin
  select * into request from public.action_request where id = p_request_id for update;
  if request.id is null then
    raise exception '조치 요청을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
  if request.status <> 'pending_approval' then
    raise exception '다른 사람이 먼저 처리했습니다. 화면을 새로 고칩니다.';
  end if;
  perform private.lock_issue_for_action(request.quality_issue_id);
  return request;
end;
$$;

-- FR-004: 승인 + 담당자 배정 (Q18)
create or replace function public.approve_action_request(p_request_id uuid, p_assignee_id uuid)
returns public.action_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  request public.action_request;
  assignee public.profile;
begin
  me := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if p_assignee_id is null then
    raise exception '담당자를 골라 주세요.';
  end if;
  request := private.lock_pending_request(p_request_id);
  select * into assignee from public.profile where id = p_assignee_id;
  if assignee.id is null or not (assignee.role = any (private.assignable_roles(request.action_type))) then
    raise exception '이 조치에 배정할 수 없는 사람입니다. 조치 종류에 맞는 역할의 사람을 골라 주세요.';
  end if;
  update public.action_request
     set status = 'approved', assignee_id = assignee.id, reviewed_by = me.id, reviewed_at = now()
   where id = request.id
  returning * into request;
  return request;
end;
$$;

-- FR-005: 반려 (사유 필수)
create or replace function public.reject_action_request(p_request_id uuid, p_reason text)
returns public.action_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  request public.action_request;
  reason text := private.clean_text(p_reason, '반려 사유');
begin
  me := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if reason is null then
    raise exception '반려 사유를 입력해 주세요.';
  end if;
  request := private.lock_pending_request(p_request_id);
  update public.action_request
     set status = 'rejected', rejection_reason = reason, reviewed_by = me.id, reviewed_at = now()
   where id = request.id
  returning * into request;
  return request;
end;
$$;

-- FR-007: 조치 결과. 배정된 담당자 또는 QA 관리자, 승인됨만. 재시험이면 측정값을 다시 판정해 같은 이슈에 붙인다
create or replace function public.complete_action_request(p_request_id uuid, p_result_note text, p_retest_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile;
  request public.action_request;
  issue public.quality_issue;
  spec public.specification;
  verdict public.measurement_result;
  note text := private.clean_text(p_result_note, '조치 결과');
begin
  select * into me from public.profile where id = auth.uid();
  select * into request from public.action_request where id = p_request_id for update;
  if request.id is null then
    raise exception '조치 요청을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' using errcode = 'P0002';
  end if;
  if me.id is null or me.role = 'viewer' or not (me.role = 'qa_manager' or request.assignee_id = me.id) then
    raise exception '이 작업은 배정된 담당자나 QA 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if request.status <> 'approved' then
    raise exception '승인된 조치 요청만 결과를 넣을 수 있습니다.';
  end if;
  issue := private.lock_issue_for_action(request.quality_issue_id);

  if request.action_type = 'retest' then
    if p_retest_value is null then
      raise exception '숫자로 입력해 주세요.';
    end if;
    -- Q20: 이 이슈를 연 기준 이탈 측정값의 시험 항목을 다시 잰다
    select s.* into spec
      from public.measurement m join public.specification s on s.id = m.specification_id
     where m.quality_issue_id = issue.id and m.action_request_id is null and m.result = 'out_of_spec'
     order by m.measured_at
     limit 1;
    if spec.id is null then
      raise exception '다시 잴 시험 항목을 찾을 수 없습니다. QA 관리자에게 알려 주세요.';
    end if;
    verdict := case when p_retest_value between spec.min_value and spec.max_value then 'pass' else 'out_of_spec' end;
    -- 재이탈이어도 새 이슈를 만들지 않고 같은 이슈에 붙는다 (PRD FR-14)
    insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, action_request_id,
                                    measured_by, applied_min_value, applied_max_value)
    values (issue.batch_id, spec.id, p_retest_value, verdict, issue.id, request.id, me.id, spec.min_value, spec.max_value);
  elsif note is null then
    raise exception '조치 결과를 입력해 주세요.';
  end if;

  update public.action_request
     set status = 'completed', result_note = note, completed_at = now()
   where id = request.id;
  return jsonb_build_object('request_status', 'completed', 'result', verdict, 'issue_status', issue.status);
end;
$$;

-- FR-008: 이슈 닫기 (Q19). 마지막 열린 이슈면 보류 → 시험 중 (ERD Q2, 직접 보류 사유가 없을 때)
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
  if exists (select 1 from public.action_request
             where quality_issue_id = issue.id and status in ('pending_approval', 'approved')) then
    raise exception '끝나지 않은 조치 요청이 있어 닫을 수 없습니다.';
  end if;
  if not exists (select 1 from public.action_request where quality_issue_id = issue.id and status = 'completed') then
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

-- FR-009: 출하 판정 (QA 관리자). 출하 가능은 Q17 조건, 폐기는 판정 전 언제든
create or replace function public.decide_release(p_batch_id uuid, p_decision public.batch_status)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.batch;
  open_issues int;
  unfinished text;
begin
  perform private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if p_decision is null or p_decision not in ('releasable', 'discarded') then
    raise exception '출하 가능 또는 폐기를 골라 주세요.';
  end if;
  target := private.lock_editable_batch(p_batch_id);

  if p_decision = 'releasable' then
    select count(*) into open_issues from public.quality_issue where batch_id = target.id and status = 'open';
    if open_issues > 0 then
      raise exception '열린 품질 이슈가 %건 있어 출하할 수 없습니다.', open_issues;
    end if;
    if not (target.status = 'in_testing' or (target.status = 'on_hold' and target.hold_reason is not null)) then
      raise exception '시험 중인 배치만 출하할 수 있습니다.';
    end if;
    -- 모든 시험 항목의 마지막 측정값(재시험 포함)이 적합이어야 한다
    select string_agg(s.item_name, ', ' order by s.item_name) into unfinished
      from public.specification s
     where s.product_id = target.product_id and s.category = 'test'
       and coalesce((select m.result from public.measurement m
                      where m.batch_id = target.id and m.specification_id = s.id
                      order by m.measured_at desc limit 1), 'out_of_spec') <> 'pass';
    if unfinished is not null then
      raise exception '시험이 끝나지 않은 항목이 있습니다: %', unfinished;
    end if;
  end if;

  update public.batch set status = p_decision where id = target.id returning * into target;
  return target;
end;
$$;

-- 업무 이력 행동 이름 보강 (0002의 함수를 바꾼다)
create or replace function private.history_action(table_name text, operation text, old_row jsonb, new_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when table_name = 'measurement' and new_row->>'action_request_id' is not null then '재시험 측정값 입력'
    when table_name = 'measurement' then '측정값 입력'
    when table_name = 'process_record' then '공정 조건 입력'
    when table_name = 'quality_issue' and operation = 'INSERT' then '품질 이슈 생성'
    when table_name = 'quality_issue' and new_row->>'status' = 'closed' and old_row->>'status' <> 'closed' then '품질 이슈 닫기'
    when table_name = 'batch' and operation = 'INSERT' then '배치 등록'
    when table_name = 'batch' and new_row->>'status' in ('releasable', 'discarded')
         and new_row->>'status' is distinct from old_row->>'status' then '출하 판정'
    when table_name = 'batch' and new_row->>'status' = 'on_hold'
         and new_row->>'hold_reason' is not null
         and new_row->>'hold_reason' is distinct from old_row->>'hold_reason' then '배치 보류'
    when table_name = 'batch' and new_row->>'status' is distinct from old_row->>'status' then '배치 상태 변경'
    when table_name = 'specification' and operation = 'INSERT' then '기준값 등록'
    when table_name = 'specification' then '기준값 수정'
    when table_name = 'profile' and new_row->>'role' is distinct from old_row->>'role' then '역할 지정'
    when table_name = 'product' and operation = 'INSERT' then '제품 등록'
    when table_name = 'action_request' and operation = 'INSERT' then '조치 요청 등록'
    when table_name = 'action_request' and new_row->>'status' = 'approved' then '조치 요청 승인'
    when table_name = 'action_request' and new_row->>'status' = 'rejected' then '조치 요청 반려'
    when table_name = 'action_request' and new_row->>'status' = 'pending_approval' then '조치 요청 다시 제출'
    when table_name = 'action_request' and new_row->>'status' = 'completed' then '조치 완료'
    else table_name || ' ' || lower(operation)
  end
$$;

-- 함수 실행 권한: 로그인한 사람만 (안에서 역할을 다시 확인)
revoke execute on function public.submit_action_request(uuid, public.action_type, text) from public, anon;
revoke execute on function public.resubmit_action_request(uuid, public.action_type, text) from public, anon;
revoke execute on function public.approve_action_request(uuid, uuid) from public, anon;
revoke execute on function public.reject_action_request(uuid, text) from public, anon;
revoke execute on function public.complete_action_request(uuid, text, numeric) from public, anon;
revoke execute on function public.close_quality_issue(uuid) from public, anon;
revoke execute on function public.decide_release(uuid, public.batch_status) from public, anon;
grant execute on function public.submit_action_request(uuid, public.action_type, text) to authenticated;
grant execute on function public.resubmit_action_request(uuid, public.action_type, text) to authenticated;
grant execute on function public.approve_action_request(uuid, uuid) to authenticated;
grant execute on function public.reject_action_request(uuid, text) to authenticated;
grant execute on function public.complete_action_request(uuid, text, numeric) to authenticated;
grant execute on function public.close_quality_issue(uuid) to authenticated;
grant execute on function public.decide_release(uuid, public.batch_status) to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_user_role() to authenticated;
