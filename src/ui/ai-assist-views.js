// 새 AI 칸 세 개(spec 023)의 결과 그리기. 문장·질문·초안·평가서 보완점 목록과 코드가 대조한 줄.
import { h, badge } from "./dom.js";
import { FACT_STATE_LABELS } from "../domain/ai-facts-rules.js";
import { REVIEW_FIELDS } from "../domain/review-rules.js";
import { chip, claimView, flagList, isMasked } from "./ai-panel.js";

const byIdOf = (facts) => new Map(facts.rows.map((row) => [row.id, row]));
const list = (items, byId) => h("ol", { class: "ai-claims" }, ...items.map((item) => claimView(item, byId)));
const FIELD_LABELS = Object.fromEntries(REVIEW_FIELDS.map((spec) => [spec.key, spec.label]));

/** 코드가 대조한 어긋남(평가서 글과 이슈 기록·조치 상태): AI가 실패해도 보인다 */
export function codeCheckLines(facts) {
  const rows = facts.rows.filter((row) => row.id.startsWith("chk_"));
  return h("div", { class: "ai-codecheck" },
    h("h4", { class: "subsection-title" }, "코드가 대조한 결과 (AI가 아니라 코드가 이슈 기록과 맞춰 본 것)"),
    rows.length
      ? h("ul", null, ...rows.map((row) => h("li", null, `${row.label.replace("코드 대조: ", "")}: ${row.value} `, row.state === "ok" ? null : badge(`fact_${row.state}`, FACT_STATE_LABELS[row.state]))))
      : h("p", { class: "muted" }, "코드 대조에서 찾은 어긋남은 없습니다. 이것이 평가서가 적절하다는 보증은 아닙니다."));
}

function draftBlock(draft, onUseDraft) {
  const flagged = draft.flags.length > 0;
  return h("div", { class: "ai-draft" },
    h("h4", { class: "subsection-title" }, "조치 요청 내용 초안"),
    flagged
      ? h("div", { class: "stack" }, h("p", { class: "error-text", role: "alert" }, "검증에 걸려 요청 창에 채우지 않습니다."), flagList(draft.flags),
        isMasked(draft.flags) ? h("details", null, h("summary", null, "가린 초안 (눌러서 보기)"), h("p", { class: "ai-draft-text" }, draft.text)) : h("p", { class: "ai-draft-text" }, draft.text))
      : h("div", { class: "stack" },
        h("p", { class: "ai-draft-text" }, draft.text),
        h("button", { class: "button button--primary", type: "button", onclick: () => onUseDraft(draft.text) }, "조치 요청 창에 채우기"),
        h("p", { class: "muted" }, "채워도 저장되지 않습니다. 직접 읽고 고친 뒤 기존 '요청' 버튼을 눌러야 저장됩니다.")));
}

/** 조사 준비: 확인된 사실 · 더 확인할 질문 · 요청 내용 초안 */
export function issuePrepView(result, facts, { onUseDraft }) {
  const byId = byIdOf(facts);
  return [
    h("h4", { class: "subsection-title" }, "확인된 사실"), list(result.claims, byId),
    h("h4", { class: "subsection-title" }, "더 확인할 질문"),
    result.questions.length ? list(result.questions, byId) : h("p", { class: "muted" }, "AI가 더 확인할 질문을 찾지 못했습니다(더 확인할 것이 없다는 보증은 아닙니다)."),
    result.draft ? draftBlock(result.draft, onUseDraft) : null,
  ];
}

function findingView(finding, byId) {
  const flags = finding.flags ?? [];
  const body = [h("p", null, finding.reason), finding.ask ? h("p", null, `확인 질문: ${finding.ask}`) : null, finding.suggest ? h("p", null, `수정 제안: ${finding.suggest}`) : null];
  return h("li", { class: flags.length ? "ai-claim ai-claim--flagged" : "ai-claim" },
    h("blockquote", { class: "ai-quote" }, `${FIELD_LABELS[finding.field] ?? finding.field}: “${finding.quote}”`),
    isMasked(flags) ? h("details", null, h("summary", null, "승인·안전·원인 단정 표현이 있어 가린 문장 (눌러서 보기)"), ...body) : body,
    flags.length ? flagList(flags) : h("p", { class: "ai-chips" }, ...finding.refs.map((id) => byId.get(id)).filter(Boolean).map(chip)));
}

/** 평가서 보완: 보완이 필요한 원문 · 관련 근거 · 이유 · 질문/제안 (중요한 것부터 최대 5개) */
export function reviewCheckView(result, facts) {
  const byId = byIdOf(facts);
  return [
    h("h4", { class: "subsection-title" }, "AI가 찾은 보완할 점"),
    result.findings.length
      ? h("ol", { class: "ai-claims" }, ...result.findings.map((finding) => findingView(finding, byId)))
      : h("p", { class: "muted" }, "AI가 보완할 점을 찾지 못했습니다. 점검한 범위는 아래 한계를 보세요. 문제 없음은 품질 적합 보증이 아닙니다."),
  ];
}

function claimsView(result, facts, title) {
  const byId = byIdOf(facts);
  return [
    h("h4", { class: "subsection-title" }, title), list(result.claims, byId),
    result.questions.length ? [h("h4", { class: "subsection-title" }, "더 확인할 질문"), list(result.questions, byId)] : null,
  ].flat().filter(Boolean);
}

/** 조치 후 확인: 관찰 · 더 확인할 질문 */
export const afterActionView = (result, facts) => claimsView(result, facts, "AI가 정리한 관찰");

/** 기준 변경 영향: "현재 기준으로 비교한 참고 결과"임을 먼저 밝힌다 (원래 판정은 바뀌지 않는다) */
export const specImpactView = (result, facts) => [
  h("p", { class: "release-notice", role: "note" }, "현재 기준으로 비교한 참고 결과입니다. 원래 판정·로트 상태·승인 이력은 바뀌지 않습니다."),
  ...claimsView(result, facts, "AI가 설명한 영향"),
];

/** 일정 확인: 확인 순서·담당 역할·근거 (예측·변경 지시 없음) */
export const scheduleView = (result, facts) => claimsView(result, facts, "확인 순서와 담당 역할");
