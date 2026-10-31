// 출하 판정 규칙 (spec 002 FR-009, Q17). 막는 것은 데이터베이스 함수 decide_release이고, 여기는 화면에 이유를 글로 보이기 위한 같은 규칙이다

const REQUEST_STATUSES = ["pending_approval", "approved", "rejected", "completed"];
// spec 004 FR-008: 관리기준 이탈은 시험 규격 안이다
const WITHIN_SPEC = new Set(["pass", "out_of_alert"]);

/** 시험 항목마다 측정 시각이 가장 늦은 측정값의 판정 (재시험 포함) */
function latestResults(measurements) {
  const latest = new Map();
  for (const measurement of measurements) {
    const current = latest.get(measurement.specification_id);
    if (!current || measurement.measured_at > current.measured_at) latest.set(measurement.specification_id, measurement);
  }
  return latest;
}

/**
 * FR-009 수용 기준 2·4: "출하 가능"을 막는 이유. 비어 있으면 출하 가능을 고를 수 있다
 * @param {{
 *   batch: { status: string, hold_reason: string | null },
 *   openIssueCount: number,
 *   testSpecs: { id: string, item_name: string }[],
 *   measurements: { specification_id: string, result: string, measured_at: string }[],
 * }} input
 * @returns {string[]}
 */
export function releaseBlockers({ batch, openIssueCount, testSpecs, measurements }) {
  const reasons = [];
  if (openIssueCount > 0) reasons.push(`처리 중인 품질 이슈가 ${openIssueCount}건 있어 출하할 수 없습니다.`);
  // ERD Q2: 시험 중이거나, QA 관리자가 직접 보류한 배치만
  const directHold = batch.status === "on_hold" && batch.hold_reason;
  if (batch.status !== "in_testing" && !directHold) reasons.push("시험 중인 로트만 출하할 수 있습니다.");
  const latest = latestResults(measurements);
  const unfinished = testSpecs
    .filter((spec) => !WITHIN_SPEC.has(latest.get(spec.id)?.result))
    .map((spec) => spec.item_name)
    .sort((a, b) => a.localeCompare(b, "ko"));
  if (unfinished.length) reasons.push(`시험이 끝나지 않은 항목이 있습니다: ${unfinished.join(", ")}`);
  return reasons;
}

/**
 * FR-009 수용 기준 1: 배치 상세 위쪽의 조치 요청 상태별 건수
 * @param {{ status: string }[]} requests
 * @returns {Record<string, number>}
 */
export function requestStatusSummary(requests) {
  const summary = Object.fromEntries(REQUEST_STATUSES.map((status) => [status, 0]));
  for (const request of requests) {
    if (request.status in summary) summary[request.status] += 1;
  }
  return summary;
}
