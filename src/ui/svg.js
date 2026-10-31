// 도식용 SVG 만들기 (UI 개편). SVG는 createElementNS로 만든다. 글자는 textContent로만 넣는다 (dom.js의 h와 같은 안전 원칙)
const NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string | number | null | undefined>} [attrs]
 * @param {...(Node | string | number | null | undefined | false)} children
 */
export function svg(tag, attrs = {}, ...children) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
