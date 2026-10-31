// 제품 상세 "최근 로트 결과" (UI 개편): 이 제품의 로트들이 시험 항목마다 요즘 어떤 값인지 표 하나로.
// 기준표만 있던 제품 화면에서, 로트들을 열어 가며 값을 적어 비교하던 일을 대신한다. 읽기만 한다
import { h, badge } from "../dom.js";
import { latestByLot } from "../../domain/compare-rules.js";
import { batchStatusLabel } from "../../domain/batch-rules.js";
import { resultLabel } from "../../domain/judgement-rules.js";
import { lotGroup, lotGroups } from "../../domain/lot-group-rules.js";

const MAX_LOTS = 8;

// 이니셜은 자유 입력이라 제품과 1:1이 아니다. 자주 보이는 두 가지는 뜻을 적어 준다
const INITIAL_NOTES = {
  WO: "작업지시 번호로 이름 붙인 로트 (제품 약자가 아님)",
  QA: "QA가 시험·확인용으로 만든 로트",
};

/**
 * 이 제품 로트번호의 앞 글자(이니셜)별 개수와 예시. 이니셜은 제품 약자와 같을 수도, 아닐 수도 있어서 뜻을 함께 적는다
 * @param {{ lots: { id: string, batch_number: string }[] }} input
 */
export function lotInitialsPanel({ lots }) {
  const groups = lotGroups(lots);
  return h("section", { class: "panel" },
    h("h2", { class: "section-title" }, "로트 이니셜"),
    groups.length
      ? h("ul", { class: "initials-list" }, ...groups.map(({ group, count }) => {
          const examples = lots.filter((lot) => lotGroup(lot.batch_number) === group).slice(0, 3);
          return h("li", null,
            h("strong", { class: "mono initials-key" }, group),
            h("span", { class: "muted" }, `${count}개`),
            h("span", { class: "initials-eg" }, ...examples.flatMap((lot, index) => [index ? ", " : "", h("a", { class: "mono", href: `#/batches/${lot.id}` }, lot.batch_number)])),
            INITIAL_NOTES[group] ? h("span", { class: "muted initials-note" }, INITIAL_NOTES[group]) : null);
        }))
      : h("p", { class: "muted" }, "아직 이 제품의 로트가 없습니다."),
    h("p", { class: "field-hint" }, "로트번호 앞 글자는 자유롭게 정해서, 이 제품의 로트가 항상 같은 글자로 시작하지는 않습니다. 로트 목록의 비교 전환도 이 앞 글자 기준입니다."));
}

/**
 * @param {{ specs: { item_name: string, unit: string | null, category: string }[], measurements: object[] }} input specs는 시험 항목 기준
 */
export function productLotsPanel({ specs, measurements }) {
  const tests = specs.filter((spec) => spec.category === "test");
  const byItem = new Map(tests.map((spec) => [spec.item_name, latestByLot(measurements, spec.item_name)]));
  const lots = new Map();
  for (const rows of byItem.values()) {
    for (const row of rows) {
      const known = lots.get(row.batchId);
      lots.set(row.batchId, { batchId: row.batchId, batchNumber: row.batchNumber, status: row.status, at: known && known.at > row.measuredAt ? known.at : row.measuredAt });
    }
  }
  const shown = [...lots.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_LOTS);
  if (!shown.length) return h("section", { class: "panel" }, h("h2", { class: "section-title" }, "최근 로트 결과"), h("p", { class: "muted" }, "아직 이 제품의 시험값이 없습니다."));

  const cell = (itemName, batchId) => {
    const row = byItem.get(itemName)?.find((entry) => entry.batchId === batchId);
    return row
      ? h("td", { class: "mono" }, String(row.value), " ", badge(row.result, resultLabel(row.result)))
      : h("td", { class: "muted" }, "-");
  };
  return h("section", { class: "panel" },
    h("h2", { class: "section-title" }, "최근 로트 결과"),
    h("div", { class: "table-wrap" }, h("table", { class: "table matrix" },
      h("thead", null, h("tr", null,
        h("th", { scope: "col" }, "로트"), h("th", { scope: "col" }, "상태"),
        ...tests.map((spec) => h("th", { scope: "col" }, spec.unit ? `${spec.item_name} (${spec.unit})` : spec.item_name)))),
      h("tbody", null, ...shown.map((lot) => h("tr", null,
        h("td", null, h("a", { class: "mono", href: `#/batches/${lot.batchId}` }, lot.batchNumber)),
        h("td", null, h("span", { class: "muted" }, batchStatusLabel(lot.status))),
        ...tests.map((spec) => cell(spec.item_name, lot.batchId))))))),
    h("p", { class: "field-hint" }, `로트마다 항목의 가장 최근 값 (최근 ${MAX_LOTS}개 로트). 배지는 값을 넣을 때의 판정입니다.`));
}
