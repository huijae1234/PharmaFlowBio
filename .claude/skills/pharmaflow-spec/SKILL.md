---
name: pharmaflow-spec
description: PharmaFlow 기능 하나를 만들기 전에 docs/specs/NNN-기능/spec.md(무엇을·왜)와 plan.md(어떻게)를 쓰고 FR·SC 번호로 추적성을 검사한다. 개인 하네스 스킬 harness-spec-plan을 이 프로젝트에 맞게 고쳤다(화면 용어·번호 규칙·DB 변경·하지 않을 것·AI 기능 규칙, 점검 스크립트에 번호 안내). 새 기능이나 큰 수정, "spec 써 줘", "plan 써 줘", "개발 들어가기 전"일 때 쓴다.
---

# PharmaFlow spec·plan

기능 하나를 만들기 전에 두 문서를 순서대로 만든다. 승인 전에는 다음 문서로 가지 않는다.

```
docs/Intent.md · PRD.md(FR-xx) · IA.md(화면 ID) · journeys/ · ERD.md · GLOSSARY.md · adr/
        └─▶ spec.md (무엇을·왜, FR-001·SC-001) ─▶ [승인] ─▶ plan.md (어떻게, 같은 번호로 단계·시험) ─▶ [승인] ─▶ qa.md(pharmaflow-qa) ─▶ 개발
```

## 1. 근거 읽기
1. `docs/Intent.md`부터. 그 기능의 원문을 직접 읽는다: PRD의 FR·수용 기준·9절 하지 않을 것, IA의 화면 ID(`HM_…`·`BT_…`)와 용어, 여정 단계, ERD 표·필드.
2. plan을 쓸 때는 지금 코드도 읽는다: `src/domain/`(순수 규칙), `src/ui/`, `src/infrastructure/`(저장 코드는 여기만), `api/`(Vercel 함수), `supabase/migrations/`.
3. 문서끼리 어긋나면 고르지 말고 묻는다.

## 2. spec 쓰기 — 템플릿은 [references/spec-template.md](references/spec-template.md)
PharmaFlow 규칙:
- **화면 용어**는 로트·내부 출하 검토·기준·정상·처리 중·종결(D3). 표·주소·코드 이름은 `batch` 그대로지만 spec 본문에는 화면 말을 쓴다.
- **제외 범위**에 CLAUDE.md "하지 않을 것"(실제 회사 자료, 메일·문자·푸시(슬랙 개인 메시지만), 전자서명·결재 연동, 아이디·비밀번호 가입, 공공데이터 대량 복사, 실험 조건별 비교)에 걸리는 것이 있으면 그대로 옮기고 먼저 묻는다.
- **판정·승인은 사람**: 출하·승인·원인 확정을 앱이나 AI가 정하는 요구사항은 쓰지 않는다. "평가 승인은 출하 승인이 아니다"(E8).
- **AI 기능**이면 FR에 근거 표(코드가 센 값)·숫자와 인용 검증·못 읽음을 0으로 쓰지 않기·하루 한도·실제 호출 비용 승인을 넣는다(spec 022·025와 같은 방식).
- **Q 번호**는 이 프로젝트 전체에서 이어서 쓴다. 점검 스크립트가 다음 번호를 알려 준다.
- 본문 `[확인 필요]`는 3개까지, 나머지는 6절에 질문 + **가정**으로.
- 상태 줄에 승인 날짜를 남긴다. 버전을 올릴 때는 맨 위에 "vX.Y 바뀌는 점"을 한 단락으로.

## 3. plan 쓰기 — 템플릿은 [references/plan-template.md](references/plan-template.md)
PharmaFlow 기본값(바꾸려면 먼저 묻는다):
- **스택**: 빌드 없는 HTML/CSS/JS ES 모듈, Supabase(`@supabase/supabase-js` CDN), Vercel 함수(서울 icn1), 시험은 `node --test "tests/*.test.js"`. 새 라이브러리는 1절 "새 의존성 기록"에 적고 승인.
- **층 방향**: `ui`·`infrastructure`·`api` → `domain`. 새 규칙은 `src/domain/`에서 시험 먼저.
- **DB 변경**: `supabase/migrations/NNNN_이름.sql`(스크립트가 다음 번호 안내). 쓰기는 표에 직접 하지 않고 `public` 함수로만, 함수 안에서 `private.require_role`, 새 표는 RLS. DB 시험은 `supabase/tests/NNN_rules.sql`로 끝에서 일부러 오류를 내 되돌리고 "PF_TEST 통과 N/N". **실제 DB 적용은 승인 뒤.**
- **키**: 서버 키는 `.env`·Vercel 환경변수에만. 화면 코드에는 공개 키만. 새 환경변수는 `.env.example`에 이름만.
- **브랜치**: Phase마다 `phase-N-…` → PR → 병합(push·PR·병합은 승인).
- 첫 단계는 되도록 "지금 동작을 깨지 않고 규칙과 시험 붙이기". 단계마다 끝 조건과 확인 방법.
- spec의 모든 FR·SC를 4절 추적 표에, 제외 범위는 5절 "절대 하지 말 것"에.

## 4. 점검
```bash
py -X utf8 .claude/skills/pharmaflow-spec/scripts/check_spec_plan.py docs/specs/NNN-기능
```
- 원본 검사: spec 여섯 칸·plan 다섯 칸, FR·SC 중복, `[확인 필요]` 개수, spec↔plan 4절 추적, 정확하지 않은 버전 표기.
- PharmaFlow에서 더한 것: 다른 spec과 겹치는 Q 번호 **경고**, 다음 Q 번호·spec 번호(012~016 예약 건너뜀)·마이그레이션 번호 **안내**.
- "통과"가 나올 때까지 고친다. 그다음 승인을 받고 `pharmaflow-qa` 절차 A로 qa.md를 만든다.

## 5. 마무리
- `docs/Intent.md` 문서 지도와 변경 기록에 한 줄. 시험 개수·기능 범위가 바뀌면 README·CLAUDE.md "현재 코드"도 같은 작업에서 맞춘다.

## 이 스킬을 만든 이유 (원본과 바꾼 것)
- 원본: 개인 하네스 스킬 `harness-spec-plan`(유○○ `~/.claude/skills`). 저장소에 없어서 팀원의 Claude는 같은 순서로 일하지 않았다.
- 이 프로젝트에서 spec 21개를 쓰며 되풀이된 것을 넣었다: 화면 용어(D3), 하지 않을 것, DB 변경은 함수·RLS·마이그레이션·DB 시험·승인 뒤 적용, AI 기능의 근거 표·검증, 번호 규칙.
- 점검 스크립트에 번호 안내를 더했다. Q 번호를 새로 정할 때 다른 spec을 뒤지던 일, 마이그레이션 번호가 다른 브랜치와 겹치던 일(debug-note DN-03)을 줄이려고.
