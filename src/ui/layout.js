import { h } from "./dom.js";
import { isReadOnly, menuFor, roleLabel } from "../domain/roles.js";
import { renderInbox } from "./inbox.js";
import { renderAssistant } from "./assistant.js";
import { canUseChat } from "../domain/chat-rules.js";
import { registerHomeBadge } from "./home-badge.js";
import { listPendingRequests } from "../infrastructure/store-actions.js";
import { listPendingReviews } from "../infrastructure/store-reviews.js";

// FR-003 (spec 001): 열람자 안내 문구
const VIEWER_NOTICE = "역할을 받기 전에는 읽기만 할 수 있습니다. QA 관리자에게 역할을 요청해 주세요.";
// 포트폴리오 사본: 게스트는 역할을 받을 수 없으므로 요청 안내 대신 둘러보기 안내
const GUEST_NOTICE = "게스트로 둘러보는 중입니다. 읽기만 할 수 있고, 로그아웃하면 게스트 기록이 지워집니다.";

// 홈 개편: 메뉴를 업무 / 기준정보 / 관리로 묶는다 (주소로 나눔, 메뉴 자체는 roles.js 그대로)
const NAV_GROUPS = [
  { label: "업무", prefixes: ["#/home", "#/batches", "#/work-orders", "#/issues", "#/samples"] },
  { label: "기준정보", prefixes: ["#/products"] },
  { label: "관리", prefixes: ["#/admin"] },
];
const APPROVALS_PATH = "#/admin/approvals";

/**
 * @param {{ role: string, isGuest?: boolean, userId?: string, userName?: string, currentPath: string, content: Node, onSignOut?: () => void }} options
 */
export function renderLayout({ role, isGuest = false, userId, userName, currentPath, content, onSignOut }) {
  const items = menuFor(role);
  const approvalCount = h("span", { class: "nav-count" });
  const homeCount = h("span", { class: "nav-count", "aria-label": "내 할 일 건수" });
  const groups = NAV_GROUPS
    .map((group) => ({ group, items: items.filter((item) => group.prefixes.some((prefix) => item.path.startsWith(prefix))) }))
    .filter(({ items: groupItems }) => groupItems.length);

  const sidebar = h("nav", { class: "sidebar", "aria-label": "주 메뉴" },
    h("div", { class: "brand" },
      h("span", null, "PharmaFlow ", h("span", { class: "brand-sub" }, "Bio")), // spec 007 FR-001
      h("button", {
        class: "button menu-toggle",
        type: "button",
        "aria-expanded": "false",
        onclick: (event) => toggleMenu(sidebar, event.currentTarget),
      }, "메뉴")),
    ...groups.map(({ group, items: groupItems }) => h("div", { class: "nav-group" },
      h("p", { class: "nav-group-label" }, group.label),
      h("ul", { class: "nav-list" }, ...groupItems.map((item) => h("li", null,
        h("a", { href: item.path, "aria-current": currentPath === item.path ? "page" : null },
          item.label, item.path === APPROVALS_PATH ? approvalCount : null, item.path.startsWith("#/home") ? homeCount : null)))))));
  registerHomeBadge(homeCount);

  if (items.some((item) => item.path === APPROVALS_PATH)) fillApprovalCount(approvalCount);

  const topbar = userName
    ? h("header", { class: "topbar" },
        userId ? renderInbox(userId) : null, // spec 009 FR-007
        h("span", null, `${userName} · ${roleLabel(role)}`),
        onSignOut ? h("button", { class: "button", type: "button", onclick: onSignOut }, "로그아웃") : null)
    : null;

  return h("div", { class: "shell" },
    sidebar,
    h("div", { class: "main" },
      topbar,
      isReadOnly(role) ? h("p", { class: "notice", role: "status" }, isGuest ? GUEST_NOTICE : VIEWER_NOTICE) : null,
      h("main", { id: "content", class: "content", tabindex: "-1" }, content)),
    canUseChat(role) ? renderAssistant(role) : null); // spec 025 FR-001: 직원 역할만. 화면을 옮기면 새로 그려져 대화가 비워진다
}

// 승인 대기 건수(조치 요청 + 영향 평가)를 메뉴 옆에. 못 읽으면 숫자만 비워 둔다
async function fillApprovalCount(target) {
  try {
    const [requests, reviews] = await Promise.all([listPendingRequests(), listPendingReviews()]);
    const count = requests.length + reviews.length;
    target.textContent = count ? String(count) : "";
  } catch {
    target.textContent = "";
  }
}

function toggleMenu(sidebar, button) {
  const open = sidebar.classList.toggle("is-open");
  button.setAttribute("aria-expanded", String(open));
}
