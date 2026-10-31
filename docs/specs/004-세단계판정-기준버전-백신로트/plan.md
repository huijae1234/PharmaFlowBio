# plan: 세 단계 판정·기준 버전·가상 백신 로트

- 기능 ID: 004
- 상태: 승인됨 (2026-10-23)
- 버전: v0.3
- 작성일 / 최종 갱신: 2026-10-23 / 2026-10-23
- 기준 spec: ./spec.md (v0.2, 승인됨)
- 근거 문서: docs/ERD.md v0.7 (specification, measurement, quality_issue, batch), docs/IA.md v2, docs/journeys/ (CUJ-01·02 v2, E6), docs/PRD.md v0.3, docs/전환-영향분석-PharmaFlow-Bio.md (§3 DB 변경안, §6 위험, §9 테스트), docs/specs/001·002·003 (plan·qa), CLAUDE.md (현재 코드)

## 0. 요약
spec 004의 FR-001~011을 5단계로 만든다. 기능 001~003과 같은 방식이다. 판정과 상태 변경은 데이터베이스 함수가 하고, 화면은 그 결과를 글자와 색으로 보여 준다. 1단계에서 DB 칸·함수·시험을 먼저 바꾼다. 관리기준이 비어 있으면 지금과 똑같이 동작하게 만들어, 기존 시험이 그대로 통과하는지로 회귀를 확인한다. 2~5단계에서 기준 화면, 판정 표시, 내부 출하 검토와 용어, 가상 백신 예시를 붙인다. 모든 DB 변경은 칸·값·함수를 **더하거나 고치기만** 하고 기존 자료를 지우지 않는다(D11). 새 라이브러리는 없다.

## 1. 기술과 버전
기능 001~003 plan §1과 같다. 바뀌는 것만 적는다.

| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | HTML/CSS/JavaScript (ES 모듈), 빌드 없음 | 브라우저 내장 | 기존과 같음 | — |
| Supabase 라이브러리 | `@supabase/supabase-js` UMD CDN | 2.117.3 (index.html) | 기존과 같음 | — |
| 판정 위치 | 데이터베이스 함수(`record_test_measurement`, `record_process_conditions`, `complete_action_request`) | Supabase 프로젝트 pharmaflow | 판정은 DB가 한다는 기존 원칙(CLAUDE.md). 화면을 거치지 않는 쓰기도 같은 판정 | 화면에서 판정해 보내기 (우회 가능) |
| 판정 값 추가 | enum `measurement_result`에 `out_of_alert`, 새 enum `issue_kind`(spec, alert) | — | ERD v0.7. **enum 값 추가와 그 값을 쓰는 함수는 다른 마이그레이션으로 나눈다**(같은 트랜잭션에서 새 enum 값을 못 씀) | 글자 칸으로 두기 (잘못된 값이 들어갈 수 있음) |
| 기준 버전 | `specification.version` 정수, 저장 함수가 값이 바뀔 때만 +1 | — | FR-002, D5 | 기준 이력 표 따로 두기 (제외 범위) |
| 함수 시험 | `node:test` | Node v24.21.0 | 기존과 같음 | — |
| 데이터베이스 시험 | `supabase/tests/004_rules.sql` (001~003과 같은 방식, 끝에서 되돌림) | — | — | — |
| 외부 라이브러리 (npm) | 없음 | — | — | — |

**실행 환경:** 기존과 같음 (최신 Chrome·Edge, 휴대폰 Chrome 375px).

## 2. 구조와 파일

### 폴더 트리
```text
PharmaFlow/
├── src/
│   ├── domain/
│   │   ├── judgement-rules.js     (신규) 판정·이슈 종류 이름, 관리기준 범위 검사, 기준 표시 글자(규격·관리기준·버전)
│   │   ├── input-rules.js         (수정 없음) checkSpecRange는 그대로 쓰고 관리기준 검사는 judgement-rules로
│   │   ├── release-rules.js       (수정) 마지막 측정값이 관리기준 이탈이어도 막지 않음
│   │   ├── action-rules.js        (수정) retestTarget이 관리기준 이탈 측정값도 찾음, 이슈 거르기에 종류
│   │   └── batch-rules.js         (수정) 주석·글자만 "로트"
│   ├── infrastructure/
│   │   ├── store.js               (수정) 기준 저장에 관리기준, 측정값·이슈 읽기에 새 칸. 오류 문구 "로트"
│   │   └── store-actions.js       (수정) 이슈 읽기에 kind, 글자
│   └── ui/
│       ├── batch-views.js         (수정) 판정 배지 세 단계, 기준 글자(규격 / 관리기준 / vN)
│       ├── issue-views.js         (수정) 이슈 종류 배지
│       ├── pages/
│       │   ├── products.js        (수정) 기준 표(규격·관리기준·버전·"교육용 가상 기준")와 기준 수정 창(관리기준 칸 2개)
│       │   ├── result-modals.js   (수정) 시험값·공정 조건 입력 창에 규격·관리기준·"교육용 가상 기준"
│       │   ├── batch-tabs.js      (수정) 시험 결과·공정 기록 탭에 그때 기준과 버전
│       │   ├── issues.js          (수정) 종류 거르기·배지
│       │   ├── issue-detail.js    (수정) 이탈 근거에 그때 기준·버전, 종류
│       │   ├── release-modal.js   (수정) 이름 "내부 출하 검토", 국가출하승인 아님 안내
│       │   └── 그 밖의 pages/*.js, layout.js, home-sections.js (수정) 화면 글자만 (FR-009)
├── styles/
│   └── batch.css, issue.css       (수정) 관리기준 이탈 배지(경고색 + 글자)
├── supabase/
│   ├── migrations/
│   │   ├── 0012_bio_types.sql     (신규) enum 값 out_of_alert, enum issue_kind, 칸 추가(기본값으로 기존 행 채움)
│   │   ├── 0013_three_level.sql   (신규) 판정·재시험·출하·기준 저장 함수 고침, 이력 행동 이름
│   │   └── 0014_vaccine_seed.sql  (신규) 가상 백신 예시 추가(한 번만), 되돌리기 예시를 가상 백신으로
│   └── tests/
│       └── 004_rules.sql          (신규)
└── tests/
    ├── judgement-rules.test.js    (신규)
    ├── release-rules.test.js      (수정) 관리기준 이탈 사례
    └── action-rules.test.js       (수정) retestTarget 관리기준 이탈 사례
```
> 파일 줄 수는 300줄 아래로 유지한다. 지금 가장 큰 파일은 `store.js` 240줄이다. 넘을 것 같으면 기준 관련 읽기·쓰기를 `store-specs.js`로 나눈다.

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `0012_bio_types.sql` | enum 값·타입 추가, 칸 추가: specification.alert_min_value·alert_max_value·version(기본 1), measurement.applied_alert_min_value·applied_alert_max_value·applied_spec_version(기본 1), quality_issue.kind(기본 spec). 관리기준 범위 검사 제약 | FR-001, 002, 004, 005 | 기존 행은 기본값으로 채워지고 값이 바뀌지 않는다. 지우는 문장 없음 |
| `0013_three_level.sql` | `save_specification` 고침(관리기준 받기·검사·버전 +1). `record_test_measurement`·`record_process_conditions` 세 단계 판정·kind·보류 규칙·applied_* 저장. `complete_action_request` 재시험 세 단계·kind 올리기(Q28). `decide_release`가 관리기준 이탈을 규격 안으로. 오류 문구 "로트" | FR-001~008 | `save_specification`은 인자가 늘어 새 함수가 된다 → 옛 7인자 함수는 같은 마이그레이션에서 지운다(화면도 같이 바뀌므로). 판정 SQL은 한 곳(`private.judge`)에 둔다 |
| `0014_vaccine_seed.sql` | `private.seed_vaccine_samples(owner)`: 가상 백신 2개·기준·로트 VX-2610-001~004 (이미 있으면 건너뜀). 한 번 실행해 지금 자료에 더함. `reset_sample_data`가 가상 백신 예시만 넣게 고침(Q32) | FR-010, 011 | 기존 PF·QA-T 자료를 지우지 않는다. 되돌리기는 실행하지 않는다 |
| `judgement-rules.js` | `resultLabel`, `issueKindLabel`, `checkAlertRange(min, max, alertMin, alertMax)`, `criteriaText(spec 또는 측정값)` | FR-001, 003, 004, 005 | 판정 자체는 하지 않는다(DB가 함) |
| `release-rules.js` | `releaseBlockers`가 `pass`·`out_of_alert`를 규격 안으로 | FR-008 | DB `decide_release`와 같은 규칙 |
| `action-rules.js` | `retestTarget`이 이슈를 연 `out_of_spec`·`out_of_alert` 측정값을 찾음 | FR-007 | DB와 같은 규칙 |
| `result-modals.js`, `batch-tabs.js`, `issue-detail.js` | 기준·판정·버전 표시 | FR-003, 004, 006, 007 | 사람 입력은 textContent로만 |
| `products.js` | 기준 표와 수정 창 | FR-001, 002 | QA 관리자만 버튼 |
| `release-modal.js` | 내부 출하 검토 | FR-008 | |
| 화면 파일 전체 | 용어 | FR-009 | 주소(`#/batches`)·코드 이름은 그대로 (D3) |

### 자료 구조
ERD v0.7 그대로. 이번에 쓰는 것만.

| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| specification | alert_min_value, alert_max_value | 숫자 | 아니오 (둘 다 비우거나 둘 다) | 저장 | [ERD specification] |
| specification | version | 정수, 기본 1 | 예 | 저장 (값이 바뀔 때 +1) | [ERD specification.version] |
| measurement | result | pass / out_of_alert / out_of_spec | 예 | 저장 (DB 판정) | [ERD measurement.result] |
| measurement | applied_alert_min_value, applied_alert_max_value | 숫자 | 아니오 | 저장 | [ERD measurement] |
| measurement | applied_spec_version | 정수, 기본 1 | 예 | 저장 | [ERD measurement] |
| quality_issue | kind | spec / alert, 기본 spec | 예 | 저장 | [ERD quality_issue.kind] |
| 기준 표시 글자 | "규격 80~125 · 관리기준 90~115 · v2" | 글자 | — | 계산 | [spec 004 FR-003·004] |

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| PD_010200_PG, PD_010201_MD | 제품 상세 기준 표, 기준 수정 | `pages/products.js` |
| BT_010206_MD, BT_010205_MD | 시험값 입력, 공정 조건 입력 | `pages/result-modals.js` |
| BT_010202_TB, BT_010201_TB | 시험 결과 탭, 공정 기록 탭 | `pages/batch-tabs.js`, `batch-views.js` |
| BT_010200_PG | 로트 상세 | `pages/batch-detail.js` |
| BT_010208_MD | 내부 출하 검토 | `pages/release-modal.js` |
| QI_010000_PG, QI_010100_PG | 품질 이슈 목록·상세 | `pages/issues.js`, `pages/issue-detail.js`, `issue-views.js` |
| QI_010104_MD | 조치 결과 입력(재시험) | `pages/action-modals.js` |
| AD_050000_PU | 예시 자료 되돌리기 | `pages/reset-modal.js` (글자만) |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | DB 세 단계 판정과 시험 (화면은 지금 그대로 동작) | FR-001~008 (DB 쪽) | 0012·0013, `004_rules.sql`, `judgement-rules.js` + 시험, release·action 규칙 고침 | DB 시험 001·002·003·004 모두 "통과 N/N", 함수 시험 전체 통과, 지금 화면에서 기존 로트 입력·출하가 그대로 됨 | 없음 |
| 2 | 기준 화면: 관리기준 입력·버전·"교육용 가상 기준" | FR-001, 002 | `products.js` 기준 표·수정 창 | 미리보기에서 관리기준 저장·거부 문구·버전 2 확인, QA 관리자 아닌 역할은 버튼 없음 | 없음 |
| 3 | 판정 표시: 입력 창·시험 결과·공정 기록·이슈 목록·상세·재시험 | FR-003~007 | result-modals, batch-tabs, batch-views, issues, issue-detail, issue-views, CSS | 미리보기에서 정상·관리기준 이탈·규격 이탈 배지(글자+색), 기준 바꾼 뒤 v1 표시, 이슈 종류 거르기 | 없음 |
| 4 | 내부 출하 검토와 용어 전환 | FR-008, 009 | release-modal, 화면 파일 글자 | 화면 글자 검사(아래 4절)에서 "배치·출하 판정·기준값·적합" 0건, 출하 창 안내 확인 | 없음 |
| 5 | 가상 백신 예시와 되돌리기 | FR-010, 011 | 0014 적용 | 로트 목록에 VX-2610-001~004가 정해진 상태로 보이고 기존 자료 수가 그대로, DB 시험 004의 되돌리기 사례 통과(시험 안에서만 실행 후 되돌림) | 없음 |

### 1단계 작업
- [ ] 함수 시험 먼저: `judgement-rules.test.js`(이름·관리기준 검사·기준 글자), `release-rules.test.js`·`action-rules.test.js`에 관리기준 이탈 사례 → 실패 확인
- [ ] `judgement-rules.js`, release·action 규칙 고쳐 통과
- [ ] `004_rules.sql` 먼저 작성(판정 경계값·보류·kind·버전·재시험 kind 올리기·출하·권한)
- [ ] `0012_bio_types.sql` 적용 → `0013_three_level.sql` 적용 (apply_migration)
- [ ] DB 시험 001·002·003·004 실행, 결과를 qa.md에
- [ ] 화면에서 `save_specification` 호출 인자를 새 함수에 맞춤(관리기준은 비워 보냄) — 2단계 전에도 기준 저장이 깨지지 않게

### 2단계 작업
- [ ] 기준 수정 창에 관리기준 최솟값·최댓값 칸, `checkAlertRange`로 칸 옆 오류
- [ ] 기준 표에 규격 / 관리기준(없으면 "없음") / 버전 / "교육용 가상 기준"

### 3단계 작업
- [ ] 시험값·공정 조건 입력 창 칸 옆에 규격·관리기준·"교육용 가상 기준"
- [ ] 판정 배지 세 단계 (정상 / 관리기준 이탈 경고색 / 규격 이탈 위험색, 글자 함께)
- [ ] 시험 결과·공정 기록 탭에 그때 기준과 vN
- [ ] 품질 이슈 목록 종류 거르기·배지, 상세에 종류·그때 기준·버전
- [ ] 재시험 결과 창의 판정 문구 세 단계

### 4단계 작업
- [ ] 내부 출하 검토 창 이름·안내, 막는 이유 문구
- [ ] 화면 파일·DB 오류 문구의 용어 바꾸기 (주소·코드 이름·이미 남은 업무 이력은 그대로)

### 5단계 작업
- [ ] `0014_vaccine_seed.sql` 작성, DB 시험 004에 예시·되돌리기 사례 추가 → 적용
- [ ] 미리보기에서 로트 목록·가상 백신 제품 확인

### 새 의존성 기록
없음.

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험, DB 시험, 화면 | `judgement-rules.test.js` checkAlertRange, `004_rules.sql` 관리기준 저장, C-01, C-02 |
| FR-002 | DB 시험, 화면 | `004_rules.sql` 버전, C-02 |
| FR-003 | DB 시험, 화면 | `004_rules.sql` 경계값, C-03, C-04 |
| FR-004 | DB 시험, 화면 | `004_rules.sql` applied_*, C-05 |
| FR-005 | DB 시험, 화면 | `004_rules.sql` kind·보류, C-04, C-06 |
| FR-006 | DB 시험, 화면 | `004_rules.sql` 공정, C-07 |
| FR-007 | 함수 시험, DB 시험 | `action-rules.test.js` retestTarget, `004_rules.sql` 재시험, C-08 |
| FR-008 | 함수 시험, DB 시험, 화면 | `release-rules.test.js`, `004_rules.sql` 출하, C-09 |
| FR-009 | 코드 검사, 화면 | C-10 |
| FR-010 | DB 시험, 화면 | `004_rules.sql` 예시, C-11 |
| FR-011 | DB 시험 | `004_rules.sql` 되돌리기, C-12 |
| SC-001 | 화면 | C-04, H-01 |
| SC-002 | 화면 | C-04, H-01 |
| SC-003 | DB 시험 | C-03 |
| SC-004 | 화면 | C-05 |
| SC-005 | 회귀 | C-13 |
| SC-006 | DB 시험, 화면 | C-08 |
| SC-007 | 화면, 코드 검사 | C-10, C-11, H-02 |
| SC-008 | 화면, DB 시험 | C-09 |
| SC-009 | DB 시험, 화면 | C-07 |
| SC-010 | DB 시험, 화면 | C-01, C-12 |
| SC-011 | DB 조회 | C-14 |
| SC-012 | 화면 | C-05 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| checkAlertRange 비움 | 규격 80~125, 관리기준 둘 다 빈칸 | 통과(관리기준 없음) | FR-001 |
| checkAlertRange 안쪽 | 80~125 / 90~115 | 통과 | FR-001 |
| checkAlertRange 같음 | 80~125 / 80~125 | 통과 | FR-001 |
| checkAlertRange 한쪽만 | 90 / 빈칸 | 오류 문구 | FR-001 |
| checkAlertRange 규격 밖 | 80~125 / 70~115 | 오류 문구 | FR-001 |
| checkAlertRange 뒤집힘 | 115 / 90 | 오류 문구 | FR-001 |
| resultLabel | pass·out_of_alert·out_of_spec | 정상·관리기준 이탈·규격 이탈 | FR-003 |
| issueKindLabel | spec·alert | 규격 이탈·관리기준 이탈 | FR-005 |
| criteriaText | 측정값(applied_*, 버전 1, 관리기준 없음) | "규격 95~105 · 관리기준 없음 · v1" | FR-004 |
| releaseBlockers 관리기준 이탈 | 열린 이슈 0, 마지막 값 out_of_alert | 막는 이유 없음 | FR-008 |
| releaseBlockers 규격 이탈 | 마지막 값 out_of_spec | 막는 이유 있음 | FR-008 |
| retestTarget 관리기준 이탈 | 이슈를 연 측정값 out_of_alert | 그 시험 항목 | FR-007 |

DB 시험 `004_rules.sql` 사례 (spec 3절 경계·예외 모두): 규격 경계(80·125 → 관리기준 이탈), 관리기준 경계(90·115 → 정상), 관리기준 없음(95·105 정상, 94·106 규격 이탈), 관리기준 이탈 → 이슈 alert 1개·보류 없음, 규격 이탈 → 이슈 spec 1개·보류, 공정 섞임 → spec 1개, 설비 이상 → spec, 관리기준 한쪽만·규격 밖·뒤집힘 거부, 값 그대로 저장 → 버전 그대로, 값 바꿈 → 버전 +1, 기준 바꾼 뒤 기존 측정값 applied_* 그대로, 재시험 alert → 규격 이탈 → kind spec·보류·새 이슈 없음, spec 이슈 재시험 관리기준 이탈 → kind 그대로·완료(Q28), 출하: 열린 alert 이슈 → 거부 / 마지막 값 out_of_alert·이슈 없음 → 허용, QC 역할의 기준 저장 거부, (5단계) 예시 한 번 더 실행 → 로트 중복 없음, 되돌리기 → VX 예시만·업무 이력 수 줄지 않음.

### 화면 눌러 보기
1. QA 관리자로 가상 백신 A 상세 → 역가 기준 수정, 관리기준 70~115 → 거부 문구 / 90~115 → 저장, 버전 2
2. VX-2610-002 → 시험값 입력 창에 규격·관리기준·"교육용 가상 기준" → 역가 85 → "관리기준 이탈", 로트 "시험 중", 이슈 1개
3. 다른 로트에 79 → "규격 이탈", "보류"
4. 기준을 고친 뒤 시험 결과 탭 → 예전 값 옆 v1
5. 품질 이슈 목록 → 종류로 거르기
6. 관리기준 이탈 이슈만 있는 로트 → 내부 출하 검토 → "국가출하승인이 아닙니다", 출하 가능 막힘
7. 휴대폰 폭 375px에서 2·4·6

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호)

### 회귀 확인
- 함수 시험 68개: 단계마다 전체 실행
- DB 시험 001(41)·002(36)·003(35): 1단계와 5단계 끝에 실행. 관리기준이 없는 기존 판정이 같은지가 핵심
- 기존 흐름: PF-2610 로트 시험값 입력 → 이슈 → 조치 요청·승인·재시험 → 이슈 닫기 → 출하 (미리보기, 4단계 끝)
- 공공데이터·사용 기록·MSDS 링크 화면이 열리는지 (4단계 끝, 글자 바꾼 뒤)

## 5. 제약과 주의점

### 보안
- 비밀 키 없음. 화면에는 공개 키만(기존과 같음).
- 판정·보류·kind·버전은 DB 함수만 바꾼다. 표에 직접 쓰는 권한은 그대로 없음.
- 사람 입력 글자는 textContent로만.

### 성능
- 판정은 저장 한 번 안에서 끝난다. 기준 표·시험 결과 탭은 지금처럼 로트 하나 기준 1초 안에 보인다 (항목 수십 개 규모).

### 호환성
- 기존과 같음 (Chrome·Edge, 휴대폰 375px).

### 지금 돌아가는 기능 깨지 않기
- 관리기준이 없는 기준: 판정·이슈·보류·출하가 지금과 같다 (DB 시험 001·002 그대로 통과).
- 기존 측정값·이슈·업무 이력은 값이 바뀌지 않는다(새 칸은 기본값으로만 채움).
- 주소 `#/batches/...`, 코드·표 이름 그대로.
- 조치 요청·승인·반려·다시 제출·동시 처리 막기, 공공데이터·사용 기록·되돌리기 확인 창.

### 경계
- 항상 할 것: 시험 먼저 쓰기, 단계 끝마다 함수·DB 시험 실행과 qa.md 기록, 출처 주석(`// FR-003 (spec 004)`), 마이그레이션 적용(이 plan의 0012~0014 범위 안).
- 먼저 물을 것: 이 plan에 없는 표·칸 변경, 기존 자료를 고치거나 지우는 문장, 실제 자료에 되돌리기 실행, 커밋·push·PR·배포, 새 라이브러리.
- 절대 하지 말 것: spec 5절 제외 범위(품질 영향 평가·닫기 조건 바꾸기·단계 표시줄, 백신 허가정보 거르기, 기준 이력 화면, 표·주소 이름 바꾸기, 업무 이력 글자 고치기, 관리기준 이탈 자동 보류, 실제 법정 규격 사용, 기존 자료 삭제), 시험을 지우거나 건너뛰어 실패 숨기기, 비밀 키 커밋.

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| enum 값 추가와 사용을 한 마이그레이션에 둠 | 적용 실패 | 0012(값 추가)와 0013(함수)으로 나눔 |
| `save_specification` 인자 변경 | 2단계 전 기준 저장 깨짐 | 1단계에서 화면 호출도 새 인자로 맞추고 미리보기로 확인 |
| 판정 SQL이 함수 3개에 흩어짐 | 규칙이 어긋남 | `private.judge(값, 기준)` 하나를 세 함수가 부름, DB 시험으로 경계값 확인 |
| 이슈를 연 측정값 찾기(재시험)가 out_of_spec만 봄 | 관리기준 이탈 이슈 재시험 불가 | 0013에서 두 값 모두, 함수 시험·DB 시험 |
| 용어를 바꾸다 주소·코드 이름까지 바꿈 | 링크 깨짐 | 화면 글자만, 4단계 끝에 주소 열기 회귀 |
| 예시 넣기가 실제 자료와 섞임 | 혼동 | 로트번호 VX-로 구분, "교육용 가상" 표시, 이미 있으면 건너뜀 |
| 날짜가 촉박(발표 10/27) | 범위 초과 | P2(FR-006·011)를 뒤로 뺄 수 있게 단계 3·5 안에서 마지막에 둠 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-23 | v0.1 | 처음 작성 |
| 2026-10-23 | v0.2 | 승인 |
| 2026-10-23 | v0.3 | 4단계: DB 문구·이력 이름 바꾸기를 마이그레이션 0014_terms로 따로 둠 → 가상 백신 예시는 0015_vaccine_seed (범위 변화 없음, 번호만) |
