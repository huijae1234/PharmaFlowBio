// 배치 상태를 바꾸는 일은 데이터베이스 함수만 한다 (ERD batch "배치 상태 규칙"). 여기는 표시와 입력 가능 여부만.

const STATUS_LABELS = {
  in_production: "생산 중",
  in_testing: "시험 중",
  on_hold: "보류",
  releasable: "출하 가능",
  discarded: "폐기",
  shipped: "출하 완료", // spec 017 FR-006
};

const EDITABLE_STATUSES = new Set(["in_production", "in_testing", "on_hold"]);

/** FR-008 (spec 001) @param {string} status */
export function batchStatusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

/** Q11: 출하 판정이 끝난 배치는 읽기만 @param {string} status */
export function isBatchEditable(status) {
  return EDITABLE_STATUSES.has(status);
}

/**
 * Q10: 같은 시험 항목은 일반 입력으로 다시 넣지 못하므로 이미 측정한 항목을 표시한다.
 * 재시험 측정값(action_request_id 있음)은 세지 않는다 (데이터베이스 record_test_measurement와 같은 규칙).
 * @param {{ specification_id: string, action_request_id?: string | null }[]} measurements
 * @returns {Set<string>}
 */
export function measuredSpecificationIds(measurements) {
  return new Set(measurements.filter((m) => !m.action_request_id).map((m) => m.specification_id));
}
