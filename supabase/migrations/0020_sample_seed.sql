-- spec 008 3단계 (plan 008 §3): 예시 검체 기록 9건 (spec 008 FR-008 핵심 자료 표). 모두 가상 자료.
-- 시각은 0018과 같은 기준(어제 17:00 한국 시각)에서 근무 시간에 떨어지게 정하고, 업무 이력도 그 순서대로 넣는다.
-- 되돌리기(replace_sample_data)는 로트를 지우기 전에 검체 기록을 지우고, 예시 로트 뒤에 예시 검체를 다시 넣는다.

-- 전달 한 건 (인수 대기)
create or replace function private.seed_transfer(p_lot text, p_from public.sample_team, p_to public.sample_team,
                                                 p_quantity integer, p_by uuid, p_at timestamptz, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.sample_transfer;
begin
  insert into public.sample_transfer (batch_id, sample_kind, from_team, to_team, quantity, unit, note, sent_by, sent_at)
  values ((select b.id from public.batch b where b.batch_number = p_lot),
          case when p_from = 'production' and p_to = 'qc' then 'test'::public.sample_kind else 'retention'::public.sample_kind end,
          p_from, p_to, p_quantity, '바이알', p_note, p_by, p_at)
  returning * into saved;
  perform private.seed_history(p_by, private.history_action('sample_transfer', 'INSERT', null, to_jsonb(saved)),
                               'sample_transfer', saved.id, saved.batch_id, p_at);
  return saved.id;
end;
$$;

-- 다음 상태로 한 걸음 (인수 확인·반납·반납 확인·소진). 이력 이름은 실제 처리와 같은 함수로 만든다
create or replace function private.seed_transfer_step(p_id uuid, p_status public.sample_status, p_by uuid, p_at timestamptz,
                                                      p_location text default null, p_quantity integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.sample_transfer;
begin
  update public.sample_transfer set
    status = p_status,
    received_by = case when p_status = 'held' then p_by else received_by end,
    received_at = case when p_status = 'held' then p_at else received_at end,
    storage_location = case when p_status = 'held' then p_location else storage_location end,
    returned_quantity = case when p_status = 'return_pending' then p_quantity else returned_quantity end,
    return_requested_by = case when p_status = 'return_pending' then p_by else return_requested_by end,
    return_requested_at = case when p_status = 'return_pending' then p_at else return_requested_at end,
    return_confirmed_by = case when p_status = 'returned' then p_by else return_confirmed_by end,
    returned_at = case when p_status = 'returned' then p_at else returned_at end,
    consumed_by = case when p_status = 'consumed' then p_by else consumed_by end,
    consumed_at = case when p_status = 'consumed' then p_at else consumed_at end
  where id = p_id
  returning * into saved;
  perform private.seed_history(p_by, private.history_action('sample_transfer', 'UPDATE', null, to_jsonb(saved)),
                               'sample_transfer', saved.id, saved.batch_id, p_at);
end;
$$;

-- spec 008 FR-008 핵심 자료 표: 다섯 상태가 모두 있고 QC·QA 각자 확인할 건이 있다
create or replace function private.seed_sample_transfers(p_qa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qa uuid := p_qa;
  qc uuid := coalesce((select id from public.profile where role = 'qc_analyst' order by created_at limit 1), p_qa);
  prod uuid := coalesce((select id from public.profile where role = 'production_operator' order by created_at limit 1), p_qa);
  today0 timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  t0 timestamptz := today0 - interval '7 hours';
  t uuid;
begin
  -- IFV-2610-004 출하 가능: 시험 검체는 시험에 다 씀, 보존 검체는 QA 보관 중
  t := private.seed_transfer('IFV-2610-004', 'production', 'qc', 6, prod, t0 - interval '11 days 7 hours');
  perform private.seed_transfer_step(t, 'held', qc, t0 - interval '11 days 6 hours', 'QC 시험실 냉장고 R-01');
  perform private.seed_transfer_step(t, 'consumed', qc, t0 - interval '10 days 4 hours');
  t := private.seed_transfer('IFV-2610-004', 'production', 'qa', 4, prod, t0 - interval '11 days 7 hours');
  perform private.seed_transfer_step(t, 'held', qa, t0 - interval '11 days 5 hours', '보존검체실 냉장고 R-02 1단');

  -- IFV-2610-003: 시험 검체는 QC 보관 중, 보존 검체는 어제 넘겨 QA 인수 대기 (QA가 확인할 건)
  t := private.seed_transfer('IFV-2610-003', 'production', 'qc', 6, prod, t0 - interval '7 days 7 hours');
  perform private.seed_transfer_step(t, 'held', qc, t0 - interval '7 days 6 hours', 'QC 시험실 냉장고 R-01');
  perform private.seed_transfer('IFV-2610-003', 'production', 'qa', 4, prod, t0 - interval '2 hours');

  -- HBV-2610-002: 보존 검체 보관 중, 재시험용으로 QC에 2 바이알 → 1 바이알 반납 대기 (QA가 확인할 건)
  t := private.seed_transfer('HBV-2610-002', 'production', 'qa', 4, prod, t0 - interval '8 days 7 hours');
  perform private.seed_transfer_step(t, 'held', qa, t0 - interval '8 days 6 hours', '보존검체실 냉장고 R-02 2단');
  t := private.seed_transfer('HBV-2610-002', 'qa', 'qc', 2, qa, t0 - interval '5 days 3 hours', '엔도톡신 재시험용');
  perform private.seed_transfer_step(t, 'held', qc, t0 - interval '5 days 2 hours', 'QC 시험실 냉장고 R-01');
  perform private.seed_transfer_step(t, 'return_pending', qc, t0 - interval '1 hour', null, 1);

  -- HBV-2610-001 보류: 역가 조사용 추가 시험 검체를 오늘 아침 넘김, QC 인수 대기 (QC가 확인할 건)
  perform private.seed_transfer('HBV-2610-001', 'production', 'qc', 6, prod,
                                least(today0 + interval '9 hours 30 minutes', now()), '역가 규격 이탈 조사용 추가 검체');

  -- HBV-2610-003 폐기: 보존 검체 보관 중, 조사용으로 QC에 2 바이알 → 1 바이알 반납 완료
  t := private.seed_transfer('HBV-2610-003', 'production', 'qa', 4, prod, t0 - interval '13 days 7 hours');
  perform private.seed_transfer_step(t, 'held', qa, t0 - interval '13 days 6 hours', '보존검체실 냉장고 R-02 3단');
  t := private.seed_transfer('HBV-2610-003', 'qa', 'qc', 2, qa, t0 - interval '11 days 3 hours', '알루미늄 함량 조사용');
  perform private.seed_transfer_step(t, 'held', qc, t0 - interval '11 days 2 hours', 'QC 시험실 냉장고 R-01');
  perform private.seed_transfer_step(t, 'return_pending', qc, t0 - interval '10 days 3 hours', null, 1);
  perform private.seed_transfer_step(t, 'returned', qa, t0 - interval '10 days 2 hours');
end;
$$;

revoke execute on function private.seed_transfer(text, public.sample_team, public.sample_team, integer, uuid, timestamptz, text),
  private.seed_transfer_step(uuid, public.sample_status, uuid, timestamptz, text, integer),
  private.seed_sample_transfers(uuid) from public, anon, authenticated;

-- 되돌리기: 로트를 지우기 전에 검체 기록을 지우고, 예시 로트 뒤에 예시 검체를 넣는다 (0016처럼 지금 정의에서 그 줄만 바꾼다)
do $reset$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.replace_sample_data(uuid)'::regprocedure);
  if position('sample_transfer' in definition) = 0 then
    definition := replace(definition, E'  delete from public.deviation_review;\n',
                          E'  delete from public.sample_transfer;\n  delete from public.deviation_review;\n');
    definition := replace(definition, E'  perform private.seed_bio_lots(p_qa);\n',
                          E'  perform private.seed_bio_lots(p_qa);\n  perform private.seed_sample_transfers(p_qa);\n');
    if (length(definition) - length(replace(definition, 'sample_transfer', ''))) / length('sample_transfer') <> 2 then
      raise exception 'replace_sample_data에 검체 줄을 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$reset$;

-- 지금 자료에는 예시 검체만 더한다 (로트·이슈·이력은 그대로). 이미 검체 기록이 있으면 건너뛴다
select private.seed_sample_transfers((select id from public.profile where role = 'qa_manager' order by created_at limit 1))
 where not exists (select 1 from public.sample_transfer);
