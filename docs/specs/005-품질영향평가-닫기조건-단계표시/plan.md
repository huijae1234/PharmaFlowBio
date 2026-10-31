# plan: 품질 영향 평가·닫기 조건·단계 표시

- 기능 ID: 005
- 상태: 승인됨 (2026-10-23)
- 버전: v0.2
- 작성일 / 최종 갱신: 2026-10-23 / 2026-10-23
- 기준 spec: ./spec.md (v0.2, 승인됨)
- 근거 문서: docs/ERD.md v0.7 (deviation_review, quality_issue 닫기 조건, 권한 요약), docs/IA.md v2.1 (QI_010100_PG, QI_010105_MD, QI_010106_MD, AD_010000_PG, BT_010200_PG, HM_*), docs/journeys/ (CUJ-01 v2 3~6단계, E6~E8), docs/PRD.md v0.3, docs/specs/002·004 (plan·qa), CLAUDE.md (현재 코드)

## 0. 요약
spec 005의 FR-001~008을 4단계로 만든다. 기능 002·004와 같은 방식이다: 새 표 `deviation_review`(ERD v0.7)를 더하고, 작성·다시 제출·검토는 역할을 확인하는 데이터베이스 함수로만 한다. 이슈 닫기 함수는 종류별 조건(D8)으로 고친다. 단계·다음에 할 일은 저장하지 않고 화면 쪽 순수 함수로 계산한다. 1단계에서 DB와 함수 시험을 먼저 만들고, 2~4단계에서 화면을 붙인다. 기존 자료는 지우지 않는다(D11). 새 라이브러리는 없다.

## 1. 기술과 버전
기능 001~004 plan §1과 같다. 바뀌는 것만 적는다.

| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | HTML/CSS/JavaScript (ES 모듈), 빌드 없음 | 브라우저 내장 | 기존과 같음 | — |
| Supabase 라이브러리 | `@supabase/supabase-js` UMD CDN | 2.117.3 (index.html) | 기존과 같음 | — |
| 저장 | 새 표 `deviation_review` + 함수 3개(작성·다시 제출·검토), `close_quality_issue` 고침 | Supabase 프로젝트 pharmaflow | 쓰기는 함수로만, 권한·상태 전이·동시 처리를 함수 안에서 (ADR 0002) | 화면에서 표에 직접 쓰기 (우회 가능) |
| 동시 처리 막기 | 검토 함수는 `status = 'submitted'`인 행만 고치고, 고친 행이 없으면 "다른 사람이 먼저 처리했습니다." | — | spec 002 FR-006과 같은 방식 | 버전 칸 (ERD 변경 필요) |
| 이슈당 하나 | `quality_issue_id` 유일 제약 | — | ERD v0.7, 동시에 두 번 제출해도 하나만 | 함수 안 확인만 (경쟁 상태에 약함) |
| 단계·다음에 할 일 | 화면 쪽 순수 함수 (`src/domain/step-rules.js`) | — | ERD "계산 값", 함수 시험으로 규칙 9가지 확인 | DB 뷰 (시험이 무거움) |
| 함수 시험 | `node:test` | Node v24.21.0 | 기존과 같음 | — |
| 데이터베이스 시험 | `supabase/tests/005_rules.sql` (되돌림 방식) | — | — | — |
| 외부 라이브러리 (npm) | 없음 | — | — | — |

**실행 환경:** 기존과 같음 (최신 Chrome·Edge, 휴대폰 Chrome 375px).

## 2. 구조와 파일

### 폴더 트리
```text
PharmaFlow/
├── src/
│   ├── domain/
│   │   ├── review-rules.js        (신규) 평가 상태 이름, 필수 칸 검사, 작성·다시 제출·검토 가능 여부, 종류별 닫기 막는 이유
│   │   ├── step-rules.js          (신규) 단계 5개, 지금 단계, 다음에 할 일(규칙 9가지), 로트 요약(종류별 수·평가 상태별 수·다음에 할 일)
│   │   ├── action-rules.js        (수정) closeBlockReason을 review-rules로 옮기고 이 파일의 것은 지움(호출처 1곳)
│   │   └── roles.js               (수정) write_review, review_deviation 버튼 표
│   ├── infrastructure/
│   │   ├── store-reviews.js       (신규) 평가 읽기·작성·다시 제출·검토, 승인 대기 평가, 내 되돌아온 평가
│   │   └── store-actions.js       (수정) getIssue·listIssues에 평가 상태, listBatchRequests 옆에 로트 평가 읽기
│   └── ui/
│       ├── step-views.js          (신규) 단계 표시줄, 다음에 할 일 줄
│       ├── pages/
│       │   ├── review-modals.js   (신규) QI_010105_MD 작성·다시 제출, QI_010106_MD 검토
│       │   ├── issue-detail.js    (수정) 단계 표시줄, 품질 영향 평가 칸, 닫기 이유 새 규칙. 200줄을 넘으면 평가 칸을 review-section.js로 나눈다
│       │   ├── batch-detail.js    (수정) 위쪽 요약에 종류별 수·평가 상태·다음에 할 일
│       │   ├── approvals.js       (수정) 영향 평가 검토 대기 표
│       │   └── homes.js           (수정) 승인 대기 수에 평가, 담당자 첫 화면에 되돌아온 평가
│       └── home-sections.js       (수정) 되돌아온 평가 줄
├── styles/
│   └── issue.css                  (수정) 단계 표시줄(줄바꿈, "지금" 글자), 평가 칸
├── supabase/
│   ├── migrations/
│   │   └── 0016_deviation_review.sql (신규) 표·RLS·이력·함수 3개·이슈 닫기 고침
│   └── tests/
│       ├── 005_rules.sql          (신규)
│       └── 002_rules.sql, 004_rules.sql (수정) 이슈를 닫는 사례 앞에 승인된 평가를 넣음 (닫기 조건이 바뀐 만큼만)
└── tests/
    ├── review-rules.test.js       (신규)
    ├── step-rules.test.js         (신규)
    └── action-rules.test.js       (수정) closeBlockReason 시험을 review-rules 시험으로 옮김
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `0016_deviation_review.sql` | `deviation_status` enum(submitted, approved, rejected, revision_requested), 표 `deviation_review`(ERD 칸 그대로, quality_issue_id 유일, 각 글자 칸 1,000자), RLS 읽기(로그인한 사람), 쓰기 권한 없음, 이력 트리거(로트 연결은 이슈를 거쳐), 이력 행동 이름 5개, `submit_deviation_review`, `resubmit_deviation_review`, `review_deviation_review(id, decision, comment)`, `close_quality_issue` 종류별 조건 | FR-001~005 | `record_history`의 로트 찾기에 `deviation_review`를 더한다(0014처럼 정의에서 한 줄만 바꿔 다시 만든다). 기존 이슈·자료는 건드리지 않는다 |
| `review-rules.js` | `reviewStatusLabel`, `checkReviewFields`(필수 4칸·1,000자), `canWriteReview`, `canResubmit`, `canReview`, `closeBlockReason({ issue, review, requests })` | FR-001~004 | DB 함수와 같은 문구 |
| `step-rules.js` | `issueStep({ issue, review, requests, batch, openIssueCount })` → { stage, next, owner, optionalAction }, `batchSummary({ issues, reviews, requests, batch })` | FR-006, 007 | 순수 함수. 현재 시각을 쓰지 않음 |
| `store-reviews.js` | 평가 읽기(이슈별·로트별), 작성·다시 제출·검토 호출, 승인 대기 평가, 내 되돌아온 평가 | FR-001~003, 008 | 쓰기는 rpc만 |
| `review-modals.js` | 작성 창(근거 자동 표시, 필수 칸 옆 오류, 저장 중 잠금), 검토 창(승인·반려·보완 요청, 사유, "사용·출하 승인이 아닙니다") | FR-001~003, 005 | 사람 입력은 textContent로만, 실패 시 입력값 유지 (modal.js) |
| `step-views.js` | 표시줄(단계 5개, 지금 단계 글자 "지금", 조치에 "(선택)"), 다음에 할 일 줄 | FR-006 | 색만으로 구분하지 않음 |
| `issue-detail.js` | 표시줄, 평가 칸(상태·내용·요청자·검토자·사유·버튼), 닫기 이유 | FR-001~006 | |
| `batch-detail.js` | 위쪽 요약 | FR-007 | |
| `approvals.js`, `homes.js`, `home-sections.js` | 평가 대기·되돌아온 평가 | FR-008 | |

### 자료 구조
ERD v0.7 `deviation_review` 그대로.

| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| deviation_review | quality_issue_id | uuid, 유일 | 예 | 저장 | [ERD deviation_review] |
| deviation_review | status | submitted / approved / rejected / revision_requested | 예 | 저장 | [ERD] [spec 005 Q36] |
| deviation_review | deviation_summary, probable_cause, impact_assessment, proposed_action | 글자 1~1,000자 | 예 | 저장 | [ERD] [spec 005 FR-001] |
| deviation_review | evidence | 글자 0~1,000자 | 아니오 | 저장 | [ERD] |
| deviation_review | requested_by, requested_at | 사용자, 시각 | 예 | 저장 (다시 제출하면 시각만 새로) | [ERD] |
| deviation_review | reviewed_by, reviewed_at, review_comment | 사용자, 시각, 글자 | 아니오 (반려·보완은 사유 필수) | 저장 (다시 제출하면 비움, 지난 값은 업무 이력에) | [ERD] [spec 005 FR-003] |
| 단계·다음에 할 일 | stage, next, owner | 글자 | — | 계산 | [ERD batch 계산 값] [spec 005 FR-006] |
| 로트 요약 | 종류별 열린 이슈 수, 평가 상태별 수 | 숫자 | — | 계산 | [spec 005 FR-007] |

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| QI_010100_PG | 품질 이슈 상세 | `pages/issue-detail.js`, `step-views.js` |
| QI_010105_MD | 품질 영향 평가 작성 | `pages/review-modals.js` |
| QI_010106_MD | 품질 영향 평가 검토 | `pages/review-modals.js` |
| AD_010000_PG | 승인 대기 | `pages/approvals.js` |
| BT_010200_PG | 로트 상세 | `pages/batch-detail.js` |
| HM_010000_PG, HM_020000_PG, HM_030000_PG | 첫 화면 | `pages/homes.js`, `home-sections.js` |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | DB 평가 표·함수·닫기 조건, 규칙 함수와 시험 | FR-001~005 (DB·규칙), FR-006·007 (규칙) | 0016, `005_rules.sql`, 002·004 시험 고침, `review-rules.js`, `step-rules.js` + 시험 | DB 시험 001~005 통과, 함수 시험 전체 통과(다음에 할 일 9가지, 닫기 이유) | 없음 |
| 2 | 이슈 상세: 평가 칸·작성·다시 제출·검토, 새 닫기 이유 | FR-001~005 | review-modals, issue-detail, store-reviews, CSS | QA 확인용 이슈(QA-T-004·005, 가상 백신 B)에서 작성 → 보완 요청 → 다시 제출 → 승인 → 닫기 한 바퀴, 막히는 경우 이유 글 | 없음 |
| 3 | 승인 대기·대시보드·첫 화면 | FR-008 | approvals, homes, home-sections | 검토 요청 1건이 대시보드·승인 대기에, 보완 요청이 요청자 첫 화면에 보임 | 없음 |
| 4 | 단계 표시줄·로트 요약 | FR-006, FR-007 | step-views, issue-detail, batch-detail, CSS | 이슈 상세 표시줄이 단계마다 바뀌고, 로트 상세 위쪽 요약이 보임, 375px 가로 스크롤 없음 | 없음 |

### 1단계 작업
- [ ] 함수 시험 먼저: `review-rules.test.js`(필수 칸·1,000자·공백, 권한, 종류별 닫기 이유), `step-rules.test.js`(다음에 할 일 9가지, 관리기준 이탈 "(선택)", 로트 요약·"외 N건") → 실패 확인
- [ ] `review-rules.js`, `step-rules.js` 구현, action-rules의 closeBlockReason 정리
- [ ] `005_rules.sql` 먼저 작성 (아래 4절)
- [ ] `0016_deviation_review.sql` 적용
- [ ] 002·004 시험의 이슈 닫기 사례 앞에 승인된 평가를 넣고(닫기 조건이 바뀐 만큼만), DB 시험 001~005 실행

### 2단계 작업
- [ ] `store-reviews.js`, 이슈 상세 평가 칸·버튼, 작성·다시 제출 창(근거 자동 표시: 이슈를 연 측정값·재시험 결과·공정 기록, Q33)
- [ ] 검토 창(승인·반려·보완 요청, 사유, 안내 문구), 동시 처리 문구 뒤 새로 고침
- [ ] 닫기 이유를 review-rules로

### 3단계 작업
- [ ] 승인 대기에 "품질 영향 평가 검토 대기" 표, 대시보드 승인 대기 수에 더하기
- [ ] 담당자 첫 화면 "보완 요청·반려된 내 요청"에 평가

### 4단계 작업
- [ ] 단계 표시줄·다음에 할 일 (이슈 상세 위쪽)
- [ ] 로트 상세 위쪽 요약

### 새 의존성 기록
없음.

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험, DB 시험, 화면 | `review-rules.test.js` 필수 칸, `005_rules.sql` 작성, C-01, C-02 |
| FR-002 | DB 시험, 화면 | `005_rules.sql` 검토, C-03, C-04 |
| FR-003 | DB 시험, 화면 | `005_rules.sql` 다시 제출, C-05 |
| FR-004 | 함수 시험, DB 시험, 화면 | `review-rules.test.js` 닫기 이유, `005_rules.sql` 닫기, C-06 |
| FR-005 | DB 시험, 화면 | `005_rules.sql` 출하, C-07 |
| FR-006 | 함수 시험, 화면 | `step-rules.test.js` 다음에 할 일, C-08 |
| FR-007 | 함수 시험, 화면 | `step-rules.test.js` 로트 요약, C-09 |
| FR-008 | 화면 | C-10 |
| SC-001 | 화면 | C-01, C-02 |
| SC-002 | 화면, DB 시험 | C-03, C-05, H-01 |
| SC-003 | DB 시험, 화면 | C-06 |
| SC-004 | DB 시험, 화면 | C-07 |
| SC-005 | 함수 시험, 화면 | C-08, C-09 |
| SC-006 | 화면 | C-10 |
| SC-007 | DB 시험, 회귀 | C-04, C-11 |
| SC-008 | SQL 조회 | C-12 |
| SC-009 | 업무 이력 시각 | C-12, H-01 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| checkReviewFields 빈 칸·공백 | 이탈 내용 "  " | 그 칸 오류 "이탈 내용을 입력해 주세요." | FR-001 |
| checkReviewFields 1,000자 | 1,001자 | 그 칸 오류 | FR-001 |
| checkReviewFields 근거 비움 | 근거 "" | 통과 | FR-001 |
| canWriteReview | 평가 없음·열린 이슈·QC / 열람자 / 닫힌 이슈 / 평가 있음 | 참 / 거짓 / 거짓 / 거짓 | FR-001 |
| canResubmit | 보완 요청·요청자 / 반려·요청자 / 다른 사람 / 검토 요청 | 참 / 참 / 거짓 / 거짓 (Q34) | FR-003 |
| canReview | 검토 요청·QA / 승인됨·QA / 검토 요청·QC | 참 / 거짓 / 거짓 | FR-002 |
| closeBlockReason | 평가 없음 / 미승인 / 열린 조치 / 규격 이탈·완료 조치 없음 / 관리기준 이탈·조치 없음 / 규격 이탈·완료 | 각 문구 / 각 문구 / 열린 조치 문구 / 완료 없음 문구 / null / null | FR-004 |
| issueStep 규칙 1~9 | spec FR-006 표의 9가지 상태 | 규칙대로 next·owner·stage | FR-006 |
| issueStep 관리기준 이탈 | 종류 alert | optionalAction 참 | FR-006 |
| batchSummary | 규격 이탈 1·관리기준 이탈 1, 평가 없음·검토 요청 | 수와 가장 오래된 이슈의 다음에 할 일 + "외 1건" | FR-007 |
| batchSummary 열린 이슈 0 | 시험 중 | 다음에 할 일 "내부 출하 검토" | FR-007 |

DB 시험 `005_rules.sql` 사례 (spec 3절 경계·예외 모두): 작성(QC·생산·QA 가능, 열람자 거부, 필수 칸 빈·공백·1,001자 거부, 두 번째 평가 거부, 닫힌 이슈·검토 끝난 로트 거부), 검토(QA만, 반려·보완 사유 필수, 승인·반려·보완 저장과 검토자·시각, 승인 뒤 다시 검토 거부, 검토 요청이 아닌 평가 검토 거부 = 동시 처리 문구), 다시 제출(보완·반려 → 검토 요청, 요청자만, 검토 사유 비움, 검토 요청 중 다시 제출 거부), 닫기(평가 없음·미승인 거부 문구, 관리기준 이탈 평가 승인만으로 닫힘, 규격 이탈 완료 조치 없으면 거부, 규격 이탈 평가+완료 조치로 닫히고 보류 → 시험 중, 승인 뒤 종류가 규격 이탈로 바뀐 이슈는 완료 조치 필요 Q35), 출하(규격 이탈 평가 승인·조치 미완료 → 열린 이슈로 거부, 닫았지만 마지막 값 규격 이탈 → 거부), 업무 이력 행동 이름 5개(품질 영향 평가 검토 요청·승인·반려·보완 요청·다시 제출)와 로트 연결, 표에 직접 쓰기 거부.

### 화면 눌러 보기
1. QA 확인용 QA-T-004의 열린 이슈 → "품질 영향 평가 작성" → 자동 근거 확인 → 빈 칸 제출 → 칸 옆 오류 → 채워 제출 → "검토 요청"
2. 대시보드·승인 대기에서 그 평가 확인 → 검토 창 → 보완 요청(사유 없이 → 오류, 사유 → 저장)
3. 요청자 첫 화면(QA 관리자로 확인)에서 되돌아온 평가 → 고쳐 다시 제출 → 승인(안내 문구 확인)
4. 관리기준 이탈 이슈 닫기 / 규격 이탈 이슈는 조치 없으면 이유, 조치 완료 뒤 닫기
5. 각 단계에서 단계 표시줄·다음에 할 일, 로트 상세 요약 확인, 375px

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호)
- 화면 저장 확인은 QA 확인용 로트(QA-T-004·005, 가상 백신 B)에서만 한다. 가상 백신 A와 VX-2610-001~004는 건드리지 않는다(2026-10-23 사용자 지시).

### 회귀 확인
- 함수 시험 76개: 단계마다 전체 (closeBlockReason 시험은 옮긴 뒤에도 같은 경우를 덮는다)
- DB 시험 001(41)·002(36)·003(35)·004(33): 1단계 끝과 4단계 끝. 002·004는 닫기 사례 앞에 승인된 평가를 넣은 것 말고는 그대로
- 기존 흐름: 조치 요청·승인·반려·다시 제출·결과·내부 출하 검토, 세 단계 판정 표시, 공공데이터·사용 기록 화면 열림 (2·4단계 끝)

## 5. 제약과 주의점

### 보안
- 쓰기는 함수로만. 표에는 직접 쓰기 권한이 없다(RLS 읽기만). 함수 안에서 `private.require_role`로 역할, 다시 제출은 요청자 본인 확인.
- 사람이 쓴 글(평가·사유)은 textContent로만 그린다.
- 비밀 키 없음.

### 성능
- 이슈 상세는 평가 1건을 더 읽는다. 로트 상세는 그 로트 이슈들의 평가를 한 번에 읽는다(이슈마다 따로 읽지 않음). 로트 하나 기준 1초 안.

### 호환성
- 기존과 같음.

### 지금 돌아가는 기능 깨지 않기
- 조치 요청 흐름(등록·승인·반려·다시 제출·결과·동시 처리)은 그대로.
- 닫기는 더 엄격해지기만 한다: 기존 조건(열린 조치 없음, 규격 이탈은 완료 조치) + 승인된 평가.
- 이미 닫힌 이슈와 그 이력은 그대로. 열려 있던 이슈는 평가를 받아야 닫힌다(spec 경계 상황).
- 내부 출하 검토 조건은 바꾸지 않는다.

### 경계
- 항상 할 것: 시험 먼저, 단계 끝마다 함수·DB 시험과 qa.md 기록, 출처 주석(`// FR-004 (spec 005)`), 0016 적용, QA 확인용 로트에서만 화면 저장 확인.
- 먼저 물을 것: 이 plan에 없는 표·칸 변경, 기존 자료 고치기·지우기, 가상 백신 A·VX-2610-001~004에 쓰기, 실제 자료로 되돌리기, 커밋·push·PR·배포, 새 라이브러리.
- 절대 하지 말 것: spec 5절 제외 범위(근거 목록·보완 이력 화면 FR-37, 파일 첨부, 임시 저장, 평가 승인으로 보류 풀기·출하, 알림, 전자서명, FR-38·39, FR-35), 시험을 지우거나 건너뛰어 실패 숨기기(002·004는 바뀐 규칙에 맞추는 만큼만 고친다), 비밀 키 커밋.

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 닫기 조건이 바뀌어 002·004 DB 시험의 닫기 사례가 실패 | 회귀처럼 보임 | 닫기 앞에 승인된 평가를 넣는 것만 고치고, 고친 줄을 qa.md "실패와 조치"에 남김 |
| `record_history`를 다시 만들다 다른 표의 이력이 깨짐 | 업무 이력 누락 | 0014처럼 지금 정의에서 한 줄만 바꿔 다시 만들고, DB 시험 001~004의 이력 사례로 확인 |
| 동시에 두 사람이 첫 평가 제출 | 평가 2건 | 유일 제약 + 함수에서 "이미 품질 영향 평가가 있습니다." |
| 이슈 상세 파일이 커짐 (152줄 → 200줄 넘음) | 파일 규칙 | 평가 칸을 `review-section.js`로 나눔 |
| 열린 기존 이슈(PF·QA-T·VX)가 평가 없이는 닫히지 않음 | 시연 중 혼란 | 다음에 할 일이 "품질 영향 평가 작성"으로 안내. README·사람 QA에 적음 |
| 기한(발표 10/27) | 범위 초과 | P2(FR-006~008)는 3·4단계에 두어 뒤에서부터 뺄 수 있게 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-23 | v0.1 | 처음 작성 |
| 2026-10-23 | v0.2 | 승인 |
