// IA QI_010100_PG 품질 이슈 상세. FR-002 (spec 002): 이탈 내용, 조치 요청, 재시험 결과, 업무 이력. 종류·그때 기준은 spec 004 FR-004·005
// 품질 영향 평가 칸과 종류별 닫기 이유는 spec 005 FR-001~004
import { h, badge, formatDateTime, section, refreshPage } from "../dom.js";
import { openSafely } from "../modal.js";
import { issueKindBadge, measurementLine, issueSummaryText } from "../issue-views.js";
import { openApproveModal, openRejectModal, openResubmitModal, openSubmitRequestModal } from "./action-modals.js";
import { openCloseIssueModal, openCompleteModal } from "./result-modals.js";
import { reviewSection } from "./review-section.js";
import { stagePipeline } from "../stage-pipeline.js";
import { stageCards } from "../../domain/issue-stage-rules.js";
import { issueStep } from "../../domain/step-rules.js";
import { comparePanel } from "../compare-panel.js";
import { listProductMeasurements, listQualityIssues } from "../../infrastructure/store.js";
import {
  actionStatusLabel, actionTypeLabel, canCloseAs, canCompleteRequest, issueSourceLabel, retestTarget,
} from "../../domain/action-rules.js";
import { closeBlockReason } from "../../domain/review-rules.js";
import { ISSUE_STATUS_LABELS } from "../../domain/judgement-rules.js";
import { isBatchEditable, batchStatusLabel } from "../../domain/batch-rules.js";
import { can, roleLabel } from "../../domain/roles.js";
import { getIssue, listActionRequests, listIssueHistory, listIssueMeasurements } from "../../infrastructure/store-actions.js";
import { getIssueReview } from "../../infrastructure/store-reviews.js";
import { listAcksFor } from "../../infrastructure/store-notifications.js";
import { ackSlot, watchAcks } from "../ack-badge.js";
import { followupBlocks, investigatePanel, reviewCheckPanel } from "./issue-ai.js";
import { loadStepLabel } from "../../infrastructure/store-ai-context.js";

const EQUIPMENT_LABELS = { normal: "정상", abnormal: "이상" };

let pendingNotice = "";

// 저장 뒤 안내를 남기고 다시 그린다. 다른 사람이 먼저 처리했으면 그 문구 (FR-006)
function doneWith(message) {
  return (notice = message) => { pendingNotice = notice; refreshPage(); };
}

/** @param {{ profile: { id: string, role: string }, id: string }} context */
export async function renderIssueDetail({ profile, id }) {
  const issue = await getIssue(id);
  if (!issue) {
    return h("section", { class: "panel" },
      h("h1", { class: "page-title" }, "품질 이슈를 찾을 수 없습니다"),
      h("a", { href: "#/issues" }, "품질 이슈 목록으로"));
  }
  const [measurements, requests, review, batchIssues, productMeasurements, stepLabel] = await Promise.all([
    listIssueMeasurements(issue), listActionRequests(issue.id), getIssueReview(issue.id), listQualityIssues(issue.batch_id),
    listProductMeasurements(issue.batch.product_id).catch(() => []), // 비교용 보조 자료: 못 읽으면 비교 칸만 비움
    issue.process_record_id ? loadStepLabel(issue.process_record_id) : undefined]); // spec 023: 조사 준비 AI 칸용 공정 단계 이름(못 읽으면 undefined)
  // FR-006 (spec 005): 단계와 다음에 할 일
  const step = issueStep({ issue, review, requests, batch: issue.batch,
    openIssueCount: batchIssues.filter((item) => item.status === "open").length });
  const targetIds = [issue.id, ...requests.map((r) => r.id), ...measurements.map((m) => m.id), ...(review ? [review.id] : [])];
  const history = await listIssueHistory(issue.batch_id, targetIds);
  const notice = pendingNotice;
  pendingNotice = "";

  const opening = measurements.filter((m) => m.quality_issue_id === issue.id && !m.action_request_id);
  const processItems = measurements.filter((m) => issue.process_record_id && m.process_record_id === issue.process_record_id);
  const retests = measurements.filter((m) => m.action_request_id);
  const ai = { opening, processItems, retests, review, requests, stepLabel }; // spec 023 AI 칸 세 개가 읽는 자료 (읽기만)
  const summary = issueSummaryText({ measurements: opening, process_record: issue.process_record });
  // Q33 (spec 005): 평가 창에 보일 근거. 창을 열 때마다 새로 그린다
  const evidence = () => h("div", { class: "stack" },
    h("p", { class: "muted" }, `로트 ${issue.batch.batch_number} · 발생 ${formatDateTime(issue.opened_at)} · ${issueSourceLabel(issue.source)} 이슈`),
    deviation(issue, opening, processItems), retests.length ? retestList(retests) : null);

  // UI 개편: 단계 카드 한 줄(다음에 할 일은 지금 카드 안에만) + 고른 단계의 내용. 이력은 맨 아래에 접어 둔다
  const panels = [
    section("이탈 내용", deviation(issue, opening, processItems)),
    // 영향 평가를 검토할 때는 근거(이탈 값과 같은 제품 다른 로트 비교)와 평가 내용을 나란히: 다른 화면을 오가며 비교하지 않게
    h("div", { class: "review-split" },
      section("판단 근거", deviation(issue, opening, processItems), compareBlock(issue, opening, processItems, productMeasurements)),
      reviewSection({ profile, issue, review, evidence, onDone: doneWith,
        aiCheck: (getValues, source, watch) => reviewCheckPanel({ profile, issue, ctx: ai, getValues, source, watch }) })),
    h("div", { class: "stack" },
      section("조치 요청", requestActions(profile, issue, summary), investigate(profile, issue, ai, summary),
        requestList(requests, { profile, issue, target: retestTarget(opening) }), followupBlocks({ profile, issue, ctx: ai })),
      retests.length ? section("재시험 결과", retestList(retests)) : null),
    closeSection(profile, issue, { review, requests }) ?? closePanel(issue),
    releasePanel(issue),
  ];
  const view = h("div", { class: "stack" },
    header(issue),
    notice ? h("p", { class: "status-text", role: "status" }, notice) : null,
    stagePipeline({ cards: stageCards({ issue, summary, review, requests, step }), panels }),
    h("details", { class: "more panel" },
      h("summary", null, `업무 이력 ${history.length}건`),
      historyList(history)));
  // spec 009 v0.7 FR-009: 조치 요청·평가 알림을 받는 사람이 슬랙에서 확인했는지, 30초마다
  watchAcks(view, async () => [
    ...(await listAcksFor("action_request", requests.map((r) => r.id))),
    ...(await listAcksFor("deviation_review", review ? [review.id] : [])),
  ]);
  return view;
}

function header(issue) {
  return h("header", { class: "panel lot-head" },
    h("div", { class: "lot-head-top" },
      h("div", { class: "lot-title" },
        h("h1", { class: "page-title" }, "품질 이슈 · ", h("span", { class: "mono" }, issue.batch.batch_number)),
        issueKindBadge(issue), badge(issue.status, ISSUE_STATUS_LABELS[issue.status]))),
    h("p", { class: "batch-meta" },
      h("a", { class: "mono", href: `#/batches/${issue.batch.id}` }, `로트 ${issue.batch.batch_number}`),
      h("span", { class: "muted" }, issue.batch.product?.item_name ?? ""),
      badge(issue.batch.status, batchStatusLabel(issue.batch.status)),
      h("span", { class: "muted" }, `${issueSourceLabel(issue.source)} 이슈 · 연 시각 ${formatDateTime(issue.opened_at)}`),
      issue.closed_at ? h("span", { class: "muted" }, ` · 닫음 ${issue.closer?.display_name ?? ""} ${formatDateTime(issue.closed_at)}`) : null));
}

// 이탈 항목마다 같은 제품 다른 로트와 비교 (범위 막대 + 최근 로트 표). 이탈 값이 없으면 안내만
function compareBlock(issue, opening, processItems, productMeasurements) {
  const names = new Set([...opening, ...processItems].map((m) => m.specification?.item_name).filter(Boolean));
  const specs = [...new Map([...opening, ...processItems].filter((m) => m.specification).map((m) => [m.specification.item_name, m.specification])).values()]
    .filter((spec) => names.has(spec.item_name));
  if (!specs.length) return null;
  return h("div", { class: "preview-block" },
    h("p", { class: "preview-label" }, "같은 제품 다른 로트와 비교"),
    comparePanel({ specs, measurements: productMeasurements, batchId: issue.batch_id, currentNumber: issue.batch.batch_number }));
}

// 이슈 종결 단계: 닫을 수 있는 사람이 아니거나 이미 닫혔을 때 안내
function closePanel(issue) {
  return section("이슈 종결", h("p", { class: "muted" }, issue.status === "closed"
    ? `종결됨 · ${issue.closer?.display_name ?? ""} ${issue.closed_at ? formatDateTime(issue.closed_at) : ""}`
    : "승인된 영향 평가와 끝난 조치가 있으면 배정됐던 담당자 또는 QA 관리자가 종결합니다."));
}

// 내부 출하 검토 단계: 검토는 로트 상세에서 한다 (국가출하승인이 아님)
function releasePanel(issue) {
  const done = issue.batch.status === "releasable" || issue.batch.status === "discarded";
  return section("내부 출하 검토", h("div", { class: "stack" },
    h("p", { class: "muted" }, done
      ? `이 로트는 내부 출하 검토가 끝났습니다 (${batchStatusLabel(issue.batch.status)}).`
      : "로트의 열린 이슈가 모두 종결되고 시험이 끝나면 QA 관리자가 로트 상세에서 내부 출하 검토를 합니다."),
    h("a", { class: "button", href: `#/batches/${issue.batch.id}` }, "로트 상세로 이동")));
}

// FR-002 수용 기준 1·2: 측정값·당시 기준·판정, 공정 이슈면 그 공정 기록
function deviation(issue, opening, processItems) {
  const record = issue.process_record;
  if (issue.source === "process" && record) {
    return h("div", { class: "stack" },
      h("p", null, `${formatDateTime(record.recorded_at)} · ${record.recorder?.display_name ?? ""} · 설비 상태 `,
        badge(record.equipment_status, EQUIPMENT_LABELS[record.equipment_status]),
        record.production_quantity === null ? null : ` · 생산량 ${record.production_quantity}`),
      processItems.length
        ? h("ul", { class: "plain-list" }, ...processItems.map((m) => h("li", null, measurementLine(m))))
        : null);
  }
  if (!opening.length) return h("p", { class: "muted" }, "이탈 측정값을 찾을 수 없습니다.");
  return h("ul", { class: "plain-list" }, ...opening.map((m) => h("li", null,
    measurementLine(m), h("span", { class: "muted" }, ` · ${m.measurer?.display_name ?? ""} · ${formatDateTime(m.measured_at)}`))));
}

function isWorkable(issue) {
  return issue.status === "open" && isBatchEditable(issue.batch.status);
}

function requestActions(profile, issue, summary) {
  if (!isWorkable(issue) || !can(profile.role, "request_action")) return null;
  return h("div", { class: "toolbar" }, h("button", {
    class: "button button--primary",
    type: "button",
    onclick: openSafely(() => openSubmitRequestModal({
      issue, summary, onDone: doneWith("조치 요청을 등록했습니다. QA 관리자의 승인을 기다립니다."),
    })),
  }, "조치 요청 등록"));
}

// spec 023 FR-001: 조치 요청을 만들 수 있는 사람에게만 "AI로 조사 준비". 초안은 기존 조치 요청 창에 채우고 저장은 사람이 한다
function investigate(profile, issue, ai, summary) {
  if (!isWorkable(issue) || !can(profile.role, "request_action")) return null;
  return investigatePanel({
    profile, issue, ctx: ai,
    onUseDraft: (actionType, description) => openSafely(() => openSubmitRequestModal({
      issue, summary, initial: { actionType, description }, onDone: doneWith("조치 요청을 등록했습니다. QA 관리자의 승인을 기다립니다."),
    }))(),
  });
}

function button(label, open, primary) {
  return h("button", { class: primary ? "button button--primary" : "button", type: "button", onclick: openSafely(open) }, label);
}

// FR-004·005·007: 승인 대기면 QA 관리자에게 승인·반려, 반려됨이면 요청자 본인에게 다시 제출, 승인됨이면 담당자에게 결과 입력
function requestButtons(request, { profile, issue, target }) {
  if (!isWorkable(issue)) return null;
  if (canCompleteRequest(request, profile)) {
    return h("div", { class: "toolbar" },
      button("조치 결과 입력", () => openCompleteModal({ request, target, onDone: doneWith("조치 결과를 저장했습니다.") }), true));
  }
  if (request.status === "pending_approval" && can(profile.role, "review_action")) {
    return h("div", { class: "toolbar" },
      button("승인", () => openApproveModal({ request, onDone: doneWith("조치 요청을 승인했습니다.") }), true),
      button("반려", () => openRejectModal({ request, onDone: doneWith("조치 요청을 반려했습니다.") })));
  }
  if (request.status === "rejected" && request.requested_by === profile.id) {
    return h("div", { class: "toolbar" },
      button("다시 제출", () => openResubmitModal({ request, source: issue.source, onDone: doneWith("다시 제출했습니다. QA 관리자의 승인을 기다립니다.") }), true));
  }
  return null;
}

function retestList(retests) {
  return h("ul", { class: "plain-list" }, ...retests.map((m) => h("li", null,
    measurementLine(m), h("span", { class: "muted" }, ` · ${m.measurer?.display_name ?? ""} · ${formatDateTime(m.measured_at)}`))));
}

// FR-008 (spec 002): 닫을 수 있는 사람에게만. 아직 못 닫으면 버튼 대신 이유를 글로 (Q19). 이유는 이슈 종류·평가에 따라 (spec 005 FR-004)
function closeSection(profile, issue, { review, requests }) {
  if (!isWorkable(issue) || !canCloseAs(requests, profile)) return null;
  const reason = closeBlockReason({ issue, review, requests });
  return section("이슈 종결", reason
    ? h("p", { class: "muted" }, reason)
    : h("div", { class: "toolbar" }, button("품질 이슈 종결", () => openCloseIssueModal({ issue, onDone: doneWith() }), true)));
}

function requestList(requests, context) {
  if (!requests.length) return h("p", { class: "muted" }, "아직 조치 요청이 없습니다.");
  return h("ol", { class: "request-list" }, ...requests.map((request) => h("li", { class: "request" },
    h("p", { class: "request-head" },
      h("strong", null, actionTypeLabel(request.action_type)), " ", badge(request.status, actionStatusLabel(request.status)),
      h("span", { class: "muted" }, ` · 요청 ${request.requester?.display_name ?? ""} ${formatDateTime(request.requested_at)}`)),
    ackSlot(request.id),
    request.description ? h("p", null, request.description) : null,
    request.assignee ? h("p", { class: "muted" }, `담당자 ${request.assignee.display_name}`) : null,
    // FR-002 수용 기준 3, UJ E3
    request.status === "rejected" ? h("p", { class: "rejected-reason" }, `반려됨 — 사유: ${request.rejection_reason ?? ""}`) : null,
    request.result_note ? h("p", null, `조치 결과: ${request.result_note}`) : null,
    requestButtons(request, context))));
}

function historyList(history) {
  if (!history.length) return h("p", { class: "muted" }, "아직 업무 이력이 없습니다.");
  return h("ol", { class: "plain-list" }, ...history.map((item) => h("li", null,
    h("span", { class: "muted" }, formatDateTime(item.created_at)), " · ",
    h("strong", null, item.action), " · ", `${item.actor_name} (${roleLabel(item.actor_role)})`)));
}
