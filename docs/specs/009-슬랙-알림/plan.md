# plan: 담당자 슬랙 알림

- 기능 ID: 009
- 상태: 승인됨 (2026-10-26)
- 버전: v0.7 (8단계 승인 2026-10-27)
- 작성일 / 최종 갱신: 2026-10-26 / 2026-10-27
- 기준 spec: ./spec.md (v0.7, 승인됨)
- 근거 문서: docs/ERD.md v0.8, docs/IA.md v2.3 (AD_040000_PG 사용 기록), docs/adr/0001, CLAUDE.md "스택"·"하지 않을 것", 코드(api/_public-data.js, server.js, src/infrastructure/store.js·public-data.js, supabase/migrations/0002·0016·0019, src/ui/pages/usage.js)

## 0. 요약
- **범위:** spec 009 FR-001~005 전부
- **기술 접근:** "데이터베이스가 알림을 만들고, Vercel 함수가 슬랙으로 보낸다"
  - **만들기:** 업무 표에 트리거를 달아, 저장되는 순간 같은 처리 안에서 `notification` 표에 받는 사람마다 한 줄을 넣는다(상태 "대기"). 무엇을 누구에게 보낼지는 데이터베이스의 실제 상태로 정하고, 화면의 말은 믿지 않는다.
  - **보내기:** 화면은 저장에 성공한 뒤 `/api/notify`를 기다리지 않고 부른다. 함수는 로그인을 확인한 뒤 그 사람이 만든 대기 알림을 가져와(`claim_my_notifications`) 슬랙으로 보낸다. 그다음 결과를 적는다(`finish_notification`).
  - **슬랙 호출:** 의존성 없이 `fetch`로 슬랙 Web API를 부른다. `users.lookupByEmail`로 사람을 찾아 개인 메시지를 보내고(`chat.postMessage` + 사용자 id), 못 찾으면 채널로 보낸다.
  - **비밀 값:** 슬랙 봇 토큰은 `.env`와 Vercel 환경변수에만 둔다(공공데이터 키와 같은 방식, ADR 0001).
- **단계:** 3단계 — ① 데이터베이스(알림 만들기) ② 슬랙 보내기 함수와 화면 호출 ③ 알림 기록 화면·슬랙 설정 안내·배포 확인
- **브랜치:** `phase-5-slack`

## 1. 기술과 버전
| 영역 | 선택 | 정확한 버전 | 왜 | 버린 대안 |
|---|---|---|---|---|
| 알림 만들기 | Postgres 트리거 + `notification` 표 | Supabase pharmaflow (지금 그대로) | 저장과 같은 처리 안에서 만들어져 빠지지 않고, 받는 사람을 DB 상태로 정해 위조할 수 없다 | 화면이 "누구에게 보내라"를 정함(위조·누락), 함수마다 코드 추가(빠뜨리기 쉬움) |
| 보내기 | Vercel 함수 `api/notify.js` (Node, 서울) | 지금 api/와 같음 | 토큰을 서버에만 두는 기존 방식(ADR 0001) | DB에서 바로 슬랙 호출(pg_net, 토큰을 DB에 둬야 하고 시험이 어려움), 정해진 시각 실행(무료 플랜에 없음, Q51) |
| 슬랙 | Slack Web API `users.lookupByEmail`, `chat.postMessage` (봇 토큰, 권한 `chat:write`, `users:read`, `users:read.email`) | Web API (버전 없음) | 개인 메시지 + 이메일로 사람 찾기(spec FR-002) | Incoming Webhook(채널 하나뿐, DM 불가) |
| 시험 | `node:test` + 가짜 fetch / `supabase/tests/009_rules.sql` | 지금 그대로 | 기존 방식 | — |

**새 의존성:** 없음 (슬랙 SDK를 들이지 않고 fetch 두 번)

## 2. 구조와 파일

### 폴더 트리
```text
supabase/migrations/0021_notification.sql  (새로) 표·RLS·만들기 함수·트리거 4개·claim/finish 함수
supabase/tests/009_rules.sql               (새로)
api/_slack.js                              (새로) 슬랙 호출·메시지 글·보내기 순서 (함수로 열리지 않음)
api/notify.js                              (새로) POST: 로그인 확인 → claim → 보내기 → finish
src/infrastructure/store.js                (고침) 알리는 함수가 성공하면 flushNotifications() (기다리지 않음)
src/infrastructure/store-notifications.js  (새로) /api/notify 부르기, 알림 기록 읽기
src/ui/pages/usage.js                      (고침) QA 관리자 "슬랙 알림 기록" 칸
tests/slack-notify.test.js                 (새로)
.env.example                               (고침) SLACK_BOT_TOKEN=, SLACK_FALLBACK_CHANNEL= (빈 값)
docs/PRD.md §9, CLAUDE.md "하지 않을 것", docs/adr/0003, docs/ERD.md, docs/IA.md (고침·새로)
```

### 파일별 역할
| 파일 | 하는 일 | 담당 FR | 주의 |
|---|---|---|---|
| `0021_notification.sql` | `private.add_notification(recipients, kind, batch, path, message)`: 본인 빼기, 받는 사람 없으면 안 만듦, 되돌리기 중(`pharmaflow.resetting`)·로그인 없음이면 안 만듦. 트리거: sample_transfer(전달·반납), action_request(등록·다시 제출·승인 배정·반려), deviation_review(검토 요청·다시 제출·반려·보완 요청), measurement(규격 이탈) | FR-001, FR-004 | 업무 함수는 고치지 않는다. 트리거 오류가 업무 저장을 막지 않게 만들기 부분은 단순하게(받는 사람 찾기·글 만들기만) |
| 같은 파일 | `public.claim_my_notifications()`: 내가 만든 대기 알림을 "보내는 중"으로 바꾸며 받는 사람 이메일·이름·글·링크를 돌려줌(최대 20). `public.finish_notification(id, status, reason)`: 내가 claim한 것만 | FR-002~004 | 이메일은 내가 일으킨 알림의 받는 사람 것만 나간다 |
| `api/_slack.js` | `deliver(notification, { token, channel, origin, fetchImpl })` → `{ status, reason }`. 15초 제한. 토큰 없음 → 보내지 못함 "슬랙 설정 없음" | FR-002~004 | 토큰을 응답·로그에 넣지 않는다 |
| `api/notify.js` | POST만. `verifyUser` 재사용, 사용자 토큰으로 Supabase RPC 호출, 결과 수만 응답 | FR-002~004 | 실패해도 200과 결과 수(화면은 결과를 기다리지 않음) |
| `store.js` | `call()`이 알리는 함수(아래 목록)에 성공하면 `flushNotifications()` | FR-001 | 기다리지 않고, 실패는 무시(FR-004) |
| `usage.js` | QA 관리자에게 최근 알림 30건: 시각·받는 사람·내용·결과·이유 | FR-005 | 사람 입력 글은 textContent |

알리는 함수: `send_sample`, `return_sample`, `submit_action_request`, `resubmit_action_request`, `approve_action_request`, `reject_action_request`, `submit_deviation_review`, `resubmit_deviation_review`, `review_deviation_review`, `record_test_measurement`, `record_process_conditions`, `complete_action_request`(재시험 규격 이탈)

### 자료 구조
새 표 `notification` (ERD v0.9에 올림). 기존 표는 바꾸지 않는다.

| 대상 | 항목 | 형식 | 필수 | 저장/계산 | 출처 |
|---|---|---|---|---|---|
| notification | id | uuid | 예 | 저장 | |
| | recipient_id | uuid → profile | 예 | 저장 | FR-001 |
| | kind | text (sample_sent, sample_returned, approval_waiting, action_assigned, returned_back, out_of_spec) | 예 | 저장 | FR-001 표 |
| | batch_id | uuid → batch | 아니오 | 저장 (되돌리기 때 다른 표처럼 비움) | FR-001 수용 기준 4 |
| | link_path | text (`#/samples`, `#/issues/…`, `#/batches/…`) | 예 | 저장 | FR-001 수용 기준 4 |
| | message | text ≤ 500 | 예 | 저장 (사람 입력은 100자까지) | FR-001 |
| | created_by, created_at | uuid → profile, timestamptz | 예 | 저장 | FR-005 |
| | status | `pending` 대기 / `sending` 보내는 중 / `sent` 보냄 / `sent_channel` 채널로 보냄 / `failed` 보내지 못함 | 예 | 저장 | FR-002~005 |
| | reason, sent_at | text ≤ 200, timestamptz | 아니오 | 저장 | FR-004, FR-005 |

RLS: 읽기는 QA 관리자만. 쓰기는 트리거와 함수로만.

### 화면 연결
| 화면 ID | 화면 | 파일·영역 |
|---|---|---|
| AD_040000_PG | 사용 기록 → "슬랙 알림 기록" 칸 (QA 관리자) | `pages/usage.js` |

## 3. 단계별 접근
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 1 | 데이터베이스가 알림을 만든다 | FR-001, FR-004(만들기), FR-005(권한) | 0021, 009_rules.sql, PRD §9·CLAUDE.md·ADR 0003·ERD·IA | 009_rules 먼저 실패 → 시험 안에서 통과 → 적용, DB 시험 001~008 회귀 | 없음 |
| 2 | 슬랙으로 보낸다 | FR-002~004 | _slack.js·notify.js·store 호출·함수 시험 | 함수 시험 전체 통과(가짜 슬랙: DM·채널·설정 없음·시간 초과), 로컬에서 토큰 없이 저장하면 "보내지 못함 · 슬랙 설정 없음" | 없음 |
| 3 | 기록 화면, 슬랙 연결, 배포 | FR-005, SC-002 | usage.js 칸, 슬랙 앱 만들기 안내, 배포 | 미리보기에서 QA 관리자만 기록이 보임, 사용자가 토큰을 넣은 뒤 배포 주소에서 DM 도착 | 사용자가 슬랙 앱을 만들고 토큰을 Vercel에 넣기 |

### 1단계 작업
- [x] 브랜치 `phase-5-slack`
- [x] PRD §9 "메일·메신저·푸시 알림 발송" → "메일·문자·푸시 알림 발송 (슬랙 개인 메시지는 spec 009로 허용)", CLAUDE.md "하지 않을 것" 같은 줄, ADR 0003(슬랙만 허용·보내는 구조)
- [x] 009_rules.sql을 먼저 쓰고 실패를 확인한다. 이어서 0021을 시험 안에서 돌린 뒤 적용하고, 001~008 회귀를 돌린다.
- [x] ERD v0.9 `notification`, IA AD_040000_PG 설명 한 줄
- [x] (v0.2) FR-006 앱 아이콘: `assets/icon.svg`(직접 그림), `apple-touch-icon.png` 180px, `slack-icon.png` 1024px(크롬 headless로 그림, 새 의존성 없음), index.html·layout.js·login.js·app.css

### 2단계 작업
- [x] `tests/slack-notify.test.js`를 먼저 쓰고 실패를 확인한다. 이어서 `api/_slack.js`·`api/notify.js`를 만든다.
- [x] `store-notifications.js`, `store.js` 알리는 함수 목록, `.env.example`
- [ ] 로컬에서 토큰 없이 검체 전달 → 알림 "보내지 못함 · 슬랙 설정 없음". 저장한 데이터는 시험 로트를 쓰지 않고 예시 검체 흐름 하나로 확인한 뒤 되돌린다(예시 검체만 다시 넣기).

### 3단계 작업
- [x] 사용 기록 화면 "슬랙 알림 기록" 칸
- [ ] 사용자에게 슬랙 앱 만들기 안내(권한 3개, 워크스페이스 설치, 봇 토큰을 Vercel·.env에, 알림 채널에 봇 초대)
- [ ] 커밋·push·PR·병합(배포)과 배포 주소 DM 확인

### 4단계 작업 (v0.3, FR-007 앱 안 알림 함)
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 4 | 나에게 온 알림을 앱 위쪽에서 본다 | FR-007, SC-006 | 0022(notification.read_at, 받는 사람 읽기 정책, `mark_notifications_read`), 009_rules 사례 추가, `src/domain/inbox-rules.js`·시험, `src/ui/inbox.js`(위쪽 "알림 N" 버튼과 알림 함, 1분마다·화면 이동마다 확인), store-notifications 읽기·읽음 | DB 시험 009 통과(먼저 실패), 함수 시험 통과, 미리보기에서 숫자·목록·누르면 이동·모두 읽음·빈·오류 상태·키보드(Esc 닫기)·375px | 없음 |

- [x] 009_rules에 받는 사람 읽기·읽음 처리 사례를 먼저 더하고 실패 확인 → 0022를 시험 안에서 → 적용
- [x] inbox-rules 시험을 먼저 → 규칙·화면
- [x] ERD v0.10 read_at·권한 한 줄, IA 공통 컴포넌트에 알림 함

### 5단계 작업 (v0.4, Q51 해결: 받는 사람 쪽에서도 보내기)
- [x] 009_rules에 "받는 사람이 자기에게 온 대기 알림을 가져감(자기 이메일만)" 사례를 먼저 → 0023(`claim_my_notifications`가 created_by = 나 또는 recipient_id = 나) 시험 안에서 → 적용
- [x] `src/ui/inbox.js`: 1분마다 확인할 때 `flushNotifications()`도 부름
- [x] 배포 뒤 15:42 대기 알림이 유○○ 앱에서 나가는지 확인

### 6단계 작업 (v0.5, 보낼 일 8가지 더함)
- [x] 009_rules에 8가지 사례를 먼저 더하고, 기존 사례 중 종류를 거르지 않던 곳을 종류로 거름 → 실패 확인
- [x] 0024: notification.kind 허용 목록 넓힘, notify_sample·notify_action·notify_review 다시 정의, 새 트리거 notify_issue(quality_issue)·notify_batch(batch). 시험 안에서 009·008·005·002 → 적용
- [x] ERD notification.kind 목록

### 7단계 작업 (v0.6, FR-008 슬랙 [확인] 버튼)
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 7 | 슬랙 [확인]을 누르면 앱이 안다 | FR-008, SC-007 | 0026, 009_rules 사례, `api/_slack.js` 버튼 붙이기, `api/_slack-actions.js`(서명 검사·요청 풀기·글 만들기, 순수 함수), `api/slack-actions.js`(받는 곳), `tests/slack-actions.test.js`, 알림 함·사용 기록 "슬랙에서 확인함", `.env.example` 두 줄 | 함수 시험 전체 통과(먼저 실패), 009_rules 통과(먼저 실패), 회귀 DB 001~009, 미리보기에서 "슬랙에서 확인함" 표시(DB에 시험 줄을 넣지 않고 화면 규칙 시험 + 실제 배포 뒤 확인), 사용자가 설정한 뒤 배포 주소에서 버튼 → 메시지 바뀜·앱 읽음 | Q67: 사용자가 슬랙 Interactivity·Vercel 값 2개를 넣음 |

**자료 (0026, ERD v0.13):** `notification`에 칸 두 개를 더한다. 기존 칸·자료는 그대로다.
- `slack_user_id` text: 개인 메시지를 받은 슬랙 사용자. 보낼 때 함수가 적는다. 채널로 보낸 알림은 비어 있다.
- `slack_acknowledged_at` timestamptz: 슬랙에서 [확인]을 처음 누른 시각.

**데이터베이스 함수:**
- `finish_notification(p_id, p_status, p_reason, p_slack_user text default null)`: 지금 함수를 지우고 인자 하나를 더해 다시 만든다(같은 이름 함수가 두 개 생기지 않게). 나머지 규칙은 그대로다.
- `acknowledge_notification(p_id uuid, p_slack_user text)` (새로): `service_role`만 부를 수 있다. 그 알림의 `slack_user_id`가 누른 사람과 같을 때만 `slack_acknowledged_at`을 처음 한 번 적고, `read_at`이 비어 있으면 같은 시각으로 채운다. 결과로 확인 시각 또는 "받는 사람 아님"을 돌려준다. 업무 표는 건드리지 않는다(FR-008 수용 기준 5).

**보내기 (`api/_slack.js` 고침):**
- 개인 메시지는 지금 글(text, 알림 미리보기용)을 그대로 두고 blocks를 더한다.
  - 본문
  - "업무 처리는 앱에서 합니다" 안내
  - [확인] 버튼(`action_id` = `ack`, `value` = 알림 id)
- 결과에 받은 슬랙 사용자 id를 더해 `notify.js`가 `finish_notification`의 `p_slack_user`로 넘긴다.
- 채널로 보내는 메시지는 지금 그대로 둔다(버튼 없음).

**받는 곳 (`api/slack-actions.js`, 새 Vercel 함수 — 로그인 대신 슬랙 서명으로 확인):**
1. POST만 받는다. 요청 원문을 그대로 읽는다(서명이 원문 기준이라서).
2. `X-Slack-Request-Timestamp`가 지금과 5분 넘게 차이 나면 401로 거절한다.
3. `v0=HMAC-SHA256(SLACK_SIGNING_SECRET, "v0:시각:원문")`이 `X-Slack-Signature`와 다르면 401로 거절한다. 비교는 시간이 일정하게 걸리는 방식(`timingSafeEqual`)으로 한다.
4. `payload`에서 버튼 종류 `ack`, 알림 id, 누른 슬랙 사용자, `response_url`을 꺼낸다. 형식이 다르면 200으로 받기만 하고 무시한다.
5. 바로 200으로 응답한다(슬랙은 3초 안의 응답을 바란다). 기록은 그 뒤에 이어서 한다.
6. Supabase service 키로 `acknowledge_notification`을 부른다.
7. 결과에 따라 `response_url`로 답한다.
   - 받는 사람: 원래 메시지를 바꾼다(본문은 그대로, 버튼 자리에 "✅ 확인함 · MM-DD HH:mm" — 한국 시각).
   - 받는 사람 아님: 누른 사람에게만 "받는 사람만 확인할 수 있습니다".
   - 실패: 누른 사람에게만 "확인을 기록하지 못했습니다. 앱에서 알림을 열어 주세요."
- Vercel에서 5번 뒤의 일이 끝나기 전에 함수가 멈출 수 있다. 그래서 끝 조건 확인 때 3초 안에 다 끝나는지 보고, 문제가 있으면 기록 → 응답 순서로 바꾼다.

**화면:**
- 알림 함(`inbox.js`) 줄 아래에 "슬랙에서 확인함 · 시각"을 둔다.
- 사용 기록 슬랙 알림 기록에 "확인" 칸을 더한다.
- 글자는 `inbox-rules.js`·`usage-rules.js`의 함수가 만든다(시험).

**환경변수 (Q67, 사용자가 넣음):**
- `SLACK_SIGNING_SECRET`: 슬랙 앱 Basic Information의 Signing Secret
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase 프로젝트 API 설정의 service 키
- 둘 다 Vercel과 `.env`에만 넣는다. `.env.example`에는 이름만 둔다. 화면 코드(`src/`)에서는 읽지 않는다.

**슬랙 앱 설정 (사용자):** Interactivity & Shortcuts를 켜고, Request URL에 `https://pharmaflow-iota.vercel.app/api/slack-actions`를 넣는다. 권한 범위는 늘리지 않는다(버튼 응답은 `response_url`로 하므로 새 권한이 필요 없다).

- [ ] 브랜치: 지금 `phase-6-work-order`에 단계별 커밋으로 둔다(010 1단계와 따로 커밋). 사용자가 원하면 따로 나눈다
- [ ] `tests/slack-actions.test.js`와 `slack-notify` 버튼 사례를 먼저 → 실패 확인 → `_slack.js`·`_slack-actions.js`·`slack-actions.js`·`notify.js`
- [ ] 009_rules에 `acknowledge_notification`·`finish_notification(p_slack_user)` 사례를 먼저 → 실패 → 0026 시험 안에서 → 회귀 → 적용(사용자 확인 뒤)
- [ ] 화면 두 곳, `.env.example`, ERD v0.13
- [ ] 사용자 설정 안내 → 배포 → 실제 버튼 확인

### 8단계 작업 (v0.7, FR-009 "확인함"을 그 일의 화면에)
| 단계 | 목표 | FR | 결과물 | 끝 조건 | 먼저 풀 질문 |
|---|---|---|---|---|---|
| 8 | 슬랙 확인이 그 기록 줄 옆에 보이고 30초 안에 바뀐다 | FR-009, SC-008 | 0030(알림에 어느 기록인지 칸 2개, 일으킨 사람 읽기 정책, 알림 트리거 7개에 기록 넘기기), 009_rules 사례, `src/domain/ack-rules.js`·시험, `src/infrastructure/store-notifications.js` 읽기 2개, `src/ui/ack-badge.js`(표시·30초 확인·강조), 검체 목록·이슈 상세·작업지시 목록·로트 상세 연결, CSS 강조 | 함수 시험 전체 통과(먼저 실패), 009_rules 통과(먼저 실패), 회귀 DB 001~011, 미리보기에서 표시·권한·30초 바뀜(DB에서 확인 시각을 직접 넣어 흉내)·강조·움직임 줄이기·375px, 배포 뒤 실제 슬랙 [확인] | 슬랙 Request URL 저장(7단계 H-03과 같음) |

**자료 (0030, ERD v0.15):** `notification`에 `target_table` text, `target_id` uuid(빈 값 허용)를 더한다. 이미 있는 알림은 비어 있다(FR-009 수용 기준 6).

**알림 만들 때 기록 넘기기 (트리거 고치는 방법):**
- 새 내부 함수 `private.add_notification_for(p_target_table, p_target_id, p_recipients, p_kind, p_batch, p_path, p_message)`를 만들고, 지금 `add_notification`의 본문을 이쪽으로 옮긴다. `add_notification`은 `add_notification_for(null, null, …)`을 부르는 껍데기로 남긴다(같은 이름 함수가 두 개 생기지 않음).
- 알림 트리거 7개(`notify_sample`·`notify_action`·`notify_review`·`notify_out_of_spec`·`notify_issue`·`notify_batch`·`notify_work_order`)는 모두 트리거 안에서 `private.add_notification(`를 부른다. 지금 정의에서 이 글자를 `private.add_notification_for(tg_table_name, new.id, `로 바꿔 다시 만든다(0019·0025 방식). 바꾼 수가 함수마다 지금 부르는 수(4·2·2·1·3·4·2)와 같은지 검사하고, 다르면 마이그레이션을 멈춘다.
- 이렇게 하면 알림 글·받는 사람 규칙은 하나도 바뀌지 않고, 기록 표 이름과 id만 함께 저장된다.

**읽기 권한:** 정책 하나를 더한다 — "알림을 일으킨 사람은 자기 알림 읽기"(`created_by = auth.uid()`). 받는 사람·QA 관리자 정책은 그대로다(FR-009 수용 기준 5).

**읽기 (store-notifications.js):**
- `listAcksFor(targetTable, ids)`: 그 기록들의 알림 — target_id, 받는 사람 이름, 결과(status), 슬랙 확인 시각. RLS가 볼 수 있는 줄만 준다.
- `listLotAcks(batchNumber)`: 로트 위쪽 집계용 — 그 로트번호의 알림 수와 확인 수(어느 기록인지 모르는 예전 알림 포함).

**글자 규칙 (ack-rules.js, 순수 함수):** `ackText(notes)`
- 한 명: "✓ 유○○ 확인 · 14:05" / "알림 · 유○○ 확인 전" / 채널로 보냄이면 "채널로 보냄 · 슬랙 확인 없음" / 보내지 못함이면 "알림 · 보내지 못함"
- 여러 명(팀 전체에게 간 알림): "✓ 2명 중 1명 확인 (유○○ 14:05)" / "알림 · 2명 확인 전"
- 알림이 없으면 빈 글자(표시 안 함). `lotAckText(total, acked)` → "이 로트 알림 3건 중 2건 확인"
- `ackChanged(before, after)`: 확인이 새로 생긴 기록 id 목록(강조할 줄)

**화면 (ack-badge.js):**
- `ackBadge(text)`: 줄 옆 작은 글자. 확인함은 초록 ✓와 글자, 확인 전은 흐린 글자(색만으로 구분하지 않음). `aria-live="polite"`로 바뀔 때 화면 읽기 프로그램이 읽는다.
- `watchAcks({ load, onChange })`: 지금 화면 주소가 같은 동안 30초마다 `load()`를 다시 부르고, 확인이 새로 생긴 기록이 있으면 그 줄 표시를 바꾸고 1초 강조(`ack-flash`). 주소가 바뀌거나 탭이 숨겨지면 멈춘다. 페이지 전체를 다시 그리지 않는다(입력 중인 창이 닫히지 않게).
- `styles/app.css`: `.ack-flash` 1초 배경 강조, `@media (prefers-reduced-motion: reduce)`에서는 애니메이션 없이 색만.

**연결:**
- 검체 목록(`samples.js`): "누가 · 언제" 칸 아래 줄, `sample_transfer`
- 품질 이슈 상세(`issue-detail.js`·`review-section.js`): 조치 요청 줄 `action_request`, 평가 `deviation_review`
- 작업지시 목록(`work-orders.js`): 발행 줄 `work_order`
- 로트 상세(`batch-detail.js`) 위쪽 요약: `lotAckText`
- 파일 크기: 새 파일 2개로 나누고 기존 파일에는 몇 줄만

- [ ] `tests/ack-rules.test.js`를 먼저 → 실패 확인 → `ack-rules.js`
- [ ] 009_rules에 기록 저장(검체·조치·평가·작업지시·이탈 각 1)·일으킨 사람 읽기·제3자 못 읽음·예전 알림 빈 칸 사례를 먼저 → 실패 → 0030 시험 안에서 001~011과 함께 → 적용(사용자 확인 뒤)
- [ ] 화면 연결·CSS, ERD v0.15, IA(공통 컴포넌트에 "확인 표시")
- [ ] 미리보기: 확인용 검체 하나로 표시 확인, 확인 시각은 DB에서 그 알림 줄에 직접 넣어 30초 안에 바뀌는지 본다(실제 슬랙은 배포 뒤 H-04)

### 새 의존성 기록
없음

## 4. 테스트 전략

### 요구사항 추적
| FR/SC | 확인 방법 | 시험 이름 / QA 번호 |
|---|---|---|
| FR-001 | DB 시험 | 009_rules 일별 받는 사람 / C-01 |
| FR-002 | 함수 시험 + 배포 확인 | slack "DM" / C-03, C-06 |
| FR-003 | 함수 시험 | slack "채널로" / C-03 |
| FR-004 | 함수 시험 + DB 시험 + 화면 | slack "설정 없음·시간 초과", 009_rules "되돌리기 중 없음" / C-02, C-03, C-04 |
| FR-005 | DB 시험 + 화면 | 009_rules 읽기 권한 / C-02, C-05 |
| FR-006 | 화면 + 파일 | C-07 |
| FR-007 | DB 시험 + 함수 시험 + 화면 | 009_rules 받는 사람 읽기·읽음 처리, inbox-rules / C-08, H-02 |
| SC-006 | 화면 + 사람 | C-08, H-02 |
| FR-008 | 함수 시험 + DB 시험 + 화면 + 배포 확인 | slack-actions "서명"·"요청 풀기"·"확인 글", slack-notify "버튼", 009_rules 슬랙 확인 / C-10, C-11, C-12 |
| SC-007 | 배포 확인 + 사람 | C-12, H-03 |
| FR-009 | 함수 시험 + DB 시험 + 화면 + 배포 확인 | ack-rules "한 명·여러 명·채널·예전 알림·집계·새로 확인", 009_rules 기록 저장·읽기 권한 / C-13, C-14, C-15 |
| SC-008 | 화면 + 배포 확인 + 사람 | C-15, H-04 |
| SC-001 | DB 시험 | C-01 |
| SC-002 | 배포 확인 + 사람 | C-06, H-01 |
| SC-003 | 함수 시험 + 화면 | C-03, C-04 |
| SC-004 | DB 시험 + 화면 | C-02, C-05 |
| SC-005 | 사람 QA | H-01 |

### 함수 시험
- 도구 / 버전 / 실행 명령: `node:test` / Node 24 / `node --test "tests/*.test.js"`

| 시험 이름 | 입력 | 기대 결과 | FR |
|---|---|---|---|
| 슬랙 DM | 이메일 찾음 | lookupByEmail → postMessage(channel=사용자 id), 글에 링크 | FR-002 |
| 슬랙 채널로 | 이메일 못 찾음 + 채널 있음 | 채널에 "○○○ 님(슬랙 계정을 찾지 못함)" | FR-003 |
| 채널도 없음 | 못 찾음 + 채널 없음 | failed "슬랙 계정을 찾지 못함" | FR-003 |
| 설정 없음 | 토큰 없음 | failed "슬랙 설정 없음", 슬랙 호출 0번 | FR-004 |
| 시간 초과·슬랙 오류 | fetch 지연·ok:false | failed "시간 초과"/"슬랙 오류", 토큰이 결과에 없음 | FR-004 |
| notify 함수 | 로그인 없음 / POST 아님 | 401 / 405 | FR-004 |
| 버튼 (v0.6) | 이메일 찾음 | 개인 메시지 blocks에 [확인](value=알림 id), 결과에 슬랙 사용자 id / 채널 메시지에는 버튼 없음 | FR-008 |
| 서명 (v0.6) | 맞는 서명, 틀린 서명, 5분 넘은 시각, 머리글 없음 | 맞는 것만 통과 | FR-008 수용 기준 6 |
| 요청 풀기 (v0.6) | 버튼 payload, 다른 종류, 깨진 JSON | 알림 id·슬랙 사용자·response_url / 무시 | FR-008 |
| 받는 곳 (v0.6) | 서명 틀림 / 받는 사람 / 받는 사람 아님 / DB 실패 | 401·DB 호출 0번 / 메시지 바꿈 "✅ 확인함 · 10-27 14:05" / 본인에게만 안내 / 본인에게만 실패 안내, 비밀값이 응답에 없음 | FR-008 |
| 확인 글자 (v0.6) | 확인 시각 있음·없음 | "슬랙에서 확인함 · 10/27 14:05" / 빈 글자 | FR-008 수용 기준 3·4 |
| 줄 옆 확인 표시 (v0.7) | 한 명 확인·확인 전, 두 명 중 한 명, 채널로 보냄, 보내지 못함, 알림 없음 | spec 문구 / 빈 글자 | FR-009 수용 기준 1~3·7 |
| 로트 집계·새로 확인 (v0.7) | 3건 중 2건, 전후 목록 | "이 로트 알림 3건 중 2건 확인", 새로 확인된 id만 | FR-009 수용 기준 2·4 |

### 화면 눌러 보기
1. 로컬(토큰 없음)에서 검체 전달 → 저장 정상, 사용 기록의 슬랙 알림 기록에 "보내지 못함 · 슬랙 설정 없음".
2. 배포(토큰 있음)에서 검체 전달 → 받는 팀 슬랙 DM, 링크 → 검체 화면.

### QA
- `qa.md` 참고

### 회귀 확인
- 모든 업무 저장(판정·조치·평가·검체): DB 시험 001~008, 알림 트리거가 오류를 내도 저장이 막히면 안 됨(트리거는 받는 사람·글 만들기만)
- 예시 자료 되돌리기: 007·008 시험(되돌리는 중에는 알림 없음)
- 화면 동작: 함수 시험 전체, 저장 직후 화면이 기다리지 않음

## 5. 제약과 주의점

### 보안
- 봇 토큰은 환경변수에만 둔다. 응답·로그·문서·대화에 넣지 않는다.
- (v0.6) `slack-actions`는 로그인이 없으므로 슬랙 서명만 믿는다. 서명·시각 검사 전에는 아무것도 읽거나 쓰지 않는다.
- (v0.7) 알림 읽기는 받는 사람·일으킨 사람·QA 관리자만(RLS). 줄 옆 표시는 RLS가 준 줄만 그리므로 다른 사람에게는 빈칸이다.
- (v0.6) Supabase service 키는 `api/` 함수 안에서만, `acknowledge_notification` 한 함수를 부를 때만 쓴다. 그 함수는 `service_role`에만 열고, 알림 줄의 확인 시각·읽은 시각만 바꾼다.
- `claim_my_notifications`는 내가 일으킨 알림만 준다. 이메일은 그 받는 사람 것만 나간다.
- 알림 표는 QA 관리자만 읽는다.
- 슬랙 글의 사람 입력은 100자까지로 자르고, `<`·`>`·`&`를 슬랙 규칙대로 바꾼다(링크·멘션 끼워 넣기 방지).

### 성능
- 저장마다 함수가 한 번 불린다(대기 알림이 없으면 바로 끝). 한 번에 20건까지 보낸다.

### 호환성
- 지금 앱과 같다.

### 지금 돌아가는 기능 깨지 않기
- 업무 함수를 고치지 않고 트리거만 더한다. `record_history`도 그대로 둔다.
- 화면은 알림 결과를 기다리지 않는다.

### 경계
- **항상 할 것:**
  - 시험을 먼저 실패시킨다.
  - 마이그레이션은 시험 안에서 먼저 돌려 본다.
  - 토큰은 환경변수에만 둔다.
  - 출처 주석(`// FR-002 (spec 009)`)을 단다.
- **먼저 물을 것:**
  - 슬랙 앱 권한을 늘리는 일
  - 예시 자료 전체 되돌리기
  - 커밋, push, PR, 병합, 배포
- **절대 하지 말 것:**
  - 메일·문자·푸시
  - 슬랙에서 승인·인수 확인 같은 업무 처리 버튼 (v0.6 [확인]은 "봤다"만 남긴다)
  - 이모지 반응 읽기, "내가 보낸 알림" 화면 (spec v0.6 제외 범위)
  - 알림 끄기·켜기
  - 매일 요약
  - Claude API
  - 토큰을 코드·대화에 쓰기
  - 알림 실패로 저장을 막기

### 위험과 대응
| 위험 | 영향 | 대응 |
|---|---|---|
| 트리거 오류가 업무 저장을 막음 | 앱이 멈춤 | 트리거는 단순하게, DB 시험 001~008 회귀, 시험 안에서 먼저 확인 |
| 사용자가 오늘 슬랙 토큰을 못 넣음 | 배포 DM 확인 못 함 | 1·2단계는 토큰 없이 끝남. 배포해도 "보내지 못함"으로 기록만 남고 업무는 그대로. SC-002는 "확인 못 함"으로 둔다 |
| 회사 슬랙 이메일이 구글 이메일과 다름(Q52) | DM이 안 감 | 채널로 보냄(FR-003) |
| (v0.6) Vercel이 200 응답 뒤 남은 일을 끊음 | 버튼은 눌렸는데 기록이 안 됨 | 배포 뒤 바로 확인. 끊기면 기록 → 응답 순서로(3초 안이면 충분) |
| (v0.6) service 키가 새어 나감 | 데이터베이스 전체 권한 노출 | Vercel 환경변수에만, 로그·응답에 쓰지 않음, 쓰는 함수 하나로 좁힘 |
| (v0.7) 트리거 글자 바꾸기가 다른 곳까지 바꿈 | 알림이 안 만들어짐 | 함수마다 바꾼 수를 지금 부르는 수와 맞춰 보고 다르면 멈춤, 009_rules 전체 재실행 |
| (v0.7) 30초 확인이 화면을 다시 그려 입력 중 창이 닫힘 | 입력 내용 잃음 | 표시 글자만 바꾸고 페이지는 다시 그리지 않음, 창이 열려 있으면 강조만 미룸 |
| (v0.6) 사용자가 슬랙 설정을 못 함 | 버튼이 눌려도 "이 앱은 응답하지 않음" | 코드·DB는 설정 없이 끝남. SC-007은 "확인 못 함"으로 두고 안내 |

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-26 | v0.1 | 처음 작성 |
| 2026-10-26 | v0.1 | 승인 |
| 2026-10-26 | v0.2 | spec v0.2 FR-006 앱 아이콘 추적 줄과 1단계 작업 |
| 2026-10-26 | v0.3 | spec v0.3 FR-007 앱 안 알림 함: 4단계, 추적 줄 FR-007·SC-006 |
| 2026-10-26 | v0.4 | spec v0.4 Q51: 5단계(받는 사람 쪽에서도 보내기) |
| 2026-10-26 | v0.5 | spec v0.5: 6단계(보낼 일 8가지) |
| 2026-10-27 | v0.6 | spec v0.6 FR-008: 7단계(슬랙 [확인] 버튼, 0026, slack-actions 함수, 알림 함·사용 기록 표시), 추적 표 FR-008·SC-007, 시험 사례, 보안·위험 |
| 2026-10-27 | v0.7 | spec v0.7 FR-009: 8단계(0030 알림에 기록 칸·일으킨 사람 읽기·트리거 7개에 기록 넘기기, ack-rules·ack-badge, 화면 4곳), 추적 표 FR-009·SC-008, 시험 사례, 보안·위험 |
