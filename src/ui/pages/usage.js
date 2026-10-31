// IA AD_040000_PG 사용 기록 (QA 관리자만). spec 003 FR-009: 최근순 50개씩, 사람·종류로 거르기. 거르기는 주소에 남긴다
import { h, formatDateTime } from "../dom.js";
import { field } from "../modal.js";
import { filterChips } from "../filter-chips.js";
import { SHOWN_USAGE_TYPES, eventLabel, notificationResultText, successLabel, usageDetail } from "../../domain/usage-rules.js";
import { slackAckText } from "../../domain/inbox-rules.js";
import { listUsers } from "../../infrastructure/store.js";
import { listUsage } from "../../infrastructure/store-products.js";
import { listNotifications } from "../../infrastructure/store-notifications.js";

/** @param {{ query: Record<string, string> }} context */
export async function renderUsage({ query }) {
  // UI 개편: 맨 위 전환으로 사용 기록 / 슬랙 알림 기록을 번갈아 본다 (슬랙 기록이 표 맨 아래에 있어 끝까지 내려야 했다)
  const view = query.view === "slack" ? "slack" : "usage";
  const switcher = filterChips({
    label: "보기 전환",
    value: view,
    options: [{ value: "usage", text: "사용 기록" }, { value: "slack", text: "슬랙 알림 기록" }],
    onChange: (next) => { location.hash = next === "slack" ? "#/admin/usage?view=slack" : "#/admin/usage"; },
  });
  if (view === "slack") {
    return h("div", { class: "stack" }, h("h1", { class: "page-title" }, "사용 기록"), switcher, await notificationSection());
  }
  const page = Math.max(0, Number.parseInt(query.page ?? "0", 10) || 0);
  const type = SHOWN_USAGE_TYPES.includes(query.type) ? query.type : "";
  const types = type ? [type] : SHOWN_USAGE_TYPES;
  const [users, result] = await Promise.all([listUsers(), listUsage({ userId: query.user, types, page })]);
  return h("div", { class: "stack" },
    h("h1", { class: "page-title" }, "사용 기록"),
    switcher,
    h("section", { class: "panel" }, filterForm(users, query.user ?? "", type)),
    h("section", { class: "panel" },
      usageTable(result.rows, Boolean(query.user || type)),
      pager({ user: query.user, type }, page, result.hasMore)));
}

// spec 009 FR-005: 최근 슬랙 알림 30건. 불러오지 못해도 사용 기록은 그대로 보인다
async function notificationSection() {
  let rows;
  try {
    rows = await listNotifications(30);
  } catch (error) {
    return h("section", { class: "panel" }, h("h2", { class: "section-title" }, "슬랙 알림 기록"),
      h("p", { class: "error-text", role: "alert" }, error.message));
  }
  return h("section", { class: "panel" },
    h("h2", { class: "section-title" }, "슬랙 알림 기록"),
    h("p", { class: "muted" }, "최근 30건. 받는 사람에게 슬랙 개인 메시지로, 슬랙에서 못 찾으면 알림 채널로 보냅니다."),
    rows.length ? notificationTable(rows) : h("p", { class: "muted" }, "아직 슬랙 알림이 없습니다."));
}

function notificationTable(rows) {
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ...["시각", "받는 사람", "내용", "결과", "확인", "일으킨 사람"].map((title) => h("th", { scope: "col" }, title)))),
    h("tbody", null, ...rows.map((row) => h("tr", null,
      h("td", { class: "muted" }, formatDateTime(row.created_at)),
      h("td", null, row.recipient?.display_name ?? ""),
      h("td", { class: "cell-wrap" }, row.message),
      h("td", { class: "cell-wrap" }, notificationResultText(row)),
      h("td", { class: "muted" }, slackAckText(row.slack_acknowledged_at, formatDateTime)), // spec 009 v0.6 FR-008 수용 기준 4
      h("td", null, row.creator?.display_name ?? ""))))));
}

function usageHash(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value || value === 0) search.set(key, String(value));
  const text = search.toString();
  return text ? `#/admin/usage?${text}` : "#/admin/usage";
}

function filterForm(users, selectedUser, selectedType) {
  const user = h("select", { class: "select", name: "user" },
    h("option", { value: "" }, "모든 사람"),
    ...users.map((item) => h("option", { value: item.id, selected: item.id === selectedUser }, item.display_name)));
  const type = h("select", { class: "select", name: "type" },
    h("option", { value: "" }, "모든 종류"),
    ...SHOWN_USAGE_TYPES.map((value) => h("option", { value, selected: value === selectedType }, eventLabel(value))));
  return h("form", {
    class: "filter-form",
    onsubmit: (event) => {
      event.preventDefault();
      location.hash = usageHash({ user: user.value, type: type.value });
    },
  },
  field("사람", user), field("종류", type),
  h("div", { class: "toolbar" },
    h("button", { class: "button button--primary", type: "submit" }, "거르기"),
    h("a", { class: "button", href: "#/admin/usage" }, "모두 보기")));
}

// FR-009 수용 기준 1·2: 시각, 이름, 종류, 내용, 성공 여부(글자), 걸린 시간
function usageTable(rows, filtered) {
  if (!rows.length) return h("p", { class: "muted" }, filtered ? "이 조건의 사용 기록이 없습니다." : "아직 사용 기록이 없습니다.");
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ...["시각", "이름", "종류", "내용", "결과", "걸린 시간"].map((title) => h("th", { scope: "col" }, title)))),
    h("tbody", null, ...rows.map((row) => h("tr", null,
      h("td", { class: "muted" }, formatDateTime(row.created_at)),
      h("td", null, row.user?.display_name ?? ""),
      h("td", null, eventLabel(row.event_type)),
      h("td", null, usageDetail(row)),
      h("td", null, successLabel(row.success)),
      h("td", { class: "mono" }, row.duration_ms === null ? "" : `${row.duration_ms}ms`))))));
}

function pager(filters, page, hasMore) {
  if (page === 0 && !hasMore) return null;
  return h("nav", { class: "toolbar", "aria-label": "사용 기록 쪽" },
    page > 0 ? h("a", { class: "button", href: usageHash({ ...filters, page: page - 1 }) }, "이전 50개") : null,
    hasMore ? h("a", { class: "button", href: usageHash({ ...filters, page: page + 1 }) }, "다음 50개") : null);
}
