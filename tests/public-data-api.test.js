import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeServiceKey, fetchPublicData, verifyUser, createPublicHandler,
} from "../api/_public-data.js";
import { loadPermit } from "../api/permit.js";

const KEY = "AbC%2BdEf%3D%3D"; // 가짜 Encoding 키
const DECODED = "AbC+dEf==";

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(text) { this.body = text; },
  };
}

test("인증키 정리: Encoding 키는 한 번만 풀고, 빈 값은 null (FR-004)", () => {
  assert.equal(normalizeServiceKey(KEY), DECODED);
  assert.equal(normalizeServiceKey(DECODED), DECODED);
  assert.equal(normalizeServiceKey("  "), null);
  assert.equal(normalizeServiceKey(undefined), null);
});

test("허가정보 응답의 items를 그대로 꺼낸다", async () => {
  const fetchImpl = async () => jsonResponse({
    header: { resultCode: "00" }, body: { totalCount: 7, items: [{ ITEM_SEQ: "1", ITEM_NAME: "가" }] },
  });
  const result = await fetchPublicData({ endpoint: "https://x.test/a", params: { item_name: "가" }, rawKey: KEY, fetchImpl });
  assert.deepEqual(result, { ok: true, totalCount: 7, items: [{ ITEM_SEQ: "1", ITEM_NAME: "가" }] });
});

test("회수 응답의 items[].item 모양을 펴고, 0건이면 빈 목록", async () => {
  const nested = async () => jsonResponse({
    header: { resultCode: "00" }, body: { totalCount: 1, items: [{ item: { PRDUCT: "나" } }] },
  });
  assert.deepEqual((await fetchPublicData({ endpoint: "https://x.test/b", params: {}, rawKey: KEY, fetchImpl: nested })).items, [{ PRDUCT: "나" }]);
  const empty = async () => jsonResponse({ header: { resultCode: "00" }, body: { totalCount: 0, items: "" } });
  assert.deepEqual(await fetchPublicData({ endpoint: "https://x.test/b", params: {}, rawKey: KEY, fetchImpl: empty }),
    { ok: true, totalCount: 0, items: [] });
});

test("요청 주소에 풀린 키를 한 번만 인코딩해 넣는다", async () => {
  let called = "";
  const fetchImpl = async (url) => { called = String(url); return jsonResponse({ header: { resultCode: "00" }, body: { items: [] } }); };
  await fetchPublicData({ endpoint: "https://x.test/a", params: { type: "json" }, rawKey: KEY, fetchImpl });
  assert.match(called, /serviceKey=AbC%2BdEf%3D%3D/);
  assert.match(called, /type=json/);
});

test("오류 코드·XML 오류·시간 초과·연결 실패는 안전한 문구로, 키는 응답에 없다 (FR-004, SC-003)", async () => {
  const cases = [
    [async () => jsonResponse({ header: { resultCode: "30", resultMsg: `bad key ${DECODED}` } }), "공공데이터가 오류를 돌려주었습니다."],
    [async () => ({ ok: false, status: 403, text: async () => `<errMsg>SERVICE_KEY ${DECODED}</errMsg>` }), "공공데이터가 오류를 돌려주었습니다."],
    [async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }, "시간 초과"],
    [async () => { throw new TypeError(`fetch failed ${KEY}`); }, "연결 실패"],
  ];
  for (const [fetchImpl, reason] of cases) {
    const result = await fetchPublicData({ endpoint: "https://x.test/a", params: {}, rawKey: KEY, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    const text = JSON.stringify(result);
    assert.ok(!text.includes(DECODED) && !text.includes(KEY), "응답에 키가 들어감");
  }
});

test("인증키가 없으면 부르지 않는다", async () => {
  let called = false;
  const result = await fetchPublicData({ endpoint: "https://x.test/a", params: {}, rawKey: "", fetchImpl: async () => { called = true; } });
  assert.deepEqual(result, { ok: false, reason: "인증키 없음" });
  assert.equal(called, false);
});

test("로그인 확인: 토큰이 없으면 Supabase를 부르지 않고, 있으면 /auth/v1/user로 확인", async () => {
  let calls = 0;
  const okFetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), "https://sb.test/auth/v1/user");
    assert.equal(init.headers.Authorization, "Bearer good");
    assert.equal(init.headers.apikey, "anon");
    return jsonResponse({ id: "u1" });
  };
  const options = { supabaseUrl: "https://sb.test", anonKey: "anon" };
  assert.equal(await verifyUser({ headers: {} }, { ...options, fetchImpl: okFetch }), null);
  assert.equal(calls, 0);
  assert.equal(await verifyUser({ headers: { authorization: "Bearer good" } }, { ...options, fetchImpl: okFetch }), "u1");
  const denied = async () => jsonResponse({ msg: "bad" }, 401);
  assert.equal(await verifyUser({ headers: { authorization: "Bearer bad" } }, { ...options, fetchImpl: denied }), null);
  const broken = async () => { throw new TypeError("down"); };
  assert.equal(await verifyUser({ headers: { authorization: "Bearer x" } }, { ...options, fetchImpl: broken }), null);
});

test("함수: 로그인하지 않으면 401이고 공공데이터를 부르지 않는다 (FR-004)", async () => {
  let fetched = false;
  const handler = createPublicHandler({
    verify: async () => null,
    load: async () => { fetched = true; return { ok: true, items: [] }; },
  });
  const res = fakeRes();
  await handler({ url: "/api/permit?name=가", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(fetched, false);
  assert.equal(JSON.parse(res.body).ok, false);
});

test("함수: 검색어 검사 실패는 400, 성공은 200, 공공데이터 실패는 502와 걸린 시간", async () => {
  const handler = createPublicHandler({
    verify: async () => "u1",
    load: async (query) => {
      if (!query.get("name")) return { status: 400, body: { ok: false, reason: "검색어 없음" } };
      if (query.get("name") === "fail") return { ok: false, reason: "시간 초과" };
      return { ok: true, totalCount: 1, items: [{ ITEM_NAME: "가" }] };
    },
  });
  const empty = fakeRes();
  await handler({ url: "/api/permit?name=", headers: {} }, empty);
  assert.equal(empty.statusCode, 400);
  const good = fakeRes();
  await handler({ url: "/api/permit?name=%EA%B0%80", headers: {} }, good);
  assert.equal(good.statusCode, 200);
  assert.equal(JSON.parse(good.body).items[0].ITEM_NAME, "가");
  assert.equal(good.headers["cache-control"], "no-store");
  const failed = fakeRes();
  await handler({ url: "/api/permit?name=fail", headers: {} }, failed);
  assert.equal(failed.statusCode, 502);
  const body = JSON.parse(failed.body);
  assert.equal(body.reason, "시간 초과");
  assert.equal(typeof body.ms, "number");
});

test("허가정보 함수: vaccine=1이면 100건을 받아 백신류만 최대 10건, PRDUCT_TYPE 포함 (spec 006 FR-001)", async () => {
  const items = [
    ...Array.from({ length: 12 }, (_, i) => ({ ITEM_SEQ: `v${i}`, ITEM_NAME: `백신${i}`, PRDUCT_TYPE: "[06310]백신류", EXTRA: "x" })),
    ...Array.from({ length: 5 }, (_, i) => ({ ITEM_SEQ: `n${i}`, ITEM_NAME: `정${i}`, PRDUCT_TYPE: "[01140]해열.진통.소염제" })),
  ];
  let called = "";
  const fetchImpl = async (url) => { called = String(url); return jsonResponse({ header: { resultCode: "00" }, body: { totalCount: 17, items } }); };
  const result = await loadPermit(new URLSearchParams({ name: "백신", vaccine: "1" }), { fetchImpl, rawKey: KEY });
  assert.match(called, /numOfRows=100/);
  assert.equal(result.items.length, 10);
  assert.ok(result.items.every((item) => item.PRDUCT_TYPE === "[06310]백신류"));
  assert.equal(result.items[0].EXTRA, undefined); // 화면이 쓰는 칸만
});

test("허가정보 함수: vaccine이 없으면 10건을 받아 그대로 (지금과 같음)", async () => {
  const items = [{ ITEM_SEQ: "n1", PRDUCT_TYPE: "[01140]해열.진통.소염제" }, { ITEM_SEQ: "v1", PRDUCT_TYPE: "[06310]백신류" }];
  let called = "";
  const fetchImpl = async (url) => { called = String(url); return jsonResponse({ header: { resultCode: "00" }, body: { totalCount: 2, items } }); };
  const result = await loadPermit(new URLSearchParams({ name: "가" }), { fetchImpl, rawKey: KEY });
  assert.match(called, /numOfRows=10(&|$)/);
  assert.deepEqual(result.items.map((item) => item.ITEM_SEQ), ["n1", "v1"]);
});
