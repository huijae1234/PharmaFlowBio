// 품질 이슈 단계와 다음에 할 일 (spec 005 FR-006·007). 저장하지 않고 이슈·평가·조치 요청·로트 상태로 계산한다 (ERD batch 계산 값)

export const STAGES = ["이탈", "영향 평가", "조치", "이슈 종결", "내부 출하 검토"]; // spec 007 FR-005
const [, REVIEW, ACTION, CLOSE, RELEASE] = STAGES.keys();
const WRITERS = "QC 시험 담당자·생산 담당자";
const QA = "QA 관리자";
const RETURNED = new Set(["rejected", "revision_requested"]);

function result(stage, next, owner) {
  return { stage, next, owner };
}

// FR-006 규칙 6~9: 평가가 승인된 뒤
function actionStep(issue, requests) {
  if (requests.some((request) => request.status === "pending_approval")) return result(ACTION, "조치 요청 승인", QA);
  const approved = requests.find((request) => request.status === "approved");
  if (approved) return result(ACTION, "조치 결과 입력", approved.assignee?.display_name ?? "배정된 담당자");
  if (issue.kind === "spec" && !requests.some((request) => request.status === "completed")) return result(ACTION, "조치 요청 등록", WRITERS);
  return result(CLOSE, "이슈 종결", "배정됐던 담당자 또는 QA 관리자");
}

// FR-006 규칙 3~5: 영향 평가가 승인되기 전. 승인됐으면 null
function reviewStep(review) {
  if (!review) return result(REVIEW, "품질 영향 평가 작성", WRITERS);
  if (RETURNED.has(review.status)) return result(REVIEW, "평가 고쳐 다시 제출", review.requester?.display_name ?? "요청자");
  if (review.status === "submitted") return result(REVIEW, "영향 평가 검토", QA);
  return null;
}

/**
 * FR-006: 위에서부터 먼저 맞는 규칙. stage는 STAGES의 번호
 * @param {{ issue: { status: string, kind: string }, review: object | null, requests: object[], batch: { status: string }, openIssueCount: number }} input
 * @returns {{ stage: number, next: string, owner: string, optionalAction: boolean }}
 */
export function issueStep({ issue, review, requests, batch, openIssueCount }) {
  const optionalAction = issue.kind === "alert"; // FR-006 수용 기준 2
  if (issue.status === "closed") {
    const ready = batch.status === "in_testing" && openIssueCount === 0;
    return { ...(ready ? result(RELEASE, "내부 출하 검토", QA) : result(CLOSE, "이슈 종결됨", "")), optionalAction };
  }
  return { ...(reviewStep(review) ?? actionStep(issue, requests)), optionalAction };
}

/**
 * FR-007: 로트 상세 위쪽 요약. 다음에 할 일은 가장 오래된 열린 이슈의 것
 * @param {{ issues: object[], reviews: { quality_issue_id: string, status: string }[], requests: { quality_issue_id: string }[], batch: { status: string } }} input
 */
export function batchSummary({ issues, reviews, requests, batch }) {
  const openIssues = issues.filter((issue) => issue.status === "open").sort((a, b) => (a.opened_at < b.opened_at ? -1 : 1));
  const reviewOf = (issue) => reviews.find((review) => review.quality_issue_id === issue.id) ?? null;
  const reviewCounts = { none: 0, submitted: 0, approved: 0, rejected: 0, revision_requested: 0 };
  for (const issue of openIssues) reviewCounts[reviewOf(issue)?.status ?? "none"] += 1;
  const base = {
    specOpen: openIssues.filter((issue) => issue.kind === "spec").length,
    alertOpen: openIssues.filter((issue) => issue.kind === "alert").length,
    reviewCounts,
    more: Math.max(openIssues.length - 1, 0),
  };
  if (!openIssues.length) {
    return batch.status === "in_testing" ? { ...base, next: "내부 출하 검토", owner: QA } : { ...base, next: null, owner: "" };
  }
  const first = openIssues[0];
  const step = issueStep({
    issue: first, review: reviewOf(first), batch, openIssueCount: openIssues.length,
    requests: requests.filter((request) => request.quality_issue_id === first.id),
  });
  return { ...base, next: step.next, owner: step.owner };
}
