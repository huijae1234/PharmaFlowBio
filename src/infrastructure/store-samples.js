// 기능 008: 검체 인계. 연결과 오류 처리는 store.js와 같다. 쓰기는 데이터베이스 함수로만 (0019_sample_transfer.sql)
import { client, read, call } from "./store.js";

const SAMPLE_FIELDS = [
  "id, batch_id, sample_kind, from_team, to_team, quantity, unit, note, status",
  "sent_at, received_at, storage_location, returned_quantity, return_requested_at, returned_at, consumed_at",
  "disposed_at, disposed_quantity, dispose_note", // spec 018 FR-004
  "batch:batch_id (id, batch_number, product:product_id (item_name))",
  "sender:sent_by (display_name), receiver:received_by (display_name)",
  "returner:return_requested_by (display_name), return_confirmer:return_confirmed_by (display_name), consumer:consumed_by (display_name)",
  "disposer:disposed_by (display_name)",
].join(", ");

/** FR-005 (spec 008): 검체 기록 최근 순. 수백 건이라 한 번에 받아 화면에서 거른다 (plan 008 §5 성능) */
export async function listSamples() {
  return read(client.from("sample_transfer").select(SAMPLE_FIELDS).order("sent_at", { ascending: false }).limit(500));
}

/** FR-006: 한 로트의 검체 기록 */
export async function listBatchSamples(batchId) {
  return read(client.from("sample_transfer").select(SAMPLE_FIELDS).eq("batch_id", batchId).order("sent_at", { ascending: false }));
}

/**
 * FR-001: 검체 전달 등록
 * @param {string} batchId
 * @param {{ from_team: string, to_team: string, sample_kind: string, quantity: number, unit: string, note: string }} input
 */
export async function sendSample(batchId, input) {
  return call("send_sample", { p_batch: batchId, p_input: input });
}

/** FR-002: 인수 확인 */
export async function receiveSample(id, location) {
  return call("receive_sample", { p_id: id, p_location: location });
}

/** FR-003: 반납 */
export async function returnSample(id, quantity) {
  return call("return_sample", { p_id: id, p_quantity: quantity });
}

/** FR-003: 반납 확인 */
export async function confirmSampleReturn(id) {
  return call("confirm_sample_return", { p_id: id });
}

/** FR-004: 소진 */
export async function consumeSample(id) {
  return call("consume_sample", { p_id: id });
}

/**
 * spec 018 FR-004: 보존 검체 폐기 (QA 관리자). 결과 { disposed_quantity }
 * @param {string} id
 * @param {{ disposedAt: string, note: string | null }} input
 */
export async function disposeSample(id, { disposedAt, note }) {
  return call("dispose_sample", { p_id: id, p_disposed_at: disposedAt, p_note: note });
}
