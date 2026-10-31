// IA PD_010200_PG 제품 상세 "공정 단계" 칸, PD_010203_MD 공정 단계 등록 (spec 011 FR-001·002). 버튼은 QA 관리자만
import { h, badge, refreshPage } from "../dom.js";
import { openModal, field } from "../modal.js";
import { checkStepName } from "../../domain/process-step-rules.js";
import { moveProcessStep, retireProcessStep, saveProcessStep, setSpecificationStep } from "../../infrastructure/store-process-steps.js";

const NOTE = "단계 순서대로 착수·완료합니다. 공정 기준을 단계에 이으면 그 단계를 완료할 때 값을 받고, "
  + "단계를 고르지 않은 기준은 마지막 단계에서 받습니다.";

// 저장 실패는 화면에 그대로 알린다 (DB 문구)
function run(action) {
  return () => action().then(refreshPage).catch((error) => window.alert(error.message));
}

/** FR-001: 등록(step 없음)·이름 바꾸기 */
function openStepModal(product, step) {
  const name = h("input", { class: "input", name: "step_name", maxlength: "40", autocomplete: "off", required: true, value: step?.name ?? "" });
  openModal({
    title: step ? "공정 단계 이름 바꾸기" : "공정 단계 등록",
    fields: [field("단계 이름", name, "40자까지. 예: 세포 배양, 정제, 원액 여과, 충전, 포장")],
    submitLabel: step ? "바꾸기" : "등록",
    onSubmit: async () => {
      const checked = checkStepName(name.value);
      if (!checked.ok) throw new Error(checked.error);
      await saveProcessStep({ id: step?.id ?? null, productId: product.id, name: checked.value });
      refreshPage();
    },
  });
}

function openRetireModal(step) {
  openModal({
    title: "공정 단계 쓰지 않음",
    fields: [h("p", null, `"${step.name}" 단계를 새 로트에서 건너뜁니다. 이미 진행한 로트의 기록은 그대로 보입니다.`)],
    submitLabel: "쓰지 않음으로 표시",
    onSubmit: async () => {
      await retireProcessStep(step.id);
      refreshPage();
    },
  });
}

function stepButtons(product, step) {
  const named = (label) => `${step.name} ${label}`;
  return h("div", { class: "toolbar" },
    h("button", { class: "button", type: "button", "aria-label": named("위로"), onclick: run(() => moveProcessStep(step.id, "up")) }, "위로"),
    h("button", { class: "button", type: "button", "aria-label": named("아래로"), onclick: run(() => moveProcessStep(step.id, "down")) }, "아래로"),
    h("button", { class: "button", type: "button", "aria-label": named("이름 바꾸기"), onclick: () => openStepModal(product, step) }, "이름 바꾸기"),
    h("button", { class: "button", type: "button", "aria-label": named("쓰지 않음"), onclick: () => openRetireModal(step) }, "쓰지 않음"));
}

function specNames(specs) {
  return specs.map((spec) => `${spec.item_name}${spec.unit ? ` (${spec.unit})` : ""}`).join(", ");
}

// FR-002: 공정 기준마다 재는 단계 고르기
function specStepPicker(spec, activeSteps) {
  const select = h("select", {
    class: "select", "aria-label": `${spec.item_name} 단계`,
    onchange: () => run(() => setSpecificationStep(spec.id, select.value))(),
  },
  h("option", { value: "" }, "단계 미지정 (마지막 단계)"),
  ...activeSteps.map((step) => h("option", { value: step.id, selected: step.id === spec.process_step_id }, step.name)));
  return h("li", { class: "check-item" }, h("span", null, spec.item_name), " ", select);
}

/**
 * FR-001·002: 단계 목록, 단계마다 이어진 공정 기준, 기준의 단계 고르기
 * @param {{ product: { id: string }, steps: object[], specs: object[], editable: boolean }} input
 */
export function productStepsPanel({ product, steps, specs, editable }) {
  const processSpecs = specs.filter((spec) => spec.category === "process");
  const activeSteps = steps.filter((step) => !step.retired_at);
  const unassigned = processSpecs.filter((spec) => !spec.process_step_id);
  return h("section", { class: "panel" },
    h("h2", { class: "section-title" }, "공정 단계"),
    h("p", { class: "muted" }, NOTE),
    editable
      ? h("div", { class: "toolbar" }, h("button", { class: "button button--primary", type: "button", onclick: () => openStepModal(product, null) }, "단계 등록"))
      : null,
    steps.length
      ? h("ol", { class: "plain-list" }, ...steps.map((step) => {
          const linked = processSpecs.filter((spec) => spec.process_step_id === step.id);
          return h("li", { class: "record" },
            h("p", { class: "record-head" },
              h("strong", null, `${step.step_order}. ${step.name}`), " ",
              step.retired_at ? badge("discarded", "쓰지 않음") : null),
            linked.length ? h("p", { class: "muted" }, `공정 기준: ${specNames(linked)}`) : null,
            editable && !step.retired_at ? stepButtons(product, step) : null);
        }))
      : h("p", { class: "muted" }, "아직 공정 단계가 없습니다. 단계가 없으면 로트마다 공정 조건을 한 번에 입력합니다."),
    unassigned.length && steps.length
      ? h("p", { class: "muted" }, `단계 미지정 (마지막 단계에서 받음): ${specNames(unassigned)}`)
      : null,
    editable && activeSteps.length && processSpecs.length
      ? h("div", null,
          h("h3", { class: "field-label" }, "공정 기준을 재는 단계"),
          h("ul", { class: "plain-list" }, ...processSpecs.map((spec) => specStepPicker(spec, activeSteps))))
      : null);
}
