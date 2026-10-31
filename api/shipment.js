// 감염병백신 국가출하승인정보 (spec 021 FR-002, 공공데이터포털 15084883). ?name=제품명
// 이 API는 접수번호로만 거를 수 있어 제품명으로 못 찾는다. 자료는 접수 순서로 쌓여 최신이 마지막 쪽에 있다
// (2026-10-29 실제 호출: 1쪽 2016~2019, 61쪽 2026-09~10, 쪽 안의 날짜는 섞임). 그래서 전체 건수를 먼저 알고 끝 PAGES쪽을 받아 제품명으로 거른다.
// 훑은 건수(scanned)와 그중 가장 이른 판정일(since)을 같이 돌려줘 화면이 "최근 언제부터 본 것인지" 밝힌다 (spec Q3)
import { createPublicHandler, fetchPublicData } from "./_public-data.js";
import { sameProduct } from "../src/domain/regulatory-rules.js";

const ENDPOINT = "https://apis.data.go.kr/1471000/IcdVacinNatnShipmntAprvInfoService/getIcdVacinNatnShipmntAprvInfo";
const FIELDS = ["RCPT_PRCS_NO", "SPCM_FORM_LIMS_PRDLST_NM", "PRDLST_NM", "MNFT_SALPS_NM", "MNFT_NO", "RESULT_TIME", "PROVT_UNIT", "VLD_PRD"];
const PAGE_SIZE = 100;
const PAGES = 4; // shortcut: 최근 약 400건(2026-10 기준 약 4개월)만 본다. 더 넓히려면 PAGES를 올리고 하루 호출 한도를 본다

function pick(item) {
  return Object.fromEntries(FIELDS.map((field) => [field, item[field] ?? null]));
}

/**
 * @param {URLSearchParams} query
 * @param {{ fetchImpl?: typeof fetch, rawKey?: string }} [options] 시험에서 가짜 응답을 넣는다
 */
export async function loadShipment(query, { fetchImpl = fetch, rawKey = process.env.DATA_GO_KR_SERVICE_KEY } = {}) {
  const name = query.get("name")?.trim();
  if (!name) return { status: 400, body: { ok: false, reason: "제품명을 입력해 주세요." } };
  const call = (pageNo, numOfRows) => fetchPublicData({
    endpoint: ENDPOINT,
    params: { type: "json", pageNo: String(pageNo), numOfRows: String(numOfRows) },
    rawKey, fetchImpl, keyParam: "ServiceKey",
  });
  const head = await call(1, 1); // 전체 건수만 알면 된다
  if (!head.ok) return head;
  const lastPage = Math.ceil(head.totalCount / PAGE_SIZE);
  const pageNumbers = Array.from({ length: Math.min(PAGES, lastPage) }, (_, i) => lastPage - i);
  const pages = await Promise.all(pageNumbers.map((pageNo) => call(pageNo, PAGE_SIZE)));
  const received = pages.filter((page) => page.ok);
  if (pageNumbers.length && !received.length) return pages[0]; // 끝 쪽을 하나도 못 받으면 실패. 일부만 실패하면 받은 만큼만 보인다
  const scannedItems = received.flatMap((page) => page.items);
  const dates = scannedItems.map((item) => item.RESULT_TIME).filter(Boolean).sort();
  return {
    ok: true,
    totalCount: head.totalCount,
    scanned: scannedItems.length,
    since: dates[0] ?? null,
    items: scannedItems.filter((item) => sameProduct(name, item.PRDLST_NM)).map(pick),
  };
}

export default createPublicHandler({ load: (query) => loadShipment(query) });
