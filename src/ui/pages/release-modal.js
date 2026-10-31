// IA BT_010208_MD 내부 출하 검토 (spec 002 FR-009, spec 004 FR-008). 막는 이유는 release-rules로 글로 보이고, 실제로 막는 것은 decide_release
// UI 개편: 검토 근거 체크리스트를 창 안에도 보이고, "근거를 확인했습니다"를 눌러야 저장된다 (되돌릴 수 없는 결정이라)
import { h } from "../dom.js";
import { openModal } from "../modal.js";
import { readinessList } from "./release-panel.js";
import { releaseBlockers } from "../../domain/release-rules.js";
import { decideRelease } from "../../infrastructure/store-actions.js";

const DECISIONS = [
  { value: "releasable", label: "출하 가능" },
  { value: "discarded", label: "폐기" },
];
// spec 004 FR-008 수용 기준 1, GLOSSARY 국가출하승인: 회사 내부 검토와 헷갈리지 않게
const NOT_NATIONAL_RELEASE = "회사 내부 검토이며 국가출하승인이 아닙니다.";

function choice({ value, label }, disabled) {
  return h("label", { class: disabled ? "choice choice--disabled" : "choice" },
    h("input", { type: "radio", name: "decision", value, required: true, disabled }),
    h("span", null, label));
}

/**
 * @param {{ batch: object, openIssueCount: number, testSpecs: object[], measurements: object[], checklist?: object[], onDone: (notice: string) => void }} options
 */
export function openReleaseModal({ batch, openIssueCount, testSpecs, measurements, checklist = [], onDone }) {
  const reasons = releaseBlockers({ batch, openIssueCount, testSpecs, measurements });
  const blocked = reasons.length > 0;
  // 폐기는 되돌릴 수 없어서 사유를 꼭 남긴다 (0035_release_reason). 폐기를 고르면 칸이 나타난다
  const reasonInput = h("textarea", { class: "input textarea", name: "reason", rows: "3", maxlength: "200", "aria-label": "폐기 사유" });
  const reasonField = h("label", { class: "field", hidden: true },
    h("span", { class: "field-label" }, "폐기 사유 (필수)"), reasonInput,
    h("span", { class: "field-hint" }, "예: 역가 규격 이탈, 재시험도 미달. 200자까지. 업무 이력에 남습니다."));
  const dialog = openModal({
    title: `내부 출하 검토 · ${batch.batch_number}`,
    fields: [
      h("p", { class: "release-notice", role: "note" }, NOT_NATIONAL_RELEASE),
      checklist.length ? h("div", { class: "ready-modal" }, h("p", { class: "field-label" }, "검토 근거"), readinessList(checklist)) : null,
      h("fieldset", { class: "choices" },
        h("legend", { class: "field-label" }, "검토 결과"),
        ...DECISIONS.map((decision) => choice(decision, decision.value === "releasable" && blocked))),
      // FR-009 수용 기준 2·4: 출하 가능을 고를 수 없는 이유를 글로
      blocked
        ? h("div", { class: "release-blockers", role: "note" },
            h("p", { class: "field-label" }, "출하 가능을 고를 수 없는 이유"),
            h("ul", null, ...reasons.map((reason) => h("li", null, reason))))
        : null,
      reasonField,
      h("label", { class: "choice" }, h("input", { type: "checkbox", name: "confirmed", required: true }), h("span", null, "위 근거를 확인했습니다.")),
      h("p", { class: "field-hint" }, "검토를 저장한 뒤에는 이 로트에 시험값·공정 조건·조치 요청을 더 넣을 수 없습니다."),
    ],
    submitLabel: "검토 저장",
    onSubmit: async (form) => {
      const decision = form.elements.decision.value;
      if (!decision) throw new Error("출하 가능 또는 폐기를 골라 주세요.");
      const reason = decision === "discarded" ? reasonInput.value.trim() : "";
      if (decision === "discarded" && !reason) {
        reasonInput.focus();
        throw new Error("폐기 사유를 적어 주세요.");
      }
      await decideRelease(batch.id, decision, reason);
      onDone(`내부 출하 검토를 저장했습니다: ${DECISIONS.find((item) => item.value === decision).label}`);
    },
  });
  // 폐기를 고르면 사유 칸을 보이고 필수로, 출하 가능이면 숨긴다
  dialog.addEventListener("change", (event) => {
    if (event.target.name !== "decision") return;
    const discard = event.target.value === "discarded";
    reasonField.hidden = !discard;
    reasonInput.required = discard;
  });
  return Promise.resolve();
}
