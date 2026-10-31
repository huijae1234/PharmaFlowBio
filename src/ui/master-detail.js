// 목록 + 미리보기: 줄을 고르면 옆에 세부가 자동으로 뜬다 (넓은 화면). 좁은 화면에서는 줄이 곧 링크라 바로 상세로 간다
import { h, put } from "./dom.js";

const WIDE = "(min-width: 1100px)";

/**
 * @param {{
 *   items: object[],
 *   idOf: (item: object) => string,
 *   hrefOf: (item: object) => string,
 *   row: (item: object) => (Node | null)[],
 *   preview: (item: object) => Promise<Node>,
 *   empty: string,
 * }} input preview는 고른 줄마다 한 번만 부른다 (같은 줄을 다시 고르면 처음 그린 것을 그대로 보인다)
 */
export function masterDetail({ items, idOf, hrefOf, row, preview, empty }) {
  if (!items.length) return h("section", { class: "panel" }, h("p", { class: "empty-state" }, empty));

  const pane = h("aside", { class: "md-preview panel", "aria-live": "polite", "aria-label": "선택한 항목 미리보기" });
  const cache = new Map();
  let currentId = null;
  const links = new Map();

  async function select(item) {
    const id = idOf(item);
    currentId = id;
    for (const [linkId, link] of links) {
      if (linkId === id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    if (!cache.has(id)) {
      put(pane, h("p", { class: "muted" }, "불러오는 중…"));
      cache.set(id, preview(item).catch(() => h("p", { class: "error-text" }, "미리보기를 불러오지 못했습니다. 열기를 눌러 상세에서 확인해 주세요.")));
    }
    const node = await cache.get(id);
    if (currentId === id) put(pane, node);
  }

  const list = h("section", { class: "panel md-list", "aria-label": "목록" },
    h("p", { class: "md-hint" }, "↑ ↓ 로 고르고 Enter로 엽니다"),
    ...items.map((item) => {
      const link = h("a", {
        class: "md-row",
        href: hrefOf(item),
        onclick: (event) => {
          // 새 탭 열기(Ctrl·Cmd 클릭)와 좁은 화면은 원래 링크대로
          // 키보드(Enter)로 생긴 클릭(detail 0)은 원래 링크대로 상세를 연다
          if (event.detail === 0 || event.metaKey || event.ctrlKey || event.shiftKey || !window.matchMedia(WIDE).matches) return;
          event.preventDefault();
          select(item);
        },
      }, ...row(item));
      links.set(idOf(item), link);
      return link;
    }));

  // 업무용 화면: 마우스 없이 위아래 화살표로 줄을 옮기며 훑는다 (메일 목록과 같은 방식)
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...links.values()];
    const index = rows.indexOf(document.activeElement);
    if (index < 0) return;
    const target = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    event.preventDefault();
    if (!target) return;
    target.focus();
    if (window.matchMedia(WIDE).matches) select(items[rows.indexOf(target)]);
  });

  if (window.matchMedia(WIDE).matches) select(items[0]);
  return h("div", { class: "md" }, list, pane);
}
