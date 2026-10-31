// 로트 상세 "이 로트에서 지금 할 일" (홈 개편): 처리 중인 이슈마다 지금 단계와 다음에 할 일. 종결된 이슈는 넣지 않는다.
// 저장하지 않고 이슈·평가·조치 요청·측정값·로트 상태로 계산한다 (단계 규칙은 step-rules.js의 issueStep)
import { issueStep } from "./step-rules.js";

/**
 * @param {{
 *   issues: { id: string, status: string, kind: string, source: string, opened_at: string }[],
 *   reviews: { quality_issue_id: string, status: string }[],
 *   requests: { quality_issue_id: string, status: string }[],
 *   batch: { status: string },
 *   measurements: { quality_issue_id: string | null, action_request_id: string | null, result: string, value: number, specification: { item_name: string, unit: string | null } }[],
 * }} input
 * @returns {{ issueId: string, kind: string, detail: string, next: string, owner: string, stage: number }[]} 오래된 이슈부터
 */
export function lotTodos({ issues, reviews, requests, batch, measurements }) {
  const open = issues.filter((issue) => issue.status === "open").sort((a, b) => (a.opened_at < b.opened_at ? -1 : 1));
  return open.map((issue) => {
    const step = issueStep({
      issue,
      review: reviews.find((review) => review.quality_issue_id === issue.id) ?? null,
      batch,
      openIssueCount: open.length,
      requests: requests.filter((request) => request.quality_issue_id === issue.id),
    });
    const measurement = measurements.find((m) => m.quality_issue_id === issue.id && !m.action_request_id && m.result !== "pass");
    const detail = measurement
      ? `${measurement.specification.item_name} ${measurement.value}${measurement.specification.unit ?? ""}`
      : issue.source === "process" ? "공정 이탈" : "시험 이탈";
    return { issueId: issue.id, kind: issue.kind, detail, next: step.next, owner: step.owner, stage: step.stage };
  });
}

/**
 * 맨 위 상자 하나의 상태: 할 일이 있으면 open, 출하 검토를 할 수 있으면 ready, 아니면 idle
 * @param {{ todos: object[], batch: { status: string } }} input
 */
export function todoTone({ todos, batch }) {
  if (todos.length) return "open";
  return batch.status === "in_testing" ? "ready" : "idle";
}
