# 리뷰 기록 (review.md)

우리 팀 리뷰 스킬 `.claude/skills/pharmaflow-review/SKILL.md`로 본 결과를 위에 더한다. 기본 `/code-review`에 프로젝트 확인 여섯 가지를 더한 것이다(원래 무엇이고 무엇을 바꿨는지는 [docs/skills.md](docs/skills.md)).

## 확인 여섯 가지
1. 키가 화면 코드에 있나
2. /admin과 쓰기가 서버에서도 막히나
3. 층 방향(domain이 ui·infrastructure를 가져오지 않나)
4. 같은 요청 두 번·동시 요청
5. 화면 규칙과 DB 규칙이 같나
6. 문서·시험 한 세트

## 2026-11-05 · 포트폴리오 사본 `main` · 게스트 안내 문구, 사용자 화면 이메일 가리기, 0040 게스트 역할 막기 · Claude가 스킬대로
대상: `src/domain/roles.js`(maskEmail), `src/ui/pages/users.js`, `src/ui/layout.js`, `src/ui/app.js`, `styles/kit.css`, `supabase/migrations/0040_guest_role_guard.sql`, `supabase/tests/039_rules.sql`. 앞서 리뷰 없이 올린 0039(게스트 로그인)도 2·4번에서 함께 봄.
1단계 기본 `/code-review`(high) 결과 5건: 게스트에게 역할을 줄 수 있음(고침, 0040), 게스트 줄이 목록에 쌓임(고침, 0040), 긴 이메일이 좁은 화면에서 넘침(고침, kit.css), 눈 단추 44px < 전역 48px(보류: 프로젝트 토큰 `--tap-size` 44px를 그대로 씀), maskEmail 위치(보류: 사용자·역할 화면 전용이라 roles.js에 둠).

| 번호 | 결과 | 근거 |
|---|---|---|
| 1 키 | 통과 | `src/config.js`는 공개 키만. `node --test`의 architecture 시험 통과 |
| 2 서버 권한 | 통과 | 이메일 가리기는 화면 표시만이고 이메일은 여전히 `list_users`(QA 관리자만)로만 읽힘. `delete_guest`는 익명 계정만 지움, `set_user_role`이 게스트 거절(0040). `039_rules.sql` 8/8 |
| 3 층 방향 | 통과 | maskEmail은 domain, 화면은 domain만 가져옴 |
| 4 두 번·동시 | 해당 없음 | 상태를 바꾸는 새 함수는 본인 계정 삭제뿐(두 번 불러도 두 번째는 지울 것이 없음) |
| 5 화면·DB 규칙 | 통과 | 게스트 판단은 DB(`auth.users.is_anonymous`)와 화면(`session.user.is_anonymous`)이 같은 값 |
| 6 문서·시험 | 통과 | `roles.test.js` 새 시험 먼저 실패 확인 후 구현, `node --test` 537개 통과. README·CLAUDE.md 개수 537, ERD v0.19, IA 두 줄, MIGRATION-NOTES |

## 2026-10-29 17:45 · `checklist` Day 8 기록 변경(문서·캡처만) · 사람이 아니라 Claude가 스킬대로 확인
대상: `docs/04-test-report.md`(Day 8 절), `docs/debug-note.md`(DN-10), `docs/coverage.md`, `docs/skills.md`, 캡처 16장 `assets/captures/day8-ego/`. 기준 `ce6484e` 위의 작업. 스킬 파일 `.claude/skills/pharmaflow-review/SKILL.md`.
1단계 기본 `/code-review`는 CLAUDE.md "문서만 바뀐 때만 건너뛴다"에 따라 건너뜀(코드·DB 변경 없음).

| 번호 | 결과 | 근거 |
|---|---|---|
| 1 키 | 통과 | 바뀐 글에서 `sbp_`·`sb_secret_`·`service_role`·`sk-ant`·`xox`·이메일 검색 0건. 캡처에는 이름(김희재·유○○·윤○○)만 보이고 이메일 없음 |
| 2 서버 권한 | 해당 없음 | 코드 변경 없음. 참고로 이번 시험 E-09에서 QC 계정의 관리자 주소 4개가 막힘을 확인 |
| 3 층 방향 | 해당 없음 | 코드 변경 없음 |
| 4 같은 요청 두 번 | 해당 없음 | 코드 변경 없음. 참고로 E-07에서 이미 넣은 시험 항목이 창에 다시 나오지 않음을 확인 |
| 5 화면·DB 규칙 | 해당 없음 | 코드 변경 없음 |
| 6 문서·시험 | 통과 | `node --test "tests/*.test.js"` 505/505(17:39 직접 실행). 새 상대 링크 깨짐 0. 22번 상태를 "일부 완료"로 내린 이유(DN-10)를 coverage·debug-note·04에 같은 말로 적음 |

추가 발견 없음. 남은 것: PR 단위 리뷰(GitHub 리뷰)는 아직 0건이다.

## 2026-10-29 · `checklist` 브랜치(main f47af6e 병합 후) 전체 · 사람이 아니라 Claude가 읽고 찾음
| 번호 | 결과 | 근거 |
|---|---|---|
| 1 키 | 통과 | `src/`·`index.html`에 관리자 키 이름은 주석뿐(`src/config.js:3`). `innerHTML` 사용 0건. 자동 검사 `tests/architecture.test.js` 추가 |
| 2 서버 권한 | 통과 | 쓰기 함수가 있는 마이그레이션 16개에 `private.require_role`, RLS는 표 17개 모두. `api/_public-data.js`의 `verifyUser`가 로그인을 확인. 화면의 `canOpen`(`src/ui/app.js:81`)은 보이기만 정함 |
| 3 층 방향 | 통과 | `src/domain/` 파일의 가져오기는 모두 같은 폴더(`./`). **이전에는 이 규칙을 잡는 시험이 없었다** → `tests/architecture.test.js`로 추가 |
| 4 같은 요청 두 번 | 통과 | [docs/04-test-report.md](docs/04-test-report.md) D-01~D-07 |
| 5 화면·DB 규칙 | 통과 | 검체 수량 1~9999, 계획 수량 100만이 `domain/`과 DB 시험에 같은 값 (`tests/sample-rules.test.js`, `008_rules.sql`) |
| 6 문서·시험 | **걸림** | 시험 개수를 적은 곳이 서로 다르다. 이 브랜치는 227개인데 README·CLAUDE.md는 192개, PRD에 다른 숫자가 있다. 포크 브랜치(`phase-13-regulatory-card`)는 265개 → 합칠 때 한 번에 맞춘다 |

한계: DB 시험 SQL은 실행하지 못했고(팀 Supabase), 위 2·4번의 "통과"는 시험 파일과 코드를 읽어 확인한 것이다.

## 2026-10-29 후속 (`checklist`에 `main` 94ed746 합친 뒤)
- 6번(문서·시험 개수): README·CLAUDE.md를 실제로 돌려 본 **505개**(`main` 503 + 자동 검사 2)로 맞췄다. PRD 7-1절의 "192개"도 505개로 고쳤다. 다른 문서에 남은 225·227·280·399·437·477·488·490·503개는 그때 브랜치의 값이다([coverage.md](docs/coverage.md) 머리말).
- 이 후속 기록은 **사람이 아니라 Claude가 숫자를 대조한 것**이고, 리뷰 스킬을 PR에서 새로 돌린 것이 아니다. 따라서 "스킬을 두 번 이상 써 본 기록"은 아직 채워지지 않았다.

## 해야 할 것
- 6번: 시험 개수를 맞추는 일. 포크 브랜치가 `main`에 합쳐진 뒤 한 번에 한다.
- 다음 PR마다 이 스킬을 돌려 위 표에 줄을 더한다(최소 두 번 써 본 기록이 필요).
