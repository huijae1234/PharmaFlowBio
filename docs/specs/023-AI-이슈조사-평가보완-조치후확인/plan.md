# plan: Claude AI 이슈 조사 준비 · 평가서 보완 · 조치 후 확인 (spec 023 v0.2)

- 상태: 구현 끝 (2026-10-29), 키가 없어 실제 Claude 호출 미확인
- 새 라이브러리·DB 변경 없음. 서버·검증·한도·오류 처리는 spec 022의 것을 재사용한다.

## 1. 파일
| 파일 | 하는 일 |
|---|---|
| `src/domain/ai-issue-facts-rules.js` | 기능 1 근거 표(`issueFacts`)와 평가서·조치 후 확인이 함께 쓰는 줄(이슈·측정값·공정 기록·조치 요청·평가서 상태). 진행 중 조치 우선·`must`, 질문 근거 `ask`, 이름 제외 |
| `src/domain/ai-review-check-rules.js` | 기능 2 근거 표(`reviewFacts`)와 코드 대조(`reviewChecks`: 조치 상태·설비 상태·지속시간·숫자·근거 칸·문서 번호) |
| `src/domain/ai-followup-rules.js` | 기능 3 비교(`compareAfterAction`: 여섯 결과·제외 사유·같은 로트 분리), 교육용 가정 `FOLLOWUP_RULES`, 코드가 쓰는 결과 문장(`followupHeadline`), 근거 표(`followupFacts`) |
| `src/domain/ai-assist-rules.js` | 칸 세 개의 프롬프트·답 읽기·검증(`reviewAssistAnswer`: spec 022 검사 + 칸별 금지 표현·되묻기·원문 인용), 칸별 한도·권한 |
| `api/_ai-target.js` | 서버가 호출한 사람의 토큰으로 이슈를 읽어 보이는지·상태 조건 확인(`checkTarget`). 읽기만 |
| `api/ai.js`, `api/_ai-fixture.js` | 종류 세 개 추가, 칸별 한도·토큰, 대상 확인, 시험 모드 가짜 응답(못된 모델 흉내 5가지 추가) |
| `src/infrastructure/store-ai-context.js` | 읽기 두 가지: 공정 단계 이름(`loadStepLabel`), 조치 이후 비교 자료(`loadFollowup`, 500건 상한·잘림 표시) |
| `src/infrastructure/ai.js` | `callAi`에 대상 이슈 전달, 이슈별 마지막 근거 열쇠(`noteAiScope`·`readAiScope`) |
| `src/ui/ai-assist-panel.js`, `ai-assist-views.js` | 세 칸 공통 틀(중복 클릭·쿨다운·오래됨 안내·실패 상자)과 결과 그리기 |
| `src/ui/pages/issue-ai.js` | 이슈 상세에 붙는 세 칸을 만든다 (`investigatePanel`·`reviewCheckPanel`·`followupBlocks`) |
| `issue-detail.js`, `review-section.js`, `review-modals.js`, `action-modals.js` | 연결 몇 줄(기존 동작은 AI 칸을 지우면 그대로). 조치 요청 창은 `initial` 인자를 받는다 |
| `src/ui/ai-panel.js`, `ai-brief-rules.js`, `ai-facts-rules.js` | 재사용을 위해 몇 가지를 `export`로 바꾸고(경고 목록·검증 조각·`fact`), 수량 띄어쓰기·"알 수 없다" 단어를 보완 |

### v0.2에서 더해진 파일
`src/domain/ai-policy-rules.js`(권한표, 화면·서버 공용), `api/_ai-data.js`(서버가 저장된 사실을 읽음), `api/_ai-resolve.js`(대상 읽기 → 권한표 → 근거 표). 옛 `api/_ai-target.js`(대상 존재 확인)는 없앴다. 화면은 `issue-ai.js`가 권한표로 칸을 보이고 `request`(대상 ID와 사용자가 고른 값)만 서버로 보낸다. `callAi`는 서버가 근거 표를 만드는 종류에서는 근거 표를 보내지 않는다.

## 2. 설정
환경변수는 spec 022와 같다(`ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_MODE=fixtures`). 새 환경변수 없음. 칸별 한도는 `ASSIST_LIMITS`(`ai-assist-rules.js`), 비교 기준은 `FOLLOWUP_RULES`(`ai-followup-rules.js`).

## 3. 순서와 되돌리기
1. 시험 먼저: 규칙(`ai-issue-facts-rules`·`ai-followup-rules`·`ai-assist-rules`) → 서버(`ai-assist-api`)
2. 규칙 → 서버 → 화면. 화면은 확인용 환경(저장소 밖, spec 022와 같은 방식)에서 실제 앱 코드로 확인
3. 되돌리기: `issue-detail.js`의 AI 연결 줄(`investigate`·`followupBlocks`·`aiCheck`)을 지우면 이전 화면과 같다. 서버는 종류 세 개를 `AI_KINDS` 밖으로 빼면 닫힌다

## 4. shortcut
- 코드 대조 ①②(완료·설비 정상 표현)는 키워드 정규식이다(놓치는 표현·잘못 잡는 표현이 있을 수 있음, 어긋남 줄은 "확인 요청"이지 판정이 아님)
- 문서 번호 검사는 접두어(SOP·WI·DEV·OOS·CAPA 등)와 "문서 번호" 표기만 본다
- 비교는 같은 항목(specification id)과 기준 버전·단위·공정 단계 연결만 본다. 같은 제품 안의 다른 항목은 비교하지 않는다
- 근거 표 진위는 서버가 검증하지 못한다
- 보관한 결과의 모양 검사는 spec 022의 `isUsableAiResult`(claims 필수)를 쓰므로, 평가서 점검 결과는 보관하지 않는다
