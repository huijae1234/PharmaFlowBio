# 사본 준비 기록

- 준비일: 2026-10-31 (Asia/Seoul)
- 원본: https://github.com/dbdpfla98/PharmaFlow
- 원본 main: 3944ad73d3d20e48fb852282abe9f32669833fa4
- 대상: huijae1234/PharmaFlowBio (Public 독립 저장소)
- 새 사본에는 원본 .git, 커밋·PR·리뷰 이력, .env, 운영 비밀키를 포함하지 않음
- 제공받은 ZIP의 526개 원본 파일을 기존 원본 스냅샷의 Git blob SHA-1과 대조함
- 화면 캡처 이미지 66개와 해당 이미지가 내장된 발표 생성 번들 1개를 제외함
- 원본 파일 458개를 사본에 복사하고 README.md를 개인 기여·팀 출처·설정 안내로 보완함
- 운영환경 참조를 예시값으로 바꾼 파일: CLAUDE.md, docs/specs/001-로그인-권한-기준이탈판정/plan.md, docs/specs/026-아침-브리핑-슬랙/plan.md, src/config.js
- 예시 public 연결키는 실제 운영키가 아님. 본인 프로젝트의 값을 직접 설정해야 함
- .env.example의 변수 값은 모두 공란. 일반 테스트용 가짜 키·가짜 개인정보 검증 입력은 보존함
- 인터뷰 요약 docs/interview.md는 인터뷰 대상·숫자·발언을 모두 AI 가상 자료라고 명시하므로 해당 가상 표시와 함께 보존함
- 실제 개인 이메일·privileged/provider secret 패턴은 텍스트 검사에서 발견되지 않음. 이는 비밀정보 부재 또는 공개 적합성을 보증하는 전수 인증이 아님
- 스크린샷의 전수 OCR, XLSX 숨김 셀·속성의 전수 개인정보 감사, 팀 공개 동의 확인은 미완료
- 원본 QA Sheets 링크는 팀 자료이며 접근 권한이 필요할 수 있음
- 데이터베이스·로그인·공공데이터·AI·Slack 호출은 실행하지 않음. 팀 운영환경 연결·배포·알림 발송 없음
- 자동 시험 실행 결과는 별도 TEST-RESULTS.txt 파일에 기록

## 제외한 원본 파일

- assets/captures/13-persist/batches-after-reload.png
- assets/captures/13-persist/batches-before-reload.png
- assets/captures/13-persist/wo-2611-004-after-save-qc.png
- assets/captures/14-deploy/iota-products-production-role.png
- assets/captures/16-duplicate/test-values-duplicate-blocked.webp
- assets/captures/17-roles/admin-blocked-for-production.png
- assets/captures/17-roles/admin-users-roles-redacted.png
- assets/captures/17-roles/production-home-check-deploy.png
- assets/captures/17-roles/production-home.png
- assets/captures/17-roles/production-ship-complete-modal.png
- assets/captures/17-roles/qc-home.webp
- assets/captures/17-roles/viewer-first-login-batches.png
- assets/captures/18-numbers/qa-admin-dashboard.png
- assets/captures/19-ai/slack-morning-briefing-and-alerts.png
- assets/captures/22-mobile/batches-375px.png
- assets/captures/22-mobile/home-375px.png
- assets/captures/22-mobile/issues-375px.png
- assets/captures/22-mobile/login-375px-tab-focus.jpg
- assets/captures/22-mobile/qa-dashboard-phone-menu.png
- assets/captures/22-mobile/qa-dashboard-phone.png
- assets/captures/22-mobile/samples-375px.png
- assets/captures/22-mobile/work-orders-375px.png
- assets/captures/23-new-session/new-session-1.webp
- assets/captures/23-new-session/new-session-2.png
- assets/captures/23-new-session/new-session-3.png
- assets/captures/24-app/iphone-home-icon.webp
- assets/captures/README.md
- assets/captures/day8-ego/01-qc-home.png
- assets/captures/day8-ego/02-lot-list-search.png
- assets/captures/day8-ego/03-lot-B-detail.png
- assets/captures/day8-ego/04-invalid-values-blocked.png
- assets/captures/day8-ego/05-boundary-preview.png
- assets/captures/day8-ego/06-saved-boundary.png
- assets/captures/day8-ego/07-after-reload.png
- assets/captures/day8-ego/08-already-entered-hidden.png
- assets/captures/day8-ego/09-tab-focus-cancel.png
- assets/captures/day8-ego/10-qc-admin-blocked.png
- assets/captures/day8-ego/11-qc-samples.png
- assets/captures/day8-ego/12-375-home.png
- assets/captures/day8-ego/12-375-lotB.png
- assets/captures/day8-ego/12-375-lots.png
- assets/captures/day8-ego/12-375-samples.png
- 발표/PharmaFlow-발표.html
- 발표/images/app-action-request-modal.jpg
- 발표/images/app-admin-blocked.png
- 발표/images/app-dashboard-qa.png
- 발표/images/app-duplicate-blocked.webp
- 발표/images/app-hold-lots.png
- 발표/images/app-issue-detail-stage.jpg
- 발표/images/app-persist-after-reload.png
- 발표/images/app-phone-dashboard.png
- 발표/images/app-qc-home.webp
- 발표/images/app-ship-modal.png
- 발표/images/app-slack-briefing.png
- 발표/images/c01-deployed-login-1280.png
- 발표/images/c05-regulatory-gmp-shipment.jpg
- 발표/images/c06b-permit-empty.jpg
- 발표/images/c06c-permit-failed-retry.jpg
- 발표/images/c07a-assistant-answer.jpg
- 발표/images/c07b-assistant-verified.jpg
- 발표/images/c07c-assistant-app-query.jpg
- 발표/images/c08-test-criteria-version.jpg
- 발표/images/c09a-lot-detail-open-issue.jpg
- 발표/images/c09c-approvals-queue.jpg
- 발표/images/c09c-approve-modal.jpg
- 발표/images/c09d-issue-closed.jpg
- 발표/images/c10b-permit-broken-retry.jpg
- 발표/images/login-375px-tab-focus.jpg

## 실행 확인

- 제공된 Downloads/PharmaFlow-main.zip의 526개 파일이 원본 스냅샷 manifest와 모두 일치함
- 실행: node --test "tests/*.test.js"
- 결과: 536개 통과, 실패 0개 (2026-10-31)
- 실제 DB·로그인·공공데이터·AI·Slack 연동은 실행하지 않음

## 포트폴리오 사본 운영 전환 (2026-11-05)

- 배포: https://pharmaflowbio.vercel.app (김희재 Vercel, `main` 푸시 시 자동 배포)
- 데이터베이스: 김희재 계정 Supabase 프로젝트에 `supabase/migrations/0001~0040`을 순서대로 적용. 예시 자료 소유자는 로그인할 수 없는 임시 QA 관리자(`seed-owner@example.invalid`)
- 로그인: GitHub 로그인 + 게스트로 둘러보기(익명 로그인, 열람자 읽기 전용). 구글 로그인은 김희재 구글 계정이 구글 클라우드 2단계 인증 확인에 막혀 보류. 이메일·비밀번호 가입은 끔
- 게스트 정리: 로그아웃하면 `delete_guest`로 계정·사용 기록 삭제, 로그아웃 없이 떠난 게스트는 매일 03시(KST) 하루 지난 것부터 삭제 (0039). 게스트는 사용자·역할 목록에서 빠지고 역할을 받을 수 없음 (0040). DB 시험 `supabase/tests/039_rules.sql`
- 개인정보: 사용자·역할 화면 이메일을 기본으로 가림(눈 단추로 보이기). 문서에 남아 있던 김희재 구글 계정 아이디를 지움. 이후 커밋 작성자 이메일은 GitHub noreply 주소
- 아직 연결하지 않은 것: 공공데이터·Claude·Slack 키 (해당 칸은 "불러오지 못했습니다"·"키 없음"으로 보임)
