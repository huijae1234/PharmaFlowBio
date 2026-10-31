// 이슈·기준·일정에 붙는 AI 칸(spec 023·024)이 함께 쓰는 틀. 눌렀을 때만 부르고, 중복 클릭·연속 재시도를 막고, 근거가 바뀌면 이전 결과가 오래됐다고 알린다.
// 근거 표는 서버가 저장된 사실에서 만들어 돌려준다(result.facts). 화면이 만든 근거 표는 "근거가 바뀌었는지" 알리는 열쇠로만 쓴다.
// AI는 읽고 정리할 뿐이다: 저장·제출·알림을 하는 코드가 없고, 실패해도 이 칸만 안내한다.
import { h, put, badge, formatDateTime } from "./dom.js";
import { factsKey, gapLines } from "../domain/ai-facts-rules.js";
import { callAi, noteAiScope, readAiCache, readAiScope, saveAiCache } from "../infrastructure/ai.js";
import { evidenceTable, verificationLines } from "./ai-panel.js";

const COOLDOWN_MS = 3000; // 실패 뒤 다시 시도·새로 만들기 사이의 최소 간격
const fixtureCase = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("aicase"); // 로컬 시험 모드 전용
const timeText = (date) => date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

const head = (title) => h("div", { class: "ai-head" }, h("h3", { class: "subsection-title" }, title), badge("ai_note", "ℹ AI 참고 의견 · 최종 판단은 사람"));

/** 누른 뒤 잠시 다시 누르지 못하게 한다 (연속 재시도로 호출·비용이 겹치지 않게) */
function coolDown(button) {
  button.disabled = true;
  setTimeout(() => { button.disabled = false; }, COOLDOWN_MS);
}

/**
 * @param {{ kind: "issue_prep" | "review_check" | "after_action" | "spec_impact" | "schedule_check", title: string, button: string, hint?: string,
 *   request: () => { target?: object, input?: object }, view: (result: object, facts: object) => Node[],
 *   facts?: () => { asOf: string, rows: object[], limits: string[] }, preface?: Node | null, controls?: Node[], precheck?: () => string | null, codeLines?: (facts: object) => Node | null,
 *   scope?: string, scopeKey?: (facts: object) => string, reuse?: boolean, watch?: (check: () => void) => void, fold?: boolean }} options
 *   request: 서버에 보낼 대상 ID와 사용자가 고르거나 쓴 값(눌렀을 때 읽는다). facts: 화면이 가진 자료로 만든 근거 표(없어도 된다) — 근거가 바뀌었는지 알리는 열쇠로만 쓴다.
 *   scope: 대상마다 마지막 결과의 근거 열쇠를 남겨, 근거가 바뀐 뒤 다시 열면 이전 결과가 오래됐다고 알린다. reuse: 같은 근거면 보관한 결과를 바로 보인다.
 *   watch: 작성 중인 글처럼 바뀌는 곳에서 바뀔 때마다 부를 함수를 넘겨받는다. fold: 기본으로 접어 둔다
 * @returns {HTMLElement}
 */
export function assistPanel(options) {
  const { kind, title, button, hint = "AI는 서버가 읽은 근거 표의 값만 읽고 문장을 만듭니다. 저장·제출·알림은 하지 않습니다.", view, preface = null, controls = [], precheck, codeLines, scope, reuse = false, watch } = options;
  const box = h("div", { class: "ai-panel ai-panel--inline" });
  const notice = h("p", { class: "error-text ai-stale", role: "status" });
  notice.hidden = true;
  const keyOf = (facts) => (options.scopeKey ? options.scopeKey(facts) : factsKey(kind, facts));
  const localFacts = () => { try { return options.facts?.() ?? null; } catch { return null; } };
  let running = false;
  let shownKey = null; // 지금 화면의 결과가 만들어진 근거의 열쇠

  const startView = (message = null) => put(box, head(title), preface, h("p", { class: "muted" }, hint),
    h("div", { class: "toolbar" }, ...controls, h("button", { class: "button button--primary", type: "button", onclick: run }, button)),
    message ? h("p", { class: "error-text ai-precheck", role: "alert" }, message) : null, notice);

  const failView = (result) => {
    const retry = h("button", { class: "button", type: "button", onclick: () => { if (!retry.disabled) run(); } }, "다시 시도");
    coolDown(retry);
    put(box, head(title), preface, h("p", { class: "error-text", role: "alert" }, `AI 요약을 불러오지 못했습니다. ${result.reason ?? ""}`.trim()),
      h("p", { class: "muted" }, "AI 없이도 이 화면의 작성·조회·제출은 그대로 쓸 수 있습니다."),
      result.facts ? h("details", null, h("summary", null, "근거 표 (코드가 센 값)"), evidenceTable(result.facts)) : null,
      h("div", { class: "toolbar" }, ...controls, retry), notice);
  };

  function resultView(result, facts, at) {
    const again = h("button", { class: "button", type: "button", onclick: () => { if (!again.disabled) run(); } }, "새로 만들기");
    coolDown(again);
    return [
      ...view(result, facts),
      ...verificationLines(result),
      h("details", null, h("summary", null, "근거 표 (코드가 센 값)"), evidenceTable(facts)),
      h("h4", { class: "subsection-title" }, "이 데이터로는 알 수 없는 것"),
      h("ul", { class: "muted" }, ...[...facts.limits, ...gapLines(facts), ...(result.unknowns ?? []).map((line) => `AI 메모: ${line}`)].map((line) => h("li", null, line))),
      h("p", { class: "source-line" }, `${result.fixture ? "출처: 시험 응답(실제 Claude 아님)" : `출처: Claude ${result.model ?? ""}`} · 만든 시각 ${timeText(at)} · 근거 기준 시점 ${formatDateTime(result.asOf ?? facts.asOf)}`),
      h("div", { class: "toolbar" }, ...controls, again), // 조치 종류처럼 고르는 칸은 결과 뒤에도 남겨 다른 종류로 다시 만들 수 있게 한다
    ];
  }

  // 그리다 던져도 이 칸만 안내하고 화면의 다른 업무는 그대로다
  function show(result, local, at) {
    const facts = result.facts ?? local; // 서버가 저장된 사실에서 만든 근거 표가 우선이다
    shownKey = result.ok && local ? keyOf(local) : null;
    notice.hidden = true;
    try {
      if (!result.ok) return failView(result);
      put(box, head(title), preface, codeLines?.(facts), ...resultView(result, facts, at), notice);
    } catch (error) {
      console.error("AI 결과를 그리지 못했습니다:", error.message);
      failView({ reason: "결과를 화면에 표시하지 못했습니다." });
    }
  }

  async function run() {
    if (running) return;
    const problem = precheck?.();
    if (problem) return startView(problem);
    const local = localFacts();
    running = true;
    put(box, head(title), preface, h("p", { class: "muted", role: "status" }, "AI 요약을 만드는 중…"));
    try {
      const result = await callAi(kind, null, fixtureCase(), options.request()).catch(() => ({ ok: false, reason: "알 수 없는 오류" }));
      if (result.ok && scope && local) { if (reuse) saveAiCache(keyOf(local), result); noteAiScope(scope, keyOf(local)); } // 결과를 보관하는 것은 같은 근거로 바로 다시 보일 칸뿐
      show(result, local, new Date());
    } finally {
      running = false;
    }
  }

  // 만들 때: 같은 근거의 보관 결과가 있으면 보이고, 근거가 바뀌었으면 이전 결과가 오래됐다고 알린다
  const local = localFacts();
  const key = local ? keyOf(local) : null;
  const cached = reuse && key ? readAiCache(key) : null;
  const last = scope ? readAiScope(scope) : null;
  if (cached) show(cached.result, local, new Date(cached.savedAt));
  else {
    if (last && key && last.key !== key) {
      notice.hidden = false;
      notice.textContent = `근거가 바뀌어 이전 AI 결과(${formatDateTime(last.savedAt)})는 오래되어 보여 주지 않습니다. 필요하면 다시 만들어 주세요.`;
    }
    startView();
  }
  // 작성 중인 글이 바뀌면 지금 보이는 결과가 오래됐다고 알린다
  watch?.(() => {
    if (shownKey === null) return;
    const now = localFacts();
    notice.hidden = now !== null && keyOf(now) === shownKey;
    notice.textContent = "작성 내용이 바뀌어 이 결과는 오래됐습니다. 다시 확인해 주세요.";
  });
  return options.fold ? h("details", { class: "ai-fold" }, h("summary", null, title), box) : box;
}
