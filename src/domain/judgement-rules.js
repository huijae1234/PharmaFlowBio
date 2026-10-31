// 세 단계 판정 표시와 사내 관리기준 입력 검사 (spec 004). 판정 자체는 데이터베이스 함수 private.judge가 한다

const RESULT_LABELS = { pass: "정상", out_of_alert: "관리기준 이탈", out_of_spec: "규격 이탈" };
const ISSUE_KIND_LABELS = { spec: "규격 이탈", alert: "관리기준 이탈" };
/** spec 007 FR-005: 저장 값 open·closed는 그대로, 화면 이름만 */
export const ISSUE_STATUS_LABELS = { open: "처리 중", closed: "종결" };
const ALERT_RANGE_ERROR = "사내 관리기준은 시험 규격 안쪽 범위로, 최솟값과 최댓값을 함께 입력해 주세요.";

/** FR-003 (spec 004) @param {string} result */
export function resultLabel(result) {
  return RESULT_LABELS[result] ?? result;
}

/** FR-005 (spec 004) @param {string} kind */
export function issueKindLabel(kind) {
  return ISSUE_KIND_LABELS[kind] ?? kind;
}

/**
 * FR-001 (spec 004): 관리기준은 둘 다 비우거나, 규격 최솟값 ≤ 관리기준 최솟값 ≤ 관리기준 최댓값 ≤ 규격 최댓값.
 * 데이터베이스 save_specification과 같은 규칙
 * @param {{ min: number, max: number, alertMin?: number | null, alertMax?: number | null }} range 비운 칸은 null 또는 undefined
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkAlertRange({ min, max, alertMin, alertMax }) {
  if (alertMin == null && alertMax == null) return { ok: true };
  const inside = alertMin != null && alertMax != null && min <= alertMin && alertMin <= alertMax && alertMax <= max;
  return inside ? { ok: true } : { ok: false, error: ALERT_RANGE_ERROR };
}

function range(min, max, unit) {
  return unit ? `${min}~${max} ${unit}` : `${min}~${max}`;
}

/**
 * FR-004 (spec 004): "규격 80~125 · 관리기준 90~115 · v2". 측정값이면 판정에 쓴 그때 값(applied_*)을 쓴다
 * @param {Record<string, any>} source 기준 또는 측정값
 * @param {string} [unit]
 */
export function criteriaText(source, unit) {
  const applied = "applied_min_value" in source;
  const pick = (name) => (applied ? source[`applied_${name}`] : source[name]);
  const alertMin = pick("alert_min_value");
  const alert = alertMin === null || alertMin === undefined ? "관리기준 없음" : `관리기준 ${range(alertMin, pick("alert_max_value"), unit)}`;
  const version = applied ? source.applied_spec_version : source.version;
  return `규격 ${range(pick("min_value"), pick("max_value"), unit)} · ${alert} · v${version}`;
}
