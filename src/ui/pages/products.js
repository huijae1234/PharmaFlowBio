// IA PD_010000_PG 제품 목록, PD_010200_PG 제품 상세, PD_010201_MD 기준 등록·수정. FR-007 (spec 001)
// 사내 관리기준·기준 버전·"교육용 가상 기준"은 spec 004 FR-001·002
// 제품 등록(PD_010100_MD)과 허가정보·회수 이력 탭(PD_010202_TB)은 spec 003 FR-001·002
import { h, refreshPage } from "../dom.js";
import { openProductRegisterModal } from "./product-modals.js";
import { publicTab } from "./product-public.js";
import { regulatoryTab } from "./product-regulatory.js"; // spec 021: 공개 규제 현황 탭
import { openModal, openSafely, field } from "../modal.js";
import { hashWith, NO_SEARCH_RESULT, searchBox } from "../search-box.js";
import { matchesSearch, normalizeSearch } from "../../domain/search-rules.js";
import { can } from "../../domain/roles.js";
import { checkSpecRange, parseNumberInput } from "../../domain/input-rules.js";
import { checkAlertRange } from "../../domain/judgement-rules.js";
import { getProduct, listAllSpecifications, listProductLotNumbers, listProductMeasurements, listProductsWithInfo, saveSpecification } from "../../infrastructure/store.js";
import { lotInitialsPanel, productLotsPanel } from "./product-lots.js";
import { specImpact } from "../spec-impact.js";
import { productStepsPanel } from "./product-steps.js"; // spec 011 FR-001·002
import { specImpactPanel } from "./plan-ai.js"; // spec 024: 기준 변경 영향 설명
import { listProcessSteps } from "../../infrastructure/store-process-steps.js";

const CATEGORY_LABELS = { test: "시험 항목", process: "공정 조건" };
const TABS = [{ key: "specs", label: "기준" }, { key: "public", label: "허가정보·회수 이력" }, { key: "regulatory", label: "공개 규제 현황" }];
const VIRTUAL_NOTE = "교육용 가상 기준입니다. 실제 의약품의 법정 규격이 아닙니다.";

let pendingNotice = "";

/** @param {{ profile: { id: string, role: string }, query: Record<string, string> }} context */
export async function renderProducts({ profile, query }) {
  const term = normalizeSearch(query?.q);
  // spec 007 FR-008: 품목명·주성분·제조원으로 검색
  const products = (await listProductsWithInfo())
    .filter((product) => matchesSearch([product.item_name, product.main_ingredient, product.manufacturer], term));
  const body = products.length
    ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null,
          h("th", { scope: "col" }, "품목명"), h("th", { scope: "col" }, "주성분"), h("th", { scope: "col" }, "제조원"))),
        h("tbody", null, ...products.map((product) => h("tr", null,
          h("td", null, h("a", { href: `#/products/${product.id}` }, product.item_name)),
          // spec 007 FR-006: 백신 주성분은 수백 자라 두 줄까지만, 전체는 title로
          h("td", { class: "cell-wrap" }, h("span", { class: "line-clamp", title: product.main_ingredient ?? "" }, product.main_ingredient ?? "")),
          h("td", null, product.manufacturer ?? ""))))))
    : h("p", { class: "muted" }, term ? NO_SEARCH_RESULT : "아직 제품이 없습니다.");
  const notice = pendingNotice;
  pendingNotice = "";
  return h("div", { class: "stack" },
    h("h1", { class: "page-title" }, "제품 목록"),
    notice ? h("p", { class: "status-text", role: "status" }, notice) : null,
    h("div", { class: "toolbar" },
      searchBox({ label: "제품 검색", placeholder: "품목명·주성분·제조원", value: term,
                  onSearch: (next) => { location.hash = hashWith("#/products", { q: next }); } }),
      // FR-001 수용 기준 5 (spec 003): QA 관리자만
      can(profile.role, "create_product")
        ? h("button", {
            class: "button button--primary", type: "button",
            onclick: openSafely(() => openProductRegisterModal({
              userId: profile.id,
              onSaved: (name) => { pendingNotice = `제품을 등록했습니다: ${name}`; refreshPage(); },
            })),
          }, "제품 등록")
        : null),
    h("section", { class: "panel" }, body));
}

/** @param {{ profile: { role: string }, id: string, query: Record<string, string> }} context */
export async function renderProductDetail({ profile, id, query }) {
  const [product, specs, steps, measurements, lots] = await Promise.all([
    getProduct(id), listAllSpecifications(id), listProcessSteps(id), listProductMeasurements(id).catch(() => []), // 최근 로트 결과용 보조 자료
    listProductLotNumbers(id).catch(() => [])]);
  if (!product) {
    return h("section", { class: "panel" },
      h("h1", { class: "page-title" }, "제품을 찾을 수 없습니다"),
      h("a", { href: "#/products" }, "제품 목록으로"));
  }
  const editable = can(profile.role, "edit_specification");
  const tab = TABS.some((item) => item.key === query?.tab) ? query.tab : "specs";
  return h("div", { class: "stack" },
    h("header", { class: "panel" },
      h("h1", { class: "page-title" }, product.item_name),
      // spec 007 FR-006: 주성분만 두 줄까지 줄이고 제조원은 늘 보이게
      h("p", { class: "muted line-clamp", title: product.main_ingredient ?? "" }, `주성분 ${product.main_ingredient ?? "-"}`),
      h("p", { class: "muted" }, `제조원 ${product.manufacturer ?? "-"}`)),
    h("nav", { class: "tabs", "aria-label": "제품 상세 탭" }, ...TABS.map((item) => h("a", {
      class: "tab",
      href: `#/products/${product.id}${item.key === "specs" ? "" : `?tab=${item.key}`}`,
      "aria-current": item.key === tab ? "page" : null,
    }, item.label))),
    ...(tab === "public" ? [publicTab(product)] : tab === "regulatory" ? [regulatoryTab(product)] : [...specsView(product, specs, editable, measurements, lots), specImpactPanel({ profile, specs }), productStepsPanel({ product, steps, specs, editable })]));
}

function specsView(product, specs, editable, measurements, lots) {
  return [
    editable
      ? h("div", { class: "toolbar" }, h("button", {
          class: "button button--primary", type: "button",
          onclick: openSafely(async () => openSpecModal({ product, spec: null })),
        }, "기준 등록"))
      : null,
    // FR-034 (PRD): 가상 기준을 실제 규격처럼 보이지 않게
    h("p", { class: "muted" }, h("span", { class: "badge" }, "교육용 가상 기준"), " ", VIRTUAL_NOTE),
    productLotsPanel({ specs, measurements }), // UI 개편: 이 제품 로트들의 최근 시험값
    lotInitialsPanel({ lots }), // 로트번호 앞 글자(이니셜)별 정리
    ...["test", "process"].map((category) => h("section", { class: "panel" },
      h("h2", { class: "section-title" }, `${CATEGORY_LABELS[category]} 기준`),
      specTable(specs.filter((spec) => spec.category === category), editable, product))),
  ];
}

function specTable(specs, editable, product) {
  if (!specs.length) return h("p", { class: "muted" }, "아직 기준이 없습니다.");
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null,
      h("th", { scope: "col" }, "항목"), h("th", { scope: "col" }, specs[0].category === "test" ? "시험 규격" : "규격"),
      h("th", { scope: "col" }, "사내 관리기준"), h("th", { scope: "col" }, "버전"),
      editable ? h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "수정")) : null)),
    h("tbody", null, ...specs.map((spec) => h("tr", null,
      h("td", null, spec.item_name),
      h("td", { class: "mono" }, rangeText(spec.min_value, spec.max_value, spec.unit)),
      // FR-001 수용 기준 1 (spec 004): 비워 둔 관리기준은 "없음"
      h("td", { class: spec.alert_min_value == null ? "muted" : "mono" },
        spec.alert_min_value == null ? "없음" : rangeText(spec.alert_min_value, spec.alert_max_value, spec.unit)),
      h("td", { class: "mono" }, `v${spec.version}`),
      editable
        ? h("td", null, h("button", {
            class: "button", type: "button", "aria-label": `${spec.item_name} 기준 수정`,
            onclick: openSafely(async () => openSpecModal({ product, spec })),
          }, "수정"))
        : null)))));
}

function rangeText(min, max, unit) {
  return `${min} ~ ${max}${unit ?? ""}`;
}

/** 빈 칸은 관리기준 없음(null), 글자가 있으면 숫자로 (spec 004 FR-001) */
function parseOptionalNumber(text) {
  if (!String(text ?? "").trim()) return { ok: true, value: null };
  return parseNumberInput(text);
}

// FR-007: QA 관리자만. 이미 있는 측정값의 판정은 바뀌지 않는다는 것을 알린다
async function openSpecModal({ product, spec }) {
  const rows = spec ? await listProductMeasurements(product.id).catch(() => []) : []; // 영향 미리보기용
  const category = h("select", { class: "select", name: "category", disabled: Boolean(spec) },
    ...["test", "process"].map((value) => h("option", { value, selected: spec?.category === value }, CATEGORY_LABELS[value])));
  const itemName = h("input", { class: "input", name: "item_name", maxlength: "40", required: true, value: spec?.item_name ?? "" });
  const unit = h("input", { class: "input", name: "unit", maxlength: "10", value: spec?.unit ?? "" });
  const min = h("input", { class: "input mono", name: "min", inputmode: "decimal", required: true, value: spec?.min_value ?? "" });
  const max = h("input", { class: "input mono", name: "max", inputmode: "decimal", required: true, value: spec?.max_value ?? "" });
  const rangeError = h("span", { class: "error-text", role: "alert" });
  const alertMin = h("input", { class: "input mono", name: "alert_min", inputmode: "decimal", value: spec?.alert_min_value ?? "" });
  const alertMax = h("input", { class: "input mono", name: "alert_max", inputmode: "decimal", value: spec?.alert_max_value ?? "" });
  const alertError = h("span", { class: "error-text", role: "alert" });

  openModal({
    title: spec ? `${spec.item_name} 기준 수정` : "기준 등록",
    fields: [
      field("구분", category),
      field("항목 이름", itemName, "예: 순도, 공정 온도"),
      field("단위", unit, "예: %, ℃ (없으면 비워 둡니다)"),
      field("시험 규격 최솟값", min),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "시험 규격 최댓값"), max, rangeError),
      field("사내 관리기준 최솟값 (선택)", alertMin, "비워 두면 관리기준 없음: 정상과 규격 이탈로만 판정합니다"),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "사내 관리기준 최댓값 (선택)"), alertMax, alertError),
      specImpact({ spec, rows, inputs: { min, max, alertMin, alertMax } }), // 저장 전에 "판정이 달라지는 로트"를 값 바로 아래에
      h("p", { class: "field-hint" }, spec
        ? `지금 v${spec.version}. 규격이나 관리기준 값을 바꾸면 v${spec.version + 1}로 바뀝니다. 이미 넣은 측정값은 바꾸기 전 기준으로 남습니다.`
        : "바꾼 기준은 새로 넣는 값부터 적용됩니다. 이미 넣은 측정값의 판정은 그대로입니다."),
      h("p", { class: "field-hint" }, VIRTUAL_NOTE),
    ],
    submitLabel: "저장",
    onSubmit: async () => {
      rangeError.textContent = "";
      alertError.textContent = "";
      const low = parseNumberInput(min.value);
      const high = parseNumberInput(max.value);
      if (!low.ok || !high.ok) throw new Error("최솟값과 최댓값을 숫자로 입력해 주세요.");
      const range = checkSpecRange(low.value, high.value);
      if (!range.ok) {
        rangeError.textContent = range.error; // 칸 옆에 (FR-007 수용 기준 2)
        throw new Error("");
      }
      const alertLow = parseOptionalNumber(alertMin.value);
      const alertHigh = parseOptionalNumber(alertMax.value);
      if (!alertLow.ok || !alertHigh.ok) throw new Error("사내 관리기준을 숫자로 입력하거나 비워 두세요.");
      // FR-001 수용 기준 3 (spec 004): 이유를 칸 옆에
      const alert = checkAlertRange({ min: low.value, max: high.value, alertMin: alertLow.value, alertMax: alertHigh.value });
      if (!alert.ok) {
        alertError.textContent = alert.error;
        throw new Error("");
      }
      await saveSpecification({
        id: spec?.id ?? null, productId: product.id, category: category.value,
        itemName: itemName.value, unit: unit.value, min: low.value, max: high.value,
        alertMin: alertLow.value, alertMax: alertHigh.value,
      });
      refreshPage();
    },
  });
}
