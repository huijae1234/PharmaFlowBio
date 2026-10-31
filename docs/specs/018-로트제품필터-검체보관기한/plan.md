# plan: 로트 제품별 거르기·보존 검체 보관 기한과 폐기

- 기능 ID: 018
- 상태: 승인됨 (2026-10-28)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-28 / 2026-10-28
- 기준 spec: ./spec.md (v0.1, 승인됨 2026-10-28)
- 근거 문서: docs/ERD.md v0.16 (sample_transfer, notification, batch), docs/IA.md v2.9 (BT_010000_PG, BT_010209_TB, SM_010000_PG·SM_010100~010104), spec 008 (검체 인계 함수·잠금·문구), spec 009 v0.7 (알림 틀·target), spec 017 (출하 완료 칸, 0031·0032 방식), 현재 코드
- 브랜치: `phase-10-sample-retention` (main에서 새로 만든다)

## 0. 요약
- 범위: FR-001~008 전부.
- 접근: 제품 거르기는 로트 목록 화면과 읽기 함수만 고친다. 보관 기한은 저장하지 않고 인수 확인 시각에서 계산한다(화면은 순수 함수, DB는 같은 식의 내부 함수). 폐기는 검체 상태 `disposed`와 폐기 칸 4개, DB 함수 하나. 기한 알림은 새 설정(예약 작업) 없이, 앱이 열려 있는 동안 알림 함이 1분마다 확인할 때 DB 함수 하나를 불러 "기한이 됐고 아직 안 알린" 검체만 알림을 만든다(spec Q4 결정).
- 단계: 4단계 — ① 로트 제품 거르기 ② 규칙·데이터베이스 ③ 검체 화면 ④ 문서·전체 회귀.

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | 빌드 없는 HTML/CSS/JS ES 모듈 | 지금 그대로 | 기존 앱과 같게 | — |
| 저장 | Supabase Postgres + RLS + `public` 함수 | 프로젝트 pharmaflow (지금 그대로) | 표 직접 쓰기 금지 규칙과 같게 | — |
| 보관 기한 | 계산 값 (인수 확인 시각의 한국 날짜 + 2년) | — | 기간이 바뀌어도 자료를 고칠 필요가 없다. Postgres `date + interval '2 years'`는 2월 29일을 2월 28일로 맞춘다(Q80 가정과 같음) | 칸으로 저장(인수 때 같이 넣어야 하고 예전 기록을 채워야 함) |
| 기한 알림 | `public.notify_due_retention()` — 알림 함 1분 확인·앱 첫 화면 때 호출 | — | 새 설정·비용 없음, 지금 1분 확인 길과 같다 | pg_cron 예약 작업(새 설정, spec 제외 범위 "2차·승인 필요"), 화면에서 계산해 알림 저장(우회 가능) |
| 중복 막기 | 알림 `target_table='sample_transfer'`·`target_id`·kind `retention_due`가 있으면 건너뜀 + `pg_advisory_xact_lock` | — | 두 사람이 동시에 열어도 한 번만 | 알림 표에 유일 색인(기존 알림 줄과 섞여 조건이 복잡) |
| 함수 시험 | Node 내장 `node:test` | Node v24.21.0 | 기존 시험과 같게 | — |
| DB 시험 | `supabase/tests/018_rules.sql` | — | 001~017과 같은 방식 | — |

**실행 환경:** 데스크톱·휴대폰 브라우저 (지금 앱과 같음)

## 2. 구조와 파일

### 폴더 트리
```text
src/domain/sample-rules.js                 (고침) SAMPLE_STATUS_LABELS에 disposed "폐기", retentionDueDate, isRetentionDue, canDispose, checkDisposal, retainedQuantity에 폐기 반영
src/domain/batch-filter-rules.js           (새로) 주소의 제품 값 정리 productFilterValue(제품 목록, 주소 값)
src/infrastructure/store.js                (고침) listBatches에 productId
src/infrastructure/store-samples.js        (고침) SAMPLE_FIELDS에 폐기 칸·disposer, disposeSample
src/infrastructure/store-notifications.js  (고침) checkDueRetention (notify_due_retention 부르고 결과는 기다리지 않음)
src/ui/inbox.js                            (고침) 첫 확인과 1분 확인 때 checkDueRetention 다음 flushNotifications
src/ui/pages/batches.js                    (고침) 제품 선택 칸, 주소 ?product=
src/ui/pages/samples.js                    (고침) 보관 기한 칸·"기한 지남", 폐기 버튼, 확인할 검체에 기한 지난 건, 상태 거르기 "폐기"
src/ui/pages/sample-modals.js              (고침) openDisposeModal (125줄 → 200줄 넘으면 sample-dispose-modal.js로 나눔)
src/ui/dom.js                              (고침) sample_disposed 배지 색
supabase/migrations/0033_sample_disposed.sql (새로) sample_status에 'disposed' 하나만 (enum은 같은 거래에서 못 쓰므로 0031처럼 따로)
supabase/migrations/0034_sample_retention.sql (새로) 폐기 칸·검사, 보관 기한 함수, 보관 수 식, 폐기 함수, 기한 알림 함수, 알림 종류, 이력 이름, 예시·되돌리기
supabase/tests/018_rules.sql               (새로) DB 규칙 시험
supabase/tests/007_rules.sql               (고침) 되돌린 뒤 로트 수 8 → 9 (예시 로트 IFV-2410-001이 늘어서. 시험을 약하게 하지 않고 기대값만 바꿈)
tests/sample-rules.test.js                 (고침) 기한·폐기 시험 더함
tests/batch-filter-rules.test.js           (새로) 제품 값 정리 시험
docs/ERD.md, docs/IA.md, GLOSSARY.md, docs/PRD.md  (고침, 4단계)
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `batch-filter-rules.js` | `productFilterValue(products, raw)` → 목록에 있는 id면 그 값, 아니면 "" | FR-001 | 순수 함수 |
| `batches.js` | 상태 거르기 옆 제품 `<select aria-label="제품으로 거르기">` "모든 제품" + 제품(가나다순). 바꾸면 `hashWith("#/batches", { status, product, q })`. 빈 결과 문구 "이 제품의 로트가 없습니다." | FR-001 | 65줄. 상태·검색 동작은 그대로 |
| `sample-rules.js` | `retentionDueDate(t)` 생산 → QA 보존 검체이고 인수 시각이 있으면 "YYYY-MM-DD"(한국 날짜 + 2년), 아니면 null. `isRetentionDue(t, today)` 보관 중이고 오늘 ≥ 기한. `canDispose(role, t, today)` QA 관리자 + isRetentionDue. `checkDisposal({ disposedAt, note, now, dueDate })` 빈칸·미래·기한 전·200자 문구 | FR-002, FR-004 | `today`는 인자로 받는다(현재 시각 직접 안 씀). DB 식과 같아야 함 |
| `samples.js` | 표에 "보관 기한" 칸(기한 + "기한 지남" 글자), 처리 칸에 [폐기], 확인할 검체에 기한 지난 건("보관 기한 지남 · 기한 2026-10-15"), 상태 거르기에 "폐기", 줄 흐름에 "폐기 누구 · 언제 · N 바이알" | FR-002, FR-004, FR-005 | 158줄. 넘치면 표를 `sample-table.js`로 나눔 |
| `sample-modals.js` | `openDisposeModal`: 제목 "검체 폐기 · 로트번호", 보관 기한, 폐기 수량(그때 QA 보관 수와 기록 수량 중 작은 값, 읽기만), 폐기 일시(`datetime-local`, 기본·최대 지금), 메모 200자, 안내 "실물을 폐기한 뒤 기록해 주세요." | FR-004 | 실패 때 입력값 유지(`modal.js`) |
| `inbox.js` | 처음 그릴 때와 1분마다 `checkDueRetention()` → 끝나면 `flushNotifications()` | FR-003 | 기다리지 않고 실패는 화면에 안 알림(알림 틀 FR-004와 같음) |
| `0034_sample_retention.sql` | 아래 "자료 구조"·"DB 함수" | FR-002~007 | 기존 함수는 `pg_get_functiondef` + `replace`로 고치고 바꾼 수를 확인(0030·0032 방식) |

### 자료 구조 (ERD 변경 — spec 승인으로 승인됨)
| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| sample_transfer | status | enum에 `disposed` 더함 | 예 | 저장 | spec FR-004 |
| sample_transfer | disposed_by | uuid → profile | disposed면 예 | 저장 | spec FR-004 |
| sample_transfer | disposed_at | timestamptz | disposed면 예 | 저장 (사람이 넣은 폐기 일시) | spec FR-004 |
| sample_transfer | disposed_quantity | integer 0~quantity | disposed면 예 | 저장 (그때 계산한 폐기 수량, Q82) | spec FR-004 |
| sample_transfer | dispose_note | text ≤200 | 아니오 | 저장 | spec FR-004 |
| sample_transfer | 검사 | status = disposed ↔ disposed_by·disposed_at·disposed_quantity 모두 있음, disposed는 생산 → QA 보존 검체만 | | | |
| sample_transfer | 보관 기한 | date | — | 계산 `private.retention_due(received_at)` = (received_at 한국 날짜) + 2년 | spec FR-002, Q80 |
| — | QA 보관 중 보존 검체 수 | integer | — | 계산. 지금 식에 `disposed`면 `quantity - disposed_quantity` 더함 (화면 retainedQuantity도 같게) | spec FR-004 수용 기준 4, Q82 |
| notification | kind | `retention_due` 더함 | | 저장 | spec FR-003 |
| batch (예시) | IFV-2410-001 | 인플루엔자 4가 백신 프리필드주 (가상), 출하 완료(2024-11) | | 예시 | spec FR-007, Q83 |

### DB 함수 (0034)
- `private.retention_due(p_received timestamptz) returns date` — `((p_received at time zone 'Asia/Seoul')::date + interval '2 years')::date`.
- `private.qa_retained_quantity` — `disposed`면 `quantity - disposed_quantity`를 더한다.
- `public.dispose_sample(p_id uuid, p_disposed_at timestamptz, p_note text)` — QA 관리자만(`private.require_role`). `private.lock_sample`로 잠금 → 생산 → QA 보존 검체가 아니면 "보관 기한이 있는 보존 검체만 폐기할 수 있습니다." / `held`가 아니면 "이미 처리된 검체입니다. 화면을 새로 고쳐 주세요." / 오늘(한국) < 기한 → "보관 기한이 지난 검체만 폐기할 수 있습니다." / 같은 로트 QA → QC가 `pending`·`held`·`return_pending` → "QC에 넘긴 보존 검체가 돌아오지 않았습니다. 반납 확인 뒤 폐기해 주세요." / 일시 빈칸·미래(1분 여유)·기한 전 문구 / 메모 정리(앞뒤 빈칸, 200자). 로트를 `for update`로 잠근 뒤 폐기 수량 = least(quantity, qa_retained_quantity) — 0이면 "보관 중인 보존 검체가 없습니다." 저장 뒤 `{ disposed_quantity }` 돌려줌.
- `public.notify_due_retention() returns integer` — 로그인한 사람 누구나(역할 확인 없음, 읽기 전용 결과). `pg_advisory_xact_lock(해시 'retention_due')`. 생산 → QA `held`이고 기한 ≤ 오늘(한국)이며 `notification`에 (sample_transfer, 그 id, retention_due)가 없는 건마다 QA 관리자 전원에게 "보관 기한 도래 · 로트번호 · 보존 검체 N 바이알 (기한 YYYY-MM-DD)", 이동 `#/samples?status=held`. **연 사람도 받는다** — 기존 `add_notification_for`는 일을 한 본인을 빼므로 이 함수 안에서 직접 넣는다(created_by = 연 사람). 되돌리기 중이면 하지 않음. 만든 건수 돌려줌.
- `private.history_action` — sample_transfer가 disposed로 바뀌면 "검체 폐기", 내용 "보존 검체 4 바이알"(sample_route_text 쓰지 않고 폐기 수량).
- 알림 종류 검사 `notification_kind_check`에 `retention_due` (0032처럼 지금 목록 + 하나).
- `notify_sample` 트리거는 `disposed`에서 알림을 만들지 않는다(바꾸지 않음, 시험으로 확인).
- 예시: `private.seed_old_retention(p_qa)` — 로트 IFV-2410-001(인플루엔자 4가, 2024-10-08 등록)을 시험 중으로 만들어 시험 항목 3개를 기준 안 값으로 넣고(그때 기준 v1), 출하 가능 → 출하 완료(2024-11-01, 기록자 생산 담당자) 순으로 상태와 이력을 넣는다. 보존 검체 생산 → QA 4 바이알, 2024-10-15 인수 "보존검체실 냉장고 R-03 1단", 보관 중. 시험 검체는 넣지 않는다. 되돌리기(`reset_sample_data`)에서 0020의 `seed_sample_transfers` 다음에 부른다. 알림 함수가 되돌리기 직후에는 이 건 알림을 새로 만든다(이전 알림은 되돌리기가 지움 — 지금 되돌리기의 알림 처리 확인 필요: 1단계 첫 작업).

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| BT_010000_PG | 로트 목록 | `batches.js` 제품 선택 칸 |
| SM_010000_PG | 검체 목록 | `samples.js` 보관 기한 칸·폐기 버튼·확인할 검체·상태 거르기 |
| (신규) SM_010105_MD | 검체 폐기 | `sample-modals.js` openDisposeModal |
| BT_010209_TB | 로트 상세 검체 탭 | `samples.js` sampleTable 같이 씀 (보관 수 문구 그대로) |
| 알림 함 | 보관 기한 도래 | `inbox.js` 확인 때 부름. 알림 글은 DB 그대로 |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 로트 제품 거르기 | FR-001 | batch-filter-rules·시험, listBatches, batches.js | 함수 시험 전체 통과, 미리보기에서 SC-001(HBV 3개 → 보류 1개, 새로 고침 유지), 없는 제품 문구, 375px | — |
| 2 | 규칙·데이터베이스 | FR-002~004·006·007(DB) | sample-rules 고침·시험, 0033·0034, 018_rules.sql, 007 기대값 | 함수 시험 전체 통과, 018 DB 시험이 되돌리는 거래 안에서 통과, 001~017 DB 시험 통과 | 0033 실제 적용 승인, 0034 실제 적용 승인 |
| 3 | 검체 화면 | FR-002~005 | samples.js·모달·inbox·store | 미리보기에서 SC-002~005 순서대로, 375px 가로 넘침 없음, 콘솔 오류 0 | — |
| 4 | 문서·전체 회귀 | FR-008 | ERD·IA·GLOSSARY·PRD, qa 기록 | 함수·DB 시험 전체 통과, 되돌리기 뒤 예시(로트 9·검체 10, IFV-2410-001 보존 검체 보관 중) 확인, 사람 QA 목록 | — |

### 1단계 작업
- [ ] `tests/batch-filter-rules.test.js` 먼저(실패 확인) → `batch-filter-rules.js`
- [ ] `listBatches({ productId })`, `batches.js` 제품 칸·주소·빈 결과 문구
- [ ] 미리보기 확인, `ponytail-review`, qa 기록

### 2단계 작업
- [ ] 지금 되돌리기가 알림·검체·로트를 지우는 순서 확인(`pg_get_functiondef('public.reset_sample_data()')`)
- [ ] `tests/sample-rules.test.js`에 기한·폐기 시험 먼저(실패 확인) → `sample-rules.js`
- [ ] `0033_sample_disposed.sql` — **승인 뒤 실제 DB에 먼저 적용** (0034 시험이 이 값을 쓴다)
- [ ] `0034_sample_retention.sql`, `supabase/tests/018_rules.sql`, `007_rules.sql` 기대값
- [ ] 서브에이전트가 0034 + 018 시험을 되돌리는 거래 안에서 실행 → "PF_TEST 통과 N/N", 같은 방식으로 001~017 회귀
- [ ] 0034 실제 적용 승인 받기 → 적용 뒤 확인, `ponytail-review`, qa 기록

### 3단계 작업
- [ ] `store-samples.js` 칸·disposeSample, `store-notifications.js` checkDueRetention, `inbox.js`
- [ ] `samples.js` 보관 기한 칸·[폐기]·확인할 검체·거르기, `sample-modals.js` 폐기 창, `dom.js` 배지
- [ ] 미리보기 확인(QA로 알림 → 기한 지남 → 폐기 → 보관 수 0 → 이력, 다른 역할 버튼 없음, 375px). 실제 DB에서는 확인용 기록으로 하고 예시 되돌리기는 실행하지 않는다 — 0034를 적용하면 예시 IFV-2410-001은 되돌리기 전까지 없으므로, 2단계에서 승인받아 `seed_old_retention`만 한 번 부를지 묻는다
- [ ] `ponytail-review`, `web-design-guidelines` 점검, qa 기록

### 4단계 작업
- [ ] ERD v0.17(sample_transfer 폐기 칸·상태·보관 기한 계산·보관 수 식, notification.kind), IA v2.10(SM_010105_MD, 검체 목록·로트 목록 설명), GLOSSARY "보관 기한"·"검체 폐기", PRD FR-46
- [ ] 함수 시험·DB 시험 전체, 되돌리기 뒤 예시 확인(DB 시험 안에서)
- [ ] qa 절차 C: 사람 QA 목록

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험 + 화면 | batch-filter-rules "제품 값 정리" / C-01 |
| FR-002 | 함수 시험 + DB 시험 + 화면 | sample-rules "보관 기한", 018_rules "기한 계산" / C-02, C-06 |
| FR-003 | DB 시험 + 화면 | 018_rules "기한 알림 한 번", "연 사람도 받음", "보관 중 아니면 없음" / C-03, C-08 |
| FR-004 | 함수 시험 + DB 시험 + 화면 | sample-rules "폐기 가능·입력 검사·보관 수", 018_rules "QA만·기한 지난 것만·빌려준 것 막힘·두 번째 거부·폐기 수량" / C-04, C-07 |
| FR-005 | 화면 | C-07 |
| FR-006 | DB 시험 | 018_rules "이력 검체 폐기" / C-04 |
| FR-007 | DB 시험 | 018_rules "되돌리기 뒤 예시" / C-05 |
| FR-008 | 시험 전체 | C-09 |
| SC-001 | 화면 | C-01, H-02 |
| SC-002 | 화면 | C-06 |
| SC-003 | DB 시험 + 화면 | C-03, C-08, H-01 |
| SC-004 | 화면 | C-07, H-01 |
| SC-005 | DB 시험 + 화면 | C-04, C-07 |
| SC-006 | 시험 전체 | C-05, C-09 |
| SC-007 | 사람 QA | H-01 |
| SC-008 | 사람 QA | H-02 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`
| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 제품 값 정리 | 목록에 있는 id / 없는 id / 빈 값 | 그 id / "" / "" | FR-001 |
| 보관 기한 | 생산 → QA, 인수 2026-10-12T02:00Z / 인수 2024-02-29 한국 / 한국 자정 직전(2026-10-11T15:30Z) / 시험 검체 / 인수 전 | "2028-10-12" / "2026-02-28" / "2028-10-12" / null / null | FR-002, Q80 |
| 기한 지남 | 기한 = 오늘 / 하루 전 / 보관 중 아님 | true / false / false | FR-002 |
| 폐기 가능 | QA+지남 / QC+지남 / QA+기한 전 / QA+이미 폐기 | true / false / false / false | FR-004 |
| 폐기 입력 검사 | 빈 일시 / 미래 / 기한 전 / 메모 201자 / 정상 | 각 문구 / ok | FR-004 |
| 보관 수에 폐기 반영 | 생산 → QA 4 폐기 3 + QA → QC 2 반납 1 | 0 | FR-004, Q82 |

### DB 시험 (`supabase/tests/018_rules.sql`, 되돌리는 거래)
가상 로트 Q18-001~004와 사용자 qa·qa2·qc·prod·viewer를 만들어, 인수 시각을 직접 과거로 둔 보존 검체로: 기한 계산(2월 29일 포함) / 기한 전 알림 0 / 기한 지난 건 알림 QA 2명(연 qa 포함) 1건씩, 다시 불러도 0 / 반납 대기 건 알림 0 / 폐기: QC·생산 42501, 기한 전 거부, 시험 검체 거부, 빌려준 뒤 반납 대기면 거부 → 반납 확인 뒤 됨, 폐기 수량 least(4, 3)=3 → 보관 수 0, 두 번째 거부, 일시 빈칸·미래·기한 전·201자 문구 / 상태·칸·이력 "검체 폐기" / 폐기 뒤 반납·소진·인수 거부, 알림 함수는 폐기 건 건너뜀 / 출하 완료 로트 검체도 폐기 가능 / 되돌리기 뒤 IFV-2410-001 출하 완료·보존 검체 보관 중·기한 2026-10-15, 로트 9·검체 10

### 화면 눌러 보기
1. 로트 목록 → 제품 "B형간염 백신 주 (가상)" → HBV 3개 → 상태 "보류" → HBV-2610-001만 → 새로 고침 그대로 → 엑스프리벤정 → "이 제품의 로트가 없습니다."
2. QA로 앱 열기 → 알림 함 "보관 기한 도래 · … · 보존 검체 4 바이알" → 누르면 검체 목록
3. 검체 목록 → 생산 → QA 줄 보관 기한, 기한 지난 줄 "기한 지남", 확인할 검체에 그 건
4. [폐기] → 창 안내·폐기 수량 → 미래 일시로 저장(문구) → 고쳐 저장 → 배지 "폐기", 줄 흐름 "폐기 …", 버튼 없음, 로트 검체 탭 보관 수 0, 업무 이력 "검체 폐기"
5. 상태 거르기 "폐기", 다른 역할(그리기로) 버튼 없음, 375px

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호)

### 회귀 확인
- 검체 인계 5가지 처리·보관 수 문구: 008 DB 시험, 검체 목록·로트 검체 탭
- 알림 수·확인 표시: 009 DB 시험(알림 종류 수 검사가 있으면 기대값 확인), 알림 함
- 업무 이력 수: 003 DB 시험의 이력 수 식(예시 로트·검체가 늘어 수가 바뀌면 기대값을 바꾸지 않고 원인부터 본다)
- 로트 목록 상태 거르기·검색: 화면
- 되돌리기 뒤 예시 로트 수: 007 DB 시험(8 → 9, 바꾼 이유 qa에 기록)

## 5. 제약과 주의점

### 보안
- 새 비밀 값 없음. 폐기 메모는 `textContent`로만 그린다. 쓰기는 `public` 함수로만, 역할은 함수 안 `private.require_role`.
- `notify_due_retention`은 누구나 부를 수 있지만 정해진 조건의 알림만 만들고 입력 인자가 없다. 같은 건 두 번 만들지 않는다.

### 성능
- 검체는 수백 건. 알림 함수는 1분마다 사람마다 한 번 부르며, 조건에 맞는 보관 중 보존 검체만 본다(`sample_transfer_batch_id` 외 새 색인 없음, 늘면 그때 본다).

### 호환성
- 지금 브라우저와 같음. `datetime-local`은 출하 완료 창과 같은 방식.

### 지금 돌아가는 기능 깨지 않기
- 검체 상태 enum에 값 하나만 더한다. 기존 상태·길·버튼 규칙은 바꾸지 않는다.
- 보관 수 식을 고칠 때 화면 함수와 DB 함수를 같은 단계에서 함께 바꾸고, 008 시험을 다시 돌린다.

### 경계
- 항상 할 것: FR 출처 주석(`// FR-004 (spec 018)`), 기존 함수 고칠 때 바꾼 수 확인, 시험 먼저.
- 먼저 물을 것: 0033·0034 실제 적용, 실제 DB에 예시 IFV-2410-001만 넣기, 예시 되돌리기 실행, 커밋·push·PR, 새 라이브러리, 예약 작업(pg_cron).
- 절대 하지 말 것: 기한 전 미리 알림, 기한 전 폐기, 일부 수량 폐기, 폐기 취소·수정, 시험 검체 보관 기한, 제품별 보관 기간, 매일 정해진 시각 예약 알림, 홈 화면 제품 거르기, 폐기 증빙 파일(spec 5절). 시험을 지우거나 약하게 바꿔 실패 숨기기.

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 아무도 앱을 열지 않으면 알림이 늦음 | 기한 당일 알림 못 받음 | spec Q4 결정대로. 확인할 검체 목록에도 늘 보임 |
| 알림 "만든 사람"이 연 사람 이름으로 보임 | 알림 함에 "· 유○○"처럼 보일 수 있음 | 3단계에서 알림 함 표시 확인, 어색하면 이 종류는 이름을 숨김(inbox-rules) |
| 예시 로트가 늘어 기존 시험 기대값이 바뀜 | 007·003 실패 | 원인 확인 뒤 기대값만, qa 실패와 조치에 기록 |
| 0034를 적용해도 실제 DB에는 IFV-2410-001이 없음 | 미리보기·사람 QA에서 기한 지난 예시가 없음 | 2단계에서 `seed_old_retention`만 부를지 승인받음 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-28 | v0.1 | 처음 작성 (spec v0.1 승인 직후) |
| 2026-10-28 | v0.1 | 사용자 승인 |
