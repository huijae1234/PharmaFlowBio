// 이슈 상세에 붙는 AI 칸 세 개 (spec 023): 조사 준비(FR-001) · 평가서 보완(FR-002) · 조치 이후 확인(FR-003).
// 보일지는 권한표(ai-policy-rules.js)로 정한다. 서버가 같은 표를 DB에서 읽은 기록으로 다시 적용하므로 이 화면 판단은 편의일 뿐이다.
// 모두 읽고 정리할 뿐이다. 조치 요청·평가서는 사람이 고치고 기존 버튼을 눌러야 저장되고, 서버 권한·상태 규칙은 그대로다.
import { h, put } from "../dom.js";
import { assistPanel } from "../ai-assist-panel.js";
import { afterActionView, codeCheckLines, issuePrepView, reviewCheckView } from "../ai-assist-views.js";
import { factsKey } from "../../domain/ai-facts-rules.js";
import { IN_PROGRESS, issueFacts } from "../../domain/ai-issue-facts-rules.js";
import { reviewFacts } from "../../domain/ai-review-check-rules.js";
import { canSummarize, compareAfterAction, followupHeadline } from "../../domain/ai-followup-rules.js";
import { aiDecision } from "../../domain/ai-policy-rules.js";
import { actionStatusLabel, actionTypeLabel, actionTypesFor, retestTarget } from "../../domain/action-rules.js";
import { loadFollowup } from "../../infrastructure/store-ai-context.js";

/** 진행 중인 조치 요청은 AI를 부르기 전에 코드가 먼저 보여 같은 요청을 또 만들지 않게 한다 */
function inProgressBox(requests) {
  const open = (requests ?? []).filter((request) => IN_PROGRESS.includes(request.status));
  if (!open.length) return null;
  return h("div", { class: "ai-codecheck", role: "note" },
    h("p", { class: "request-head" }, `이미 진행 중인 조치 요청 ${open.length}건`),
    h("ul", null, ...open.map((request) => h("li", null, `${actionTypeLabel(request.action_type)} · ${actionStatusLabel(request.status)}`))));
}

const withoutChoice = (facts) => ({ ...facts, rows: facts.rows.filter((row) => row.id !== "want" && row.id !== "dup") }); // 고른 조치 종류와 무관한 근거만 열쇠로
const stateOf = (profile, issue, ctx, extra = {}) => ({ profile, issue, batch: issue.batch, review: ctx.review, requests: ctx.requests, ...extra });

/**
 * FR-001 이슈 상세 "AI로 조사 준비". 조치 종류를 고른 뒤 눌러야 한다. 권한표가 허용하지 않으면 null (QC는 시험 이슈, 생산은 공정 이슈, QA는 검토·승인을 기다리는 이슈)
 * @param {{ profile: { id: string, role: string }, issue: object, ctx: object, onUseDraft: (actionType: string, text: string) => void }} input
 */
export function investigatePanel({ profile, issue, ctx, onUseDraft }) {
  if (!aiDecision("issue_prep", stateOf(profile, issue, ctx)).allowed) return null;
  const select = h("select", { class: "select", name: "ai_action_type", "aria-label": "AI에게 맞출 조치 종류" },
    h("option", { value: "" }, "조치 종류를 고르세요"), ...actionTypesFor(issue.source).map((type) => h("option", { value: type }, actionTypeLabel(type))));
  const warning = h("p", { class: "error-text", role: "status" });
  let panel = null;
  select.addEventListener("change", () => {
    panel?.querySelector(".ai-precheck")?.remove(); // 종류를 골랐으니 "먼저 골라 주세요" 안내는 지운다
    const same = (ctx.requests ?? []).find((request) => request.action_type === select.value && IN_PROGRESS.includes(request.status));
    warning.textContent = same ? `같은 종류(${actionTypeLabel(select.value)})의 요청이 이미 ${actionStatusLabel(same.status)} 상태입니다. 중복 요청인지 먼저 확인하세요.` : "";
  });
  panel = assistPanel({
    kind: "issue_prep", title: "AI로 조사 준비", button: "AI로 조사 준비", fold: true,
    facts: () => issueFacts({ issue, ...ctx, actionType: select.value }),
    request: () => ({ target: { issueId: issue.id }, input: { actionType: select.value } }),
    preface: inProgressBox(ctx.requests), controls: [h("label", { class: "field" }, h("span", { class: "field-label" }, "조치 종류"), select), warning],
    precheck: () => (select.value ? null : "조치 종류를 먼저 골라 주세요."),
    view: (result, shown) => issuePrepView(result, shown, { onUseDraft: (text) => onUseDraft(select.value, text) }),
    scope: `prep.${issue.id}`, scopeKey: (shown) => factsKey("issue_prep", withoutChoice(shown)),
  });
  return panel;
}

/**
 * FR-002 평가서 "AI로 보완할 점 확인". 작성 지원(작성·수정할 수 있는 평가서, 작성 중인 글)과 QA 검토(제출된 평가서, 저장된 글)를 권한표가 나눈다.
 * 작성 중인 글은 저장된 사실과 분리한 사용자 초안이며 읽기만 하고 고치지 않는다
 * @param {{ profile: { id: string, role: string }, issue: object, ctx: object, getValues: () => Record<string, string>, source: "draft" | "saved", watch?: (check: () => void) => void }} input
 */
export function reviewCheckPanel({ profile, issue, ctx, getValues, source, watch }) {
  if (!aiDecision("review_check", stateOf(profile, issue, ctx, { source })).allowed) return null;
  return assistPanel({
    kind: "review_check", title: source === "draft" ? "AI로 보완할 점 확인 (작성 지원)" : "AI로 보완할 점 확인 (검토 지원)", button: "AI로 보완할 점 확인", watch, fold: source === "saved",
    facts: () => reviewFacts({ issue, ...ctx, values: getValues(), source }),
    request: () => ({ target: { issueId: issue.id }, input: source === "draft" ? { source, values: getValues() } : { source } }),
    codeLines: codeCheckLines, view: reviewCheckView,
  });
}

function followupItem({ issue, request, measurement }) {
  const box = h("div", { class: "stack" });
  const action = { id: request.id, type: request.action_type, completedAt: request.completed_at, hasNote: Boolean(request.result_note) };
  const start = () => put(box, h("p", null, `${actionTypeLabel(request.action_type)} (완료) 이후 비슷한 이탈이 다시 관찰되는지 같은 제품·같은 항목·같은 기준 버전의 다른 로트로 비교합니다.`),
    h("button", { class: "button", type: "button", onclick: open }, "조치 이후 확인"));
  async function open() {
    put(box, h("p", { class: "muted", role: "status" }, "조치 이후 기록을 읽는 중…"));
    const loaded = measurement ? await loadFollowup(measurement.id) : { baseline: null, read: { ok: true, rows: [] } };
    const result = compareAfterAction({ baseline: loaded.baseline, action, read: loaded.read });
    const line = followupHeadline(result);
    put(box, h("p", { role: "status" }, line.text), line.need ? h("p", { class: "muted" }, line.need) : null,
      canSummarize(result) ? assistPanel({
        kind: "after_action", title: "AI로 관찰 정리", button: "AI로 관찰 정리",
        request: () => ({ target: { issueId: issue.id, requestId: request.id } }), view: afterActionView,
      }) : null,
      h("button", { class: "button", type: "button", onclick: start }, "닫기"));
  }
  start();
  return box;
}

/** FR-003 완료된 조치 요청마다 "조치 이후 확인" (눌렀을 때만 읽는다). 권한표가 허용한 조치만 — QA는 전체, QC·생산은 본인이 담당한 같은 종류 이슈의 조치 */
export function followupBlocks({ profile, issue, ctx }) {
  const allowed = (ctx.requests ?? []).filter((request) => aiDecision("after_action", stateOf(profile, issue, ctx, { request })).allowed).slice(0, 3);
  if (!allowed.length) return null;
  const measurement = retestTarget(ctx.opening);
  return h("div", { class: "stack" }, h("h3", { class: "subsection-title" }, "조치 이후 확인"), ...allowed.map((request) => followupItem({ issue, request, measurement })));
}
