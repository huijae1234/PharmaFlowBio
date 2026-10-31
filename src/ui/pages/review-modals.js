// IA QI_010105_MD 품질 영향 평가 작성·다시 제출, QI_010106_MD 품질 영향 평가 검토 (spec 005 FR-001~003, FR-005)
import { h } from "../dom.js";
import { openModal, field } from "../modal.js";
import { REVIEW_FIELDS, checkReviewFields } from "../../domain/review-rules.js";
import { decideReview, resubmitReview, submitReview } from "../../infrastructure/store-reviews.js";

// GLOSSARY 품질 영향 평가: 승인은 평가를 받아들인다는 뜻이고 사용·출하 승인이 아니다 (FR-005, 전환 D8)
export const NOT_RELEASE = "승인은 영향 평가를 받아들인다는 뜻이며 사용·출하 승인이 아닙니다.";
// 이 문구로 거부되면 모달을 닫고 최신 상태를 다시 그린다 (0016_deviation_review.sql, 동시 처리)
const REFRESH_MESSAGES = ["다른 사람이 먼저 처리했습니다", "이미 품질 영향 평가가 있습니다"];
const FIELD_HINTS = {
  deviation_summary: "무엇이 어떤 기준을 얼마나 벗어났는지",
  probable_cause: "지금까지 알아본 원인",
  impact_assessment: "제품 품질·안전에 주는 영향과 그렇게 본 이유",
  proposed_action: "재시험·설비 점검·원료 확인 등",
  evidence: "문서 번호나 자료 설명 (선택, 파일 첨부 없음)",
};
const DECISIONS = [
  { value: "approved", label: "승인" },
  { value: "revision_requested", label: "보완 요청" },
  { value: "rejected", label: "반려" },
];

async function saveOrRefresh(save, onDone) {
  try {
    await save();
  } catch (error) {
    if (!REFRESH_MESSAGES.some((message) => error.message.includes(message))) throw error;
    onDone(error.message);
    return;
  }
  onDone();
}

function reviewInputs(review) {
  return REVIEW_FIELDS.map((spec) => {
    // 브라우저 기본 확인 대신 칸 옆 한국어 이유를 보이려고 required 대신 aria-required
    const input = h("textarea", { class: "input textarea", name: spec.key, rows: "3", maxlength: "1000", "aria-required": spec.required ? "true" : null });
    input.value = review?.[spec.key] ?? "";
    const error = h("span", { class: "error-text", role: "alert" });
    const node = h("label", { class: "field" },
      h("span", { class: "field-label" }, spec.required ? spec.label : `${spec.label} (선택)`),
      input, h("span", { class: "field-hint" }, FIELD_HINTS[spec.key]), error);
    return { spec, input, error, node };
  });
}

// Q33: 로트·발생 일시·시험 항목·측정값·판정·그때 기준과 버전·재시험 결과(공정이면 공정 기록)는 이슈에서 읽어 보여 준다
function evidenceBlock(evidence) {
  return h("div", { class: "review-evidence" }, h("p", { class: "field-label" }, "이탈 근거 (자동 표시)"), evidence());
}

/**
 * FR-001 작성, FR-003 다시 제출. review가 있으면 다시 제출
 * aiCheck: 작성 중인 글을 읽기만 하는 "AI로 보완할 점 확인" 칸 (spec 023). 글을 바꾸거나 제출하지 않고, 실패해도 작성 내용은 그대로다
 * @param {{ issue: { id: string }, review: object | null, evidence: () => Node, onDone: (notice?: string) => void,
 *   aiCheck?: (getValues: () => Record<string, string>, source: "draft", watch: (check: () => void) => void) => Node | null }} options
 */
export function openReviewFormModal({ issue, review, evidence, onDone, aiCheck }) {
  const inputs = reviewInputs(review);
  const returned = review ? h("p", { class: "rejected-reason" },
    `${review.status === "rejected" ? "반려" : "보완 요청"} — 사유: ${review.review_comment ?? ""}`) : null;
  openModal({
    title: review ? "품질 영향 평가 고쳐 다시 제출" : "품질 영향 평가 작성",
    fields: [returned, evidenceBlock(evidence), ...inputs.map((item) => item.node),
      aiCheck?.(() => Object.fromEntries(inputs.map((item) => [item.spec.key, item.input.value])), "draft", (check) => inputs.forEach((item) => item.input.addEventListener("input", check)))].filter(Boolean),
    submitLabel: "검토 요청",
    onSubmit: async () => {
      inputs.forEach((item) => { item.error.textContent = ""; });
      const checked = checkReviewFields(Object.fromEntries(inputs.map((item) => [item.spec.key, item.input.value])));
      if (!checked.ok) {
        for (const item of inputs) item.error.textContent = checked.errors[item.spec.key] ?? ""; // 칸 옆에 (FR-001 수용 기준 2)
        inputs.find((item) => checked.errors[item.spec.key])?.input.focus();
        throw new Error("");
      }
      await saveOrRefresh(() => (review ? resubmitReview(review.id, checked.value) : submitReview(issue.id, checked.value)), onDone);
    },
  });
  return Promise.resolve();
}

function reviewContent(review) {
  return h("dl", { class: "review-content" }, ...REVIEW_FIELDS.flatMap((spec) => [
    h("dt", null, spec.label), h("dd", null, review[spec.key] || "-")]));
}

/**
 * FR-002: 승인·반려·보완 요청. 반려·보완은 사유 필수
 * @param {{ review: object, evidence: () => Node, onDone: (notice?: string) => void }} options
 */
export function openReviewDecisionModal({ review, evidence, onDone }) {
  const reason = h("textarea", { class: "input textarea", name: "reason", rows: "3", maxlength: "1000" });
  const reasonError = h("span", { class: "error-text", role: "alert" });
  openModal({
    title: "품질 영향 평가 검토",
    fields: [
      h("p", { class: "release-notice", role: "note" }, NOT_RELEASE),
      evidenceBlock(evidence),
      h("p", { class: "muted" }, `요청 ${review.requester?.display_name ?? ""}`),
      reviewContent(review),
      h("fieldset", { class: "choices" },
        h("legend", { class: "field-label" }, "검토 결과"),
        ...DECISIONS.map(({ value, label }) => h("label", { class: "choice" },
          h("input", { type: "radio", name: "decision", value, required: true }), h("span", null, label)))),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "사유 (보완 요청·반려는 필수)"), reason, reasonError),
    ],
    submitLabel: "검토 저장",
    onSubmit: async (form) => {
      reasonError.textContent = "";
      const decision = form.elements.decision.value;
      if (!decision) throw new Error("승인·반려·보완 요청 중 하나를 골라 주세요.");
      if (decision !== "approved" && !reason.value.trim()) {
        reasonError.textContent = "사유를 입력해 주세요."; // FR-002 수용 기준 2
        reason.focus();
        throw new Error("");
      }
      await saveOrRefresh(() => decideReview({ reviewId: review.id, decision, reason: reason.value }), onDone);
    },
  });
  return Promise.resolve();
}
