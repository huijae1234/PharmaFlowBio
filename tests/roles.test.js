import { test } from "node:test";
import assert from "node:assert/strict";
import { homePathFor, isReadOnly, can, roleLabel, canOpen, menuFor, ROLES } from "../src/domain/roles.js";

test("역할별 첫 화면 (FR-005)", () => {
  assert.equal(homePathFor("qa_manager"), "#/home/qa");
  assert.equal(homePathFor("qc_analyst"), "#/home/qc");
  assert.equal(homePathFor("production_operator"), "#/home/production");
  assert.equal(homePathFor("viewer"), "#/batches");
});

test("열람자 첫 화면과 읽기 전용 (FR-003)", () => {
  assert.equal(homePathFor("viewer"), "#/batches");
  assert.equal(isReadOnly("viewer"), true);
  assert.equal(isReadOnly("qc_analyst"), false);
});

test("모르는 역할은 열람자처럼 다룬다 (FR-006)", () => {
  assert.equal(homePathFor("unknown"), "#/batches");
  assert.equal(isReadOnly(undefined), true);
  assert.equal(can("unknown", "record_test"), false);
});

test("역할 이름은 GLOSSARY 용어", () => {
  assert.equal(roleLabel("viewer"), "열람자");
  assert.equal(roleLabel("qc_analyst"), "QC 시험 담당자");
  assert.equal(roleLabel("production_operator"), "생산 담당자");
  assert.equal(roleLabel("qa_manager"), "QA 관리자");
});

test("버튼 표시 표: IA 역할별로 쓸 수 있는 화면과 같다 (FR-006)", () => {
  // [역할, 시험값 입력, 공정 조건 입력, 보류, 배치 등록, 기준값 등록, 역할 지정]
  const table = [
    ["viewer", false, false, false, false, false, false, false],
    ["qc_analyst", true, false, false, false, false, false, false],
    ["production_operator", false, true, true, false, false, false, false], // spec 010 FR-007: 로트 직접 등록은 QA만
    ["qa_manager", true, true, true, true, true, true, true],
  ];
  const actions = ["record_test", "record_process", "hold_batch", "create_batch", "edit_specification", "assign_role"];
  for (const [role, ...expected] of table) {
    actions.forEach((action, i) => assert.equal(can(role, action), expected[i], `${role} ${action}`));
  }
});

test("화면 열기 권한: 첫 화면은 자기 것, QA 관리자는 모두 (IA 네비게이션 모델, FR-004·005)", () => {
  // [역할, #/home/qa, #/home/qc, #/home/production, #/admin/users, #/batches, #/admin/approvals(spec 002 FR-011), #/admin/history(FR-013)]
  const table = [
    ["viewer", false, false, false, false, true, false, false],
    ["qc_analyst", false, true, false, false, true, false, false],
    ["production_operator", false, false, true, false, true, false, false],
    ["qa_manager", true, true, true, true, true, true, true],
  ];
  const paths = ["#/home/qa", "#/home/qc", "#/home/production", "#/admin/users", "#/batches", "#/admin/approvals", "#/admin/history"];
  // spec 003 FR-009: 사용 기록은 QA 관리자만
  for (const role of ["viewer", "qc_analyst", "production_operator"]) assert.equal(canOpen(role, "#/admin/usage"), false, role);
  assert.equal(canOpen("qa_manager", "#/admin/usage"), true);
  for (const [role, ...expected] of table) {
    paths.forEach((path, i) => assert.equal(canOpen(role, path), expected[i], `${role} ${path}`));
  }
});

test("역할 목록은 지정 화면의 선택지 순서", () => {
  assert.deepEqual(ROLES, ["viewer", "qc_analyst", "production_operator", "qa_manager"]);
});

test("조치 요청 등록은 QC·생산·QA (spec 002 FR-003)", () => {
  assert.equal(can("viewer", "request_action"), false);
  assert.equal(can("qc_analyst", "request_action"), true);
  assert.equal(can("production_operator", "request_action"), true);
  assert.equal(can("qa_manager", "request_action"), true);
});

test("제품 등록은 QA 관리자만 (spec 003 FR-001 수용 기준 5)", () => {
  assert.equal(can("qa_manager", "create_product"), true);
  for (const role of ["viewer", "qc_analyst", "production_operator"]) assert.equal(can(role, "create_product"), false, role);
});

test("출하 완료 기록은 생산 담당자만 (spec 017 FR-005 수용 기준 4)", () => {
  assert.equal(can("production_operator", "ship_batch"), true);
  for (const role of ["viewer", "qc_analyst", "qa_manager"]) assert.equal(can(role, "ship_batch"), false, role);
});

test("주 메뉴: 첫 줄 \"홈\"은 역할별 첫 화면, 되돌리기 메뉴 없음 (spec 007 FR-002, FR-003)", () => {
  const labels = (role) => menuFor(role).map((item) => item.label);
  assert.deepEqual(menuFor("qa_manager")[0], { label: "홈", path: "#/home/qa" });
  assert.deepEqual(menuFor("qc_analyst")[0], { label: "홈", path: "#/home/qc" });
  assert.deepEqual(menuFor("production_operator")[0], { label: "홈", path: "#/home/production" });
  // 열람자의 첫 화면은 로트 목록이라 같은 메뉴를 두 번 두지 않는다 (지금과 같음)
  assert.equal(labels("viewer")[0], "로트");
  assert.deepEqual(labels("qa_manager").slice(-4), ["승인 대기", "전체 업무 이력", "사용 기록", "사용자·역할"]);
  for (const role of ["viewer", "qc_analyst", "production_operator", "qa_manager"]) {
    assert.ok(!labels(role).includes("내 첫 화면"), role);
    assert.ok(!labels(role).includes("MSDS"), role); // spec 007 FR-007: MSDS는 각 홈 아래 링크로
    assert.ok(!menuFor(role).some((item) => item.path === "#/admin/reset"), role);
  }
});

test("주 메뉴: 모든 역할에 \"검체\"가 제품 다음에 (spec 008 IA SM_010000_PG)", () => {
  for (const role of ["viewer", "qc_analyst", "production_operator", "qa_manager"]) {
    const labels = menuFor(role).map((item) => item.label);
    assert.equal(labels[labels.indexOf("제품") + 1], "검체", role);
    assert.ok(canOpen(role, "#/samples"), role);
  }
});

test("작업지시: 작성·착수·취소는 생산·QA, 발행은 QA만 (spec 010 FR-001~004, Q55)", () => {
  // [역할, 작성, 발행, 착수, 취소]
  const table = [
    ["viewer", false, false, false, false],
    ["qc_analyst", false, false, false, false],
    ["production_operator", true, false, true, true],
    ["qa_manager", true, true, true, true],
  ];
  const actions = ["create_work_order", "release_work_order", "start_work_order", "cancel_work_order"];
  for (const [role, ...expected] of table) {
    actions.forEach((action, i) => assert.equal(can(role, action), expected[i], `${role} ${action}`));
  }
});

test("주 메뉴: 모든 역할에 \"작업지시\"가 로트 다음에 (spec 010 IA WO_010000_PG)", () => {
  for (const role of ["viewer", "qc_analyst", "production_operator", "qa_manager"]) {
    const labels = menuFor(role).map((item) => item.label);
    assert.equal(labels[labels.indexOf("로트") + 1], "작업지시", role);
    assert.ok(canOpen(role, "#/work-orders"), role);
  }
});
