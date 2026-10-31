// 품질 이슈 상세 (UI 개편): 단계 카드를 한 줄에 놓고, 고른 단계의 내용을 바로 아래에 보인다.
// 위의 가로 흐름과 아래의 세로 목록이 따로 놀지 않게 하나로 합쳤고, "다음에 할 일"은 지금 단계 카드 안에만 둔다
import { h } from "./dom.js";

/**
 * @param {{ cards: { index: number, name: string, state: string, headline: string, sub: string, next: string, owner: string }[], panels: (Node | null)[] }} input
 *   처음에는 지금 단계가 열려 있다. 지난 단계 카드를 누르면 그 단계의 내용을 볼 수 있다
 */
export function stagePipeline({ cards, panels }) {
  const start = (cards.find((card) => card.state === "current") ?? cards[0]).index;
  const buttons = [];
  const holders = panels.map((panel, index) => h("div", {
    class: "pipe-panel", id: `pipe-panel-${index}`, hidden: index !== start,
  }, panel ?? h("p", { class: "muted" }, "이 단계에서 할 일이 없습니다.")));

  function select(index) {
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
    holders.forEach((holder, i) => { holder.hidden = i !== index; });
  }

  const row = h("ol", { class: "pipe-row", "aria-label": "처리 단계" }, ...cards.map((card) => {
    const button = h("button", {
      type: "button",
      class: `pipe-card pipe-card--${card.state}`,
      "aria-pressed": String(card.index === start),
      "aria-controls": `pipe-panel-${card.index}`,
      "aria-current": card.state === "current" ? "step" : null,
      onclick: () => select(card.index),
    },
    h("span", { class: "pipe-top" },
      h("span", { class: "pipe-dot", "aria-hidden": "true" }, card.state === "done" ? "✓" : String(card.index + 1)),
      h("span", { class: "pipe-name" }, card.name),
      card.state === "current" ? h("span", { class: "pipe-now" }, "지금") : null),
    h("strong", { class: "pipe-head" }, card.headline),
    card.sub ? h("span", { class: "pipe-sub" }, card.sub) : null,
    card.next ? h("span", { class: "pipe-next" }, `다음: ${card.next}`, card.owner ? h("small", null, `담당 ${card.owner}`) : null) : null);
    buttons.push(button);
    return h("li", null, button);
  }));

  return h("div", { class: "pipeline" }, row, ...holders);
}
