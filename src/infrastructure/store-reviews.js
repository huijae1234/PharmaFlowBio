// 기능 005: 품질 영향 평가. 연결과 오류 처리는 store.js와 같다. 쓰기는 데이터베이스 함수로만 (0016_deviation_review.sql)
import { client, read, call } from "./store.js";

const REVIEW_FIELDS = [
  "id, quality_issue_id, status, deviation_summary, probable_cause, impact_assessment, proposed_action, evidence",
  "requested_by, requested_at, reviewed_at, review_comment",
  "requester:requested_by (display_name), reviewer:reviewed_by (display_name)",
].join(", ");

/** FR-001~003 (spec 005): 이슈의 평가 하나. 없으면 null */
export async function getIssueReview(issueId) {
  return read(client.from("deviation_review").select(REVIEW_FIELDS).eq("quality_issue_id", issueId).maybeSingle());
}

/**
 * FR-001: 작성 → 검토 요청
 * @param {string} issueId
 * @param {Record<string, string>} fields deviation_summary, probable_cause, impact_assessment, proposed_action, evidence
 */
export async function submitReview(issueId, fields) {
  return call("submit_deviation_review", { p_issue_id: issueId, p_fields: fields });
}

/** FR-003: 보완 요청·반려된 평가를 고쳐 다시 제출 (요청자 본인) */
export async function resubmitReview(reviewId, fields) {
  return call("resubmit_deviation_review", { p_review_id: reviewId, p_fields: fields });
}

/**
 * FR-002: QA 관리자의 검토
 * @param {{ reviewId: string, decision: "approved" | "rejected" | "revision_requested", reason: string }} input
 */
export async function decideReview({ reviewId, decision, reason }) {
  return call("review_deviation_review", { p_review_id: reviewId, p_decision: decision, p_comment: reason });
}

// 첫 화면·승인 대기 목록용: 평가 + 이슈의 로트번호·이탈 항목
const REVIEW_LIST_FIELDS = [
  "id, status, requested_at, reviewed_at, review_comment",
  "requester:requested_by (display_name)",
  "issue:quality_issue_id (id, batch:batch_id (id, batch_number), process_record:process_record_id (equipment_status), measurements:measurement!measurement_quality_issue_id_fkey (value, result, action_request_id, specification:specification_id (item_name, unit)))",
].join(", ");

/** FR-008 수용 기준 1 (spec 005): 검토를 기다리는 평가, 오래된 순 */
export async function listPendingReviews() {
  return read(client.from("deviation_review").select(REVIEW_LIST_FIELDS).eq("status", "submitted").order("requested_at"));
}

/** FR-008 수용 기준 2: 내가 요청한 평가 중 보완 요청·반려된 것 */
export async function listMyReturnedReviews(userId) {
  return read(client.from("deviation_review").select(REVIEW_LIST_FIELDS)
    .eq("requested_by", userId).in("status", ["rejected", "revision_requested"]).order("reviewed_at", { ascending: false }));
}

/** FR-007: 로트 요약용, 그 로트 이슈들의 평가 상태 (한 번에 읽는다) */
export async function listIssueReviews(issueIds) {
  if (!issueIds.length) return [];
  return read(client.from("deviation_review").select("id, quality_issue_id, status, requester:requested_by (display_name)").in("quality_issue_id", issueIds));
}
