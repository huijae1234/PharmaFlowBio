// 범위 막대 (UI 개편): 값이 규격·관리기준 안에서 어디쯤인지 한눈에. 여러 로트 값을 한 막대에 찍어 비교한다.
// 점 위에 마우스를 올리거나 키보드로 옮기면 "로트번호 · 값 · 판정"이 바로 뜬다 (점마다 어느 로트인지 알 수 있게).
// 색만으로 읽지 않게 막대 아래에 규격 양 끝 숫자를 쓰고, 화면 읽기 프로그램용 설명을 붙인다
import { h } from "./dom.js";
import { rangeModel } from "../domain/compare-rules.js";

/**
 * @param {{
 *   range: { min: number, max: number, alertMin?: number | null, alertMax?: number | null },
 *   markers: { value: number, label?: string, detail?: string, current?: boolean }[],
 *   unit?: string | null,
 * }} input detail은 판정 같은 덧붙일 글자 (예: "정상")
 */
export function rangeBar({ range, markers, unit }) {
  const model = rangeModel(range, markers.map((marker) => marker.value));
  const u = unit ? ` ${unit}` : "";
  const tipOf = (marker) => [marker.label, `${marker.value}${u}`, marker.detail].filter(Boolean).join(" · ");
  const description = `규격 ${range.min}~${range.max}${u}${model.alert ? `, 관리기준 ${range.alertMin}~${range.alertMax}${u}` : ""}. ${markers.map(tipOf).join(", ")}`;
  const band = (kind, from, to) => h("span", { class: `rbar-band rbar-band--${kind}`, style: `left:${from}%;width:${Math.max(to - from, 0)}%` });
  return h("div", { class: "rbar", role: "group", "aria-label": description },
    h("div", { class: "rbar-track" },
      band(model.alert ? "spec" : "ok", model.spec.from, model.spec.to),
      model.alert ? band("alert", model.alert.from, model.alert.to) : null,
      // 다른 로트는 먼저, 지금 로트는 마지막에 그려 위에 보이게
      ...[...markers].sort((a, b) => Number(Boolean(a.current)) - Number(Boolean(b.current))).map((marker) => h("span", {
        class: ["rbar-mark", marker.current ? "rbar-mark--current" : "", model.at(marker.value) < 22 ? "rbar-mark--left" : model.at(marker.value) > 78 ? "rbar-mark--right" : ""].filter(Boolean).join(" "), // 가장자리 점은 말풍선이 화면 밖으로 나가지 않게 안쪽으로 펼친다
        style: `left:${model.at(marker.value)}%`,
        tabindex: "0",
        role: "img",
        "aria-label": tipOf(marker),
        "data-tip": tipOf(marker),
      }))),
    h("div", { class: "rbar-scale", "aria-hidden": "true" },
      h("span", { style: `left:${model.spec.from}%` }, String(range.min)),
      h("span", { style: `left:${model.spec.to}%` }, String(range.max))));
}
