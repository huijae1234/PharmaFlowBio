// 공공데이터 칸 하나 (spec 003 FR-004, UJ E4): 불러오는 중 → 내용, 실패하면 이 칸에만 안내와 다시 시도.
// 칸마다 따로 불러오므로 한 칸이 15초 걸려도 화면의 다른 부분은 먼저 보인다 (Q14)
import { h, put, badge } from "./dom.js";
import { sourceText, lastGoodText } from "../domain/public-data-rules.js";
import { readLastGood, saveLastGood } from "../infrastructure/public-cache.js";

/**
 * @param {{ label: string, load: () => Promise<{ ok: boolean }>, render: (result: any) => Node | Node[], cacheKey?: string }} options
 *   label 예: "허가정보" → "허가정보를 불러오는 중…", "허가정보를 불러오지 못했습니다. …"
 *   cacheKey가 있으면 정상 결과를 이 기기에 보관하고, 실패하면 그 결과를 보여 준다 (spec 006 FR-003). 없으면 보관하지 않는다 (제품 등록 검색, Q39)
 * @returns {HTMLElement}
 */
export function publicPanel({ label, load, render, cacheKey }) {
  const box = h("div", { class: "public-panel", "aria-live": "polite" });
  const run = async () => {
    put(box, h("p", { class: "muted", role: "status" }, `${label}${objectParticle(label)} 불러오는 중…`));
    const result = await load();
    if (result.ok) {
      const fetchedAt = new Date();
      const fixture = result.fixture === true;
      // spec 019 FR-003: 시험 자료는 보관하지 않는다 (실제 결과의 마지막 정상 조회를 덮지 않게)
      if (cacheKey && !fixture) saveLastGood(cacheKey, result, fetchedAt);
      // spec 006 FR-002: 칸마다 출처와 그 칸을 불러온 시각 (다시 시도하면 새 시각)
      put(box,
        fixture ? badge("fixture", "시험 자료") : null,
        render(result),
        h("p", { class: "source-line" }, sourceText(fetchedAt, { fixture })));
      return;
    }
    const lastGood = cacheKey ? readLastGood(cacheKey) : null;
    put(box,
      h("p", { class: "error-text", role: "alert" }, `${label}${objectParticle(label)} 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.`),
      h("button", { class: "button", type: "button", onclick: run }, "다시 시도"),
      lastGood ? h("div", { class: "last-good" }, h("p", { class: "last-good-note" }, lastGoodText(lastGood.savedAt)), render(lastGood)) : null);
  };
  run();
  return box;
}

// "허가정보를", "회수 공지를", "물질 목록을": 마지막 글자에 받침이 있으면 "을"
function objectParticle(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "를";
  return code % 28 ? "을" : "를";
}
