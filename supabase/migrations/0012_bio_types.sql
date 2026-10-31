-- spec 004 1단계 (plan 004 §2): 세 단계 판정에 필요한 값과 칸을 더한다. 지우거나 바꾸는 문장은 없다 (전환 D11).
-- enum 값 추가는 그 값을 쓰는 함수(0013)와 다른 마이그레이션이어야 한다 (같은 트랜잭션에서 새 값을 못 씀).

-- ERD measurement.result: 관리기준 이탈
alter type public.measurement_result add value if not exists 'out_of_alert' before 'out_of_spec';

-- ERD quality_issue.kind: 규격 이탈(보류) / 관리기준 이탈(보류 없음)
create type public.issue_kind as enum ('spec', 'alert');

-- ERD specification: 사내 관리기준(선택)과 기준 버전. 기존 기준은 관리기준 없음·버전 1
alter table public.specification
  add column alert_min_value numeric,
  add column alert_max_value numeric,
  add column version integer not null default 1;

-- FR-001 (spec 004): 둘 다 비우거나, 시험 규격 안쪽으로 둘 다. 저장 함수를 거치지 않아도 지켜지게
alter table public.specification
  add constraint specification_alert_range check (
    (alert_min_value is null and alert_max_value is null)
    or (alert_min_value is not null and alert_max_value is not null
        and min_value <= alert_min_value and alert_min_value <= alert_max_value and alert_max_value <= max_value)
  ),
  add constraint specification_version_positive check (version >= 1);

-- ERD measurement: 판정에 쓴 그때의 관리기준과 기준 버전. 기존 측정값은 관리기준 없음·버전 1
alter table public.measurement
  add column applied_alert_min_value numeric,
  add column applied_alert_max_value numeric,
  add column applied_spec_version integer not null default 1;

-- ERD quality_issue.kind: 기존 이슈는 모두 규격 이탈
alter table public.quality_issue
  add column kind public.issue_kind not null default 'spec';
