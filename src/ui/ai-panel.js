// "AI 참고 의견" 칸 하나 (spec 022 FR-002). 눌렀을 때만 부르고(호출 절약), 문장마다 인용한 근거 줄과 그 줄로 가는 링크를 붙인다.
// AI는 판정하지 않는다: 배지로 밝히고, 검증에 걸린 문장은 경고하고 이동 링크를 만들지 않으며, 알 수 없는 것은 코드가 직접 적는다.
// AI 칸이 실패하거나 근거 표를 만들다 던져도 화면의 다른 업무는 그대로다 (null을 돌려준다).
import { h, put, badge, formatDateTime } from "./dom.js";
import { FLAG_MESSAGES } from "../domain/ai-brief-rules.js";
import { ASSIST_FLAG_MESSAGES } from "../domain/ai-assist-rules.js";
import { FACT_STATE_LABELS, factsKey, gapLines } from "../domain/ai-facts-rules.js";
import { callAi, readAiCache, saveAiCache } from "../infrastructure/ai.js";

const fixtureCase = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("aicase"); // 로컬 시험 모드 전용 (?aicase=mismatch 등)
const timeText = (date) => date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const stateBadge = (state) => badge(`fact_${state}`, FACT_STATE_LABELS[state]);

/**
 * @param {{ kind: "home" | "lot" | "regulatory", title: string, button: string, emptyText?: string,
 *   build: () => { asOf: string, rows: { id: string, label: string, value: string, state: string, href: string | null }[], limits: string[], empty?: boolean } }} options
 * @returns {HTMLElement | null}
 */
export function aiPanel({ kind, title, button, emptyText = "", build }) {
  let facts;
  try {
    facts = build();
  } catch (error) {
    console.error("AI 칸의 근거 표를 만들지 못했습니다:", error.message);
    return null;
  }
  const box = h("section", { class: "panel ai-panel" });
  if (facts.empty) {
    put(box, h("h2", { class: "section-title" }, title), h("p", { class: "muted" }, `${emptyText} 이상이 없다는 보증은 아닙니다.`));
    return box;
  }
  const key = factsKey(kind, facts);
  let running = false; // 중복 클릭 막기: 만드는 동안 버튼이 없고, 눌린 호출이 끝나기 전의 두 번째 호출은 무시한다
  const run = async () => {
    if (running) return;
    running = true;
    put(box, head(title), h("p", { class: "muted", role: "status" }, "AI 요약을 만드는 중…"));
    try {
      const result = await callAi(kind, facts, fixtureCase()).catch(() => ({ ok: false, reason: "알 수 없는 오류" }));
      if (result.ok) saveAiCache(key, result);
      show(result, new Date());
    } finally {
      running = false;
    }
  };
  // 그리다 던져도(손상된 보관 결과 등) 이 칸만 안내하고 화면의 다른 업무는 그대로다
  const show = (result, at) => {
    try {
      put(box, head(title), result.ok ? resultView(result, facts, kind, run, at) : failView(result.reason, run));
    } catch (error) {
      console.error("AI 결과를 그리지 못했습니다:", error.message);
      put(box, head(title), failView("결과를 화면에 표시하지 못했습니다.", run));
    }
  };

  const cached = readAiCache(key);
  if (cached) show(cached.result, new Date(cached.savedAt));
  else put(box, head(title), h("p", { class: "muted" }, "AI는 아래 근거 표의 숫자만 읽고 문장을 만듭니다. 판정은 하지 않습니다."), h("button", { class: "button button--primary", type: "button", onclick: run }, button));
  return box;
}

const head = (title) => h("div", { class: "ai-head" }, h("h2", { class: "section-title" }, title), badge("ai_note", "ℹ AI 참고 의견 · 최종 판단은 QA"));

const failView = (reason, retry) => h("div", { class: "stack" },
  h("p", { class: "error-text", role: "alert" }, `AI 요약을 불러오지 못했습니다. ${reason ?? ""}`.trim()),
  h("p", { class: "muted" }, "AI 없이도 이 화면의 숫자와 링크로 업무를 계속할 수 있습니다."),
  h("button", { class: "button", type: "button", onclick: retry }, "다시 시도"));

function resultView(result, facts, kind, rerun, at) {
  const byId = new Map(facts.rows.map((entry) => [entry.id, entry]));
  const unknowns = [...facts.limits, ...gapLines(facts), ...(result.unknowns ?? []).map((line) => `AI 메모: ${line}`)]; // 앞의 두 가지는 코드가 쓴 줄, AI가 쓴 줄은 구분해 보인다
  return h("div", { class: "stack" },
    ...verificationLines(result),
    h("ol", { class: "ai-claims" }, ...result.claims.map((claim) => claimView(claim, byId))),
    kind === "regulatory" ? copyButton(result) : null,
    h("h3", { class: "subsection-title" }, "근거 표 (코드가 센 값)"),
    evidenceTable(facts),
    h("h3", { class: "subsection-title" }, "이 데이터로는 알 수 없는 것"),
    h("ul", { class: "muted" }, ...unknowns.map((line) => h("li", null, line))),
    h("p", { class: "source-line" }, `${result.fixture ? "출처: 시험 응답(실제 Claude 아님)" : `출처: Claude ${result.model ?? ""}`} · 만든 시각 ${timeText(at)} · 근거 기준 시점 ${formatDateTime(result.asOf ?? facts.asOf)}`),
    h("button", { class: "button", type: "button", onclick: rerun }, "새로 만들기"));
}

// 검증은 숫자·인용·표현 세 가지뿐이다. 문장의 뜻이 맞는지는 검증하지 못한다고 밝힌다
export const verificationLines = (result) => [
  result.flagged
    ? h("p", { class: "error-text", role: "alert" }, `⚠ 검증에 걸린 문장 ${result.flagged}건: 아래 표시를 보고 근거 표에서 직접 확인하세요.`)
    : h("p", { class: "muted" }, "검증: 문장 속 숫자와 인용한 근거 줄이 근거 표와 맞습니다. 문장의 뜻이 맞는지는 검증하지 못합니다."),
  result.droppedUnknowns
    ? h("p", { class: "error-text", role: "alert" }, `⚠ AI가 쓴 "알 수 없는 것" ${result.droppedUnknowns}줄은 승인·안전 단정 표현이 있어 뺐습니다.`)
    : null,
  // 중요한 항목을 AI 문장이 빠뜨렸는지 (spec FR-002 수용 기준 5)
  result.uncovered?.length
    ? h("p", { class: "error-text", role: "alert" }, `⚠ AI 문장이 다루지 않은 확인 항목 ${result.uncovered.length}건: ${result.uncovered.map((entry) => entry.label).join(" · ")}. 근거 표에서 직접 확인하세요.`)
    : null,
];

/** 승인·안전·원인 단정 문장은 처음에는 가리고, 눌러야 보인다 */
export const isMasked = (flags) => flags.some((flag) => flag.code === "forbidden" || flag.code === "forbidden_kind");

export const flagList = (flags) => h("ul", { class: "error-text" }, ...flags.map((flag) => h("li", null,
  `⚠ ${FLAG_MESSAGES[flag.code] ?? ASSIST_FLAG_MESSAGES[flag.code] ?? flag.code}${flag.detail ? ` (${flag.detail})` : ""}`)));

export function claimView(claim, byId) {
  const flags = claim.flags ?? [];
  return h("li", { class: flags.length ? "ai-claim ai-claim--flagged" : "ai-claim" },
    isMasked(flags)
      ? h("details", null, h("summary", null, "승인·안전·원인 단정 표현이 있어 가린 문장 (눌러서 보기)"), h("p", null, claim.text))
      : h("p", null, claim.text),
    flags.length ? flagList(flags) : h("p", { class: "ai-chips" }, ...claim.refs.map((id) => byId.get(id)).filter(Boolean).map(chip)));
}

// 근거 줄 → 업무 화면: 링크가 있으면 눌러 바로 간다 (한 번에 그 화면)
export const chip = (entry) => (entry.href
  ? h("a", { class: "ai-chip", href: entry.href }, `${entry.label} 보기`)
  : h("span", { class: "ai-chip ai-chip--plain" }, `근거: ${entry.label}`));

export const evidenceTable = (facts) => h("div", { class: "table-wrap" }, h("table", { class: "table ai-evidence" },
  h("thead", null, h("tr", null, ...["항목", "값", "상태"].map((title) => h("th", { scope: "col" }, title)))),
  h("tbody", null, ...facts.rows.map((entry) => h("tr", null,
    h("td", null, entry.href ? h("a", { href: entry.href }, entry.label) : entry.label),
    h("td", null, entry.value),
    h("td", null, stateBadge(entry.state)))))));

// 이 앱이 보내지 않는다: 복사만 (spec FR-005 수용 기준 2). 검증에 걸린 문장은 복사 글에서 뺀다
function copyButton(result) {
  const status = h("span", { class: "muted", role: "status" });
  const lines = result.claims.filter((claim) => !claim.flags.length).map((claim) => `- ${claim.text}`);
  const onclick = async () => {
    try {
      const missing = result.uncovered?.length ? `\n(AI가 다루지 않은 확인 항목: ${result.uncovered.map((entry) => entry.label).join(", ")})` : "";
      await navigator.clipboard.writeText(lines.length ? `${lines.join("\n")}${missing}\n(AI 초안입니다. 근거 표를 확인한 뒤 쓰세요.)` : "");
      put(status, lines.length ? "복사했습니다" : "복사할 수 있는 문장이 없습니다(모두 검증에 걸렸습니다)");
    } catch {
      put(status, "복사하지 못했습니다. 글을 직접 선택해 복사하세요.");
    }
  };
  return h("div", { class: "toolbar" }, h("button", { class: "button", type: "button", onclick }, "글 복사"), status);
}
