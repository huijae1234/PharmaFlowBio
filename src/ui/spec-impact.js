// 기준 수정 영향 미리보기 (UI 개편): 기준 수정 창에서 값을 고치는 즉시 "판정이 달라지는 로트"를 보여 준다.
// 저장하기 전에 결과를 알고 결정하게 한다. 이미 저장된 판정은 바뀌지 않으므로 참고용이다 (측정값에는 판정 당시 기준이 남는다)
import { h, put } from "./dom.js";
import { affectedLots } from "../domain/compare-rules.js";
import { resultLabel } from "../domain/judgement-rules.js";
import { parseNumberInput } from "../domain/input-rules.js";

/**
 * @param {{ spec: { id: string } | null, rows: object[], inputs: { min: HTMLInputElement, max: HTMLInputElement, alertMin: HTMLInputElement, alertMax: HTMLInputElement } }} input
 * @returns {HTMLElement} 입력이 바뀔 때마다 스스로 다시 그린다
 */
export function specImpact({ spec, rows, inputs }) {
  const box = h("div", { class: "impact", "aria-live": "polite" });
  if (!spec) return box; // 새 기준은 이미 넣은 값이 없다

  const num = (input) => {
    if (!input.value.trim()) return null;
    const parsed = parseNumberInput(input.value);
    return parsed.ok ? parsed.value : undefined;
  };
  const render = () => {
    const [min, max, alertMin, alertMax] = [inputs.min, inputs.max, inputs.alertMin, inputs.alertMax].map(num);
    if (min === null || max === null || [min, max, alertMin, alertMax].includes(undefined)) {
      put(box, h("p", { class: "muted" }, "숫자를 모두 입력하면 영향받는 로트를 보여 줍니다."));
      return;
    }
    const hasAlert = alertMin !== null && alertMax !== null;
    const changed = affectedLots(rows, spec.id, { min_value: min, max_value: max, alert_min_value: hasAlert ? alertMin : null, alert_max_value: hasAlert ? alertMax : null }, spec);
    // put은 null을 건너뛴다 (replaceChildren은 null을 "null" 글자로 찍는다)
    put(box,
      h("p", { class: "impact-title" }, changed.length ? `이 기준이면 판정이 달라지는 로트 ${changed.length}개` : "이 기준으로 바꿔도 판정이 달라지는 로트가 없습니다"),
      changed.length
        ? h("ul", { class: "impact-list" }, ...changed.map((entry) => h("li", null,
            h("a", { class: "mono", href: `#/batches/${entry.batchId}` }, entry.batchNumber), ` ${entry.value}: ${resultLabel(entry.from)} → `, h("strong", null, resultLabel(entry.to)))))
        : null,
      h("p", { class: "field-hint" }, "참고용입니다. 이미 저장된 판정은 그대로 남고, 새 기준은 앞으로 넣는 값부터 적용됩니다."));
  };
  for (const input of Object.values(inputs)) input.addEventListener("input", render);
  render();
  return box;
}
