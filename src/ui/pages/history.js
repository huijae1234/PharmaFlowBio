// IA AD_030000_PG 전체 업무 이력 (QA 관리자만). FR-013 (spec 002): 최근순 50개씩, 사람·배치번호·기간으로 거르기. 거르기는 주소에 남긴다
import { h, formatDateTime } from "../dom.js";
import { field } from "../modal.js";
import { dayRange } from "../../domain/dashboard-rules.js";
import { roleLabel } from "../../domain/roles.js";
import { listUsers } from "../../infrastructure/store.js";
import { findBatchId, listWorkHistory } from "../../infrastructure/store-dashboard.js";

const FILTER_KEYS = ["actor", "batch", "from", "to"];

/** @param {{ query: Record<string, string> }} context */
export async function renderHistory({ query }) {
  const page = Math.max(0, Number.parseInt(query.page ?? "0", 10) || 0);
  const users = await listUsers();
  const form = filterForm(users, query);
  const result = await loadRows(query, page);
  return h("div", { class: "stack" },
    h("h1", { class: "page-title" }, "전체 업무 이력"),
    h("section", { class: "panel" }, form),
    h("section", { class: "panel" }, result.error
      ? h("p", { class: "error-text", role: "alert" }, result.error)
      : historyTable(result.rows, FILTER_KEYS.some((key) => query[key])),
    result.error ? null : pager(query, page, result.hasMore)));
}

async function loadRows(query, page) {
  const range = dayRange(query.from ?? "", query.to ?? "");
  if (!range.ok) return { error: range.error };
  let batchId;
  if (query.batch) {
    batchId = await findBatchId(query.batch.trim());
    if (!batchId) return { error: `로트번호 ${query.batch}를 찾을 수 없습니다. 로트번호를 확인해 주세요.` };
  }
  return listWorkHistory({ actorId: query.actor, batchId, from: range.from, to: range.to, page });
}

function filterForm(users, query) {
  const actor = h("select", { class: "select", name: "actor" },
    h("option", { value: "" }, "모든 사람"),
    ...users.map((user) => h("option", { value: user.id, selected: user.id === query.actor }, user.display_name)));
  const batch = h("input", { class: "input mono", name: "batch", autocomplete: "off", placeholder: "PF-2610-001" });
  batch.value = query.batch ?? "";
  const from = h("input", { class: "input", type: "date", name: "from" });
  from.value = query.from ?? "";
  const to = h("input", { class: "input", type: "date", name: "to" });
  to.value = query.to ?? "";
  return h("form", {
    class: "filter-form",
    onsubmit: (event) => {
      event.preventDefault();
      location.hash = historyHash({ actor: actor.value, batch: batch.value.trim(), from: from.value, to: to.value });
    },
  },
  field("사람", actor), field("로트번호", batch), field("시작일", from), field("끝일", to),
  h("div", { class: "toolbar" },
    h("button", { class: "button button--primary", type: "submit" }, "거르기"),
    h("a", { class: "button", href: "#/admin/history" }, "모두 보기")));
}

function historyHash(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, String(value));
  const text = search.toString();
  return text ? `#/admin/history?${text}` : "#/admin/history";
}

function historyTable(rows, filtered) {
  if (!rows.length) return h("p", { class: "muted" }, filtered ? "이 조건의 업무 이력이 없습니다." : "아직 업무 이력이 없습니다.");
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ...["시각", "이름(역할)", "행동", "로트번호"].map((title) => h("th", { scope: "col" }, title)))),
    h("tbody", null, ...rows.map((row) => h("tr", null,
      h("td", { class: "muted" }, formatDateTime(row.created_at)),
      h("td", null, `${row.actor_name} (${roleLabel(row.actor_role)})`),
      h("td", null, row.action),
      // FR-013 수용 기준 3: 역할 지정처럼 배치가 없는 이력은 빈 칸
      h("td", { class: "mono" }, row.batch?.batch_number ?? ""))))));
}

function pager(query, page, hasMore) {
  if (page === 0 && !hasMore) return null;
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, query[key]]));
  return h("nav", { class: "toolbar", "aria-label": "업무 이력 쪽" },
    page > 0 ? h("a", { class: "button", href: historyHash({ ...filters, page: page - 1 }) }, "이전 50개") : null,
    hasMore ? h("a", { class: "button", href: historyHash({ ...filters, page: page + 1 }) }, "다음 50개") : null);
}
