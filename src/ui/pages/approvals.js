// IA AD_010000_PG 승인 대기 (QA 관리자만). FR-011 (spec 002). 승인·반려는 품질 이슈 상세의 모달을 그대로 쓴다
// 품질 영향 평가 검토 대기는 spec 005 FR-008: 오래된 순, 누르면 그 이슈 상세에서 검토
import { h, formatDateTime, refreshPage } from "../dom.js";
import { openSafely } from "../modal.js";
import { issueSummaryText, measurementLine } from "../issue-views.js";
import { openApproveModal, openRejectModal } from "./action-modals.js";
import { openReviewDecisionModal } from "./review-modals.js";
import { comparePanel } from "../compare-panel.js";
import { actionTypeLabel, issueSourceLabel } from "../../domain/action-rules.js";
import { ageInfo } from "../../domain/home-task-rules.js";
import { listProductMeasurements } from "../../infrastructure/store.js";
import { getIssue, listIssueMeasurements, listPendingRequests } from "../../infrastructure/store-actions.js";
import { getIssueReview, listPendingReviews } from "../../infrastructure/store-reviews.js";

let pendingNotice = "";

function doneWith(message) {
  return (notice = message) => { pendingNotice = notice; refreshPage(); };
}

export async function renderApprovals() {
  const [requests, reviews] = await Promise.all([listPendingRequests(), listPendingReviews()]);
  const notice = pendingNotice;
  pendingNotice = "";
  return h("div", { class: "stack" },
    h("h1", { class: "page-title" }, "승인 대기"),
    notice ? h("p", { class: "status-text", role: "status" }, notice) : null,
    h("section", { class: "panel" },
      h("h2", { class: "section-title" }, `조치 요청 ${requests.length}`),
      requests.length ? approvalTable(requests) : h("p", { class: "muted" }, "승인을 기다리는 조치 요청이 없습니다.")),
    h("section", { class: "panel" },
      h("h2", { class: "section-title" }, `품질 영향 평가 검토 대기 ${reviews.length}`),
      reviews.length ? reviewTable(reviews) : h("p", { class: "muted" }, "검토를 기다리는 품질 영향 평가가 없습니다.")));
}

// 기다린 날수: 7일 이상이면 지연 (PRD FR-38). 어느 것부터 볼지 한눈에
function waitedCell(iso) {
  const age = ageInfo(iso);
  return h("td", null, age ? h("span", { class: age.late ? "age age--late" : "age" }, age.late ? `지연 ${age.text}` : age.text) : "");
}

// 영향 평가는 이슈 화면으로 가지 않고 여기서 바로 검토한다: 근거(이탈 값, 같은 제품 다른 로트 비교)를 창 안에 불러와서
async function openReviewHere(review) {
  const issue = await getIssue(review.issue.id);
  const [measurements, full, productMeasurements] = await Promise.all([
    listIssueMeasurements(issue), getIssueReview(issue.id), listProductMeasurements(issue.batch.product_id).catch(() => []),
  ]);
  const opening = measurements.filter((m) => m.quality_issue_id === issue.id && !m.action_request_id);
  const specs = [...new Map(opening.filter((m) => m.specification).map((m) => [m.specification.item_name, m.specification])).values()];
  const evidence = () => h("div", { class: "stack" },
    h("p", { class: "muted" }, `로트 ${issue.batch.batch_number} · 발생 ${formatDateTime(issue.opened_at)} · ${issueSourceLabel(issue.source)} 이슈`),
    opening.length ? h("ul", { class: "plain-list" }, ...opening.map((m) => h("li", null, measurementLine(m)))) : null,
    specs.length ? comparePanel({ specs, measurements: productMeasurements, batchId: issue.batch_id, currentNumber: issue.batch.batch_number, compact: true }) : null);
  openReviewDecisionModal({ review: full ?? review, evidence, onDone: doneWith("품질 영향 평가 검토를 저장했습니다.") });
}

function reviewTable(reviews) {
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ...["로트번호", "이탈 항목", "요청자", "요청 시각", "대기", "처리"]
      .map((title) => h("th", { scope: "col" }, title)))),
    h("tbody", null, ...reviews.map((review) => h("tr", null,
      h("td", { class: "mono" }, review.issue?.batch?.batch_number ?? ""),
      h("td", null, issueSummaryText(review.issue)),
      h("td", null, review.requester?.display_name ?? ""),
      h("td", { class: "muted" }, formatDateTime(review.requested_at)),
      waitedCell(review.requested_at),
      h("td", null, h("div", { class: "toolbar" },
        h("button", { class: "button button--primary", type: "button", onclick: openSafely(() => openReviewHere(review)) }, "검토"),
        h("a", { class: "button", href: `#/issues/${review.issue.id}` }, "이슈 열기"))))))));
}

function approvalTable(requests) {
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ...["로트번호", "이탈 항목", "조치 종류", "내용", "요청자", "요청 시각", "대기", "처리"]
      .map((title) => h("th", { scope: "col" }, title)))),
    h("tbody", null, ...requests.map((request) => h("tr", null,
      h("td", null, h("a", { class: "mono", href: `#/issues/${request.issue.id}` }, request.issue.batch?.batch_number ?? "")),
      h("td", null, issueSummaryText(request.issue)),
      h("td", null, actionTypeLabel(request.action_type)),
      h("td", null, request.description ?? ""),
      h("td", null, request.requester?.display_name ?? ""),
      h("td", { class: "muted" }, formatDateTime(request.requested_at)),
      waitedCell(request.requested_at),
      h("td", null, h("div", { class: "toolbar" },
        h("button", {
          class: "button button--primary",
          type: "button",
          onclick: openSafely(() => openApproveModal({ request, onDone: doneWith("조치 요청을 승인했습니다.") })),
        }, "승인"),
        h("button", {
          class: "button",
          type: "button",
          onclick: openSafely(() => openRejectModal({ request, onDone: doneWith("조치 요청을 반려했습니다.") })),
        }, "반려"))))))));
}
