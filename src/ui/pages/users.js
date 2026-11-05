// IA AD_020000_PG 사용자·역할. FR-004 (spec 001): QA 관리자만, 자기 역할은 못 바꾼다
import { h, formatDateTime } from "../dom.js";
import { svg } from "../svg.js";
import { ROLES, maskEmail, roleLabel } from "../../domain/roles.js";
import { listUsers, setUserRole } from "../../infrastructure/store.js";

/** @param {{ profile: { id: string } }} context */
export async function renderUsers({ profile }) {
  const users = await listUsers();
  const status = h("p", { class: "status-text", role: "status" });
  return h("div", { class: "stack" },
    h("h1", { class: "page-title" }, "사용자·역할"),
    h("p", { class: "muted" }, "새로 로그인한 사람이 맨 위에 있습니다. 역할을 고르면 그 사람이 다음 화면으로 이동할 때부터 적용됩니다."),
    status,
    h("div", { class: "table-wrap panel" },
      h("table", { class: "table" },
        h("thead", null, h("tr", null,
          h("th", { scope: "col" }, "이름"),
          h("th", { scope: "col" }, "이메일"),
          h("th", { scope: "col" }, "역할"),
          h("th", { scope: "col" }, "처음 로그인"))),
        h("tbody", null, ...users.map((user) => userRow(user, user.id === profile.id, status))))));
}

function userRow(user, isMe, status) {
  return h("tr", null,
    h("td", null, user.display_name, isMe ? h("span", { class: "muted" }, " (본인)") : null),
    emailCell(user.email),
    h("td", null, roleSelect(user, isMe, status)),
    h("td", { class: "muted" }, formatDateTime(user.created_at)));
}

// 기본은 가린 채로 두고, 눈 단추를 누른 줄만 보인다. 화면 표시만 가리는 것이라 권한은 그대로다(이메일은 QA 관리자만 읽음)
function emailCell(email) {
  if (!email) return h("td", { class: "muted" }, "없음");
  const text = h("span", { class: "break" }, maskEmail(email));
  const button = h("button", {
    class: "button button--ghost email-toggle",
    type: "button",
    "aria-label": "이메일 보기",
    "aria-pressed": "false",
    title: "이메일 보기",
    onclick: () => {
      const shown = button.getAttribute("aria-pressed") !== "true";
      text.textContent = shown ? email : maskEmail(email);
      button.setAttribute("aria-pressed", String(shown));
      button.replaceChildren(eyeIcon(shown));
    },
  }, eyeIcon(false));
  return h("td", null, h("span", { class: "email-cell" }, text, button));
}

// 보이는 중이면 빗금 친 눈
function eyeIcon(shown) {
  return svg("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "aria-hidden": "true", focusable: "false" },
    svg("path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" }),
    svg("circle", { cx: 12, cy: 12, r: 3 }),
    shown ? svg("path", { d: "M3 3l18 18" }) : null);
}

function roleSelect(user, isMe, status) {
  const select = h("select", {
    class: "select",
    "aria-label": `${user.display_name} 역할`,
    disabled: isMe,
    title: isMe ? "QA 관리자는 자기 역할을 바꿀 수 없습니다." : null,
    onchange: async () => {
      const previous = user.role;
      select.disabled = true;
      try {
        await setUserRole(user.id, select.value);
        user.role = select.value;
        status.textContent = `${user.display_name}의 역할을 ${roleLabel(select.value)}(으)로 바꿨습니다.`;
      } catch (error) {
        select.value = previous;
        status.textContent = error.message;
      } finally {
        select.disabled = false;
      }
    },
  }, ...ROLES.map((role) => h("option", { value: role, selected: role === user.role }, roleLabel(role))));
  return select;
}
