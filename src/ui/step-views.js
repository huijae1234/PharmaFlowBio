// 단계 표시줄과 다음에 할 일 줄 (spec 005 FR-006·007, IA QI_010100_PG 콘텐츠 우선순위 1). 계산은 domain/step-rules.js
import { h } from "./dom.js";
import { STAGES } from "../domain/step-rules.js";

const ACTION_STAGE = 2;

/**
 * 지나온 단계·지금 단계·남은 단계. 지금 단계는 색만이 아니라 "지금" 글자로도 (디자인 기본선 5)
 * @param {{ stage: number, optionalAction: boolean }} step
 */
export function stepBar(step) {
  return h("ol", { class: "step-bar", "aria-label": "처리 단계" }, ...STAGES.map((name, index) => {
    const state = index < step.stage ? "done" : index === step.stage ? "current" : "todo";
    return h("li", { class: `step step--${state}`, "aria-current": state === "current" ? "step" : null },
      h("span", { class: "step-name" }, name),
      index === ACTION_STAGE && step.optionalAction ? h("span", { class: "step-note" }, "(선택)") : null,
      state === "current" ? h("span", { class: "step-now" }, "지금") : null);
  }));
}

/** "다음에 할 일: 품질 영향 평가 작성 · 담당 QC 시험 담당자·생산 담당자 (외 1건)" */
export function nextLine({ next, owner, more = 0 }) {
  if (!next) return null;
  return h("p", { class: "next-step" },
    h("strong", null, "다음에 할 일 "), next,
    owner ? h("span", { class: "muted" }, ` · 담당 ${owner}`) : null,
    more ? h("span", { class: "muted" }, ` (외 ${more}건)`) : null);
}
