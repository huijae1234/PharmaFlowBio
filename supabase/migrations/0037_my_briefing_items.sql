-- spec 025 v0.5 8단계: AI 도우미가 홈 3개(관리자 대시보드·품질시험 홈·제조공정 홈)에서 함께 볼 "오늘 내 일" 근거 표.
-- 아침 브리핑(0036 morning_briefing_items)과 같은 항목·같은 범위를, 로그인한 사람이 **자기 것만** 읽게 한다.
-- 인자를 받지 않는다: 남의 id를 넣을 길이 없고, auth.uid()로만 정한다. 읽기만 한다(stable).
--
-- 적용 방법: Supabase SQL Editor에서 이 파일 전체를 실행 (공유 데이터베이스: 적용 전 사람이 확인)
-- 되돌리기: drop function if exists public.my_briefing_items();

create or replace function public.my_briefing_items()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.morning_briefing_items(auth.uid());
$$;

revoke execute on function public.my_briefing_items() from public, anon;
grant execute on function public.my_briefing_items() to authenticated;
