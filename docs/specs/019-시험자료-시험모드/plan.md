# plan: 시험용 자료와 공공데이터 시험 모드

- 기능 ID: 019
- 상태: 승인됨 (2026-10-28, 사용자 "응 전부 진행해줘")
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-28 / 2026-10-28
- 기준 spec: ./spec.md (v0.1)
- 근거 문서: api/_public-data.js·permit.js·recall.js, src/ui/public-panel.js, src/domain/public-data-rules.js·input-rules.js, DB private.judge, spec 017 record_test_measurements
- 브랜치: `phase-11-test-fixtures` (spec 018 브랜치 `phase-10-sample-retention` 위에서 만듦 — 018이 아직 main에 병합 전이라. PR은 018 병합 뒤 main으로)

## 0. 요약
- 범위: FR-001~006.
- 접근: 공공데이터 함수는 이미 실제 사이트 호출(`fetchImpl`)을 바꿔 끼울 수 있다. 시험 모드면 그 자리에 `fixtures/public/` 파일을 읽는 가짜 호출을 넣고, 응답에 `fixture: true`를 붙인다. 화면은 그 표시를 보고 "시험 자료"를 그린다. 시험값 자료는 JSON 하나로 두고 함수 시험이 읽는다. 판정·저장·권한은 같은 값을 넣은 되돌리는 DB 시험(019_rules.sql)으로 본다.
- 단계: 3단계 — ① 자료·시험 모드 서버 ② 화면 표시 ③ 직접 돌려 문서 채우기.

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 시험 모드 스위치 | 환경변수 `PUBLIC_DATA_MODE=fixtures`, Vercel이 넣는 `VERCEL`이 있으면 꺼짐 | — | 배포 기본값을 코드로 막는다(Q3) | 화면 단추(Q2), 주소 값(누구나 켤 수 있음) |
| 가짜 호출 | `api/_fixture-mode.js` — URL의 검색어로 파일을 고름, `node:fs/promises` | Node v24.21.0 | 새 의존성 없음 | 가짜 서버 따로 띄우기 |
| 자료 형식 | JSON(공공데이터는 실제 응답 모양), XML 오류 하나 | — | 실제 응답과 같은 길로 지나가게 | — |
| 함수 시험 | `node:test` | Node v24.21.0 | 기존과 같게 | — |
| DB 시험 | `supabase/tests/019_rules.sql` | — | 기존과 같게 | 실제 DB에 넣고 지우기(Q5) |
| 로컬 시험 모드 서버 | `.claude/launch.json`에 `pharmaflow-fixtures`(같은 5173 포트, 환경변수만 다름) | — | 같은 주소라 로그인 그대로 | 다른 포트(로그인 다시 필요) |

**실행 환경:** 로컬 Node 서버와 미리보기 브라우저

## 2. 구조와 파일

### 폴더 트리
```text
fixtures/public/permit-normal.json        (새로) 허가정보 정상: 백신 3 + 백신 아님 1, 이름에 "(시험 자료)"
fixtures/public/permit-empty.json         (새로) 0건 (items "")
fixtures/public/recall-normal.json        (새로) 회수 정상 3건 (items[].item 모양)
fixtures/public/recall-empty.json         (새로) 0건
fixtures/measurements.json                (새로) 정상·위험 값 (N-*, R-*)
fixtures/broken/measurements.json         (새로) 빈 값·단위·쉼표·음수·경계값·중복 (B-*)
fixtures/broken/public/error-code.json    (새로) resultCode "30"
fixtures/broken/public/xml-error.xml      (새로) XML 오류 본문
fixtures/broken/public/broken.json        (새로) 중간에 끊긴 JSON
fixtures/broken/public/permit-duplicate.json (새로) 같은 품목기준코드 두 번
fixtures/broken/public/permit-missing-fields.json (새로) 칸 빠짐·이상한 날짜
api/_fixture-mode.js                      (새로) fixtureModeOn(env), fixtureFetch(url)
api/_public-data.js                       (고침) 시험 모드면 가짜 호출·가짜 키, 응답에 fixture: true
src/domain/public-data-rules.js           (고침) sourceText에 시험 자료 글자
src/ui/public-panel.js                    (고침) "시험 자료" 표시, 시험 자료는 보관 안 함
styles/public.css                         (고침) 표시 모양(토큰만)
server.js, .vercelignore                  (고침) fixtures 내보내지 않음
.claude/launch.json                       (고침) pharmaflow-fixtures 실행 설정
tests/fixtures.test.js                    (새로) 자료 파일로 입력 검사·시험 모드
supabase/tests/019_rules.sql              (새로) 자료 값으로 판정·저장·중복·권한
docs/test-data.md                         (새로) 자료마다 확인할 것·기대·실제 결과
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `_fixture-mode.js` | `fixtureModeOn(env)` = `env.PUBLIC_DATA_MODE === "fixtures" && !env.VERCEL`. `fixtureFetch(url)`: 주소로 허가정보·회수를 가리고, 검색어(item_name·Prduct)가 없음·실패·XML·깨짐·시간초과·중복·빈칸이면 그 파일(시간초과는 TimeoutError), 아니면 정상 파일. 파일을 못 읽으면 연결 실패 | FR-002 | `_`로 시작해 함수로 열리지 않음 |
| `_public-data.js` | `fetchPublicData`: 시험 모드면 fetchImpl·키를 바꿈. `createPublicHandler`: 시험 모드면 본문에 `fixture: true` | FR-002, FR-003 | 시험에서 넣은 fetchImpl은 시험 모드가 아닐 때 그대로 |
| `public-panel.js` | `result.fixture`면 "시험 자료" 글자, 출처 줄 바꿈, 보관 안 함 | FR-003 | 실패 안내·마지막 정상 조회는 그대로 |

### 자료 구조
DB·ERD 변경 없음. 자료 파일 형식:
| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| measurements.json cases[] | id, group, category, item, input, expect(`pass`·`out_of_alert`·`out_of_spec` 또는 오류 문구) | JSON | 예 | 파일 | spec FR-001 |
| broken/measurements.json cases[] | 같은 모양 + duplicate 묶음 | JSON | 예 | 파일 | spec FR-001 |

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| PD_010100_MD | 제품 등록(허가정보 검색) | public-panel (cacheKey 없음) |
| PD_010202_TB 등 | 제품 상세 허가정보·회수 | public-panel |
| HM_010000_PG | 관리자 대시보드 최근 회수 공지 | public-panel |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 자료·시험 모드 서버 | FR-001, FR-002 | fixtures, _fixture-mode.js, _public-data 고침, 함수 시험 | 함수 시험 전체 통과(시험 모드 켬/끔/배포/검색어별) | — |
| 2 | 화면 표시 | FR-003 | public-panel, rules, css, launch 설정 | 미리보기(시험 모드 서버)에서 SC-002, 끄면 SC-003, 콘솔 오류 0 | — |
| 3 | 직접 돌려 문서 채우기 | FR-004, FR-005, FR-006 | 019_rules.sql, docs/test-data.md | 함수·DB 시험 전체 통과, 문서 실제 결과 칸 모두 채움 | — |

### 1단계 작업
- [ ] tests/fixtures.test.js 먼저(실패 확인) → 자료 파일·_fixture-mode.js·_public-data.js
### 2단계 작업
- [ ] public-panel·rules·css, server.js·.vercelignore, launch 설정, 미리보기
### 3단계 작업
- [ ] 019_rules.sql을 되돌리는 거래로 실행, 001~018 회귀, docs/test-data.md 채움, qa 기록

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험 + 코드 검사 | fixtures "자료 파일 모양" / C-01 |
| FR-002 | 함수 시험 | fixtures "시험 모드 켬·끔·배포", "검색어별 응답" / C-02 |
| FR-003 | 함수 시험 + 화면 | fixtures "출처 글자", 미리보기 / C-03 |
| FR-004 | 문서 검사 | C-05 |
| FR-005 | 함수 시험 + DB 시험 | fixtures "입력 검사", 019_rules / C-04 |
| FR-006 | 시험 전체 | C-06 |
| SC-001 | 코드 검사 | C-01 |
| SC-002 | 화면 | C-03 |
| SC-003 | 함수 시험 + 화면 | C-02, C-03 |
| SC-004 | 시험 + 문서 | C-04, C-05 |
| SC-005 | 시험 전체 | C-06 |
| SC-006 | 화면 | C-03 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`
| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 시험 모드 켬·끔·배포 | 환경변수 조합 | fixtures만 켜짐, VERCEL 있으면 꺼짐 | FR-002 |
| 검색어별 응답 | 인플루엔자·없음·실패·XML·깨짐·시간초과·중복·빈칸 | 정상·0건·오류·오류·오류·시간 초과·2줄·빈칸 | FR-002 |
| 입력 검사 | measurements·broken 자료의 input | 숫자 또는 "숫자로 입력해 주세요." | FR-005 |

### 화면 눌러 보기
1. 시험 모드 서버 → 제품 등록 → "인플루엔자" → "시험 자료" 표시·시험 자료 줄
2. "실패" → 실패 안내·다시 시도, "없음" → 0건 안내
3. 시험 모드 끈 서버 → 같은 검색 → 실제 자료·식약처 출처

### QA
- `qa.md` 참고

### 회귀 확인
- 공공데이터 호출 시험(tests/public-data-api.test.js), 제품 상세 허가정보·회수 칸, 판정·저장(001·004·017 DB 시험)

## 5. 제약과 주의점

### 보안
- 시험 모드에서는 실제 인증키를 쓰지 않는다. fixtures는 내보내지 않고 배포에 올리지 않는다. 자료는 모두 가상.
### 성능
- 파일 읽기 한 번. 영향 없음.
### 호환성
- 지금과 같음.
### 지금 돌아가는 기능 깨지 않기
- 시험 모드가 아니면 코드 길이 지금과 같다(시험으로 확인).
### 경계
- 항상 할 것: 출처 주석, 시험 먼저, 실제 DB에 시험 값 남기지 않기.
- 먼저 물을 것: 커밋·push·PR, 배포, 실제 DB 쓰기.
- 절대 하지 말 것: 배포에서 시험 모드, 화면 단추, 시험 자료를 실제 DB에 넣기, 다른 외부 서비스 가짜 응답, 새 도구(spec 5절). 시험을 지우거나 약하게 바꾸기.
### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 시험 모드가 배포에서 켜짐 | 사용자가 가짜 자료를 봄 | VERCEL 값이면 꺼짐 + fixtures를 배포에 안 올림 + 화면 "시험 자료" 표시 |
| 시험 자료가 마지막 정상 조회를 덮음 | 실제 실패 때 가짜 자료가 보임 | 시험 자료는 보관 안 함(FR-003) |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-28 | v0.1 | 처음 작성, 사용자 "전부 진행"으로 승인 |
