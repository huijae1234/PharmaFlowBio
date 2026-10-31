# plan: Claude 브리핑 (spec 022 v0.4)

- 상태: 구현 끝 (2026-10-29), 키가 없어 실제 Claude 호출 미확인
- 새 라이브러리·DB 변경 없음. Claude 호출은 `fetch`로 직접 (`https://api.anthropic.com/v1/messages`, 공식 문서의 요청 모양). Anthropic SDK를 쓰지 않은 이유: 프로젝트 규칙(새 라이브러리 금지, 서버는 외부 의존성 없음)과 Vercel 배포 설정을 바꾸지 않기 위해. SDK를 쓰려면 `package.json` 의존성 추가가 필요해 먼저 물어야 한다.

## 1. 파일
| 파일 | 하는 일 |
|---|---|
| `src/domain/ai-facts-rules.js` | 근거 표 만들기(홈·로트·규제), 읽음/자료 없음/못 읽음(조회 상한·공정 기록 못 읽음 포함), 줄 id·링크·`must`, 이름 제외, 확인 목록 글 정리, 서버 검사(`validateFacts`), 보관 열쇠, 알 수 없는 것(`gapLines`). 순수 함수 |
| `src/domain/ai-brief-rules.js` | 프롬프트, 답 읽기, 문장 검증(`reviewAnswer`: 인용·수량 단위와 로트 번호 대조·못 읽음 가리기·금지 표현(같은 절 면제)·누락, 알 수 없는 것 검사), 접근 권한 표, 하루 한도·환불, 보관 기한·결과 모양 검사(`isUsableAiResult`). 순수 함수 |
| `api/ai.js` | POST `/api/ai`: 로그인 → 근거 표 검사 → 역할(DB) → 키 → 동시 호출·한도 → Claude(Haiku 5.5) → 읽기·검증. 닿지 못한 호출만 한도에서 돌려줌. 시험 모드 |
| `api/_ai-fixture.js` | 시험 모드의 가짜 Claude 응답 10가지 (`_`로 시작해 함수로 열리지 않음) |
| `src/infrastructure/ai.js` | 화면 → `/api/ai`(href 제외), 사용 기록(`ai`), 결과 보관(6시간, 사람별 열쇠, 로그아웃 때 삭제, 모양 검사) |
| `src/ui/ai-panel.js` | "AI 참고 의견" 칸: 눌렀을 때만 부름, 문장·근거 링크·검증 경고·근거 표·알 수 없는 것(AI 메모 구분), 승인·안전 단정 문장은 가림(눌러서 보기), 중복 클릭 무시, 근거 표를 못 만들거나 그리다 던져도 그 칸만 |
| `src/ui/pages/homes.js`, `batch-detail.js`, `product-regulatory.js` | 칸 세 개. 홈은 읽기 성공·실패·조회 상한을 구분(`readOrFail`), 로트 상세는 공정 기록 읽기 실패를 null로 넘김, 규제 탭은 자료별 읽기 상태 추적 |
| `src/domain/release-readiness-rules.js` | 공정 기록 건수가 null이면 "확인하지 못했습니다"(고정 화면 체크리스트, v0.4) |
| `src/ui/app.js` | 로그인한 사람을 AI 보관 결과에 알리고(`setAiUser`) 로그아웃 때 지움(`clearAiCache`) — 각 한 줄 |
| `src/infrastructure/store-dashboard.js` | 설비 이상·이탈 조회에 `batch_id` 추가(교차 줄용), 조회 상한 상수(`DEVIATION_FETCH_LIMIT` 500·`EQUIPMENT_FETCH_LIMIT` 1000) |

## 2. 설정 (환경변수)
- `ANTHROPIC_API_KEY` (필수, Vercel 환경변수·로컬 `.env`에만), `AI_MODEL` (선택, 기본 `claude-haiku-5-5`, 5.x 모델), `AI_MODE=fixtures` (로컬 시험 전용, Vercel에서는 꺼짐)
- 한도 숫자는 `AI_LIMITS` 한 곳(`ai-brief-rules.js`): 사용자당 30회, 전체 100회, 근거 표 12KB·40줄, `max_tokens` 2000, 20초

## 3. Claude 요청 (Haiku 5.5, 공식 문서 2026-10-29)
`{ model, max_tokens: 2000, output_config: { effort: "low" }, system, messages: [user] }`. 헤더 `x-api-key`, `anthropic-version: 2023-06-01`(2026-10-21 버전도 있으나 우리 요청이 바뀌는 항목을 쓰지 않아 유지). 샘플링 값(temperature·top_p·top_k)·prefill·thinking 설정은 보내지 않는다. 응답은 `content`에서 `text` 블록을 type으로 찾는다.

## 4. 순서와 되돌리기
1. 시험 먼저: 규칙(`tests/ai-facts-rules.test.js`, `tests/ai-brief-rules.test.js`)과 서버(`tests/ai-api.test.js`)
2. 규칙 → 서버 → 화면. 화면은 **확인용 환경**(저장소 밖)에서 실제 앱 코드로 확인: 로그인·DB 없이 Supabase 저장소만 가짜 자료로 바꾸고, `/api/ai`는 실제 서버 함수를 쓰고 Claude 호출만 가짜로 대신한다
3. 되돌리기: 칸 세 곳의 `aiPanel(...)` 호출을 지우면 이전 화면과 같다. 홈 조회에 붙인 `readOrFail`과 `batch_id` 선택은 AI 칸이 없어도 해가 없다

## 5. shortcut
- 하루 한도는 서버 메모리라 서버가 여러 개면 부정확(실제 상한은 콘솔 워크스페이스 한도). 정확하게 하려면 DB 저장이 필요해 유○○ 승인 뒤
- 문장 검증은 숫자·인용·키워드만 본다(뜻은 못 본다). 실제 응답을 본 뒤 규칙을 조정한다
- 숫자는 문장 단위로 맞춘다: 여러 줄을 인용한 문장에서 숫자가 서로 뒤바뀐 것, 증감 표현의 방향은 못 잡는다 (spec 경계 "검증이 못 잡는 것")
- 설비 이상 조회 상한 1000건은 PostgREST 기본값을 가정한 것이라 실제 설정을 확인하지 못했다
- 근거 표 진위는 서버가 검증하지 못한다(위조는 본인 요약에만 영향)
- Vercel 함수 최대 실행 시간(플랜별)을 확인하지 못했다. 요청 제한은 20초
