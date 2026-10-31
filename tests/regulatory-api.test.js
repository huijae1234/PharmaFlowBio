// spec 021: GMP·국가출하승인 서버 함수 (가짜 응답으로 시험, 실제 사이트·키는 쓰지 않는다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGmp } from "../api/gmp.js";
import { loadShipment } from "../api/shipment.js";

const KEY = "AbC%2BdEf%3D%3D"; // 가짜 Encoding 키

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}
const okBody = (items, totalCount = items.length) => ({ header: { resultCode: "00" }, body: { totalCount, items } });

test("GMP: 업체명이 없으면 부르지 않고 400 (경계)", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse(okBody([])); };
  const result = await loadGmp(new URLSearchParams(""), { fetchImpl, rawKey: KEY });
  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test("GMP: 업체명 BSSH_NM으로 부르고 화면이 쓰는 칸만 돌려준다, 키는 밖으로 나가지 않는다 (FR-001)", async () => {
  let url;
  const fetchImpl = async (u) => {
    url = u;
    return jsonResponse(okBody([{ BSSH_NM: "가상백신(주)", FCTR_ADDR: "충북", KGMP_BGMP_NAME: "완제", GMP_INGR_MM_GROUP_NAME: "백신", VLD_PRD_YMD: "20270131", 비밀: "x" }]));
  };
  const result = await loadGmp(new URLSearchParams({ name: "가상백신(주)" }), { fetchImpl, rawKey: KEY });
  assert.equal(url.searchParams.get("BSSH_NM"), "가상백신(주)");
  assert.equal(url.searchParams.get("type"), "json");
  assert.equal(url.searchParams.get("serviceKey"), "AbC+dEf==");
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["BSSH_NM", "FCTR_ADDR", "GMP_INGR_MM_GROUP_NAME", "KGMP_BGMP_NAME", "VLD_PRD_YMD"]);
  assert.ok(!JSON.stringify(result).includes("AbC"));
});

test("GMP: 공공데이터가 오류면 안전한 문구만 (FR-001 수용 기준 4)", async () => {
  const fetchImpl = async () => jsonResponse({ header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR." } });
  const result = await loadGmp(new URLSearchParams({ name: "가" }), { fetchImpl, rawKey: KEY });
  assert.deepEqual(result, { ok: false, reason: "공공데이터가 오류를 돌려주었습니다." });
});

test("국가출하승인: 제품명이 없으면 부르지 않고 400 (경계)", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(okBody([])); };
  const result = await loadShipment(new URLSearchParams(""), { fetchImpl, rawKey: KEY });
  assert.equal(result.status, 400);
  assert.equal(calls, 0);
});

// 실제 API는 접수 순서로 쌓여 최신이 마지막 쪽에 있다 (2026-10-29 실제 호출: 1쪽 2016~2019, 61쪽 2026-09~10). 그래서 끝 쪽을 받는다
const shipmentPage = (n, size = 100) => Array.from({ length: size }, (_, i) => ({
  RCPT_PRCS_NO: `${n}-${i}`, PRDLST_NM: i === 0 ? "시험독감백신주" : "다른백신", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: `L${n}${i}`,
  RESULT_TIME: `202606${String(10 + (n % 20)).padStart(2, "0")}`, VLD_PRD: "20270101", SPCM_FORM_LIMS_PRDLST_NM: "x", PROVT_UNIT: "1",
}));

test("국가출하승인: 전체 건수를 먼저 알고 끝 4쪽(최신)을 받아 제품명으로 거르고, 훑은 건수·가장 이른 판정일을 알려 준다 (FR-002 수용 기준 1)", async () => {
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(u);
    if (u.searchParams.get("numOfRows") === "1") return jsonResponse(okBody([{ PRDLST_NM: "x" }], 4950));
    const n = Number(u.searchParams.get("pageNo"));
    return jsonResponse(okBody(shipmentPage(n, n === 50 ? 50 : 100), 4950));
  };
  const result = await loadShipment(new URLSearchParams({ name: "시험독감백신주" }), { fetchImpl, rawKey: KEY });
  assert.equal(urls.length, 5); // 건수 1 + 끝 4쪽
  assert.equal(urls[0].searchParams.get("numOfRows"), "1");
  assert.deepEqual(urls.slice(1).map((u) => u.searchParams.get("pageNo")).sort(), ["47", "48", "49", "50"]);
  assert.equal(urls[0].searchParams.get("ServiceKey"), "AbC+dEf=="); // 포털 문서의 요청변수 이름
  assert.equal(urls[0].searchParams.has("serviceKey"), false);
  assert.equal(result.ok, true);
  assert.equal(result.totalCount, 4950);
  assert.equal(result.scanned, 350);
  assert.equal(result.since, "20260617"); // 받은 줄 중 가장 이른 판정일 (47쪽 = 6월 17일)
  assert.equal(result.items.length, 4);
  assert.ok(result.items.every((item) => item.PRDLST_NM === "시험독감백신주"));
  assert.ok(!JSON.stringify(result).includes("AbC"));
});

test("국가출하승인: 건수 확인이 실패하면 실패, 끝 쪽 일부만 실패하면 받은 만큼만, 모두 실패하면 실패 (경계)", async () => {
  const headFails = async (u) => (u.searchParams.get("numOfRows") === "1"
    ? jsonResponse({ header: { resultCode: "99" } })
    : jsonResponse(okBody(shipmentPage(1), 300)));
  assert.equal((await loadShipment(new URLSearchParams({ name: "시험독감백신주" }), { fetchImpl: headFails, rawKey: KEY })).ok, false);

  const someFail = async (u) => {
    if (u.searchParams.get("numOfRows") === "1") return jsonResponse(okBody([{}], 400));
    return u.searchParams.get("pageNo") === "4" ? jsonResponse(okBody(shipmentPage(4), 400)) : jsonResponse({ header: { resultCode: "99" } });
  };
  const partial = await loadShipment(new URLSearchParams({ name: "시험독감백신주" }), { fetchImpl: someFail, rawKey: KEY });
  assert.equal(partial.ok, true);
  assert.equal(partial.scanned, 100);

  const allFail = async (u) => (u.searchParams.get("numOfRows") === "1"
    ? jsonResponse(okBody([{}], 400))
    : jsonResponse({ header: { resultCode: "99" } }));
  assert.equal((await loadShipment(new URLSearchParams({ name: "시험독감백신주" }), { fetchImpl: allFail, rawKey: KEY })).ok, false);
});

test("국가출하승인: 전체가 4쪽보다 적으면 있는 쪽만 받는다 (경계)", async () => {
  const pages = [];
  const fetchImpl = async (u) => {
    if (u.searchParams.get("numOfRows") === "1") return jsonResponse(okBody([{}], 150));
    pages.push(u.searchParams.get("pageNo"));
    return jsonResponse(okBody(shipmentPage(Number(u.searchParams.get("pageNo")), 75), 150));
  };
  const result = await loadShipment(new URLSearchParams({ name: "시험독감백신주" }), { fetchImpl, rawKey: KEY });
  assert.deepEqual(pages.sort(), ["1", "2"]);
  assert.equal(result.scanned, 150);
});

test("국가출하승인: 0건이면 빈 목록과 0건 훑음 (경계)", async () => {
  const fetchImpl = async () => jsonResponse({ header: { resultCode: "00" }, body: { totalCount: 0, items: "" } });
  const result = await loadShipment(new URLSearchParams({ name: "시험독감백신주" }), { fetchImpl, rawKey: KEY });
  assert.deepEqual({ ok: result.ok, scanned: result.scanned, items: result.items, since: result.since }, { ok: true, scanned: 0, items: [], since: null });
});
