// 기능 002: 품질 이슈·조치 요청·출하 판정. 연결과 오류 처리는 store.js와 같다 (Supabase를 부르는 곳은 infrastructure 폴더뿐)
import { client, read, call } from "./store.js";

// 이슈 ↔ 조치 요청은 직접 연결과 measurement를 거친 연결이 둘 다 있어 외래 키 이름을 적는다
const ISSUE_LIST_FIELDS = [
  "id, source, kind, status, opened_at, closed_at",
  "batch:batch_id (id, batch_number)",
  "measurements:measurement!measurement_quality_issue_id_fkey (value, result, action_request_id, specification:specification_id (item_name, unit))",
  "requests:action_request!action_request_quality_issue_id_fkey (status)",
  "process_record:process_record_id (equipment_status)",
].join(", ");

/**
 * FR-001: 최근순, 열림/닫힘·발생 구분·종류(spec 004 FR-005)로 거르기
 * @param {{ status?: string, source?: string, kind?: string }} [filter]
 */
export async function listIssues({ status, source, kind, oldestFirst = false } = {}) {
  // oldestFirst: 오래된 순은 서버에서 정렬한다 (최근 50건만 받아 뒤집으면 진짜 오래된 이슈가 빠진다)
  let query = client.from("quality_issue").select(ISSUE_LIST_FIELDS).order("opened_at", { ascending: oldestFirst }).limit(50);
  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (kind) query = query.eq("kind", kind);
  return read(query);
}

/** FR-002: 이슈와 배치, 공정 이슈면 그 공정 기록 (Q15) */
export async function getIssue(issueId) {
  return read(
    client
      .from("quality_issue")
      .select("id, source, kind, status, opened_at, closed_at, batch_id, process_record_id, closer:closed_by (display_name), batch:batch_id (id, batch_number, status, product_id, product:product_id (item_name)), process_record:process_record_id (id, recorded_at, equipment_status, production_quantity, recorder:recorded_by (display_name))")
      .eq("id", issueId)
      .maybeSingle(),
  );
}

/** 이슈에 붙은 측정값(처음 기준 이탈, 재시험)과 공정 이슈의 그 공정 기록 측정값. 당시 기준 포함 (Q16) */
export async function listIssueMeasurements(issue) {
  const filters = [`quality_issue_id.eq.${issue.id}`];
  if (issue.process_record_id) filters.push(`process_record_id.eq.${issue.process_record_id}`);
  return read(
    client
      .from("measurement")
      .select("id, value, result, measured_at, action_request_id, process_record_id, quality_issue_id, applied_min_value, applied_max_value, applied_alert_min_value, applied_alert_max_value, applied_spec_version, specification:specification_id (item_name, unit, min_value, max_value, alert_min_value, alert_max_value, version), measurer:measured_by (display_name)")
      .or(filters.join(","))
      .order("measured_at"),
  );
}

export async function listActionRequests(issueId) {
  return read(
    client
      .from("action_request")
      .select("id, quality_issue_id, action_type, description, status, requested_at, requested_by, assignee_id, reviewed_at, rejection_reason, result_note, completed_at, requester:requested_by (display_name), assignee:assignee_id (display_name), reviewer:reviewed_by (display_name)")
      .eq("quality_issue_id", issueId)
      .order("requested_at"),
  );
}

/** 이 이슈에 관한 업무 이력: 이슈·조치 요청·측정값 행이 대상인 것 */
export async function listIssueHistory(batchId, targetIds) {
  if (!targetIds.length) return [];
  return read(
    client
      .from("work_history")
      .select("id, actor_name, actor_role, action, created_at")
      .eq("batch_id", batchId)
      .in("target_id", targetIds)
      .order("created_at", { ascending: false }),
  );
}

/** FR-003: 조치 요청 등록 */
export async function submitActionRequest(issueId, actionType, description) {
  return call("submit_action_request", { p_issue_id: issueId, p_action_type: actionType, p_description: description });
}

/** FR-004: 승인과 담당자 배정 (QA 관리자) */
export async function approveActionRequest(requestId, assigneeId) {
  return call("approve_action_request", { p_request_id: requestId, p_assignee_id: assigneeId });
}

/** FR-005: 반려 (QA 관리자, 사유 필수) */
export async function rejectActionRequest(requestId, reason) {
  return call("reject_action_request", { p_request_id: requestId, p_reason: reason });
}

/** FR-005 수용 기준 3: 요청자가 고쳐 다시 제출 (Q21: 종류와 내용) */
export async function resubmitActionRequest(requestId, actionType, description) {
  return call("resubmit_action_request", { p_request_id: requestId, p_action_type: actionType, p_description: description });
}

/** FR-011: 승인 대기 요청 전체, 오래된 순 */
export async function listPendingRequests() {
  return read(
    client
      .from("action_request")
      .select([
        "id, action_type, description, requested_at",
        "requester:requested_by (display_name)",
        "issue:quality_issue!action_request_quality_issue_id_fkey (id, batch:batch_id (id, batch_number), process_record:process_record_id (equipment_status), measurements:measurement!measurement_quality_issue_id_fkey (value, result, action_request_id, specification:specification_id (item_name, unit)))",
      ].join(", "))
      .eq("status", "pending_approval")
      .order("requested_at"),
  );
}

/** FR-007: 조치 결과. 재시험이면 측정값을 함께 (판정은 데이터베이스가 지금 기준으로) */
export async function completeActionRequest(requestId, resultNote, retestValue) {
  return call("complete_action_request", { p_request_id: requestId, p_result_note: resultNote, p_retest_value: retestValue });
}

/** FR-008: 품질 이슈 닫기. 마지막 열린 이슈면 배치 보류가 풀릴 수 있다 (Q2) */
export async function closeQualityIssue(issueId) {
  return call("close_quality_issue", { p_issue_id: issueId });
}

/** FR-009 수용 기준 1: 이 배치 이슈들의 조치 요청 상태 (배치 상세 위쪽 요약) */
export async function listBatchRequests(issueIds) {
  if (!issueIds.length) return [];
  // spec 005 FR-007: 로트 요약의 다음에 할 일에 이슈별 요청과 담당자가 필요하다
  return read(client.from("action_request").select("id, status, quality_issue_id, assignee:assignee_id (display_name)").in("quality_issue_id", issueIds));
}

/** FR-009: 출하 판정 (QA 관리자). decision은 "releasable" 또는 "discarded" */
export async function decideRelease(batchId, decision, reason = "") {
  const args = { p_batch_id: batchId, p_decision: decision };
  // 0035_release_reason: 폐기는 사유가 필수. 사유가 없으면 보내지 않아서 0035를 적용하기 전의 함수로도 출하 가능은 그대로 동작한다
  if (reason.trim()) args.p_reason = reason.trim();
  return call("decide_release", args);
}

/** spec 017 FR-005: 출하 완료 기록 (생산 담당자). 출하 가능 로트만, 판정 시각·역할은 데이터베이스가 확인 */
export async function shipBatch(batchId, { shippedAt, note }) {
  return call("ship_batch", { p_batch_id: batchId, p_shipped_at: shippedAt, p_note: note });
}
