-- spec 007 FR-004: 현실감 있는 가상 백신 예시 (제품 3개, 로트 8개). FR-005: 데이터베이스 문구 "처리 중·종결".
-- 표 구조는 바꾸지 않는다. 예시는 업무 규칙(판정·보류·종결 조건·내부 출하 검토)을 지킨 상태로 넣고,
-- 업무 이력은 그 상태에 이르는 순서대로 사람·시각을 정해 넣는다(트리거는 넣는 동안 멈춤, 0011과 같은 표시).
-- Q41: 기존 예시·확인용 로트 자료는 새 예시로 바뀐다. 업무 이력은 지우지 않고 로트 연결만 비운다(로트번호 글자는 남음).
-- Q42: 허가정보로 등록한 제품(permit_item_code 있음)은 남긴다. 사용자·역할·사용 기록은 건드리지 않는다.

-- 업무 이력 한 줄 (사람·시각을 정해서)
create or replace function private.seed_history(p_actor uuid, p_action text, p_table text, p_target uuid, p_batch uuid, p_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.work_history (actor_id, actor_name, actor_role, action, target_table, target_id, batch_id, batch_number, created_at)
  select p.id, p.display_name, p.role::text, p_action, p_table, p_target, p_batch,
         (select b.batch_number from public.batch b where b.id = p_batch), p_at
    from public.profile p where p.id = p_actor;
$$;

-- 측정값 한 줄: 그때 기준으로 판정하고 기준을 함께 저장한다 (spec 004 FR-004)
create or replace function private.seed_value(p_batch uuid, p_category public.spec_category, p_item text, p_value numeric,
                                              p_by uuid, p_at timestamptz, p_issue uuid default null,
                                              p_record uuid default null, p_action uuid default null)
returns public.measurement_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  spec public.specification;
  verdict public.measurement_result;
  new_id uuid;
begin
  select s.* into spec from public.specification s join public.batch b on b.product_id = s.product_id
   where b.id = p_batch and s.category = p_category and s.item_name = p_item;
  verdict := private.judge(p_value, spec);
  insert into public.measurement (batch_id, specification_id, value, result, process_record_id, quality_issue_id, action_request_id,
                                  measured_by, measured_at, applied_min_value, applied_max_value,
                                  applied_alert_min_value, applied_alert_max_value, applied_spec_version)
  values (p_batch, spec.id, p_value, verdict, p_record, p_issue, p_action, p_by, p_at,
          spec.min_value, spec.max_value, spec.alert_min_value, spec.alert_max_value, spec.version)
  returning id into new_id;
  perform private.seed_history(p_by, case when p_action is null then '측정값 입력' else '재시험 측정값 입력' end,
                               'measurement', new_id, p_batch, p_at);
  return verdict;
end;
$$;

-- 로트 하나 등록 (생산 담당자)
create or replace function private.seed_lot(p_number text, p_product text, p_by uuid, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot uuid;
begin
  insert into public.batch (batch_number, product_id, created_by, created_at)
  values (p_number, (select p.id from public.product p where p.item_name = p_product), p_by, p_at)
  returning id into lot;
  perform private.seed_history(p_by, '로트 등록', 'batch', lot, lot, p_at);
  return lot;
end;
$$;

-- 공정 조건 기록 + 시험 중으로 (생산 담당자). 값 배열은 [항목, 값] 쌍
create or replace function private.seed_process(p_lot uuid, p_values text[][], p_by uuid, p_at timestamptz, p_issue uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec uuid;
  pair text[];
begin
  insert into public.process_record (batch_id, production_quantity, equipment_status, recorded_by, recorded_at)
  values (p_lot, 12000, 'normal', p_by, p_at) returning id into rec;
  perform private.seed_history(p_by, '공정 조건 입력', 'process_record', rec, p_lot, p_at);
  foreach pair slice 1 in array p_values loop
    perform private.seed_value(p_lot, 'process', pair[1], pair[2]::numeric, p_by, p_at, p_issue, rec);
  end loop;
  update public.batch set status = 'in_testing' where id = p_lot and status = 'in_production';
  perform private.seed_history(p_by, '로트 상태 변경', 'batch', p_lot, p_lot, p_at);
  return rec;
end;
$$;

-- 제품 3개와 기준(v1, 모두 사내 관리기준 있음). spec 007 핵심 자료 표
create or replace function private.seed_bio_products()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid;
begin
  insert into public.product (item_name, main_ingredient, manufacturer)
  values ('인플루엔자 4가 백신 프리필드주 (가상)', '교육용 가상 항원 (A/H1N1·A/H3N2·B/Victoria·B/Yamagata 헤마글루티닌)', '가상바이오(주) (교육용)')
  returning id into pid;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value, alert_min_value, alert_max_value) values
    (pid, 'test', '역가', '%', 80, 125, 90, 115),
    (pid, 'test', '엔도톡신', 'EU/mL', 0, 10, 0, 5),
    (pid, 'test', 'pH', null, 6.8, 7.6, 7.0, 7.4),
    (pid, 'process', '배양 온도', '℃', 35, 38, 35.5, 37.5),
    (pid, 'process', '보관 온도', '℃', 2, 8, 3, 7);

  insert into public.product (item_name, main_ingredient, manufacturer)
  values ('B형간염 백신 주 (가상)', '교육용 가상 항원 (B형간염 표면항원, 알루미늄 보조제)', '가상바이오(주) (교육용)')
  returning id into pid;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value, alert_min_value, alert_max_value) values
    (pid, 'test', '역가', '%', 80, 125, 90, 115),
    (pid, 'test', '엔도톡신', 'EU/mL', 0, 5, 0, 2.5),
    (pid, 'test', 'pH', null, 6.5, 7.5, 6.8, 7.2),
    (pid, 'test', '알루미늄 함량', 'mg/mL', 0.40, 0.62, 0.45, 0.58),
    (pid, 'process', '발효 온도', '℃', 28, 32, 29, 31),
    (pid, 'process', '보관 온도', '℃', 2, 8, 3, 7);

  insert into public.product (item_name, main_ingredient, manufacturer)
  values ('Tdap 혼합 백신 주 (가상)', '교육용 가상 항원 (파상풍·디프테리아 톡소이드, 백일해 항원)', '가상바이오(주) (교육용)')
  returning id into pid;
  insert into public.specification (product_id, category, item_name, unit, min_value, max_value, alert_min_value, alert_max_value) values
    (pid, 'test', '역가', '%', 80, 125, 90, 115),
    (pid, 'test', '엔도톡신', 'EU/mL', 0, 10, 0, 5),
    (pid, 'test', 'pH', null, 6.0, 7.0, 6.2, 6.8),
    (pid, 'process', '보관 온도', '℃', 2, 8, 3, 7);
end;
$$;

-- 로트 8개. 시각은 지금부터 거꾸로 며칠·몇 시간 전으로 순서대로
create or replace function private.seed_bio_lots(p_qa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qa uuid := p_qa;
  qc uuid := coalesce((select id from public.profile where role = 'qc_analyst' order by created_at limit 1), p_qa);
  prod uuid := coalesce((select id from public.profile where role = 'production_operator' order by created_at limit 1), p_qa);
  -- 근무 시간처럼 보이게: 기준은 어제 17:00(한국 시각). 아래 "며칠 몇 시간 전"이 대부분 10~15시에 떨어진다
  today0 timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  t0 timestamptz := today0 - interval '7 hours';
  -- TDP-2610-001은 오늘 아침 일(대시보드 "이번 주 규격 이탈"), 지금보다 늦지 않게
  td timestamptz := least(today0 + interval '11 hours', now());
  flu text := '인플루엔자 4가 백신 프리필드주 (가상)';
  hbv text := 'B형간염 백신 주 (가상)';
  tdp text := 'Tdap 혼합 백신 주 (가상)';
  lot uuid;
  rec uuid;
  issue uuid;
  review uuid;
  req uuid;
begin
  -- IFV-2610-001 생산 중: 공정 조건 입력 전
  perform private.seed_lot('IFV-2610-001', flu, prod, t0 - interval '1 day 3 hours');

  -- IFV-2610-002 시험 중: pH·엔도톡신 정상, 역가는 비워 둠 (시연에서 85 입력 → 관리기준 이탈)
  lot := private.seed_lot('IFV-2610-002', flu, prod, t0 - interval '6 days');
  perform private.seed_process(lot, array[['배양 온도', '36.8'], ['보관 온도', '4.9']], prod, t0 - interval '5 days 2 hours');
  perform private.seed_value(lot, 'test', 'pH', 7.2, qc, t0 - interval '3 days 4 hours');
  perform private.seed_value(lot, 'test', '엔도톡신', 1.8, qc, t0 - interval '3 days 3 hours');

  -- IFV-2610-003 시험 중: 시험 모두 정상 → 내부 출하 검토 대기
  lot := private.seed_lot('IFV-2610-003', flu, prod, t0 - interval '9 days');
  perform private.seed_process(lot, array[['배양 온도', '36.9'], ['보관 온도', '5.1']], prod, t0 - interval '8 days 5 hours');
  perform private.seed_value(lot, 'test', '역가', 102, qc, t0 - interval '6 days 6 hours');
  perform private.seed_value(lot, 'test', '엔도톡신', 2.2, qc, t0 - interval '6 days 5 hours');
  perform private.seed_value(lot, 'test', 'pH', 7.2, qc, t0 - interval '6 days 5 hours');

  -- IFV-2610-004 출하 가능: 내부 출하 검토까지
  lot := private.seed_lot('IFV-2610-004', flu, prod, t0 - interval '13 days');
  perform private.seed_process(lot, array[['배양 온도', '37.0'], ['보관 온도', '4.4']], prod, t0 - interval '12 days 4 hours');
  perform private.seed_value(lot, 'test', '역가', 98, qc, t0 - interval '10 days 6 hours');
  perform private.seed_value(lot, 'test', '엔도톡신', 1.5, qc, t0 - interval '10 days 5 hours');
  perform private.seed_value(lot, 'test', 'pH', 7.1, qc, t0 - interval '10 days 5 hours');
  update public.batch set status = 'releasable' where id = lot;
  perform private.seed_history(qa, '내부 출하 검토', 'batch', lot, lot, t0 - interval '8 days 3 hours');

  -- HBV-2610-001 보류: 역가 76 규격 이탈, 품질 영향 평가 제출됨(QA 검토 대기)
  lot := private.seed_lot('HBV-2610-001', hbv, prod, t0 - interval '8 days');
  perform private.seed_process(lot, array[['발효 온도', '30.1'], ['보관 온도', '4.6']], prod, t0 - interval '7 days 3 hours');
  perform private.seed_value(lot, 'test', '엔도톡신', 1.2, qc, t0 - interval '4 days 6 hours');
  perform private.seed_value(lot, 'test', 'pH', 7.0, qc, t0 - interval '4 days 6 hours');
  perform private.seed_value(lot, 'test', '알루미늄 함량', 0.52, qc, t0 - interval '4 days 5 hours');
  insert into public.quality_issue (batch_id, source, kind, opened_at) values (lot, 'test', 'spec', t0 - interval '4 days 4 hours')
  returning id into issue;
  perform private.seed_value(lot, 'test', '역가', 76, qc, t0 - interval '4 days 4 hours', issue);
  perform private.seed_history(qc, '품질 이슈 생성', 'quality_issue', issue, lot, t0 - interval '4 days 4 hours');
  update public.batch set status = 'on_hold' where id = lot;
  perform private.seed_history(qc, '로트 상태 변경', 'batch', lot, lot, t0 - interval '4 days 4 hours');
  insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action, evidence,
                                       requested_by, requested_at)
  values (issue, 'submitted', '역가 76%로 시험 규격(80~125%) 아래',
          '항원 흡착 공정의 교반 시간 부족으로 표면항원 결합률이 낮았을 가능성',
          '역가 미달 상태로는 면역원성을 보증할 수 없어 그대로 사용할 수 없음. 같은 기간 다른 로트는 정상',
          '흡착 공정 기록 확인 후 재시험, 재시험도 미달이면 로트 폐기 건의',
          'QC 시험 기록 QC-2610-118, 흡착 공정 기록 BR-HBV-2610-001', qc, t0 - interval '2 days 5 hours')
  returning id into review;
  perform private.seed_history(qc, '품질 영향 평가 검토 요청', 'deviation_review', review, lot, t0 - interval '2 days 5 hours');

  -- HBV-2610-002 시험 중: 엔도톡신 3.1 관리기준 이탈, 평가 승인, 재시험 조치 승인·배정(결과 입력 대기)
  lot := private.seed_lot('HBV-2610-002', hbv, prod, t0 - interval '10 days');
  perform private.seed_process(lot, array[['발효 온도', '29.6'], ['보관 온도', '4.2']], prod, t0 - interval '9 days 2 hours');
  perform private.seed_value(lot, 'test', '역가', 101, qc, t0 - interval '7 days 6 hours');
  perform private.seed_value(lot, 'test', 'pH', 7.0, qc, t0 - interval '7 days 6 hours');
  perform private.seed_value(lot, 'test', '알루미늄 함량', 0.50, qc, t0 - interval '7 days 5 hours');
  insert into public.quality_issue (batch_id, source, kind, opened_at) values (lot, 'test', 'alert', t0 - interval '7 days 4 hours')
  returning id into issue;
  perform private.seed_value(lot, 'test', '엔도톡신', 3.1, qc, t0 - interval '7 days 4 hours', issue);
  perform private.seed_history(qc, '품질 이슈 생성', 'quality_issue', issue, lot, t0 - interval '7 days 4 hours');
  insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action, evidence,
                                       requested_by, requested_at, reviewed_by, reviewed_at, review_comment)
  values (issue, 'approved', '엔도톡신 3.1 EU/mL로 사내 관리기준(2.5) 초과, 시험 규격(5) 안',
          '시료 채취 용기 세척 편차로 인한 외부 오염 가능성',
          '규격 안이라 안전성 영향은 낮으나 원인 확인 전에는 출하 검토하지 않음',
          '새 시료로 엔도톡신 재시험',
          'QC 시험 기록 QC-2610-104, 시료 채취 기록', qc, t0 - interval '6 days 3 hours',
          qa, t0 - interval '5 days 6 hours', '재시험으로 확인하는 것에 동의합니다.')
  returning id into review;
  perform private.seed_history(qc, '품질 영향 평가 검토 요청', 'deviation_review', review, lot, t0 - interval '6 days 3 hours');
  perform private.seed_history(qa, '품질 영향 평가 승인', 'deviation_review', review, lot, t0 - interval '5 days 6 hours');
  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by, requested_at,
                                     assignee_id, reviewed_by, reviewed_at)
  values (issue, 'retest', '새 시료로 엔도톡신(LAL) 재시험', 'approved', qc, t0 - interval '5 days 4 hours',
          qc, qa, t0 - interval '4 days 7 hours')
  returning id into req;
  perform private.seed_history(qc, '조치 요청 등록', 'action_request', req, lot, t0 - interval '5 days 4 hours');
  perform private.seed_history(qa, '조치 요청 승인', 'action_request', req, lot, t0 - interval '4 days 7 hours');

  -- HBV-2610-003 폐기: 알루미늄 함량 0.70 규격 이탈 → 평가 승인 → 원료 확인 완료 → 이슈 종결 → 폐기
  lot := private.seed_lot('HBV-2610-003', hbv, prod, t0 - interval '14 days');
  perform private.seed_process(lot, array[['발효 온도', '30.4'], ['보관 온도', '5.0']], prod, t0 - interval '13 days 3 hours');
  perform private.seed_value(lot, 'test', '역가', 99, qc, t0 - interval '12 days 6 hours');
  perform private.seed_value(lot, 'test', '엔도톡신', 1.0, qc, t0 - interval '12 days 6 hours');
  perform private.seed_value(lot, 'test', 'pH', 7.1, qc, t0 - interval '12 days 5 hours');
  insert into public.quality_issue (batch_id, source, kind, opened_at, status, closed_by, closed_at)
  values (lot, 'test', 'spec', t0 - interval '12 days 4 hours', 'closed', qa, t0 - interval '8 days 6 hours')
  returning id into issue;
  perform private.seed_value(lot, 'test', '알루미늄 함량', 0.70, qc, t0 - interval '12 days 4 hours', issue);
  perform private.seed_history(qc, '품질 이슈 생성', 'quality_issue', issue, lot, t0 - interval '12 days 4 hours');
  perform private.seed_history(qc, '로트 상태 변경', 'batch', lot, lot, t0 - interval '12 days 4 hours');
  insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action, evidence,
                                       requested_by, requested_at, reviewed_by, reviewed_at, review_comment)
  values (issue, 'approved', '알루미늄 함량 0.70 mg/mL로 시험 규격(0.40~0.62) 초과',
          '보조제 원료 로트의 함량 편차 가능성',
          '보조제 과다는 국소 반응 증가 위험이 있어 그대로 사용할 수 없음',
          '보조제 원료 확인, 원인이 원료면 로트 폐기 건의',
          'QC 시험 기록 QC-2610-091, 원료 시험 성적서', qc, t0 - interval '11 days 5 hours',
          qa, t0 - interval '10 days 6 hours', '원료 확인을 먼저 진행해 주세요.')
  returning id into review;
  perform private.seed_history(qc, '품질 영향 평가 검토 요청', 'deviation_review', review, lot, t0 - interval '11 days 5 hours');
  perform private.seed_history(qa, '품질 영향 평가 승인', 'deviation_review', review, lot, t0 - interval '10 days 6 hours');
  insert into public.action_request (quality_issue_id, action_type, description, status, requested_by, requested_at,
                                     assignee_id, reviewed_by, reviewed_at, result_note, completed_at)
  values (issue, 'material_check', '알루미늄 보조제 원료 로트 함량 확인', 'completed', qc, t0 - interval '10 days 4 hours',
          prod, qa, t0 - interval '10 days 2 hours',
          '보조제 원료 로트 AL-0915 함량이 공급사 성적서보다 높음을 확인. 같은 원료를 쓴 로트는 이 로트뿐', t0 - interval '9 days 5 hours')
  returning id into req;
  perform private.seed_history(qc, '조치 요청 등록', 'action_request', req, lot, t0 - interval '10 days 4 hours');
  perform private.seed_history(qa, '조치 요청 승인', 'action_request', req, lot, t0 - interval '10 days 2 hours');
  perform private.seed_history(prod, '조치 완료', 'action_request', req, lot, t0 - interval '9 days 5 hours');
  perform private.seed_history(qa, '품질 이슈 종결', 'quality_issue', issue, lot, t0 - interval '8 days 6 hours');
  perform private.seed_history(qa, '로트 상태 변경', 'batch', lot, lot, t0 - interval '8 days 6 hours');
  update public.batch set status = 'discarded' where id = lot;
  perform private.seed_history(qa, '내부 출하 검토', 'batch', lot, lot, t0 - interval '8 days 4 hours');

  -- TDP-2610-001 보류: 보관 온도 9.2 공정 규격 이탈(넣는 날 오전), 평가 보완 요청됨(작성자 다시 제출 대기)
  lot := private.seed_lot('TDP-2610-001', tdp, prod, t0 - interval '5 days');
  insert into public.quality_issue (batch_id, source, kind, opened_at) values (lot, 'process', 'spec', td - interval '2 hours 20 minutes')
  returning id into issue;
  rec := private.seed_process(lot, array[['보관 온도', '9.2']], prod, td - interval '2 hours 20 minutes', issue);
  update public.quality_issue set process_record_id = rec where id = issue;
  perform private.seed_history(prod, '품질 이슈 생성', 'quality_issue', issue, lot, td - interval '2 hours 20 minutes');
  update public.batch set status = 'on_hold' where id = lot;
  insert into public.deviation_review (quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action, evidence,
                                       requested_by, requested_at, reviewed_by, reviewed_at, review_comment)
  values (issue, 'revision_requested', '완제품 보관 온도 9.2℃로 규격(2~8℃) 초과',
          '냉장고 문 개방 시간 증가 추정',
          '단시간 이탈이면 품질 영향이 작을 것으로 봄',
          '안정성 자료 검토 후 판단',
          '보관 온도 기록', prod, td - interval '50 minutes',
          qa, td - interval '5 minutes', '온도 기록계 원본과 이탈이 이어진 시간을 근거에 더해 주세요.')
  returning id into review;
  perform private.seed_history(prod, '품질 영향 평가 검토 요청', 'deviation_review', review, lot, td - interval '50 minutes');
  perform private.seed_history(qa, '품질 영향 평가 보완 요청', 'deviation_review', review, lot, td - interval '5 minutes');
end;
$$;

-- 기존 예시를 지우고 새 예시를 넣는다 (되돌리기와 이 마이그레이션이 같이 쓴다)
create or replace function private.replace_sample_data(p_qa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('pharmaflow.resetting', 'on', true);

  -- Q27·Q41: 업무 이력은 지우지 않는다. 지울 로트와의 연결만 비운다(로트번호 글자는 남아 있다)
  alter table public.work_history disable trigger reject_change;
  update public.work_history set batch_id = null where batch_id is not null;
  alter table public.work_history enable trigger reject_change;

  delete from public.deviation_review;
  delete from public.measurement;
  delete from public.action_request;
  delete from public.quality_issue;
  delete from public.process_record;
  delete from public.batch;
  delete from public.handling_check;
  -- Q42: 허가정보로 등록한 제품과 그 기준은 남긴다
  delete from public.specification s using public.product p where s.product_id = p.id and p.permit_item_code is null;
  delete from public.product where permit_item_code is null;

  perform private.seed_bio_products();
  perform private.seed_bio_lots(p_qa);

  perform set_config('pharmaflow.resetting', 'off', true);
end;
$$;

-- 되돌리기(QA 관리자): 화면 메뉴는 없앴고(spec 007 FR-003) 개발자가 SQL로 부를 때 쓴다
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
  perform private.replace_sample_data(me.id);
  insert into public.work_history (actor_id, actor_name, actor_role, action, target_table, target_id)
  values (me.id, me.display_name, me.role::text, '예시 자료 되돌리기', 'sample_data', me.id);
  select count(*) into batch_count from public.batch;
  return jsonb_build_object('batches', batch_count);
end;
$$;

revoke execute on function private.seed_history(uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.seed_value(uuid, public.spec_category, text, numeric, uuid, timestamptz, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.seed_lot(text, text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.seed_process(uuid, text[], uuid, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function private.seed_bio_products() from public, anon, authenticated;
revoke execute on function private.seed_bio_lots(uuid) from public, anon, authenticated;
revoke execute on function private.replace_sample_data(uuid) from public, anon, authenticated;

-- spec 007 FR-005: 데이터베이스가 화면에 보내는 문구와 새 업무 이력 이름 "처리 중·종결" (0014와 같은 방식).
-- 이미 남은 업무 이력 글자("품질 이슈 닫기")는 고치지 않는다
do $terms$
declare
  target regprocedure;
  definition text;
  pair text[];
  replacements text[][] := array[
    ['닫을 수 없습니다', '종결할 수 없습니다'],
    ['닫힌 품질 이슈', '종결된 품질 이슈'],
    ['열린 품질 이슈가', '처리 중인 품질 이슈가'],
    ['''품질 이슈 닫기''', '''품질 이슈 종결''']
  ];
begin
  foreach target in array array[
    'private.history_action(text, text, jsonb, jsonb)',
    'public.submit_action_request(uuid, public.action_type, text)',
    'public.resubmit_action_request(uuid, public.action_type, text)',
    'public.close_quality_issue(uuid)',
    'public.decide_release(uuid, public.batch_status)',
    'private.lock_open_issue(uuid)'
  ]::regprocedure[] loop
    definition := pg_get_functiondef(target);
    foreach pair slice 1 in array replacements loop
      definition := replace(definition, pair[1], pair[2]);
    end loop;
    if definition ~ '''[^''\n]*(닫을|닫힌|열린 품질|이슈 닫기)[^''\n]*''' then
      raise exception '옛 문구가 남음: %', target;
    end if;
    execute definition;
  end loop;
end
$terms$;

-- 지금 자료를 한 번 바꾼다. 첫 QA 관리자를 담당자로
select private.replace_sample_data((select id from public.profile where role = 'qa_manager' order by created_at limit 1));
