// 상태 거르기를 칩으로: 목록 위에서 한 번 누르면 끝나고, 건수가 있으면 같이 보인다 (드롭다운은 두 번 눌러야 하고 선택지가 숨는다)
import { h } from "./dom.js";

/**
 * @param {{ label: string, options: { value: string, text: string, count?: number }[], value: string, onChange: (value: string) => void }} input
 *   label은 화면 읽기 프로그램용 묶음 이름. 선택된 칩은 색만이 아니라 aria-pressed로도 알린다
 */
export function filterChips({ label, options, value, onChange }) {
  return h("div", { class: "filter-chips", role: "group", "aria-label": label },
    ...options.map((option) => h("button", {
      type: "button",
      class: option.value === value ? "fchip fchip--on" : "fchip",
      "aria-pressed": String(option.value === value),
      onclick: () => onChange(option.value),
    }, option.text, option.count === undefined ? null : h("span", { class: "fchip-count" }, String(option.count)))));
}

/** 이름이 붙은 칩 묶음 한 줄: "상태 [전체] [처리 중] [종결]" */
export function chipGroup(title, chips) {
  return h("div", { class: "chip-group" }, h("span", { class: "chip-group-title" }, title), chips);
}
