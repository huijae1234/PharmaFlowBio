# plan: 로그인·역할 권한과 기준 이탈 자동 판정

- 기능 ID: 001
- 상태: 완료 (2026-10-22, qa.md 완료)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-22 / 2026-10-22
- 기준 spec: ./spec.md (v0.2, 승인됨)
- 근거 문서: docs/ERD.md v0.4, docs/IA.md v1, docs/journeys/ (CUJ-01~03, E1·E2), docs/PRD.md v0.1, docs/adr/0001, docs/adr/0002, CLAUDE.md (스택·디자인)

## 0. 요약
spec 001의 FR-001~015를 6단계로 만든다. 화면은 빌드 없는 HTML/CSS/JS(ES 모듈)로, 자료·로그인·권한은 Supabase로 만든다. **기준 이탈 판정과 "측정값 저장 + 품질 이슈 생성 + 배치 상태 변경"은 데이터베이스 함수 하나 안에서 한꺼번에 처리한다.** 그래야 일부만 저장되는 일이 없고(FR-014), 화면을 거치지 않은 저장도 같은 규칙과 권한을 따른다(FR-006). 업무 이력은 데이터베이스가 표가 바뀔 때마다 자동으로 남긴다(FR-013). 1단계에서 뼈대와 함수 시험을 만들고, 2단계에서 Vercel 시험 배포로 해외 차단 위험(Intent Q6)을 먼저 확인한다.

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | HTML/CSS/JavaScript (ES 모듈, `<script type="module">`), 빌드 없음 | 브라우저 내장 | CLAUDE.md 스택. 설치·빌드 없이 바로 열림 | React+Vite (Q29에서 사용자가 유지 결정) |
| 화면 주소 | 해시 주소 `#/...` 직접 처리 | — | IA URL 전략. 정적 배포에서 새로 고침해도 404가 안 남 | 라우터 라이브러리 (필요 없음) |
| 자료·로그인·권한 | Supabase (PostgreSQL, Auth 구글 로그인, RLS) 무료 플랜, 프로젝트 `pharmaflow` (YOUR_SUPABASE_PROJECT_REF, ap-northeast-2) | 2026-10-22 생성 | ADR 0002 | 브라우저 저장 (ADR 0002에서 버림) |
| Supabase 화면용 라이브러리 | `@supabase/supabase-js` UMD, jsDelivr CDN `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js` | 2.117.3 (2026-10-07 출시, 2026-10-22 주소 응답 200 확인) | 사용자 승인(Q25). 최신 2.118.0은 출시 2주가 안 돼 한 단계 앞 정식판 | 직접 REST 호출 (로그인 처리를 다시 만들어야 함) |
| 판정·저장 묶음 | PostgreSQL 함수(RPC) + 트리거 | Supabase 기본 PostgreSQL | 한 번에 저장(FR-014), 화면 우회 차단(FR-006), 업무 이력 자동(FR-013) | 화면 JS에서 판정 후 여러 번 저장 (일부만 저장될 수 있음, 우회 가능) |
| 한글 글꼴 | Pretendard, jsDelivr `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css` | v1.3.9 (주소 응답 200 확인) | CLAUDE.md 디자인 | 시스템 글꼴만 |
| 영문·숫자 글꼴 | Plus Jakarta Sans, JetBrains Mono (Google Fonts) | Google Fonts 제공판 | CLAUDE.md 디자인 (ant 스타일) | — |
| 함수 시험 | Node 내장 `node:test` | Node v24.21.0 (`node --version` 확인) | 설치 없음. 전역 규칙 | Jest, Vitest (설치 필요) |
| 데이터베이스 시험 | SQL 시험 스크립트를 Supabase에서 트랜잭션으로 실행 후 되돌림 | — | 판정 규칙과 권한이 데이터베이스에 있으므로 거기서 시험 | pgTAP (확장 설치 필요) |
| 로컬 서버 | `server.js` (Node 내장 `http`, 정적 파일 + `api/` 함수 실행), `.env`는 `node --env-file-if-exists=.env` | Node v24.21.0 | ADR 0001. Vercel 프로그램 설치 없이 같은 함수를 돌림 | `py -m http.server` (api 함수를 못 돌림), Vercel CLI (새 도구) |
| 배포 | Vercel (Hobby), GitHub 비공개 저장소 dbdpfla98/PharmaFlow 연결, 정적 파일 + `api/` Node 함수, 지역 `icn1`, `framework: null` | 2026-10-22 배포 확인 (https://pharmaflow-iota.vercel.app) | ADR 0001 | — |
| 외부 라이브러리 (npm) | 없음 | — | `package.json`은 `"type": "module"`과 시험 명령만 둔다. 의존성 0개 | — |

**실행 환경:** Windows 11의 최신 Chrome·Edge(데스크톱), 휴대폰 폭 375px(Chrome 모바일 화면). 발표 때 청중의 휴대폰 브라우저.

## 2. 구조와 파일

### 폴더 트리
```text
PharmaFlow/
├── index.html                 (신규) 화면 틀, CDN 불러오기, 앱 시작
├── package.json               (신규) "type": "module", 시험 명령. 의존성 없음
├── server.js                  (신규) 로컬 서버: 정적 파일 + api/ 함수
├── vercel.json                (신규) 함수 지역 icn1
├── .env.example               (신규) 필요한 비밀 값 이름만 (값 없음)
├── api/
│   └── probe.js               (신규) 2단계 시험 배포용: 공공데이터 1건 호출 성공 여부만 돌려줌 (Q6 확인)
├── src/
│   ├── config.js              (신규) Supabase 주소와 공개 키(anon)
│   ├── domain/                (신규) 순수 함수 — 화면·저장·현재 시각을 직접 쓰지 않음
│   │   ├── input-rules.js     숫자 입력 해석, 기준값 범위 검사, 필수 값 검사
│   │   ├── roles.js           역할 이름, 역할별 첫 화면 주소, 역할별 할 수 있는 일
│   │   └── batch-rules.js     배치 상태 이름, 입력 가능 여부(Q11), 입력된 시험 항목 표시(Q10)
│   ├── infrastructure/        (신규)
│   │   └── store.js           Supabase 연결과 모든 읽기·쓰기·함수 호출 (저장 코드를 한 파일에)
│   └── ui/                    (신규)
│       ├── dom.js             h(), 글자 이스케이프, 상태 배지, 안내 문구
│       ├── app.js             주소 → 페이지, 로그인 확인, 역할 확인
│       ├── layout.js          사이드바, 오른쪽 위 사용자 표시, 열람자 안내
│       ├── modal.js           모달 틀 (저장 중·오류 상태, 두 번 누름 막기)
│       └── pages/
│           ├── login.js           MB_000000_PG
│           ├── home-qa.js         HM_010000_PG
│           ├── home-qc.js         HM_020000_PG
│           ├── home-production.js HM_030000_PG
│           ├── batches.js         BT_010000_PG, BT_010100_MD
│           ├── batch-detail.js    BT_010200_PG와 탭(BT_010201_TB, BT_010202_TB, BT_010204_TB)
│           ├── batch-modals.js    BT_010205_MD, BT_010206_MD, BT_010207_MD
│           ├── products.js        PD_010000_PG
│           ├── product-detail.js  PD_010200_PG, PD_010201_MD
│           └── users.js           AD_020000_PG
├── styles/
│   ├── tokens.css             (신규) 색·간격·글꼴 CSS 변수 한곳 (CLAUDE.md 디자인)
│   └── app.css                (신규) 배치·화면 모양
├── supabase/
│   ├── migrations/
│   │   ├── 0001_schema.sql    (신규) ERD 표 11개, 제약
│   │   ├── 0002_history.sql   (신규) 업무 이력 트리거, 고치기·지우기 막기
│   │   ├── 0003_rls.sql       (신규) 권한 규칙
│   │   ├── 0004_functions.sql (신규) 판정·저장 함수, 역할 지정 함수, 첫 로그인 시 profile 생성
│   │   └── 0005_seed.sql      (신규) 가상 예시 제품 3개·기준값·예시 배치
│   └── tests/
│       └── 001_rules.sql      (신규) 판정·권한·이력 시험 (실행 뒤 되돌림)
└── tests/
    ├── input-rules.test.js    (신규)
    ├── roles.test.js          (신규)
    └── batch-rules.test.js    (신규)
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| src/domain/input-rules.js | 입력 글자를 숫자로 해석, 최솟값 ≤ 최댓값 검사, 빈 값 검사 | FR-007, FR-009, FR-011, FR-012 | 화면·저장 코드를 부르지 않는다 |
| src/domain/roles.js | 역할별 첫 화면 주소, 역할별 버튼 표시 여부 (IA 권한 표) | FR-003, FR-005, FR-006 | 화면 표시용일 뿐. 실제 막기는 RLS·함수 |
| src/domain/batch-rules.js | 배치 상태 한국어 이름, 입력 가능 여부, 입력된 시험 항목 | FR-008, FR-009 (Q10·Q11) | 상태 바꾸기는 데이터베이스 함수만 |
| src/infrastructure/store.js | 로그인·로그아웃, 읽기, `record_test_measurement` 등 함수 호출, 오류를 한국어 안내로 바꿈 | 전체, FR-014 | Supabase를 부르는 곳은 이 파일 하나 |
| src/ui/dom.js | 사람이 입력한 글자는 모두 이스케이프해 그림 | 전체 | `innerHTML`에 입력값을 직접 넣지 않는다 |
| src/ui/app.js | 로그인 안 했으면 `#/login`, 권한 없는 화면은 안내 | FR-002, FR-004, FR-005 | |
| src/ui/modal.js | 저장 중 버튼 잠금, 실패 시 입력값 유지 | FR-009, FR-014 | |
| supabase/migrations/0003_functions.sql | `record_test_measurement`, `record_process_conditions`, `hold_batch`, `set_user_role`, `handle_new_user` | FR-004, FR-009~012, FR-014 | 함수 안에서 역할을 다시 확인한다 |
| supabase/migrations/0002_history.sql | 표가 바뀔 때 work_history에 한 줄, work_history 수정·삭제 거부 | FR-013 | |
| supabase/migrations/0004_rls.sql | ERD 권한 요약 표 그대로 | FR-006 | 이메일은 QA 관리자만 |
| api/probe.js | 공공데이터 허가정보 1건 호출 → `{ ok, status, ms }`만 돌려줌. 응답 본문·키는 돌려주지 않음 | (기술 확인, Intent Q6) | 기능 003에서 실제 함수로 바꾼다 |

### 자료 구조
docs/ERD.md v0.2를 그대로 쓴다. 이 기능에서 쓰는 것과 계산 값만 적는다.

| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| profile | id, display_name, email, role, created_at | ERD 그대로 | 예 | 저장 | [ERD profile] |
| product | id, item_name, main_ingredient, manufacturer | ERD 그대로 | item_name | 저장 | [ERD product] |
| specification | product_id, category, item_name, unit, min_value, max_value | ERD 그대로 | unit 빼고 예 | 저장 | [ERD specification] |
| batch | batch_number, product_id, status, hold_reason, created_by | ERD 그대로 | hold_reason 빼고 예 | 저장 | [ERD batch] |
| process_record | batch_id, production_quantity, equipment_status, recorded_by | ERD 그대로 | | 저장 | [ERD process_record] |
| measurement | batch_id, specification_id, value, result, process_record_id, quality_issue_id, measured_by | ERD 그대로 | | 저장 (result는 저장 시 함수가 계산해 저장) | [ERD measurement] |
| quality_issue | batch_id, source, status, opened_at | ERD 그대로 | | 저장 (함수가 생성) | [ERD quality_issue] |
| work_history | actor_*, action, target_*, batch_id, before_data, after_data | ERD 그대로 | | 저장 (트리거가 생성) | [ERD work_history] |
| 배치 상세 머리 | 열린 품질 이슈 수 | 정수 | — | 계산 (화면에서 읽어 셈) | [ERD batch 계산 값] |
| 시험값 입력 창 | 입력된 시험 항목 표시 | 목록 | — | 계산 (그 배치의 test 측정값) | [spec Q10] |

다른 표(action_request, handling_check, usage_log)도 0001_schema.sql에서 함께 만든다. ERD가 승인된 그대로이고, 기능 002·003에서 표를 다시 바꾸지 않기 위해서다. 화면과 함수는 이번에 만들지 않는다.

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| MB_000000_PG | 로그인 | src/ui/pages/login.js |
| HM_010000_PG | 관리자 대시보드 | src/ui/pages/home-qa.js (보류 배치, 상태별 개수만) |
| HM_020000_PG | 품질시험 홈 | src/ui/pages/home-qc.js |
| HM_030000_PG | 제조공정 홈 | src/ui/pages/home-production.js |
| BT_010000_PG | 배치 목록 | src/ui/pages/batches.js |
| BT_010100_MD | 배치 등록 | src/ui/pages/batches.js |
| BT_010200_PG | 배치 상세 | src/ui/pages/batch-detail.js |
| BT_010201_TB / BT_010202_TB / BT_010204_TB | 공정 조건 / 시험 결과 / 업무 이력 탭 | src/ui/pages/batch-detail.js |
| BT_010203_TB | 품질 이슈 탭 | 이번엔 열린 이슈 수와 목록만 (상세 이동은 기능 002) |
| BT_010205_MD / BT_010206_MD / BT_010207_MD | 공정 조건 입력 / 시험값 입력 / 배치 보류 | src/ui/pages/batch-modals.js |
| PD_010000_PG | 제품 목록 | src/ui/pages/products.js |
| PD_010200_PG / PD_010201_MD | 제품 상세 / 기준값 등록 | src/ui/pages/product-detail.js |
| AD_020000_PG | 사용자·역할 | src/ui/pages/users.js |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 뼈대와 함수 시험 | FR-003, FR-005, FR-006 (화면 표시 규칙), FR-009·011·012 (입력 검사) | 폴더 구조, tokens.css, index.html, 주소 처리, domain 함수 3개와 시험, server.js | `node --test "tests/*.test.js"` 통과, 로컬 서버로 연 빈 화면에 사이드바가 보이고 콘솔 오류 없음 | 없음 |
| 2 | Vercel 시험 배포와 해외 차단 확인 | (기술 확인) | vercel.json, api/probe.js, 배포 주소 | 배포 주소에서 1단계 화면이 열리고 `/api/probe`가 공공데이터에서 정상 응답을 받음 (실패면 원인 기록 후 대안 결정) | 배포 실행 승인, 배포 방법 (먼저 물을 것) |
| 3 | Supabase 자료 구조·권한·판정 함수 | FR-006, FR-009~015의 데이터베이스 부분 | supabase/migrations 5개 적용, 예시 자료, SQL 시험 | supabase/tests/001_rules.sql 모든 사례 통과 (경계값, 이탈 1건, 동시 이탈 1건, 권한 거부, 이력 고치기 거부, Q10·Q11) | Supabase 프로젝트 생성 승인 |
| 4 | 구글 로그인과 역할 | FR-001~006 | 로그인 화면, 첫 로그인 profile 생성, 열람자 안내, 역할별 첫 화면, 사용자·역할 화면 | SC-003, SC-004를 로컬과 배포 주소 모두에서 확인 | 사용자의 Google OAuth 클라이언트 생성, 첫 QA 관리자 지정(Q12) |
| 5 | 배치와 시험값 자동 판정 (P1 완성) | FR-008, FR-009, FR-010, FR-013, FR-014, FR-015 | 배치 목록·등록·상세, 시험값 입력, 업무 이력 탭 | SC-001, SC-002, SC-007, SC-008, SC-009 확인 | 없음 |
| 6 | 공정 조건·직접 보류·기준값 관리 (P2) | FR-007, FR-011, FR-012 | 공정 조건 입력, 배치 보류, 제품 목록·상세·기준값 등록 | SC-005, SC-006 확인, 1~5단계 회귀 확인 | 없음 |

단계마다 끝나면 `harness-qa` 절차 B로 qa.md에 결과를 남기고 커밋을 제안한다.

### 1단계 작업
- [x] `package.json` (`"type": "module"`, `"test": "node --test \"tests/*.test.js\""`), `.env.example`
- [x] `tests/input-rules.test.js` 먼저 작성 → 실패 확인 → `src/domain/input-rules.js` (숫자 해석, 범위 검사, 빈 값)
- [x] `tests/roles.test.js` 먼저 → `src/domain/roles.js` (첫 화면 주소, 버튼 표시 표)
- [x] `tests/batch-rules.test.js` 먼저 → `src/domain/batch-rules.js` (상태 이름, 입력 가능 여부, 입력된 시험 항목)
- [x] `styles/tokens.css` (ant 토큰, 글꼴, 간격), `styles/app.css` (사이드바 레이아웃, 375px 대응)
- [x] `index.html`, `src/ui/dom.js`, `src/ui/app.js`, `src/ui/layout.js` — 로그인 없이 빈 화면과 사이드바
- [x] `server.js` — 정적 파일과 `api/*.js` 실행, `.claude/launch.json` 서버를 `node --env-file-if-exists=.env server.js`로 바꿈 (승인됨). 이름은 `pharmaflow` (다른 프로젝트의 `static`과 구분)
- [x] (ponytail-review 반영) 깨진 주소 처리, `tests/server-paths.test.js`

### 2단계 작업
- [x] `vercel.json` (`"regions": ["icn1"]`)
- [x] `.vercelignore` — `.env*`, `docs/`, `tests/`, `supabase/`, `server.js` (로컬 서버의 파일 막기가 Vercel에는 적용되지 않음, ponytail-review 2)
- [x] `api/probe.js` — 허가정보 API `getDrugPrdtPrmsnInq08` 1건, `type=json`. 인증키는 환경변수에서만 읽음. Encoding 키도 받도록 한 번 풀어서 씀
- [x] 사용자가 `.env`에 인증키를 직접 넣음 (값은 대화에 쓰지 않음) → 로컬에서 `/api/probe` 확인 (resultCode 00, 응답 2~15초)
- [x] 배포 (사용자 승인 후, GitHub 비공개 저장소 + Vercel 연결), Vercel 환경변수에 인증키는 사용자가 직접 넣음 → 배포 주소에서 `/api/probe` 확인. vercel.json `framework: null` 필요했음
- [x] 결과를 Intent Q6과 ADR 0001에 기록 (차단 아님, 응답 지연)

### 3단계 작업
- [x] Supabase 프로젝트 생성 (사용자 승인 후, 무료 플랜, 지역 서울)
- [x] `0001_schema.sql` — ERD 표 11개, enum, 배치번호 고유, 기준 항목 고유, min ≤ max
- [x] `0002_history.sql` — 업무 이력 트리거(profile 역할, batch, specification, measurement, quality_issue, process_record), work_history 수정·삭제 거부
- [x] `0004_functions.sql` (적용 순서 때문에 0003과 번호를 바꿈: 표를 만든 직후 권한 규칙부터 적용) — `handle_new_user`(첫 로그인 → 열람자), `set_user_role`(QA 관리자만, 자기 역할 변경 거부), `record_test_measurement`, `record_process_conditions`, `hold_batch`, `create_batch`, `save_specification`
- [x] `0003_rls.sql` — ERD 권한 요약 표
- [x] `0005_seed.sql` — 가상 정제 3개, 기준값(Q13). 예시 배치는 `private.seed_sample_batches(사용자 id)` 함수로 4단계에서 (배치의 등록한 사람이 필수라서)
- [x] `supabase/tests/001_rules.sql` 먼저 작성 → 함수 적용 전 실패 확인 → 적용 후 통과
- [x] (Q15, 사용자 승인) `0006_issue_process_record.sql` — quality_issue.process_record_id 추가, 공정 함수가 함께 넣음. 시험 2사례 추가, 41/41
- [x] `src/config.js`에 프로젝트 주소와 공개 키(anon) 기록

### 4단계 작업
- [x] 사용자에게 Google Cloud OAuth 클라이언트 만드는 순서 안내, 사용자가 Supabase 대시보드에 클라이언트 ID·비밀 값을 직접 입력
- [x] 리디렉션 주소 등록: `http://localhost:5173`, 배포 주소
- [x] `src/infrastructure/store.js` 로그인·로그아웃·profile 읽기, `src/ui/pages/login.js`
- [x] `src/ui/app.js` 로그인 확인, 역할별 첫 화면, 역할 바뀜을 다음 화면 이동 때 다시 읽기
- [x] 열람자 안내, 홈 화면 3개(배치 기반 칸만), `users.js`
- [x] 첫 QA 관리자 지정 (사용자 계정, Q12)
- [x] 예시 배치 5개 (`private.seed_sample_batches`, 등록한 사람 = 첫 QA 관리자)
- [ ] 두 번째 구글 계정으로 열람자 화면·역할 지정 흐름 확인 (SC-003) — 사용자 계정 필요

### 5단계 작업
- [x] 배치 목록·거르기·등록, 배치 상세 머리(배치번호, 제품, 상태, 열린 이슈 수)
- [x] 시험값 입력 모달: 항목 선택 시 기준 범위·단위 표시, 입력된 항목 표시(Q10), 저장 중 잠금
- [x] 시험 결과 탭, 품질 이슈 탭(수와 목록만), 업무 이력 탭, `?tab=` 주소
- [x] 저장 실패 안내와 입력값 유지
- [x] 출하 가능·폐기 배치는 입력 버튼 숨김(Q11)

### 6단계 작업
- [x] 공정 조건 입력 모달(생산량, 기준 있는 공정 항목, 설비 상태), 공정 조건 탭
- [x] 배치 보류 모달, 상세 머리에 보류 사유
- [x] 제품 목록·상세, 기준값 등록·수정 모달 (QA 관리자만)

### 새 의존성 기록
| 이름 | 버전 | 이유 | 직접 만들 때 비용 | 버린 대안 | 승인 |
|---|---|---|---|---|---|
| @supabase/supabase-js (CDN) | 2.117.3 | 구글 로그인·세션 유지·자료 읽기 | 로그인 흐름과 토큰 갱신을 직접 만들어야 해서 하루 이상 | 직접 REST 호출 | 2026-10-22 사용자 승인 (문제정의 Q25) |
| Pretendard (CDN) | v1.3.9 | 한글 글꼴 (디자인 기본선 2) | — | 시스템 글꼴 | CLAUDE.md 디자인 결정 |
| Plus Jakarta Sans, JetBrains Mono (Google Fonts) | Google Fonts 제공판 | 영문·숫자, 배치번호·시험값 | — | — | CLAUDE.md 디자인 결정 |

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 화면 눌러 보기 | qa.md C-01 |
| FR-002 | 화면 눌러 보기 | qa.md C-02 |
| FR-003 | 함수 시험 + 화면 | roles.test.js "열람자 첫 화면", qa.md C-03 |
| FR-004 | SQL 시험 + 화면 | 001_rules.sql "역할 지정", "자기 역할 변경 거부", qa.md C-04 |
| FR-005 | 함수 시험 + 화면 | roles.test.js "역할별 첫 화면", qa.md C-05 |
| FR-006 | 함수 시험 + SQL 시험 | roles.test.js "버튼 표시 표", 001_rules.sql "권한 거부", qa.md C-06 |
| FR-007 | 함수 시험 + SQL 시험 + 화면 | input-rules.test.js "범위 검사", 001_rules.sql "기준값 변경 후 기존 판정 유지", qa.md C-07 |
| FR-008 | SQL 시험 + 화면 | 001_rules.sql "배치번호 중복", qa.md C-08 |
| FR-009 | 함수 시험 + SQL 시험 + 화면 | input-rules.test.js "숫자 해석", 001_rules.sql "경계값", "이탈 1건", qa.md C-09 |
| FR-010 | SQL 시험 | 001_rules.sql "첫 시험값 → 시험 중" |
| FR-011 | SQL 시험 + 화면 | 001_rules.sql "공정 동시 이탈 1건", "설비 이상만", qa.md C-10 |
| FR-012 | 함수 시험 + SQL 시험 | input-rules.test.js "빈 사유", 001_rules.sql "직접 보류" |
| FR-013 | SQL 시험 + 화면 | 001_rules.sql "이력 3줄", "이력 고치기 거부", qa.md C-11 |
| FR-014 | 화면 (오프라인) | qa.md C-12 |
| FR-015 | SQL 시험 + 화면 | 001_rules.sql "예시 자료", qa.md C-13 |
| SC-001 | 화면 | qa.md C-09, H-01 |
| SC-002 | SQL 시험 + 화면 | 001_rules.sql "경계값", qa.md C-09 |
| SC-003 | 화면 (계정 2개) | qa.md C-04, H-02 |
| SC-004 | SQL 시험 + 화면 | 001_rules.sql "권한 거부", qa.md C-06 |
| SC-005 | SQL 시험 + 화면 | qa.md C-10 |
| SC-006 | SQL 시험 + 화면 | qa.md C-07 |
| SC-007 | 화면 (오프라인) | qa.md C-12 |
| SC-008 | 화면 (375px) | qa.md C-13, C-14 |
| SC-009 | SQL 시험 | 001_rules.sql "이력 3줄 같은 시각", qa.md C-16 |
| (전체) | 함수 시험 전체 / SQL 시험 전체 / 시험 배포 / 판단 | qa.md C-15, C-16, C-17, H-03 |

### 함수 시험
- 도구 / 버전 / 실행 명령: Node 내장 `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 숫자 해석: 정상 | "97.2", "-5", "0.125" | 97.2, -5, 0.125 | FR-009 |
| 숫자 해석: 잘못된 값 | "", "  ", "abc", "9 8", "1e", "12,5" | 오류 "숫자로 입력해 주세요." | FR-009 |
| 범위 검사 | (98, 102), (100, 100), (102, 98) | 통과, 통과, 오류 "최솟값이 최댓값보다 클 수 없습니다." | FR-007 |
| 빈 사유 | "", "   ", "포장 라인 점검" | 오류, 오류, 통과 | FR-012 |
| 역할별 첫 화면 | 4개 역할 | `#/home/qa`, `#/home/qc`, `#/home/production`, `#/batches` | FR-005 |
| 열람자 첫 화면 | viewer | `#/batches`, 읽기 전용 안내 표시 true | FR-003 |
| 버튼 표시 표 | 역할 × 동작(시험값 입력, 공정 조건 입력, 보류, 배치 등록, 기준값 등록, 역할 지정) | IA 권한 표와 같음 | FR-006 |
| 입력 가능 여부 | 상태 5가지 | 생산 중·시험 중·보류 true, 출하 가능·폐기 false | FR-009 (Q11) |
| 입력된 시험 항목 | 측정값 목록 | 이미 측정한 항목 id 집합 | FR-009 (Q10) |

데이터베이스 시험(`supabase/tests/001_rules.sql`, 한 트랜잭션 안에서 역할을 바꿔 가며 실행하고 끝에 되돌림):
- 경계값: 98.0, 102.0 → pass / 97.99, 102.01 → out_of_spec
- 이탈 1건: 97.2 저장 → quality_issue 1개(source test), batch on_hold, work_history 3줄(시각 같음)
- 첫 시험값 → 시험 중: in_production 배치에 99.6 → in_testing
- 다른 시험 항목 이탈 → 이슈 1개 더 / 같은 항목 다시 입력 → 거부(Q10)
- 공정 동시 이탈 1건: 공정 온도 27 + 설비 이상 → 이슈 1개, 측정값 1개가 그 이슈에 연결, batch on_hold / 설비 이상만 → 이슈 1개
- 직접 보류: 사유 빈 값 거부, 사유 있으면 on_hold + hold_reason
- 출하 가능·폐기 배치 입력 거부(Q11)
- 권한 거부: production_operator의 시험값 저장, viewer의 모든 쓰기, qc_analyst의 기준값 저장 거부
- 역할 지정: qa_manager만 가능, 자기 역할 변경 거부
- 이력 고치기 거부: work_history update·delete 거부 (qa_manager 포함)
- 기준값 변경 후 기존 판정 유지
- 배치번호 중복 거부
- 예시 자료: 제품 3개, 생산 중·시험 중·보류 배치 각 1개 이상

### 화면 눌러 보기
1. 로그인 안 한 채 `#/batches/…` 열기 → 로그인 화면 (FR-002)
2. 새 구글 계정으로 로그인 → 배치 목록 + 읽기 전용 안내, 입력 버튼 없음 (CUJ-03 1·2단계)
3. QA 관리자 계정으로 사용자·역할 → 새 계정을 QC 시험 담당자로 → 새 계정이 다른 화면으로 이동 → 품질시험 홈 (CUJ-03 3·4단계)
4. QC 시험 담당자 → 품질시험 홈 → 예시 배치 → 시험값 입력 → 순도 선택 시 98.0~102.0% 표시 → 97.2 저장 → 기준 이탈, 보류, 업무 이력 3줄 (CUJ-01 1·2단계)
5. 생산 담당자 → 제조공정 홈 → 배치 → 공정 조건 입력 → 온도 27, 설비 이상 → 이슈 1개, 보류 (CUJ-02 1~3단계)
6. 375px 폭에서 4번 반복 → 가로 스크롤 없음

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호). plan 승인 직후 `harness-qa` 절차 A로 만든다.

### 회귀 확인
- 지금 동작하는 기능: 없음(코드 없음). 실행 환경만 있다.
- 단계가 쌓이면 매 단계 끝에 다시 확인: `node --test "tests/*.test.js"` 통과, `001_rules.sql` 통과(3단계부터), 화면 눌러 보기 1~3번(4단계부터), 4번(5단계부터).

## 5. 제약과 주의점

### 보안
- 화면 코드에 들어가도 되는 것: Supabase 프로젝트 주소, 공개 키(anon). RLS가 막으므로 공개돼도 된다. [ADR 0002]
- 화면 코드·저장소에 넣으면 안 되는 것: Supabase service 키, 공공데이터 인증키, Google OAuth 비밀 값. `.env`(gitignore 됨)와 Vercel 환경변수, Supabase 대시보드에만. 값은 사용자가 직접 넣고 대화에 쓰지 않는다.
- 사람이 입력한 글자(배치번호, 사유, 이름)는 `dom.js`로만 그린다. `innerHTML`에 입력값을 넣지 않는다.
- 데이터베이스 함수는 안에서 호출한 사람의 역할을 다시 확인한다. 화면 버튼 숨김은 편의일 뿐이다.
- `api/probe.js`는 응답 본문과 인증키를 돌려주지 않는다.

### 성능
- 예시 자료 규모(배치 50개 이하)에서 화면 이동 후 1초 안에 내용이 보인다 (가정, 발표 시연 기준).
- 목록은 한 번에 50개 (IA 콘텐츠 증가 대응).

### 호환성
- 최신 Chrome·Edge, 휴대폰 Chrome. ES 모듈과 `<dialog>`를 쓴다. Internet Explorer는 지원하지 않는다.

### 지금 돌아가는 기능 깨지 않기
- 코드가 아직 없다. 지켜야 할 것: `node --test "tests/*.test.js"` 명령 형식(폴더만 넘기지 않음), `.gitignore`의 `.env`.

### 경계
- 항상 할 것: 승인된 단계 안의 코드 작성·수정, 함수 시험·SQL 시험 실행, 미리보기 확인, qa.md 기록, FR 번호 주석(`// FR-009 (spec 001)`), Q번호 주석(`// Q10: 같은 시험 항목 재입력 막기`).
- 먼저 물을 것: Supabase 프로젝트 생성, Vercel 배포 실행과 배포 방법, `.claude/launch.json` 변경, ERD에 없는 표·필드 추가, 새 라이브러리, 파일 삭제, 커밋, spec 범위 바꾸기.
- 절대 하지 말 것: spec 5절 제외 범위 구현(품질 이슈 상세·조치 요청·승인·출하 판정·공공데이터 화면·사용 기록·되돌리기·배치/측정값 수정·삭제), CLAUDE.md "하지 않을 것", 비밀 값을 코드·문서·대화에 쓰기, 시험을 지우거나 건너뛰어 실패 숨기기, 실제 회사 자료 쓰기, 증거 없이 "통과" 보고.

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 공공데이터 API가 Vercel 요청을 막음 (Intent Q6) | 기능 003 전체 | 2단계에서 확인함: 막지 않음 (2026-10-22 진단). 남은 위험은 응답 지연 |
| Google OAuth 설정이 늦어짐 | 4단계 이후 전체 | 3단계와 병행해 사용자에게 먼저 안내. 막히면 Supabase 이메일 링크 로그인을 임시로 쓸지 묻기 |
| 판정 규칙이 데이터베이스와 JS에 둘로 갈라짐 | 화면과 저장 결과가 다름 | 판정은 데이터베이스 함수에만 둔다. JS는 입력 형식 검사만 |
| 트리거·RLS 실수로 업무 이력이 빠지거나 권한이 새는 경우 | 핵심 가치 훼손 | SQL 시험에 역할별 거부·이력 줄 수를 넣고 단계마다 다시 돌림 |
| 공공데이터 API가 느림 (2026-10-22 로컬 측정 2~15초, Intent Q14) | 기능 003 화면이 오래 멈춘 듯 보임, 시연 중 끊김 | 시험 함수 대기 15초. 기능 003 spec에서 불러오는 중 표시·대기 시간·짧은 저장(캐시)을 정함 |
| 일정 부족 | 발표 범위 축소 | P1(1~5단계)을 먼저 끝내고 6단계는 남는 시간에. 기능 002를 6단계보다 먼저 할지 그때 묻기 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-22 | v0.1 | 6단계 완료: 공정 조건 입력·배치 보류·제품 목록·상세·기준값 등록. 주소 해석을 id 하나로 (제품 상세 추가). 사람 QA 대기 |
| 2026-10-22 | v0.1 | 5단계 완료: 배치 목록·등록·상세·탭 4개·시험값 입력. 스타일은 styles/batch.css로 분리(300줄 규칙) |
| 2026-10-22 | v0.1 | 4단계 작업 완료 (두 번째 계정 확인만 남음). 로그인 주소 정리 순서 고침, 휴대폰 폭 고침 |
| 2026-10-22 | v0.1 | 3단계 완료: Supabase 표 11개·이력 트리거·권한·함수 7개·예시 제품. SQL 시험 39/39. 파일 번호 0003↔0004 바꿈, 예시 배치는 4단계로 |
| 2026-10-22 | v0.1 | 2단계 완료: 배포·공공데이터 연결 확인 (차단 아님, 응답 지연 0.5~15초 이상) |
| 2026-10-22 | v0.1 | 1단계 완료. 2단계에 .vercelignore 작업 추가 (새 요구사항 아님, §5 보안 이행) |
| 2026-10-22 | v0.1 | 처음 작성. 6단계. 승인 (launch.json 변경 승인 포함) |
