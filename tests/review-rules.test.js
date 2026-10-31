import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canResubmit, canReview, canWriteReview, checkReviewFields, closeBlockReason, reviewStatusLabel,
} from "../src/domain/review-rules.js";

const filled = {
  deviation_summary: "역가 91%로 관리기준 아래", probable_cause: "시료 보관 온도 편차", impact_assessment: "규격 안이라 영향 낮음",
  proposed_action: "재시험", evidence: "",
};
const qc = { id: "u-qc", role: "qc_analyst" };
const qa = { id: "u-qa", role: "qa_manager" };
const viewer = { id: "u-v", role: "viewer" };
const openIssue = { status: "open", kind: "alert" };
const testingBatch = { status: "in_testing" };

test("평가 상태 이름 (GLOSSARY)", () => {
  assert.equal(reviewStatusLabel("submitted"), "검토 요청");
  assert.equal(reviewStatusLabel("approved"), "승인");
  assert.equal(reviewStatusLabel("rejected"), "반려");
  assert.equal(reviewStatusLabel("revision_requested"), "보완 요청");
});

test("필수 4칸을 채우면 앞뒤 공백을 정리해 통과, 근거는 비워도 됨 (FR-001 수용 기준 2)", () => {
  const result = checkReviewFields({ ...filled, deviation_summary: "  역가 91%  " });
  assert.equal(result.ok, true);
  assert.equal(result.value.deviation_summary, "역가 91%");
  assert.equal(result.value.evidence, "");
});

test("빈 칸·공백만은 칸마다 이유 (FR-001 수용 기준 2, 경계·예외)", () => {
  const result = checkReviewFields({ ...filled, deviation_summary: "   ", proposed_action: "" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, {
    deviation_summary: "이탈 내용을 입력해 주세요.",
    proposed_action: "제안 후속 조치를 입력해 주세요.",
  });
});

test("1,000자를 넘으면 거부, 1,000자는 통과 (경계·예외)", () => {
  assert.equal(checkReviewFields({ ...filled, probable_cause: "가".repeat(1000) }).ok, true);
  const result = checkReviewFields({ ...filled, evidence: "가".repeat(1001) });
  assert.deepEqual(result.errors, { evidence: "근거는 1,000자까지 입력할 수 있습니다." });
});

test("작성: 평가 없는 열린 이슈, 쓸 수 있는 로트, QC·생산·QA만 (FR-001 수용 기준 4·5)", () => {
  const base = { issue: openIssue, review: null, batch: testingBatch };
  assert.equal(canWriteReview({ ...base, profile: qc }), true);
  assert.equal(canWriteReview({ ...base, profile: { id: "p", role: "production_operator" } }), true);
  assert.equal(canWriteReview({ ...base, profile: viewer }), false);
  assert.equal(canWriteReview({ ...base, profile: qc, review: { status: "submitted" } }), false);
  assert.equal(canWriteReview({ ...base, profile: qc, issue: { status: "closed" } }), false);
  assert.equal(canWriteReview({ ...base, profile: qc, batch: { status: "releasable" } }), false);
});

test("다시 제출: 보완 요청·반려된 자기 평가만, 검토 요청 중에는 안 됨 (FR-003, Q34)", () => {
  const base = { issue: openIssue, batch: testingBatch, profile: qc };
  assert.equal(canResubmit({ ...base, review: { status: "revision_requested", requested_by: "u-qc" } }), true);
  assert.equal(canResubmit({ ...base, review: { status: "rejected", requested_by: "u-qc" } }), true);
  assert.equal(canResubmit({ ...base, review: { status: "revision_requested", requested_by: "u-other" } }), false);
  assert.equal(canResubmit({ ...base, review: { status: "submitted", requested_by: "u-qc" } }), false);
});

test("검토: 검토 요청 상태를 QA 관리자만, 승인 뒤에는 안 됨 (FR-002 수용 기준 4·6)", () => {
  const base = { issue: openIssue, batch: testingBatch };
  assert.equal(canReview({ ...base, profile: qa, review: { status: "submitted" } }), true);
  assert.equal(canReview({ ...base, profile: qa, review: { status: "approved" } }), false);
  assert.equal(canReview({ ...base, profile: qc, review: { status: "submitted" } }), false);
});

test("닫기 막는 이유: 평가 → 열린 조치 → 규격 이탈 완료 조치 순 (FR-004 수용 기준 1~5, Q35)", () => {
  const approved = { status: "approved" };
  const spec = { status: "open", kind: "spec" };
  const alert = { status: "open", kind: "alert" };
  const done = [{ status: "completed" }];
  assert.equal(closeBlockReason({ issue: spec, review: null, requests: done }), "승인된 품질 영향 평가가 없어 종결할 수 없습니다.");
  assert.equal(closeBlockReason({ issue: spec, review: { status: "submitted" }, requests: done }), "승인된 품질 영향 평가가 없어 종결할 수 없습니다.");
  assert.equal(closeBlockReason({ issue: alert, review: approved, requests: [{ status: "approved" }] }), "끝나지 않은 조치 요청이 있어 종결할 수 없습니다.");
  assert.equal(closeBlockReason({ issue: spec, review: approved, requests: [{ status: "rejected" }] }),
    "완료된 조치 요청이 없어 종결할 수 없습니다. 먼저 조치 결과를 넣어 주세요.");
  assert.equal(closeBlockReason({ issue: alert, review: approved, requests: [] }), null);
  assert.equal(closeBlockReason({ issue: spec, review: approved, requests: done }), null);
});
