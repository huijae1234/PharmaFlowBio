-- spec 003 1단계 (plan 003 §3): 업무 이력 배치번호(Q27), 제품 등록(FR-001), 취급점검 기록(FR-007)

-- ERD v0.6 work_history.batch_number: 예시 자료 되돌리기로 배치가 지워져도 어느 배치였는지 남긴다 (Q27)
alter table public.work_history add column batch_number text;

-- 기존 이력 채우기. 이력 고치기 막기(0002)를 이 한 번만 잠깐 끈다
alter table public.work_history disable trigger reject_change;
update public.work_history w set batch_number = b.batch_number
  from public.batch b where b.id = w.batch_id and w.batch_number is null;
alter table public.work_history enable trigger reject_change;

-- 행동 이름 (0008에 더함): 취급점검 기록
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
    when table_name = 'handling_check' and operation = 'INSERT' then '취급점검 기록'
    when table_name = 'action_request' and operation = 'INSERT' then '조치 요청 등록'
    when table_name = 'action_request' and new_row->>'status' = 'approved' then '조치 요청 승인'
    when table_name = 'action_request' and new_row->>'status' = 'rejected' then '조치 요청 반려'
    when table_name = 'action_request' and new_row->>'status' = 'pending_approval' then '조치 요청 다시 제출'
    when table_name = 'action_request' and new_row->>'status' = 'completed' then '조치 완료'
    else table_name || ' ' || lower(operation)
  end
$$;

-- 0002의 이력 트리거에 배치번호를 더한다. 나머지 동작은 그대로
create or replace function private.record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profile;
  old_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_row jsonb := to_jsonb(new);
  related_batch uuid;
begin
  -- 로그인한 사람이 없는 변경(설치용 예시 자료, 첫 로그인 시 profile 생성)은 남기지 않는다
  if auth.uid() is null then
    return new;
  end if;
  select * into actor from public.profile where id = auth.uid();
  if actor.id is null then
    return new;
  end if;
  -- 바뀐 것이 없는 수정은 남기지 않는다
  if tg_op = 'UPDATE' and old_row = new_row then
    return new;
  end if;

  related_batch := case tg_table_name
    when 'batch' then (new_row->>'id')::uuid
    when 'measurement' then (new_row->>'batch_id')::uuid
    when 'process_record' then (new_row->>'batch_id')::uuid
    when 'quality_issue' then (new_row->>'batch_id')::uuid
    when 'action_request' then (select q.batch_id from public.quality_issue q where q.id = (new_row->>'quality_issue_id')::uuid)
    else null
  end;

  insert into public.work_history (actor_id, actor_name, actor_role, action, target_table, target_id,
                                   batch_id, batch_number, before_data, after_data)
  values (actor.id, actor.display_name, actor.role::text,
          private.history_action(tg_table_name, tg_op, old_row, new_row),
          tg_table_name, (new_row->>'id')::uuid, related_batch,
          (select b.batch_number from public.batch b where b.id = related_batch),
          old_row, new_row);
  return new;
end;
$$;

create trigger record_history after insert on public.handling_check
  for each row execute function private.record_history();

-- FR-001 수용 기준 4: 같은 허가 품목은 한 번만 (Q26: 허가정보 검색으로만 등록)
create unique index product_permit_item_code_key on public.product (permit_item_code) where permit_item_code is not null;

-- FR-001: 허가정보에서 고른 제품 등록 (QA 관리자만)
create or replace function public.create_product(
  p_item_name text, p_main_ingredient text, p_manufacturer text, p_permit_item_code text)
returns public.product
language plpgsql
security definer
set search_path = ''
as $$
declare
  name text := nullif(btrim(coalesce(p_item_name, '')), '');
  code text := nullif(btrim(coalesce(p_permit_item_code, '')), '');
  saved public.product;
begin
  perform private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if name is null then
    raise exception '품목명을 입력해 주세요.';
  end if;
  if code is null then
    raise exception '허가정보에서 제품을 골라 주세요.';
  end if;
  if exists (select 1 from public.product where permit_item_code = code) then
    raise exception '이미 등록된 제품입니다.';
  end if;
  insert into public.product (item_name, main_ingredient, manufacturer, permit_item_code)
  values (name, nullif(btrim(coalesce(p_main_ingredient, '')), ''), nullif(btrim(coalesce(p_manufacturer, '')), ''), code)
  returning * into saved;
  return saved;
end;
$$;

-- FR-007: 취급점검 기록 (QC 시험 담당자·생산 담당자·QA 관리자). 열람자는 못 쓴다
create or replace function public.save_handling_check(
  p_chem_id text, p_chem_name text, p_cas_no text, p_check_content text, p_protective_measures text)
returns public.handling_check
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(
    array['qc_analyst', 'production_operator', 'qa_manager']::public.user_role[],
    'QC 시험 담당자·생산 담당자·QA 관리자');
  chem_id text := nullif(btrim(coalesce(p_chem_id, '')), '');
  chem_name text := nullif(btrim(coalesce(p_chem_name, '')), '');
  content text := private.clean_text(p_check_content, '점검 내용');
  measures text := private.clean_text(p_protective_measures, '보호조치');
  saved public.handling_check;
begin
  if chem_id is null or chem_name is null then
    raise exception '물질을 다시 골라 주세요.';
  end if;
  if content is null then
    raise exception '점검 내용을 입력해 주세요.';
  end if;
  if measures is null then
    raise exception '보호조치를 입력해 주세요.';
  end if;
  insert into public.handling_check (chem_id, chem_name, cas_no, check_content, protective_measures, checked_by)
  values (chem_id, chem_name, nullif(btrim(coalesce(p_cas_no, '')), ''), content, measures, me.id)
  returning * into saved;
  return saved;
end;
$$;

revoke execute on function public.create_product(text, text, text, text) from public, anon;
revoke execute on function public.save_handling_check(text, text, text, text, text) from public, anon;
grant execute on function public.create_product(text, text, text, text) to authenticated;
grant execute on function public.save_handling_check(text, text, text, text, text) to authenticated;
