// IA BT_010214_MD 단계 착수(라인 클리어런스), BT_010205_MD 단계 완료(공정 조건·공정 중 검사) — spec 011 FR-004·005
import { h } from "../dom.js";
import { openModal, field } from "../modal.js";
import { criteriaHint, numberField, readNumber } from "./batch-modals.js";
import { CLEARANCE_ITEMS, checkClearance } from "../../domain/process-step-rules.js";
import { completeStep, startStep } from "../../infrastructure/store-process-steps.js";

const SAVED_NOTICES = {
  spec: "규격 이탈입니다. 품질 이슈(규격 이탈)가 열리고 로트가 보류되었습니다. 다음 단계는 보류가 풀린 뒤 진행할 수 있습니다.",
  alert: "관리기준 이탈입니다. 품질 이슈(관리기준 이탈)가 열렸습니다. 로트는 보류되지 않아 다음 단계를 진행할 수 있습니다.",
};

/** FR-004: 라인 클리어런스 4가지를 모두 체크해야 착수 */
export function openStartStepModal({ batch, entry, onSaved }) {
  const boxes = CLEARANCE_ITEMS.map((item) => ({
    item, input: h("input", { type: "checkbox", name: item.key, value: item.key }),
  }));
  openModal({
    title: `단계 착수 · ${entry.label} ${entry.step.name}`,
    fields: [
      h("p", { class: "muted" }, "작업을 시작하기 전에 작업 구역을 확인하고 체크해 주세요. 확인한 사람과 시각이 남습니다."),
      h("fieldset", { class: "field" },
        h("legend", { class: "field-label" }, "라인 클리어런스"),
        ...boxes.map(({ item, input }) => h("label", { class: "check-item" }, input, " ", item.label))),
    ],
    submitLabel: "착수",
    onSubmit: async () => {
      const checked = checkClearance(boxes.filter((box) => box.input.checked).map((box) => box.item.key));
      if (!checked.ok) throw new Error(checked.error);
      await startStep(batch.id, entry.step.id, checked.value);
      onSaved(`${entry.label} ${entry.step.name} 단계를 착수했습니다.`);
    },
  });
}

function completeNotice(entry, result) {
  const kind = result.quality_issue_id ? (result.batch_status === "on_hold" ? "spec" : "alert") : null;
  const head = kind ? SAVED_NOTICES[kind] : `${entry.label} ${entry.step.name} 단계를 완료했습니다.`;
  return result.work_order_completed ? `${head} 마지막 단계라 작업지시가 완료되었습니다.` : head;
}

/**
 * FR-005: 이 단계에 이어진 공정 기준 값(공정 중 검사 포함), 설비 상태, 생산량(선택)
 * @param {{ batch: { id: string }, entry: object, specs: object[], onSaved: (notice: string) => void }} options
 */
export function openCompleteStepModal({ batch, entry, specs, onSaved }) {
  const quantity = numberField("생산량 (선택)", "기준 없이 기록만 합니다. 마지막 단계의 생산량이 수율 계산의 기준입니다.", "step-quantity");
  const items = specs.map((spec) => ({ spec, ...numberField(spec.item_name, criteriaHint(spec), `step-${spec.id}`) }));
  const equipment = h("select", { class: "select", name: "equipment", required: true },
    h("option", { value: "" }, "설비 상태를 고르세요"),
    h("option", { value: "normal" }, "정상"),
    h("option", { value: "abnormal" }, "이상"));

  openModal({
    title: `단계 완료 · ${entry.label} ${entry.step.name}`,
    fields: [
      specs.length ? null : h("p", { class: "muted" }, "이 단계에 이어진 공정 기준이 없습니다. 설비 상태만 확인합니다."),
      ...items.map((item) => item.node),
      field("설비 상태", equipment, "\"이상\"이면 규격 이탈로 봅니다."),
      quantity.node,
    ].filter(Boolean),
    submitLabel: "완료",
    onSubmit: async () => {
      const productionQuantity = readNumber(quantity, { optional: true });
      const values = items.map((item) => ({ specification_id: item.spec.id, value: readNumber(item, { optional: false }) }));
      if (productionQuantity === undefined || values.some((entryValue) => entryValue.value === undefined)) throw new Error("");
      if (!equipment.value) throw new Error("설비 상태를 골라 주세요.");
      const result = await completeStep({ runId: entry.run.id, productionQuantity, equipmentStatus: equipment.value, values });
      onSaved(completeNotice(entry, result));
    },
  });
}
