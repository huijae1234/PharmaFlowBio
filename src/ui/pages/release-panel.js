// 로트 상세 "출하 판단 근거" 패널 (UI 개편): 내부 출하 검토를 하기 전에 봐야 할 것을 한 화면에.
// 왼쪽은 확인 5가지(시험·이슈·공정·검체·기준 버전), 오른쪽은 시험값이 기준 안에서 어디쯤인지와 같은 제품 다른 로트와의 비교.
// 막는 것은 release-rules.js와 데이터베이스 함수 decide_release이고, 여기는 보여 주기만 한다
import { h } from "../dom.js";
import { comparePanel } from "../compare-panel.js";

const ICONS = { ok: "✓", warn: "!", bad: "✕" };
const STATUS_TEXT = { ok: "확인됨", warn: "주의", bad: "확인 필요" };

/** 체크리스트 줄들 (출하 검토 창에서도 같은 것을 쓴다) @param {{ key: string, label: string, status: string, detail: string }[]} items */
export function readinessList(items) {
  return h("ul", { class: "ready-list" }, ...items.map((item) => h("li", { class: `ready-item ready-item--${item.status}` },
    h("span", { class: "ready-icon", "aria-hidden": "true" }, ICONS[item.status]),
    h("span", { class: "ready-text" }, h("strong", null, item.label), h("span", { class: "ready-detail" }, item.detail)),
    h("span", { class: "visually-hidden" }, STATUS_TEXT[item.status]))));
}

/** 요약 칩: "확인 필요 2건" / "주의 1건" / "모두 확인됨" @param {{ status: string }[]} items */
export function readinessSummary(items) {
  const bad = items.filter((item) => item.status === "bad").length;
  const warn = items.filter((item) => item.status === "warn").length;
  if (bad) return { tone: "bad", text: `확인 필요 ${bad}건` };
  if (warn) return { tone: "warn", text: `주의 ${warn}건` };
  return { tone: "ok", text: "모두 확인됨" };
}

/**
 * @param {{ batch: { id: string, batch_number: string }, items: object[], testSpecs: object[], productMeasurements: object[], decided?: boolean }} input
 */
export function releasePanel({ batch, items, testSpecs, productMeasurements, decided = false }) {
  const summary = readinessSummary(items);
  return h("section", { class: "panel ready-panel" },
    h("div", { class: "ready-head" },
      // 판단 전에는 "이걸 보고 결정하세요", 판단 뒤(출하 가능·출하 완료·폐기)에는 지금 기준의 기록
      h("h2", { class: "section-title" }, decided ? "출하 판단 근거 (검토가 끝난 로트, 지금 기준)" : "출하 판단 근거"),
      h("span", { class: `ready-chip ready-chip--${summary.tone}` }, summary.text)),
    h("div", { class: "ready-grid" },
      readinessList(items),
      h("div", { class: "ready-compare" },
        h("p", { class: "preview-label" }, "시험값 위치 · 같은 제품 최근 로트와 비교"),
        comparePanel({ specs: testSpecs, measurements: productMeasurements, batchId: batch.id, currentNumber: batch.batch_number, compact: true }))));
}
