// 홈 "지금 할 일" (홈 개편): 승인·검토·조치·보완·착수를 한 목록으로 모은다. 저장하지 않고 이미 읽은 자료로 계산한다.
// 줄 하나: { key, kind, tone, ref, refHref, text, who, at, href, cta } — 그리는 쪽은 src/ui/home-widgets.js
import { actionTypeLabel } from "./action-rules.js";
import { reviewStatusLabel } from "./review-rules.js";
import { periodText, quantityText } from "./work-order-rules.js";

const byOldest = (a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""));
const byNewest = (a, b) => String(b.at ?? "").localeCompare(String(a.at ?? ""));

function lotOf(item) {
  const batch = item.issue?.batch;
  return { ref: batch?.batch_number ?? "", refHref: batch?.id ? `#/batches/${batch.id}` : null };
}

/** QA 관리자: 승인을 기다리는 조치 요청 (오래된 순) @param {object[]} requests */
export function approvalTasks(requests) {
  return requests.map((request) => ({
    key: `request-${request.id ?? request.issue?.id}-${request.requested_at}`,
    kind: "조치 요청 승인", tone: "warning", ...lotOf(request),
    text: actionTypeLabel(request.action_type),
    who: request.requester?.display_name ?? "", at: request.requested_at,
    href: `#/issues/${request.issue?.id}`, cta: "승인·반려",
  })).sort(byOldest);
}

/** QA 관리자: 검토를 기다리는 품질 영향 평가 (오래된 순) @param {object[]} reviews */
export function reviewTasks(reviews) {
  return reviews.map((review) => ({
    key: `review-${review.id ?? review.issue?.id}`,
    kind: "영향 평가 검토", tone: "warning", ...lotOf(review),
    text: "품질 영향 평가",
    who: review.requester?.display_name ?? "", at: review.requested_at,
    href: `#/issues/${review.issue?.id}`, cta: "검토",
  })).sort(byOldest);
}

/** 나에게 배정된 승인된 조치 (오래된 순) @param {object[]} requests */
export function assignedTasks(requests) {
  return requests.map((request) => ({
    key: `assigned-${request.id ?? request.issue?.id}`,
    kind: "조치 결과 입력", tone: "info", ...lotOf(request),
    text: [actionTypeLabel(request.action_type), request.description].filter(Boolean).join(" · "),
    who: "", at: request.reviewed_at,
    href: `#/issues/${request.issue?.id}`, cta: "결과 입력",
  })).sort(byOldest);
}

/** 반려된 내 조치 요청과 보완 요청·반려된 내 평가 (최근 것부터) */
export function returnedTasks(requests, reviews = []) {
  return [
    ...requests.map((request) => ({
      key: `rejected-${request.id ?? request.issue?.id}`,
      kind: "보완 필요", tone: "danger", ...lotOf(request),
      text: `조치 요청 반려${request.rejection_reason ? ` · ${request.rejection_reason}` : ""}`,
      who: "", at: request.reviewed_at, href: `#/issues/${request.issue?.id}`, cta: "고쳐 다시 제출",
    })),
    ...reviews.map((review) => ({
      key: `returned-review-${review.id ?? review.issue?.id}`,
      kind: "보완 필요", tone: "danger", ...lotOf(review),
      text: `영향 평가 ${reviewStatusLabel(review.status)}${review.review_comment ? ` · ${review.review_comment}` : ""}`,
      who: "", at: review.reviewed_at, href: `#/issues/${review.issue?.id}`, cta: "고쳐 다시 제출",
    })),
  ].sort(byNewest);
}

/** QA 관리자: 시험이 끝나 내부 출하 검토를 기다리는 로트 (오래된 순) @param {object[]} batches */
export function releaseTasks(batches) {
  return batches.map((batch) => ({
    key: `release-${batch.id}`,
    kind: "내부 출하 검토", tone: "success", ref: batch.batch_number, refHref: `#/batches/${batch.id}`,
    text: `${batch.product?.item_name ?? ""} · 열린 이슈 없음`, who: "", at: batch.created_at,
    href: `#/batches/${batch.id}`, cta: "검토하기",
  })).sort(byOldest);
}

/** 생산 담당자: 착수할 작업지시 (계획 시작일 순은 호출하는 쪽이 이미 맞춰 준다) @param {object[]} orders */
export function orderTasks(orders) {
  return orders.map((order) => ({
    key: `order-${order.order_number}`,
    kind: "작업지시 착수", tone: "info", ref: order.order_number, refHref: null,
    text: `${order.product?.item_name ?? ""} · ${quantityText(order)} · 시작 ${periodText(order)}`,
    who: "", at: null, href: `#/work-orders?q=${encodeURIComponent(order.order_number)}`, cta: "착수하러 가기",
  }));
}

/** 생산 담당자: 진행 중인 공정 단계 (착수한 지 오래된 순) @param {object[]} runs */
export function stepTasks(runs) {
  return runs.map((run) => ({
    key: `step-${run.batch?.id}-${run.step_label}`,
    kind: "공정 단계 진행 중", tone: "info", ref: run.batch?.batch_number ?? "", refHref: `#/batches/${run.batch?.id}?tab=process`,
    text: `${run.batch?.product?.item_name ?? ""} · ${run.step_label}`,
    who: run.starter?.display_name ?? "", at: run.started_at,
    href: `#/batches/${run.batch?.id}?tab=process`, cta: "단계 열기",
  })).sort(byOldest);
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const LATE_DAYS = 7; // PRD FR-38: 승인 대기·승인됨이 7일을 넘으면 지연

/**
 * 기다린 날수 ("3일째", 7일 이상이면 late). 시각이 없거나 읽을 수 없으면 null
 * @param {string | null | undefined} iso
 * @param {Date} [now]
 */
export function ageInfo(iso, now = new Date()) {
  const time = Date.parse(iso ?? "");
  if (!Number.isFinite(time)) return null;
  const days = Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
  return { days, text: days < 1 ? "오늘" : `${days}일째`, late: days >= LATE_DAYS };
}

/** 여러 종류를 섞은 목록을 오래된 것부터 (시각이 없는 줄은 맨 뒤, 원래 순서 유지) */
export function oldestFirst(tasks) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => (a.task.at && b.task.at ? a.task.at.localeCompare(b.task.at) : a.task.at ? -1 : b.task.at ? 1 : 0) || a.index - b.index)
    .map(({ task }) => task);
}

/** 종류별 건수: [["조치 요청 승인", 2], ["내부 출하 검토", 1]] — 목록 위 요약 칩 */
export function countByKind(tasks) {
  const counts = new Map();
  for (const task of tasks) counts.set(task.kind, (counts.get(task.kind) ?? 0) + 1);
  return [...counts.entries()];
}

const STATUS_ORDER = ["in_production", "in_testing", "on_hold", "releasable", "shipped", "discarded"]; // spec 017: 출하 완료

/**
 * 로트 상태 막대: 0건 상태는 막대에서 빼고, 범례에는 모두 둔다. 비율은 퍼센트 (합 100)
 * @param {Record<string, number>} counts
 */
export function statusSegments(counts) {
  const total = STATUS_ORDER.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
  return STATUS_ORDER.map((status) => {
    const count = counts[status] ?? 0;
    return { status, count, percent: total ? (count / total) * 100 : 0 };
  });
}

/**
 * 보류 로트 한 줄 설명: 직접 보류 사유, 또는 열린 이슈 수와 가장 오래된 이슈가 열린 지 며칠째인지
 * @param {{ id: string, hold_reason?: string | null }} batch
 * @param {{ batch_id: string, status: string, opened_at: string }[]} issues
 * @param {Date} [now]
 */
export function holdSummary(batch, issues, now = new Date()) {
  const open = issues.filter((issue) => issue.batch_id === batch.id && issue.status === "open");
  const parts = [];
  if (open.length) {
    const oldest = open.map((issue) => issue.opened_at).sort()[0];
    parts.push(`열린 이슈 ${open.length}건 · ${ageInfo(oldest, now)?.text ?? ""}`);
  }
  if (batch.hold_reason) parts.push(`사유: ${batch.hold_reason}`);
  return parts.join(" · ");
}

/**
 * 보류 로트의 "지금 누가 풀어야 하나": 가장 오래된 열린 이슈부터 보고, 처음 찾은 기다리는 일의 담당을 한 줄로.
 * 평가가 검토 요청이면 QA, 되돌려졌으면 요청자, 조치 요청이 승인 대기면 QA, 승인됐으면 담당자. 모르면 빈 글자
 * @param {{ id: string }} batch
 * @param {{ id: string, batch_id: string, status: string, opened_at: string }[]} issues
 * @param {{ quality_issue_id: string, status: string, assignee?: { display_name: string } | null }[]} requests
 * @param {{ quality_issue_id: string, status: string, requester?: { display_name: string } | null }[]} reviews
 */
export function holdOwner(batch, issues, requests, reviews) {
  const open = issues
    .filter((issue) => issue.batch_id === batch.id && issue.status === "open")
    .sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)));
  for (const issue of open) {
    const review = reviews.find((item) => item.quality_issue_id === issue.id);
    if (review?.status === "submitted") return "QA 평가 검토 대기";
    if (review && (review.status === "rejected" || review.status === "revision_requested")) return `${review.requester?.display_name ?? "요청자"} 평가 보완 필요`;
    const request = requests.find((item) => item.quality_issue_id === issue.id);
    if (request?.status === "pending_approval") return "QA 조치 요청 승인 대기";
    if (request?.status === "approved") return `${request.assignee?.display_name ?? "담당자"} 조치 결과 입력`;
    if (request?.status === "rejected") return "조치 요청 다시 제출 필요";
  }
  return "";
}
