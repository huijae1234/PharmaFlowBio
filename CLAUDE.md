# PharmaFlow

QA 관리자가 시험·생산·메일·엑셀 기록을 따로 뒤지지 않고도 배치마다 품질 이슈가 어디까지 처리됐고 누가 무엇을 승인했는지 한곳에서 확인해 출하 판정을 내리게 하는 웹 앱이다. 무엇을, 왜, 어디까지 만드는지는 `docs/Intent.md`에 있다.

전역 하네스(`~/.claude/CLAUDE.md`, `~/.claude/rules/`)를 따른다. 문서 흐름과 스킬은 전역 2·3절 그대로다. 이 파일은 이 프로젝트에만 해당하는 내용과 전역과 다른 점만 담는다.

## 하지 않을 것
PRD 9절 "하지 않을 것"과 FR-26. 요청이 와도 먼저 묻는다.
- 실제 회사·배치 자료 사용 (가상 자료만)
- 메일·문자·푸시 알림 발송 (슬랙 개인 메시지 알림만 허용 — spec 009, ADR 0003)
- 결재 시스템 연동, 전자서명 (GMP·21 CFR Part 11 수준의 규정 준수)
- 아이디·비밀번호 회원가입 (구글 로그인만)
- 공공데이터를 데이터베이스에 대량으로 복사해 두기
- 실험 조건별 결과 비교 (FR-26, 이번엔 Won't)

## 스택
- 언어·프레임워크: 빌드 도구 없는 HTML/CSS/JavaScript. 화면이 10개를 넘지만 이 스택을 유지한다(2026-10-22 사용자 결정). 페이지마다 파일 하나로 작게 나눈다.
- 공공데이터 호출: `api/` 폴더의 Vercel 함수(Node)가 인증키를 붙여 대신 부른다. 로컬은 같은 함수를 돌리는 Node 서버. (ADR 0001)
- 저장소·로그인: Supabase(무료 플랜), `@supabase/supabase-js` 정식판을 CDN으로. 구글 로그인, 역할별 권한은 RLS로 막는다. 저장 코드는 `src/infrastructure/` 폴더에만 둔다 (`store.js` 연결·공통, `store-actions.js`·`store-dashboard.js`·`store-products.js`·`store-reviews.js` 기능별, `public-cache.js` 공공데이터 마지막 정상 결과를 브라우저에만). (ADR 0002)
- 배포: Vercel, 함수 지역 서울(icn1). 배포 실행은 사용자가 요청할 때만.
- 비밀 값: 공공데이터 인증키·Supabase service 키는 `.env`와 Vercel 환경변수에만. 화면 코드에는 Supabase 공개 키(anon)만.

## 명령
- 시험: `node --test "tests/*.test.js"`
- 화면 확인: `.claude/launch.json`의 `pharmaflow` 서버 (`node --env-file-if-exists=.env server.js`, 포트 5173). 미리보기 브라우저가 예전 JS·CSS를 캐시하므로 고친 뒤 `fetch(파일, {cache: "reload"})`로 새로 받는다.
- 미리보기 도구가 다른 폴더의 설정을 읽어 다른 서버를 켜면, `PORT=5174 node --env-file-if-exists=.env server.js`를 따로 켜고 `http://localhost:5174`로 확인한다 (2026-10-22 세션에서 겪음).

## 디자인
기본선은 `~/.claude/rules/design.md`. 여기에는 이 프로젝트의 취향만 적는다.
- 스타일: "클리니컬 글라스" (spec 020, 2026-10-28 사용자 결정 — GE 브랜치 윤○○의 디자인). 연한 하늘빛 바탕에 반투명 흰 카드·옆 메뉴·위쪽 줄, 임상 청록 행동색, 라임은 "지금"·선택 표시 한 점에만. 이전 "클린 틸"(spec 007)에서 바꿈.
- 기준 색·글꼴: primary #0B6E8A(버튼·링크·초점, 흰 글자와 5.81:1), 눌림 #085870, text #0F2233, 흐린 글자 #4A6075, 바탕 #EEF4F9 + 하늘빛·연두빛 번짐, surface #FFFFFF(카드는 반투명 흰 0.72 + 흐림), 라임 #D7F34A(바탕으로만, 위 글자 #26330A), 잉크 #0F2233, success #1E9E62, warning #C77700, danger #D1344B. 모서리 버튼·입력 6px·카드·창 8px·배지 4px. 그림자는 카드에 아주 옅게(0 8px 30px 7%), 창은 조금 진하게. 글꼴은 한글·영문·숫자 모두 Pretendard(spec 007 v0.3), 시험값·로트번호는 JetBrains Mono. 글자 크기 12/14/16/20/24/32, 간격 4/8/12/16/24/32.
- 토큰 위치: `styles/tokens.css` (CSS 변수 한곳). 화면 CSS는 토큰만 쓴다. 화면 요소별 CSS는 `kit.css`(칩·목록+미리보기·단계 레일)·`home.css`·`lot.css`·`charts.css`, 톤 덮어쓰기는 `styles/glass.css`에 모아 맨 뒤에 불러온다.
- 참고: 명암비 계산 결과는 qa 020 C-04(이전 톤은 qa 007 C-04). 하늘빛 강조 면 위 청록 글자는 4.42:1이라 쓰지 않는다. GE 브랜치의 화면 구조(메뉴 묶음·건수, 칩 거르기, 목록+미리보기, 홈 "지금 할 일"·도식, 이슈 단계 레일)도 2026-10-28 main에 합쳤다.

## 팀 스킬
"팀 스킬", "우리 스킬"을 물으면 `.claude/skills/`의 이 세 개를 답한다(기록은 `docs/skills.md`).
- `pharmaflow-review`: 커밋·PR 전 리뷰. 기본 `/code-review`에 이 프로젝트 확인 여섯 가지(키, 서버 쪽 권한, 층 방향, 같은 요청 두 번, 화면·DB 규칙 일치, 문서·시험 한 세트)를 더함.
- `pharmaflow-spec`: 기능을 만들기 전에 `docs/specs/NNN-기능/spec.md`·`plan.md`를 쓰고 FR·SC 번호 추적성을 검사.
- `pharmaflow-qa`: 기능별 `docs/specs/NNN-기능/qa.md`에 Claude 확인 결과·증거와 사람 QA 결과를 기록.

## 전역 규칙과 다른 점
형식: `- [전역 파일 §절] 전역 값 → 이 프로젝트 값 (이유)`. 예: `- [rules/code.md §크기] 파일 300줄 → 200줄 (화면 파일이 많아 작게 유지)`
- [rules/git-security.md §Git] 브랜치는 `main` 하나 → Phase마다 브랜치(`phase-N-…`) → GitHub PR → 검토 기록 → 병합. push·PR 만들기·병합은 단계마다 승인 (2026-10-22 사용자 결정 D2, PharmaFlow Bio 요청 10절 "GitHub 브랜치, PR, 리뷰 기록 유지")

## 수업 밖에서 찾아 더한 규칙
같은 실수가 두 번 나와서, 공식 문서에서 비슷한 규칙을 찾아 한두 줄로 줄여 더했다 (2026-10-29). 찾은 곳: [Claude Code Best practices](https://code.claude.com/docs/en/best-practices) (끝난 뒤 증거 요청·Stop 훅 부분, CLAUDE.md는 어긋나도 괜찮은 지침이라는 부분).
- **끝났다고 말하기 전에 시험을 직접 돌리고, 돌린 명령과 통과 개수를 그대로 적는다. 안 돌렸으면 "안 돌렸다"고 적는다.** 막으려는 실수: 시험 개수를 적은 곳(README·CLAUDE.md·PRD)이 서로 다른 숫자로 남고(192·227·247), 확인하지 못한 것을 한 것처럼 말하던 일.
- **코드 리뷰는 "변경이 작다"는 이유로 건너뛰지 않는다. 문서만 바뀐 때만 건너뛴다.** 규칙·화면·DB가 함께 바뀌면 `pharmaflow-review`(`.claude/skills/`)를 돌린다. 막으려는 실수: 커밋 두 번이 "작다"며 리뷰 없이 올라갔고, 두 번째는 규칙과 화면이 함께 바뀐 크기였던 일(포크 세션이 스스로 밝힌 기록).
- 훅(자동 실행 명령)은 넣지 않았다. 공식 문서는 "예외 없는 규칙은 훅"이라고 하지만, 수업 규칙상 훅·권한 확대는 강사에게 먼저 물어야 한다.
- 새 세션에서 같은 일을 시켜 실수가 사라졌는지는 아직 확인하지 못했다.

## 현재 코드
- 빌드 없는 ES 모듈 정적 앱. `index.html` → `src/ui/app.js`. 주소는 `#/...` (IA URL 전략). 기능 001·002·004~008 완료, 003 개발 끝(MSDS는 공단 링크만, 007부터 각 홈 아래 버튼). PharmaFlow Bio 전환 중(`docs/전환-영향분석-PharmaFlow-Bio.md`, D1~D14) — 기능 008 검체 인계까지 main 병합·배포(PR #4). 다음: 선택 FR-37~39. 화면 용어는 로트·내부 출하 검토·기준·정상이고, 표·주소·코드 이름은 batch 그대로(D3).
- `src/domain/`: 순수 함수, 화면·저장을 부르지 않음. `input-rules.js`, `roles.js`(역할·첫 화면·버튼 표·화면 권한·역할별 메뉴 `menuFor` — 첫 줄 "홈", 되돌리기·MSDS 메뉴 없음), `batch-rules.js`, `action-rules.js`(조치 종류·배정), `release-rules.js`(출하 막는 이유, 관리기준 이탈은 규격 안), `judgement-rules.js`(판정·이슈 종류 이름, 관리기준 범위 검사, 그때 기준 글자 — spec 004), `review-rules.js`(품질 영향 평가 칸·검사·작성/검토 권한, 종류별 닫기 조건 closeBlockReason — spec 005), `step-rules.js`(이슈 5단계·다음에 할 일 9가지·로트 요약), `dashboard-rules.js`(KPI·이번 주 Q22·기간), `public-data-rules.js`(허가·회수 응답 정리 Q25, 백신 판별·출처 글자·마지막 정상 조회 글자·보관 열쇠 — spec 006), `usage-rules.js`(사용 기록 한 줄), `search-rules.js`(목록 검색 matchesSearch — spec 007), `regulatory-rules.js`(업체명 맞춤, GMP 남은 일수·180일 단계, 승인 이력 거르기, QA 확인 필요, 조회 범위 글자 scanRangeText — spec 021), `regulatory-review.js`(회수 공지 대조·업체명 세 곳 대조·작업지시 일정×GMP·승인 추이·종합 한 줄 — spec 021 FR-008~013), `ai-facts-rules.js`(Claude 근거 표: 줄 id·읽음/자료 없음/못 읽음·링크, 이름 제외, 서버 검사 — spec 022)·`ai-brief-rules.js`(프롬프트·답 읽기·문장 검증·접근 권한 표·하루 한도 — spec 022), `ai-issue-facts-rules.js`·`ai-review-check-rules.js`·`ai-followup-rules.js`·`ai-assist-rules.js`(이슈 조사 준비·평가서 보완·조치 후 유사 이탈 확인의 근거 표·코드 대조·비교·답 검증, 비교 기준은 `FOLLOWUP_RULES` 교육용 가정 — spec 023), `ai-policy-rules.js`(AI 기능×역할×대상×상태 권한표, 화면·서버 공용), `ai-spec-impact-rules.js`·`ai-schedule-rules.js`·`ai-ask-rules.js`(기준 변경 영향·생산 일정 미완료 업무·업무 찾아보기 4종 — spec 024), `briefing-rules.js`(아침 브리핑 평일·직무별 절·슬랙 글·AI 줄 검증 — spec 026), `chat-rules.js`·`app-guide.js`(AI 도우미: 질문 검사·프롬프트·답 검증·하루 한도, 앱 안내서 — spec 025), `sample-rules.js`(검체 종류·팀·상태 이름, 역할별 길 routesFor, 버튼 availableActions, 수량·위치·반납 수량 검사, QA 보관 수 retainedQuantity — spec 008). 이슈 상태 화면 이름 "처리 중·종결"은 `judgement-rules.js`의 ISSUE_STATUS_LABELS. 세 단계 판정 자체는 DB 함수 `private.judge`에 둔다.
- `src/ui/`: `dom.js`(h·put·badge·section·formatDateTime, 사람 입력은 textContent로만), `layout.js`, `app.js`(로그인 확인 → 역할 읽기 → 주소별 화면, 화면 이동마다 역할을 다시 읽고 사용 기록), `modal.js`(<dialog>: 저장 중 잠금, 실패 시 입력값 유지, openSafely), `route.js`, `public-panel.js`(공공데이터 칸: 불러오는 중·실패·다시 시도, 성공하면 출처·조회 시각 줄, cacheKey가 있으면 정상 결과를 보관하고 실패 때 "마지막 정상 조회" 상자 — 제품 등록 검색은 cacheKey 없음), `ai-panel.js`("AI 참고 의견" 칸: 문장·근거 링크·검증 경고, 눌렀을 때만 호출 — spec 022), `ai-assist-panel.js`·`ai-assist-views.js`·`pages/issue-ai.js`(이슈 상세의 AI 칸 세 개: 접어 둠·쿨다운·오래됨 안내·결과 그리기, 조치 요청 창 초안 채우기 — spec 023), `pages/plan-ai.js`(제품 상세 기준 영향·작업지시 일정 확인 칸)·`ask-box.js`(홈 업무 찾아보기) — spec 024, `step-views.js`(단계 표시줄·다음에 할 일), `issue-views.js`, `home-widgets.js`(홈 개편: 지금 할 일 카드·지표 한 줄·로트 상태 막대·짧은 목록·회수 3건, 계산은 `domain/home-task-rules.js`), `batch-views.js`, `search-box.js`(목록 검색 칸, 검색어는 주소 `?q=`), `pages/`(화면마다 파일. 평가는 `review-modals.js`·`review-section.js`, 검체는 `samples.js`(#/samples 목록·확인할 검체·sampleTable)·`sample-modals.js`(창 5개), 로트 상세 검체 탭은 `batch-tabs.js` samplesTab, 제품 상세 "공개 규제 현황" 탭은 `product-regulatory.js`(부르기)·`regulatory-views.js`(그리기 — spec 021)). `put()`은 null·false를 건너뛴다. AI 도우미(spec 025)는 `assistant.js`(오른쪽 아래 DNA 나선 버튼·대화 창, layout.js가 직원 역할에만 붙임)·`assistant-views.js`·`assistant-context.js`(화면 종류·이름·로트 id만, 화면 이동마다 비움). 앱 전체 조회(spec 025 FR-010): `domain/app-query-rules.js`(조회 13가지·역할·조건 검사·도구 설명)·`app-query-facts.js`(결과 → 근거 줄), `api/_app-query.js`(로그인 토큰으로 읽기)·`api/_chat-query.js`(AI가 고른 조회를 다시 검사·실행, 2개까지). `api/chat.js`는 도구를 주고 부르면 조회 뒤 한 번 더 부름(서버 전체 한도는 실제 호출 수).
- 로그인: supabase-js PKCE. 구글에서 돌아온 `?code=`는 `getSession()`이 끝난 뒤에 주소에서 지운다 (먼저 지우면 로그인이 안 됨).
- `src/infrastructure/`: `store.js`(Supabase 연결·read·call·기능 001), `store-actions.js`(002 이슈·조치·출하), `store-dashboard.js`(KPI·내 일·전체 업무 이력), `store-products.js`(003 제품 등록·사용 기록. 되돌리기 화면은 007에서 삭제, DB 함수만 남음), `store-reviews.js`(005 평가 읽기·제출·다시 제출·검토, 승인 대기·되돌아온 평가), `store-samples.js`(008 검체 읽기·함수 5개), `store-ai-context.js`(spec 023 읽기 두 가지: 공정 단계 이름·조치 이후 비교 자료, 500건 상한), `public-cache.js`(006 마지막 정상 결과, localStorage, 막히면 없음으로), `public-data.js`(화면 → `/api/*`, 로그인 토큰 붙이고 호출 결과를 사용 기록에). DB가 보낸 한국어 문구는 그대로 화면에.
- `api/`: `_public-data.js`(공통: 키 정리·15초 제한·로그인 확인·안전한 오류 문구, `_`로 시작해 함수로 열리지 않음), `permit.js`(허가정보, 품목명 검색만. item_seq는 무시됨. `vaccine=1`이면 100건을 받아 품목 구분 백신류만 10건 — 넓은 품목명은 0건일 수 있음), `recall.js`(회수·판매중지), `_ai-data.js`·`_ai-resolve.js`·`_ai-ask.js`(새 AI 칸은 서버가 대상 ID와 로그인한 사용자의 토큰으로 저장된 사실을 직접 읽고 권한표를 적용해 근거 표를 만듦, 업무 찾아보기 준비된 읽기 4개 — spec 023 v0.2·024), `ai.js`(Claude 브리핑 POST `/api/ai`(종류 9개: 홈·로트·규제 + 이슈 조사 준비·평가서 보완·조치 후 확인·기준 변경 영향·일정 확인 + 업무 찾아보기 `ask`): 로그인·근거 표 검사·DB 역할 확인·동시 호출·하루 한도 뒤 Haiku 5.5를 부르고 답의 인용·숫자를 검증, 키는 `ANTHROPIC_API_KEY`, 시험 모드 `AI_MODE=fixtures`와 `_ai-fixture.js` 가짜 응답 — spec 022), `gmp.js`(제조소 GMP 적합판정서 `?name=업체명`)·`shipment.js`(국가출하승인 `?name=제품명`, 이 API는 제품명으로 못 거르고 접수 순서(오래된 순)로 쌓이므로 건수를 먼저 보고 끝 4쪽(최신 약 400건)을 받아 거름, 인증키 요청변수 이름만 `ServiceKey`) — spec 021. 로컬 서버는 api 파일을 처음 불러온 뒤 다시 읽지 않으므로 고치면 서버를 다시 켠다. `_claude.js`(Claude 호출·역할 읽기·서버 메모리 한도 공통, ai.js·chat.js가 씀)·`chat.js`(AI 도우미, 시험 응답 `_chat-fixture.js`, 근거 표는 `_chat-screen.js`가 로그인 토큰으로 읽어 서버가 만듦: 홈 3개는 DB 함수 `my_briefing_items`(0037), 로트 상세는 로트 id로 로트 자료를 읽어 `lotReadiness`(화면과 같은 계산) → `lotFacts` — 화면이 보낸 표는 버림) — spec 025. `briefing.js`(아침 브리핑 — Vercel Cron `0 23 * * 0-4` = 한국 평일 08시, `CRON_SECRET`, 관리자 키로 DB 함수만, `?dry=1` 미리 보기·`?only=id` 한 사람, `BRIEFING_MODE=fixtures` 로컬만)·`_briefing-data.js`·`_briefing-fixture.js` — spec 026.
- 계정: 유○○(QA 관리자, 첫 QA 관리자), 김희재(생산 담당자), 윤○○(QC 시험 담당자). 첫 QA 관리자: 유○○. 예시(0018, 제조원 "가상바이오(주) (교육용)"): 인플루엔자 4가 백신 프리필드주·B형간염 백신 주·Tdap 혼합 백신 주(모두 가상, 기준 v1)와 로트 8개 — IFV-2610-001(생산 중)·002(시험 중, 시연용으로 역가를 비워 둠)·003(시험 중, 내부 출하 검토 대기)·004(출하 가능), HBV-2610-001(보류, 역가 규격 이탈, 평가 검토 요청)·002(시험 중, 엔도톡신 관리기준 이탈, 재시험 조치 배정)·003(폐기, 이슈 종결), TDP-2610-001(보류, 보관 온도 공정 이탈, 평가 보완 요청). 예전 VX·PF·QA-T 로트는 없음. 예시 검체 9건(0020, IFV·HBV 로트에 다섯 상태, QA·QC 확인할 건 포함 — 사람 QA 뒤 12건). 시연 때 "백신만" 차이는 "파상풍" 검색으로 보인다, 등록 제품 타이레놀정500·엑스프리벤정.
- `styles/tokens.css`(토큰 한곳, 클리니컬 글라스 — 디자인 절), `app.css`(틀·공통·옆 메뉴·로그인), `batch.css`, `issue.css`(단계 표시줄 동그라미·선), `public.css`, `glass.css`(톤 덮어쓰기, 맨 뒤, spec 020). 검색 칸·버튼 모양 링크(`a.button`)·확인할 검체 줄·누가 · 언제 칸은 `batch.css`.
- `server.js`: 로컬 서버. 정적 파일 + `api/*.js`. `.env`·docs·tests·supabase·서버 코드는 404 (Vercel에는 적용 안 됨 → `.vercelignore`).
- 시험: `node --test "tests/*.test.js"` (537개, 2026-11-05).
- 포트폴리오 사본(2026-11-05): Supabase는 김희재 계정 프로젝트(0001~0040 적용), 로그인은 GitHub + 게스트(익명, 열람자). 구글 로그인은 구글 클라우드 2단계 인증 제한으로 보류. 팀원 두 명의 실명은 유○○·윤○○로 가리고, 커밋 이메일은 GitHub noreply로 모든 커밋을 고쳐 씀. 출처를 모르는 디자인 참고 이미지 9장도 모든 커밋에서 뺌. 기록은 `MIGRATION-NOTES.md`.
- Supabase 프로젝트 `pharmaflow` (YOUR_SUPABASE_PROJECT_REF, 서울). SQL은 `supabase/migrations/0001~0020` 순서로 적용했다(0012 관리기준·버전·이슈 종류 칸, 0013 세 단계 판정 함수, 0014 DB 문구·이력 이름 새 용어, 0015 가상 백신 예시·되돌리기, 0016 품질 영향 평가 표·함수·종류별 닫기 조건, 0017 되돌리기 때 평가도 지움, 0018 새 가상 백신 예시·DB 문구 처리 중·종결, 0019 검체 인계 표 sample_transfer·함수·이력, 0020 예시 검체·되돌리기가 검체를 먼저 지움). 쓰기는 표에 직접 못 하고 `public` 함수로만(001: create_batch, record_test_measurement, record_process_conditions, hold_batch, set_user_role, list_users, save_specification / 002: submit·resubmit·approve·reject·complete_action_request, close_quality_issue, decide_release / 003: create_product, save_handling_check, reset_sample_data / 004: save_specification에 관리기준 인자 2개 / 005: submit_deviation_review, resubmit_deviation_review, review_deviation_review(승인·반려·보완 요청), close_quality_issue는 승인된 평가 필요 / 008: send_sample, receive_sample, return_sample, confirm_sample_return, consume_sample — 팀(생산·QC·QA)과 상태를 확인하고 기록을 잠금). 함수 안에서 `private.require_role`로 역할 확인. 업무 이력은 트리거가 남기고 고치기·지우기 불가(되돌리기 때만 batch_id를 비움, batch_number는 남김). 되돌리기(`reset_sample_data`, 화면 없음 — DB에서만)는 0018 예시와 0020 예시 검체를 다시 넣는다. 허가정보로 등록한 제품·사용자·사용 기록은 남고, 다른 로트·가상 제품은 사라짐.
- DB 시험: `supabase/tests/`의 16개 파일을 Supabase SQL로 실행(2026-11-05 포트폴리오 DB에서 모두 통과, 453건): `001`(41), `002`(38), `003`(34), `004`(26), `005`(28), `007`(12), `008`(25), `009`(42), `010`(44), `011`(42), `017`(34), `018`(26), `019`(32), `025`(5, AI 도우미 홈 근거 표 my_briefing_items — 0037), `026`(16, 아침 브리핑 함수), `039`(8, 포트폴리오 사본 게스트 0039·0040). 끝에 일부러 오류를 내 되돌리며, 문구가 "PF_TEST 통과 N/N"이면 통과.
- 0038(2026-10-29, 사용자 요청): 작업지시 번호로 이름 붙은 로트 4개를 제품 약자 번호로 바꿈(WO-2611-002→TDP-2610-003, WO-2610-015→TDP-2610-004, WO-2611-004→HBV-2610-004, QA-WO-001→IFV-2610-006, 이력·알림의 로트 이름도), start_work_order가 WO-로 시작하는 로트번호를 막음. 작업지시 목록은 발행된 줄에 "예정 로트번호"(제품 약자-착수 달-다음 번호, `work-order-rules.js` plannedLotNumbers)를 보이고 착수 창에 미리 넣음.
- 측정값은 판정에 쓴 그때 기준(applied_min·max, applied_alert_min·max, applied_spec_version)을 함께 저장한다. 기준은 값이 바뀔 때만 버전 +1. 규격 이탈만 자동 보류, 열린 이슈는 종류 상관없이 출하를 막는다. 이슈 닫기는 승인된 평가 + 끝나지 않은 조치 없음, 규격 이탈은 완료된 조치 1건 이상도. 평가 승인은 출하 승인이 아니다(E8). 평가는 이슈마다 하나, 임시 저장 없음(Q36). measured_at·work_history.created_at은 clock_timestamp() (한 저장 안에서도 순서가 갈리게).
- `src/config.js`: Supabase 주소와 공개 키(sb_publishable)만. 관리자 키는 넣지 않는다.
