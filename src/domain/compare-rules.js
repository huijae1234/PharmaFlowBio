// 비교와 위치 (UI 개편): 같은 제품 다른 로트의 값 비교, 기준 안에서의 위치, 입력 중 판정 미리보기.
// 저장하지 않고 이미 읽은 측정값으로 계산한다. 최종 판정은 데이터베이스 함수 private.judge가 한다 (미리보기는 같은 규칙: 경계값은 범위 안)

/**
 * 같은 항목의 로트별 가장 최근 측정값 (재시험 포함 최신). 최근 측정순
 * @param {{ batch: { id: string, batch_number: string, status: string } | null, specification: { item_name: string } | null, value: number, result: string, measured_at: string }[]} rows
 * @param {string} itemName
 * @returns {{ batchId: string, batchNumber: string, status: string, value: number, result: string, measuredAt: string }[]}
 */
export function latestByLot(rows, itemName) {
  const latest = new Map();
  for (const row of rows) {
    if (!row.batch || row.specification?.item_name !== itemName) continue;
    const current = latest.get(row.batch.id);
    if (!current || row.measured_at > current.measuredAt) {
      latest.set(row.batch.id, {
        batchId: row.batch.id, batchNumber: row.batch.batch_number, status: row.batch.status,
        value: Number(row.value), result: row.result, measuredAt: row.measured_at,
      });
    }
  }
  return [...latest.values()].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
}

/**
 * 비교 줄: 최근 로트 limit개 (지금 로트는 항상 포함, 표시용 isCurrent). 최근 측정순
 * @param {Parameters<typeof latestByLot>[0]} rows
 * @param {string} itemName
 * @param {string} currentBatchId
 */
export function siblingRows(rows, itemName, currentBatchId, limit = 6) {
  const all = latestByLot(rows, itemName);
  let shown = all.slice(0, limit);
  const current = all.find((row) => row.batchId === currentBatchId);
  if (current && !shown.some((row) => row.batchId === currentBatchId)) shown = [...shown.slice(0, limit - 1), current];
  return shown
    .map((row) => ({ ...row, isCurrent: row.batchId === currentBatchId }))
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
}

/**
 * 범위 막대 모양: 축은 규격 앞뒤로 10%씩 여유를 두고, 값이 그 밖이면 값까지 넓힌다. 위치는 0~100(%)
 * @param {{ min: number, max: number, alertMin?: number | null, alertMax?: number | null }} range
 * @param {number[]} [values]
 */
export function rangeModel({ min, max, alertMin = null, alertMax = null }, values = []) {
  const span = Math.max(max - min, Number.EPSILON);
  const pad = span * 0.1;
  const axisMin = Math.min(min - pad, ...values.map((v) => v - pad));
  const axisMax = Math.max(max + pad, ...values.map((v) => v + pad));
  const at = (value) => Math.min(100, Math.max(0, ((value - axisMin) / (axisMax - axisMin)) * 100));
  return {
    axisMin, axisMax, at,
    spec: { from: at(min), to: at(max) },
    alert: alertMin !== null && alertMax !== null && alertMin !== undefined && alertMax !== undefined ? { from: at(alertMin), to: at(alertMax) } : null,
  };
}

/**
 * 입력 중 판정 미리보기: 규격 밖 → out_of_spec, 규격 안인데 관리기준 밖 → out_of_alert, 나머지 → pass. 경계값은 범위 안
 * @param {number} value
 * @param {{ min_value: number, max_value: number, alert_min_value?: number | null, alert_max_value?: number | null }} spec
 */
export function previewResult(value, spec) {
  if (value < Number(spec.min_value) || value > Number(spec.max_value)) return "out_of_spec";
  const hasAlert = spec.alert_min_value !== null && spec.alert_min_value !== undefined && spec.alert_max_value !== null && spec.alert_max_value !== undefined;
  if (hasAlert && (value < Number(spec.alert_min_value) || value > Number(spec.alert_max_value))) return "out_of_alert";
  return "pass";
}

/**
 * 기준을 바꾸면 판정이 달라지는 로트 (기준 수정 창의 영향 미리보기). 로트마다 그 항목의 가장 최근 값만 본다.
 * 이미 저장된 판정은 바뀌지 않는다 (측정값에는 판정 당시 기준이 남는다): 참고용
 * @param {{ batch: { id: string, batch_number: string } | null, specification_id: string, value: number, result: string, measured_at: string }[]} rows
 * @param {string} specId
 * @param {{ min_value: number, max_value: number, alert_min_value?: number | null, alert_max_value?: number | null }} nextSpec
 * @param {typeof nextSpec | null} [currentSpec] 지금 저장된 기준. 있으면 "지금 기준으로 본 판정"과 비교한다 (측정 뒤에 기준 버전이 바뀐 값이 값을 안 고쳐도 달라진 것으로 나오지 않게)
 * @returns {{ batchId: string, batchNumber: string, value: number, from: string, to: string }[]} 최근 측정순
 */
export function affectedLots(rows, specId, nextSpec, currentSpec = null) {
  const latest = new Map();
  for (const row of rows) {
    if (!row.batch || row.specification_id !== specId) continue;
    const current = latest.get(row.batch.id);
    if (!current || row.measured_at > current.measured_at) latest.set(row.batch.id, row);
  }
  return [...latest.values()]
    .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
    .map((row) => ({ batchId: row.batch.id, batchNumber: row.batch.batch_number, value: Number(row.value), from: currentSpec ? previewResult(Number(row.value), currentSpec) : row.result, to: previewResult(Number(row.value), nextSpec) }))
    .filter((entry) => entry.from !== entry.to);
}
