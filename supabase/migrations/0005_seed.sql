-- FR-015 (spec 001): 가상 예시 자료. 실제 회사·제품이 아니다 (문제정의 머리말).
-- 제품 3개와 기준값(Q13)은 지금 넣는다. 배치는 "등록한 사람"이 필요해서
-- 첫 QA 관리자가 생긴 뒤(plan 001 4단계) private.seed_sample_batches(그 사람 id)로 넣는다.

do $seed$
declare
  products jsonb := '[
    {"item_name": "파마플로정 500mg (가상)", "main_ingredient": "아세트아미노펜", "manufacturer": "가상제약(주)"},
    {"item_name": "가상큐어캡슐 250mg (가상)", "main_ingredient": "아목시실린수화물", "manufacturer": "가상바이오(주)"},
    {"item_name": "샘플린정 10mg (가상)", "main_ingredient": "로수바스타틴칼슘", "manufacturer": "가상제약(주)"}
  ]';
  item jsonb;
  new_product uuid;
begin
  if exists (select 1 from public.product where item_name like '%(가상)') then
    return;
  end if;
  for item in select * from jsonb_array_elements(products) loop
    insert into public.product (item_name, main_ingredient, manufacturer)
    values (item->>'item_name', item->>'main_ingredient', item->>'manufacturer')
    returning id into new_product;
    -- Q13 확정 기준값
    insert into public.specification (product_id, category, item_name, unit, min_value, max_value) values
      (new_product, 'test', '함량', '%', 95.0, 105.0),
      (new_product, 'test', '순도', '%', 98.0, 102.0),
      (new_product, 'test', '용출률', '%', 80, 100),
      (new_product, 'process', '공정 온도', '℃', 20, 25),
      (new_product, 'process', '습도', '%', 30, 50);
  end loop;
end
$seed$;

-- 예시 배치: 생산 중·시험 중·보류가 각각 1개 이상 (FR-015 수용 기준 1)
-- 기능 003의 "예시 자료로 되돌리기"도 이 함수를 다시 쓴다
create or replace function private.seed_sample_batches(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_a uuid := (select id from public.product where item_name = '파마플로정 500mg (가상)');
  product_b uuid := (select id from public.product where item_name = '가상큐어캡슐 250mg (가상)');
  product_c uuid := (select id from public.product where item_name = '샘플린정 10mg (가상)');
  batch_id uuid;
  issue_id uuid;
begin
  if not exists (select 1 from public.profile where id = p_owner) then
    raise exception '예시 배치를 등록할 사용자가 없습니다.';
  end if;
  if exists (select 1 from public.batch where batch_number like 'PF-2610-%') then
    return;
  end if;

  -- 생산 중
  insert into public.batch (batch_number, product_id, created_by) values ('PF-2610-001', product_a, p_owner);
  insert into public.batch (batch_number, product_id, created_by) values ('PF-2610-004', product_c, p_owner);

  -- 시험 중: 시험값 일부 적합
  insert into public.batch (batch_number, product_id, status, created_by)
  values ('PF-2610-002', product_a, 'in_testing', p_owner) returning id into batch_id;
  insert into public.measurement (batch_id, specification_id, value, result, measured_by)
  select batch_id, s.id, v.value, 'pass', p_owner
    from (values ('함량', 100.2), ('순도', 99.4)) as v(item_name, value)
    join public.specification s on s.product_id = product_a and s.category = 'test' and s.item_name = v.item_name;

  insert into public.batch (batch_number, product_id, status, created_by)
  values ('PF-2610-005', product_b, 'in_testing', p_owner) returning id into batch_id;
  insert into public.measurement (batch_id, specification_id, value, result, measured_by)
  select batch_id, s.id, 88, 'pass', p_owner
    from public.specification s where s.product_id = product_b and s.category = 'test' and s.item_name = '용출률';

  -- 보류: 순도 기준 이탈로 품질 이슈가 열려 있음
  insert into public.batch (batch_number, product_id, status, created_by)
  values ('PF-2610-003', product_b, 'on_hold', p_owner) returning id into batch_id;
  insert into public.quality_issue (batch_id, source) values (batch_id, 'test') returning id into issue_id;
  insert into public.measurement (batch_id, specification_id, value, result, quality_issue_id, measured_by)
  select batch_id, s.id, 97.1, 'out_of_spec', issue_id, p_owner
    from public.specification s where s.product_id = product_b and s.category = 'test' and s.item_name = '순도';
end;
$$;

revoke execute on function private.seed_sample_batches(uuid) from public, anon, authenticated;
