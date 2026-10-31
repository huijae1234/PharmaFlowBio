// IA AD_020000_PG 사용자·역할. FR-004 (spec 001): QA 관리자만, 자기 역할은 못 바꾼다
import { h, formatDateTime } from "../dom.js";
import { ROLES, roleLabel } from "../../domain/roles.js";
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
    h("td", { class: "break" }, user.email),
    h("td", null, roleSelect(user, isMe, status)),
    h("td", { class: "muted" }, formatDateTime(user.created_at)));
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
