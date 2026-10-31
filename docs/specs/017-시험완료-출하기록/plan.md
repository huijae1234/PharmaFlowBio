# plan: 시험 완료 알림·시험값 한 번에 입력·출하 완료 기록

- 기능 ID: 017
- 상태: 승인됨 (2026-10-28, 0031 먼저 실제 적용 승인)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-28 / 2026-10-28
- 기준 spec: ./spec.md (v0.1, 승인됨 — Q77~Q79 가정대로)
- 근거 문서: docs/ERD.md v0.15 (batch 로트 상태 규칙, measurement, notification, work_history), docs/IA.md v2.8 (BT_010000_PG, BT_010200_PG, BT_010202_TB, BT_010206_MD, BT_010208_MD, PD_010201_MD), CLAUDE.md "현재 코드"·"디자인", 코드(지금 DB의 `public.record_test_measurement`·`public.decide_release`·`private.lock_editable_batch`·`private.notify_batch`·`private.notify_out_of_spec`·`private.history_action` 정의, `batch_status` enum, `notification_kind_check`, `src/ui/pages/batch-modals.js` openTestValueModal, `batch-detail.js`, `batch-tabs.js`, `release-modal.js`, `products.js`, `src/domain/batch-rules.js`·`roles.js`, `src/infrastructure/store.js`·`store-actions.js`)

## 0. 요약
- **범위:** spec 017 FR-001~009 전부
- **기술 접근:** 지금까지와 같은 방식이다(새 라이브러리 없음).
  - **판정 로직은 하나만 둔다.** 지금 `record_test_measurement` 본문을 내부 함수 `private.record_test`로 옮기고, 지금 함수는 인자·결과가 같은 껍데기로 남긴다. 새 "한 번에 저장" 함수 `record_test_measurements`가 같은 내부 함수를 항목마다 부른다. 함수 하나 안에서 도니까 하나라도 실패하면 모두 되돌려진다(FR-004).
  - **시험 완료는 측정값 트리거가 판단한다.** 재시험이 아닌 측정값이 들어올 때마다 "이 로트의 시험 항목 수 = 첫 측정값이 있는 항목 수"인지 보고, 이번 줄로 처음 같아졌으면 알림 한 건을 만든다. 한 번에 저장해도 항목마다 따로 들어가므로 마지막 줄에서만 맞아떨어진다(FR-001 수용 기준 4). 단건 입력·한 번에 입력 어느 쪽으로 저장해도 같은 규칙이 걸린다.
  - **출하 완료는 로트 상태 하나를 더한다.** `batch_status`에 `shipped`, 로트에 출하 일시·메모·기록한 사람·기록 일시 칸을 더하고, 새 함수 `ship_batch`로만 바꾼다. 출하 완료 로트는 지금 출하 가능·폐기처럼 `private.lock_editable_batch`가 막는다.
  - Postgres는 enum에 새 값을 더한 같은 거래 안에서 그 값을 쓰지 못한다. 그래서 마이그레이션을 둘로 나눈다: **0031**은 enum 값 하나만, **0032**가 나머지 전부.
  - 버튼을 보일지는 domain 규칙이 정하고, 실제로 막는 것은 데이터베이스 함수다(ADR 0002).
- **단계:** 3단계 — ① 규칙·데이터베이스 ② 화면 ③ 문서·전체 회귀
- **브랜치:** `phase-9-test-ship` (main에서 새로 만든다)

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | 빌드 없는 HTML/CSS/JS ES 모듈 | 지금 그대로 | 기존 앱과 같게 | — |
| 저장 | Supabase Postgres + RLS + `public` 함수 | 프로젝트 pharmaflow (지금 그대로) | 표 직접 쓰기 금지 규칙과 같게 | — |
| 판정 | 지금의 `private.judge`와 시험값 저장 로직 | 지금 그대로 (본문만 내부 함수로 옮김) | 판정 규칙을 두 곳에 두지 않는다 | 화면에서 단건 함수를 여러 번 부르기(중간 실패 때 반쯤 저장됨), 새 함수에 로직 복사 |
| 시험 완료 판단 | `measurement` AFTER INSERT 트리거 | — | 단건·한 번에 입력 모두 같은 길로 지나간다 | 저장 함수 안에서 판단(두 함수에 같은 코드), 화면에서 판단(우회 가능) |
| 알림 | spec 009 틀 (`private.add_notification_for`) | 지금 그대로 | 확인 표시(v0.7)까지 그대로 붙는다 | |
| 함수 시험 | Node 내장 `node:test` | Node v24.21.0 | 기존 시험과 같게 | — |
| DB 시험 | `supabase/tests/017_rules.sql` | — | 001~011과 같은 방식 | — |

**실행 환경:** 데스크톱·휴대폰 브라우저 (지금 앱과 같음)

## 2. 구조와 파일

### 폴더 트리
```text
src/domain/test-entry-rules.js             (새로) 남은 시험 항목, 칸 값 검사(빈칸 건너뜀·숫자 오류 칸별·전부 빈칸), 저장 뒤 항목별 판정 글자
src/domain/shipment-rules.js               (새로) 출하 완료 가능 판단, 출하 일시·메모 검사, 위쪽 요약 글자
src/domain/batch-rules.js                  (고침) STATUS_LABELS에 shipped "출하 완료"
src/domain/roles.js                        (고침) 생산 담당자 버튼 표에 ship_batch
src/infrastructure/store.js                (고침) recordTestMeasurements, NOTIFYING_FUNCTIONS에 record_test_measurements
src/infrastructure/store-actions.js        (고침) shipBatch, NOTIFYING_FUNCTIONS에 ship_batch (store.js의 집합에 더함)
src/ui/pages/batch-modals.js               (고침) openTestValueModal을 여러 칸 창으로 (criteriaHint·numberField 다시 씀)
src/ui/pages/ship-modal.js                 (새로) 출하 완료 창
src/ui/pages/batch-detail.js               (고침) 생산 담당자 [출하 완료] 버튼, 위쪽 "출하 완료 · 일시 · 이름" 줄
src/ui/pages/batch-tabs.js                 (고침) 열 이름 "그때 기준" → "기준"
src/ui/pages/products.js                   (고침) 기준 등록 안내 문장
src/ui/pages/batches.js, homes.js          (고침) 상태 목록에 shipped
src/ui/dom.js                              (고침) shipped 배지 색
supabase/migrations/0031_batch_shipped.sql (새로) batch_status에 'shipped' 하나만
supabase/migrations/0032_test_entry_ship.sql (새로) 칸·알림 종류·잠금·내부 함수 옮기기·함수 2개·트리거·이력 이름
supabase/tests/017_rules.sql               (새로) DB 규칙 시험
tests/test-entry-rules.test.js             (새로) 함수 시험
tests/shipment-rules.test.js               (새로) 함수 시험
docs/ERD.md, docs/IA.md, GLOSSARY.md, docs/PRD.md  (고침, 3단계) 로트 상태·칸·화면·용어 "출하 완료", PRD FR 추가
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `test-entry-rules.js` | `remainingTestSpecs(specs, measurements)` (재시험 빼고 첫 측정값 없는 항목), `checkTestEntries(entries)` → `{ ok, values }` 또는 `{ ok:false, errors: {specId: 문구}, error }`, `resultSummaryText(results, specs)` "역가 정상 · 엔도톡신 관리기준 이탈" | FR-003, FR-004 | 순수 함수. 숫자 검사는 지금 `parseNumberInput` 재사용 |
| `shipment-rules.js` | `canShip(status, role)`, `checkShipment({ shippedAt, note, now })` → 빈칸·미래·200자 문구, `shipmentText(batch)` "출하 완료 · 10/28 14:00 · 김희재" | FR-005, FR-006 | "출하 가능 판정 뒤" 검사는 DB만 한다(판정 시각을 화면이 모름) |
| `batch-modals.js` | 남은 항목마다 이름표 달린 칸 + 기준 글자 + 칸별 오류. 모두 입력됨·시험 항목 없음 안내. 저장 → 항목별 판정 글자 | FR-003, FR-004 | 135줄 → 200줄 넘으면 시험값 창을 `test-value-modal.js`로 나눔 |
| `ship-modal.js` | 출하 일시(기본 지금, `datetime-local`), 메모, "회사 내부 출하 기록이며 국가출하승인이 아닙니다." 안내 | FR-005 | 실패 때 입력값 유지(`modal.js` 그대로) |
| `batch-detail.js` | 버튼 줄에 `canShip`일 때만 [출하 완료], 위쪽 요약에 `shipmentText` | FR-005, FR-006 | 207줄. 버튼 하나·줄 하나만 더함 |
| `0032_test_entry_ship.sql` | 아래 "자료 구조"·"DB 함수" | FR-001~002, 004~007 | 기존 함수 정의는 `pg_get_functiondef` + `replace`로 고치고 바꾼 수를 확인(0030 방식) |

### 자료 구조 (ERD 변경 — spec 승인으로 승인됨)
| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| batch | status | enum에 `shipped` 더함 | 예 | 저장 | spec FR-005·006 |
| batch | shipped_at | timestamptz | shipped면 예 | 저장 (사람이 넣은 출하 일시) | spec FR-005 |
| batch | ship_note | text, 200자까지 | 아니오 | 저장 | spec FR-005 |
| batch | shipped_by | uuid → profile | shipped면 예 | 저장 | spec FR-005 |
| batch | ship_recorded_at | timestamptz | shipped면 예 | 저장 (`clock_timestamp()`) | spec FR-005 |
| batch | 검사 | status = shipped ↔ shipped_at·shipped_by·ship_recorded_at 모두 있음 | | | |
| notification | kind | `tests_completed`, `lot_shipped` 더함 | | | spec FR-002·007 |
| measurement | (바뀜 없음) | | | | |
| 시험 완료 여부 | — | — | — | 계산 (트리거가 그때 셈, 저장 안 함) | spec FR-001 |
| 출하 가능이 된 시각 | — | — | — | 계산 (업무 이력 "내부 출하 검토" 중 출하 가능으로 바뀐 마지막 줄의 시각) | spec 경계 상황 |

### DB 함수 (0032)
- `private.record_test(p_batch_id, p_specification_id, p_value, p_by)` — 지금 `record_test_measurement` 본문 그대로(역할 확인만 밖으로). 결과 jsonb도 같다.
- `public.record_test_measurement(...)` — 역할 확인 후 `private.record_test` 호출. 인자·결과·문구 그대로.
- `public.record_test_measurements(p_batch_id uuid, p_values jsonb)` — `[{specification_id, value}]`. QC 시험 담당자·QA 관리자. 빈 배열 → "시험값을 하나 이상 입력해 주세요." 같은 항목 두 번·이미 입력된 항목 → "이미 입력된 시험 항목이 있습니다. 창을 닫고 다시 열어 주세요." 숫자 아님 → "숫자로 입력해 주세요." 항목마다 `private.record_test`. 결과는 항목별 결과 배열.
- `private.notify_tests_complete()` + `measurement` AFTER INSERT 트리거 — 재시험(action_request_id 있음)이면 건너뜀. 이 측정값의 항목이 지금 제품 시험 항목이고, 첫 측정값이 있는 항목 수가 시험 항목 수와 같으면 QA 관리자에게 `tests_completed` "시험 완료 · 로트번호 · 정상 N · 이탈 N" (target = batch). 실패해도 경고만(다른 알림 트리거와 같음).
- `public.ship_batch(p_batch_id uuid, p_shipped_at timestamptz, p_note text)` — 생산 담당자만. 로트를 `for update`로 잠그고 status가 releasable이 아니면 "출하 가능 로트만 출하 완료로 기록할 수 있습니다." 일시 검사(빈칸·미래·출하 가능 판정 전). 메모 정리(앞뒤 빈칸, 200자). 상태·칸 저장.
- `private.lock_editable_batch` — `shipped`도 막음(문구 그대로 "내부 출하 검토가 끝난 로트는 바꿀 수 없습니다.").
- `private.notify_batch` — `shipped`로 바뀌면 QA 관리자에게 `lot_shipped` "출하 완료 · 로트번호 · 기록한 사람".
- `private.history_action` — batch가 shipped로 바뀌면 "출하 완료".

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| BT_010206_MD | 시험값 입력 | `batch-modals.js` openTestValueModal (여러 칸) |
| BT_010200_PG | 로트 상세 | `batch-detail.js` 버튼 줄·위쪽 요약 |
| (신규) BT_010215_MD | 출하 완료 | `ship-modal.js` |
| BT_010000_PG | 로트 목록 | `batches.js` 상태 거르기 |
| BT_010202_TB | 시험 결과 탭 | `batch-tabs.js` 열 이름 |
| PD_010201_MD | 기준 등록 | `products.js` 안내 문장 |
| 알림 함 | 시험 완료·출하 완료 알림 | 바뀜 없음(DB 글 그대로) |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 규칙·데이터베이스 | FR-001, 002, 004(DB), 005~007(DB) | domain 2파일·시험, 0031·0032, 017_rules.sql | 함수 시험 전체 통과, 017 DB 시험이 되돌리는 거래 안에서 통과, 001~011 DB 시험 통과 | 0031 실제 적용 승인(아래) |
| 2 | 화면 | FR-003~006, 008 | 시험값 창·출하 창·로트 상세·목록·글자 바꿈 | 미리보기에서 SC-001~005 순서대로 확인, 375px 가로 넘침 없음, 콘솔 오류 0 | — |
| 3 | 문서·전체 회귀 | FR-009 | ERD·IA·GLOSSARY·PRD 고침, qa 기록 | 함수·DB 시험 전체 통과, 되돌리기 뒤 IFV-2610-004 "출하 가능" 그대로, 사람 QA 목록 | — |

### 1단계 작업
- [ ] `tests/test-entry-rules.test.js`·`tests/shipment-rules.test.js`를 먼저 써서 실패 확인(모듈 없음)
- [ ] `test-entry-rules.js`, `shipment-rules.js` 작성 → 통과
- [ ] `batch-rules.js` shipped 이름, `roles.js` ship_batch (기존 roles 시험 고침)
- [ ] `0031_batch_shipped.sql` (enum 값 하나) — **승인 뒤 실제 DB에 먼저 적용**. 0032 시험이 이 값을 써야 해서다
- [ ] `0032_test_entry_ship.sql` 작성
- [ ] `supabase/tests/017_rules.sql` 작성 (아래 DB 시험)
- [ ] 서브에이전트가 0032 + 017 시험을 되돌리는 거래 안에서 실행 → "PF_TEST 통과 N/N"
- [ ] 같은 방식으로 001~011 DB 시험 회귀 (특히 002 출하 검토, 004 판정, 009 알림 수, 003 이력 수)
- [ ] `ponytail-review`, qa C 항목 기록

### 2단계 작업
- [ ] 시험값 창 여러 칸, 칸별 오류, 전부 빈칸 안내, 모두 입력됨·시험 항목 없음 안내, 저장 뒤 항목별 판정
- [ ] `store.js` recordTestMeasurements, `store-actions.js` shipBatch, 알림 보내기 집합
- [ ] `ship-modal.js`, 로트 상세 버튼·요약 줄
- [ ] 상태 목록·배지에 shipped (`batches.js`, `homes.js`, `dom.js`)
- [ ] "그때 기준" → "기준" (`batch-tabs.js`, `products.js`), 앱 전체 검색으로 화면 글자 0건 확인
- [ ] 미리보기 확인(QC로 한 번에 입력 → QA 알림, 생산으로 출하 완료 → QA 알림, 375px)
- [ ] `ponytail-review`, `web-design-guidelines` 점검, qa 기록

### 3단계 작업
- [ ] ERD v0.16(batch 칸·상태 규칙·알림 종류), IA v2.9(BT_010215_MD, 로트 목록 거르기, 시험값 입력 설명), GLOSSARY "출하 완료", PRD FR 추가
- [ ] 함수 시험·DB 시험 전체, 되돌리기 뒤 예시 상태 확인(DB 시험 안에서)
- [ ] qa 절차 C: 사람 QA 목록

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | DB 시험 | 017_rules "시험 완료 한 번", "재시험은 세지 않음", "한 번에 저장해도 한 건", "항목이 늘면 다시" / C-01 |
| FR-002 | DB 시험 + 화면 | 017_rules "QA에게 시험 완료 글" / C-02, C-08 |
| FR-003 | 함수 시험 + 화면 | test-entry-rules "남은 항목" / C-05 |
| FR-004 | 함수 시험 + DB 시험 + 화면 | test-entry-rules "칸 검사", 017_rules "하나라도 틀리면 모두 되돌림", "규격 이탈 둘이면 이슈 둘·보류" / C-03, C-05 |
| FR-005 | 함수 시험 + DB 시험 + 화면 | shipment-rules "출하 완료 가능·일시 검사", 017_rules "생산만·출하 가능만·동시" / C-04, C-06 |
| FR-006 | DB 시험 + 화면 | 017_rules "출하 완료 로트 입력 막힘" / C-04, C-06 |
| FR-007 | DB 시험 | 017_rules "이력 출하 완료·QA 알림" / C-04 |
| FR-008 | 화면 + 코드 검색 | C-07 |
| FR-009 | 시험 전체 | C-09 |
| SC-001 | 화면 | C-05, H-01 |
| SC-002 | 화면 | C-08, H-01 |
| SC-003 | 화면 | C-06, H-02 |
| SC-004 | DB 시험 + 화면 | C-04, C-06 |
| SC-005 | 화면 | C-07 |
| SC-006 | 시험 전체 | C-09 |
| SC-007 | 사람 QA | H-01 |
| SC-008 | 사람 QA | H-01 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`
| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 남은 시험 항목 | 항목 3, 측정값 1(재시험 1 따로) | 남은 2. 재시험 측정값은 입력됨으로 치지 않음 | FR-003 |
| 칸 검사: 빈칸 건너뜀 | 3칸 중 2칸 값 | ok, 값 2개 | FR-004 |
| 칸 검사: 숫자 아님 | 한 칸 "12a" | ok false, 그 칸 id에 숫자 문구 | FR-004 |
| 칸 검사: 전부 빈칸 | 빈칸 3 | "시험값을 하나 이상 입력해 주세요." | FR-004 |
| 판정 글자 | 결과 2개 | "역가 정상 · 엔도톡신 관리기준 이탈" | FR-004 |
| 출하 완료 가능 | releasable+생산 / releasable+QA / in_testing+생산 / shipped+생산 | true / false / false / false | FR-005 |
| 출하 일시 검사 | 빈칸 / 미래 / 메모 201자 / 정상 | 각 문구 / ok | FR-005 |
| 출하 완료 이름 | shipped | "출하 완료" | FR-006 |
| 요약 글자 | shipped 로트 | "출하 완료 · 10/28 14:00 · 김희재" | FR-005 |

### DB 시험 (`supabase/tests/017_rules.sql`, 되돌리는 거래)
시험 항목 3개 가상 제품·로트를 만들어: 단건 2번 + 마지막 1번 → 알림 1건 / 한 번에 2개 → 알림 1건 / 재시험 → 알림 0건 / 항목 추가 뒤 채움 → 1건 더 / 한 번에 저장 중 하나가 이미 입력 → 아무것도 안 남음 / 숫자 아님 → 안 남음 / 규격 이탈 2개 → 이슈 2·보류 / 기존 단건 함수 결과 모양 그대로 / 출하: QA·QC 거부, in_testing 거부, 미래 일시 거부, 판정 전 일시 거부, 성공 뒤 상태·칸·이력 "출하 완료"·QA 알림 1건, 두 번째 거부 / 출하 완료 로트에 시험값·보류·출하 검토 거부 / 검체 반납은 됨(Q77)

### 화면 눌러 보기
1. QC(또는 QA)로 시험값이 빈 예시 로트 → 시험값 입력 → 칸 3개와 기준 글자
2. 한 칸에 "12a" → 저장 → 칸 옆 오류, 다른 값 그대로, 시험 결과 탭 변화 없음
3. 고쳐 저장 → 항목별 판정 글자, 시험 결과 탭 3줄 "기준" 열
4. QA 알림 함 "시험 완료 · 로트 · 정상 N · 이탈 N" → 누르면 로트 상세
5. 생산으로 IFV-2610-004 → [출하 완료] → 안내 문구 → 저장 → 배지 "출하 완료", 위쪽 줄, 입력 버튼 없음
6. QA 알림 함 "출하 완료", 업무 이력 "출하 완료"
7. 로트 목록 "출하 완료" 거르기, 375px

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호)

### 회귀 확인
- 단건 시험값 저장(재시험 조치 결과 포함): 002·004 DB 시험, 이슈 상세 조치 결과 창
- 내부 출하 검토: 002 DB 시험, 출하 검토 창
- 알림 수·확인 표시: 009 DB 시험(알림 종류 수), 작업지시·검체 화면 확인 칸
- 업무 이력 수: 003 DB 시험의 이력 수 식(새 이력 이름 "출하 완료"는 예시 자료에 없어 수는 그대로일 것)
- 작업지시·공정 단계: 010·011 DB 시험

## 5. 제약과 주의점
- **보안:** 새 비밀 값 없음. 메모는 `textContent`로만 그린다. 쓰기는 `public` 함수로만, 역할은 함수 안 `private.require_role`.
- **성능:** 시험 항목은 제품당 10개 안팎. 한 번에 저장은 함수 호출 1번.
- **지금 돌아가는 기능 깨지 않기:**
  - `record_test_measurement` 인자·결과·오류 문구 그대로 (조치 결과 창이 계속 쓴다)
  - 출하 가능 조건(FR-15)·자동 보류 규칙 그대로
  - 출하 가능 로트에서 지금 되는 일(검체 기록 등) 그대로
  - 알림 15+2가지 받는 사람 규칙 그대로
- **경계 3단:**
  - 항상 할 것: 단계 안의 코드·시험 작성, DB 시험을 되돌리는 거래로 실행, 미리보기 확인, qa 기록
  - 먼저 물을 것: **0031·0032 실제 DB 적용**(0031은 1단계 시험 전에 따로 승인 요청), 커밋·push·PR·병합, 예시 자료 변경, spec 밖 동작
  - 절대 하지 말 것: 출하 수량·출하처·되돌리기·국가출하승인 기록(제외 범위), QA의 출하 완료 기록, 시험 삭제로 실패 숨기기, 비밀 키 커밋
- **위험과 대응:**
| 위험 | 영향 | 대응 |
|---|---|---|
| enum 새 값을 같은 거래에서 못 씀 | 0032·시험이 실패 | 0031을 따로, 먼저 적용 |
| 0031만 적용되고 0032가 늦어짐 | `shipped` 값은 있지만 쓰는 함수가 없음 → 아무 로트도 그 상태가 될 수 없어 해 없음 | 화면은 0032 뒤에 배포 |
| 함수 본문 옮기기에서 바꾼 수가 틀림 | 판정·보류가 바뀜 | `replace` 뒤 위치 수 확인, 002·004 DB 시험 회귀 |
| 시험 완료 트리거가 예시 자료 되돌리기 때 알림을 만듦 | 가짜 알림 | 되돌리기는 `pharmaflow.resetting`으로 알림을 건너뛴다(지금 `add_notification_for` 규칙) — DB 시험으로 확인 |
| 단건 저장 뒤 시험 완료 알림이 바로 안 감 | 알림 지연 | `record_test_measurement`는 이미 알림 보내기 집합에 있음. 새 함수도 더함 |
