// IA PD_010202_TB 허가정보·회수 이력 탭 (spec 003 FR-002). 저장하지 않고 열 때마다 부른다 (PRD §9)
import { h } from "../dom.js";
import { publicPanel } from "../public-panel.js";
import { matchRecalls, permitRow, publicCacheKey } from "../../domain/public-data-rules.js";
import { callPublicData } from "../../infrastructure/public-data.js";

/** @param {{ item_name: string, permit_item_code: string | null }} product */
export function publicTab(product) {
  // FR-002 수용 기준 4: 예시 제품처럼 허가정보로 등록하지 않은 제품
  if (!product.permit_item_code) {
    return h("p", { class: "muted" }, "허가정보로 등록한 제품만 공공데이터를 볼 수 있습니다.");
  }
  return h("div", { class: "stack" },
    h("section", { class: "panel" },
      h("h2", { class: "section-title" }, "허가정보"),
      // spec 006 FR-002 수용 기준 5
      h("p", { class: "public-notice" }, "허가정보는 실제 공개 자료입니다. 로트 시험 규격과 내부 출하 검토는 교육용 가상 자료이며, 허가정보를 시험 규격이나 국가출하승인 정보로 쓰지 않습니다."),
      publicPanel({
        label: "허가정보",
        cacheKey: publicCacheKey("permit", { name: product.item_name }),
        load: () => callPublicData("permit", { name: product.item_name }),
        // 품목명으로 찾은 것 중 같은 품목기준코드인 줄만 쓴다 (이름이 비슷한 다른 품목이 섞여 와도 잘못 보이지 않게)
        render: (result) => permitDetails(result.items.map(permitRow).find((row) => row.code === product.permit_item_code)),
      })),
    h("section", { class: "panel" },
      h("h2", { class: "section-title" }, "회수·판매중지 이력"),
      publicPanel({
        label: "회수·판매중지 이력",
        cacheKey: publicCacheKey("recall", { name: product.item_name }),
        load: () => callPublicData("recall", { name: product.item_name }),
        render: (result) => recallList(matchRecalls(result.items, product.permit_item_code)),
      })));
}

// FR-002 수용 기준 1: 허가일, 전문·일반 구분, 업체명, 취소 여부
function permitDetails(row) {
  if (!row) return h("p", { class: "muted" }, "허가정보를 찾을 수 없습니다. 허가가 정리된 품목일 수 있습니다.");
  const items = [["품목명", row.name], ["업체명", row.company], ["주성분", row.ingredient], ["구분", row.kind],
    ["허가일", row.permitDate], ["상태", row.status]];
  return h("dl", { class: "info-list" }, ...items.flatMap(([label, value]) => [h("dt", null, label), h("dd", null, value || "-")]));
}

// FR-002 수용 기준 2·3: 회수 사유, 회수 명령일, 제조번호 (최근순)
function recallList(rows) {
  if (!rows.length) return h("p", { class: "muted" }, "이 제품의 회수·판매중지 공지가 없습니다.");
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ...["회수 명령일", "회수 사유", "제조번호", "업체명"].map((title) => h("th", { scope: "col" }, title)))),
    h("tbody", null, ...rows.map((row) => h("tr", null,
      h("td", { class: "mono" }, row.commandDate),
      h("td", null, row.reason),
      h("td", { class: "mono" }, row.lotNumber),
      h("td", null, row.company))))));
}
