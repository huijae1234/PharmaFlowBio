// IA WO_010000_PG 작업지시 목록 (spec 010 FR-005). 상태 거르기·검색, 줄마다 역할·상태에 맞는 버튼
import { h, badge, formatDateTime, refreshPage } from "../dom.js";
import { openSafely } from "../modal.js";
import { hashWith, NO_SEARCH_RESULT, searchBox } from "../search-box.js";
import { filterChips } from "../filter-chips.js";
import { openCancelModal, openCreateModal, openReleaseModal, openStartModal } from "./work-order-modals.js";
import { can } from "../../domain/roles.js";
import { matchesSearch, normalizeSearch } from "../../domain/search-rules.js";
import { WORK_ORDER_STATUS_LABELS, periodText, plannedLotNumbers, quantityText, workOrderActions } from "../../domain/work-order-rules.js";
import { listLotNumbers, listWorkOrders } from "../../infrastructure/store-work-orders.js";
import { listAcksFor } from "../../infrastructure/store-notifications.js";
import { ackSlot, watchAcks } from "../ack-badge.js";
import { schedulePanel } from "./plan-ai.js"; // spec 024: 일정에 영향을 주는 미완료 업무 확인

// 저장 직후 한 번만 보여 줄 결과 문구
let pendingNotice = "";

function afterSave(notice) {
  pendingNotice = notice;
  refreshPage();
}

// 새 작업지시가 거르기·검색에 가려지지 않게, 작성 뒤에는 조건 없는 목록을 보여 준다 (qa 010 실패와 조치 3)
function afterCreate(notice) {
  pendingNotice = notice;
  if (location.hash === "#/work-orders") refreshPage();
  else location.hash = "#/work-orders";
}

const ACTION_BUTTONS = {
  release: { label: "발행", open: (order) => openReleaseModal(order, afterSave), primary: true },
  start: { label: "착수", open: (order) => openStartModal(order), primary: true },
  cancel: { label: "취소", open: (order) => openCancelModal(order, afterSave) },
};

/** @param {{ profile: { role: string }, query: Record<string, string> }} context */
export async function renderWorkOrders({ profile, query }) {
  const status = WORK_ORDER_STATUS_LABELS[query.status] ? query.status : "";
  const term = normalizeSearch(query.q);
  const [loaded, lots] = await Promise.all([listWorkOrders(), listLotNumbers().catch(() => [])]); // 예정 번호를 못 구하면 칸만 비고 직접 입력
  // 발행된 작업지시에 착수 때 쓸 로트번호를 미리 보여 준다 (2026-10-29 사용자: 작업지시 번호를 로트번호로 쓰는 일이 있었다)
  const planned = plannedLotNumbers(loaded, lots, new Date());
  const orders = loaded.map((order) => ({ ...order, planned_lot: planned.get(order.id) ?? null }));
  const notice = pendingNotice;
  pendingNotice = "";

  const products = [...new Set(orders.map((order) => order.product?.item_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const product = products.includes(query.product) ? query.product : "";
  const inProduct = product ? orders.filter((order) => order.product?.item_name === product) : orders; // 상태 칩 건수는 고른 제품 안에서
  const shown = inProduct
    .filter((order) => !status || order.status === status)
    .filter((order) => matchesSearch([order.order_number, order.product?.item_name, order.batch?.batch_number], term));
  const go = (next) => { location.hash = hashWith("#/work-orders", { status, q: term, product, ...next }); };
  // 제품(군)으로 거르기: 작업지시마다 정해진 제품이 있어 제품 이름으로 모아 본다 (로트의 제품군 거르기와 같은 뜻)
  const productSelect = h("select", { class: "select", "aria-label": "제품으로 거르기", onchange: () => go({ product: productSelect.value }) },
    h("option", { value: "" }, `전체 제품 (${orders.length})`),
    ...products.map((name) => h("option", { value: name, selected: name === product }, `${name} (${orders.filter((order) => order.product?.item_name === name).length})`)));
  const filter = filterChips({
    label: "작업지시 상태로 거르기",
    value: status,
    options: [
      { value: "", text: "전체", count: inProduct.length },
      ...Object.entries(WORK_ORDER_STATUS_LABELS).map(([value, text]) => ({ value, text, count: inProduct.filter((order) => order.status === value).length })),
    ],
    onChange: (value) => go({ status: value }),
  });

  const view = h("div", { class: "stack" },
    h("div", { class: "page-header" },
      h("h1", { class: "page-title" }, "작업지시"),
      can(profile.role, "create_work_order")
        ? h("button", { class: "button button--primary", type: "button", onclick: openSafely(() => openCreateModal(afterCreate)) }, "작업지시 작성")
        : null),
    notice ? h("p", { class: "status-text", role: "status" }, notice) : null,
    schedulePanel({ profile }),
    h("div", { class: "toolbar toolbar--spread" },
      filter,
      h("div", { class: "toolbar" },
        productSelect,
        searchBox({ label: "작업지시 검색", placeholder: "작업지시 번호·제품 이름·로트번호", value: term, onSearch: (q) => go({ q }) }))),
    h("section", { class: "panel" },
      workOrderTable(profile.role, shown,
        term ? NO_SEARCH_RESULT : status || product ? "조건에 맞는 작업지시가 없습니다." : "아직 작업지시가 없습니다.")));
  // spec 009 v0.7 FR-009: 발행 알림을 생산 담당자가 슬랙에서 확인했는지
  watchAcks(view, () => listAcksFor("work_order", shown.map((order) => order.id), ["work_order_released"]));
  return view;
}

// 작성 → 발행 → 착수 또는 취소를 한 칸에 줄로 (표가 옆으로 길어지지 않게)
function timeline(order) {
  const who = (name, iso) => `${name ?? ""} · ${formatDateTime(iso)}`;
  const lines = [
    `작성 ${who(order.creator?.display_name, order.created_at)}`,
    order.released_at ? `발행 ${who(order.releaser?.display_name, order.released_at)}` : null,
    order.started_at ? `착수 ${who(order.starter?.display_name, order.started_at)}` : null,
    order.cancelled_at ? `취소 ${who(order.canceller?.display_name, order.cancelled_at)}` : null,
  ].filter(Boolean);
  return h("ul", { class: "plain-list timeline" }, ...lines.map((line) => h("li", null, line)));
}

function actionButtons(role, order) {
  return workOrderActions(role, order).map((action) => {
    const { label, open, primary } = ACTION_BUTTONS[action];
    return h("button", {
      class: primary ? "button button--primary" : "button",
      type: "button",
      "aria-label": `${order.order_number} ${label}`,
      onclick: () => open(order),
    }, label);
  });
}

/**
 * FR-005 수용 기준 1~6: 번호·제품·계획 수량·계획 기간·상태(글자 배지)·로트번호·누가 언제·처리
 * @param {string} role
 * @param {object[]} rows
 * @param {string} emptyText
 */
function workOrderTable(role, rows, emptyText) {
  if (!rows.length) return h("p", { class: "muted" }, emptyText);
  const headers = ["작업지시 번호", "제품", "계획 수량", "계획 기간", "상태", "로트번호", "누가 · 언제", "처리"];
  return h("div", { class: "table-wrap" },
    h("table", { class: "table" },
      h("thead", null, h("tr", null, ...headers.map((title) => h("th", { scope: "col" }, title)))),
      h("tbody", null, ...rows.map((order) => h("tr", null,
        h("td", { class: "mono" }, order.order_number),
        h("td", { class: "cell-wrap" }, order.product?.item_name ?? ""),
        h("td", null, quantityText(order)),
        h("td", { class: "mono" }, periodText(order)),
        h("td", null,
          badge(`work_order_${order.status}`, WORK_ORDER_STATUS_LABELS[order.status]),
          order.cancel_reason ? h("p", { class: "muted cell-wrap" }, `사유: ${order.cancel_reason}`) : null),
        h("td", null, order.batch
          ? h("a", { class: "mono", href: `#/batches/${order.batch.id}` }, order.batch.batch_number)
          : order.planned_lot ? h("span", { class: "muted" }, "예정 ", h("span", { class: "mono" }, order.planned_lot)) : ""),
        h("td", { class: "muted cell-wrap" }, timeline(order), ackSlot(order.id)),
        h("td", null, h("div", { class: "toolbar" }, ...actionButtons(role, order))))))));
}
