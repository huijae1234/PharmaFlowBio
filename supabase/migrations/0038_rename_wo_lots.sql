-- 작업지시 번호로 이름 붙은 로트를 제품 약자 번호로 바꾼다 (2026-10-29 사용자 요청).
-- 새 번호: 제품 약자-착수한 달(2610)-그 제품의 다음 번호. 업무 이력·알림의 옛 로트 이름도 새 번호로 바꾼다(사용자 결정: "이력 이름도 새 번호로").
-- 작업지시 번호(order_number)와 이력의 "작업지시 착수 (WO-…)" 글은 작업지시 이름이라 그대로 둔다.
-- 앞으로는 start_work_order가 WO-로 시작하는 로트번호를 막는다(화면 work-order-rules.js checkLotNumber와 같은 규칙).
--
-- 되돌리기: 아래 이름 표를 거꾸로(new → old) 넣어 같은 갱신을 한 번 더 실행하고, start_work_order는 0025 정의로 되돌린다.

create temporary table lot_rename (old_number text primary key, new_number text not null unique) on commit drop;
insert into lot_rename values
  ('WO-2611-002', 'TDP-2610-003'),
  ('WO-2610-015', 'TDP-2610-004'),
  ('WO-2611-004', 'HBV-2610-004'),
  ('QA-WO-001',   'IFV-2610-006');

-- 로트 (마이그레이션은 로그인한 사람이 없어 이력 트리거가 새 줄을 남기지 않는다)
update public.batch b set batch_number = r.new_number from lot_rename r where b.batch_number = r.old_number;

-- 업무 이력: 잠금(reject_change)을 이 갱신 동안만 끈다
alter table public.work_history disable trigger reject_change;
update public.work_history h set batch_number = r.new_number from lot_rename r where h.batch_number = r.old_number;
update public.work_history h set before_data = jsonb_set(h.before_data, '{batch_number}', to_jsonb(r.new_number))
  from lot_rename r where h.before_data->>'batch_number' = r.old_number;
update public.work_history h set after_data = jsonb_set(h.after_data, '{batch_number}', to_jsonb(r.new_number))
  from lot_rename r where h.after_data->>'batch_number' = r.old_number;
alter table public.work_history enable trigger reject_change;

-- 알림: 로트 알림만. 글 속 로트 이름은 마지막에 나온 것만 바꾼다("생산 완료 · 작업지시번호 · 제품 · 로트번호"처럼 작업지시 번호가 앞에 같은 글자로 있다)
update public.notification n
   set message = regexp_replace(n.message, '^(.*) · ' || r.old_number || '( · |$)', '\1 · ' || r.new_number || '\2'),
       batch_number = r.new_number
  from lot_rename r where n.batch_number = r.old_number;

create or replace function public.start_work_order(p_id uuid, p_batch_number text)
 returns public.work_order
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  me public.profile := private.require_role(array['production_operator', 'qa_manager']::public.user_role[], '생산 담당자·QA 관리자');
  saved public.work_order;
  created public.batch;
begin
  if btrim(coalesce(p_batch_number, '')) ~* '^WO-' then
    raise exception '작업지시 번호는 로트번호로 쓸 수 없습니다. TDP-2610-005처럼 제품 약자로 시작해 주세요.';
  end if;
  select * into saved from public.work_order where id = p_id for update;
  if saved.id is null then
    raise exception '작업지시를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.';
  end if;
  if saved.status <> 'released' then
    raise exception '발행된 작업지시만 착수할 수 있습니다.';
  end if;
  created := private.insert_batch(p_batch_number, saved.product_id, me.id);
  update public.work_order set status = 'in_progress', batch_id = created.id, started_by = me.id, started_at = clock_timestamp()
   where id = p_id returning * into saved;
  return saved;
end;
$function$;
