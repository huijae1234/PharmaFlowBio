-- spec 010 3단계 (plan 010 §3, FR-010): 예시 작업지시. 모두 가상 자료.
-- 예시 로트 8개는 진행 중 작업지시와 잇고(로트를 만든 날 착수), 그 밖에 작성 1·발행 2·취소 1을 둔다.
-- 되돌리기(replace_sample_data)는 로트·제품을 지우기 전에 작업지시를 지우고, 예시 검체 뒤에 예시 작업지시를 다시 넣는다.

-- 번호 매기기 한곳: 계획 시작일 연월 + 그 달 다음 순번 (create_work_order와 같은 규칙, Q61)
create or replace function private.next_work_order_number(p_start date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_key text := to_char(p_start, 'YYMM');
  next_seq integer;
begin
  perform pg_advisory_xact_lock(hashtext('work_order:' || month_key));
  select coalesce(max(substr(w.order_number, 9)::integer), 0) + 1 into next_seq
    from public.work_order w where w.order_number like 'WO-' || month_key || '-%';
  return 'WO-' || month_key || '-' || lpad(next_seq::text, 3, '0');
end;
$$;

-- 예시 한 건. 상태까지 한 걸음씩 시각을 정하고, 업무 이력도 실제 처리와 같은 이름으로 남긴다
create or replace function private.seed_work_order(p_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot public.batch := (select b from public.batch b where b.batch_number = p_input->>'lot');
  status public.work_order_status := (p_input->>'status')::public.work_order_status;
  prod uuid := (p_input->>'prod')::uuid;
  qa uuid := (p_input->>'qa')::uuid;
  created_at timestamptz := (p_input->>'created_at')::timestamptz;
  released_at timestamptz := (p_input->>'released_at')::timestamptz;
  start_day date := (p_input->>'planned_start')::date;
  saved public.work_order;
begin
  if p_input ? 'lot' and (lot.id is null or exists (select 1 from public.work_order w where w.batch_id = lot.id)) then
    return; -- 예시 로트가 없거나 이미 작업지시가 있으면 건너뛴다
  end if;
  insert into public.work_order (order_number, product_id, planned_quantity, unit, planned_start, planned_end, note, status, batch_id,
                                 created_by, created_at, released_by, released_at, started_by, started_at,
                                 cancelled_by, cancelled_at, cancel_reason)
  values (private.next_work_order_number(start_day),
          coalesce(lot.product_id, (select p.id from public.product p where p.item_name = p_input->>'product')),
          (p_input->>'quantity')::numeric, '바이알', start_day, start_day + (p_input->>'days')::integer,
          p_input->>'note', status, lot.id,
          prod, created_at,
          case when status <> 'draft' and released_at is not null then qa end, released_at,
          -- 착수는 로트 등록 바로 뒤 (실제 착수도 로트를 먼저 만든다. 이력 순서가 로트 등록 → 착수)
          case when status = 'in_progress' then prod end, case when status = 'in_progress' then lot.created_at + interval '1 second' end,
          case when status = 'cancelled' then prod end, (p_input->>'cancelled_at')::timestamptz, p_input->>'cancel_reason')
  returning * into saved;

  perform private.seed_history(prod, private.history_action('work_order', 'INSERT', null, to_jsonb(saved)),
                               'work_order', saved.id, null, created_at);
  if released_at is not null then
    perform private.seed_history(qa, private.history_action('work_order', 'UPDATE', null, to_jsonb(saved) || '{"status":"released"}'),
                                 'work_order', saved.id, null, released_at);
  end if;
  if status = 'in_progress' then
    perform private.seed_history(prod, private.history_action('work_order', 'UPDATE', null, to_jsonb(saved)),
                                 'work_order', saved.id, lot.id, saved.started_at);
  elsif status = 'cancelled' then
    perform private.seed_history(prod, private.history_action('work_order', 'UPDATE', null, to_jsonb(saved)),
                                 'work_order', saved.id, null, saved.cancelled_at);
  end if;
end;
$$;

-- spec 010 FR-010: 진행 중 8(예시 로트마다)·작성 1·발행 2·취소 1
create or replace function private.seed_work_orders(p_qa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qa uuid := p_qa;
  prod uuid := coalesce((select id from public.profile where role = 'production_operator' order by created_at limit 1), p_qa);
  today0 timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  lot record;
  base jsonb;
begin
  -- 예시 로트: 로트를 만든 날 착수. 이틀 전 오전에 작성, 하루 전 오전에 발행
  for lot in
    select b.batch_number, b.created_at, p.item_name from public.batch b join public.product p on p.id = b.product_id
     where b.batch_number in ('IFV-2610-001', 'IFV-2610-002', 'IFV-2610-003', 'IFV-2610-004',
                              'HBV-2610-001', 'HBV-2610-002', 'HBV-2610-003', 'TDP-2610-001')
     order by b.created_at
  loop
    perform private.seed_work_order(jsonb_build_object(
      'lot', lot.batch_number, 'status', 'in_progress', 'prod', prod, 'qa', qa,
      'quantity', case when lot.batch_number like 'IFV%' then 5000 when lot.batch_number like 'HBV%' then 3000 else 2000 end,
      'planned_start', (lot.created_at at time zone 'Asia/Seoul')::date, 'days', 4,
      'created_at', date_trunc('day', lot.created_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' - interval '2 days' + interval '10 hours',
      'released_at', date_trunc('day', lot.created_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' - interval '1 day' + interval '9 hours 30 minutes',
      'note', '예시 (교육용)'));
  end loop;

  -- 로트가 없는 예시는 한 번만 넣는다 (메모 '예시 (교육용)'으로 알아본다)
  if exists (select 1 from public.work_order w where w.batch_id is null and w.note like '예시 (교육용)%') then
    return;
  end if;
  base := jsonb_build_object('prod', prod, 'qa', qa, 'days', 4);
  -- 발행 2: 다음 주 생산 (생산 담당자가 착수할 것)
  perform private.seed_work_order(base || jsonb_build_object('status', 'released', 'product', '인플루엔자 4가 백신 프리필드주 (가상)',
    'quantity', 5000, 'planned_start', ((today0 + interval '5 days') at time zone 'Asia/Seoul')::date,
    'created_at', today0 - interval '2 days' + interval '10 hours', 'released_at', today0 - interval '1 day' + interval '9 hours 30 minutes',
    'note', '예시 (교육용) · 다음 주 생산'));
  perform private.seed_work_order(base || jsonb_build_object('status', 'released', 'product', 'Tdap 혼합 백신 주 (가상)',
    'quantity', 2000, 'planned_start', ((today0 + interval '8 days') at time zone 'Asia/Seoul')::date,
    'created_at', today0 - interval '2 days' + interval '11 hours', 'released_at', today0 - interval '1 day' + interval '10 hours',
    'note', '예시 (교육용)'));
  -- 취소 1: 수량을 잘못 적어 착수 전에 취소
  perform private.seed_work_order(base || jsonb_build_object('status', 'cancelled', 'product', 'B형간염 백신 주 (가상)',
    'quantity', 30000, 'planned_start', ((today0 + interval '12 days') at time zone 'Asia/Seoul')::date,
    'created_at', today0 - interval '1 day' + interval '15 hours', 'cancelled_at', today0 - interval '1 day' + interval '15 hours 20 minutes',
    'note', '예시 (교육용)', 'cancel_reason', '수량 오기 (30,000 → 3,000). 다시 작성함'));
  -- 작성 1: QA 관리자가 발행할 것
  perform private.seed_work_order(base || jsonb_build_object('status', 'draft', 'product', 'B형간염 백신 주 (가상)',
    'quantity', 3000, 'planned_start', ((today0 + interval '12 days') at time zone 'Asia/Seoul')::date,
    'created_at', least(today0 + interval '9 hours 10 minutes', now()), 'note', '예시 (교육용) · 발행 대기'));
end;
$$;

revoke execute on function private.next_work_order_number(date), private.seed_work_order(jsonb), private.seed_work_orders(uuid)
  from public, anon, authenticated;

-- 되돌리기: 로트·제품을 지우기 전에 작업지시를 지우고, 예시 검체 뒤에 예시 작업지시를 넣는다 (0020처럼 그 줄만 바꾼다)
do $reset$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.replace_sample_data(uuid)'::regprocedure);
  if position('work_order' in definition) = 0 then
    definition := replace(definition, E'  delete from public.sample_transfer;\n',
                          E'  delete from public.work_order;\n  delete from public.sample_transfer;\n');
    definition := replace(definition, E'  perform private.seed_sample_transfers(p_qa);\n',
                          E'  perform private.seed_sample_transfers(p_qa);\n  perform private.seed_work_orders(p_qa);\n');
    if (length(definition) - length(replace(definition, 'work_order', ''))) / length('work_order') <> 2 then
      raise exception 'replace_sample_data에 작업지시 줄을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$reset$;

-- 지금 자료에는 예시 작업지시만 더한다 (로트·이슈·검체·이력은 그대로, 사용자가 만든 작업지시도 그대로)
select private.seed_work_orders((select id from public.profile where role = 'qa_manager' order by created_at limit 1));
