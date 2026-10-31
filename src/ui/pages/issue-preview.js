// 품질 이슈 목록 오른쪽 미리보기: 처리 단계·다음에 할 일·이탈 내용·조치 요청·"열기" (상세 화면과 같은 규칙, 읽기만)
import { h, badge } from "../dom.js";
import { issueKindBadge, measurementLine } from "../issue-views.js";
import { nextLine, stepBar } from "../step-views.js";
import { actionStatusLabel, actionTypeLabel, issueSourceLabel } from "../../domain/action-rules.js";
import { batchStatusLabel } from "../../domain/batch-rules.js";
import { ISSUE_STATUS_LABELS } from "../../domain/judgement-rules.js";
import { reviewStatusLabel } from "../../domain/review-rules.js";
import { issueStep } from "../../domain/step-rules.js";
import { listQualityIssues } from "../../infrastructure/store.js";
import { getIssue, listActionRequests, listIssueMeasurements } from "../../infrastructure/store-actions.js";
import { getIssueReview } from "../../infrastructure/store-reviews.js";

/** @param {{ id: string }} row 목록의 한 줄 */
export async function issuePreview(row) {
  const issue = await getIssue(row.id);
  const [measurements, requests, review, batchIssues] = await Promise.all([
    listIssueMeasurements(issue), listActionRequests(issue.id), getIssueReview(issue.id), listQualityIssues(issue.batch_id),
  ]);
  const step = issueStep({ issue, review, requests, batch: issue.batch, openIssueCount: batchIssues.filter((item) => item.status === "open").length });
  const opening = measurements.filter((m) => m.quality_issue_id === issue.id && !m.action_request_id);

  return h("div", { class: "preview-body" },
    h("div", { class: "preview-head" },
      h("h2", { class: "preview-title" }, "품질 이슈 · ", h("span", { class: "mono" }, issue.batch.batch_number)),
      issueKindBadge(issue), badge(issue.status, ISSUE_STATUS_LABELS[issue.status])),
    h("p", { class: "muted" }, `${issueSourceLabel(issue.source)} 이슈 · `,
      h("a", { href: `#/batches/${issue.batch.id}` }, `로트 ${issue.batch.batch_number}`),
      ` · ${issue.batch.product?.item_name ?? ""} · ${batchStatusLabel(issue.batch.status)}`),
    stepBar(step),
    nextLine(step),
    h("div", { class: "preview-block" },
      h("p", { class: "preview-label" }, "이탈 내용"),
      opening.length
        ? h("ul", { class: "plain-list" }, ...opening.map((m) => h("li", null, measurementLine(m))))
        : h("p", { class: "muted" }, issue.source === "process" ? "공정 이탈 (설비 상태·공정 조건은 상세에서)" : "이탈 측정값을 찾을 수 없습니다.")),
    h("div", { class: "preview-block" },
      h("p", { class: "preview-label" }, "영향 평가"),
      review ? badge(`review_${review.status}`, reviewStatusLabel(review.status)) : h("p", { class: "muted" }, "아직 작성 전입니다.")),
    h("div", { class: "preview-block" },
      h("p", { class: "preview-label" }, `조치 요청 ${requests.length}건`),
      requests.length
        ? h("ul", { class: "plain-list" }, ...requests.map((request) => h("li", null,
            h("strong", null, actionTypeLabel(request.action_type)), " ", badge(request.status, actionStatusLabel(request.status)),
            request.assignee ? h("span", { class: "muted" }, ` · 담당 ${request.assignee.display_name}`) : null)))
        : h("p", { class: "muted" }, "아직 조치 요청이 없습니다.")),
    h("a", { class: "button button--primary preview-open", href: `#/issues/${issue.id}` }, "품질 이슈 열기 →"));
}
