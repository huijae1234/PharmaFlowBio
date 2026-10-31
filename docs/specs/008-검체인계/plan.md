# plan: 검체 인계 관리

- 기능 ID: 008
- 상태: 승인됨 (2026-10-26)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-26 / 2026-10-26
- 기준 spec: ./spec.md (v0.1, 승인됨)
- 근거 문서: docs/ERD.md v0.7 (batch, profile, work_history), docs/IA.md v2.2 (로트 상세 탭, 역할별 화면), GLOSSARY.md, CLAUDE.md "현재 코드"·"디자인", 코드(src/domain/roles.js, src/ui/app.js, src/ui/pages/batch-tabs.js, supabase/migrations/0002·0016·0018)

## 0. 요약
- **범위:** spec 008 FR-001~008 전부 (P2인 FR-004 소진, FR-006 로트 검체 탭 포함. 둘 다 작아 오늘 함께 만든다)
- **기술 접근:** 지금 방식 그대로 간다.
  - 새 표 하나(`sample_transfer`)를 만든다.
  - 쓰기는 `public` 함수 5개로만 한다. 함수 안에서 역할·팀·상태를 확인하고, 줄을 잠가 두 사람이 동시에 처리하는 것을 막는다.
  - 읽기는 로그인한 모든 사람에게 허용한다(RLS).
  - 업무 이력은 기존 트리거에 연결한다.
  - 화면에 버튼을 보일지는 domain 규칙(`sample-rules.js`)이 정하고, 실제로 막는 것은 데이터베이스 함수다(ADR 0002).
- **단계:** 3단계 — ① 규칙·데이터베이스 ② 화면 ③ 예시 자료
- **브랜치:** `phase-4-samples` (main에서 새로 만든다)

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | 빌드 없는 HTML/CSS/JS ES 모듈 | 지금 그대로 | 기존 앱과 같게 (CLAUDE.md 스택) | — |
| 저장 | Supabase Postgres + RLS + `public` 함수 | 프로젝트 pharmaflow (지금 그대로) | 기존 쓰기 규칙(표 직접 쓰기 금지)과 같게 | 화면에서 표에 직접 쓰기(권한 우회 위험) |
| 함수 시험 | Node 내장 `node:test` | 이 PC의 Node 24 | 기존 시험과 같게 | — |
| DB 시험 | `supabase/tests/008_rules.sql` (DO 블록, 끝에서 되돌림, "PF_TEST 통과 N/N") | — | 001~007과 같은 방식 | — |

**실행 환경:** 데스크톱·휴대폰 브라우저 (지금 앱과 같음)

## 2. 구조와 파일

### 폴더 트리
```text
src/domain/sample-rules.js            (새로) 검체 종류·팀·상태 이름, 역할별 길, 버튼 규칙, 입력 검사, QA 보관 수 계산
src/infrastructure/store-samples.js   (새로) 검체 기록 읽기, 함수 5개 부르기
src/ui/pages/samples.js               (새로) 검체 목록 화면 (#/samples): 확인할 검체 + 거르기·검색 + 표
src/ui/pages/sample-modals.js         (새로) 전달 등록·인수 확인·반납·반납 확인·소진 창
src/ui/pages/batch-tabs.js            (고침) "검체" 탭 함수
src/ui/pages/batch-detail.js          (고침) 탭 목록에 검체 추가
src/ui/app.js                         (고침) #/samples 주소
src/domain/roles.js                   (고침) 메뉴에 "검체"
styles/batch.css                      (고침, 필요할 때만) 확인할 검체 칸
supabase/migrations/0019_sample_transfer.sql (새로) 종류·표·RLS·트리거·이력 이름·함수 5개, 3단계에서 예시 함수
supabase/tests/008_rules.sql          (새로) DB 규칙 시험
tests/sample-rules.test.js            (새로) 함수 시험
docs/ERD.md, docs/IA.md, GLOSSARY.md  (고침) 새 표·화면·용어
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `sample-rules.js` | `SAMPLE_KIND_LABELS`, `SAMPLE_STATUS_LABELS`, `TEAM_LABELS`, `routesFor(role)`, `teamOf(role)`, `availableActions(role, transfer)`, `checkQuantity`, `checkLocation`, `checkReturnQuantity`, `retainedQuantity(transfers)` | FR-001~006 | 순수 함수. 화면·저장소를 부르지 않는다 |
| `store-samples.js` | `listSamples()`, `listBatchSamples(batchId)`, `sendSample`, `receiveSample`, `returnSample`, `confirmSampleReturn`, `consumeSample` | FR-001~006 | DB가 보낸 한국어 문구를 그대로 화면에 |
| `samples.js` | 위쪽 "확인할 검체", 상태·종류 거르기, 검색(`search-box.js`, 주소 `?q=&status=&kind=`), 표, 빈·불러오는 중·오류 상태 | FR-005 | 사람 입력(보관 위치·메모)은 textContent로만 |
| `sample-modals.js` | 창 5개. `modal.js`의 저장 중 잠금·실패 시 입력값 유지를 그대로 쓴다 | FR-001~004 | 받은 수량을 반납 창에 보여 줌 |
| `batch-tabs.js` | `samplesTab(batchId)`: 그 로트 기록과 "QA 보관 중 보존 검체 N 바이알" | FR-006 | |
| `0019_sample_transfer.sql` | 아래 자료 구조, 함수 5개, `private.qa_retained_quantity(batch)`, 이력 이름 | FR-001~004, 007 | 더하기만 한다. 기존 표·자료를 바꾸지 않는다 |

### 자료 구조
새 표 `sample_transfer` (ERD에 올린다). 기존 표는 바꾸지 않는다.

| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| sample_transfer | id | uuid | 예 | 저장 | |
| | batch_id | uuid → batch | 예 | 저장 | spec FR-001 |
| | sample_kind | `test` 시험 검체 / `retention` 보존 검체 | 예 | 저장 | FR-001 |
| | from_team, to_team | `production` / `qc` / `qa` | 예 | 저장. 길은 세 가지만(check) | FR-001 수용 기준 2·3 |
| | quantity | 정수 1~9999 | 예 | 저장 | 경계 상황 |
| | unit | 바이알·mL·g·개 | 예 | 저장 | Q46 |
| | note | 글자 0~200 | 아니오 | 저장 | FR-001 |
| | status | `pending` 인수 대기 / `held` 보관 중 / `return_pending` 반납 대기 / `returned` 반납 완료 / `consumed` 소진 | 예 | 저장 | FR-002~004 |
| | sent_by, sent_at | profile, 시각 | 예 | 저장(함수가 넣음) | FR-001 |
| | received_by, received_at, storage_location(1~60자) | | 인수 뒤 | 저장 | FR-002 |
| | returned_quantity, return_requested_by, return_requested_at | | 반납 뒤 | 저장 | FR-003 |
| | return_confirmed_by, returned_at | | 반납 확인 뒤 | 저장 | FR-003 |
| | consumed_by, consumed_at | | 소진 뒤 | 저장 | FR-004 |
| QA 보관 중 보존 검체 수 | 로트마다 생산→QA `held` 수량 − QA→QC 수량(모든 상태) + QA→QC `returned`의 반납 수량 | 정수 | — | 계산(DB 함수와 domain 함수가 같은 식) | Q47 |

- 시각은 `clock_timestamp()`로 넣는다(기존 규칙과 같음).
- 역할 → 팀은 이렇게 잇는다: 생산 담당자 → 생산, QC 시험 담당자 → QC, QA 관리자 → QA. 열람자는 팀이 없다.

**함수 (모두 `private.require_role`로 역할 확인, 처리할 줄은 `for update`로 잠근다):**

| 함수 | 누가 | 하는 일 |
|---|---|---|
| `send_sample(p_batch, p_input jsonb)` | 생산(생산→QC, 생산→QA) · QA(QA→QC) | 입력을 검사하고 `pending`으로 넣는다. QA→QC는 보관 수를 넘으면 막는다 |
| `receive_sample(p_id, p_location)` | to_team 사람 | `pending` → `held` |
| `return_sample(p_id, p_quantity)` | to_team 사람 | `held` → `return_pending`. 수량은 1~받은 수량 |
| `confirm_sample_return(p_id)` | from_team 사람 | `return_pending` → `returned` |
| `consume_sample(p_id)` | to_team이 QC일 때 QC 사람 | `held` → `consumed` |

- 상태가 맞지 않으면 spec 경계 상황의 한국어 문구로 오류를 낸다.
- 업무 이력 이름은 검체 전달·검체 인수 확인·검체 반납·검체 반납 확인·검체 소진이다. 뒤에 "(생산 → QA, 보존 검체 4 바이알)"처럼 길과 수량을 붙인다. 0016과 같은 방식으로, 지금 함수 정의에서 그 줄만 바꿔 다시 만든다.

### 화면 연결
| 화면 ID (IA에 새로) | 화면 | 파일·영역 |
|---|---|---|
| SM_010000_PG | 검체 목록 `#/samples` | `pages/samples.js` |
| SM_010100_MD | 검체 전달 등록 | `sample-modals.js` |
| SM_010101_MD | 인수 확인 | `sample-modals.js` |
| SM_010102_MD | 반납 | `sample-modals.js` |
| SM_010103_MD | 반납 확인 | `sample-modals.js` |
| SM_010104_MD | 소진 | `sample-modals.js` |
| BT_010209_TB | 로트 상세 검체 탭 `#/batches/:id?tab=samples` | `batch-tabs.js samplesTab` |

메뉴 "검체"는 "제품" 다음에 둔다. 모든 역할이 열 수 있다(열람자는 읽기만).

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 규칙과 데이터베이스 | FR-001~004, 007 (규칙·저장) | sample-rules.js와 시험, 0019, 008_rules.sql, ERD·IA·GLOSSARY | 함수 시험 전체 통과, 008_rules 통과(먼저 실패 확인), DB 시험 001~005·007 회귀 통과 | 없음 |
| 2 | 화면 | FR-001~006 (화면) | 메뉴·주소·검체 목록·창 5개·로트 검체 탭 | 미리보기에서 세 역할 흐름(전달 → 인수 → 반납 → 반납 확인, 소진)이 되고, 막힌 버튼이 안 보이고, 375px 가로 스크롤 없음, 콘솔 오류 없음 | 없음 |
| 3 | 예시 자료 | FR-008 | 0019에 예시 함수 추가, `replace_sample_data`에 연결, 지금 자료에 예시 9건만 더함 | 008_rules·007_rules 통과, 검체 목록에 9건·다섯 상태, QC·QA "확인할 검체" 각 1건 이상 | 없음 |

### 1단계 작업
- [x] 브랜치 `phase-4-samples`
- [x] `tests/sample-rules.test.js`를 먼저 쓰고 실패를 확인한다. 이어서 `sample-rules.js`를 만든다.
- [x] `008_rules.sql`을 먼저 쓰고 실패를 확인한다(함수 없음). 이어서 0019를 적용하고 통과를 확인한다.
- [x] 회귀: DB 시험 001~005·007
- [x] ERD에 `sample_transfer`, IA에 SM_* 화면과 BT_010209_TB, GLOSSARY에 "검체 / 시험 검체 / 보존 검체 / 인수 확인 / 반납"을 올린다.

### 2단계 작업
- [x] `store-samples.js`, 메뉴·주소, `samples.js`, `sample-modals.js`, 로트 검체 탭
- [x] 미리보기에서 확인한다.
  - QA 관리자 계정으로 본다(QA 화면과 버튼).
  - 다른 역할 화면은 역할을 잠시 바꾸지 않고 확인한다. 함수 시험의 버튼 규칙과 DB 시험의 역할 막기로 대신한다(실패와 조치에 기록).

### 3단계 작업
- [x] `private.seed_sample_transfers(p_qa)`를 만들고 `replace_sample_data`에서 부른다.
- [x] 지금 자료에는 같은 함수로 9건만 더한다. 로트·이슈·이력은 지우지 않는다.

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험(길·입력 검사) + DB 시험 + 화면 | sample-rules "역할별 길", 008_rules / C-01, C-04 |
| FR-002 | DB 시험 + 화면 | 008_rules 인수 / C-02, C-04 |
| FR-003 | 함수 시험(반납 수량) + DB 시험 + 화면 | sample-rules "반납 수량", 008_rules 반납 / C-02, C-04 |
| FR-004 | DB 시험 + 화면 | 008_rules 소진 / C-02, C-04 |
| FR-005 | 화면 | C-05 |
| FR-006 | 함수 시험(보관 수) + 화면 | sample-rules "QA 보관 수" / C-06 |
| FR-007 | DB 시험 | 008_rules 이력 / C-03 |
| FR-008 | DB 시험 + 화면 | 008_rules 예시 / C-08 |
| SC-001 | 화면 | C-04, H-01 |
| SC-002 | 화면 | C-04, H-01 |
| SC-003 | 함수 시험 + DB 시험 | C-01, C-02 |
| SC-004 | 화면 | C-06 |
| SC-005 | DB 시험 + 회귀 | C-03, C-07 |
| SC-006 | DB 시험 + 화면 | C-08 |
| SC-007 | 사람 QA | H-01 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node 24 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 역할별 길 | 네 역할 | 생산 2길, QA 1길(QA→QC), QC·열람자 없음 | FR-001 |
| 버튼 규칙 | 역할 × 다섯 상태 × 세 길 | 받는 팀만 인수·반납, 보낸 팀만 반납 확인, QC 받은 건만 소진, 열람자 없음 | FR-002~004 |
| 수량·위치 검사 | 0, -1, 1.5, "", 10000, 1, 9999 / 위치 공백·61자 | spec 문구 | 경계 상황 |
| 반납 수량 | 받은 2에 0·1·2·3 | 1·2만 통과, 문구에 받은 수량 | FR-003 |
| QA 보관 수 | 생산→QA 4 보관 중, QA→QC 2 반납 완료(반납 1) | 3 | FR-006, Q47 |

### 화면 눌러 보기
1. QA 관리자로 메뉴 "검체" → 확인할 검체에 인수 대기(생산→QA) 한 건이 보인다.
2. 인수 확인을 누르고 보관 위치를 적는다 → 보관 중, 인수자·일시·위치가 보인다.
3. 보관 중 보존 검체로 QA→QC 전달 → 인수 대기, 로트 검체 탭의 QA 보관 수가 줄어든다.
4. 반납 대기 건에서 반납 확인 → 반납 완료, 반납자·반납 일시가 보이고 보관 수가 다시 는다.
5. 상태 거르기·검색·새로 고침, 빈 결과 문구, 375px 화면.

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호)

### 회귀 확인
- 판정·보류·이슈 종결·내부 출하 검토: DB 시험 001~005·007 통과
- 로트 상세 기존 탭 4개, 로트·제품 검색, 메뉴 순서(메뉴 시험 고침): 함수 시험과 미리보기
- 예시 자료 되돌리기: 007_rules가 그대로 통과하고, 되돌린 뒤 검체 예시 9건

## 5. 제약과 주의점

### 보안
- 표에 직접 쓰지 못하게 한다. `grant select`만 주고, 쓰기는 `security definer` 함수로만 한다.
- 함수는 `set search_path = ''`로 만든다.
- 보관 위치·메모는 화면에 글자로만 그린다(textContent).

### 성능
- 검체 기록은 많아야 수백 건이라 목록은 한 번에 받아 화면에서 거른다(기능 007 검색과 같음). `batch_id` 색인을 둔다.

### 호환성
- 지금 앱과 같다.

### 지금 돌아가는 기능 깨지 않기
- 0019는 더하기만 한다.
- `record_history`·`history_action`은 지금 정의에서 줄을 더하는 방식으로 바꾸고, 바꾼 뒤 검사한다(0016 방식).
- 예시 자료는 3단계에서 9건만 더한다. 되돌리기는 실행하지 않는다.

### 경계
- **항상 할 것:**
  - 처리 함수마다 역할·팀·상태를 확인한다.
  - DB 시험을 먼저 실패시킨 뒤 적용한다.
  - 사람 입력은 이스케이프한다.
  - 출처 주석(`// FR-002 (spec 008)`)을 단다.
- **먼저 물을 것:**
  - 기존 표 바꾸기
  - 예시 자료 되돌리기(전체 다시 넣기) 실행
  - 커밋, push, PR, 병합, 배포
- **절대 하지 말 것:**
  - 내부 출하 검토·판정·보류 규칙에 검체를 연결하기
  - 보관 위치 목록 관리
  - 온도·유효기간 알림
  - 메일·메신저 알림
  - 전자서명·바코드
  - 검체 기록 고치기·취소
  - 홈 숫자 표시
  - 실제 회사 자료 쓰기

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 발표 전 시간이 모자람 | 기능이 덜 됨 | 단계마다 커밋. 3단계까지 못 가면 2단계까지만 병합할지 묻는다 |
| 이력 함수 다시 만들기 실패 | 모든 업무 이력이 멈춤 | 바꾼 뒤 정의 검사, 시험 안에서 먼저 확인, DB 시험 001~007 회귀 |
| 다른 역할 화면을 직접 못 봄(계정 하나) | 버튼 규칙 오류를 늦게 찾음 | 버튼 규칙을 함수 시험으로, 막기는 DB 시험으로 확인하고 사람 QA에서 다른 계정으로 확인 요청 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-26 | v0.1 | 처음 작성 |
| 2026-10-26 | v0.1 | 승인 |
