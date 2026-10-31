import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, batchSummary, issueStep } from "../src/domain/step-rules.js";

const testing = { status: "in_testing" };
const open = (kind = "spec", extra = {}) => ({ id: "i1", status: "open", kind, opened_at: "2026-10-23T01:00:00Z", ...extra });
const step = (input) => {
  const result = issueStep({ batch: testing, openIssueCount: 1, review: null, requests: [], ...input });
  return [STAGES[result.stage], result.next, result.owner];
};

test("단계 5개 (IA QI_010100_PG)", () => {
  assert.deepEqual(STAGES, ["이탈", "영향 평가", "조치", "이슈 종결", "내부 출하 검토"]);
});

test("다음에 할 일 규칙 1·2: 닫힌 이슈 (FR-006)", () => {
  assert.deepEqual(step({ issue: { ...open(), status: "closed" }, openIssueCount: 0 }), ["내부 출하 검토", "내부 출하 검토", "QA 관리자"]);
  assert.deepEqual(step({ issue: { ...open(), status: "closed" }, openIssueCount: 1 }), ["이슈 종결", "이슈 종결됨", ""]);
  assert.deepEqual(step({ issue: { ...open(), status: "closed" }, openIssueCount: 0, batch: { status: "on_hold" } }), ["이슈 종결", "이슈 종결됨", ""]);
});

test("다음에 할 일 규칙 3~5: 영향 평가 (FR-006)", () => {
  assert.deepEqual(step({ issue: open() }), ["영향 평가", "품질 영향 평가 작성", "QC 시험 담당자·생산 담당자"]);
  const back = { status: "revision_requested", requester: { display_name: "윤○○" } };
  assert.deepEqual(step({ issue: open(), review: back }), ["영향 평가", "평가 고쳐 다시 제출", "윤○○"]);
  assert.deepEqual(step({ issue: open(), review: { ...back, status: "rejected" } }), ["영향 평가", "평가 고쳐 다시 제출", "윤○○"]);
  assert.deepEqual(step({ issue: open(), review: { status: "submitted" } }), ["영향 평가", "영향 평가 검토", "QA 관리자"]);
});

test("다음에 할 일 규칙 6~9: 조치와 닫기 (FR-006)", () => {
  const approved = { status: "approved" };
  assert.deepEqual(step({ issue: open(), review: approved, requests: [{ status: "pending_approval" }] }), ["조치", "조치 요청 승인", "QA 관리자"]);
  assert.deepEqual(step({ issue: open(), review: approved, requests: [{ status: "approved", assignee: { display_name: "윤○○" } }] }),
    ["조치", "조치 결과 입력", "윤○○"]);
  assert.deepEqual(step({ issue: open(), review: approved, requests: [{ status: "rejected" }] }), ["조치", "조치 요청 등록", "QC 시험 담당자·생산 담당자"]);
  assert.deepEqual(step({ issue: open(), review: approved, requests: [{ status: "completed" }] }), ["이슈 종결", "이슈 종결", "배정됐던 담당자 또는 QA 관리자"]);
  assert.deepEqual(step({ issue: open("alert"), review: approved }), ["이슈 종결", "이슈 종결", "배정됐던 담당자 또는 QA 관리자"]);
});

test("관리기준 이탈 이슈는 조치 단계가 선택 (FR-006 수용 기준 2)", () => {
  assert.equal(issueStep({ issue: open("alert"), review: null, requests: [], batch: testing, openIssueCount: 1 }).optionalAction, true);
  assert.equal(issueStep({ issue: open("spec"), review: null, requests: [], batch: testing, openIssueCount: 1 }).optionalAction, false);
});

test("로트 요약: 종류별 열린 수, 평가 상태별 수, 가장 오래된 이슈의 다음에 할 일 + 외 N건 (FR-007)", () => {
  const issues = [
    open("alert", { id: "i2", opened_at: "2026-10-23T03:00:00Z" }),
    open("spec", { id: "i1", opened_at: "2026-10-23T01:00:00Z" }),
    { ...open("spec", { id: "i0" }), status: "closed" },
  ];
  const reviews = [{ quality_issue_id: "i2", status: "submitted" }, { quality_issue_id: "i0", status: "approved" }];
  const summary = batchSummary({ issues, reviews, requests: [], batch: { status: "on_hold" } });
  assert.equal(summary.specOpen, 1);
  assert.equal(summary.alertOpen, 1);
  assert.deepEqual(summary.reviewCounts, { none: 1, submitted: 1, approved: 0, rejected: 0, revision_requested: 0 });
  assert.equal(summary.next, "품질 영향 평가 작성");
  assert.equal(summary.more, 1);
});

test("로트 요약: 열린 이슈 0, 시험 중이면 내부 출하 검토 (FR-007 수용 기준 2)", () => {
  const summary = batchSummary({ issues: [], reviews: [], requests: [], batch: testing });
  assert.equal(summary.next, "내부 출하 검토");
  assert.equal(summary.owner, "QA 관리자");
  assert.equal(summary.more, 0);
  assert.equal(batchSummary({ issues: [], reviews: [], requests: [], batch: { status: "in_production" } }).next, null);
});
