# plan: 아침 브리핑 (평일 오전 8시 직무별 슬랙 개인 메시지)

- 기능 ID: 026
- 상태: 승인됨 (2026-10-29, 사용자 "plan 025 v0.3과 026 승인")
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-29 / 2026-10-29
- 기준 spec: ./spec.md (v0.1 승인)
- 근거 문서: docs/ERD.md(profile·quality_issue·deviation_review·action_request·work_order·batch·notification), docs/specs/009(슬랙 `api/_slack.js` deliver, 알림 함 notification), docs/specs/022(근거 표·문장 검증), docs/specs/023 v0.2·024(권한표 `ai-policy-rules.js`, 일정 `ai-schedule-rules.js` 한국 날짜), Vercel 공식 문서(Cron Jobs: `vercel.json` `crons`, `CRON_SECRET`을 Bearer로 보냄 — 2026-10-29 확인), 지금 코드(브랜치 phase-15-chatbot)

## 0. 요약
FR-001~010. Vercel 정해진 시각 실행이 평일 08시(한국)대에 서버 함수 하나를 부르고, 그 함수가 Supabase 관리자 키로 **읽기 전용 DB 함수 하나**를 불러 사람마다 그 역할 범위의 항목(개수·앞 3건·링크)을 받는다. 글은 순수 함수가 만들고, AI 한두 줄은 spec 022 검증을 통과할 때만 붙인다. 슬랙은 spec 009의 `deliver`로 보내고, 앱 알림 함에는 "보냈습니다" 한 줄만 남긴다. 4단계: ① 순수 규칙(시험 먼저) ② DB 함수·마이그레이션 0036 ③ 발송 함수·시험 모드 ④ 정해진 시각 등록·실제 발송 확인·문서.

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 정해진 시각 실행 | Vercel Cron Jobs (`vercel.json` `crons`) | 일정 `0 23 * * 0-4` (UTC 일~목 23시 = 한국 월~금 08시) | 이미 쓰는 배포처, 추가 비용 없음. 무료 플랜은 하루 1번·시각이 최대 1시간 늦을 수 있음 (spec Q96 가정) | Supabase pg_cron(DB에서 슬랙 호출·키 관리가 어려움), 외부 스케줄러(새 서비스) |
| 발송 함수 | Vercel 함수(Node) `api/briefing.js` | 로컬 Node v24.21.0 | 기존 api/와 같음 | - |
| 문 지키기 | `CRON_SECRET` 환경변수, 요청 머리 `Authorization: Bearer …` 비교 | Vercel이 자동으로 붙임 (공식 문서) | 아무나 발송 주소를 부르지 못하게 (FR-010 수용 기준 2) | 주소 숨기기 |
| 자료 읽기 | Supabase 관리자 키(service role) + 읽기 전용 DB 함수 `public.morning_briefing_items(p_user uuid)` | Supabase 프로젝트 YOUR_SUPABASE_PROJECT_REF (Postgres 버전은 [확인 필요] — 2단계에서 확인) | 새벽엔 로그인한 사람이 없다(spec Q98). 관리자 키는 RLS를 건너뛰므로 **범위 거르기는 DB 함수가 역할로** 한다 | 서버가 관리자 키로 표를 직접 읽고 JS가 거르기(거르기를 빠뜨리면 다 보임) |
| 슬랙 | `api/_slack.js` `deliver` (spec 009) | - | 이미 검증된 개인 메시지·실패 문구 | 새 슬랙 코드 |
| AI | `api/_claude.js` `askClaude`, spec 022 `reviewAnswer` | Haiku 5.5 | 같은 키·검증 | - |
| 시험 | `node:test` | Node v24.21.0 | 프로젝트 규칙 | - |

**새 라이브러리: 없음.**
**새 환경변수 (사용자가 Vercel·`.env`에 넣음, 값은 코드·문서·대화에 쓰지 않음):** `SUPABASE_SERVICE_ROLE_KEY`(`.env.example`에 이미 이름 있음), `CRON_SECRET`.

## 2. 구조와 파일

### 폴더 트리
```text
api/
├── briefing.js               (신규) 정해진 시각에 불림: 문 확인 → 평일 확인 → 받는 사람 → 사람마다 항목 읽기·글·AI·슬랙·알림
├── _briefing-data.js         (신규) 관리자 키로 받는 사람 목록·DB 함수·알림 기록 부르기 (`_`라 함수로 안 열림)
└── _briefing-fixture.js      (신규) 시험 모드 항목 (역할 셋)
src/domain/
└── briefing-rules.js         (신규) 평일·한국 날짜, 역할별 절 순서, 슬랙 글 만들기, AI 근거 표·검증 연결
supabase/migrations/
└── 0036_morning_briefing.sql (신규) DB 함수 2개 + 알림 종류 'morning_briefing'
supabase/tests/
└── 026_rules.sql             (신규) DB 시험 (끝에 되돌림, "PF_TEST 통과 N/N")
tests/
├── briefing-rules.test.js    (신규)
└── briefing-api.test.js      (신규)
vercel.json                   (수정) crons 한 줄
src/ui/inbox.js               (확인만) 새 알림 종류 글자가 나오는지
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `0036_morning_briefing.sql` | (2단계에서 함수 4개로 나눔: `morning_briefing_recipients()` 직원 목록, `morning_briefing_already_sent(p_user, p_day)`, 아래 두 함수. 도우미 `private.briefing_list·briefing_count·briefing_days`) `public.morning_briefing_items(p_user uuid) returns jsonb` — p_user의 역할을 읽어 그 역할의 절만 계산(개수·앞 3건·링크 경로, 못 읽은 절은 상태 `failed`). `public.record_morning_briefing(p_user uuid, p_day date, p_status text)` — 같은 날 이미 있으면 아무것도 안 함, 없으면 알림 한 줄. 알림 종류에 `morning_briefing` 추가. 두 함수 모두 `service_role`만 실행(anon·authenticated 회수) | FR-001 수용 기준 2, FR-002~005, FR-008, FR-010 | 읽기 함수는 아무것도 바꾸지 않는다(`stable`). 다른 사람 이름·이메일을 돌려주지 않는다 |
| `api/_briefing-data.js` | 관리자 키로 DB 함수 4개만 부르기(표를 직접 읽지 않음), 10초 제한 | FR-002, FR-009 | 관리자 키는 이 파일에서만 읽는다. 응답·오류 문구에 키를 넣지 않는다 |
| `src/domain/briefing-rules.js` | `isWeekdayKst(now)`, `kstDay(now)`, `ROLE_SECTIONS`(QA·QC·생산의 절 순서 — spec FR-003~005), `briefingText({ role, sections, aiLines, origin })`(개수·앞 3건·"외 N건"·읽지 못함·0건 문구), `briefingFacts(sections)`(spec 022 근거 표 모양으로) | FR-003~007 | 순수 함수. 링크는 `#/`로 시작하는 경로만 |
| `api/briefing.js` | 문 확인(CRON_SECRET) → 평일 아니면 끝 → 받는 사람마다(한 사람 실패가 다음을 막지 않게): 이미 보냈으면 건너뜀 → 항목 → 글 → (선택) AI 한두 줄·검증 → `deliver`(채널 대체 없음, 개인 메시지만) → `record_morning_briefing` → 사용 기록 한 줄(개수만) | FR-001, FR-002, FR-007~010 | 슬랙을 못 찾으면 알림 함에 "슬랙으로 보내지 못했습니다" (FR-002 수용 기준 2). 브리핑 내용은 기록에 남기지 않는다 |
| `vercel.json` | `"crons": [{ "path": "/api/briefing", "schedule": "0 23 * * 0-4" }]` | FR-001 | 배포한 production에서만 돈다 |

### 자료 구조 (ERD: 표 추가 없음, notification 종류 값 하나 추가 → 먼저 물을 것)
| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| 브리핑 절 (DB 함수 응답) | `key`(예: `qa_waiting_issues`), `label`, `state`(ok·failed), `count`, `top`(최대 3: `{ text, path }`) | jsonb | 예 | 계산 | spec FR-003~006 |
| 발송 기록 | notification(recipient_id, kind=`morning_briefing`, link_path=그 역할 홈, created_at) | 기존 표 | 예 | 저장 | spec FR-008, ERD notification |
| 같은 날 두 번 막기 | 그 사람·그 한국 날짜에 `morning_briefing` 알림이 있으면 보냄으로 본다 | - | - | 계산 | spec FR-001 수용 기준 2 |

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| 공통 컴포넌트 알림 함 | "아침 브리핑을 슬랙으로 보냈습니다 · 08:02" 한 줄 → 그 역할 홈 | 기존 `src/ui/inbox.js` (종류 글자만 확인) |
| HM_010000·020000·030000 | 링크가 가는 곳 (홈·이슈·평가·작업지시·로트 목록) | 변경 없음 |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 글 만들기 규칙 (DB·슬랙 없이) | FR-003~007 | `briefing-rules.js`, 시험 | 시험이 먼저 실패한 뒤 통과. 세 역할 글이 직무별 표와 같고 다른 직무 절이 없음 | 없음 |
| 2 | 읽기 전용 DB 함수 | FR-002~005, FR-008, FR-010 | 0036, DB 시험 026 | DB 시험 "PF_TEST 통과 N/N"(되돌림). **실제 DB 적용은 승인 뒤** | 0036 적용 승인 |
| 3 | 발송 함수와 시험 모드 | FR-001, FR-002, FR-007~010 | `api/briefing.js`, `_briefing-*`, API 시험 | 시험 모드에서 로컬로 세 역할 글을 만들고(슬랙 안 보냄) 결과 확인. 함수 시험 통과 | 없음 |
| 4 | 정해진 시각 등록·실제 확인·문서 | 전부 | `vercel.json`, 실제 발송 1번(사용자 본인에게만), IA·PRD·ERD·CLAUDE.md·Intent | 실제 슬랙으로 본인 브리핑 1통 + 알림 함 한 줄 확인. 다음 평일 08시대 자동 발송 기록 확인 | 환경변수 두 개를 사용자가 넣음, push·PR·병합 승인 |

### 1단계 작업
- [ ] `tests/briefing-rules.test.js` 먼저: 평일·주말·한국 자정 경계(UTC 일 23시=월 08시), 세 역할 절 순서, 0건 문구("이상이 없다는 보증은 아닙니다"), 읽지 못한 절, 앞 3건과 "외 N건", 링크는 `#/`만, 다른 사람 이름이 들어간 글은 없음, AI 줄이 검증에 걸리면 빠짐
- [ ] `src/domain/briefing-rules.js`
- [ ] 전체 시험, `ponytail-review`, qa 1단계 기록

### 2단계 작업
- [ ] `supabase/tests/026_rules.sql` 먼저: 가짜 사람 셋으로 역할별 절·개수, 생산에게 QA 전용 절 없음, "내 조치"는 그 사람 것만, 같은 날 기록 두 번 → 한 줄, anon·authenticated는 함수 실행 불가
- [ ] `0036_morning_briefing.sql` (되돌리기 블록 포함). **실제 DB 적용은 사용자 승인 뒤** (MCP `apply_migration`)
- [ ] DB 시험을 Supabase에서 돌려 통과 확인(되돌림)

### 3단계 작업
- [ ] `tests/briefing-api.test.js` 먼저: 비밀 값 없음·틀림 401, 주말은 아무것도 안 함, 한 사람 슬랙 실패가 다음을 막지 않음, 이미 보낸 사람 건너뜀, 슬랙 못 찾음 → 알림 함 안내, AI 실패·검증 걸림 → 목록만, 응답·기록에 키·브리핑 내용 없음
- [ ] `api/briefing.js`, `api/_briefing-data.js`, `api/_briefing-fixture.js`
- [ ] 로컬 서버 시험 모드(`AI_MODE=fixtures`, 새 `BRIEFING_MODE=fixtures`)로 `GET /api/briefing?dry=1` → 세 역할 글을 화면에 돌려받아 확인 (슬랙 안 보냄, Vercel에서는 꺼짐)

### 4단계 작업
- [ ] `vercel.json` crons
- [ ] 사용자에게 환경변수 두 개를 Vercel·`.env`에 넣어 달라고 안내(값은 대화에 쓰지 않음)
- [ ] 배포 뒤 본인에게만 보내는 확인 요청(`?only=본인`, 비밀 값 필요) 1번 → 슬랙·알림 함 확인
- [ ] 다음 평일 08시대 자동 발송 기록 확인 (Vercel 로그·사용 기록)
- [ ] IA(알림 함 종류)·PRD FR-61·ERD(notification 종류 값)·GLOSSARY "아침 브리핑"·CLAUDE.md·Intent, qa 절차 C

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | 함수 시험 + 실제 | briefing-rules "평일", briefing-api "같은 날", C-09 |
| FR-002 | 함수 시험 + DB 시험 | briefing-api "슬랙 못 찾음", 026_rules "직원만", C-05 |
| FR-003 | 함수 시험 + DB 시험 | briefing-rules "QA 절", 026_rules "QA", C-02 |
| FR-004 | 함수 시험 + DB 시험 | briefing-rules "QC 절", 026_rules "QC", C-02 |
| FR-005 | 함수 시험 + DB 시험 | briefing-rules "생산 절", 026_rules "생산", C-02 |
| FR-006 | 함수 시험 | briefing-rules "읽지 못함·0건·외 N건", C-03 |
| FR-007 | 함수 시험 | briefing-rules "AI 줄 검증", briefing-api "AI 실패", C-04 |
| FR-008 | DB 시험 + 실제 | 026_rules "알림 한 줄", C-08 |
| FR-009 | 함수 시험 | briefing-api "한 사람 실패", C-06 |
| FR-010 | 함수 시험 + DB 시험 | briefing-api "비밀 값", 026_rules "권한·내 조치", C-07 |
| SC-001 | 실제 | C-09, H-01 |
| SC-002 | 함수·DB 시험 + 사람 | C-02, H-02 |
| SC-003 | 실제 비교 | C-10 |
| SC-004 | 실제 | C-08 |
| SC-005 | 함수 시험 | C-06 |
| SC-006 | 함수 시험 | C-04 |
| SC-007 | 사람 QA | H-03 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node v24.21.0 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 평일 판정 | UTC 일 23:00, 토 23:00, 금 14:59 | 월(평일) 참, 일 거짓, 금 23:59 참 | FR-001 |
| 같은 날 두 번 | 이미 그날 기록 있음 | 보내지 않음 | FR-001 |
| 역할별 절 | QA·QC·생산 | spec FR-003~005의 절만, 순서대로 | FR-003~005 |
| 0건 | 모든 절 0 | "오늘 확인할 항목이 없습니다. 이상이 없다는 보증은 아닙니다." | FR-006 |
| 읽지 못함 | 한 절 failed | 그 절만 "읽지 못했습니다(앱에서 확인)" | FR-006 |
| 많음 | 7건 | 앞 3건 + "외 4건" + 목록 링크 | 경계 |
| AI 검증 | 목록에 없는 숫자를 쓴 줄 | AI 줄 빠지고 목록만 | FR-007 |
| 비밀 값 | 없음·틀림 | 401, 아무것도 안 보냄 | FR-010 |
| 실패 격리 | 둘째 사람 슬랙 오류 | 첫째·셋째는 보냄, 기록 "보냄 2 · 못 보냄 1" | FR-009 |

### 화면·실제 확인
1. 로컬 시험 모드 `GET /api/briefing?dry=1` → 세 역할 글이 직무별 표와 같다
2. 배포 뒤 본인에게만 1통 → 슬랙 개인 메시지 글·링크가 앱 화면으로 열림, 알림 함에 한 줄
3. 브리핑 숫자와 같은 시각 앱 화면 숫자 비교 (SC-003)

### QA
- `qa.md` 참고 (Claude QA C-01~C-10, 사람 QA H-01~H-03)

### 회귀 확인
- spec 009 슬랙 알림(조치·평가·검체): 함수 시험 + 알림 함 한 번
- 알림 함 다른 종류 글자·링크 그대로
- 전체 함수 시험 (지금 467개), DB 시험 001~008 중 notification을 쓰는 것

## 5. 제약과 주의점

### 보안
- `SUPABASE_SERVICE_ROLE_KEY`·`CRON_SECRET`·`SLACK_BOT_TOKEN`·`ANTHROPIC_API_KEY`는 Vercel 환경변수와 `.env`에만. 화면 코드·문서·대화·기록에 값을 쓰지 않는다.
- 관리자 키는 RLS를 건너뛴다 → 서버는 표를 직접 읽지 않고 **DB 함수 두 개만** 부른다. 두 함수는 `service_role`만 실행하고, 읽기 함수는 사람의 역할로 범위를 거른다.
- 브리핑은 슬랙 **개인 메시지만**: 슬랙 계정을 못 찾아도 공용 채널로 보내지 않는다(다른 사람 업무가 공개되지 않게).
- 받는 사람 이메일은 슬랙 계정 찾기에만 쓰고 기록·응답에 남기지 않는다.

### 성능
- 직원 3명 기준 한 번 실행 20초 이내(사람마다 DB 1번·Claude 1번·슬랙 2번). Vercel 함수 최대 실행 시간 안. 직원이 늘면 사람마다 차례로 보내 시간이 늘어난다 → shortcut 주석으로 기록.

### 호환성
- 슬랙 데스크톱·모바일 앱의 개인 메시지 글(`<주소|글자>` 링크).

### 지금 돌아가는 기능 깨지 않기
- notification 종류 제약에 값을 **더하기만** 한다(기존 값 그대로).
- spec 009 `deliver`·`api/notify.js`는 고치지 않는다.

### 경계
- 항상 할 것: 시험 먼저, 단계 끝마다 전체 시험·qa 기록, 시험 모드로 확인.
- 먼저 물을 것: 0036 실제 DB 적용, 환경변수 넣기(사용자가 직접), 실제 슬랙 발송(본인 1통 넘게), 정각 발송을 위한 유료 플랜, 커밋·push·PR·병합.
- 절대 하지 말 것: 메일·문자·푸시 발송, 앱 알림 함에 브리핑 내용, 공용 채널로 브리핑, 업무 찾아보기 기능, 완료일·지연 예측, 키를 코드·문서·대화에 쓰기, 실패하는 시험 지우기.

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 관리자 키 유출 | DB 전체 노출 | 환경변수에만, 서버 한 파일에서만 읽음, DB 함수 두 개로만 씀 |
| DB 함수의 거르기 실수 | 다른 직무 자료가 보임 | DB 시험 026에 "생산에게 QA 절 없음·내 조치는 본인 것만" |
| Vercel 실행이 늦음/빠짐 | 8시 정각이 아님, 하루 빠짐 | spec Q96 가정(8시대 한 번), 빠지면 다음 날 기록으로 알 수 있음. 정각이 필요하면 유료 플랜(먼저 묻기) |
| 같은 날 두 번 실행 | 두 통 받음 | 그날 알림 기록이 있으면 건너뜀 |
| 슬랙 이메일이 앱 이메일과 다름 | 슬랙 못 받음 | 알림 함 안내(FR-002 수용 기준 2) |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-29 | v0.1 | 승인됨 |
| 2026-10-29 | v0.1 | 처음 작성 (spec v0.1 승인 기준) |
