// 입력 모달 틀 (IA 공통 컴포넌트 "모달 틀"). 브라우저 <dialog>를 써서 Esc로 닫히고 포커스가 안에 머문다.
// FR-009 수용 기준 4: 저장 중에는 저장 버튼을 잠가 두 번 저장되지 않게 한다.
// FR-014: 저장에 실패하면 모달과 입력값을 그대로 두고 문구만 보여 준다.
import { h } from "./dom.js";

/**
 * @param {{ title: string, fields: Node[], submitLabel: string, onSubmit: (form: HTMLFormElement) => Promise<void> }} options
 *   onSubmit이 오류를 던지면 그 문구를 보여 주고 모달을 연 채로 둔다. 끝까지 가면 모달을 닫는다.
 */
export function openModal({ title, fields, submitLabel, onSubmit }) {
  const error = h("p", { class: "error-text", role: "alert" });
  const submit = h("button", { class: "button button--primary", type: "submit" }, submitLabel);
  const cancel = h("button", { class: "button", type: "button", onclick: () => dialog.close() }, "취소");
  const form = h("form", { class: "modal-form", method: "dialog" },
    h("h2", { class: "section-title" }, title),
    ...fields,
    error,
    h("div", { class: "modal-actions" }, cancel, submit));

  const dialog = h("dialog", { class: "modal", "aria-label": title }, form);
  let saving = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    submit.disabled = true;
    submit.textContent = "저장하는 중…";
    error.textContent = "";
    try {
      await onSubmit(form);
      dialog.close();
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      saving = false;
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  });
  dialog.addEventListener("close", () => dialog.remove());

  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * 모달을 여는 데 필요한 자료를 못 불러왔을 때 오류를 삼키지 않고 알린다 (전역 규칙: 오류는 삼키지 않는다)
 * @param {() => Promise<unknown>} open
 */
export function openSafely(open) {
  return () => open().catch((error) => window.alert(error.message));
}

/** 이름표가 붙은 입력 칸 (디자인 기본선: 이름표를 항상 보이게) */
export function field(label, control, hint) {
  return h("label", { class: "field" },
    h("span", { class: "field-label" }, label),
    control,
    hint ? h("span", { class: "field-hint" }, hint) : null);
}
