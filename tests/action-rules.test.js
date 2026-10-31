import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionTypeLabel, actionStatusLabel, issueSourceLabel, actionTypesFor, assignableRoles, assignableUsers, canCompleteRequest, canCloseAs, retestTarget, openRequestCount,
} from "../src/domain/action-rules.js";

test("조치 종류·상태 이름은 GLOSSARY·spec 002 용어", () => {
  assert.equal(actionTypeLabel("retest"), "재시험");
  assert.equal(actionTypeLabel("equipment_check"), "설비 점검");
  assert.equal(actionTypeLabel("material_check"), "원료 확인");
  assert.equal(actionTypeLabel("batch_discard"), "로트 폐기"); // spec 004 FR-009 용어
  assert.equal(actionStatusLabel("pending_approval"), "승인 대기");
  assert.equal(actionStatusLabel("approved"), "승인됨");
  assert.equal(actionStatusLabel("rejected"), "반려됨");
  assert.equal(actionStatusLabel("completed"), "완료");
  assert.equal(issueSourceLabel("test"), "시험");
  assert.equal(issueSourceLabel("process"), "공정");
});

test("재시험은 시험 이슈에만 (Q20)", () => {
  assert.deepEqual(actionTypesFor("test"), ["retest", "equipment_check", "material_check", "batch_discard"]);
  assert.deepEqual(actionTypesFor("process"), ["equipment_check", "material_check", "batch_discard"]);
});

test("조치 종류별 배정 가능 역할 (Q18)", () => {
  assert.deepEqual(assignableRoles("retest"), ["qc_analyst", "qa_manager"]);
  assert.deepEqual(assignableRoles("equipment_check"), ["production_operator", "qa_manager"]);
  assert.deepEqual(assignableRoles("material_check"), ["qc_analyst", "production_operator", "qa_manager"]);
  assert.deepEqual(assignableRoles("batch_discard"), ["qa_manager"]);
});

test("열린 조치 요청 수 (승인 대기·승인됨)", () => {
  assert.equal(openRequestCount([{ status: "pending_approval" }, { status: "approved" }, { status: "completed" }, { status: "rejected" }]), 2);
  assert.equal(openRequestCount([]), 0);
});

test("담당자 후보: 조치 종류에 맞는 역할인 사람만, 이름순 (FR-004 수용 기준 2, Q18)", () => {
  const users = [
    { id: "1", display_name: "윤○○", role: "qc_analyst" },
    { id: "2", display_name: "김희재", role: "production_operator" },
    { id: "3", display_name: "유○○", role: "qa_manager" },
    { id: "4", display_name: "박열람", role: "viewer" },
  ];
  const names = (type) => assignableUsers(users, type).map((user) => user.display_name);
  assert.deepEqual(names("retest"), ["유○○", "윤○○"]);
  assert.deepEqual(names("equipment_check"), ["김희재", "유○○"]);
  assert.deepEqual(names("material_check"), ["김희재", "유○○", "윤○○"]);
  assert.deepEqual(names("batch_discard"), ["유○○"]);
  assert.deepEqual(assignableUsers([], "retest"), []);
});

test("결과 입력 가능: 승인됨이고 배정된 사람이나 QA 관리자 (FR-007 수용 기준 5)", () => {
  const approved = { status: "approved", assignee_id: "qc1" };
  assert.equal(canCompleteRequest(approved, { id: "qc1", role: "qc_analyst" }), true);
  assert.equal(canCompleteRequest(approved, { id: "qa1", role: "qa_manager" }), true);
  assert.equal(canCompleteRequest(approved, { id: "qc2", role: "qc_analyst" }), false);
  assert.equal(canCompleteRequest(approved, { id: "qc1", role: "viewer" }), false, "배정 뒤 열람자로 바뀜 (spec 3절)");
  assert.equal(canCompleteRequest({ ...approved, status: "pending_approval" }, { id: "qa1", role: "qa_manager" }), false);
  assert.equal(canCompleteRequest({ ...approved, status: "completed" }, { id: "qc1", role: "qc_analyst" }), false);
});

test("이슈 닫기 버튼: QA 관리자나 이 이슈 요청에 배정됐던 사람 (FR-008 수용 기준 5, Q19)", () => {
  const requests = [{ status: "completed", assignee_id: "qc1" }, { status: "rejected", assignee_id: null }];
  assert.equal(canCloseAs(requests, { id: "qc1", role: "qc_analyst" }), true);
  assert.equal(canCloseAs(requests, { id: "qa1", role: "qa_manager" }), true);
  assert.equal(canCloseAs(requests, { id: "pr1", role: "production_operator" }), false);
  assert.equal(canCloseAs(requests, { id: "qc1", role: "viewer" }), false);
  assert.equal(canCloseAs([], { id: "qa1", role: "qa_manager" }), true);
});


test("재시험할 항목: 이슈를 연 첫 기준 이탈 측정값 (Q20)", () => {
  const purity = { id: "m1", result: "out_of_spec", action_request_id: null, specification: { item_name: "순도" } };
  const content = { id: "m2", result: "out_of_spec", action_request_id: null, specification: { item_name: "함량" } };
  const retest = { id: "m3", result: "out_of_spec", action_request_id: "r1", specification: { item_name: "순도" } };
  const passed = { id: "m0", result: "pass", action_request_id: null, specification: { item_name: "경도" } };
  assert.equal(retestTarget([passed, purity, content, retest]), purity);
  assert.equal(retestTarget([retest]), null);
  assert.equal(retestTarget([]), null);
});

test("관리기준 이탈로 열린 이슈도 그 측정값의 항목을 재시험한다 (spec 004 FR-007)", () => {
  const alert = { result: "out_of_alert", action_request_id: null, specification_id: "s-potency" };
  const passed = { result: "pass", action_request_id: null, specification_id: "s-ph" };
  assert.equal(retestTarget([passed, alert]), alert);
});
