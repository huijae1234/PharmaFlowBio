-- spec 005 1단계: 예시 자료 되돌리기가 품질 영향 평가도 지운다 (평가가 품질 이슈를 가리키므로 이슈보다 먼저).
-- 나머지 동작은 0015와 같다. 지금 정의에서 그 한 줄만 더해 다시 만든다 (0014와 같은 방식)
do $reset$
declare
  definition text := pg_get_functiondef('public.reset_sample_data()'::regprocedure);
begin
  if position('delete from public.deviation_review' in definition) = 0 then
    definition := replace(definition, E'  delete from public.measurement;',
                          E'  delete from public.deviation_review;\n  delete from public.measurement;');
    if position('delete from public.deviation_review' in definition) = 0 then
      raise exception 'reset_sample_data에 평가 지우기를 넣지 못했습니다';
    end if;
    execute definition;
  end if;
end
$reset$;
