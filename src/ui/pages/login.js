// IA MB_000000_PG 로그인. FR-001 (spec 001)
import { h } from "../dom.js";
import { signInWithGoogle } from "../../infrastructure/store.js";

const LOGIN_FAILED = "로그인하지 못했습니다. 다시 시도해 주세요.";

/** @param {{ failed: boolean }} options 구글 로그인 창을 닫았거나 실패하고 돌아왔는가 */
export function renderLogin({ failed }) {
  const message = h("p", { class: "error-text", role: "alert" }, failed ? LOGIN_FAILED : "");
  const button = h("button", {
    class: "button button--primary button--wide",
    type: "button",
    onclick: async () => {
      button.disabled = true;
      button.textContent = "구글로 이동하는 중…";
      try {
        await signInWithGoogle();
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
        button.textContent = "구글로 로그인";
      }
    },
  }, "구글로 로그인");

  return h("main", { id: "content", class: "login-page" },
    h("section", { class: "panel login-panel" },
      h("img", { class: "login-icon", src: "assets/icon.svg", alt: "", width: "64", height: "64" }), // spec 009 FR-006
      h("h1", { class: "page-title login-brand" }, "PharmaFlow ", h("span", { class: "brand-sub" }, "Bio")), // spec 007 FR-001
      h("p", { class: "muted" }, "로트의 품질 이슈와 승인 이력을 한곳에서 확인합니다."),
      button,
      message,
      h("p", { class: "muted small" }, "처음 로그인하면 읽기만 할 수 있습니다. QA 관리자가 역할을 정해 주면 입력할 수 있습니다.")));
}
