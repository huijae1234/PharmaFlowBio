// AI 도우미 창의 그림 조각 (spec 025 FR-002·003·004·008). 상태를 받아 그리기만 한다: 부르기와 대화 상태는 assistant.js.
// 사람이 쓴 질문과 AI 답은 textContent로만 넣는다(dom.js h). 링크는 서버가 검증한 안내서 주소와 이 화면 근거 표의 주소만.
import { h, badge } from "./dom.js";
import { FLAG_MESSAGES } from "../domain/ai-brief-rules.js";
import { CHAT_FLAG_MESSAGES, queryLineText } from "../domain/chat-rules.js";
import { chip, isMasked } from "./ai-panel.js";

const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs, ...children) => {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  node.append(...children);
  return node;
};

/**
 * DNA 이중 나선 (사용자 요청 2026-10-29 "DNA RNA 모양, 지금 컬러감"). 두 가닥과 염기쌍 막대. 색은 CSS(assistant.css)가 토큰으로 칠한다
 * @param {number} size 픽셀
 */
export function helixIcon(size) {
  const strand = (phase) => {
    const points = Array.from({ length: 25 }, (_, i) => {
      const y = 4 + i * (32 / 24);
      const x = 20 + 9 * Math.sin((i / 24) * Math.PI * 2 + phase);
      return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");
    return svg("path", { d: points, class: phase ? "helix-strand helix-strand--b" : "helix-strand helix-strand--a" });
  };
  const rungs = Array.from({ length: 7 }, (_, i) => {
    const t = (i + 0.5) / 7;
    const y = 4 + t * 32;
    const a = 20 + 9 * Math.sin(t * Math.PI * 2);
    const b = 20 + 9 * Math.sin(t * Math.PI * 2 + Math.PI);
    return svg("line", { x1: a.toFixed(2), y1: y.toFixed(2), x2: b.toFixed(2), y2: y.toFixed(2), class: "helix-rung" });
  });
  return svg("svg", { viewBox: "0 0 40 40", width: size, height: size, class: "helix", "aria-hidden": "true", focusable: "false" }, ...rungs, strand(0), strand(Math.PI));
}

const EXAMPLES = {
  qa_manager: ["보류 로트는 어디서 봐?", "규격 이탈과 관리기준 이탈은 뭐가 달라?", "평가 승인은 어디서 해?"],
  qc_analyst: ["시험값은 어디서 입력해?", "품질 영향 평가는 어떻게 써?", "검체 인수는 어디서 확인해?"],
  production_operator: ["공정 조건은 어디서 입력해?", "작업지시 착수는 어떻게 해?", "검체 전달은 어디서 해?"],
};
// 숫자를 묻는 예시는 근거 표가 있는 화면에서만 (FR-004 수용 기준 4)
const SCREEN_EXAMPLES = { home: ["오늘 뭐부터 봐야 해?"], lot: ["이 로트에서 먼저 볼 곳은?", "내부 출하 검토는 누가 해?"] };
const RECORD_EXAMPLE = "최근 문제가 자주 발생한 제품은?"; // FR-010 앱 전체 조회, 역할 모두 (plan 12단계)

/** 처음 연 창: 무엇을 묻는 곳인지와 예시 질문 (누르면 그 질문을 AI에 보낸다. 입력 칸 예시 글은 없다 — 2026-10-29 사용자 "예제는 놔뒀으면", spec 025 Q94) */
export function emptyView(role, screen, onPick) {
  const examples = [...(SCREEN_EXAMPLES[screen?.kind] ?? []), RECORD_EXAMPLE, ...(EXAMPLES[role] ?? [])].slice(0, 3);
  return h("div", { class: "assistant-empty" },
    h("p", null, "앱 사용법, 이 화면의 숫자, 앱 기록을 물어보세요."),
    h("div", { class: "assistant-examples" }, ...examples.map((text) => h("button", { class: "assistant-example", type: "button", onclick: () => onPick(text) }, text))));
}

export const questionBubble = (text) => h("div", { class: "assistant-msg assistant-msg--me" }, h("p", null, text));

const flagText = (flag) => `⚠ ${FLAG_MESSAGES[flag.code] ?? CHAT_FLAG_MESSAGES[flag.code] ?? flag.code}${flag.detail ? ` (${flag.detail})` : ""}`;

function partView(part, byId) {
  const masked = isMasked(part.flags);
  const factChips = part.flags.length ? [] : part.refs.map((id) => byId.get(id)).filter(Boolean).map(chip); // 근거 표 주소는 서버로 보내지 않아 이 화면의 표에서 붙인다
  const guideLinks = part.links.filter((link) => !byId.has(link.id)).map((link) => h("a", { class: "ai-chip", href: link.href }, `${link.title} 화면으로`));
  return h("li", { class: part.flags.length ? "assistant-part assistant-part--flagged" : "assistant-part" },
    masked ? h("details", null, h("summary", null, "승인·안전·원인 단정 표현이 있어 가린 문장 (눌러서 보기)"), h("p", null, part.text)) : h("p", null, part.text),
    part.flags.length ? h("ul", { class: "error-text" }, ...part.flags.map((flag) => h("li", null, flagText(flag)))) : null,
    factChips.length || guideLinks.length ? h("p", { class: "ai-chips" }, ...factChips, ...guideLinks) : null);
}

/** 검증한 답 하나. 근거 표 줄은 보낸 그때의 표(byId)로 링크를 붙인다 */
export function answerBubble(result, byId) {
  const time = new Date(result.at ?? Date.now()).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const check = result.outOfScope ? null : result.flagged
    ? h("p", { class: "error-text", role: "alert" }, `⚠ 검증에 걸린 문장 ${result.flagged}건: 표시를 보고 직접 확인하세요.`)
    : h("p", { class: "assistant-meta" }, "검증: 문장 속 숫자와 인용한 근거가 맞습니다. 문장의 뜻까지는 검증하지 못합니다.");
  const queried = queryLineText(result.queries);
  return h("div", { class: "assistant-msg assistant-msg--ai" },
    h("ul", { class: "assistant-parts" }, ...result.parts.map((part) => partView(part, byId))),
    queried ? h("p", { class: "assistant-meta" }, queried) : null,
    check,
    h("p", { class: "assistant-meta" }, `${result.model === "시험 응답" ? "시험 응답" : `Claude ${result.model}`} · ${time}`));
}

export const busyBubble = () => h("div", { class: "assistant-msg assistant-msg--ai assistant-busy", role: "status" }, h("span", { class: "assistant-now", "aria-hidden": "true" }), "답을 만드는 중…");

export function errorBubble(reason, onRetry) {
  return h("div", { class: "assistant-msg assistant-msg--ai", role: "alert" },
    h("p", { class: "error-text" }, `답을 받지 못했습니다. ${reason ?? ""}`.trim()),
    onRetry ? h("button", { class: "button", type: "button", onclick: onRetry }, "다시 묻기") : null);
}

/** 창 머리: 제목, 참고 의견 배지, 지금 함께 보는 화면 */
export function headView({ screen, onNew, onClose }) {
  return h("header", { class: "assistant-head" },
    h("div", { class: "assistant-title" }, helixIcon(28), h("h2", { id: "assistant-title" }, "AI 도우미"),
      h("button", { class: "button assistant-new", type: "button", onclick: onNew }, "새 대화"),
      h("button", { class: "assistant-close", type: "button", "aria-label": "도우미 닫기", onclick: onClose }, "×")),
    badge("ai_note", "ℹ AI 참고 의견"), // 2026-10-29 사용자 요청: "최종 판단은 사람" 문구 뺌
    h("p", { class: "assistant-meta" }, screen ? `${screen.title} 숫자 함께 봄` : "앱 사용법과 앱 기록을 답합니다 (이 화면의 숫자는 함께 보지 않음)"));
}
