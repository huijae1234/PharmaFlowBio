// 업무 찾아보기 (spec 024 FR-003): 역할별 홈의 작은 질문칸. 별도 챗봇이 아니다.
// 질문은 미리 정한 조회 4가지(보류 로트·평가 검토 대기·나에게 배정된 미완료 조치·계획 종료일이 지난 작업지시)로만 풀리고, 결과는 실제 목록·개수·조회 조건·화면 링크로 보인다.
// 예시 질문과 고른 후보는 AI를 부르지 않고 바로 조회한다. 서버가 종류·필터·권한을 검증하고 "내 업무"는 로그인한 사용자로 정한다.
import { h, put, formatDateTime } from "./dom.js";
import { callAi } from "../infrastructure/ai.js";
import { aiDecision } from "../domain/ai-policy-rules.js";
import { ASK_LIMITS, examplesFor } from "../domain/ai-ask-rules.js";

const fixtureCase = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("aicase"); // 로컬 시험 모드 전용

/** @param {{ profile: { id: string, role: string } }} input @returns {HTMLElement | null} */
export function askBox({ profile }) {
  if (!aiDecision("ask", { profile }).allowed) return null;
  const input = h("input", { class: "input", name: "ask_question", type: "text", maxlength: String(ASK_LIMITS.questionMax), autocomplete: "off", placeholder: "예: 보류 로트 중 5일 넘은 것" });
  const out = h("div", { class: "stack", "aria-live": "polite" });
  let busy = false; // 눌린 조회가 끝나기 전의 두 번째 조회는 무시한다

  const chips = (examples) => h("ul", { class: "ask-examples" }, ...examples.map((example) => h("li", null,
    h("button", { class: "button", type: "button", onclick: () => run({ pick: { kind: example.kind, filters: example.filters ?? {} } }) }, example.text ?? example.label))));

  const resultView = (response) => {
    const { result, understood, how } = response;
    return [
      how === "question" ? h("p", { class: "muted" }, `이렇게 이해했습니다: ${understood.label} · ${understood.scope}. 다르면 아래 예시를 눌러 보세요.`) : null,
      h("p", { role: "status" }, `${result.label} ${result.count}건 (조회 조건: ${result.scope})${result.truncated ? ` — 일부만 읽었거나 ${result.shown}건까지만 보여 줍니다. 조건을 좁혀 보세요.` : ""}`),
      result.rows.length
        ? h("ol", { class: "ask-list" }, ...result.rows.map((row) => h("li", null, h("a", { href: row.href }, row.label), h("span", { class: "muted" }, ` · ${row.detail}`))))
        : h("p", { class: "muted" }, "조건에 맞는 항목이 없습니다(0건)."),
      h("p", { class: "source-line" }, `조회 시각 ${formatDateTime(result.asOf)} · 목록은 실제 자료에서 읽은 것입니다. ${how === "question" ? "AI는 질문을 해석하는 데만 썼습니다." : "조건을 직접 골라 AI 없이 조회했습니다."}`),
    ];
  };

  const show = (response) => {
    if (!response.ok) return put(out, h("p", { class: "error-text", role: "alert" }, response.reason ?? "조회하지 못했습니다."), chips(response.examples ?? examplesFor(profile.role)));
    if (response.clarify) {
      return put(out, h("p", null, "어느 조회를 말씀하신 건가요? 고르면 바로 조회합니다."),
        h("ul", { class: "ask-examples" }, ...response.clarify.map((option) => h("li", null, h("button", { class: "button", type: "button", onclick: () => run({ pick: { kind: option.kind, filters: {} } }) }, option.label)))));
    }
    if (response.unsupported) return put(out, h("p", null, "이 질문은 아직 찾을 수 없습니다. 아래 질문은 할 수 있습니다."), chips(response.examples));
    return put(out, ...resultView(response));
  };

  async function run(request) {
    if (busy) return;
    busy = true;
    put(out, h("p", { class: "muted", role: "status" }, "찾는 중…"));
    try {
      show(await callAi("ask", null, fixtureCase(), request).catch(() => ({ ok: false, reason: "조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요." })));
    } finally {
      busy = false;
    }
  }

  const form = h("form", { class: "ask-form", onsubmit: (event) => {
    event.preventDefault();
    if (!input.value.trim()) return put(out, h("p", { class: "error-text", role: "alert" }, "질문을 적거나 아래 예시를 눌러 주세요."), chips(examplesFor(profile.role)));
    run({ question: input.value });
  } },
  h("label", { class: "field" }, h("span", { class: "field-label" }, "무엇을 찾을까요?"), input),
  h("button", { class: "button button--primary", type: "submit" }, "찾기"));
  return h("details", { class: "panel ask-box" },
    h("summary", { class: "section-title" }, "업무 찾아보기"),
    h("p", { class: "muted" }, "보류 로트·평가 검토 대기·내게 배정된 미완료 조치·계획 종료일이 지난 작업지시만 찾습니다. 조회만 하고 바꾸는 것은 없습니다."),
    form, chips(examplesFor(profile.role)), out);
}
