// IA SM_010000_PG 검체 목록 (spec 008 FR-005). 위쪽 "확인할 검체", 아래 전체 기록 표. 보관 기한·폐기 (spec 018)
import { h, badge, formatDateTime, refreshPage } from "../dom.js";
import { openSafely } from "../modal.js";
import { hashWith, NO_SEARCH_RESULT, searchBox } from "../search-box.js";
import { chipGroup, filterChips } from "../filter-chips.js";
import {
  openConfirmReturnModal, openConsumeModal, openDisposeModal, openReceiveModal, openReturnModal, openSendModal, transferLine,
} from "./sample-modals.js";
import { matchesSearch, normalizeSearch } from "../../domain/search-rules.js";
import {
  SAMPLE_KIND_LABELS, SAMPLE_STATUS_LABELS, availableActions, canDispose, isRetentionDue, retentionDueDate, routeLabel,
  routesFor, seoulDate, teamOf,
} from "../../domain/sample-rules.js";
import { listBatches } from "../../infrastructure/store.js";
import { listSamples } from "../../infrastructure/store-samples.js";
import { listAcksFor } from "../../infrastructure/store-notifications.js";
import { ackSlot, watchAcks } from "../ack-badge.js";

const ACTION_BUTTONS = {
  receive: { label: "인수 확인", open: openReceiveModal, primary: true },
  confirm_return: { label: "반납 확인", open: openConfirmReturnModal, primary: true },
  return: { label: "반납", open: openReturnModal },
  consume: { label: "소진", open: openConsumeModal },
};

// 저장 직후 한 번만 보여 줄 결과 문구
let pendingNotice = "";

/** 저장 뒤 같은 화면을 다시 그리며 결과 문구를 보여 준다 */
export function afterSave(notice) {
  pendingNotice = notice;
  refreshPage();
}

/** @param {{ profile: { role: string }, query: Record<string, string> }} context */
export async function renderSamples({ profile, query }) {
  const status = SAMPLE_STATUS_LABELS[query.status] ? query.status : "";
  const kind = SAMPLE_KIND_LABELS[query.kind] ? query.kind : "";
  const term = normalizeSearch(query.q);
  const transfers = await listSamples();
  const notice = pendingNotice;
  pendingNotice = "";

  const today = seoulDate(new Date());
  // FR-005: 내 팀이 인수 확인하거나 반납 확인할 건 + spec 018 FR-005: QA는 기한 지난 보존 검체
  const toCheck = transfers.filter((t) => availableActions(profile.role, t).some((a) => a === "receive" || a === "confirm_return")
    || canDispose(profile.role, t, today));
  const shown = transfers
    .filter((t) => (!status || t.status === status) && (!kind || t.sample_kind === kind))
    .filter((t) => matchesSearch([t.batch?.batch_number, t.batch?.product?.item_name], term));
  const go = (next) => { location.hash = hashWith("#/samples", { status, kind, q: term, ...next }); };

  const view = h("div", { class: "stack" },
    h("div", { class: "page-header" },
      h("h1", { class: "page-title" }, "검체"),
      routesFor(profile.role).length
        ? h("button", { class: "button button--primary", type: "button", onclick: openSafely(() => openSend(profile.role, transfers)) }, "검체 전달 등록")
        : null),
    notice ? h("p", { class: "status-text", role: "status" }, notice) : null,
    checkSection(profile.role, toCheck, transfers, today),
    h("div", { class: "toolbar toolbar--groups" },
      chipGroup("상태", filterChips({
        label: "검체 상태로 거르기", value: status,
        options: [{ value: "", text: "전체", count: transfers.length }, ...Object.entries(SAMPLE_STATUS_LABELS).map(([value, text]) => ({ value, text, count: transfers.filter((t) => t.status === value).length }))],
        onChange: (value) => go({ status: value }),
      })),
      chipGroup("종류", filterChips({
        label: "검체 종류로 거르기", value: kind,
        options: [{ value: "", text: "전체" }, ...Object.entries(SAMPLE_KIND_LABELS).map(([value, text]) => ({ value, text }))],
        onChange: (value) => go({ kind: value }),
      })),
      searchBox({ label: "검체 검색", placeholder: "로트번호·제품 이름", value: term, onSearch: (q) => go({ q }) })),
    h("section", { class: "panel" },
      sampleTable(profile.role, shown,
        term ? NO_SEARCH_RESULT : status || kind ? "이 조건의 검체 기록이 없습니다." : "아직 검체 기록이 없습니다.",
        { allTransfers: transfers })));
  // spec 009 v0.7 FR-009: 슬랙 확인을 그 검체 줄 옆에, 30초마다
  watchAcks(view, () => listAcksFor("sample_transfer", shown.map((t) => t.id)));
  return view;
}

async function openSend(role, transfers) {
  const batches = await listBatches({ limit: 200 });
  openSendModal({ role, batches, transfers, onSaved: afterSave });
}

// 확인할 검체 한 줄의 설명: 누가 보냈나 / 반납했나 / 기한이 지났나
function checkNote(t) {
  if (t.status === "pending") return `보낸 사람 ${t.sender?.display_name ?? ""} · ${formatDateTime(t.sent_at)}`;
  if (t.status === "return_pending") return `반납자 ${t.returner?.display_name ?? ""} · ${formatDateTime(t.return_requested_at)}`;
  return `보관 기한 지남 · 기한 ${retentionDueDate(t)}`; // spec 018 FR-005
}

function checkSection(role, rows, transfers, today) {
  if (!teamOf(role)) return null; // 열람자: 확인할 일이 없다
  return h("section", { class: "panel" },
    h("h2", { class: "section-title" }, `확인할 검체 ${rows.length}건`),
    rows.length
      ? h("ul", { class: "plain-list" }, ...rows.map((t) => h("li", { class: "check-item" },
          badge(`sample_${t.status}`, SAMPLE_STATUS_LABELS[t.status]), " ",
          h("span", { class: "mono" }, transferLine(t)), " ",
          h("span", { class: "muted" }, checkNote(t)), " ",
          ...actionButtons(role, t, transfers, today))))
      : h("p", { class: "muted" }, "지금 확인할 검체가 없습니다."));
}

function actionButtons(role, transfer, transfers, today) {
  const buttons = availableActions(role, transfer).map((action) => {
    const { label, open, primary } = ACTION_BUTTONS[action];
    return h("button", {
      class: primary ? "button button--primary" : "button",
      type: "button",
      onclick: () => open(transfer, afterSave),
    }, label);
  });
  // spec 018 FR-004: 기한 지난 보존 검체는 QA 관리자에게 [폐기]
  if (canDispose(role, transfer, today)) {
    const lotTransfers = transfers.filter((t) => t.batch_id === transfer.batch_id);
    buttons.push(h("button", { class: "button", type: "button", onclick: () => openDisposeModal(transfer, lotTransfers, afterSave) }, "폐기"));
  }
  return buttons;
}

function who(name, iso) {
  return name ? `${name} · ${formatDateTime(iso)}` : "";
}

// 반납·소진 줄: 끝난 방식에 따라
function closingLines(t) {
  if (t.status === "consumed") return [`소진 ${who(t.consumer?.display_name, t.consumed_at)}`];
  if (t.status === "disposed") { // spec 018 FR-004
    return [`폐기 ${who(t.disposer?.display_name, t.disposed_at)}`,
      `${t.disposed_quantity} ${t.unit}${t.dispose_note ? ` · ${t.dispose_note}` : ""}`];
  }
  if (t.status === "return_pending") {
    return [`반납 ${who(t.returner?.display_name, t.return_requested_at)}`, `${t.returned_quantity} ${t.unit} · 반납 확인 대기`];
  }
  if (t.status === "returned") {
    return [`반납 ${t.returner?.display_name ?? ""} · ${t.returned_quantity} ${t.unit}`,
      `반납 확인 ${who(t.return_confirmer?.display_name, t.returned_at)}`];
  }
  return [];
}

// 보냄 → 인수 → 반납·소진을 한 칸에 줄로 (표가 옆으로 길어지지 않게)
function timeline(t) {
  const lines = [
    `보냄 ${who(t.sender?.display_name, t.sent_at)}`,
    t.received_at ? `인수 ${who(t.receiver?.display_name, t.received_at)}` : null,
    ...closingLines(t),
  ].filter(Boolean);
  return h("ul", { class: "plain-list timeline" }, ...lines.map((line) => h("li", null, line)));
}

/**
 * FR-005 수용 기준 1, FR-006: 검체 기록 표 (검체 목록과 로트 상세 검체 탭이 함께 쓴다)
 * @param {string} role
 * @param {object[]} rows
 * @param {string} emptyText
 * @param {{ hideBatch?: boolean, allTransfers?: object[] }} [options] allTransfers: 폐기 수량을 셀 같은 로트 기록 (거르기 전)
 */
export function sampleTable(role, rows, emptyText, { hideBatch = false, allTransfers = rows } = {}) {
  if (!rows.length) return h("p", { class: "muted" }, emptyText);
  const today = seoulDate(new Date());
  const headers = [...(hideBatch ? [] : ["로트번호", "제품"]), "길 · 종류", "수량", "상태", "보관 기한", "보관 위치", "누가 · 언제", "처리"];
  return h("div", { class: "table-wrap" },
    h("table", { class: "table" },
      h("thead", null, h("tr", null, ...headers.map((title) => h("th", { scope: "col" }, title)))),
      h("tbody", null, ...rows.map((t) => h("tr", null,
        ...(hideBatch ? [] : [
          h("td", null, h("a", { class: "mono", href: `#/batches/${t.batch_id}?tab=samples` }, t.batch?.batch_number ?? "")),
          h("td", { class: "cell-wrap" }, t.batch?.product?.item_name ?? ""),
        ]),
        h("td", null, routeLabel({ from: t.from_team, to: t.to_team, kind: t.sample_kind })),
        h("td", null, `${t.quantity} ${t.unit}`),
        h("td", null, badge(`sample_${t.status}`, SAMPLE_STATUS_LABELS[t.status])),
        h("td", null, retentionCell(t, today)),
        h("td", { class: "cell-wrap" }, t.storage_location ?? ""),
        h("td", { class: "muted cell-wrap" }, timeline(t), ackSlot(t.id)),
        h("td", null, h("div", { class: "toolbar" }, ...actionButtons(role, t, allTransfers, today))))))));
}

// spec 018 FR-002: 생산 → QA 보존 검체만 기한. 보관 중이고 지났으면 "기한 지남" 글자 (색만으로 구분하지 않음)
function retentionCell(t, today) {
  const due = retentionDueDate(t);
  if (!due) return "";
  return h("span", { class: "mono" }, due, isRetentionDue(t, today) ? " " : null, isRetentionDue(t, today) ? badge("retention_due", "기한 지남") : null);
}
