-- 번호 바꿈: GE 브랜치에서 0033으로 만들었으나 main의 0033_sample_disposed와 겹쳐 0035로 (2026-10-28 main 병합). 2026-10-28 실제 DB에 적용함(사용자 승인)
-- 내부 출하 검토 사유 (UI 개편, 사용자 요청 2026-10-28): 폐기를 고를 때 사유를 적고, 로트에 남긴다.
-- 되돌릴 수 없는 결정에 이유가 없다는 20년차 QA 시점 점검(2026-10-28)의 지적을 반영.
--
-- 바뀌는 것
--  1. public.batch.release_reason (text, 1~200자, 없을 수 있음): 내부 출하 검토 사유. 폐기는 필수, 출하 가능은 선택
--  2. public.decide_release(p_batch_id, p_decision)를 p_reason을 더 받는 함수로 바꾼다 (p_reason은 기본값 null)
--     - 폐기인데 사유가 비면 "폐기 사유를 적어 주세요."로 거부, 200자를 넘으면 거부
--     - 그 밖의 검사와 문구는 0013·0014(새 용어) 그대로
--  3. 업무 이력은 batch 행이 바뀔 때 트리거가 남기므로 사유가 after_data에 같이 남는다 (이력 자체는 고치지 않음)
--
-- 이전 화면 호환: 예전 화면은 decide_release를 p_batch_id, p_decision 둘만 불러도 그대로 동작한다 (p_reason 기본값).
-- 적용 방법: Supabase SQL Editor에서 이 파일 전체를 실행. 실행 전 사람이 확인할 것 (공유 데이터베이스).
-- 되돌리기: 아래 "되돌리기" 블록 참고

alter table public.batch
  add column if not exists release_reason text
  check (release_reason is null or char_length(release_reason) between 1 and 200);

-- 같은 이름의 예전 함수(인자 2개)를 지우고 새로 만든다. 둘 다 두면 인자 2개 호출이 모호해진다
drop function if exists public.decide_release(uuid, public.batch_status);

create or replace function public.decide_release(p_batch_id uuid, p_decision public.batch_status, p_reason text default null)
returns public.batch
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.batch;
  open_issues int;
  unfinished text;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.require_role(array['qa_manager']::public.user_role[], 'QA 관리자');
  if p_decision is null or p_decision not in ('releasable', 'discarded') then
    raise exception '출하 가능 또는 폐기를 골라 주세요.';
  end if;
  -- 잠긴 로트(검토 끝남·출하 완료)는 사유보다 먼저 그 이유로 막는다 (main 병합 때 순서 바꿈)
  target := private.lock_editable_batch(p_batch_id);
  if reason is not null and char_length(reason) > 200 then
    raise exception '사유는 200자까지 쓸 수 있습니다.';
  end if;
  if p_decision = 'discarded' and reason is null then
    raise exception '폐기 사유를 적어 주세요.';
  end if;

  if p_decision = 'releasable' then
    select count(*) into open_issues from public.quality_issue where batch_id = target.id and status = 'open';
    if open_issues > 0 then
      raise exception '처리 중인 품질 이슈가 %건 있어 출하할 수 없습니다.', open_issues; -- 0018 새 용어 유지 (0035로 옮길 때 고침)
    end if;
    if not (target.status = 'in_testing' or (target.status = 'on_hold' and target.hold_reason is not null)) then
      raise exception '시험 중인 로트만 출하할 수 있습니다.';
    end if;
    select string_agg(s.item_name, ', ' order by s.item_name) into unfinished
      from public.specification s
     where s.product_id = target.product_id and s.category = 'test'
       and coalesce((select m.result from public.measurement m
                      where m.batch_id = target.id and m.specification_id = s.id
                      order by m.measured_at desc limit 1), 'out_of_spec') not in ('pass', 'out_of_alert');
    if unfinished is not null then
      raise exception '시험이 끝나지 않은 항목이 있습니다: %', unfinished;
    end if;
  end if;

  update public.batch set status = p_decision, release_reason = reason where id = target.id returning * into target;
  return target;
end;
$$;

revoke execute on function public.decide_release(uuid, public.batch_status, text) from public, anon;
grant execute on function public.decide_release(uuid, public.batch_status, text) to authenticated;

-- 되돌리기 (필요하면 따로 실행):
--   drop function if exists public.decide_release(uuid, public.batch_status, text);
--   0013·0014 정의로 decide_release(uuid, public.batch_status)를 다시 만들고 grant,
--   alter table public.batch drop column if exists release_reason;
