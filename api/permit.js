// 허가정보 검색 (spec 003 FR-001, FR-002). ?name=품목명 (최대 10건).
// 품목기준코드(item_seq)로 거르는 요청 변수는 2026-10-22 확인 결과 무시돼 전체가 온다. 제품 상세는 품목명으로 찾고 화면에서 코드로 고른다
// spec 006 FR-001: ?vaccine=1이면 100건을 받아 품목 구분이 백신류인 것만 최대 10건 (화면에서 거르면 10건 중 몇 건만 남는다)
import { createPublicHandler, fetchPublicData } from "./_public-data.js";
import { isVaccineItem } from "../src/domain/public-data-rules.js";

const ENDPOINT = "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnInq08";
// 화면이 쓰는 칸만 내보낸다 (2026-10-22 실제 응답으로 확인한 이름)
const FIELDS = ["ITEM_SEQ", "ITEM_NAME", "ENTP_NAME", "ITEM_INGR_NAME", "SPCLTY_PBLC", "ITEM_PERMIT_DATE", "CANCEL_NAME", "PRDUCT_TYPE"];
const SHOWN = 10;
const VACCINE_POOL = 100; // 하루 한도는 요청 수 기준이라 100건을 받아도 1건

function pick(item) {
  return Object.fromEntries(FIELDS.map((field) => [field, item[field] ?? null]));
}

/**
 * @param {URLSearchParams} query
 * @param {{ fetchImpl?: typeof fetch, rawKey?: string }} [options] 시험에서 가짜 응답을 넣는다
 */
export async function loadPermit(query, { fetchImpl = fetch, rawKey = process.env.DATA_GO_KR_SERVICE_KEY } = {}) {
  const name = query.get("name")?.trim();
  if (!name) return { status: 400, body: { ok: false, reason: "품목명을 입력해 주세요." } };
  const vaccineOnly = query.get("vaccine") === "1";
  const params = { type: "json", pageNo: "1", numOfRows: String(vaccineOnly ? VACCINE_POOL : SHOWN), item_name: name };
  const result = await fetchPublicData({ endpoint: ENDPOINT, params, rawKey, fetchImpl });
  if (!result.ok) return result;
  const items = vaccineOnly ? result.items.filter(isVaccineItem).slice(0, SHOWN) : result.items;
  return { ...result, items: items.map(pick) };
}

export default createPublicHandler({ load: (query) => loadPermit(query) });
