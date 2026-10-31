// 품질 이슈 상세의 단계 카드 한 줄 (UI 개편): 단계마다 지금 상태를 한 줄로. 저장하지 않고 이슈·평가·조치 요청으로 계산한다
// 단계 이름과 "지금 단계"는 step-rules.js (STAGES, issueStep)를 그대로 쓴다
import { STAGES } from "./step-rules.js";
import { issueKindLabel } from "./judgement-rules.js";
import { reviewStatusLabel } from "./review-rules.js";
import { batchStatusLabel } from "./batch-rules.js";

/**
 * @param {{
 *   issue: { kind: string, status: string, closer?: { display_name?: string } | null, batch: { status: string } },
 *   summary: string,
 *   review: { status: string, requester?: { display_name?: string } | null } | null,
 *   requests: { status: string }[],
 *   step: { stage: number, next: string | null, owner: string },
 * }} input summary는 issueSummaryText(이탈 항목과 값)
 * @returns {{ index: number, name: string, state: "done" | "current" | "todo", headline: string, sub: string, next: string, owner: string }[]}
 */
export function stageCards({ issue, summary, review, requests, step }) {
  const completed = requests.filter((request) => request.status === "completed").length;
  const optional = issue.kind === "alert"; // 관리기준 이탈은 조치가 선택 (FR-006 수용 기준 2)
  const heads = [
    { headline: issueKindLabel(issue.kind), sub: summary === "-" ? "" : summary },
    { headline: review ? reviewStatusLabel(review.status) : "작성 전", sub: review?.requester?.display_name ?? "" },
    {
      headline: requests.length ? `요청 ${requests.length}건` : "요청 없음",
      sub: requests.length ? `완료 ${completed}${optional ? " · 선택" : ""}` : optional ? "선택" : "",
    },
    { headline: issue.status === "closed" ? "종결됨" : "열림", sub: issue.status === "closed" ? (issue.closer?.display_name ?? "") : "" },
    { headline: batchStatusLabel(issue.batch.status), sub: "" },
  ];
  return STAGES.map((name, index) => ({
    index,
    name,
    state: index < step.stage ? "done" : index === step.stage ? "current" : "todo",
    ...heads[index],
    // 다음에 할 일은 지금 단계 카드에만 붙는다 (한 곳에서만 보이게)
    next: index === step.stage ? (step.next ?? "") : "",
    owner: index === step.stage ? (step.owner ?? "") : "",
  }));
}
