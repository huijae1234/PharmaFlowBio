// IA BT_010201_TB 로트 상세 "공정 단계" 탭 (spec 011 FR-003). 단계마다 상태·라인 클리어런스·착수·완료·값과 판정
import { h, badge, formatDateTime } from "../dom.js";
import { measurementLine } from "../issue-views.js";
import { openCompleteStepModal, openStartStepModal } from "./process-step-modals.js";
import { can } from "../../domain/roles.js";
import { STEP_STATUS_LABELS, specsForStep, splitStepLabel } from "../../domain/process-step-rules.js";
import { listProcessRecords, listSpecifications } from "../../infrastructure/store.js";

const EQUIPMENT_LABELS = { normal: "정상", abnormal: "이상" };

function who(name, iso) {
  return `${name ?? ""} · ${formatDateTime(iso)}`;
}

function stepOf(entry) {
  const { no, total } = splitStepLabel(entry.label ?? entry.run?.step_label.split(" ")[0]);
  if (!no || !total) return null;
  return h("span", { class: "step-of" }, `전체 ${total}단계 중 `, h("b", null, `${no}번째`));
}

function runLines(run) {
  if (!run) return [];
  return [
    `착수 ${who(run.starter?.display_name, run.started_at)} · 라인 클리어런스 ${run.line_clearance.length}가지 확인`,
    run.completed_at ? `완료 ${who(run.completer?.display_name, run.completed_at)}` : null,
  ].filter(Boolean);
}

// 단계 완료 때 남긴 공정 기록: 설비 상태·생산량, 값과 판정, 이 기록에서 생긴 품질 이슈
function recordBlock(record, measurements, issues) {
  const items = measurements.filter((m) => m.process_record_id === record.id);
  const issue = issues.find((i) => i.process_record_id === record.id);
  return h("div", null,
    h("p", { class: "muted" }, "설비 상태 ", badge(record.equipment_status, EQUIPMENT_LABELS[record.equipment_status]),
      record.production_quantity === null ? null : ` · 생산량 ${record.production_quantity}`),
    items.length ? h("ul", { class: "plain-list" }, ...items.map((m) => h("li", null, measurementLine(m)))) : null,
    issue ? h("p", null, h("a", { href: `#/issues/${issue.id}` }, "이 단계에서 생긴 품질 이슈 보기")) : null);
}

function stepButton(label, onclick) {
  return h("button", { class: "button button--primary", type: "button", onclick }, label);
}

/**
 * FR-003~005: 단계 카드 목록. 막힌 이유는 아직 끝나지 않은 첫 단계에 글자로 보인다
 * @param {{ batch: object, board: object[], measurements: object[], issues: object[], role: string, onSaved: (notice: string) => void }} input
 */
export async function processStepsTab({ batch, board, measurements, issues, role, onSaved }) {
  const [records, specs] = await Promise.all([listProcessRecords(batch.id), listSpecifications(batch.product_id, "process")]);
  const lastActive = [...board].reverse().find((entry) => entry.label);
  const firstOpen = board.find((entry) => entry.status !== "completed");
  const mayAct = can(role, "record_process");

  const flow = h("ol", { class: "step-flow", style: `--steps:${board.length}`, "aria-label": "공정 단계 흐름" }, ...board.map((entry) => {
    const record = entry.run ? records.find((r) => r.step_run_id === entry.run.id) : null;
    const buttons = mayAct ? [
      entry.canStart ? stepButton("착수", () => openStartStepModal({ batch, entry, onSaved })) : null,
      entry.canComplete
        ? stepButton("완료", () => openCompleteStepModal({ batch, entry, specs: specsForStep(specs, entry.step, entry === lastActive), onSaved }))
        : null,
    ].filter(Boolean) : [];
    // 넓은 화면: 단계 동그라미 바로 아래에 그 단계 내용이 온다 (한 단계 = 한 칸). 좁은 화면은 세로로 쌓인다
    return h("li", { class: `stepper-item step-flow-item stepper-item--${entry.status}`, "aria-current": entry.status === "in_progress" ? "step" : null },
      ...stepperNode(entry),
      h("div", { class: entry.status === "in_progress" ? "step-card step-card--current" : "step-card" },
      h("p", { class: "record-head" },
        // "1/5"는 날짜나 진행률로 읽힐 수 있어서 "전체 5단계 중 1번째"로 풀어 쓴다 (몇 번째인지만 진하게)
        stepOf(entry), " ",
        badge(`step_${entry.status}`, STEP_STATUS_LABELS[entry.status]),
        entry.step.retired_at ? h("span", { class: "muted" }, " (쓰지 않음)") : null),
      ...runLines(entry.run).map((line) => h("p", { class: "muted" }, line)),
      record ? recordBlock(record, measurements, issues) : null,
      entry === firstOpen && entry.blockedReason ? h("p", { class: "status-text" }, entry.blockedReason) : null,
      buttons.length ? h("div", { class: "toolbar" }, ...buttons) : null));
  }));
  return flow;
}

// 홈 개편: 단계 흐름을 한 줄로. 번호·이름·상태 글자 (색만으로 구분하지 않음)
function stepperNode(entry) {
  return [
    h("span", { class: "stepper-dot", "aria-hidden": "true" }, entry.status === "completed" ? "✓" : (entry.label?.split("/")[0] ?? "")),
    h("span", { class: "stepper-name" }, entry.step.name),
    h("span", { class: "stepper-status" }, STEP_STATUS_LABELS[entry.status]),
  ];
}

export function stepper(board) {
  return h("ol", { class: "stepper", "aria-label": "공정 단계 흐름" }, ...board.map((entry) => h("li", {
    class: `stepper-item stepper-item--${entry.status}`,
    "aria-current": entry.status === "in_progress" ? "step" : null,
  }, ...stepperNode(entry))));
}
