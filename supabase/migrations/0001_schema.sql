-- ERD v0.3 그대로 (docs/ERD.md). 표 11개와 제약.
-- 화면은 표에 직접 쓰지 않고 0003의 함수로만 저장한다 (plan 001 §0, FR-006).

create schema if not exists private;

create type public.user_role as enum ('viewer', 'qc_analyst', 'production_operator', 'qa_manager');
create type public.spec_category as enum ('test', 'process');
create type public.batch_status as enum ('in_production', 'in_testing', 'on_hold', 'releasable', 'discarded');
create type public.equipment_status as enum ('normal', 'abnormal');
create type public.measurement_result as enum ('pass', 'out_of_spec');
create type public.issue_source as enum ('test', 'process');
create type public.issue_status as enum ('open', 'closed');
create type public.action_type as enum ('retest', 'equipment_check', 'material_check', 'batch_discard');
create type public.action_status as enum ('pending_approval', 'approved', 'rejected', 'completed');
create type public.usage_event as enum ('login', 'logout', 'page_view', 'search', 'public_api_call');

-- ERD profile
create table public.profile (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  email text not null,
  role public.user_role not null default 'viewer',
  created_at timestamptz not null default now()
);

-- ERD product
create table public.product (
  id uuid primary key default gen_random_uuid(),
  item_name text not null check (btrim(item_name) <> ''),
  main_ingredient text,
  manufacturer text,
  permit_item_code text,
  created_at timestamptz not null default now()
);

-- ERD specification
create table public.specification (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (id),
  category public.spec_category not null,
  item_name text not null check (btrim(item_name) <> ''),
  unit text,
  min_value numeric not null,
  max_value numeric not null,
  constraint specification_range check (min_value <= max_value),
  constraint specification_item_unique unique (product_id, category, item_name)
);

-- ERD batch
create table public.batch (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique check (btrim(batch_number) <> ''),
  product_id uuid not null references public.product (id),
  status public.batch_status not null default 'in_production',
  hold_reason text,
  created_by uuid not null references public.profile (id),
  created_at timestamptz not null default now()
);

-- ERD process_record
create table public.process_record (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id),
  production_quantity numeric,
  equipment_status public.equipment_status not null,
  recorded_by uuid not null references public.profile (id),
  recorded_at timestamptz not null default now()
);

-- ERD quality_issue
create table public.quality_issue (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id),
  source public.issue_source not null,
  status public.issue_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_by uuid references public.profile (id),
  closed_at timestamptz
);

-- ERD action_request (화면과 함수는 기능 002)
create table public.action_request (
  id uuid primary key default gen_random_uuid(),
  quality_issue_id uuid not null references public.quality_issue (id),
  action_type public.action_type not null,
  description text,
  status public.action_status not null default 'pending_approval',
  requested_by uuid not null references public.profile (id),
  requested_at timestamptz not null default now(),
  assignee_id uuid references public.profile (id),
  reviewed_by uuid references public.profile (id),
  reviewed_at timestamptz,
  rejection_reason text,
  result_note text,
  completed_at timestamptz
);

-- ERD measurement
create table public.measurement (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id),
  specification_id uuid not null references public.specification (id),
  value numeric not null,
  result public.measurement_result not null,
  process_record_id uuid references public.process_record (id),
  quality_issue_id uuid references public.quality_issue (id),
  action_request_id uuid references public.action_request (id),
  measured_by uuid not null references public.profile (id),
  measured_at timestamptz not null default now()
);

-- ERD handling_check (화면과 함수는 기능 003)
create table public.handling_check (
  id uuid primary key default gen_random_uuid(),
  chem_id text not null,
  chem_name text not null,
  cas_no text,
  check_content text not null check (btrim(check_content) <> ''),
  protective_measures text not null check (btrim(protective_measures) <> ''),
  checked_by uuid not null references public.profile (id),
  checked_at timestamptz not null default now()
);

-- ERD work_history. 고치기·지우기는 0002의 트리거가 막는다.
-- created_at은 clock_timestamp(): 한 저장 안의 여러 줄도 순서대로 정렬되게
create table public.work_history (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profile (id),
  actor_name text not null,
  actor_role text not null,
  action text not null,
  target_table text not null,
  target_id uuid not null,
  batch_id uuid references public.batch (id),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default clock_timestamp()
);

-- ERD usage_log (기록 화면은 기능 003)
create table public.usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profile (id),
  event_type public.usage_event not null,
  path text,
  search_term text,
  api_name text,
  success boolean,
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- 외래 키와 자주 거르는 칸의 색인
create index on public.specification (product_id);
create index on public.batch (product_id);
create index on public.batch (status);
create index on public.batch (created_by);
create index on public.process_record (batch_id);
create index on public.process_record (recorded_by);
create index on public.quality_issue (batch_id);
create index on public.quality_issue (closed_by);
create index on public.action_request (quality_issue_id);
create index on public.action_request (requested_by);
create index on public.action_request (assignee_id);
create index on public.action_request (reviewed_by);
create index on public.measurement (batch_id);
create index on public.measurement (specification_id);
create index on public.measurement (process_record_id);
create index on public.measurement (quality_issue_id);
create index on public.measurement (action_request_id);
create index on public.measurement (measured_by);
create index on public.handling_check (chem_id);
create index on public.handling_check (checked_by);
create index on public.work_history (batch_id, created_at desc);
create index on public.work_history (actor_id);
create index on public.work_history (created_at desc);
create index on public.usage_log (user_id);
create index on public.usage_log (created_at desc);
