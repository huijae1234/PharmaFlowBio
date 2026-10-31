# plan: 공공데이터·MSDS·사용 기록·예시 자료 되돌리기

- 기능 ID: 003
- 상태: 승인됨 (2026-10-22)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-22 / 2026-10-22
- 기준 spec: ./spec.md (v0.3)
- 근거 문서: docs/ERD.md v0.6 (product, handling_check, usage_log, work_history.batch_number), docs/IA.md v1, docs/journeys/edge-cases/에러-복구.md (E4), docs/adr/0001 (Vercel 함수로 대신 호출), docs/adr/0002 (Supabase·RLS), docs/specs/001·002 plan (지금 구조)

## 0. 요약
FR-001~010을 6단계로 만든다. 공공데이터는 지금처럼 `api/` 함수가 인증키를 붙여 대신 부르고, 화면은 그 함수만 부른다. 함수는 로그인한 사람의 요청만 받는다. 쓰기는 기능 001·002처럼 데이터베이스 함수로만 한다. 새 라이브러리는 들이지 않는다. 순서는 PRD 9절대로 허가정보·회수 → 실패 견디기 → MSDS → 사용 기록 → 되돌리기이고, 시간이 모자라면 뒤에서부터 뺀다.

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 화면 | 빌드 없는 HTML/CSS/JavaScript (ES 모듈) | — | 기능 001·002와 같음 [CLAUDE.md 스택] | React 전환 (마감 전 위험) |
| 공공데이터 대신 호출 | `api/*.js` Vercel 함수 (Node), 로컬은 `server.js` | Node v24.21.0 (`node --version`) | 인증키를 화면에 두지 않음 [ADR 0001] | 브라우저에서 바로 호출 (키 노출) |
| 호출 | Node 내장 `fetch` + `AbortSignal.timeout(15000)` | Node 24 내장 | Q14: 15초 넘으면 실패 | 다시 시도를 함수가 자동으로 (시간이 더 길어짐) |
| MSDS 응답 해석 | 직접 만든 작은 XML 읽기 (평평한 `<item>` 목록만) | — | MSDS는 XML만 준다 [ADR 0001]. 필요한 칸이 몇 개뿐 | XML 라이브러리 (의존성 늘어남) |
| 함수의 로그인 확인 | Supabase `/auth/v1/user`에 화면이 보낸 접근 토큰을 넘겨 확인 | supabase-js 2.117.3과 같은 Supabase 프로젝트 | 로그인하지 않은 사람이 우리 키로 한도(10,000·2,000건)를 쓰지 못하게 | 확인 없이 열어 두기 |
| 저장소·권한 | Supabase Postgres, RLS, SECURITY DEFINER 함수 | 기능 001·002와 같음 | [ADR 0002] | — |
| 함수 시험 | Node 내장 `node:test` | Node v24.21.0 | 설치 없음 | — |
| DB 시험 | `supabase/tests/003_rules.sql` (DO 블록, 끝에 일부러 오류로 되돌림) | — | 001·002와 같은 방식 | — |

**실행 환경:** PC Chrome·Edge (발표), 휴대폰 폭 375px 확인. 로컬 `http://localhost:5174`, 배포 `pharmaflow-iota.vercel.app` (배포는 사용자가 말할 때만).

## 2. 구조와 파일

### 폴더 트리
```text
api/
├── _public-data.js      (신규) 공공데이터 공통: 키 정리, 15초 제한, 로그인 확인, 오류를 안전한 문구로
├── permit.js            (신규) 허가정보 검색 (품목명 / 품목기준코드)
├── recall.js            (신규) 회수·판매중지 (제품명 + 품목기준코드로 거르기, 최근 5건)
├── msds.js              (신규, 4단계) 물질 검색 (국문명 / CAS 번호). Q24 결과에 따라
└── probe.js             (삭제) 연결 확인용이었다 (plan 001 2단계). permit.js가 대신한다
src/
├── domain/
│   ├── public-data-rules.js (신규) 응답 항목 → 화면용 모양, 회수 공지 맞추기(Q25), 검색어 검사
│   ├── msds-rules.js        (신규, 4단계) XML 읽기, 취급점검 입력 검사
│   └── usage-rules.js       (신규, 5단계) 사용 기록 한 줄 만들기, 종류 이름
├── infrastructure/
│   ├── public-data.js       (신규) 화면 → api/ 함수 호출 (토큰 붙이기, 걸린 시간 재기, 사용 기록 남기기)
│   ├── store-products.js    (신규) 제품 등록·취급점검·되돌리기 rpc, 사용 기록 읽기·쓰기
│   └── store.js             (수정) 접근 토큰 꺼내기
├── ui/
│   ├── public-panel.js      (신규) "불러오는 중 / 실패 + 다시 시도 / 내용" 칸 하나 (FR-004)
│   ├── pages/products.js    (수정) 제품 등록 버튼, 허가정보·회수 이력 탭
│   ├── pages/product-modals.js (신규) 제품 등록 모달 (허가정보 검색)
│   ├── pages/msds.js        (신규, 4단계) 물질 검색·물질 상세·취급점검 모달
│   ├── pages/usage.js       (신규, 5단계) 사용 기록 화면
│   ├── pages/reset-modal.js (신규, 6단계) 예시 자료 되돌리기 확인 창
│   ├── home-sections.js     (수정) 최근 회수 공지 5건
│   ├── route.js             (수정) #/msds/:chemId
│   └── app.js, layout.js    (수정) 새 주소·관리 메뉴, 화면 이동 기록
server.js                    (수정) `_`로 시작하는 api 파일은 404
supabase/
├── migrations/0010_feature003.sql (신규) work_history.batch_number, create_product, save_handling_check, 이력 행동 이름
├── migrations/0011_reset.sql      (신규, 6단계) reset_sample_data
└── tests/003_rules.sql            (신규)
tests/
├── public-data-rules.test.js, msds-rules.test.js, usage-rules.test.js, public-data-api.test.js (신규)
└── server-paths.test.js (수정) `_` 파일 막기
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| api/_public-data.js | 인증키 정리(Encoding·Decoding 모두), 15초 제한, Supabase 토큰 확인, `{ ok, items, totalCount }` 또는 `{ ok:false, reason }`로만 응답 | FR-004 | 응답·오류 문구·로그에 인증키를 넣지 않는다. Vercel은 `_` 파일을 함수로 만들지 않는다 |
| api/permit.js | `?name=`으로 허가정보 (item_seq 요청 변수는 무시돼 2단계에서 뺐다)(`getDrugPrdtPrmsnInq08`) 최대 10건 | FR-001, FR-002 | 응답 항목은 2026-10-22 확인값 (ITEM_SEQ, ITEM_NAME, ENTP_NAME, ITEM_INGR_NAME, SPCLTY_PBLC, ITEM_PERMIT_DATE, CANCEL_NAME) |
| api/recall.js | `?name=&code=`(제품 상세) 또는 `?recent=5`(대시보드)로 회수·판매중지(`getMdcinRtrvlSleStpgeItem05`, `Prduct`) | FR-002, FR-003 | 응답이 `items[].item` 모양 (허가정보와 다름) |
| api/msds.js | `?q=&by=name|cas`로 물질 목록. XML → JSON | FR-005 | Q24: 주소가 확인되기 전에는 만들지 않는다 |
| public-data-rules.js | 허가·회수 응답 정리, 날짜 "20261021" → "2026-10-21", 회수 공지를 품목기준코드로 거르기(Q25), 최근순 | FR-001~003 | 순수 함수 |
| public-data.js (infrastructure) | 접근 토큰을 붙여 `/api/*` 호출, 걸린 시간 재기, 성공·실패를 사용 기록으로 | FR-004, FR-008 | 사용 기록 저장 실패는 화면을 막지 않는다 (FR-008 수용 기준 5) |
| public-panel.js | 칸 하나: 불러오는 중 → 내용 / 실패 안내 + 다시 시도 (그 칸만 다시) | FR-004 | 다른 칸과 따로 불러온다 |
| product-modals.js | 품목명 검색 → 결과 표(품목명·주성분·제조원) → 고르면 등록 | FR-001 | 등록은 create_product rpc |
| store-products.js | create_product, save_handling_check, reset_sample_data rpc, usage_log 읽기·쓰기, handling_check 읽기 | FR-001, FR-007~010 | usage_log 쓰기는 RLS "본인 기록만 추가" |
| usage-rules.js | 화면 이동·검색·호출 기록 한 줄(사용자 ID만, 이메일 없음), 종류 이름 | FR-008, FR-009 | 같은 주소를 연달아 두 번 남기지 않는다 |
| 0010_feature003.sql | work_history.batch_number 추가와 채우기, 이력 트리거가 배치번호도 남기기, `create_product`(QA, 같은 품목기준코드 거부), `save_handling_check`(QC·생산·QA, 빈 값 거부), 이력 행동 이름(제품 등록·취급점검 기록) | FR-001, FR-007, FR-010 | ERD v0.6 |
| 0011_reset.sql | `reset_sample_data()`(QA): 되돌리는 동안 이력 트리거를 멈추고, 업무 이력의 batch_id만 비운 뒤 업무 자료를 지우고 예시 제품 기준값·예시 배치를 다시 넣고, "예시 자료 되돌리기" 1줄을 남긴다 | FR-010 | 사용자·역할·사용 기록·업무 이력은 지우지 않는다 (Q27) |

### 자료 구조
| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| 제품 | item_name, main_ingredient, manufacturer, permit_item_code | 글 | 품목명 | 저장 (허가정보에서 한 번 옮김) | [ERD product] [spec 003 Q26] |
| 허가정보 | 품목명, 업체명, 주성분, 전문·일반, 허가일, 취소 상태 | 글 | — | 저장 안 함 (열 때마다) | [spec 003 FR-002] [PRD §9] |
| 회수 공지 | 제품명, 업체명, 회수 사유, 회수 명령일, 제조번호, 품목기준코드 | 글 | — | 저장 안 함 | [spec 003 FR-002·003, Q25] |
| 취급점검 기록 | chem_id, chem_name, cas_no, check_content, protective_measures, checked_by, checked_at | 글·시각 | cas_no 빼고 | 저장 | [ERD handling_check] |
| 사용 기록 | user_id, event_type, path, search_term, api_name, success, duration_ms | | user_id·event_type | 저장 | [ERD usage_log] |
| 업무 이력 | batch_number | 글 | 아니오 | 저장 (트리거가 채움) | [ERD v0.6 work_history.batch_number] |

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| PD_010100_MD | 제품 등록 | src/ui/pages/product-modals.js |
| PD_010202_TB | 허가정보·회수 이력 | src/ui/pages/products.js (`?tab=public`) |
| HM_010000_PG | 관리자 대시보드 (최근 회수 공지) | src/ui/home-sections.js, pages/homes.js |
| MS_010000_PG / MS_010100_PG / MS_010101_MD / MS_010102_LK | 물질 검색 / 물질 상세 / 취급점검 기록 작성 / 공단 MSDS 상세 | src/ui/pages/msds.js |
| AD_040000_PG | 사용 기록 | src/ui/pages/usage.js (`#/admin/usage`) |
| AD_050000_PU | 예시 자료 되돌리기 | src/ui/pages/reset-modal.js (관리 메뉴) |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | DB와 공공데이터 함수 기반 | FR-001·007·010의 저장 부분, FR-004의 함수 부분 | 0010 적용, 003_rules.sql, api/_public-data·permit·recall, probe 삭제 | 003_rules.sql 모든 사례 통과, 001(41)·002(36) 회귀 통과, 로그인 토큰 없이 `/api/permit` → 401, 있으면 "타이레놀" 결과, 응답에 인증키 없음 | 없음 |
| 2 | 허가정보로 제품 등록, 허가정보·회수 탭, 실패 견디기 | FR-001, FR-002, FR-004 | product-modals.js, products.js 탭, public-panel.js | SC-001 확인, 인증키를 비운 서버에서 탭에만 실패 안내(SC-002 일부), SC-003 | 없음 |
| 3 | 관리자 대시보드 최근 회수 공지 | FR-003 | home-sections.js 보강 | 대시보드에 5건, 실패 시 그 칸만 안내 | 없음 |
| 4 | MSDS 물질 검색·상세·취급점검 기록 | FR-005, FR-006, FR-007 | api/msds.js, msds.js | SC-004 확인 | **Q24** (사용자 확인 중). 안 되면 이 단계는 물질 검색 화면에 공단 MSDS 사이트 링크만 두고 FR-005~007을 다음으로 미룬다(spec 수정 승인 후) |
| 5 | 사용 기록 남기기·화면 | FR-008, FR-009 | usage-rules.js, public-data.js 기록, usage.js | SC-005 확인, SC-002의 "실패가 사용 기록에 남는다" 확인 | 없음 |
| 6 | 예시 자료 되돌리기, 1~5단계 회귀 | FR-010 | 0011, reset-modal.js | SC-006 확인, 되돌린 뒤 기능 001·002 핵심 흐름(시험값 입력 → 이슈 → 조치 → 출하 판정)이 다시 된다 | 없음 |

단계마다 끝나면 `harness-qa` 절차 B로 qa.md에 결과를 남기고 커밋을 제안한다.

### 1단계 작업
- [x] `supabase/tests/003_rules.sql` 먼저 작성 → 함수 없이 실패 확인
- [x] `0010_feature003.sql`:
  - work_history.batch_number 추가, 기존 행을 배치번호로 채움, 이력 트리거가 함께 남기게
  - `create_product(item_name, main_ingredient, manufacturer, permit_item_code)` — QA만, 품목명 필수, 같은 품목기준코드면 "이미 등록된 제품입니다."
  - `save_handling_check(chem_id, chem_name, cas_no, check_content, protective_measures)` — QC·생산·QA, 공백만이면 빈 값
  - 이력 행동 이름: 제품 등록, 취급점검 기록
- [x] `tests/public-data-api.test.js`, `tests/server-paths.test.js` 먼저 → `api/_public-data.js`(키 정리·응답 정리·토큰 확인), `permit.js`, `recall.js`, server.js `_` 파일 막기
- [x] `api/probe.js` 지우기 (승인 받은 plan 안의 삭제)
- [x] 로컬에서 토큰 없이/있이 호출, 응답 본문에 인증키가 없는지 확인

### 2단계 작업
- [x] `tests/public-data-rules.test.js` 먼저 → `public-data-rules.js`
- [x] `public-panel.js` (불러오는 중 / 실패 + 다시 시도 / 내용)
- [x] 제품 등록 모달 (QA 관리자만), 제품 상세 허가정보·회수 이력 탭

### 3단계 작업
- [x] 관리자 대시보드 "최근 회수 공지" (public-panel 사용)

### 4단계 작업 — v0.2(2026-10-22): Q24 미해결로 링크만 (spec v0.3, D13)
- [x] 물질 검색 화면(#/msds)에 공단 MSDS 사이트 안내·새 창 링크
- 아래는 미룸
- [ ] `tests/msds-rules.test.js` 먼저 → XML 읽기, 취급점검 입력 검사
- [ ] `api/msds.js`, 물질 검색·물질 상세·취급점검 모달, #/msds/:chemId

### 5단계 작업
- [x] `tests/usage-rules.test.js` 먼저 → `usage-rules.js`
- [x] 로그인·로그아웃·화면 이동·검색·공공데이터 호출 기록 (저장 실패는 화면을 막지 않음)
- [x] 사용 기록 화면 #/admin/usage (QA 관리자만, 50개씩, 사람·종류 거르기)

### 6단계 작업
- [x] `003_rules.sql`에 되돌리기 사례 추가 → `0011_reset.sql`
- [x] 되돌리기 확인 창 ("되돌리기" 입력해야 실행). 관리 메뉴는 링크라 #/admin/reset 안내 화면에서 팝업을 연다
- [ ] 되돌린 뒤 기능 001·002 핵심 흐름 다시 확인 (DB 시험으로는 확인. 화면 실행은 기능 002 사람 QA 뒤)

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | DB 시험 + 화면 | 003_rules.sql "제품 등록", C-01 |
| FR-002 | 함수 시험 + 화면 | public-data-rules "회수 공지 맞추기", C-02 |
| FR-003 | 화면 | C-03 |
| FR-004 | 함수 시험 + 화면 + 코드 검사 | public-data-api "키 감추기·시간 초과·토큰 없음", C-04, C-05 |
| FR-005 | 함수 시험 + 화면 | msds-rules "XML 읽기", C-06 |
| FR-006 | 화면 | C-06 |
| FR-007 | DB 시험 + 화면 | 003_rules.sql "취급점검", C-07 |
| FR-008 | 함수 시험 + 화면 + SQL | usage-rules "기록 한 줄", C-08 |
| FR-009 | 화면 | C-09 |
| FR-010 | DB 시험 + 화면 | 003_rules.sql "되돌리기", C-10 |
| SC-001 | 화면 한 바퀴 | C-01, C-02, H-01 |
| SC-002 | 인증키 비운 로컬 서버로 화면 | C-05 |
| SC-003 | 코드 검색 + 응답 확인 | C-04 |
| SC-004 | 화면 | C-06, C-07 |
| SC-005 | 화면 + SQL | C-08, C-09 |
| SC-006 | DB 시험 + 화면 | C-10 |
| SC-007 | 사용 기록 걸린 시간 10번 | C-11, H-02 |

### 함수 시험
- 도구 / 버전 / 실행 명령: Node 내장 `node:test` / v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 인증키 정리 | `%2B`가 든 키, 든 것 없는 키, 빈 값 | 한 번만 풀림, 빈 값은 "키 없음" | FR-004 |
| 응답에 키가 없음 | 공공데이터가 오류 문구에 요청 주소를 되돌려 줌 | 함수 응답에 키 글자가 없음 | FR-004, SC-003 |
| 시간 초과·연결 실패·오류 코드 | 15초 초과, 네트워크 오류, resultCode ≠ "00" | `{ ok:false, reason }` (안전한 문구) | FR-004 |
| 토큰 없음·틀림 | Authorization 없음, 확인 실패 | 401, 공공데이터를 부르지 않음 | FR-004 |
| 허가 응답 정리 | 2026-10-22 실제 응답 모양 | 품목명·업체명·주성분·구분·허가일(YYYY-MM-DD)·취소 상태 | FR-001, FR-002 |
| 회수 공지 맞추기 | 같은 이름 다른 품목기준코드 섞임, 0건, 날짜 섞임 | 같은 코드만, 최근순 | FR-002, Q25 |
| 최근 회수 5건 | 7건 | 최근순 5건 | FR-003 |
| 검색어 검사 | 빈 값, 공백만, 1글자 | 빈 값은 "품목명을 입력해 주세요.", 1글자는 통과 | FR-001 |
| MSDS XML 읽기 | `<item>` 2개, 0개, 특수문자(&amp;) | 물질 목록, 빈 목록, 글자 복원 | FR-005 |
| 취급점검 입력 | 공백만, 500자 넘음 | 빈 값 안내, 500자 제한 | FR-007 |
| 사용 기록 한 줄 | 화면 이동·검색·호출 | user_id만(이메일 없음), 종류별 칸, 같은 주소 연달아 안 남김 | FR-008 |
| server `_` 파일 | `/api/_public-data` | 404 | FR-004 |

DB 시험 `003_rules.sql`: QA만 제품 등록·같은 코드 거부·빈 품목명 거부, 취급점검 역할·빈 값·열람자 거부, batch_number가 이력에 채워짐, 되돌리기(QA만, 예시 배치 5개, 사용자·역할·사용 기록 유지, 업무 이력 행 수가 줄지 않음 + 1줄, batch_id 비움·batch_number 남음), 001·002 회귀.

### 화면 눌러 보기
1. QA 관리자 > 제품 > 제품 등록 > "타이레놀" 검색 → 결과 표, 하나 골라 등록 → 제품 목록에 보임
2. 그 제품 상세 > 허가정보·회수 이력 → 불러오는 중 → 허가정보, 회수 공지(없으면 없다는 안내)
3. 예시 제품 상세 > 같은 탭 → "허가정보로 등록한 제품만…"
4. `.env` 인증키를 비운 서버로 2를 다시 → 그 칸만 실패 안내, 기준값 표는 정상, 다시 시도
5. 관리자 대시보드 → 최근 회수 공지 5건
6. MSDS > "벤젠" 검색 → 물질 상세 → 공단 링크 새 창, 취급점검 기록 저장 → 목록
7. 관리 > 사용 기록 → 위 동작이 종류별로, 실패는 "실패"
8. 관리 > 예시 자료 되돌리기 → "되돌리기" 입력 → 배치 목록이 예시 5개, 사용자·역할 그대로

### QA
- `qa.md` 참고 (Claude QA C-번호, 사람 QA H-번호)

### 회귀 확인
- 함수 시험 전체: `node --test "tests/*.test.js"` (지금 47개 + 새 시험)
- DB 시험: 001_rules.sql 41/41, 002_rules.sql 36/36
- 화면: 로그인 → 역할별 첫 화면, 배치 상세 시험값 입력 → 기준 이탈 → 품질 이슈 → 조치 요청 → 승인 → 결과 → 이슈 닫기 → 출하 판정 (되돌리기 뒤 예시 배치로 한 번)
- 제품 상세 기준값 등록·수정이 허가정보 탭을 더해도 그대로 된다

## 5. 제약과 주의점

### 보안
- 공공데이터 인증키는 `.env`와 Vercel 환경변수에만. 함수 응답·오류·콘솔 로그에 넣지 않는다 [ADR 0001]
- 함수는 Supabase 접근 토큰을 확인한 요청만 받는다 (한도 보호). 토큰은 확인에만 쓰고 저장하지 않는다
- 사용 기록에는 이메일을 넣지 않는다 [ERD usage_log]
- 공공데이터에서 온 글자도 사람 입력처럼 `h()`/`put()`으로만 그린다 [CLAUDE.md 현재 코드]
- 되돌리기는 QA 관리자만, 데이터베이스 함수 안에서 역할을 확인한다

### 성능
- 공공데이터는 칸마다 따로 부른다. 한 칸이 15초 걸려도 다른 칸과 화면 나머지는 먼저 보인다 (Q14)
- 결과를 저장해 두지 않는다 (PRD §9). 같은 화면을 다시 열면 다시 부른다
- 개발계정 한도: 허가정보 10,000·회수 10,000·MSDS 2,000건/일. 발표 준비 중 반복 호출에 주의

### 호환성
- 기존 주소(#/products/:id)는 그대로, 탭만 `?tab=public` 추가
- `api/probe.js`를 지우므로 그 주소를 쓰던 곳이 없는지 확인 (지금은 없음)

### 지금 돌아가는 기능 깨지 않기
- 이력 트리거를 바꿀 때 기존 행동 이름·batch_id 채우기는 그대로 두고 batch_number만 더한다
- 되돌리기는 업무 이력을 지우지 않는다. 트리거를 멈추는 것은 그 함수 안에서만 한다

### 경계
- 항상 할 것: 시험 먼저, 단계마다 qa.md 기록, 공공데이터 칸마다 불러오는 중·실패 처리, 화면 글자는 `h()`/`put()`
- 먼저 물을 것: Q24 결과에 따른 4단계 범위, `supabase/` 새 마이그레이션 적용(단계마다 보고), 커밋·push·배포, Vercel 환경변수 변경, ERD에 없는 칸 추가
- 절대 하지 말 것:
  - 공공데이터를 데이터베이스에 대량으로 복사하거나 결과를 오래 저장해 두기 [spec §5]
  - 앱 안에서 MSDS 상세(유해·위험 문구·보호구)를 그리기 [spec §5, Q7]
  - 회수 공지를 메일·푸시로 알리기 [spec §5]
  - 제품 정보 직접 입력·수정·삭제 화면 [spec §5, Q26]
  - 사용 기록 내려받기·차트 [spec §5]
  - 되돌리기 전 백업 만들기 [spec §5]
  - 인증키를 코드·문서·대화에 쓰기, 업무 이력 지우기

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 공공데이터가 발표 중 15초 넘게 걸림 (Intent Q14) | 시연이 끊김 | 칸만 실패 안내 + 다시 시도, 핵심 흐름(CUJ-01)은 공공데이터 없이 끝까지 된다 |
| MSDS 키가 끝내 안 됨 (Q24) | FR-005~007 못 함 | 공단 사이트 링크만 두고 spec 수정 승인 후 미룸 |
| 되돌리기 중 트리거·제약 충돌 | 자료가 반쯤 지워짐 | 한 데이터베이스 함수(한 트랜잭션) 안에서 하고, 실패하면 전부 되돌아간다. DB 시험으로 먼저 확인 |
| 함수의 토큰 확인이 Supabase 장애로 실패 | 공공데이터 칸 전부 실패 | 실패 안내와 다시 시도로 처리 (다른 화면은 영향 없음) |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-22 | v0.2 | 4단계를 공단 MSDS 링크로 줄임 (spec v0.3, Q24·D13) |
| 2026-10-22 | v0.1 | 승인 (2026-10-22). 처음 작성. 6단계, FR-001~010·SC-001~007 추적, 새 의존성 없음 |
