# plan: 조치 요청·승인·출하 판정

- 기능 ID: 002
- 상태: 승인됨 (2026-10-22)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-22 / 2026-10-22
- 기준 spec: ./spec.md (v0.2, 승인됨)
- 근거 문서: docs/ERD.md v0.5, docs/IA.md v1, docs/journeys/ (CUJ-01 3~6단계, E3·E5), docs/PRD.md v0.2, docs/adr/0002, docs/specs/001 (plan·qa 완료), CLAUDE.md (현재 코드)

## 0. 요약
spec 002의 FR-001~014를 6단계로 만든다. 기능 001과 같은 방식이다: 화면은 빌드 없는 HTML/JS, 저장은 역할을 확인하는 데이터베이스 함수로만 하고, 상태 변경(승인·반려·완료·이슈 닫기·보류 풀기·출하 판정)은 함수 하나 안에서 한꺼번에 처리한다. 1단계에서 측정 당시 기준(Q16)과 함수 7개, SQL 시험을 먼저 만들고, 2~6단계에서 화면을 붙인다. 새 라이브러리는 없다.

## 1. 기술과 버전
기능 001 plan §1과 같다. 바뀌는 것만 적는다.

| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | HTML/CSS/JavaScript (ES 모듈), 빌드 없음 | 브라우저 내장 | 기능 001과 같음 | — |
| Supabase 라이브러리 | `@supabase/supabase-js` UMD CDN | 2.117.3 (index.html에 이미 있음) | 기능 001과 같음 | — |
| 저장 함수 | PostgreSQL 함수(RPC) 7개 추가 + 기존 2개 고침 | Supabase 프로젝트 pharmaflow | 상태 변경을 한꺼번에(E1), 동시 처리 막기(E5), 우회 차단 | 화면에서 표를 여러 번 고치기 (일부만 저장될 수 있음) |
| 동시 처리 막기 | 함수 안에서 `status = 'pending_approval'`인 행만 고치고, 고친 행이 없으면 "다른 사람이 먼저 처리했습니다." | — | FR-006. 행 잠금 하나로 충분 | 버전 칸 추가 (ERD 변경 필요) |
| 함수 시험 | `node:test` | Node v24.21.0 | 기능 001과 같음 | — |
| 데이터베이스 시험 | `supabase/tests/002_rules.sql` (001과 같은 방식, 되돌림) | — | — | — |
| 외부 라이브러리 (npm) | 없음 | — | — | — |

**실행 환경:** 기능 001과 같음 (최신 Chrome·Edge, 휴대폰 Chrome 375px).

## 2. 구조와 파일

### 폴더 트리
```text
PharmaFlow/
├── src/
│   ├── domain/
│   │   ├── action-rules.js        (신규) 조치 종류·상태 이름, 종류별 배정 가능 역할(Q18), 이슈 닫기 가능 여부(Q19)
│   │   ├── release-rules.js       (신규) 출하 가능 막는 이유 목록(Q17), KPI 계산(열린 이슈 수·이번 주 이탈 수·평균 처리 일수)
│   │   └── batch-rules.js         (수정 없음)
│   ├── infrastructure/
│   │   └── store.js               (수정) 조치 요청·이슈·출하 판정 읽기·함수 호출. 300줄을 넘으면 store-actions.js로 나눈다
│   └── ui/
│       ├── pages/
│       │   ├── issues.js           (신규) QI_010000_PG 품질 이슈 목록
│       │   ├── issue-detail.js     (신규) QI_010100_PG 품질 이슈 상세
│       │   ├── action-modals.js    (신규) QI_010101~010104_MD 조치 요청 등록·승인·반려·결과 입력, 다시 제출
│       │   ├── approvals.js        (신규) AD_010000_PG 승인 대기
│       │   ├── history.js          (신규) AD_030000_PG 전체 업무 이력
│       │   ├── release-modal.js    (신규) BT_010208_MD 출하 판정
│       │   ├── batch-detail.js     (수정) 위쪽 요약(조치 요청 상태·최근 이력 3줄), 출하 판정 버튼
│       │   ├── batch-tabs.js       (수정) 측정 당시 기준 표시(Q16), 품질 이슈 탭에서 상세로 이동
│       │   └── homes.js            (수정) 승인 대기·출하 판정 대기·KPI, 내 일·반려된 내 요청
│       ├── app.js                  (수정) 새 주소 4개 연결
│       └── route.js                (수정) #/issues/:id
├── styles/
│   └── issue.css                   (신규) 이슈·조치 화면 (app.css·batch.css 300줄 규칙)
├── supabase/
│   ├── migrations/
│   │   ├── 0007_applied_spec.sql   (신규) Q16 칸 2개, 기존 측정값 채우기, 시험·공정 저장 함수가 함께 저장
│   │   ├── 0008_actions.sql        (신규) 조치 요청·이슈 닫기·출하 판정 함수 7개, 이력 행동 이름 보강
│   │   └── 0009_measured_at_clock.sql (신규) 측정 시각 기본값 clock_timestamp()
│   └── tests/
│       └── 002_rules.sql           (신규)
└── tests/
    ├── action-rules.test.js        (신규)
    ├── release-rules.test.js       (신규)
    └── route.test.js               (수정) #/issues/:id
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| src/domain/action-rules.js | 조치 종류 이름, 상태 이름, `assignableRoles(actionType)`(Q18), `canCloseIssue(requests)`(Q19) | FR-003~008, FR-012 | 화면 표시용. 실제 막기는 함수 |
| src/domain/release-rules.js | `releaseBlockers({ openIssues, testSpecs, measurements })` → 막는 이유 목록(Q17), `kpis({ issues, measurements, now })` | FR-009, FR-010 | 현재 시각은 인자로 받는다 |
| supabase/migrations/0008_actions.sql | `submit_action_request`, `resubmit_action_request`, `approve_action_request`, `reject_action_request`, `complete_action_request`, `close_quality_issue`, `decide_release` | FR-003~009 | 함수 안에서 역할·배정·상태를 다시 확인 |
| src/ui/pages/action-modals.js | 등록·승인(담당자 고르기)·반려·결과 입력·다시 제출 모달 | FR-003~007 | 모달 틀은 기능 001의 modal.js |
| src/ui/pages/release-modal.js | 출하 가능/폐기 고르기, 막는 이유를 글로 | FR-009 | 이유는 release-rules, 막기는 decide_release |

### 자료 구조
docs/ERD.md v0.5를 그대로 쓴다. 이 기능에서 쓰는 것과 계산 값만 적는다.

| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| action_request | 전 칸 | ERD 그대로 | ERD대로 | 저장 (함수가 바꿈) | [ERD action_request] |
| measurement | applied_min_value, applied_max_value | numeric | 예 | 저장 (시험·공정·재시험 함수가 그때 기준을 넣음) | [ERD v0.5, Q16] |
| measurement | action_request_id | uuid | 재시험만 | 저장 | [ERD measurement] |
| quality_issue | status, closed_by, closed_at | ERD 그대로 | — | 저장 (close_quality_issue) | [ERD quality_issue] |
| batch | status `releasable`/`discarded` | enum | — | 저장 (decide_release) | [ERD batch] |
| 출하 판정 창 | 막는 이유 | 글 목록 | — | 계산 (release-rules, 같은 규칙을 decide_release가 다시 확인) | [spec 002 Q17] |
| 관리자 대시보드 | 열린 이슈 수, 이번 주 이탈 수, 평균 처리 일수 | 숫자 | — | 계산 (release-rules.kpis) | [spec 002 FR-010] |
| 이슈 상세 | 조치 요청 상태 요약 | 숫자 | — | 계산 | [spec 002 FR-009] |

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| QI_010000_PG | 품질 이슈 목록 | src/ui/pages/issues.js |
| QI_010100_PG | 품질 이슈 상세 | src/ui/pages/issue-detail.js |
| QI_010101_MD / 010102_MD / 010103_MD / 010104_MD | 조치 요청 등록 / 승인 / 반려 / 결과 입력 | src/ui/pages/action-modals.js |
| AD_010000_PG | 승인 대기 | src/ui/pages/approvals.js |
| AD_030000_PG | 전체 업무 이력 | src/ui/pages/history.js |
| BT_010208_MD | 출하 판정 | src/ui/pages/release-modal.js |
| BT_010200_PG | 배치 상세 (위쪽 요약·출하 판정 버튼) | src/ui/pages/batch-detail.js |
| HM_010000_PG / HM_020000_PG / HM_030000_PG | 첫 화면 3개 (내 일) | src/ui/pages/homes.js |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 데이터베이스 규칙 먼저 | FR-003~009, FR-014의 저장 부분 | 0007·0008 적용, 002_rules.sql, 001_rules.sql 회귀 | 002_rules.sql 모든 사례 통과, 001_rules.sql 41/41 유지, 기존 측정값의 당시 기준 채워짐 | 없음 |
| 2 | 품질 이슈 목록·상세, 조치 요청 등록, 측정 당시 기준 표시 | FR-001, FR-002, FR-003, FR-014 | issues.js, issue-detail.js, 등록 모달, batch-tabs 수정 | 기능 001의 보류 배치 이슈에서 재시험 요청이 "승인 대기"로 보이고, 기준을 바꿔도 당시 기준이 보임 | 없음 |
| 3 | 승인·반려·다시 제출, 승인 대기 화면, 동시 처리 | FR-004, FR-005, FR-006, FR-011 | 승인·반려 모달, approvals.js | SC-003, SC-007 확인 | 없음 |
| 4 | 조치 결과·이슈 닫기·보류 풀기 | FR-007, FR-008 | 결과 입력 모달, 이슈 닫기 | SC-004 확인, 마지막 이슈를 닫으면 배치가 시험 중 | 없음 |
| 5 | 출하 판정 | FR-009 | release-modal.js, 배치 상세 위쪽 요약 | SC-001, SC-002 확인 | 없음 |
| 6 | 대시보드·내 일·전체 업무 이력 | FR-010, FR-012, FR-013 | homes.js 보강, history.js | SC-005, SC-008 확인, 1~5단계 회귀 | 없음 |

단계마다 끝나면 `harness-qa` 절차 B로 qa.md에 결과를 남기고 커밋을 제안한다.

### 1단계 작업
- [x] `supabase/tests/002_rules.sql` 먼저 작성 → 함수 없이 실패 확인
- [x] `0007_applied_spec.sql`: measurement에 applied_min_value·applied_max_value 추가, 기존 행을 지금 기준값으로 채운 뒤 NOT NULL, `record_test_measurement`·`record_process_conditions`가 그때 기준을 함께 저장
- [x] `0008_actions.sql`:
  - `submit_action_request(issue, type, description)` — QC·생산·QA, 열린 이슈, 배치가 판정 전(Q11), 재시험은 시험 이슈만(Q20)
  - `resubmit_action_request(request, type, description)` — 요청자 본인, 반려됨만 → 승인 대기, 반려 사유 비움 (Q21)
  - `approve_action_request(request, assignee)` — QA만, 승인 대기만(FR-006), 담당자 역할이 조치 종류에 맞아야 함(Q18)
  - `reject_action_request(request, reason)` — QA만, 승인 대기만, 사유 필수
  - `complete_action_request(request, result_note, retest_value)` — 배정된 담당자 또는 QA, 승인됨만. 재시험이면 이슈를 연 시험 항목으로 측정값 저장·판정(재이탈도 같은 이슈), 나머지는 결과 내용 필수
  - `close_quality_issue(issue)` — 배정됐던 사람 또는 QA, 열린 요청 없음, 완료 요청 1건 이상(Q19). 배치의 열린 이슈가 0이고 직접 보류 사유가 없으면 보류 → 시험 중(Q2)
  - `decide_release(batch, decision)` — QA만. 출하 가능은 열린 이슈 0 + 모든 시험 항목의 마지막 측정값 적합 + 시험 중 또는 직접 보류(Q17). 폐기는 판정 전 어느 상태든
  - 업무 이력 행동 이름 보강: 조치 요청 승인·반려·다시 제출·완료, 출하 판정
- [x] 적용 후 002_rules.sql 통과, 001_rules.sql 다시 실행 (회귀)
- [x] (시험에서 찾은 문제) `0009_measured_at_clock.sql` — measured_at 기본값 clock_timestamp(), "마지막 측정값" 순서 보장

### 2단계 작업
- [x] `tests/route.test.js` 먼저 → `route.js` #/issues/:id
- [x] `tests/action-rules.test.js` 먼저 → `action-rules.js`
- [x] 품질 이슈 목록 (열림/닫힘·발생 구분 거르기, 주소에 남김)
- [x] 품질 이슈 상세 (기준 이탈 내용·당시 기준, 공정 기록, 조치 요청 목록, 이 이슈의 업무 이력)
- [x] 조치 요청 등록 모달
- [x] batch-tabs: 측정값 옆 기준을 당시 기준으로, 품질 이슈 탭에서 상세로 이동

### 3단계 작업
- [x] 승인 모달 (담당자 고르기: 조치 종류에 맞는 역할만, Q18), 반려 모달 (사유 필수)
- [x] 다시 제출 모달 (요청자 본인)
- [x] 승인 대기 화면 (QA 관리자만, 오래된 순)
- [x] 동시 처리 안내 문구와 새로 고침

### 4단계 작업
- [x] 조치 결과 입력 모달 (재시험이면 시험 항목·당시 기준 고정, 측정값 입력)
- [x] 이슈 닫기 버튼 (닫을 수 없으면 이유를 글로)

### 5단계 작업
- [x] `tests/release-rules.test.js` 먼저 → `release-rules.js` (막는 이유)
- [x] 출하 판정 모달, 배치 상세 위쪽 요약(조치 요청 상태, 최근 업무 이력 3줄)

### 6단계 작업
- [x] KPI·출하 판정 대기·기간 계산 시험 먼저 → `src/domain/dashboard-rules.js` (2절의 release-rules.kpis 자리를 따로 뺐다: 출하 판정 규칙과 섞지 않으려고. Q22 이번 주 = 월요일 0시)
- [x] 관리자 대시보드: 승인 대기·출하 판정 대기·KPI 숫자
- [x] 품질시험 홈·제조공정 홈: 나에게 배정된 일, 반려된 내 요청
- [x] 전체 업무 이력 (사람·배치번호·기간 거르기, 50개씩)

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 화면 | qa.md C-01 |
| FR-002 | 화면 | qa.md C-02 |
| FR-003 | SQL 시험 + 화면 | 002_rules.sql "조치 요청 등록", "재시험은 시험 이슈만", qa.md C-03 |
| FR-004 | 함수 시험 + SQL 시험 + 화면 | action-rules.test.js "배정 가능 역할", 002_rules.sql "승인·배정", "역할 안 맞는 담당자 거부", qa.md C-04 |
| FR-005 | SQL 시험 + 화면 | 002_rules.sql "반려 사유 필수", "요청자만 다시 제출", qa.md C-05 |
| FR-006 | SQL 시험 + 화면 | 002_rules.sql "이미 처리된 요청", qa.md C-06 |
| FR-007 | SQL 시험 + 화면 | 002_rules.sql "재시험 적합", "재시험 재이탈 같은 이슈", "배정 안 된 사람 거부", qa.md C-07 |
| FR-008 | 함수 시험 + SQL 시험 + 화면 | action-rules.test.js "이슈 닫기 가능", 002_rules.sql "열린 요청 있으면 닫기 거부", "마지막 이슈 → 시험 중", "직접 보류는 남음", qa.md C-08 |
| FR-009 | 함수 시험 + SQL 시험 + 화면 | release-rules.test.js "막는 이유", 002_rules.sql "열린 이슈 있으면 출하 거부", "시험 안 끝난 항목 거부", "폐기는 가능", qa.md C-09 |
| FR-010 | 함수 시험 + 화면 | release-rules.test.js "KPI", qa.md C-10 |
| FR-011 | 화면 | qa.md C-11 |
| FR-012 | 화면 | qa.md C-12 |
| FR-013 | 화면 | qa.md C-13 |
| FR-014 | SQL 시험 + 화면 | 002_rules.sql "당시 기준 저장", qa.md C-14 |
| SC-001 | 화면 (CUJ-01 한 바퀴) | qa.md C-15, H-01 |
| SC-002 | SQL 시험 + 화면 | qa.md C-09 |
| SC-003 | 화면 (계정 2개) | qa.md C-05, H-02 |
| SC-004 | SQL 시험 + 화면 | qa.md C-07, C-08 |
| SC-005 | 화면 | qa.md C-10, C-12 |
| SC-006 | SQL 시험 | qa.md C-16 |
| SC-007 | 화면 (브라우저 두 개) | qa.md C-06 |
| SC-008 | 화면 | qa.md C-13, C-14 |
| SC-009 | 사람 시연 | qa.md H-01 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 배정 가능 역할 | 조치 종류 4가지 | Q18 표대로 | FR-004 |
| 이슈 닫기 가능 | 요청 [], [승인 대기], [승인됨], [완료], [반려됨], [완료, 반려됨] | false(완료 없음), false, false, true, false(완료 없음), true | FR-008 (Q19) |
| 막는 이유 | 열린 이슈 1 / 시험 항목 미측정 / 마지막 값 이탈 / 재시험 적합으로 회복 / 모두 적합 | 이유 문구 각각, 마지막은 빈 목록 | FR-009 (Q17) |
| KPI | 이슈·측정값과 기준 시각 | 열린 이슈 수, 이번 주(월~일) 이탈 수, 평균 처리 일수(소수 첫째 자리, 닫힌 이슈 없으면 "-") | FR-010 |
| 주소 해석 | `#/issues/abc?x=1` | path `#/issues/:id`, id `abc` | FR-002 |

데이터베이스 시험(`supabase/tests/002_rules.sql`, 한 트랜잭션, 역할을 바꿔 가며, 끝에 되돌림):
- 당시 기준 저장: 시험값·공정값·재시험값에 그때 기준이 들어가고, 기준을 바꿔도 남음
- 조치 요청 등록: QC·생산·QA 가능, 열람자 거부, 닫힌 이슈 거부, 판정 끝난 배치 거부, 재시험은 공정 이슈 거부
- 승인: QA만, 담당자 필수, 역할 안 맞는 담당자 거부(재시험 → 생산 담당자 거부), 이미 승인·반려된 요청 거부 ("다른 사람이 먼저 처리했습니다.")
- 반려: 사유 필수, 요청자 본인만 다시 제출, 다시 제출하면 승인 대기
- 조치 결과: 배정된 사람·QA만, 승인됨만, 재시험 99.6 → 적합·완료, 재시험 97.5 → 같은 이슈·이슈 열림, 설비 점검 결과 내용 필수
- 이슈 닫기: 승인됨 요청 있으면 거부, 완료 없으면 거부, 배정된 적 없는 사람 거부, 마지막 이슈 닫으면 보류 → 시험 중, 직접 보류 사유 있으면 보류 유지
- 출하 판정: QA만, 열린 이슈 있으면 출하 가능 거부, 미측정 항목 있으면 거부, 마지막 값 이탈이면 거부, 조건 충족이면 출하 가능, 폐기는 열린 이슈가 있어도 가능, 판정 뒤 입력 거부
- 업무 이력: 등록·승인·반려·다시 제출·완료·이슈 닫기·출하 판정이 각각 남음

### 화면 눌러 보기
1. 기능 001에서 보류된 PF-2610-001 → 품질 이슈 탭 → 이슈 상세 → 조치 요청(재시험) → "승인 대기" (CUJ-01 3단계)
2. QA 관리자: 대시보드 승인 대기 → 승인, 담당자 윤○○(QC) → "승인됨" (4단계)
3. 윤○○: 품질시험 홈 "나에게 배정된 재시험" → 결과 99.6 → 완료 → 이슈 닫기 → 배치 시험 중 (5단계)
4. QA 관리자: 배치 상세 → 출하 판정 → (시험 안 끝난 항목이 있으면 이유 확인) → 나머지 시험값 입력 후 출하 가능 (6단계)
5. 반려 경로: 요청 → 반려(사유) → 요청자 첫 화면 → 다시 제출 (E3)
6. 브라우저 두 개로 같은 요청 승인·반려 (E5)
7. 375px에서 1~4 반복

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호). plan 승인 직후 `harness-qa` 절차 A로 만든다.

### 회귀 확인
- 기능 001 전체: `node --test "tests/*.test.js"`(현재 23개), `supabase/tests/001_rules.sql`(41/41), 배치 등록·시험값·공정 조건·보류·기준값 화면 눌러 보기, 역할별 첫 화면.
- 매 단계 끝: 함수 시험 전체, 1단계부터 002_rules.sql, 3단계부터 CUJ-01 화면 순서.

## 5. 제약과 주의점

### 보안
- 기능 001과 같다: 화면 코드에는 Supabase 공개 키만, 저장은 함수로만, 사람 입력은 `h()`/`put()`으로만 그린다.
- 새 함수 7개는 모두 안에서 역할·배정·상태를 다시 확인한다. 화면 버튼 숨김은 편의일 뿐이다.
- 반려 사유·조치 결과 내용은 사람 입력이다: 길이 제한(500자)과 이스케이프.

### 성능
- 예시 자료 규모(배치 50개, 이슈 50개 이하)에서 화면 이동 후 1초 안에 내용이 보인다 (가정).
- KPI는 화면에서 계산한다. 이슈가 수천 건이 되면 데이터베이스 집계로 옮긴다 (발표 범위 밖).

### 호환성
- 기능 001과 같다.

### 지금 돌아가는 기능 깨지 않기
- `record_test_measurement`·`record_process_conditions`를 고칠 때 기존 결과(판정, 이슈 1개, 보류, 업무 이력 3줄, Q10·Q11)가 그대로여야 한다 → 001_rules.sql 41/41로 확인.
- 기존 측정값(예시 배치, QA-T-001·002, PF-2610-001)에 당시 기준이 채워져야 한다. 비어 있는 행이 남으면 NOT NULL을 걸지 않는다.
- 첫 화면·배치 상세의 기존 칸은 그대로 두고 칸을 더한다.

### 경계
- 항상 할 것: 승인된 단계 안의 코드·SQL 작성, 함수 시험·SQL 시험, 미리보기 확인, qa.md 기록, FR·Q 번호 주석.
- 먼저 물을 것: ERD에 없는 표·칸 추가(이번 plan의 0007은 ERD v0.5에 있음), 새 라이브러리, 파일 삭제, 커밋·push, spec 범위 바꾸기, 실제 사용자 계정의 역할 바꾸기.
- 절대 하지 말 것: spec 002 제외 범위(알림 발송, 전자서명, 판정 되돌리기, 요청 삭제, 이슈 다시 열기, KPI 차트, 기능 003), CLAUDE.md 하지 않을 것, 업무 이력 고치기·지우기, 비밀 값 쓰기, 시험을 지우거나 건너뛰기.

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 기존 저장 함수를 고치다 기능 001 규칙이 깨짐 | 기준 이탈 감지(CUJ-01 첫 MOT) 고장 | 1단계 끝에 001_rules.sql 회귀, 함수 본문은 기준 저장 두 칸만 더함 |
| 출하 가능 조건(Q17)이 화면과 데이터베이스에서 달라짐 | 화면은 된다는데 저장은 거부 | 막는 이유 계산을 화면(release-rules)과 함수(decide_release)에 같은 규칙으로 두고, 같은 사례로 함수 시험·SQL 시험 |
| 시연용 실제 계정(유○○·김희재·윤○○)의 자료가 시험으로 섞임 | 발표 화면이 지저분해짐 | SQL 시험은 되돌림. 화면 시험은 QA-T-* 배치로. 기능 003의 예시 자료 되돌리기로 정리 |
| 일정 부족 (발표 2026-10-27) | CUJ-01이 끝까지 안 이어짐 | P1 단계(1~5)를 먼저, 6단계(P2 포함)는 남는 시간에 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-22 | v0.1 | 1단계 완료: 0007·0008·0009 적용, 002 36/36, 001 41/41 |
| 2026-10-22 | v0.1 | 처음 작성. 6단계. 승인 |
