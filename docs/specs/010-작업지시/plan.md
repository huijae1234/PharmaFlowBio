# plan: 작업지시

- 기능 ID: 010
- 상태: 승인됨 (2026-10-27)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-27 / 2026-10-27
- 기준 spec: ./spec.md (v0.1, 승인됨)
- 근거 문서: docs/MES-확장-설계.md v0.2 (§5 work_order, §6-2 상태, §6-5 알림), docs/ERD.md v0.11 (batch, product, work_history, notification), docs/IA.md v2.5, CLAUDE.md "현재 코드"·"디자인", 코드(src/domain/roles.js, src/ui/pages/batches.js·batch-detail.js·homes.js, src/ui/app.js, src/infrastructure/store.js, supabase/migrations/0004·0014·0019·0020·0024)

## 0. 요약
- **범위:** spec 010 FR-001~010 전부 (P2인 FR-004 취소, FR-006 홈 칸, FR-009 알림, FR-010 예시 포함 — 모두 작다)
- **기술 접근:** 검체 인계(008)와 같은 방식이다.
  - 새 표 `work_order` 하나와 상태 종류 하나를 만든다. 기존 표는 바꾸지 않는다.
  - 쓰기는 `public` 함수 4개(작성·발행·착수·취소)로만. 함수 안에서 역할·상태를 확인하고 줄을 잠근다.
  - 착수는 한 함수 안에서 로트 만들기 + 작업지시 바꾸기를 함께 한다(둘 다 되거나 둘 다 안 됨).
  - 로트 만들기 규칙은 새 내부 함수 하나로 모아 `create_batch`(QA 관리자만으로 좁힘)와 착수가 함께 쓴다.
  - 업무 이력·알림은 기존 트리거와 알림 틀(spec 009)에 연결한다.
  - 버튼을 보일지는 domain 규칙(`work-order-rules.js`)이, 실제로 막는 것은 데이터베이스 함수가 정한다(ADR 0002).
- **단계:** 3단계 — ① 규칙·데이터베이스 ② 화면 ③ 예시 자료
- **브랜치:** `phase-6-work-order` (main에서 새로 만든다)

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | 빌드 없는 HTML/CSS/JS ES 모듈 | 지금 그대로 | 기존 앱과 같게 (CLAUDE.md 스택) | — |
| 저장 | Supabase Postgres + RLS + `public` 함수 | 프로젝트 pharmaflow (지금 그대로) | 표 직접 쓰기 금지 규칙과 같게 | 화면에서 표에 직접 쓰기 |
| 알림 | spec 009의 `private.add_notification` + `/api/notify` | 지금 그대로 | 받는 사람 찾기·본인 빼기·실패 기록이 이미 있음 | 새 알림 길 |
| 함수 시험 | Node 내장 `node:test` | Node v24.21.0 (`node --version` 확인) | 기존 시험과 같게 | — |
| DB 시험 | `supabase/tests/010_rules.sql` (DO 블록, 끝에서 되돌림, "PF_TEST 통과 N/N") | — | 001~009와 같은 방식 | — |

**실행 환경:** 데스크톱·휴대폰 브라우저 (지금 앱과 같음)

## 2. 구조와 파일

### 폴더 트리
```text
src/domain/work-order-rules.js           (새로) 상태 이름, 버튼 규칙, 입력 검사(수량·기간·단위·사유·로트번호), 홈 "착수할 작업지시" 고르기
src/domain/roles.js                      (고침) 버튼 표(create/release/start/cancel_work_order), 생산 담당자에서 create_batch 빼기, 메뉴 "작업지시"
src/infrastructure/store-work-orders.js  (새로) 작업지시 읽기, 함수 4개 부르기, 로트의 작업지시 읽기
src/infrastructure/store.js              (고침) NOTIFYING_FUNCTIONS에 release_work_order
src/ui/pages/work-orders.js              (새로) 작업지시 목록 #/work-orders (거르기·검색·표·줄 버튼)
src/ui/pages/work-order-modals.js        (새로) 작성·발행·착수·취소 창
src/ui/pages/batches.js                  (고침) 생산 담당자에게 로트 등록 대신 안내·작업지시 링크
src/ui/pages/batch-detail.js             (고침) 위쪽 요약에 작업지시 한 줄
src/ui/pages/homes.js                    (고침) 제조공정 홈 "착수할 작업지시" 칸
src/ui/app.js                            (고침) #/work-orders 주소
src/ui/dom.js                            (고침, 필요하면) 작업지시 상태 배지 색
supabase/migrations/0025_work_order.sql  (새로) 종류·표·RLS·이력·함수·알림, 3단계에서 예시
supabase/tests/010_rules.sql             (새로) DB 규칙 시험
tests/work-order-rules.test.js           (새로) 함수 시험
tests/roles.test.js                      (고침) 메뉴·버튼 표 기대값
docs/ERD.md, docs/IA.md, GLOSSARY.md, docs/PRD.md  (고침) 새 표·화면·용어, PRD FR-43
```
`batch-detail.js`(177줄)·`app.js`(179줄)는 줄 몇 개만 더해 300줄 안에 둔다.

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `work-order-rules.js` | `WORK_ORDER_STATUS_LABELS`, `WORK_ORDER_UNITS`, `workOrderActions(role, order)`, `checkPlannedQuantity`, `checkPlannedPeriod`, `checkCancelReason`, `checkLotNumber`, `ordersToStart(orders)` | FR-001~006 | 순수 함수. 오늘 날짜를 직접 읽지 않는다 |
| `store-work-orders.js` | `listWorkOrders()`, `getWorkOrderForBatch(batchId)`, `createWorkOrder`, `releaseWorkOrder`, `startWorkOrder`, `cancelWorkOrder` | FR-001~006 | DB가 보낸 한국어 문구 그대로 |
| `work-orders.js` | 상태 거르기, 검색(`search-box.js`, 주소 `?status=&q=`), 표, 빈·불러오는 중·오류 상태, 줄 버튼 | FR-005 | 메모·사유는 textContent로만 |
| `work-order-modals.js` | 창 4개. `modal.js` 저장 중 잠금·실패 시 입력값 유지 그대로. 발행 창은 내용 확인용 | FR-001~004 | 착수 성공 → 새 로트 상세로 이동 |
| `0025_work_order.sql` | 아래 자료 구조, 함수, 이력, 알림 | FR-001~004, 007~009 | 더하기만. `create_batch`는 역할만 좁히고 문구·반환값 그대로 |

### 자료 구조
새 표 `work_order` (ERD에 올린다). 기존 표는 칸을 더하지 않는다.

| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| work_order | id | uuid | 예 | 저장 | |
| | order_number | 글자, 유일. `WO-` + 계획 시작일 연월(YYMM) + `-` + 세 자리 순번 | 예 | 저장(함수가 매김) | FR-001, Q61 |
| | product_id | uuid → product | 예 | 저장 | FR-001 |
| | planned_quantity | 숫자 > 0, ≤ 1,000,000 | 예 | 저장 | 경계 상황 |
| | unit | 바이알·mL·L·개 (check) | 예 | 저장 | Q62 |
| | planned_start, planned_end | 날짜, 시작 ≤ 끝 (check) | 예 | 저장 | 경계 상황 |
| | note | 글자 0~200 | 아니오 | 저장 | FR-001 |
| | status | 새 종류 `work_order_status`: `draft` 작성 / `released` 발행 / `in_progress` 진행 중 / `completed` 완료(011에서 씀) / `cancelled` 취소 | 예 | 저장 | FR-002~004 |
| | batch_id | uuid → batch, 유일, 진행 중이면 반드시 있음 (check) | 착수 뒤 | 저장 | FR-003 |
| | created_by·created_at, released_by·released_at, started_by·started_at, cancelled_by·cancelled_at, cancel_reason(1~200) | profile, 시각 | 단계마다 | 저장(함수가 넣음, `clock_timestamp()`) | FR-001~004 |

- 읽기: 로그인한 모든 사람 `select` (RLS `using (true)`), 쓰기 권한은 주지 않는다.
- 색인: `status`, `batch_id`(유일).

**함수 (모두 `security definer`, `set search_path = ''`, `private.require_role`로 역할 확인, 바꿀 줄은 `for update`로 잠금):**

| 함수 | 누가 | 하는 일 |
|---|---|---|
| `create_work_order(p_input jsonb)` | 생산·QA | 입력 검사 → 번호 매기기(같은 달 번호는 `pg_advisory_xact_lock`으로 한 번에 하나씩) → `draft` |
| `release_work_order(p_id)` | QA | `draft` → `released`. 아니면 "작성 상태인 작업지시만 발행할 수 있습니다." |
| `start_work_order(p_id, p_batch_number)` | 생산·QA | `released`인지 잠근 뒤 확인 → `private.insert_batch`로 로트 생성 → `in_progress`·`batch_id`. 로트번호 중복이면 "이미 있는 로트번호입니다."로 전체 되돌림 |
| `cancel_work_order(p_id, p_reason)` | 생산·QA | `draft`·`released` → `cancelled`. 진행 중이면 spec FR-004 수용 기준 3 문구 |
| `private.insert_batch(p_number, p_product, p_by)` (새 내부) | — | 지금 `create_batch` 안의 로트번호 정리·빈칸·제품·중복 검사와 넣기를 옮긴 것 |
| `create_batch` (고침) | **QA만** | 역할 목록에서 생산 담당자를 뺀다. 안은 `private.insert_batch` 호출 |

- **업무 이력:** `work_order`에 기존 `private.record_history` 트리거를 단다. 0019처럼 지금 정의에서 줄만 더한다.
  - 로트 연결: `when 'work_order' then (new_row->>'batch_id')::uuid` → 착수 줄은 그 로트 업무 이력에도 보인다(FR-008 수용 기준 2).
  - 행동 이름: 작업지시 작성·발행·착수·취소 + " (WO-2611-001)".
- **알림:** `notification.kind` 검사에 `work_order_released`를 더한다(0024처럼 제약을 지우고 다시). 트리거 `notify_work_order`: `draft → released`일 때 생산 담당자 모두에게, 링크 `#/work-orders?q=번호`, 글 "작업지시 발행 · 번호 · 제품 수량 단위 · 시작 MM-DD · 발행 이름". 오류는 경고만 남기고 발행을 막지 않는다(spec 009 FR-004).

### 화면 연결
| 화면 ID (IA에 새로·고침) | 화면 | 파일·영역 |
|---|---|---|
| WO_010000_PG (새로) | 작업지시 목록 `#/work-orders` | `pages/work-orders.js` |
| WO_010100_MD (새로) | 작업지시 작성 | `work-order-modals.js` |
| WO_010101_MD (새로) | 작업지시 발행 | `work-order-modals.js` |
| WO_010102_MD (새로) | 작업 착수 | `work-order-modals.js` |
| WO_010103_MD (새로) | 작업지시 취소 | `work-order-modals.js` |
| BT_010000_PG (고침) | 로트 목록 — 생산 담당자 안내 | `pages/batches.js` |
| BT_010100_MD (고침) | 로트 등록 — QA 관리자만 | `pages/batches.js` |
| BT_010200_PG (고침) | 로트 상세 위쪽 작업지시 줄 | `pages/batch-detail.js` summary |
| HM_030000_PG (고침) | 제조공정 홈 "착수할 작업지시" | `pages/homes.js` |

메뉴 "작업지시"는 "로트" 바로 다음에 둔다. 앞에 두면 열람자의 첫 줄(로트 목록 = 첫 화면)이 바뀌어 spec 007 FR-002 시험과 어긋난다(1단계에서 발견). 모든 역할이 연다(QC·열람자는 읽기만).

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 규칙과 데이터베이스 | FR-001~004, 007~009 (규칙·저장) | work-order-rules.js와 시험, roles.js, 0025, 010_rules.sql, ERD·IA·GLOSSARY·PRD | 함수 시험 전체 통과, 010_rules 통과(먼저 실패 확인), DB 시험 001~009 회귀 통과 | 없음 |
| 2 | 화면 | FR-001~007 (화면), FR-009 (화면 쪽 보내기) | 메뉴·주소·작업지시 목록·창 4개·로트 상세 줄·홈 칸·로트 목록 안내 | 미리보기에서 QA 관리자로 작성 → 발행 → 착수 → 새 로트 상세에 작업지시 줄, 취소, 거르기·검색·빈 상태, 375px 가로 스크롤 없음, 콘솔 오류 없음 | 없음 |
| 3 | 예시 자료 | FR-010 | 예시 함수, `replace_sample_data`에 연결, 지금 자료에 예시만 더함 | 010_rules·007_rules·008_rules 통과, 목록에 12건(진행 중 8·작성 1·발행 2·취소 1), 예시 로트 상세마다 작업지시 줄 | 없음 |

### 1단계 작업
- [ ] 브랜치 `phase-6-work-order`
- [ ] `tests/work-order-rules.test.js`를 먼저 쓰고 실패를 확인한다. 이어서 `work-order-rules.js`를 만든다.
- [ ] `roles.js` 버튼 표: 생산 담당자 `create_work_order`·`start_work_order`·`cancel_work_order`(그리고 `create_batch` 뺌), QA 관리자 네 가지 + `release_work_order`. `tests/roles.test.js` 기대값을 고친다.
- [ ] `010_rules.sql`을 먼저 쓰고 실패를 확인한다(표 없음). 서브에이전트가 되돌리는 시험 안에서 0025를 미리 돌려 본 뒤 적용하고 통과를 확인한다.
- [ ] 기존 DB 시험은 로트를 모두 QA 관리자로 만들므로 고치지 않는다(2026-10-27 확인). 생산 담당자 로트 등록이 막히는 사례는 010_rules에 새로 넣는다.
- [ ] 회귀: DB 시험 001~009.
- [ ] ERD에 `work_order`, IA에 WO_* 화면과 고친 화면, GLOSSARY에 "작업지시 / 발행 / 착수", PRD에 FR-43 작업지시(Must, 출처 MES 설계)를 올린다.

### 2단계 작업
- [ ] `store-work-orders.js`, `NOTIFYING_FUNCTIONS`, 메뉴·주소, `work-orders.js`, `work-order-modals.js`
- [ ] 로트 목록 안내, 로트 상세 작업지시 줄, 제조공정 홈 칸
- [ ] 미리보기에서 QA 관리자 계정으로 확인한다. 생산·QC 화면은 함수 시험의 버튼 규칙과 DB 시험의 역할 막기로 대신하고, 사람 QA(H-01)에서 본다.

### 3단계 작업
- [ ] `private.seed_work_orders(p_qa)`: 예시 로트 8개에 진행 중 작업지시를 잇고, 작성 1·발행 2·취소 1을 더한다(모두 예시 제품, 이력은 기존 `private.seed_history` 방식).
- [ ] `replace_sample_data`에서 로트를 지우기 전에 `delete from public.work_order`, 예시 로트 뒤에 `seed_work_orders` (0020 방식, 넣은 줄 수 검사).
- [ ] 지금 자료에는 작업지시가 하나도 없을 때만 예시를 더한다. 로트·이슈·검체·이력은 지우지 않는다. 데모 DB의 시험용 로트(IFV-2610-005 등)는 건드리지 않는다.

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험(입력 검사) + DB 시험(번호·권한) + 화면 | work-order-rules "입력 검사", 010_rules 작성 / C-01, C-02, C-05 |
| FR-002 | DB 시험 + 화면 | 010_rules 발행 / C-02, C-05 |
| FR-003 | DB 시험(로트 생성·중복·동시) + 화면 | 010_rules 착수 / C-02, C-05 |
| FR-004 | 함수 시험(사유) + DB 시험 + 화면 | work-order-rules "취소 사유", 010_rules 취소 / C-01, C-02, C-05 |
| FR-005 | 함수 시험(버튼 규칙) + 화면 | work-order-rules "버튼 규칙" / C-01, C-06 |
| FR-006 | 함수 시험(착수할 작업지시) + 화면 | work-order-rules "착수할 작업지시" / C-07 |
| FR-007 | 함수 시험(버튼 표) + DB 시험 + 화면 | roles "생산 담당자 로트 등록 없음", 010_rules / C-03, C-07 |
| FR-008 | DB 시험 | 010_rules 이력 / C-04 |
| FR-009 | DB 시험(알림 줄) + 화면(알림 함) | 010_rules 알림 / C-04, H-01 |
| FR-010 | DB 시험 + 화면 | 010_rules 예시 / C-09 |
| SC-001 | 화면 + 사람 QA | C-05, H-01 |
| SC-002 | 함수 시험 + DB 시험 | C-01, C-03 |
| SC-003 | DB 시험 | C-02 |
| SC-004 | 화면 | C-06 |
| SC-005 | DB 시험 + 화면 | C-04 |
| SC-006 | DB 시험 + 사람 QA | C-04, C-07, H-01 |
| SC-007 | DB 시험 + 회귀 + 화면 | C-08, C-09 |
| SC-008 | 사람 QA | H-02 |
| SC-009 | DB 조회 (기능 뒤 새 로트 중 작업지시 없는 것) | C-08 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 입력 검사: 계획 수량 | "", "0", "-1", "abc", "1000001", "0.5", "5000", "1000000" | 앞 다섯은 spec 문구, 뒤 셋 통과 | 경계 상황 |
| 입력 검사: 계획 기간 | 끝 < 시작, 같은 날, 끝 > 시작, 빈 값 | 첫째·넷째 문구, 나머지 통과 | 경계 상황 |
| 입력 검사: 단위·로트번호 | 목록 밖 단위, 공백 로트번호, 앞뒤 공백 | 문구 / 정리된 값 | 경계 상황 |
| 취소 사유 | 공백, 201자, "수량 오기" | 문구 / 문구 / 통과 | FR-004 |
| 버튼 규칙 | 네 역할 × 다섯 상태 | QA: 작성 줄 발행·취소, 발행 줄 착수·취소 / 생산: 작성 줄 취소, 발행 줄 착수·취소 / QC·열람자: 없음 / 진행 중·완료·취소: 없음 | FR-005 |
| 착수할 작업지시 | 상태가 섞인 목록 | 발행만, 계획 시작일 빠른 순 | FR-006 |
| 생산 담당자 로트 등록 없음 | `can("production_operator", "create_batch")` | false (QA는 true) | FR-007 |

### 화면 눌러 보기
1. QA 관리자로 메뉴 "작업지시" → 작성 → 목록 맨 위에 "작성" 줄과 번호
2. 그 줄 "발행" → 창에 내용 확인 → "발행" 배지
3. "착수" → 이미 있는 로트번호 → 문구, 입력값 남음 → 새 로트번호 → 새 로트 상세, 위쪽에 작업지시 줄
4. 작성 줄 하나 "취소"(사유 빈칸 → 문구, 사유 입력 → 취소 배지)
5. 상태 거르기·검색·없는 검색어 빈 상태 문구, 로트번호 링크, 375px 화면
6. 로트 상세 업무 이력 탭에 "작업지시 착수" 줄, 사용 기록 화면 알림 기록에 발행 알림

### QA
- `qa.md` 참고 (Claude QA C-01~C-09, 사람 QA H-01~H-02)

### 회귀 확인
- 판정·보류·이슈·평가·조치·출하 검토·검체·알림: DB 시험 001~009 그대로 통과 (모두 로트를 QA 관리자로 만든다)
- QA 관리자 로트 등록, 로트 목록·상세 기존 탭, 검색, 메뉴: 함수 시험(roles)과 미리보기
- 예시 자료 되돌리기: 007_rules·008_rules가 그대로 통과하고, 되돌린 뒤 검체 9건 + 작업지시 12건
- 슬랙 보내기: `tests/slack-notify.test.js` 그대로 통과

## 5. 제약과 주의점

### 보안
- 표에 직접 쓰지 못하게 `grant select`만 준다. 쓰기는 `security definer` 함수로만, `set search_path = ''`.
- 메모·취소 사유·로트번호는 화면에 글자로만 그리고(textContent), 알림 글은 `private.notify_text`로 정리한다.
- 비밀 값 없음. 화면 코드에는 지금처럼 공개 키만.

### 성능
- 작업지시는 많아야 수백 건이라 목록은 한 번에 받아 화면에서 거른다(검체 목록과 같음). 로트 상세는 `batch_id` 유일 색인으로 한 줄만 읽는다.

### 호환성
- 지금 앱과 같다.

### 지금 돌아가는 기능 깨지 않기
- 0025는 더하기가 원칙이다. 예외는 `create_batch`의 역할 좁히기 하나(spec FR-007)이고, 반환값·문구·인자는 그대로 둔다.
- `record_history`·`history_action`·`replace_sample_data`는 0019·0020처럼 지금 정의에서 줄만 더하고, 더해졌는지 검사한다.
- `notification.kind` 제약을 다시 만들 때 기존 14가지를 모두 넣는다(009_rules로 확인).
- 작업지시 없는 예전 로트는 화면에서 작업지시 줄만 없고 나머지는 그대로다.

### 경계
- 항상 할 것: 파일 읽기·검색, 함수 시험·DB 시험(되돌리는 시험) 실행, 미리보기 확인, 이 plan 단계 안의 코드 작성, qa.md·Intent 기록
- 먼저 물을 것: 마이그레이션 적용 전 확인(단계 끝 보고 때 함께), 커밋·push·PR·병합, 예시 자료 되돌리기 실행, 이 plan에 없는 표·칸 변경, 새 라이브러리
- 절대 하지 말 것 (spec 제외 범위): 작업지시 완료 처리·공정 단계·원료·수율·설비(011~016), 작업지시 내용 고치기·지우기, 한 작업지시로 여러 로트, 생산 계획 달력, 작업지시 인쇄, 결재선·전자서명·ERP 연동, 생산 담당자 로트 직접 등록, 시험을 지우거나 건너뛰어 실패 숨기기, 비밀 키 커밋, 데모 DB 초기화

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| `create_batch` 역할을 좁히면 생산 담당자 화면에 남은 버튼이 오류를 냄 | 생산 담당자 화면 오류 | 버튼은 `roles.js`에서 먼저 숨기고 안내로 바꿈. 기존 DB 시험은 QA로 로트를 만들어 영향 없음(확인함) |
| 같은 달 번호를 두 사람이 동시에 매김 | 번호 중복 오류 | 달마다 잠금(`pg_advisory_xact_lock`) + 유일 제약 |
| 착수 중 로트는 생겼는데 작업지시 바꾸기 실패 | 작업지시 없는 로트 | 한 함수(한 묶음 저장) 안에서 처리, 실패하면 전체 되돌림. DB 시험으로 확인 |
| 되돌리기가 `work_order`를 모르면 로트 지우기에서 외래 키 오류 | 시연 전 되돌리기 실패 (008 때 겪음) | 로트보다 먼저 `work_order` 지우기, 010_rules에 되돌리기 사례 |
| 알림 종류 제약 다시 만들기 실수 | 모든 알림 저장 실패 | 0024 목록 + 새 종류, 009_rules 재실행 |
| 메뉴가 하나 늘어 옆 메뉴가 길어짐 | 찾기 불편 | "로트" 앞 한 줄만. 사람 QA H-01에서 판단 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-27 | v0.1 | 처음 작성. spec 010 v0.1(승인)의 FR-001~010, SC-001~009를 3단계로 |
