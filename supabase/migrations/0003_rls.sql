-- FR-006 (spec 001), ERD 권한 요약, ADR 0002.
-- 읽기: 로그인한 사람(열람자 포함). 쓰기: 표에 직접 못 쓰고 0004의 함수로만 (함수 안에서 역할 확인).
-- 로그인하지 않은 사람(anon)은 아무것도 못 읽는다.

create or replace function private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profile where id = auth.uid()
$$;

grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.current_user_role() to authenticated;

alter table public.profile enable row level security;
alter table public.product enable row level security;
alter table public.specification enable row level security;
alter table public.batch enable row level security;
alter table public.process_record enable row level security;
alter table public.quality_issue enable row level security;
alter table public.action_request enable row level security;
alter table public.measurement enable row level security;
alter table public.handling_check enable row level security;
alter table public.work_history enable row level security;
alter table public.usage_log enable row level security;

-- 표 권한: anon은 전부 회수, authenticated는 읽기만 (usage_log만 본인 기록 추가)
revoke all on all tables in schema public from anon, authenticated;
grant select on public.product, public.specification, public.batch, public.process_record,
  public.quality_issue, public.action_request, public.measurement, public.handling_check,
  public.work_history to authenticated;
-- 이메일은 QA 관리자만 (public.list_users 함수로). 다른 칸만 읽기 허용
grant select (id, display_name, role, created_at) on public.profile to authenticated;
grant select, insert on public.usage_log to authenticated;

-- 앞으로 만드는 표·함수도 기본으로 닫아 둔다
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

create policy "로그인한 사람은 읽기" on public.profile for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.product for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.specification for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.batch for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.process_record for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.quality_issue for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.action_request for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.measurement for select to authenticated using (true);
create policy "로그인한 사람은 읽기" on public.handling_check for select to authenticated using (true);

-- 업무 이력: 배치에 딸린 이력은 모두, 전체(역할 지정 등)는 QA 관리자만 (ERD 권한 요약)
create policy "배치 이력은 모두, 전체는 QA 관리자" on public.work_history for select to authenticated
  using (batch_id is not null or (select private.current_user_role()) = 'qa_manager');

-- 사용 기록: QA 관리자만 읽고, 본인 기록만 추가 (FR-023, 화면은 기능 003)
create policy "QA 관리자만 읽기" on public.usage_log for select to authenticated
  using ((select private.current_user_role()) = 'qa_manager');
create policy "본인 기록만 추가" on public.usage_log for insert to authenticated
  with check (user_id = (select auth.uid()));
