// 품질 영향 평가 규칙 (spec 005). 화면 표시용이다. 실제로 막는 것은 데이터베이스 함수 (supabase/migrations/0016_deviation_review.sql)
import { isBatchEditable } from "./batch-rules.js";
import { openRequestCount } from "./action-rules.js";

const STATUS_LABELS = { submitted: "검토 요청", approved: "승인", rejected: "반려", revision_requested: "보완 요청" };
const WRITER_ROLES = new Set(["qc_analyst", "production_operator", "qa_manager"]);
const RETURNED = new Set(["rejected", "revision_requested"]);
const MAX_LENGTH = 1000;

// ERD deviation_review 칸. 문구의 조사는 칸 이름에 맞춰 둔다
export const REVIEW_FIELDS = [
  { key: "deviation_summary", label: "이탈 내용", object: "이탈 내용을", topic: "이탈 내용은", required: true },
  { key: "probable_cause", label: "추정 원인", object: "추정 원인을", topic: "추정 원인은", required: true },
  { key: "impact_assessment", label: "품질 영향 평가", object: "품질 영향 평가를", topic: "품질 영향 평가는", required: true },
  { key: "proposed_action", label: "제안 후속 조치", object: "제안 후속 조치를", topic: "제안 후속 조치는", required: true },
  { key: "evidence", label: "근거", object: "근거를", topic: "근거는", required: false },
];

/** @param {string} status */
export function reviewStatusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

/**
 * FR-001 수용 기준 2 (spec 005): 필수 4칸, 각 1,000자까지. 공백만은 빈 칸
 * @param {Record<string, string | null | undefined>} values
 * @returns {{ ok: true, value: Record<string, string> } | { ok: false, errors: Record<string, string> }}
 */
export function checkReviewFields(values) {
  const value = {};
  const errors = {};
  for (const field of REVIEW_FIELDS) {
    const text = String(values[field.key] ?? "").trim();
    if (field.required && !text) errors[field.key] = `${field.object} 입력해 주세요.`;
    else if (text.length > MAX_LENGTH) errors[field.key] = `${field.topic} 1,000자까지 입력할 수 있습니다.`;
    value[field.key] = text;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

function isWorkable(issue, batch) {
  return issue?.status === "open" && isBatchEditable(batch?.status);
}

/**
 * FR-001 수용 기준 4·5: 평가가 없는 열린 이슈에 QC·생산·QA가
 * @param {{ issue: { status: string }, review: object | null, batch: { status: string }, profile: { role: string } }} input
 */
export function canWriteReview({ issue, review, batch, profile }) {
  return !review && WRITER_ROLES.has(profile.role) && isWorkable(issue, batch);
}

/**
 * FR-003: 보완 요청·반려된 평가를 요청자 본인만. 검토 요청 중에는 고치지 않는다 (Q34)
 * @param {{ issue: { status: string }, review: { status: string, requested_by: string } | null, batch: { status: string }, profile: { id: string } }} input
 */
export function canResubmit({ issue, review, batch, profile }) {
  return Boolean(review) && RETURNED.has(review.status) && review.requested_by === profile.id && isWorkable(issue, batch);
}

/**
 * FR-002 수용 기준 4·6: 검토 요청 상태를 QA 관리자만. 승인은 최종
 * @param {{ issue: { status: string }, review: { status: string } | null, batch: { status: string }, profile: { role: string } }} input
 */
export function canReview({ issue, review, batch, profile }) {
  return review?.status === "submitted" && profile.role === "qa_manager" && isWorkable(issue, batch);
}

/**
 * FR-004 (spec 005), D8: 닫을 수 없는 이유 (데이터베이스 close_quality_issue와 같은 순서·문구). 닫을 수 있으면 null.
 * 승인 뒤 종류가 규격 이탈로 바뀌어도 평가를 다시 받지 않고 완료된 조치 조건이 더해진다 (Q35)
 * @param {{ issue: { kind: string }, review: { status: string } | null, requests: { status: string }[] }} input
 */
export function closeBlockReason({ issue, review, requests }) {
  if (review?.status !== "approved") return "승인된 품질 영향 평가가 없어 종결할 수 없습니다.";
  if (openRequestCount(requests) > 0) return "끝나지 않은 조치 요청이 있어 종결할 수 없습니다.";
  if (issue.kind === "spec" && !requests.some((request) => request.status === "completed")) {
    return "완료된 조치 요청이 없어 종결할 수 없습니다. 먼저 조치 결과를 넣어 주세요.";
  }
  return null;
}
