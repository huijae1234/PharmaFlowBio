# plan: 공정 단계 실행

- 기능 ID: 011
- 상태: 승인됨 (2026-10-27)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-27 / 2026-10-27
- 기준 spec: ./spec.md (v0.1, 승인됨 — Q68~Q72 가정대로)
- 근거 문서: docs/MES-확장-설계.md v0.2 (§5 process_step·step_run, §6-3, §10 R2·R4·R9), docs/ERD.md v0.13, docs/IA.md v2.6, CLAUDE.md "현재 코드"·"디자인", 코드(지금 DB의 `public.record_process_conditions` 정의, `private.lock_editable_batch`, `src/ui/pages/batch-tabs.js` processTab, `src/ui/pages/batch-modals.js` openProcessModal·numberField·criteriaHint·readNumber, `src/ui/pages/batch-detail.js`, `src/ui/pages/products.js`, `src/ui/pages/homes.js`, supabase/migrations/0018·0025·0027)

## 0. 요약
- **범위:** spec 011 FR-001~010 전부
- **기술 접근:** 010과 같은 방식이다.
  - 새 표 두 개(`process_step` 제품별 단계, `step_run` 로트별 단계 실행)를 만든다.
  - 기존 표에는 빈 값을 허용하는 칸만 더한다: `process_record.step_run_id`, `specification.process_step_id`, `work_order.completed_by·completed_at`.
  - **판정 로직은 하나만 둔다.** 지금 `record_process_conditions` 본문을 내부 함수 `private.record_process`로 옮기고, 지금 함수는 인자·결과가 같은 얇은 껍데기로 남긴다. 새 "단계 완료" 함수도 같은 내부 함수를 부른다. 이렇게 하면 같은 이름 함수가 두 개 생기는 문제(MES 설계 R2)를 피한다.
  - 단계 실행 줄에 착수 당시 "3/5 원액 여과" 글자를 함께 저장한다. 업무 이력 이름에 쓰고, 단계 정의가 나중에 바뀌어도 그 로트 기록이 흔들리지 않게 한다.
  - 버튼을 보일지는 domain 규칙(`process-step-rules.js`)이 정하고, 실제로 막는 것은 데이터베이스 함수다(ADR 0002).
- **단계:** 3단계 — ① 규칙·데이터베이스 ② 화면 ③ 예시 자료
- **브랜치:** `phase-7-process-steps` (main에서 새로 만든다)

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | 빌드 없는 HTML/CSS/JS ES 모듈 | 지금 그대로 | 기존 앱과 같게 | — |
| 저장 | Supabase Postgres + RLS + `public` 함수 | 프로젝트 pharmaflow (지금 그대로) | 표 직접 쓰기 금지 규칙과 같게 | — |
| 판정 | 지금의 `private.judge`와 공정 기록 로직 | 지금 그대로 (본문만 내부 함수로 옮김) | 판정 규칙을 두 곳에 두지 않는다 | `record_process_conditions`에 인자 더하기(같은 이름 함수 두 개 위험), 새 함수에 로직 복사 |
| 알림 | spec 009 틀 | 지금 그대로 | | |
| 함수 시험 | Node 내장 `node:test` | Node v24.21.0 | 기존 시험과 같게 | — |
| DB 시험 | `supabase/tests/011_rules.sql` | — | 001~010과 같은 방식 | — |

**실행 환경:** 데스크톱·휴대폰 브라우저 (지금 앱과 같음)

## 2. 구조와 파일

### 폴더 트리
```text
src/domain/process-step-rules.js           (새로) 단계 상태 계산, 착수·완료 가능 판단, 라인 클리어런스 항목, 단계 이름 검사, 현재 단계 글자
src/infrastructure/store-process-steps.js  (새로) 단계·실행 읽기, 함수 7개 부르기
src/infrastructure/store.js                (고침) NOTIFYING_FUNCTIONS에 complete_step
src/ui/pages/process-steps.js              (새로) 로트 상세 "공정 단계" 탭
src/ui/pages/process-step-modals.js        (새로) 단계 착수(라인 클리어런스) 창, 단계 완료(값 입력) 창
src/ui/pages/product-steps.js              (새로) 제품 상세 "공정 단계" 칸, 단계 등록·이름 바꾸기·순서·쓰지 않음, 공정 기준의 단계 고르기
src/ui/pages/batch-modals.js               (고침) numberField·criteriaHint·readNumber를 export (완료 창에서 다시 씀)
src/ui/pages/batch-detail.js               (고침) 탭 이름·내용 분기, 위쪽 "현재 단계" 줄, 단계가 있으면 "공정 조건 입력" 버튼 숨김
src/ui/pages/batch-tabs.js                 (고침, 필요할 때만) 단계 탭이 예전 공정 기록 줄을 다시 쓰도록 measurementLine export
src/ui/pages/products.js                   (고침) 제품 상세에 product-steps 칸 붙이기 (187줄 → 파일 크기 지킴)
src/ui/pages/homes.js                      (고침) 제조공정 홈 "진행 중 공정 단계"
src/ui/dom.js                              (고침) 단계 상태 배지 색
supabase/migrations/0028_process_steps.sql (새로) 표·칸·RLS·내부 함수 옮기기·함수 7개·이력·알림
supabase/migrations/0029_process_step_seed.sql (새로, 3단계) 예시 단계·실행·되돌리기 연결
supabase/tests/011_rules.sql               (새로) DB 규칙 시험
tests/process-step-rules.test.js           (새로) 함수 시험
docs/ERD.md, docs/IA.md, GLOSSARY.md, docs/PRD.md  (고침) 표·화면·용어(공정 단계·라인 클리어런스·공정 중 검사), PRD FR-44
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `process-step-rules.js` | `CLEARANCE_ITEMS`(4가지), `STEP_STATUS_LABELS`, `stepBoard(steps, runs, batchStatus)` → 단계마다 상태·착수 가능·완료 가능·막힌 이유, `currentStepText(board)`, `checkStepName`, `specsForStep(specs, step, isLast)` | FR-003~005, 007 | 순수 함수. 보류 막힘 문구는 spec 그대로 |
| `store-process-steps.js` | `listProcessSteps(productId)`, `listStepRuns(batchId)`, `listRunningSteps()`, `saveProcessStep`, `moveProcessStep`, `retireProcessStep`, `setSpecificationStep`, `startStep`, `completeStep` | FR-001~007 | DB 문구 그대로 |
| `process-steps.js` | 단계 카드 목록: 상태 배지, 라인 클리어런스·착수·완료 누가·언제, 값과 판정(예전 measurementLine 재사용), 이 단계 이슈 링크, 착수·완료 버튼 | FR-003 | 사람 입력 없음(단계 이름은 QA 입력 → textContent) |
| `process-step-modals.js` | 착수 창: 체크박스 4개(이름표·키보드), 완료 창: 이 단계 기준 값 + 설비 상태 + 생산량(선택) | FR-004, 005 | 저장 중 잠금·실패 시 입력 유지(modal.js) |
| `product-steps.js` | 단계 목록과 그 아래 이어진 공정 기준, QA만 버튼 | FR-001, 002 | |
| `0028_process_steps.sql` | 아래 자료 구조·함수 | FR-001~006, 008, 009 | `record_process_conditions`의 인자·결과·문구·권한은 그대로 |

### 자료 구조 (ERD v0.14에 올린다)
| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| process_step | id, product_id → product | uuid | 예 | 저장 | FR-001 |
| | step_order | 정수 1~20, (product_id, step_order) 유일 — 순서 바꾸기 때 잠깐 겹치지 않게 미뤄서 검사 | 예 | 저장 | FR-001 |
| | name | 글자 1~40, (product_id, name) 유일 | 예 | 저장 | 경계 상황 |
| | retired_at, created_by, created_at | | 쓰지 않음 때 / 예 | 저장 | FR-001 |
| step_run | id, batch_id → batch, process_step_id → process_step, (batch_id, process_step_id) 유일 | uuid | 예 | 저장 | FR-004 |
| | status | 새 종류 `step_run_status`: `in_progress` 진행 중 / `completed` 완료 ("대기"는 줄 없음) | 예 | 저장 | FR-003 |
| | step_label | 글자 "3/5 원액 여과" (착수 당시) | 예 | 저장 | FR-009, 경계 상황 |
| | line_clearance | 확인한 항목 4가지 목록 | 예 | 저장 (확인자·시각은 착수자·착수 시각) | FR-004 |
| | started_by·started_at, completed_by·completed_at | | 단계마다 | 저장(함수, `clock_timestamp()`) | FR-004, 005 |
| process_record (칸 더함) | step_run_id → step_run | 빈 값 허용 | 아니오 | 저장 | FR-005 |
| specification (칸 더함) | process_step_id → process_step | 빈 값 허용 (공정 기준만) | 아니오 | 저장 | FR-002 |
| work_order (칸 더함) | completed_by, completed_at | 빈 값 허용, 완료면 필수 | 완료 때 | 저장 | FR-006 |
| 계산 값 | 단계별 상태·착수 가능 여부·현재 단계 글자 | | | 계산(`stepBoard`) | FR-003, 007 |

읽기: 두 새 표 모두 로그인한 모든 사람 `select`. 쓰기는 함수로만.

### 데이터베이스 함수 (모두 `security definer`, `set search_path = ''`, 역할 확인, 바꿀 줄 `for update`)
| 함수 | 누가 | 하는 일 |
|---|---|---|
| `private.record_process(p_batch, p_quantity, p_equipment, p_values, p_step_run)` (새 내부) | — | 지금 `record_process_conditions` 본문 그대로 + `process_record.step_run_id` 저장 |
| `record_process_conditions` (고침) | 생산·QA | 인자·결과 그대로. 작업지시로 만든 로트이고 제품에 단계가 있으면 "공정 단계 탭에서 단계를 완료해 주세요."로 막음(FR-008). 아니면 `private.record_process(…, null)` |
| `save_process_step(p_id, p_product_id, p_name)` | QA | id 없으면 맨 뒤에 등록, 있으면 이름 바꾸기(실행 기록 있으면 막음) |
| `move_process_step(p_id, p_direction)` | QA | 위·아래 한 칸. 그 제품에 실행 기록이 하나라도 있으면 막음 |
| `retire_process_step(p_id)` | QA | 쓰지 않음 표시 |
| `set_specification_step(p_specification_id, p_step_id)` | QA | 공정 기준을 단계에 잇기(빈 값이면 미지정). 기준 버전은 바꾸지 않음 |
| `start_step(p_batch_id, p_step_id, p_clearance jsonb)` | 생산·QA | 로트 잠금 → 생산 중인지, 작업지시로 만든 로트인지, 쓰는 단계 중 앞 단계가 모두 완료인지, 진행 중 단계가 없는지, 4가지 모두 확인했는지 → `in_progress`, step_label 계산 |
| `complete_step(p_step_run_id, p_quantity, p_equipment, p_values)` | 생산·QA | 진행 중인지, 로트가 생산 중인지(보류면 막음), 값이 이 단계 기준(마지막 단계면 미지정 기준 포함)뿐인지 → `private.record_process(…, run)` → `completed`. 쓰는 단계가 모두 완료면 작업지시 `completed` |

- **업무 이력:** `process_step`, `step_run`에 기존 `record_history` 트리거. 0019·0025처럼 지금 정의에 줄만 더한다.
  - 로트 연결: `step_run` → batch_id
  - 이름: "공정 단계 등록/수정/쓰지 않음 (이름)", "공정 단계 착수 (3/5 원액 여과, 라인 클리어런스 확인)", "공정 단계 완료 (3/5 원액 여과)"
  - 작업지시 completed → "작업지시 완료 (WO-…)" — 0025에서 이미 이름이 있음
- **알림:** `notification.kind`에 `production_completed`. `notify_work_order` 트리거에 `in_progress → completed`일 때 QA 관리자·QC 시험 담당자에게 "생산 완료 · 로트번호 · 제품 · 완료 이름", 링크 로트 상세.

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| BT_010201_TB (고침) | "공정 단계" 탭 (단계 없으면 "공정 조건" 그대로) | `process-steps.js` / `batch-tabs.js processTab` |
| BT_010214_MD (새로) | 단계 착수 (라인 클리어런스) | `process-step-modals.js` |
| BT_010205_MD (고침) | 단계 완료 (공정 조건·공정 중 검사) | `process-step-modals.js` (예전 공정 조건 입력 창은 단계 없는 로트에 그대로) |
| BT_010200_PG (고침) | 위쪽 "현재 단계" 줄 | `batch-detail.js` summary |
| PD_010200_PG (고침) | 제품 상세 "공정 단계" 칸 | `product-steps.js` |
| PD_010203_MD (새로) | 공정 단계 등록·이름 바꾸기 | `product-steps.js` |
| PD_010201_MD (고침) | 공정 기준의 단계 고르기 | `product-steps.js` (기준 등록 창은 고치지 않고 단계 칸에서 고름) |
| HM_030000_PG (고침) | 제조공정 홈 "진행 중 공정 단계" | `homes.js` |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 규칙과 데이터베이스 | FR-001~006, 008, 009 (규칙·저장) | process-step-rules.js와 시험, 0028, 011_rules.sql, ERD·IA·GLOSSARY·PRD | 함수 시험 전체 통과(먼저 실패), 011_rules 통과(먼저 실패), 0028과 함께 DB 시험 001~010 회귀 통과 → 적용 뒤 011·001·004 단독 통과 | 없음 |
| 2 | 화면 | FR-001~005, 007, 008 (화면) | 제품 단계 칸·창, 공정 단계 탭·창 2개, 위쪽 줄, 홈 칸 | 미리보기에서 확인용 제품·로트로 단계 정의 → 작업지시 착수 → 단계 착수(체크 안 하면 문구) → 완료(정상·관리기준 이탈) → 마지막 완료 → 작업지시 완료, 보류 로트 막힘 문구, 단계 없는 로트는 예전 화면, 375px·Tab·콘솔 오류 없음 | 없음 |
| 3 | 예시 자료 | FR-010 | 0029, 되돌리기 연결 | 011·010·007·003 통과, 예시 제품 3개에 단계, IFV-2610-001 일부 완료, TDP-2610-001 이탈 단계까지 완료·다음 막힘, 나머지 예시 로트 모두 완료·작업지시 완료 | 없음 |

### 1단계 작업
- [ ] 브랜치 `phase-7-process-steps`
- [ ] `tests/process-step-rules.test.js`를 먼저 쓰고 실패 확인 → `process-step-rules.js`
- [ ] `011_rules.sql`을 먼저 쓰고 실패 확인 → 0028을 서브에이전트가 되돌리는 시험 안에서 011·001·002·003·004·005·007·008·009·010과 함께 돌림 → 사용자 확인 뒤 적용(010과 같은 흐름)
- [ ] ERD v0.14, IA(탭 이름·새 모달·제품 칸·홈 칸), GLOSSARY(공정 단계·단계 실행·라인 클리어런스·공정 중 검사), PRD FR-44

### 2단계 작업
- [ ] `store-process-steps.js`, `NOTIFYING_FUNCTIONS`, `batch-modals.js` export
- [ ] `product-steps.js`, `process-steps.js`, `process-step-modals.js`, `batch-detail.js`·`products.js`·`homes.js` 연결, 배지 색
- [ ] 미리보기 확인은 **확인용 제품**("확인용 공정 제품 (가상)")과 그 작업지시·로트로만 한다. 예시 제품의 단계는 3단계에서 넣으므로 2단계에서는 건드리지 않는다

### 3단계 작업
- [ ] `private.seed_process_steps(p_qa)`: 예시 제품 3개 단계(Q70), 공정 기준을 단계에 잇기(배양·발효 온도 → 1단계, 보관 온도 → 충전), 예시 로트 단계 실행(Q71: 예전 공정 기록은 이탈 난 단계, 없으면 그 기준의 단계로 잇기), 다 끝난 로트의 작업지시 완료와 이력
- [ ] `replace_sample_data`: 로트보다 먼저 `step_run`·`process_step` 정리, 예시 작업지시 뒤에 `seed_process_steps` (0027 방식, 줄 수 검사)
- [ ] 지금 자료에는 예시 제품에 단계가 없을 때만 더한다. 확인용 자료·사용자 로트는 건드리지 않는다

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험(이름 검사) + DB 시험 + 화면 | process-step-rules "단계 이름", 011_rules 단계 정의 / C-01, C-02, C-05 |
| FR-002 | DB 시험 + 화면 | 011_rules 기준 잇기 / C-02, C-05 |
| FR-003 | 함수 시험(stepBoard) + 화면 | process-step-rules "단계 상태" / C-01, C-06 |
| FR-004 | 함수 시험 + DB 시험 + 화면 | process-step-rules "착수 가능", 011_rules 착수 / C-01, C-03, C-06 |
| FR-005 | DB 시험 + 화면 | 011_rules 완료·판정 / C-03, C-06 |
| FR-006 | DB 시험 + 화면 | 011_rules 작업지시 완료·알림 / C-04, C-06 |
| FR-007 | 함수 시험(현재 단계 글자) + 화면 | process-step-rules "현재 단계" / C-01, C-07 |
| FR-008 | DB 시험(회귀) + 화면 | 001·004 공정 조건 사례, 011_rules 단계 있는 로트 막힘 / C-08 |
| FR-009 | DB 시험 | 011_rules 이력 / C-04 |
| FR-010 | DB 시험 + 화면 | 011_rules 예시 / C-09 |
| SC-001 | 화면 + 사람 QA | C-06, H-01 |
| SC-002 | DB 시험 + 사람 QA | C-03, H-01 |
| SC-003 | DB 시험 + 화면 | C-02, C-05 |
| SC-004 | DB 시험 + 화면 | C-04, C-06 |
| SC-005 | 화면 | C-07 |
| SC-006 | DB 시험(회귀) + 화면 | C-08 |
| SC-007 | DB 시험 | C-04 |
| SC-008 | DB 시험 + 화면 | C-09 |
| SC-009 | 사람 QA | H-02 |
| SC-010 | DB 시험 + 사람 QA | C-03, H-01 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 단계 이름 | "", "  ", 41자, "세포 배양" | 문구 / 문구 / 문구 / 통과(앞뒤 빈칸 정리) | FR-001 |
| 단계 상태 | 단계 5개, 실행 2 완료·1 진행 중 | 완료·완료·진행 중·대기·대기 | FR-003 |
| 착수 가능 | 앞 단계 미완료 / 진행 중 단계 있음 / 로트 보류 / 시험 중 / 정상 | 막힌 이유 spec 문구 / 착수 가능 | FR-004 |
| 쓰지 않음 단계 | 3단계가 쓰지 않음 | 2 완료면 4 착수 가능, 표시 "3/4" 아닌 쓰는 단계 기준 번호 | 경계 상황 |
| 라인 클리어런스 | 3가지만 체크 | "라인 클리어런스 4가지를 모두 확인해 주세요." | FR-004 |
| 단계 기준 | 미지정 기준 + 마지막 단계 | 마지막 단계에만 미지정 기준 포함 | FR-002 |
| 현재 단계 글자 | 진행 중 / 다음 대기 / 모두 완료 / 보류 | "현재 단계 3/5 원액 여과 · 진행 중" 등 spec 문구 | FR-007 |

### 화면 눌러 보기
1. QA 관리자로 확인용 제품 상세 → 단계 3개 등록, 순서 바꾸기, 공정 기준 하나를 2단계에 잇기
2. 확인용 작업지시 작성·발행·착수 → 로트 상세 "공정 단계" 탭에 3단계 대기
3. 1단계 착수(체크 3개만 → 문구, 4개 → 진행 중) → 완료(값 없음, 설비 정상) → 2단계 착수 → 완료(관리기준 밖 값 → 이슈만, 생산 중)
4. 3단계 착수 → 완료 → 작업지시 "완료", 알림, 로트 "생산 중"
5. 단계 없는 예전 로트 → "공정 조건" 탭과 입력 버튼 그대로
6. 제조공정 홈 "진행 중 공정 단계", 위쪽 현재 단계 줄, 375px, Tab

### QA
- `qa.md` 참고 (Claude QA C-01~C-09, 사람 QA H-01~H-02)

### 회귀 확인
- 공정 조건 입력(단계 없는 제품): DB 시험 001·004 그대로 통과
- 판정·보류·이슈·평가·조치·출하 검토·검체·알림·작업지시: DB 시험 001~010
- 예시 자료 되돌리기: 003·007·008·010 통과
- 로트 상세 다른 탭, 제품 상세 허가정보 탭: 미리보기

## 5. 제약과 주의점

### 보안
- 표 직접 쓰기 막음, 함수만. 단계 이름은 QA가 입력한 글이므로 textContent로만 그린다.
- 알림 글은 `private.notify_text`로 정리한다.

### 성능
- 단계는 제품당 20개까지, 실행은 로트당 20줄까지라 한 번에 읽는다. 홈 칸은 진행 중 실행만 읽는다.

### 호환성
- 지금 앱과 같다.

### 지금 돌아가는 기능 깨지 않기
- `record_process_conditions`는 인자·결과·문구·권한을 그대로 둔다. 단계가 있는 작업지시 로트에서만 막는다.
- 판정 로직은 내부 함수 하나로 옮길 뿐 바꾸지 않는다. 001·004 시험으로 확인한다.
- `record_history`·`history_action`·`replace_sample_data`·`notification.kind` 제약은 지금 정의에서 줄만 더한다(0019·0025·0027 방식).
- 단계 없는 제품(허가정보 등록 제품)과 예전 로트는 화면·동작이 그대로다.

### 경계
- 항상 할 것: 파일 읽기·검색, 함수 시험·되돌리는 DB 시험, 미리보기 확인(확인용 제품·로트로만), 이 plan 단계 안의 코드
- 먼저 물을 것: 마이그레이션 실제 적용, 커밋·push·PR·병합, 예시 자료 되돌리기 실행, plan에 없는 표·칸 변경, 새 라이브러리
- 절대 하지 말 것 (spec 제외 범위): 보류 해제·생산 재개(Q68), 원료 투입(012), 설비 세척·교대 인수인계, 작업 지침서·사진 첨부, 단계 완료 되돌리기·값 고치기, 단계 시간 제한 알림, 전자서명, 작업지시 없는 로트의 단계 실행, 시험을 지우거나 건너뛰어 실패 숨기기, 데모 DB 초기화

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 판정 로직을 내부 함수로 옮기다 동작이 바뀜 | 공정 조건 판정·보류가 달라짐 | 본문을 글자 그대로 옮기고 001·004·005 시험을 0028과 함께 돌림 |
| 순서 바꾸기 중 (제품, 순서) 유일 제약이 잠깐 겹침 | 순서 바꾸기 실패 | 유일 제약을 저장 끝에 검사(deferrable)하거나 임시 순서를 거쳐 바꿈 |
| 예시 로트의 예전 공정 기록을 단계에 잇는 규칙(Q71)이 로트마다 다름 | 예시 탭이 어색함 | 0029에서 이탈 난 기록 → 그 단계, 정상 기록 → 그 기준의 단계, 둘 다 없으면 마지막 단계. 시험으로 로트마다 확인 |
| 보류 해제가 없어 보류된 생산 중 로트가 영영 멈춤(Q68) | 시연 때 "왜 못 하나" 질문 | 탭에 막힌 이유를 글자로 보이고, 내부 출하 검토로 끝내는 길 안내. Q68은 다음 기능 후보로 남김 |
| 되돌리기가 새 표를 모르면 외래 키 오류 (008·010 때 겪음) | 되돌리기 실패 | 0028에서 바로 되돌리기에 `step_run`·`process_step` 지우기를 더하고(예시는 0029), 010 시험의 되돌리기 사례가 계속 통과하는지 확인 |
| 파일 크기(300줄): `batch-detail.js` 189줄, `products.js` 187줄 | 규칙 위반 | 새 파일 3개로 나누고 기존 파일에는 몇 줄만 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-27 | v0.1 | 처음 작성. spec 011 v0.1(승인)의 FR-001~010, SC-001~010을 3단계로 |
