// 품질 이슈 화면 공통 조각: 이탈 요약, 측정값 한 줄(당시 기준 포함, Q16), 이슈 종류 배지
import { h, badge } from "./dom.js";
import { criteriaText, issueKindLabel, resultLabel } from "../domain/judgement-rules.js";

/** "규격 98~102 % · 관리기준 없음 · v1" — 판정에 쓴 그때 기준과 버전 (spec 004 FR-004) */
export function appliedRange(measurement) {
  return criteriaText(measurement, measurement.specification?.unit);
}

/** 품질 이슈 종류: 규격 이탈 / 관리기준 이탈 (spec 004 FR-005) */
export function issueKindBadge(issue) {
  const node = badge(issue.kind, issueKindLabel(issue.kind));
  node.title = KIND_HELP[issue.kind] ?? ""; // 처음 쓰는 사람을 위한 한 줄 설명 (마우스를 올리면)
  return node;
}

/** 두 이탈 종류의 차이 한 줄: 목록 위 범례와 배지 설명에 같이 쓴다 */
export const KIND_HELP = {
  spec: "규격 이탈: 시험 규격을 벗어남. 로트가 자동으로 보류됩니다 (OOS)",
  alert: "관리기준 이탈: 규격 안이지만 사내 관리기준을 벗어남. 이슈만 열리고 로트는 보류되지 않습니다",
};

/** 측정값 한 줄: 판정 배지 + 항목 값 + (당시 기준) */
export function measurementLine(measurement) {
  return h("span", null,
    badge(measurement.result, resultLabel(measurement.result)), " ",
    `${measurement.specification.item_name} ${measurement.value}${measurement.specification.unit ?? ""}`,
    h("span", { class: "muted" }, ` (${appliedRange(measurement)})`));
}

/**
 * 목록용 이탈 요약: 처음 이탈 측정값들(규격·관리기준), 공정 이슈면 설비 이상도
 * @param {{ measurements?: object[], process_record?: { equipment_status: string } | null }} issue
 */
export function issueSummaryText(issue) {
  const parts = (issue.measurements ?? [])
    .filter((m) => !m.action_request_id && m.result !== "pass")
    .map((m) => `${m.specification.item_name} ${m.value}${m.specification.unit ?? ""}`);
  if (issue.process_record?.equipment_status === "abnormal") parts.push("설비 상태 이상");
  return parts.join(", ") || "-";
}
