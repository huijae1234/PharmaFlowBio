-- spec 004 4단계 FR-009: 데이터베이스가 화면에 보내는 문구와 새 업무 이력의 행동 이름을 새 용어로 (GLOSSARY, 전환 D3).
-- 표·필드·함수 이름은 그대로. 이미 남은 업무 이력 글자는 고치지 않는다(고치기 불가 원칙). 자료는 건드리지 않는다.
-- 긴 함수 본문을 다시 옮겨 적지 않으려고, 지금 정의(pg_get_functiondef)에서 문구만 바꿔 다시 만든다.
-- (plan 004는 0014를 가상 백신 예시로 잡았으나 이 문구 변경이 먼저 들어가 예시는 0015)
do $terms$
declare
  target regprocedure;
  definition text;
  pair text[];
  replacements text[][] := array[
    ['배치를 찾을 수 없습니다', '로트를 찾을 수 없습니다'],
    ['출하 판정이 끝난 배치는', '내부 출하 검토가 끝난 로트는'],
    ['배치번호를 입력해', '로트번호를 입력해'],
    ['이미 있는 배치번호입니다', '이미 있는 로트번호입니다'],
    ['이 배치의 제품에 없는', '이 로트의 제품에 없는'],
    ['시험 중인 배치만 출하', '시험 중인 로트만 출하'],
    ['예시 배치를 등록할', '예시 로트를 등록할'],
    ['''배치 등록''', '''로트 등록'''],
    ['''출하 판정''', '''내부 출하 검토'''],
    ['''배치 보류''', '''로트 보류'''],
    ['''배치 상태 변경''', '''로트 상태 변경'''],
    ['''기준값 등록''', '''기준 등록'''],
    ['''기준값 수정''', '''기준 수정''']
  ];
begin
  foreach target in array array[
    'private.lock_editable_batch(uuid)',
    'public.create_batch(text, uuid)',
    'public.record_test_measurement(uuid, uuid, numeric)',
    'public.record_process_conditions(uuid, numeric, public.equipment_status, jsonb)',
    'public.decide_release(uuid, public.batch_status)',
    'private.history_action(text, text, jsonb, jsonb)',
    'private.seed_sample_batches(uuid)'
  ]::regprocedure[] loop
    definition := pg_get_functiondef(target);
    foreach pair slice 1 in array replacements loop
      definition := replace(definition, pair[1], pair[2]);
    end loop;
    if definition ~ '(배치를|배치번호|이 배치|배치만|예시 배치|''배치 |''출하 판정''|''기준값 )' then
      raise exception '옛 용어가 남음: %', target;
    end if;
    execute definition;
  end loop;
end
$terms$;
