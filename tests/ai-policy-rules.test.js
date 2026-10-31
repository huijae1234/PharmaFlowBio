// spec 023 v0.2: 기능 × 역할 × 대상 × 상태 권한표 (화면과 서버가 같은 함수를 쓴다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { POLICY_FEATURES, aiDecision, isStaff } from "../src/domain/ai-policy-rules.js";

const me = (role, id = "u1") => ({ id, role });
const open = { id: "i1", status: "open", source: "test" };
const proc = { id: "i2", status: "open", source: "process" };
const lot = { status: "on_hold" };
const done = (assignee = "u1", over = {}) => ({ status: "completed", assignee_id: assignee, quality_issue_id: "i1", ...over });
const ok = (feature, ctx) => aiDecision(feature, ctx).allowed;

test("열람자·역할을 못 읽은 사용자는 어떤 기능도 못 쓴다", () => {
  for (const feature of POLICY_FEATURES) {
    assert.equal(ok(feature, { profile: me("viewer"), issue: open, batch: lot, review: null, request: done(), source: "draft" }), false, feature);
    assert.equal(ok(feature, { profile: me(undefined), issue: open }), false, feature);
  }
  assert.equal(aiDecision("issue_prep", {}).allowed, false);
  assert.equal(isStaff("qc_analyst"), true);
  assert.equal(isStaff("viewer"), false);
});

test("조사 준비: QC는 시험 이슈, 생산은 공정 이슈, QA는 검토·승인을 기다리는 이슈만, 닫힌 이슈·출하 판정이 끝난 로트는 모두 거부", () => {
  assert.equal(ok("issue_prep", { profile: me("qc_analyst"), issue: open, batch: lot }), true);
  assert.equal(ok("issue_prep", { profile: me("qc_analyst"), issue: proc, batch: lot }), false);
  assert.equal(ok("issue_prep", { profile: me("production_operator"), issue: proc, batch: lot }), true);
  assert.equal(ok("issue_prep", { profile: me("production_operator"), issue: open, batch: lot }), false);
  assert.match(aiDecision("issue_prep", { profile: me("qc_analyst"), issue: proc, batch: lot }).reason, /QC는 시험 이슈/);
  // QA: 감독이 필요한 이슈에서만
  assert.equal(ok("issue_prep", { profile: me("qa_manager"), issue: open, batch: lot, review: null, requests: [] }), false);
  assert.equal(ok("issue_prep", { profile: me("qa_manager"), issue: open, batch: lot, review: { status: "submitted", requested_by: "x" }, requests: [] }), true);
  assert.equal(ok("issue_prep", { profile: me("qa_manager"), issue: proc, batch: lot, review: null, requests: [{ status: "pending_approval" }] }), true);
  assert.equal(ok("issue_prep", { profile: me("qa_manager"), issue: open, batch: lot, review: { status: "approved", requested_by: "x" }, requests: [{ status: "approved" }] }), false);
  for (const role of ["qa_manager", "qc_analyst"]) {
    assert.equal(ok("issue_prep", { profile: me(role), issue: { ...open, status: "closed" }, batch: lot, review: { status: "submitted" }, requests: [] }), false, role);
    assert.equal(ok("issue_prep", { profile: me(role), issue: open, batch: { status: "discarded" }, review: { status: "submitted" }, requests: [] }), false, role);
  }
});

test("평가서 보완: 작성·수정할 수 있는 평가서는 작성자(QC·생산·QA)가, 제출된 평가서 검토는 QA만 (작성 지원과 검토를 나눈다)", () => {
  const draft = (role, review, id = "u1") => aiDecision("review_check", { profile: me(role, id), issue: open, batch: lot, review, source: "draft" });
  assert.deepEqual(draft("qc_analyst", null), { allowed: true, mode: "author" });
  assert.equal(draft("production_operator", null).allowed, true);
  assert.equal(draft("qa_manager", null).allowed, true);
  // 검토 요청 중에는 고치지 않는다(Q34), 되돌아온 평가서는 쓴 사람 본인만
  assert.equal(draft("qc_analyst", { status: "submitted", requested_by: "u1" }).allowed, false);
  assert.equal(draft("qc_analyst", { status: "revision_requested", requested_by: "u1" }).allowed, true);
  assert.equal(draft("qc_analyst", { status: "revision_requested", requested_by: "other" }).allowed, false);
  assert.equal(draft("qc_analyst", { status: "approved", requested_by: "u1" }).allowed, false);
  const saved = (role, status) => aiDecision("review_check", { profile: me(role), issue: open, batch: lot, review: { status, requested_by: "x" }, source: "saved" });
  assert.deepEqual(saved("qa_manager", "submitted"), { allowed: true, mode: "review" });
  assert.equal(saved("qa_manager", "approved").allowed, false);
  assert.equal(saved("qc_analyst", "submitted").allowed, false);
  assert.equal(saved("production_operator", "submitted").allowed, false);
  assert.equal(aiDecision("review_check", { profile: me("qa_manager"), issue: open, batch: lot, review: null, source: "other" }).allowed, false);
  assert.equal(aiDecision("review_check", { profile: me("qc_analyst"), issue: { ...open, status: "closed" }, batch: lot, review: null, source: "draft" }).allowed, false);
});

test("조치 이후 확인: QA는 전체, QC·생산은 본인이 담당한 같은 종류(시험/공정) 이슈의 완료된 조치만", () => {
  const go = (role, issue, request, id = "u1") => aiDecision("after_action", { profile: me(role, id), issue, request });
  assert.equal(go("qa_manager", open, done("someone")).allowed, true);
  assert.equal(go("qc_analyst", open, done("u1")).allowed, true);
  assert.equal(go("qc_analyst", open, done("other")).allowed, false); // 다른 사람이 담당
  assert.equal(go("qc_analyst", { ...proc, id: "i1" }, done("u1")).allowed, false); // 공정 이슈는 생산 몫
  assert.equal(go("production_operator", { ...proc, id: "i1" }, done("u1")).allowed, true);
  assert.equal(go("production_operator", open, done("u1")).allowed, false);
  assert.equal(go("qc_analyst", open, done("u1", { status: "approved" })).allowed, false); // 완료되지 않음
  assert.equal(go("qa_manager", open, done("u1", { quality_issue_id: "other-issue" })).allowed, false); // 다른 이슈의 조치
  assert.equal(go("qa_manager", open, undefined).allowed, false);
});

test("기준 변경 영향은 QA만, 일정 확인은 생산·QA만, 업무 찾아보기는 세 역할 모두", () => {
  const roles = ["qa_manager", "qc_analyst", "production_operator"];
  assert.deepEqual(roles.map((role) => ok("spec_impact", { profile: me(role) })), [true, false, false]);
  assert.deepEqual(roles.map((role) => ok("schedule_check", { profile: me(role) })), [true, false, true]);
  assert.deepEqual(roles.map((role) => ok("ask", { profile: me(role) })), [true, true, true]);
  assert.equal(aiDecision("nothing", { profile: me("qa_manager") }).allowed, false);
});
