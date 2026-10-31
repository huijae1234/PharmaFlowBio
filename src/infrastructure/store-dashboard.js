// 기능 002 6단계: 대시보드 KPI·내 일·전체 업무 이력 읽기. 연결과 오류 처리는 store.js와 같다
import { client, read } from "./store.js";

export const HISTORY_PAGE_SIZE = 50; // FR-013: 최근순 50개씩

const REQUEST_FIELDS = [
  "id, action_type, description, rejection_reason, reviewed_at, requested_at",
  "issue:quality_issue!action_request_quality_issue_id_fkey (id, batch:batch_id (id, batch_number))",
].join(", ");

/** FR-010: KPI·출하 판정 대기 계산용 (이슈 수는 작다) */
export async function listIssueTimes() {
  return read(client.from("quality_issue").select("id, batch_id, status, opened_at, closed_at"));
}

/** FR-010 수용 기준 3: 이번 주 기준 이탈 수 (재시험 이탈 포함) */
export async function countOutOfSpecSince(isoTime) {
  const rows = await read(client.from("measurement").select("id").eq("result", "out_of_spec").gte("measured_at", isoTime));
  return rows.length;
}

/** spec 022 FR-003: 설비 이상(equipment_status = abnormal)으로 기록된 공정 기록, 공정 단계 이름과 함께 (설비 표가 없어 단계 기준) */
export async function listAbnormalEquipment(sinceIso) {
  return read(client.from("process_record").select("batch_id, recorded_at, step_run:step_run_id (step_label)").eq("equipment_status", "abnormal").gte("recorded_at", sinceIso));
}

/** FR-012 수용 기준 1·2: 나에게 배정된 승인된 조치 요청 */
export async function listMyAssigned(userId) {
  return read(client.from("action_request").select(REQUEST_FIELDS)
    .eq("assignee_id", userId).eq("status", "approved").order("reviewed_at"));
}

/** FR-012 수용 기준 3: 내가 낸 요청 중 반려된 것 */
export async function listMyRejected(userId) {
  return read(client.from("action_request").select(REQUEST_FIELDS)
    .eq("requested_by", userId).eq("status", "rejected").order("reviewed_at", { ascending: false }));
}

/** FR-013 수용 기준 2: 배치번호로 거를 때 배치 id 찾기. 없으면 null */
export async function findBatchId(batchNumber) {
  const row = await read(client.from("batch").select("id").eq("batch_number", batchNumber).maybeSingle());
  return row?.id ?? null;
}

/**
 * FR-013: 전체 업무 이력 (RLS: 전체는 QA 관리자만). 한 줄을 더 받아 다음 쪽이 있는지 안다
 * @param {{ actorId?: string, batchId?: string, from?: string | null, to?: string | null, page?: number }} filter
 */
export async function listWorkHistory({ actorId, batchId, from, to, page = 0 }) {
  const start = page * HISTORY_PAGE_SIZE;
  let query = client
    .from("work_history")
    .select("id, actor_name, actor_role, action, created_at, batch:batch_id (batch_number)")
    .order("created_at", { ascending: false })
    .range(start, start + HISTORY_PAGE_SIZE);
  if (actorId) query = query.eq("actor_id", actorId);
  if (batchId) query = query.eq("batch_id", batchId);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);
  const rows = await read(query);
  return { rows: rows.slice(0, HISTORY_PAGE_SIZE), hasMore: rows.length > HISTORY_PAGE_SIZE };
}

export const DEVIATION_FETCH_LIMIT = 500;
export const EQUIPMENT_FETCH_LIMIT = 1000; // PostgREST 기본 최대 행 수로 가정한다(확인하지 못함): 이 수만큼 받았으면 더 있을 수 있다고 본다

/**
 * UI 개편: 이탈 측정값(규격 이탈·관리기준 이탈)의 항목 이름. 홈의 "이탈이 많은 항목" 순위용 (읽기만, 최대 500건, 정렬 없음)
 */
export async function listDeviationMeasurements() {
  return read(
    client
      .from("measurement")
      .select("batch_id, result, specification:specification_id (item_name)")
      .in("result", ["out_of_spec", "out_of_alert"])
      .limit(DEVIATION_FETCH_LIMIT),
  );
}
