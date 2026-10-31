// 기능 011: 공정 단계 실행. 연결과 오류 처리는 store.js와 같다. 쓰기는 데이터베이스 함수로만 (0028_process_steps.sql)
import { client, read, call } from "./store.js";

const RUN_FIELDS = "id, batch_id, process_step_id, status, step_label, line_clearance, started_at, completed_at, "
  + "starter:started_by (display_name), completer:completed_by (display_name)";

/** FR-001: 제품의 공정 단계 (쓰지 않음 포함, 순서대로) */
export async function listProcessSteps(productId) {
  return read(client.from("process_step").select("id, product_id, step_order, name, retired_at")
    .eq("product_id", productId).order("step_order"));
}

/** FR-003: 로트의 단계 실행 기록 */
export async function listStepRuns(batchId) {
  return read(client.from("step_run").select(RUN_FIELDS).eq("batch_id", batchId).order("started_at"));
}

/** FR-007: 진행 중 단계 (제조공정 홈) */
export async function listRunningSteps() {
  return read(client.from("step_run")
    .select("id, step_label, started_at, starter:started_by (display_name), batch:batch_id (id, batch_number, product:product_id (item_name))")
    .eq("status", "in_progress").order("started_at"));
}

/** FR-001: 등록(id 없음)·이름 바꾸기 */
export async function saveProcessStep({ id = null, productId, name }) {
  return call("save_process_step", { p_id: id, p_product_id: productId, p_name: name });
}

/** FR-001: "up" | "down" */
export async function moveProcessStep(id, direction) {
  return call("move_process_step", { p_id: id, p_direction: direction });
}

export async function retireProcessStep(id) {
  return call("retire_process_step", { p_id: id });
}

/** FR-002: 공정 기준을 단계에 잇기 (stepId 없으면 미지정) */
export async function setSpecificationStep(specificationId, stepId) {
  return call("set_specification_step", { p_specification_id: specificationId, p_step_id: stepId || null });
}

/** FR-004: 착수 (라인 클리어런스 확인한 항목 key 목록) */
export async function startStep(batchId, stepId, clearanceKeys) {
  return call("start_step", { p_batch_id: batchId, p_step_id: stepId, p_clearance: clearanceKeys });
}

/**
 * FR-005: 완료 — 그 단계 기준 값, 설비 상태, 생산량(선택)
 * @param {{ runId: string, productionQuantity: number | null, equipmentStatus: string, values: { specification_id: string, value: number }[] }} input
 */
export async function completeStep({ runId, productionQuantity, equipmentStatus, values }) {
  return call("complete_step", {
    p_step_run_id: runId, p_production_quantity: productionQuantity, p_equipment_status: equipmentStatus, p_values: values,
  });
}
