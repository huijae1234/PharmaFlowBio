// 제조소 GMP 적합판정서 발급현황 (spec 021 FR-001, 공공데이터포털 15097207). ?name=업체명
import { createPublicHandler, fetchPublicData } from "./_public-data.js";

const ENDPOINT = "https://apis.data.go.kr/1471000/DrugGmpStbltJgmtIssuStusService/getDrugGmpStbltJgmtIssuStusInq";
// 포털 문서(2026-10-28)의 응답 항목 이름 중 화면이 쓰는 칸만 내보낸다
const FIELDS = ["BSSH_NM", "FCTR_ADDR", "KGMP_BGMP_NAME", "GMP_INGR_MM_GROUP_NAME", "VLD_PRD_YMD"];
const MAX_ROWS = 100;

function pick(item) {
  return Object.fromEntries(FIELDS.map((field) => [field, item[field] ?? null]));
}

/**
 * @param {URLSearchParams} query
 * @param {{ fetchImpl?: typeof fetch, rawKey?: string }} [options] 시험에서 가짜 응답을 넣는다
 */
export async function loadGmp(query, { fetchImpl = fetch, rawKey = process.env.DATA_GO_KR_SERVICE_KEY } = {}) {
  const name = query.get("name")?.trim();
  if (!name) return { status: 400, body: { ok: false, reason: "업체명을 입력해 주세요." } };
  const params = { type: "json", pageNo: "1", numOfRows: String(MAX_ROWS), BSSH_NM: name };
  const result = await fetchPublicData({ endpoint: ENDPOINT, params, rawKey, fetchImpl });
  return result.ok ? { ...result, items: result.items.map(pick) } : result;
}

export default createPublicHandler({ load: (query) => loadGmp(query) });
