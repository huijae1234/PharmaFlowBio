// 목록 검색 칸 (spec 007 FR-008). Enter나 "검색"으로 주소에 검색어를 남겨 새로 고쳐도 그대로다 (수용 기준 5)
import { h } from "./dom.js";
import { normalizeSearch } from "../domain/search-rules.js";

export const NO_SEARCH_RESULT = "검색 결과가 없습니다. 검색어를 바꿔 보세요.";

/**
 * @param {{ label: string, placeholder: string, value: string, onSearch: (term: string) => void }} options
 * @returns {HTMLFormElement}
 */
export function searchBox({ label, placeholder, value, onSearch }) {
  const input = h("input", { class: "input", type: "search", name: "q", value, placeholder, "aria-label": label, autocomplete: "off", maxlength: "60" });
  return h("form", {
    class: "search-box",
    role: "search",
    onsubmit: (event) => {
      event.preventDefault();
      onSearch(normalizeSearch(input.value));
    },
  }, input, h("button", { class: "button", type: "submit" }, "검색"));
}

/** 해시 주소 만들기: 빈 값은 빼고 "#/batches?status=…&q=…" */
export function hashWith(path, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return query.size ? `${path}?${query}` : path;
}
