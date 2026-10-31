-- spec 003 6단계 (plan 003 §3): 예시 자료 되돌리기 (FR-010, Q26, Q27)
-- 업무 자료(배치·측정값·공정 기록·품질 이슈·조치 요청·취급점검 기록·허가정보로 등록한 제품)를 지우고
-- 예시 제품 3개의 처음 기준값과 예시 배치 5개를 다시 넣는다. 사용자·역할·사용 기록·업무 이력은 지우지 않는다.

-- 되돌리는 동안 예시 자료를 다시 넣는 것은 업무 이력에 남기지 않는다 (남는 것은 "예시 자료 되돌리기" 1줄).
-- 표시는 이 트랜잭션 안에서만 켜진다(set_config 세 번째 인자 true). 화면에서는 set_config를 부를 수 없다
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
  if current_setting('pharmaflow.resetting', true) = 'on' then
    return new;
  end if;
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

-- 0005의 Q13 기준값과 같다. 예시 제품이 없으면 만든다
create or replace function private.seed_sample_products()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  product_id uuid;
begin
  for item in select * from jsonb_array_elements('[
    {"item_name": "파마플로정 500mg (가상)", "main_ingredient": "아세트아미노펜", "manufacturer": "가상제약(주)"},
    {"item_name": "가상큐어캡슐 250mg (가상)", "main_ingredient": "아목시실린수화물", "manufacturer": "가상바이오(주)"},
    {"item_name": "샘플린정 10mg (가상)", "main_ingredient": "로수바스타틴칼슘", "manufacturer": "가상제약(주)"}
  ]'::jsonb) loop
    select id into product_id from public.product where item_name = item->>'item_name';
    if product_id is null then
      insert into public.product (item_name, main_ingredient, manufacturer)
      values (item->>'item_name', item->>'main_ingredient', item->>'manufacturer')
      returning id into product_id;
    end if;
    insert into public.specification (product_id, category, item_name, unit, min_value, max_value) values
      (product_id, 'test', '함량', '%', 95.0, 105.0),
      (product_id, 'test', '순도', '%', 98.0, 102.0),
      (product_id, 'test', '용출률', '%', 80, 100),
      (product_id, 'process', '공정 온도', '℃', 20, 25),
      (product_id, 'process', '습도', '%', 30, 50);
  end loop;
end;
$$;

-- FR-010: QA 관리자만. 한 트랜잭션이라 중간에 실패하면 전부 되돌아간다 (plan 003 §5 위험과 대응)
create or replace function public.reset_sample_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profile := private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  batch_count int;
begin
  perform set_config('pharmaflow.resetting', 'on', true);

  -- Q27: 업무 이력은 지우지 않는다. 지울 배치와의 연결만 비운다(배치번호 글자는 남아 있다)
  alter table public.work_history disable trigger reject_change;
  update public.work_history set batch_id = null where batch_id is not null;
  alter table public.work_history enable trigger reject_change;

  delete from public.measurement;
  delete from public.action_request;
  delete from public.quality_issue;
  delete from public.process_record;
  delete from public.batch;
  delete from public.handling_check;
  delete from public.specification;
  -- Q26: 허가정보로 등록한 제품은 사라지고 예시 제품 3개만 남는다
  delete from public.product where item_name not in ('파마플로정 500mg (가상)', '가상큐어캡슐 250mg (가상)', '샘플린정 10mg (가상)');

  perform private.seed_sample_products();
  perform private.seed_sample_batches(me.id);

  perform set_config('pharmaflow.resetting', 'off', true);
  insert into public.work_history (actor_id, actor_name, actor_role, action, target_table, target_id)
  values (me.id, me.display_name, me.role::text, '예시 자료 되돌리기', 'sample_data', me.id);

  select count(*) into batch_count from public.batch;
  return jsonb_build_object('batches', batch_count);
end;
$$;

revoke execute on function private.seed_sample_products() from public, anon, authenticated;
revoke execute on function public.reset_sample_data() from public, anon;
grant execute on function public.reset_sample_data() to authenticated;
