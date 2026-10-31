// IA PD_010100_MD 제품 등록 (spec 003 FR-001). 허가정보를 품목명으로 검색해 하나를 고르면 등록한다 (Q26: 직접 입력 없음)
import { h, put } from "../dom.js";
import { openModal, field } from "../modal.js";
import { publicPanel } from "../public-panel.js";
import { checkSearchTerm, permitRow } from "../../domain/public-data-rules.js";
import { callPublicData } from "../../infrastructure/public-data.js";
import { createProduct, logUsage } from "../../infrastructure/store-products.js";

const EMPTY_TERM = "품목명을 입력해 주세요.";
const NO_RESULT = "검색 결과가 없습니다. 품목명을 바꿔 다시 검색해 주세요.";
const NO_VACCINE = "백신 품목 검색 결과가 없습니다. '백신만'을 끄거나 품목명을 바꿔 다시 검색해 주세요."; // spec 006 FR-001 수용 기준 4

/** @param {{ userId: string, onSaved: (name: string) => void }} options */
export function openProductRegisterModal({ userId, onSaved }) {
  const term = h("input", { class: "input", name: "term", autocomplete: "off", maxlength: "60", placeholder: "예: 타이레놀" });
  const results = h("div", { class: "permit-results" });
  const termError = h("p", { class: "error-text", role: "alert" });
  // spec 006 FR-001: 처음 켜져 있다 (Q37)
  const vaccineOnly = h("input", { type: "checkbox", name: "vaccineOnly", checked: true });
  let rows = [];

  const search = () => {
    termError.textContent = "";
    const checked = checkSearchTerm(term.value, EMPTY_TERM);
    if (!checked.ok) {
      termError.textContent = checked.error;
      put(results);
      return;
    }
    logUsage(userId, "search", { searchTerm: checked.value }); // spec 003 FR-008 수용 기준 2
    const vaccine = vaccineOnly.checked;
    const params = vaccine ? { name: checked.value, vaccine: 1 } : { name: checked.value };
    put(results, publicPanel({
      label: "허가정보",
      load: () => callPublicData("permit", params),
      render: (result) => {
        rows = result.items.map(permitRow);
        // 출처·조회 시각은 publicPanel이 붙인다. cacheKey를 주지 않아 보관하지 않는다 (spec 006 Q39)
        return rows.length ? resultTable(rows) : h("p", { class: "muted" }, vaccine ? NO_VACCINE : NO_RESULT);
      },
    }));
  };
  // 결과를 본 뒤 "백신만"을 바꾸면 같은 품목명으로 다시 검색 (FR-001 수용 기준 3)
  vaccineOnly.addEventListener("change", () => { if (results.childElementCount) search(); });
  // 검색 칸에서 Enter는 등록이 아니라 검색
  term.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    search();
  });

  openModal({
    title: "제품 등록",
    fields: [
      h("div", { class: "search-row" },
        field("품목명", term, "식약처 허가정보에서 찾아 고릅니다. 최대 10건"),
        h("button", { class: "button", type: "button", onclick: search }, "검색")),
      h("label", { class: "check-row" }, vaccineOnly, "백신만 (품목 구분이 백신류인 허가정보)"),
      termError,
      results,
    ],
    submitLabel: "등록",
    onSubmit: async (form) => {
      const chosen = rows.find((row) => row.code === form.elements.permit?.value);
      if (!chosen) throw new Error("등록할 제품을 검색 결과에서 골라 주세요.");
      await createProduct({
        itemName: chosen.name, mainIngredient: chosen.ingredient, manufacturer: chosen.company, permitItemCode: chosen.code,
      });
      onSaved(chosen.name);
    },
  });
  term.focus();
  return Promise.resolve();
}

// FR-001 수용 기준 1: 품목명·주성분·제조원
function resultTable(rows) {
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ...["", "품목명", "품목 구분", "주성분", "제조원"].map((title) => h("th", { scope: "col" }, title)))),
    h("tbody", null, ...rows.map((row, index) => {
      const id = `permit-${index}`;
      return h("tr", null,
        h("td", null, h("input", { type: "radio", name: "permit", value: row.code, id, required: true })),
        h("td", { class: "cell-wrap" }, h("label", { for: id }, row.name), row.status && row.status !== "정상" ? h("span", { class: "muted" }, ` (${row.status})`) : null),
        h("td", null, row.type), // spec 006 FR-001 수용 기준 2
        // 백신 주성분은 수백 자라 두 줄까지만, 전체는 title로
        h("td", { class: "cell-wrap" }, h("span", { class: "line-clamp", title: row.ingredient }, row.ingredient)),
        h("td", null, row.company));
    }))));
}
