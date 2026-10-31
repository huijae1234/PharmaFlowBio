# 스킬 기록 (skills.md)

## 1. 우리 팀 스킬 (`.claude/skills/`)
| 스킬 | 새로 / 고침 | 원래 스킬과 구한 곳 | 바꾼 것 | 왜 바꿨나 | 써 본 곳 | 쓰기 전과 후 |
|---|---|---|---|---|---|---|
| `pharmaflow-review` | 고침 | Claude Code 기본 `/code-review`(Claude Code에 들어 있는 스킬, 따로 설치하지 않음) | 기본 리뷰 뒤에 프로젝트 확인 여섯 가지를 더함: 키가 화면 코드에 있나, 서버에서도 막히나, 층 방향, 같은 요청 두 번, 화면·DB 규칙 일치, 문서·시험 한 세트 | 기본 리뷰는 코드 안의 버그를 찾지만 이 프로젝트의 문제는 "화면만 막고 서버는 안 막음"과 "시험 개수·문서 어긋남"이었다 | 2026-10-29 `checklist` 브랜치 전체 1회 ([review.md](../review.md)). **PR에서 두 번째 사용은 아직 없음** | 전: 층 방향을 잡는 시험이 없었고 시험 개수 어긋남이 눈에 안 띔. 후: 시험 2개 추가(`tests/architecture.test.js`), 개수 어긋남을 "걸림"으로 기록. 이건 한 번 써 본 결과이고 두 번 이상 비교는 아직 못 함 |
| `pharmaflow-spec` | 고침 | 개인 하네스 스킬 `harness-spec-plan`(유○○ `~/.claude/skills`, 템플릿 2개·점검 스크립트 포함) | 화면 용어(D3)·하지 않을 것·판정은 사람·AI 기능 규칙(근거 표·검증·호출 비용), plan 기본값(스택·층 방향·DB는 public 함수·RLS·마이그레이션·DB 시험·적용은 승인 뒤·키), 점검 스크립트에 다른 spec과 겹치는 Q 번호 경고와 다음 Q·spec(012~016 예약 건너뜀)·마이그레이션 번호 안내 | 팀원의 Claude가 같은 순서로 spec·plan을 쓰게. Q 번호를 찾느라 다른 spec을 뒤지던 일, 마이그레이션 번호가 겹친 일(debug-note DN-03)을 줄이려고 | 2026-10-29 spec 21개 전체에 점검을 돌림(PR #32) | 전: 원본 스크립트는 번호 겹침을 몰랐다. 후: spec 001·003과 021·022의 Q 번호 겹침(Q1~Q12), spec 023·024가 여섯 칸 틀이 아님을 찾음(김희재 문서라 고치지 않고 알림). 다음 번호 Q101·spec 027·마이그레이션 0039 안내 |
| `pharmaflow-qa` | 고침 | 개인 하네스 스킬 `harness-qa`(유○○ `~/.claude/skills`) | 확인 방법 표(함수 시험·DB 시험 PF_TEST·미리보기 캐시·서버 다시 켜기·시험 모드 세 가지·실제 AI 호출 10번 넘으면 비용 승인), 역할별 계정, 표 점검 스크립트 `check_qa.py` 새로 만듦(표 머리와 칸 수, 증거 없는 통과, 빠진 SC, 요약 숫자) | 표를 스크립트로 고치다 "기대 결과" 칸이 지워진 일(qa 025 실패와 조치 7)을 다시 겪지 않게, 팀원마다 qa 표 모양이 달랐던 것(021~024는 4칸)을 맞추려고 | 2026-10-29 qa.md 21개 전체에 점검을 돌림(PR #32) | 전: 칸이 깨진 줄을 아무도 몰랐다. 후: 글 안의 `|` 때문에 깨진 줄 5개(qa 005 C-09·009 C-03·010 C-04·011 C-05·018 C-06)를 찾아 `\|`로 고침, 21개 모두 통과 |

다른 팀 스킬 후보(아직 만들지 않음):
- 시험·문서 개수 맞추기: 시험을 더할 때 `test-data.md`·`04-test-report.md` 표에 한 줄 더하고 시험 개수를 적은 곳(README·CLAUDE.md·PRD·coverage)을 함께 고친다. 실제로 개수가 어긋난 일이 여러 번 있었다.
- 단계 PR 절차: 브랜치 → 커밋 → PR → 검토 기록 → 병합(CLAUDE.md의 D2 규칙)을 한 번에 안내한다.

## 2. 배운 스킬 (전역 하네스에서 이 프로젝트에 쓴 것)
| 스킬 | 어디에 썼나 |
|---|---|
| `grilling` / `domain-modeling` (`/grill-with-docs`) | 문제 정의, GLOSSARY, ADR (`docs/문제정의.md`, `docs/adr/`) |
| `erd` | `docs/ERD.md` |
| `intent` · `spec` · `plan` | `docs/Intent.md`, `docs/specs/*/spec.md`·`plan.md` |
| `ls-slide-skill` | `발표/erd.html`, `발표/erd-data-structure.html` |
| `ponytail` (플러그인, 코드 작업 때 켜 둠) | 작은 변경 원칙으로 작업. 이 프로젝트 파일에는 적용 사례가 따로 남아 있지 않다 |

### 2-1. 유○○이 쓴 스킬 (2026-10-29 추가, 유○○의 Claude 세션 기록 기준)
이 앱을 빈 폴더에서 시작한 유○○ 계정의 Claude 세션에서 실제로 부른 스킬만 적었다. 모두 개인 전역 폴더(`~/.claude/skills`, "하네스")에 있는 스킬이라 저장소에는 복사본이 없다. 위 표의 `intent`·`spec`·`plan`·`erd`와 같은 일을 하는 스킬이며, 이 세션에서는 아래 이름으로 불렀다.

| 스킬 | 어디에 썼나 | 근거 |
|---|---|---|
| `harness-start` | 프로젝트 시작: "새 하네스를 만들까요?" → 프로젝트 `CLAUDE.md`, 스택·디자인 인터뷰 | [CLAUDE.md](../CLAUDE.md) |
| `grill-with-docs` (`grilling` + `domain-modeling`) | 문제 정의 인터뷰, 용어집, 결정 기록 | [문제정의.md](문제정의.md), [GLOSSARY.md](../GLOSSARY.md), [adr/](adr/) |
| `harness-ia` | 정보구조도·화면 목록·엑셀 | [IA.md](IA.md), `IA.xlsx` |
| `harness-journeys` | 핵심 사용자 여정(CUJ) | [journeys/](journeys/) |
| `harness-prd` | PRD와 IA·여정 추적성 검사 | [PRD.md](PRD.md) |
| `harness-erd` | 데이터 관계도와 필드 표 | [ERD.md](ERD.md) |
| `harness-intent` | 무엇을·왜·어디까지(Intent) 작성, 작업마다 변경 기록 | [Intent.md](Intent.md) |
| `harness-spec-plan` | 기능마다 spec(무엇·왜)과 plan(어떻게), FR·SC 번호 추적 검사 | `docs/specs/*/spec.md`·`plan.md` (001~011·017~026) |
| `harness-qa` | 기능마다 QA 목록(C·H 항목), 단계마다 결과·증거 기록 | `docs/specs/*/qa.md` |
| `ponytail-review` | plan 단계 끝 코드 점검(고치지 않고 보고만) | spec 001·017·018·025·026의 plan·qa, 025 plan v0.5 10단계 |
| `design-styles` | 화면 스타일 후보 고르기(클린 틸) | [specs/007](specs/007-화면디자인-예시자료/spec.md) |
| `ui-ux-pro-max` | 디자인 시스템 근거 찾기, 화면 점검 체크리스트 | CLAUDE.md 디자인 절, 기능별 qa의 화면 점검 |
| `claude-api` | Claude 호출 방식·모델 확인(Haiku 5.5, `output_config.effort`) | [specs/025](specs/025-AI-도우미-챗봇/plan.md)·[026](specs/026-아침-브리핑-슬랙/plan.md) |

문서에 이름만 나오고 이 세션 기록으로는 직접 불렀는지 확인되지 않는 것(`web-design-guidelines`, `code-review`, `run`)은 표에 넣지 않았다.

## 3. 새로 찾은 스킬
없음(2026-10-29 김희재 확인: 팀이 수업 밖에서 따로 찾아 쓴 스킬은 없다). 찾으면 어디서 구했는지, 깔기 전에 확인한 것(만든 사람, 요구하는 권한, 저절로 도는 훅이 있는지)을 여기에 적는다.

## 4. 빈칸
- 팀 스킬은 3개다(2026-10-29 `pharmaflow-spec`·`pharmaflow-qa` 추가). 세 개 모두 두 번 이상 썼다(PR #32의 첫 사용, 6절의 두 번째 사용).
- 새 세션 확인(2026-10-29, 김희재): 새 세션 세 개에 "이 저장소의 규칙을 세 줄로 말하고 우리 팀 스킬을 알려 줘"라고 물었다. 팀 스킬은 세 세션 모두 세 개를 같게 답했고, 규칙은 고른 세 줄만 다르고 내용은 `CLAUDE.md`와 맞았다([캡처](../assets/captures/23-new-session/new-session-1.webp)). 팀 스킬 답을 고정하려고 `CLAUDE.md`에 "팀 스킬" 절을 넣었다(`6d27a9a`).
- 이 하네스(스킬 포함)를 PR로 `main`에 올리는 일: 2026-10-29 `docs-submission` 브랜치로 `checklist`·`qa-list`를 합쳐 PR #32를 올렸고, 같은 날 `main`에 병합했다(`2525588`).

## 5. 팀 스킬이 저장소에 1개뿐이던 이유 (2026-10-29 오전 기록, 지금은 3개)
- **(2026-10-29 저녁 갱신) `main`의 `.claude/skills/`에 3개 모두 있다:** `pharmaflow-review`, `pharmaflow-spec`, `pharmaflow-qa`(PR #32 병합 `2525588`). 아래는 1개뿐이던 오전의 기록이다.
- **저장소 `.claude/skills/`에는 `pharmaflow-review` 1개뿐이다.** 원격 모든 브랜치를 검색했고, 다른 브랜치에도 없다(`checklist`·`qa-list`에만 이 1개).
- **쓴 스킬은 많지만 저장소 밖에 있다.** `grilling`·`domain-modeling`(`/grill-with-docs`)·`erd`·`intent`·`spec`·`plan`·`project-kickoff`·`ego-browser` 등은 개인 전역 폴더(`~/.claude/skills`)에, `ponytail`·`ls-slide-skill`은 플러그인에 있다. 저장소에 복사본이 없고 이 프로젝트에 맞게 고친 버전도 없다.
- **원안이 세는 것:** "팀 스킬"은 팀이 **저장소에 새로 만들거나 기존 스킬을 우리 프로젝트에 맞게 고쳐 넣은 것**이다(원안 6절·"팀 스킬 두세 개"). 위 2절의 "배운 스킬"은 따로 적는 표이고 팀 스킬 개수에 들어가지 않는다. 그래서 지금은 팀 스킬 1개 + 배운 스킬 5줄이다.
- **기록이 빠졌을 가능성:** 유○○이 쓴 스킬은 2-1절에 더했다(2026-10-29). 윤○○이 자기 환경에서 쓴 스킬은 아직 기록이 없어 받아서 더해야 한다(미확인).
- **2~3개로 늘리는 두 방법(김희재가 정함):** (가) 많이 쓴 전역 스킬(`spec`·`plan` 등)을 이 프로젝트에 맞게 고친 복사본을 `.claude/skills/`에 넣는다. 원래 스킬을 쓴 기록은 spec 21개가 있지만, 고친 버전을 쓴 기록은 넣은 뒤에 쌓아야 한다. (나) 같은 일을 이미 반복한 것을 새 스킬로 만든다(위 후보 두 개). 어느 쪽이든 "써 본 곳(PR)"은 실제로 쓴 뒤에만 적는다.

## 6. 팀 스킬 추가 사용 기록 (2026-10-29 17:30~17:45, `checklist` `ce6484e` 기준)
팀 스킬은 세 개다. `pharmaflow-review`는 이 브랜치의 `.claude/skills/`에 있다. `pharmaflow-spec`·`pharmaflow-qa`는 **PR #32(`docs-submission`, 커밋 `bf1c847`, 병합 전)에만 있어** 그 브랜치에서 꺼내 그대로 썼다. 이 브랜치에는 복사하지 않았다(#32 병합 때 들어온다). 아래가 이번 사용이고, 앞선 기록(1절 표와 PR #32의 첫 사용)은 그대로 둔다.

| 스킬 (파일) | 적용 대상 | 수행한 점검 | 발견 | 수정 | 적용 전후 차이와 남은 문제 |
|---|---|---|---|---|---|
| `pharmaflow-qa` (`.claude/skills/pharmaflow-qa/SKILL.md`, PR #32 `bf1c847`) | Day 8 ego lite QC 시험 E-01~E-11 설계·기록([04-test-report.md](04-test-report.md) Day 8 절), 오늘 시험한 기능의 qa 파일(spec 017·008·004) | 스킬 규칙 1·2("증거 없이 통과로 적지 않는다", "못 한 것은 확인 못 함과 이유")대로 시험마다 화면 문구·캡처를 붙이고 권한 밖 시험은 No Run과 준비 조건으로 적음. `check_qa.py`로 spec 017·008·004의 qa.md 표 점검 | 표 점검: 셋 다 "통과"(추가 발견 없음). 시험 기록: 쓰기를 못 한 검체 흐름(E-10)을 Pass로 적지 않고 "보기 Pass / 쓰기 No Run"으로 나눔 | 없음 | 전: 오전 ego lite 기록(X-01~04)은 보기만, 증거 칸이 캡처 위주. 후: 시험마다 순서·예상·실제·결과·캡처·한계를 같은 모양으로 적음. 남은 것: QA·생산 역할의 같은 시험 |
| `pharmaflow-spec` (`.claude/skills/pharmaflow-spec/SKILL.md`, PR #32 `bf1c847`) | 오늘 화면 결과와 spec 017(시험값 한 번에 입력)·004(세 단계 판정)의 일치 | `check_spec_plan.py`로 spec 017·004 추적성 점검. 화면에서 본 동작을 spec 수용 기준과 한 줄씩 대조: FR-003 수용 기준 2("이미 넣은 항목은 '입력됨'으로 칸 없이"), FR-001 수용 기준 2("3개 중 일부만 입력이면 시험 완료 알림 없음"), 경계값(관리기준 상한 6.8·115 → 정상) | 점검: 둘 다 "통과", 다음 Q101·spec 027·마이그레이션 0039 안내. 대조: 세 가지 모두 화면과 문서가 같음. 추가 발견 없음 | 없음 | 남은 것: 알림이 안 갔다는 확인은 QC 계정 알림 수 기준이고 QA 쪽 알림 함은 못 봄 |
| `pharmaflow-review` (`.claude/skills/pharmaflow-review/SKILL.md`, 이 브랜치) | 이번 변경(`docs/04-test-report.md`·`debug-note.md`·`coverage.md`·`skills.md`·`review.md`, 캡처 16장 `assets/captures/day8-ego/`) | 여섯 가지 확인. 1단계 기본 `/code-review`는 CLAUDE.md "문서만 바뀐 때만 건너뛴다"에 따라 건너뜀(코드 변경 없음) | 1 키: 바뀐 글·캡처에 키·이메일 없음(검색 0건). 2~5: 해당 없음(코드·DB 변경 없음). 6 문서·시험: `node --test` 505/505, 새 링크 깨짐 0. 추가 발견 없음 | 없음 | 결과는 [review.md](../review.md) 맨 위 |
