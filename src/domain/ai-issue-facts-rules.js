// 이슈 한 건에 대한 AI 칸의 근거 표 (spec 023 FR-001, 평가서·조치 후 확인도 같은 줄을 쓴다). 순수 함수: 화면·저장·네트워크를 부르지 않는다.
// 줄 세 상태는 spec 022와 같다: ok 값이 있다 · none 자료가 없다(0이 아니다) · failed 못 읽었다. 사람 이름은 넣지 않는다(Claude에 이름을 보내지 않는다).
import { cleanText, daysSince, fact } from "./ai-facts-rules.js";
import { actionStatusLabel, actionTypeLabel, issueSourceLabel } from "./action-rules.js";
import { criteriaText, issueKindLabel, resultLabel } from "./judgement-rules.js";
import { REVIEW_FIELDS, reviewStatusLabel } from "./review-rules.js";

export const EQUIPMENT_LABELS = { normal: "정상", abnormal: "이상" };
export const IN_PROGRESS = ["pending_approval", "approved"]; // 아직 끝나지 않은 조치 요청: 같은 요청을 또 하지 않게 먼저 보인다
const SHOWN = 5;
const dateText = (iso) => String(iso ?? "").slice(0, 10);

const measureText = (m) => `${m.specification.item_name} ${m.value}${m.specification.unit ?? ""} · ${resultLabel(m.result)} · 그때 기준 ${criteriaText(m, m.specification.unit)}`;

/** 이슈 화면과 같은 구분: 처음 이탈 측정값 · 공정 기록의 공정 조건 측정값 · 조치로 넣은 재시험 */
export function splitMeasurements(issue, measurements) {
  return {
    opening: measurements.filter((m) => m.quality_issue_id === issue.id && !m.action_request_id),
    processItems: measurements.filter((m) => issue.process_record_id && m.process_record_id === issue.process_record_id),
    retests: measurements.filter((m) => m.action_request_id),
  };
}

/** 이슈 한 줄: 로트·제품·종류·발생 구분·경과 */
export function issueRow(issue, now) {
  const days = daysSince(issue.opened_at, now);
  const when = issue.status === "open" ? (days === null ? null : `열린 지 ${days}일째`) : "종결됨";
  return fact("issue", "품질 이슈", [`로트 ${issue.batch.batch_number}`, cleanText(issue.batch.product?.item_name, 60), issueKindLabel(issue.kind), `${issueSourceLabel(issue.source)} 이슈`, when].filter(Boolean).join(" · "));
}

/** 이탈 측정값·공정 조건 측정값·재시험 결과 (당시 기준과 버전 포함). 이탈 값이 하나도 없으면 "자료 없음" 줄 */
export function measurementRows({ opening, processItems, retests }) {
  const list = (items, prefix, label) => items.slice(0, SHOWN).map((m, index) => fact(`${prefix}_${index + 1}`, `${label} ${index + 1}`, measureText(m)));
  const rows = [...list(opening, "dev", "이탈 측정값"), ...list(processItems, "proc", "공정 조건 측정값"), ...list(retests, "retest", "재시험 결과")];
  return opening.length || processItems.length ? rows : [fact("dev", "이탈 측정값", "이 이슈에 연결된 측정값이 없습니다(설비 상태만 기록되었을 수 있음)", { state: "none" }), ...rows];
}

/**
 * 연결된 공정 기록과 설비 정상/이상. 설비 식별 정보(번호·이름)는 앱에 없어 특정 설비를 가리킬 수 없다.
 * stepLabel: 단계 이름 / null 단계 연결 없음 / undefined 읽지 않음(줄을 만들지 않는다)
 */
export function processRows(issue, stepLabel) {
  if (issue.source !== "process") return [fact("process", "연결된 공정 기록", "시험 이슈라 공정 기록과 연결하지 않습니다")];
  const record = issue.process_record;
  if (!record) return [fact("process", "연결된 공정 기록", "공정 기록을 읽지 못했습니다(알 수 없음)", { state: "failed" })];
  const quantity = record.production_quantity === null || record.production_quantity === undefined ? "" : ` · 생산량 ${record.production_quantity}`;
  return [
    fact("process", "연결된 공정 기록", `${dateText(record.recorded_at)} · 설비 상태 ${EQUIPMENT_LABELS[record.equipment_status] ?? record.equipment_status}${quantity}`),
    ...(stepLabel === undefined ? [] : [fact("step", "공정 단계", stepLabel ?? "단계 연결이 없습니다", { state: stepLabel ? "ok" : "none", ask: !stepLabel })]),
  ];
}

/** 조치 요청: 진행 중인 것을 먼저, 꼭 인용할 줄로. null이면 못 읽음 */
export function requestRows(requests, now) {
  if (requests === null) return [fact("req", "조치 요청", "못 읽었습니다(알 수 없음)", { state: "failed" })];
  if (!requests.length) return [fact("req_none", "조치 요청", "아직 없습니다(0건)")];
  const ordered = [...requests].sort((a, b) => Number(IN_PROGRESS.includes(b.status)) - Number(IN_PROGRESS.includes(a.status)) || String(b.requested_at).localeCompare(String(a.requested_at)));
  return ordered.slice(0, 4).map((request, index) => {
    const days = daysSince(request.requested_at, now);
    const result = request.status === "completed" ? (request.result_note ? "결과 글 기록됨" : "결과 글 없음") : null;
    return fact(`req_${index + 1}`, `조치 요청 ${index + 1}`,
      [actionTypeLabel(request.action_type), actionStatusLabel(request.status), days === null ? null : `요청 ${days}일 전`, result].filter(Boolean).join(" · "), { must: IN_PROGRESS.includes(request.status) });
  });
}

/** 평가서가 있는지·상태·어느 칸이 찼는지 (글 내용은 보내지 않는다). review가 null이면 읽었고 아직 없는 것, 못 읽었으면 failed를 true로 */
function reviewRow(review, failed) {
  if (failed) return fact("review", "품질 영향 평가서", "못 읽었습니다(알 수 없음)", { state: "failed" });
  if (!review) return fact("review", "품질 영향 평가서", "아직 작성하지 않았습니다", { ask: true });
  const fields = REVIEW_FIELDS.map((spec) => `${spec.label} ${String(review[spec.key] ?? "").trim() ? "작성됨" : "비어 있음"}`);
  return fact("review", "품질 영향 평가서", [reviewStatusLabel(review.status), ...fields].join(" · "));
}

/**
 * FR-001 조사 준비 근거 표. 조치 종류(actionType)는 사용자가 고른 것이고, 같은 종류의 진행 중 요청이 있으면 꼭 인용할 줄로 알린다
 * @param {{ issue: object, opening: object[], processItems: object[], retests: object[], review: object | null, reviewFailed?: boolean,
 *   requests: object[] | null, stepLabel?: string | null, actionType: string, now?: Date }} input
 */
export function issueFacts({ issue, opening, processItems, retests, review, reviewFailed = false, requests, stepLabel, actionType, now = new Date() }) {
  const duplicate = (requests ?? []).find((request) => request.action_type === actionType && IN_PROGRESS.includes(request.status));
  return {
    asOf: now.toISOString(),
    rows: [
      issueRow(issue, now),
      ...measurementRows({ opening, processItems, retests }),
      ...processRows(issue, stepLabel),
      reviewRow(review, reviewFailed),
      ...requestRows(requests, now),
      fact("want", "사용자가 고른 조치 종류", actionTypeLabel(actionType)),
      ...(duplicate ? [fact("dup", "같은 종류의 진행 중 요청", `${actionTypeLabel(actionType)} 요청이 이미 ${actionStatusLabel(duplicate.status)} 상태입니다`, { must: true })] : []),
    ],
    limits: [
      "원인과 수리 방법은 이 자료로 알 수 없습니다.",
      "설비 번호·이름 같은 식별 정보가 이 앱에 없어 특정 설비를 지목할 수 없습니다.",
      "평가서·조치 요청의 글 내용은 보내지 않고 상태만 봅니다. 이미 기록된 내용은 다시 묻지 않습니다.",
      "AI 초안은 저장되지 않습니다. 사람이 고치고 기존 '요청' 버튼을 눌러야 저장됩니다.",
      ...(requests && requests.length > 4 ? ["조치 요청은 최근 4건만 보냅니다."] : []),
    ],
  };
}
