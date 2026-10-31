// 회수·판매중지 (spec 003 FR-002, FR-003). ?name=제품명 (그 제품의 공지) 또는 ?recent=5 (최근 공지)
// 품목기준코드로 거르기(Q25)와 최근순 정렬은 화면의 public-data-rules가 한다
import { createPublicHandler, fetchPublicData } from "./_public-data.js";

const ENDPOINT = "https://apis.data.go.kr/1471000/MdcinRtrvlSleStpgeInfoService05/getMdcinRtrvlSleStpgeItem05";
const FIELDS = ["ITEM_SEQ", "PRDUCT", "ENTRPS", "RTRVL_RESN", "RECALL_COMMAND_DATE", "MNFCTUR_NO"];

function pick(item) {
  return Object.fromEntries(FIELDS.map((field) => [field, item[field] ?? null]));
}

async function load(query) {
  const name = query.get("name")?.trim();
  const recent = Math.min(Number.parseInt(query.get("recent") ?? "", 10) || 0, 20);
  if (!name && !recent) return { status: 400, body: { ok: false, reason: "제품명을 입력해 주세요." } };
  const params = name
    ? { type: "json", pageNo: "1", numOfRows: "100", Prduct: name }
    : { type: "json", pageNo: "1", numOfRows: String(recent) };
  const result = await fetchPublicData({ endpoint: ENDPOINT, params, rawKey: process.env.DATA_GO_KR_SERVICE_KEY });
  return result.ok ? { ...result, items: result.items.map(pick) } : result;
}

export default createPublicHandler({ load });
