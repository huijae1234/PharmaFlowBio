// 기능 010: 작업지시. 연결과 오류 처리는 store.js와 같다. 쓰기는 데이터베이스 함수로만 (0025_work_order.sql)
import { client, read, call } from "./store.js";

const WORK_ORDER_FIELDS = [
  "id, order_number, product_id, planned_quantity, unit, planned_start, planned_end, note, status, batch_id",
  "created_at, released_at, started_at, cancelled_at, cancel_reason",
  "product:product_id (item_name), batch:batch_id (id, batch_number)",
  "creator:created_by (display_name), releaser:released_by (display_name)",
  "starter:started_by (display_name), canceller:cancelled_by (display_name)",
].join(", ");

/** FR-005 (spec 010): 최근 작성 순. 수백 건이라 한 번에 받아 화면에서 거른다 (plan 010 §5 성능) */
export async function listWorkOrders() {
  return read(client.from("work_order").select(WORK_ORDER_FIELDS).order("created_at", { ascending: false }).limit(500));
}

/** 착수 전 예정 로트번호용: 모든 로트의 번호와 제품 (읽기만, 2026-10-29 사용자 요청) */
export async function listLotNumbers() {
  return read(client.from("batch").select("batch_number, product_id").limit(2000));
}

/** spec 021 FR-011: 이 제품의 진행 전·진행 중 작업지시(초안·발행·진행 중)의 계획 기간. 읽기만 한다 */
export async function listProductWorkOrders(productId) {
  return read(client.from("work_order").select("order_number, planned_start, planned_end, status")
    .eq("product_id", productId).in("status", ["draft", "released", "in_progress"]).order("planned_end", { ascending: true }));
}

/** FR-006: 이 로트를 만든 작업지시 (없으면 null) */
export async function getWorkOrderForBatch(batchId) {
  return read(client.from("work_order").select(WORK_ORDER_FIELDS).eq("batch_id", batchId).maybeSingle());
}

/**
 * FR-001: 작성
 * @param {{ product_id: string, planned_quantity: number, unit: string, planned_start: string, planned_end: string, note: string }} input
 */
export async function createWorkOrder(input) {
  return call("create_work_order", { p_input: input });
}

/** FR-002: 발행 (QA 관리자) */
export async function releaseWorkOrder(id) {
  return call("release_work_order", { p_id: id });
}

/** FR-003: 착수 — 로트를 만들고 연결한 작업지시를 돌려준다 */
export async function startWorkOrder(id, batchNumber) {
  return call("start_work_order", { p_id: id, p_batch_number: batchNumber });
}

/** FR-004: 취소 */
export async function cancelWorkOrder(id, reason) {
  return call("cancel_work_order", { p_id: id, p_reason: reason });
}
