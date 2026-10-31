// spec 009 FR-007: 위쪽 "알림 N" 버튼과 알림 함. 앱을 열어 둔 동안 1분마다, 화면을 옮길 때마다 새로 확인한다
import { h, put, formatDateTime } from "./dom.js";
import { inboxAriaLabel, inboxLabel, inboxMetaText, isSafeAppPath, slackAckText } from "../domain/inbox-rules.js";
import {
  checkDueRetention, countMyUnread, flushNotifications, listMyNotifications, markNotificationsRead,
} from "../infrastructure/store-notifications.js";

const REFRESH_MS = 60_000;
let timer = null; // 화면을 다시 그려도 확인은 하나만 돈다
let outsideClick = null; // 바깥을 누르면 닫기. 화면을 다시 그릴 때 예전 것은 뗀다

/** @param {string} userId */
export function renderInbox(userId) {
  const button = h("button", {
    class: "button inbox-button", type: "button", "aria-expanded": "false", "aria-controls": "inbox-panel",
  }, inboxLabel(0));
  const panel = h("section", { id: "inbox-panel", class: "inbox-panel panel", "aria-label": "알림 함", hidden: true });
  const wrapper = h("div", { class: "inbox" }, button, panel);

  const refresh = async () => {
    try {
      const unread = await countMyUnread(userId);
      button.textContent = inboxLabel(unread);
      button.setAttribute("aria-label", inboxAriaLabel(unread));
      button.classList.toggle("inbox-button--new", unread > 0);
    } catch {
      // 숫자를 못 읽어도 화면은 그대로. 열면 함 안에 오류 문구가 보인다
    }
  };
  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = async () => {
    // 휴대폰 화면에서는 위쪽 줄이 내려가므로 버튼 바로 아래에 연다
    panel.style.top = `${Math.round(button.getBoundingClientRect().bottom) + 8}px`;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    put(panel, h("p", { class: "muted", role: "status" }, "불러오는 중…"));
    put(panel, await panelContent(userId, { close, refresh }));
  };

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  wrapper.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      close();
      button.focus();
    }
  });
  document.removeEventListener("click", outsideClick);
  outsideClick = (event) => {
    if (!panel.hidden && !wrapper.contains(event.target)) close();
  };
  document.addEventListener("click", outsideClick);

  // spec 009 v0.4 Q51: 1분마다 나에게 온(또는 내가 일으킨) 대기 알림을 슬랙으로도 보낸다. 기다리지 않는다
  // spec 018 FR-003: 그 전에 보관 기한이 된 보존 검체 알림을 만든다 (화면을 열 때와 1분마다)
  const tick = async () => {
    await checkDueRetention();
    refresh();
    flushNotifications();
  };
  clearInterval(timer);
  timer = setInterval(tick, REFRESH_MS);
  // 처음 그릴 때는 알림만 만들고 숫자를 새로 센다. 슬랙 보내기는 지금처럼 1분 확인과 저장 뒤에 (막 새로 고친 직후 로그인 토큰이 아직 준비 안 돼 401이 났다)
  checkDueRetention().then(refresh);
  return wrapper;
}

async function panelContent(userId, { close, refresh }) {
  let rows;
  try {
    rows = await listMyNotifications(userId);
  } catch (error) {
    return h("p", { class: "error-text", role: "alert" }, error.message);
  }
  const header = h("div", { class: "inbox-head" },
    h("h2", { class: "section-title" }, "알림"),
    rows.some((row) => !row.read_at)
      ? h("button", {
          class: "button", type: "button",
          onclick: async () => { await markNotificationsRead(null).catch(() => {}); close(); refresh(); },
        }, "모두 읽음")
      : null);
  if (!rows.length) return h("div", null, header, h("p", { class: "muted" }, "새 알림이 없습니다."));
  return h("div", null, header,
    h("ul", { class: "plain-list inbox-list" }, ...rows.map((row) => h("li", { class: row.read_at ? "inbox-item" : "inbox-item inbox-item--new" },
      h("a", {
        href: isSafeAppPath(row.link_path) ? row.link_path : "#/",
        onclick: () => {
          if (!row.read_at) markNotificationsRead([row.id]).then(refresh).catch(() => {});
          close();
        },
      },
      row.read_at ? null : h("span", { class: "badge badge--warning" }, "새 알림"), " ",
      h("span", { class: "inbox-message" }, row.message)),
      h("span", { class: "muted inbox-meta" }, inboxMetaText(row, formatDateTime)),
      // spec 009 v0.6 FR-008 수용 기준 3
      row.slack_acknowledged_at ? h("span", { class: "muted inbox-meta" }, slackAckText(row.slack_acknowledged_at, formatDateTime)) : null))));
}
