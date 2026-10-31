// AI 도우미: 화면 오른쪽 아래 DNA 나선 버튼과 대화 창 (spec 025 FR-001·002·005·007). 직원 역할이면 layout.js가 화면마다 새로 붙인다.
// 화면을 옮기면 새로 그려지므로 대화는 사라진다(FR-002 수용 기준 4, 경계 "질문 도중 이동"). 대화는 저장하지 않는다.
import { h, put } from "./dom.js";
import { CHAT_LIMITS } from "../domain/chat-rules.js";
import { callChat } from "../infrastructure/ai.js";
import { screenFacts } from "./assistant-context.js";
import { answerBubble, busyBubble, emptyView, errorBubble, headView, helixIcon, questionBubble } from "./assistant-views.js";

const MAX_TURNS = CHAT_LIMITS.maxHistory + 1; // 한 창에서 6번 (Q89)
const fixtureCase = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("chatcase"); // 로컬 시험 모드 전용 (?chatcase=approve 등)
const answerText = (result) => result.parts.map((part) => part.text).join(" ").slice(0, CHAT_LIMITS.maxAnswer);

/** @param {string} role */
export function renderAssistant(role) {
  const state = { history: [], busy: false };
  const log = h("div", { class: "assistant-log", role: "log", "aria-live": "polite" });
  const counter = h("span", { class: "assistant-meta", "aria-live": "off" }, `0/${CHAT_LIMITS.maxQuestion}`);
  const input = h("textarea", {
    class: "input assistant-input", rows: "2", maxlength: String(CHAT_LIMITS.maxQuestion), "aria-label": "질문",
    oninput: () => { counter.textContent = `${input.value.length}/${CHAT_LIMITS.maxQuestion}`; },
    onkeydown: (event) => { // Enter는 보내기, Shift+Enter는 줄바꿈. 한글 조합 중 Enter는 글자 확정이라 보내지 않는다
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(input.value); }
    },
  });
  const send = h("button", { class: "button button--primary", type: "submit" }, "보내기");
  const form = h("form", { class: "assistant-form", onsubmit: (event) => { event.preventDefault(); ask(input.value); } },
    input, h("div", { class: "assistant-form-row" }, counter, send));
  const head = h("div");
  const dialog = h("dialog", {
    class: "assistant-dialog", "aria-labelledby": "assistant-title",
    onclick: (event) => { if (event.target === dialog) dialog.close(); }, // 창 밖(뒤 흐림)을 누르면 닫힌다
    onclose: () => { fab.setAttribute("aria-expanded", "false"); fab.focus(); },
  }, head, log, form, h("p", { class: "assistant-note" }, "개인정보는 적지 마세요 · 대화는 저장하지 않습니다"));
  const fab = h("button", { class: "assistant-fab", type: "button", "aria-label": "AI 도우미 열기", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: open },
    helixIcon(34), h("span", { class: "assistant-now", "aria-hidden": "true" }));

  const append = (node) => {
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  };
  const setInputOpen = (on) => {
    input.readOnly = !on;
    send.hidden = !on;
  };

  function reset() {
    state.history = [];
    put(log, emptyView(role, screenFacts(), ask));
    setInputOpen(true);
  }

  function open() {
    put(head, headView({ screen: screenFacts(), onNew: reset, onClose: () => dialog.close() }));
    if (!log.childElementCount) reset();
    dialog.showModal();
    fab.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function setBusy(on) {
    state.busy = on;
    fab.classList.toggle("is-busy", on);
    form.setAttribute("aria-busy", String(on));
    send.textContent = on ? "보내는 중…" : "보내기";
  }

  async function ask(text) {
    const question = String(text ?? "").trim();
    if (!question || state.busy || state.history.length >= MAX_TURNS) return; // 빈 질문·중복 보내기는 무시 (FR-007 수용 기준 3)
    if (log.querySelector(".assistant-empty")) put(log);
    const screen = screenFacts(); // 보낸 그때의 표로 근거 줄 링크를 붙인다
    const byId = new Map(); // 근거 표는 서버에 있어 서버가 붙인 링크(links)로 칩을 그린다 (spec 025 8·9단계)
    append(questionBubble(question));
    const busy = append(busyBubble());
    setBusy(true);
    const result = await callChat({ question, history: state.history, screen, fixtureCase: fixtureCase() });
    busy.remove();
    setBusy(false);
    if (!result.ok) {
      append(errorBubble(result.reason, () => ask(question)));
      input.value = question; // 실패해도 질문은 지워지지 않는다 (FR-007 수용 기준 2)
      return;
    }
    append(answerBubble(result, byId));
    state.history.push({ q: question, a: answerText(result) });
    input.value = "";
    counter.textContent = `0/${CHAT_LIMITS.maxQuestion}`;
    if (state.history.length >= MAX_TURNS) {
      append(h("p", { class: "assistant-meta", role: "status" }, `한 대화에서 ${MAX_TURNS}번까지 물을 수 있습니다. 위쪽 "새 대화"를 눌러 주세요.`));
      setInputOpen(false);
    }
  }

  return h("div", { class: "assistant" }, fab, dialog);
}
