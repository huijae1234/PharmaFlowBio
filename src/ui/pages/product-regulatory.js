// IA PD_010203_TB 제품 상세 "공개 규제 현황" 탭 (spec 021). 국가출하승인 + 제조사 GMP + 회수 대조 + 작업지시 일정 대조.
// 저장하지 않고 열 때마다 부른다 (PRD §9). 이 앱은 승인이나 GMP 적합 여부를 정하지 않는다: 식약처 공개 값을 보여 줄 뿐이다
import { h, put } from "../dom.js";
import { publicPanel } from "../public-panel.js";
import { isVaccineItem, matchRecalls, publicCacheKey } from "../../domain/public-data-rules.js";
import { callPublicData } from "../../infrastructure/public-data.js";
import { listProductWorkOrders } from "../../infrastructure/store-work-orders.js";
import { gmpRow, latestGmp, matchApprovals, otherCompanyApprovals, SHOWN_APPROVALS } from "../../domain/regulatory-rules.js";
import { gmpRowsFor } from "../../domain/regulatory-review.js";
import { approvalList, companyView, flagView, gmpDetails, reviewOf, scheduleView } from "./regulatory-views.js";
import { aiPanel } from "../ai-panel.js"; // spec 022 FR-005: QA 확인 요청문 초안
import { regulatoryFacts } from "../../domain/ai-facts-rules.js";

/** 제품 상세 "공개 규제 현황" 탭. 허가정보로 등록한 실제 제품만 (가상 제품은 공개 자료가 없다) */
export function regulatoryTab(product) {
  if (!product.permit_item_code) {
    return h("p", { class: "muted" }, "허가정보로 등록한 제품만 공개 규제 현황을 볼 수 있습니다.");
  }
  return h("div", { class: "stack" }, regulatoryCard(product));
}

/** @param {{ id: string, item_name: string, manufacturer: string | null, permit_item_code: string }} product */
function regulatoryCard(product) {
  // undefined = 아직 못 불러옴. workOrders는 null = 불러오기 실패
  const state = {
    gmp: undefined, gmpRows: [], approvals: undefined, allApprovals: [], otherApprovals: [], recalls: undefined, recallDone: false, notVaccine: false, workOrders: undefined,
    // 자료마다 읽기 상태: ok 읽음 / none 자료 없음 / failed 못 읽음(아직 못 불러온 것 포함). AI 근거 표가 그대로 적는다 (원안 "읽음·내용 없음·못 읽음")
    src: { approvals: "failed", gmp: "failed", recall: "failed", schedule: "failed" }, meta: { scanned: 0, totalCount: 0 },
  };
  if (!product.manufacturer) { state.gmp = null; state.src.gmp = "none"; } // 업체명이 없으면 GMP는 찾지 않는다
  const flagBox = h("div", { class: "regulatory-flag", role: "status", "aria-live": "polite" });
  const companyBox = h("div", { class: "public-panel", "aria-live": "polite" });
  const scheduleBox = h("div", { class: "public-panel", "aria-live": "polite" });
  const requestBox = h("div", null);
  const syncRequest = requestSync(product, state, requestBox);
  const refresh = () => { put(flagBox, flagView(state)); put(companyBox, companyView(state)); put(scheduleBox, scheduleView(state)); syncRequest(); };
  refresh();
  loadSchedule(product, state, refresh);

  return h("section", { class: "panel" },
    h("h2", { class: "section-title" }, "공개 규제 현황"),
    h("p", { class: "public-notice" }, "식약처가 공개한 정보를 그대로 보여 줍니다. 이 앱이 국가출하승인이나 GMP 적합 여부를 정하거나 보증하지 않으며, 업체명으로 맞춘 결과라 같은 회사인지 확인이 필요합니다."),
    flagBox, requestBox,
    h("h3", { class: "subsection-title" }, "국가출하승인 이력"), approvalPanel(product, state, refresh),
    h("h3", { class: "subsection-title" }, "제조사 GMP 적합판정서"), gmpPanel(product, state, refresh),
    h("h3", { class: "subsection-title" }, "승인 로트와 회수 공지 대조"), recallPanel(product, state, refresh),
    h("h3", { class: "subsection-title" }, "업체명 대조"), companyBox,
    h("h3", { class: "subsection-title" }, "계획된 생산과 GMP 유효기간 (작업지시는 교육용 가상 자료)"), scheduleBox,
    h("p", { class: "muted" }, "제조사가 수입사로 나올 수 있고, GMP가 백신 제형을 포함하는지는 제형군 글자로 확인해야 합니다."));
}

function gmpPanel(product, state, refresh) {
  if (!product.manufacturer) return h("p", { class: "muted" }, "제품에 업체명이 없어 GMP 적합판정서를 찾을 수 없습니다.");
  return publicPanel({
    label: "GMP 적합판정서",
    cacheKey: publicCacheKey("gmp", { name: product.manufacturer }),
    load: tracked(state, "gmp", refresh, () => callPublicData("gmp", { name: product.manufacturer })),
    render: (result) => {
      const rows = result.items.map(gmpRow);
      state.gmp = latestGmp(rows, product.manufacturer);
      state.gmpRows = gmpRowsFor(rows, product.manufacturer);
      state.src.gmp = readState(result, state.gmp);
      refresh();
      return gmpDetails(state.gmp, state.gmpRows);
    },
  });
}

function approvalPanel(product, state, refresh) {
  return publicPanel({
    label: "국가출하승인 이력",
    cacheKey: publicCacheKey("shipment", { name: product.item_name }),
    load: tracked(state, "approvals", refresh, () => loadApprovals(product)),
    render: (result) => {
      state.notVaccine = result.notVaccine === true;
      const wanted = { productName: product.item_name, company: product.manufacturer ?? "" };
      state.allApprovals = state.notVaccine ? [] : matchApprovals(result.items, wanted, Infinity); // 회수 대조·추이는 찾은 전체로
      state.otherApprovals = state.notVaccine ? [] : otherCompanyApprovals(result.items, wanted);
      state.approvals = state.allApprovals.slice(0, SHOWN_APPROVALS);
      state.src.approvals = state.notVaccine ? "ok" : readState(result, state.allApprovals.length);
      state.meta = { scanned: result.scanned ?? 0, totalCount: result.totalCount ?? 0 };
      refresh();
      return state.notVaccine
        ? h("p", { class: "muted" }, "백신류가 아니어서 국가출하승인 정보가 없습니다.")
        : approvalList(state.approvals, state.allApprovals, result);
    },
  });
}

function recallPanel(product, state, refresh) {
  return publicPanel({
    label: "회수 공지",
    cacheKey: publicCacheKey("recall", { name: product.item_name }),
    load: tracked(state, "recall", refresh, async () => {
      const result = await callPublicData("recall", { name: product.item_name });
      state.recallDone = true; // 실패도 끝난 것: 그때부터 "대조하지 못함"을 보인다
      return result;
    }),
    render: (result) => {
      state.recalls = matchRecalls(result.items, product.permit_item_code);
      state.src.recall = readState(result, state.recalls.length);
      refresh();
      return h("p", { class: "muted" }, `이 제품의 회수 공지 ${state.recalls.length}건을 불러와 승인 로트의 제조번호와 대조했습니다.`);
    },
  });
}

// FR-005: 위험·주의가 있을 때만 요청문 초안 칸. 확인 목록이 바뀔 때만 다시 그려 눌러 둔 결과가 지워지지 않게 한다
function requestSync(product, state, box) {
  let last = "";
  return () => {
    const review = reviewOf(state);
    const items = review?.needed ? review.items : null;
    const signature = JSON.stringify([items, state.src]); // 자료 읽기 상태가 바뀌어도 근거 표가 달라진다
    if (signature === last) return;
    last = signature;
    put(box, items ? aiPanel({
      kind: "regulatory", title: "QA 확인 요청 글 초안", button: "AI로 QA 확인 요청 글 만들기",
      build: () => regulatoryFacts({ product, items, sources: sourcesOf(state), recalls: state.recalls ?? [] }),
    }) : null);
  };
}

// 자료별 읽기 상태와 건수를 AI 근거 표에 넘긴다
const sourcesOf = (state) => ({
  approvals: { state: state.src.approvals, count: state.allApprovals.length, ...state.meta },
  gmp: { state: state.src.gmp, count: state.gmpRows.length },
  recall: { state: state.src.recall, count: state.recalls?.length ?? 0 },
  schedule: { state: state.src.schedule, count: state.workOrders?.length ?? 0 },
});

// 불러오기에 실패하면 그 자료는 "못 읽음"이 된다 (화면은 그대로, AI 근거 표가 알 수 없다고 적는다)
const tracked = (state, name, refresh, load) => async () => {
  const result = await load();
  if (!result.ok) { state.src[name] = "failed"; refresh(); }
  return result;
};

// 지난 정상 결과(savedAt)로 그린 것은 지금 읽은 것이 아니다. 지금 읽었고 값이 없으면 "자료 없음"
const readState = (result, found) => (result.savedAt ? "failed" : found ? "ok" : "none");

// 읽기만 한다. 실패해도 다른 칸은 그대로 (FR-011 수용 기준 5)
async function loadSchedule(product, state, refresh) {
  try {
    const rows = await listProductWorkOrders(product.id);
    state.workOrders = rows.map((row) => ({ orderNumber: row.order_number, plannedStart: row.planned_start, plannedEnd: row.planned_end, status: row.status }));
    state.src.schedule = state.workOrders.length ? "ok" : "none";
  } catch {
    state.workOrders = null;
    state.src.schedule = "failed";
  }
  refresh();
}

// 백신류가 아닌 제품은 승인 API를 부르지 않는다 (spec Q5). 허가정보 칸과 같은 조회에서 이 제품 줄의 품목 구분을 보고,
// 그 줄을 못 찾으면(넓은 품목명) 비백신이라고 단정하지 않고 승인 API를 부른다
async function loadApprovals(product) {
  const permit = await callPublicData("permit", { name: product.item_name });
  if (!permit.ok) return permit;
  const row = permit.items.find((item) => item.ITEM_SEQ === product.permit_item_code);
  if (row && !isVaccineItem(row)) return { ok: true, notVaccine: true, items: [], fixture: permit.fixture };
  return callPublicData("shipment", { name: product.item_name });
}
