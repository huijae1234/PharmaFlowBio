// spec 025 FR-003: AI 도우미가 답할 수 있는 앱 안내서 (IA 메뉴구조도·역할별로 쓸 수 있는 화면·용어 정의)
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_GUIDE, guideFor, guideText } from "../src/domain/app-guide.js";
import { menuFor } from "../src/domain/roles.js";
import { CLEARANCE_ITEMS } from "../src/domain/process-step-rules.js";
import { REVIEW_FIELDS } from "../src/domain/review-rules.js";

const STAFF = ["qa_manager", "qc_analyst", "production_operator"];

test("안내서 항목은 id가 겹치지 않고, 주소는 앱 안(#/)뿐이다 (FR-006 수용 기준 3)", () => {
  const ids = APP_GUIDE.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(APP_GUIDE.length >= 20 && APP_GUIDE.length <= 40, `${APP_GUIDE.length}개`);
  for (const entry of APP_GUIDE) {
    assert.match(entry.id, /^[a-z0-9_]{1,40}$/);
    assert.ok(entry.title && entry.text, entry.id);
    assert.ok(entry.href === null || /^#\/[a-z0-9/_-]*$/.test(entry.href), `${entry.id}: ${entry.href}`);
    assert.ok(entry.roles.length > 0 && entry.roles.every((role) => STAFF.includes(role)), entry.id);
  }
});

test("역할마다 옆 메뉴의 모든 화면이 안내서에 같은 이름·주소로 있다 (IA 메뉴구조도와 어긋나지 않게)", () => {
  for (const role of STAFF) {
    const allowed = guideFor(role).filter((entry) => entry.allowed);
    for (const item of menuFor(role)) {
      const found = allowed.find((entry) => entry.href === item.path);
      assert.ok(found, `${role}: ${item.label} ${item.path}`);
    }
  }
});

test("역할별 거르기: 할 수 없는 일은 allowed가 거짓이고 누가 하는지 적혀 있다, 열람자는 빈 목록 (FR-003 수용 기준 3)", () => {
  const release = guideFor("production_operator").find((entry) => entry.id === "task_release");
  assert.equal(release.allowed, false);
  assert.match(release.who, /QA 관리자/);
  assert.equal(guideFor("qa_manager").find((entry) => entry.id === "task_release").allowed, true);
  assert.equal(guideFor("qc_analyst").find((entry) => entry.id === "task_test_values").allowed, true);
  assert.equal(guideFor("production_operator").find((entry) => entry.id === "task_test_values").allowed, false);
  assert.deepEqual(guideFor("viewer"), []);
  assert.deepEqual(guideFor(undefined), []);
});

const byId = (role) => new Map(guideFor(role).map((item) => [item.id, item]));

test("생산 업무 절차가 안내서에 있다: 단계 착수·완료, 라인 클리어런스, 설비 이상, 작업 착수, 검체, 조치 결과 (FR-003 수용 기준 4·5, v0.5)", () => {
  const prod = byId("production_operator");
  for (const id of ["task_step_start", "task_step_complete", "term_line_clearance", "term_equipment_abnormal", "task_work_order_start", "task_sample_routes", "task_sample_receive", "task_action_result"]) {
    assert.ok(prod.get(id)?.allowed, id);
  }
  // 화면 코드의 말과 같다 (지어내지 않는다)
  for (const item of CLEARANCE_ITEMS) assert.ok(prod.get("term_line_clearance").text.includes(item.label), item.label);
  assert.match(prod.get("task_step_start").text, /앞 단계를 완료한 뒤/);
  assert.match(prod.get("task_step_complete").text, /설비 상태/);
  assert.match(prod.get("term_equipment_abnormal").text, /공정 품질 이슈가 열린다/);
  assert.match(prod.get("task_work_order_start").text, /로트번호/);
  assert.match(prod.get("task_sample_routes").text, /생산 → QC/);
  assert.match(prod.get("task_process_conditions").text, /설비 상태/);
});

test("QC 업무 절차: 시험값 판정 세 가지, 재시험, 검체 인수. 생산 전용 일은 못 함 표시 (FR-003 수용 기준 5, v0.5)", () => {
  const qc = byId("qc_analyst");
  for (const id of ["task_test_values", "task_retest", "task_sample_receive", "task_action_result"]) assert.ok(qc.get(id)?.allowed, id);
  assert.match(qc.get("task_test_values").text, /정상.*관리기준 이탈.*규격 이탈/);
  assert.equal(qc.get("task_step_start").allowed, false);
  assert.equal(qc.get("task_work_order_start").allowed, false);
});

test("평가서 칸은 화면과 같은 이름이다 (FR-003 수용 기준 5, v0.5)", () => {
  const text = byId("qc_analyst").get("task_review_write").text;
  for (const field of REVIEW_FIELDS) assert.ok(text.includes(field.label), field.label);
});

test("안내서 글: 줄마다 [id], 할 수 없는 일은 표시가 붙는다 (프롬프트에 넣는 모양)", () => {
  const text = guideText(guideFor("production_operator"));
  assert.match(text, /^\[task_release\] 내부 출하 검토: .*\(이 사용자는 못 함 · QA 관리자가 함\)$/m);
  assert.match(text, /^\[task_process_conditions\] 공정 조건 입력: /m);
  assert.doesNotMatch(text, /@|https?:/); // 이메일·밖 주소 없음
});
