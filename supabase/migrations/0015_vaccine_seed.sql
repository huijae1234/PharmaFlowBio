-- spec 004 5단계 FR-010·011: 가상 백신 예시. 모든 값은 교육용 가상 값이다 (spec 004 Q30). 실제 백신의 법정 규격이 아니다.
-- 기존 자료는 지우지 않고 더한다 (전환 D11). 되돌리기는 가상 백신 예시만 다시 넣는다 (Q32).

-- 예시 측정값 한 줄: 판정과 그때 기준·버전을 저장 함수와 같은 규칙으로 (private.judge)
create or replace function private.seed_measurement(p_batch_id uuid, p_item_name text, p_value numeric, p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.batch := (select b from public.batch b where b.id = p_batch_id);
  spec public.specification;
begin
  select * into spec from public.specification
   where product_id = target.product_id and category = 'test' and item_name = p_item_name;
  insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, measured_by,
                                  applied_min_value, applied_max_value, applied_alert_min_value, applied_alert_max_value, applied_spec_version)
  values (target.id, spec.id, p_value, private.judge(p_value, spec), p_issue_id, target.created_by,
          spec.min_value, spec.max_value, spec.alert_min_value, spec.alert_max_value, spec.version);
end;
$$;

-- 가상 백신 제품 2개와 기준 (제품이 있으면 그대로 쓰고, 기준이 없을 때만 넣는다)
create or replace function private.seed_vaccine_products()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  name_text text;
  pid uuid;
begin
  foreach name_text in array array['가상 백신 A(교육용)', '가상 백신 B(교육용)'] loop
    select p.id into pid from public.product p where p.item_name = name_text;
    if pid is null then
      insert into public.product (item_name, main_ingredient, manufacturer)
      values (name_text, '교육용 가상 항원', '가상바이오(주) (교육용)')
      returning id into pid;
    end if;
    if not exists (select 1 from public.specification s where s.product_id = pid) then
      insert into public.specification (product_id, category, item_name, unit, min_value, max_value, alert_min_value, alert_max_value) values
        (pid, 'test', '역가', '%', 80, 125, 90, 115),
        (pid, 'test', '엔도톡신', 'EU/mL', 0, 10, 0, 5),
        (pid, 'test', 'pH', null, 6.8, 7.6, 7.0, 7.4),
        (pid, 'process', '배양 온도', '℃', 35, 38, 36, 37.5),
        (pid, 'process', '보관 온도', '℃', 2, 8, 3, 7);
    end if;
  end loop;
end;
$$;

-- 가상 백신 로트 4개 (spec 004 FR-010). VX-2610-002는 역가를 비워 두어 시연에서 넣을 수 있다 (SC-001)
create or replace function private.seed_vaccine_samples(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_a uuid;
  product_b uuid;
  lot uuid;
  issue_id uuid;
begin
  if not exists (select 1 from public.profile where id = p_owner) then
    raise exception '예시 로트를 등록할 사용자가 없습니다.';
  end if;
  perform private.seed_vaccine_products();
  if exists (select 1 from public.batch where batch_number like 'VX-2610-%') then
    return;
  end if;
  product_a := (select id from public.product where item_name = '가상 백신 A(교육용)');
  product_b := (select id from public.product where item_name = '가상 백신 B(교육용)');

  -- 생산 중
  insert into public.batch (batch_number, product_id, created_by) values ('VX-2610-001', product_a, p_owner);

  -- 시험 중: pH·엔도톡신 정상, 역가는 아직
  insert into public.batch (batch_number, product_id, status, created_by)
  values ('VX-2610-002', product_a, 'in_testing', p_owner) returning id into lot;
  perform private.seed_measurement(lot, 'pH', 7.2, null);
  perform private.seed_measurement(lot, '엔도톡신', 2.0, null);

  -- 보류: 역가 규격 이탈 (이슈 종류 규격 이탈)
  insert into public.batch (batch_number, product_id, status, created_by)
  values ('VX-2610-003', product_b, 'on_hold', p_owner) returning id into lot;
  insert into public.quality_issue (batch_id, source, kind) values (lot, 'test', 'spec') returning id into issue_id;
  perform private.seed_measurement(lot, '역가', 76, issue_id);

  -- 시험 중: 엔도톡신 관리기준 이탈 (이슈만, 보류 없음)
  insert into public.batch (batch_number, product_id, status, created_by)
  values ('VX-2610-004', product_b, 'in_testing', p_owner) returning id into lot;
  perform private.seed_measurement(lot, '역가', 100, null);
  insert into public.quality_issue (batch_id, source, kind) values (lot, 'test', 'alert') returning id into issue_id;
  perform private.seed_measurement(lot, '엔도톡신', 6.5, issue_id);
end;
$$;

revoke execute on function private.seed_measurement(uuid, text, numeric, uuid) from public, anon, authenticated;
revoke execute on function private.seed_vaccine_products() from public, anon, authenticated;
revoke execute on function private.seed_vaccine_samples(uuid) from public, anon, authenticated;

-- FR-011: 되돌리기는 가상 백신 예시만. 나머지 동작(이력 보존, 이력 트리거 멈춤 표시)은 0011과 같다
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

  -- Q27: 업무 이력은 지우지 않는다. 지울 로트와의 연결만 비운다(로트번호 글자는 남아 있다)
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
  delete from public.product where item_name not in ('가상 백신 A(교육용)', '가상 백신 B(교육용)');

  perform private.seed_vaccine_samples(me.id);

  perform set_config('pharmaflow.resetting', 'off', true);
  insert into public.work_history (actor_id, actor_name, actor_role, action, target_table, target_id)
  values (me.id, me.display_name, me.role::text, '예시 자료 되돌리기', 'sample_data', me.id);

  select count(*) into batch_count from public.batch;
  return jsonb_build_object('batches', batch_count);
end;
$$;

-- 지금 자료에 한 번 더한다. 첫 QA 관리자를 등록한 사람으로 (로그인한 사람이 없어 업무 이력은 남지 않음)
select private.seed_vaccine_samples((select id from public.profile where role = 'qa_manager' order by created_at limit 1));
