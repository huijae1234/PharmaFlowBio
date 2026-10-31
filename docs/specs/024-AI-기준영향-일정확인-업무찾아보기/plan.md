# plan: Claude AI 기준 변경 영향 · 일정 확인 · 업무 찾아보기 (spec 024 v0.1)

- 상태: 구현 끝 (2026-10-29), 키가 없어 실제 Claude 호출 미확인
- 새 라이브러리·DB 변경 없음. 서버·검증·한도·오류 처리는 spec 022·023의 것을 재사용한다.

## 1. 파일
| 파일 | 하는 일 |
|---|---|
| `src/domain/ai-spec-impact-rules.js` | 기능 4: 판정(`judgeValue`, DB와 같은 규칙), 측정별 변경·유지·같은 버전·비교 불가 계산(`specImpact`), 결과 문장·근거 표 |
| `src/domain/ai-schedule-rules.js` | 기능 5: 한국 날짜(`kstDate`)·날짜 상태(`dateState`)·이슈별 다음 행동과 역할(`nextStep`)·작업지시 신호(`scheduleCheck`)·근거 표(`scheduleFacts`) |
| `src/domain/ai-ask-rules.js` | 기능 6: 조회 종류 4개·역할표·필터 검사·질문 해석 요청 글·해석 결과 읽기·목록 만들기(`askRows`)·결과(`askResult`) |
| `src/domain/ai-policy-rules.js` | 기능×역할×대상×상태 권한표 (화면·서버 공용, 기능 1~6 전부) |
| `api/_ai-data.js` | 서버가 호출한 사람의 토큰으로 저장된 사실을 읽는다: 이슈 묶음·조치 이후 비교·기준 묶음·일정 묶음·질문 4종 읽기. 대상 ID는 UUID로 검사. 읽기만 |
| `api/_ai-resolve.js` | 이슈·기준·일정 칸 요청을 푼다: 대상 읽기 → 권한표 → 근거 표 생성. 화면의 근거 표·역할·작성자·담당자는 받지 않는다 |
| `api/_ai-ask.js` | 업무 찾아보기: 고른 조건 또는 해석 결과 → 필터 재검사 → 준비된 읽기 → 목록 |
| `api/ai.js` | 종류 6개로 확장, 서버가 만든 근거 표를 응답에 실음(링크는 화면 안 주소만), 질문 검사를 한도 쓰기 전에 |
| `api/_ai-fixture.js` | 시험 모드 가짜 응답: 새 종류용 못된 모델 흉내(`retro`·`predict`)와 가짜 질문 해석(`fixtureAskResponse`) |
| `src/ui/ask-box.js` | 홈의 업무 찾아보기 칸 |
| `src/ui/pages/plan-ai.js` | 제품 상세의 기준 영향 칸, 작업지시의 일정 확인 칸 |
| `src/ui/ai-assist-panel.js`·`ai-assist-views.js` | 공통 틀: 서버가 준 근거 표를 보이고, 접어 두는 옵션(`fold`), 결과 틀 3개 추가 |
| `products.js`·`work-orders.js`·`homes.js`·`app.js` | 칸을 붙이는 몇 줄, 보관 결과 열쇠에 역할 추가 |

## 2. 설정
환경변수는 spec 022와 같다(새 환경변수 없음). 한도 숫자는 칸별로 한곳: `SPEC_IMPACT_CAP`(300)·`SCHEDULE_LIMITS`(500·8줄·7일)·`ASK_LIMITS`(30줄·120자)·`ASK_READ_CAP`(200).

## 3. 순서와 되돌리기
1. 시험 먼저: 권한표 → 규칙 3개 → 서버(`ai-assist-api`·`ai-ask-api`)
2. 규칙 → 서버 → 화면. 화면은 확인용 환경(저장소 밖)에서 실제 앱 코드로 역할별 확인
3. 되돌리기: `products.js`·`work-orders.js`·`homes.js`의 칸 호출 한 줄씩을 지우면 이전과 같다. 서버는 종류를 `ASSIST_KINDS`·`ask` 분기에서 빼면 닫힌다

## 4. shortcut
- 키워드 시험 모드 해석은 단순 규칙이다(실제 해석 품질 미확인)
- 질문 해석 결과의 `ambiguous` 후보는 역할 안의 것만 남긴다(하나뿐이면 바로 조회)
- 기준 변경 영향의 단위 비교는 측정 당시 단위가 없어 늘 0건이다(스키마가 생기면 같은 규칙이 작동하게 코드는 준비)
- 일정 확인은 공개 규제 정보를 넣지 않고 안내만 한다
- 기준 영향은 항목 하나씩(전체 제품 일괄 비교 아님), 읽기 300건
