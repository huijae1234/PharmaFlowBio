// 품질 이슈 상세의 "품질 영향 평가" 칸 (IA QI_010100_PG 콘텐츠 우선순위 3, spec 005 FR-001~003, FR-005)
import { h, badge, formatDateTime, section } from "../dom.js";
import { openSafely } from "../modal.js";
import { NOT_RELEASE, openReviewDecisionModal, openReviewFormModal } from "./review-modals.js";
import { REVIEW_FIELDS, canResubmit, canReview, canWriteReview, reviewStatusLabel } from "../../domain/review-rules.js";
import { ackSlot } from "../ack-badge.js";

const RETURNED_LABELS = { rejected: "반려", revision_requested: "보완 요청" };

function actionButton(label, open) {
  return h("button", { class: "button button--primary", type: "button", onclick: openSafely(open) }, label);
}

function reviewBody(review) {
  return [
    h("p", { class: "request-head" },
      badge(`review_${review.status}`, reviewStatusLabel(review.status)),
      h("span", { class: "muted" }, `요청 ${review.requester?.display_name ?? ""} ${formatDateTime(review.requested_at)}`),
      review.reviewed_at ? h("span", { class: "muted" }, `· 검토 ${review.reviewer?.display_name ?? ""} ${formatDateTime(review.reviewed_at)}`) : null),
    // UJ E7: 되돌아온 이유를 먼저 보이게
    RETURNED_LABELS[review.status] ? h("p", { class: "rejected-reason" }, `${RETURNED_LABELS[review.status]} — 사유: ${review.review_comment ?? ""}`) : null,
    h("dl", { class: "review-content" }, ...REVIEW_FIELDS.flatMap((spec) => [h("dt", null, spec.label), h("dd", null, review[spec.key] || "-")])),
    review.status === "approved" ? h("p", { class: "muted" }, NOT_RELEASE) : null, // FR-005 수용 기준 3
  ];
}

/**
 * aiCheck: spec 023 "AI로 보완할 점 확인" 칸을 만드는 함수 (없으면 칸 없음). 저장된 평가서는 읽기만 한다
 * @param {{ profile: object, issue: object, review: object | null, evidence: () => Node, onDone: (message: string) => (notice?: string) => void, aiCheck?: Function }} context
 */
export function reviewSection({ profile, issue, review, evidence, onDone, aiCheck }) {
  const state = { issue, review, batch: issue.batch, profile };
  const buttons = [
    canWriteReview(state) ? actionButton("품질 영향 평가 작성", () => openReviewFormModal({
      issue, review: null, evidence, aiCheck, onDone: onDone("품질 영향 평가를 제출했습니다. QA 관리자의 검토를 기다립니다."),
    })) : null,
    canResubmit(state) ? actionButton("고쳐 다시 제출", () => openReviewFormModal({
      issue, review, evidence, aiCheck, onDone: onDone("품질 영향 평가를 다시 제출했습니다. QA 관리자의 검토를 기다립니다."),
    })) : null,
    canReview(state) ? actionButton("영향 평가 검토", () => openReviewDecisionModal({
      review, evidence, onDone: onDone("품질 영향 평가 검토를 저장했습니다."),
    })) : null,
  ].filter(Boolean);
  return section("품질 영향 평가",
    ...(review ? reviewBody(review) : [h("p", { class: "muted" }, "아직 품질 영향 평가가 없습니다.")]),
    review ? ackSlot(review.id) : null, // spec 009 v0.7 FR-009
    buttons.length ? h("div", { class: "toolbar" }, ...buttons) : null,
    review ? aiCheck?.(() => review, "saved") : null);
}
