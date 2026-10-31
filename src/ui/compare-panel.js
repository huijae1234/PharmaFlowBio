// 같은 제품 다른 로트와 비교 (UI 개편): 항목마다 범위 막대에 로트 값을 찍고 최근 로트 표를 붙인다.
// "다른 화면을 열어 값을 적어 두고 비교"하던 일을 한 자리에서 하게 한다. 읽기만 한다 (자료는 listProductMeasurements)
// 같은 제품으로 등록된 로트 중 번호 앞 영문이 다른 것(예: IFV 제품 안의 QA-TS-001 시험용 로트)이 섞여 있으면
// 기본으로 지금 로트와 같은 제품군(IFV)만 보이고, 토글로 같은 제품 전체를 볼 수 있다
import { h, badge, formatDateTime } from "./dom.js";
import { rangeBar } from "./range-bar.js";
import { siblingRows } from "../domain/compare-rules.js";
import { resultLabel } from "../domain/judgement-rules.js";
import { lotGroup } from "../domain/lot-group-rules.js";

function rangeOf(spec) {
  return { min: Number(spec.min_value), max: Number(spec.max_value), alertMin: spec.alert_min_value === null ? null : Number(spec.alert_min_value), alertMax: spec.alert_max_value === null ? null : Number(spec.alert_max_value) };
}

/**
 * 항목 하나의 비교 카드
 * @param {{ spec: object, rows: ReturnType<typeof siblingRows>, compact?: boolean }} input compact면 표 대신 한 줄
 */
export function compareCard({ spec, rows, compact = false }) {
  const unit = spec.unit ?? "";
  const others = rows.filter((row) => !row.isCurrent);
  return h("section", { class: "cmp-card" },
    h("div", { class: "cmp-head" },
      h("strong", null, spec.item_name),
      h("span", { class: "muted" }, `규격 ${spec.min_value}~${spec.max_value}${unit ? ` ${unit}` : ""}${spec.alert_min_value === null || spec.alert_min_value === undefined ? "" : ` · 관리기준 ${spec.alert_min_value}~${spec.alert_max_value}`}`)),
    rangeBar({
      range: rangeOf(spec), unit,
      markers: rows.map((row) => ({ value: row.value, label: row.batchNumber, detail: `${resultLabel(row.result)}${row.isCurrent ? " (지금 로트)" : ""}`, current: row.isCurrent })),
    }),
    !others.length
      ? h("p", { class: "muted cmp-note" }, "비교할 다른 로트의 값이 아직 없습니다.")
      : compact
        ? h("p", { class: "cmp-line" }, ...rows.flatMap((row) => [
            h("span", { class: row.isCurrent ? "cmp-chip cmp-chip--current" : "cmp-chip" },
              h("a", { class: "mono", href: `#/batches/${row.batchId}` }, row.batchNumber), ` ${row.value}${unit}`),
          ]))
        : h("div", { class: "table-wrap" }, h("table", { class: "table cmp-table" },
            h("thead", null, h("tr", null, ...["로트", "값", "판정", "측정"].map((title) => h("th", { scope: "col" }, title)))),
            h("tbody", null, ...rows.map((row) => h("tr", { class: row.isCurrent ? "cmp-row--current" : null },
              h("td", null, h("a", { class: "mono", href: `#/batches/${row.batchId}` }, row.batchNumber), row.isCurrent ? h("span", { class: "cmp-now" }, "지금") : null),
              h("td", { class: "mono" }, `${row.value}${unit}`),
              h("td", null, badge(row.result, resultLabel(row.result))),
              h("td", { class: "muted" }, formatDateTime(row.measuredAt))))))));
}

function cards({ specs, measurements, batchId, compact, limit }) {
  const built = specs
    .map((spec) => ({ spec, rows: siblingRows(measurements, spec.item_name, batchId, limit) }))
    .filter(({ rows }) => rows.length)
    .map(({ spec, rows }) => compareCard({ spec, rows, compact }));
  return built.length ? h("div", { class: "cmp-grid" }, ...built) : h("p", { class: "muted" }, "비교할 시험값이 아직 없습니다.");
}

/**
 * 비교 카드 묶음. 값이 있는 항목만. 모두 없으면 안내 한 줄
 * @param {{ specs: object[], measurements: object[], batchId: string, currentNumber?: string, compact?: boolean, limit?: number }} input
 *   specs: item_name·unit·min_value·max_value·alert_min_value·alert_max_value가 있는 시험 기준.
 *   currentNumber: 지금 로트번호. 있으면 같은 제품군만/같은 제품 전체 토글을 둔다 (다른 제품군 로트가 섞여 있을 때만)
 */
export function comparePanel({ specs, measurements, batchId, currentNumber, compact = false, limit = 6 }) {
  const group = currentNumber ? lotGroup(currentNumber) : null;
  const sameGroup = group ? measurements.filter((row) => row.batch && lotGroup(row.batch.batch_number) === group) : measurements;
  const mixed = Boolean(group) && sameGroup.length < measurements.filter((row) => row.batch).length;
  if (!mixed) return cards({ specs, measurements, batchId, compact, limit });

  const body = h("div", null);
  const buttons = [
    { key: "group", text: `같은 제품군 (${group})만` },
    { key: "all", text: "같은 제품 전체" },
  ].map((option) => h("button", { type: "button", class: "fchip", "aria-pressed": "false", onclick: () => show(option.key) }, option.text));
  function show(key) {
    buttons.forEach((button, index) => {
      const on = (index === 0) === (key === "group");
      button.setAttribute("aria-pressed", String(on));
      button.classList.toggle("fchip--on", on);
    });
    body.replaceChildren(cards({ specs, measurements: key === "group" ? sameGroup : measurements, batchId, compact, limit }));
  }
  show("group");
  return h("div", null,
    h("div", { class: "cmp-toggle" }, ...buttons,
      h("span", { class: "muted cmp-note" }, `번호가 ${group}가 아닌 로트도 같은 제품으로 등록돼 있습니다.`)),
    body);
}
