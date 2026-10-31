// spec 019: 시험용 자료(fixtures/)로 입력 검사와 공공데이터 시험 모드를 확인한다. 자료별 기대·실제 결과는 docs/test-data.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseNumberInput } from "../src/domain/input-rules.js";
import { checkTestEntries } from "../src/domain/test-entry-rules.js";
import { permitRow, sourceText } from "../src/domain/public-data-rules.js";
import { fixtureModeOn, fixtureFetch } from "../api/_fixture-mode.js";
import { createPublicHandler } from "../api/_public-data.js";
import { loadPermit } from "../api/permit.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const measurements = await readJson("fixtures/measurements.json");
const broken = await readJson("fixtures/broken/measurements.json");
const VERDICTS = ["pass", "out_of_alert", "out_of_spec"];

test("자료 파일 모양: 번호가 겹치지 않고, 항목은 기준표에 있고, 기대 결과가 판정이나 문구다 (FR-001)", () => {
  const cases = [...measurements.cases, ...broken.cases];
  const ids = [...cases.map((c) => c.id), broken.duplicate.id];
  assert.equal(new Set(ids).size, ids.length);
  for (const c of cases) {
    assert.ok(measurements.specs[c.item], `${c.id} 항목 ${c.item}`);
    assert.ok(VERDICTS.includes(c.expect) || c.expect.endsWith("."), `${c.id} 기대 ${c.expect}`);
  }
  assert.ok(measurements.cases.every((c) => c.id.startsWith("N-") || c.id.startsWith("R-")));
});

test("판정 기대값이 기준표와 맞는다: 규격·관리기준 경계는 범위 안 (FR-005, 경계 상황)", () => {
  // DB private.judge와 같은 식. 자료를 잘못 적었는지 먼저 본다 (실제 판정은 019_rules.sql이 DB로 확인)
  const judge = (value, s) => {
    if (value < s.min || value > s.max) return "out_of_spec";
    if (value < s.alertMin || value > s.alertMax) return "out_of_alert";
    return "pass";
  };
  for (const c of [...measurements.cases, ...broken.cases].filter((c) => VERDICTS.includes(c.expect))) {
    assert.equal(judge(Number(c.input), measurements.specs[c.item]), c.expect, c.id);
  }
});

test("입력 검사: 판정이 기대인 값은 숫자로, 문구가 기대인 값은 그 문구로 (FR-005, 빈 값·단위·음수·경계값)", () => {
  for (const c of [...measurements.cases, ...broken.cases]) {
    const parsed = parseNumberInput(c.input);
    if (VERDICTS.includes(c.expect)) assert.deepEqual(parsed, { ok: true, value: Number(c.input) }, c.id);
    else assert.deepEqual(parsed, { ok: false, error: c.expect }, c.id);
  }
});

test("한 번에 입력: 빈 값만이면 하나 이상 입력 안내, 단위 붙은 칸은 그 칸에 문구 (FR-005, spec 017)", () => {
  const blank = broken.cases.filter((c) => c.group === "빈 값").map((c, i) => ({ specificationId: `s${i}`, text: c.input }));
  assert.deepEqual(checkTestEntries(blank), { ok: false, errors: {}, error: "시험값을 하나 이상 입력해 주세요." });
  const withUnit = broken.cases.find((c) => c.id === "B-03");
  const result = checkTestEntries([{ specificationId: "s-endo", text: withUnit.input }, { specificationId: "s-ph", text: "7.2" }]);
  assert.equal(result.ok, false);
  assert.equal(result.errors["s-endo"], "숫자로 입력해 주세요.");
});

test("시험 모드 스위치: fixtures일 때만, 배포(VERCEL)에서는 늘 꺼짐 (FR-002, 경계 상황)", () => {
  assert.equal(fixtureModeOn({ PUBLIC_DATA_MODE: "fixtures" }), true);
  assert.equal(fixtureModeOn({ PUBLIC_DATA_MODE: "fixtures", VERCEL: "1" }), false);
  assert.equal(fixtureModeOn({}), false);
  assert.equal(fixtureModeOn({ PUBLIC_DATA_MODE: "Fixtures" }), false);
  assert.equal(fixtureModeOn({ PUBLIC_DATA_MODE: "fixture" }), false);
  assert.equal(fixtureModeOn({ PUBLIC_DATA_MODE: "" }), false);
});

// 시험 모드를 켠 채로 허가정보를 부른다. 키가 없어도 시험 자료로 응답한다
async function permitInFixtureMode(name, extra = {}) {
  const before = process.env.PUBLIC_DATA_MODE;
  process.env.PUBLIC_DATA_MODE = "fixtures";
  try {
    return await loadPermit(new URLSearchParams({ name, ...extra }), { rawKey: undefined });
  } finally {
    if (before === undefined) delete process.env.PUBLIC_DATA_MODE;
    else process.env.PUBLIC_DATA_MODE = before;
  }
}

test("시험 모드 검색어별 응답: 정상·백신만·0건 (FR-002 수용 기준 1·2)", async () => {
  const normal = await permitInFixtureMode("인플루엔자");
  assert.equal(normal.ok, true);
  assert.equal(normal.items.length, 4);
  assert.ok(normal.items.every((item) => item.ITEM_NAME.includes("(시험 자료)")));
  const vaccine = await permitInFixtureMode("인플루엔자", { vaccine: "1" });
  assert.equal(vaccine.items.length, 3);
  const empty = await permitInFixtureMode("없음");
  assert.deepEqual([empty.ok, empty.totalCount, empty.items.length], [true, 0, 0]);
});

test("시험 모드 검색어별 응답: 실패 응답은 지금 실패 안내 길로 (FR-002 수용 기준 2, broken/public)", async () => {
  assert.deepEqual(await permitInFixtureMode("실패"), { ok: false, reason: "공공데이터가 오류를 돌려주었습니다." });
  assert.deepEqual(await permitInFixtureMode("XML"), { ok: false, reason: "공공데이터가 오류를 돌려주었습니다." });
  assert.deepEqual(await permitInFixtureMode("깨짐"), { ok: false, reason: "공공데이터가 오류를 돌려주었습니다." });
  assert.deepEqual(await permitInFixtureMode("시간초과"), { ok: false, reason: "시간 초과" });
});

test("시험 모드 검색어별 응답: 중복은 두 줄 그대로(Q85), 칸 빠짐은 빈칸 (FR-002)", async () => {
  const duplicate = await permitInFixtureMode("중복");
  assert.equal(duplicate.items.length, 2);
  assert.equal(duplicate.items[0].ITEM_SEQ, duplicate.items[1].ITEM_SEQ);
  const missing = await permitInFixtureMode("빈칸");
  const rows = missing.items.map(permitRow);
  assert.deepEqual([rows[0].company, rows[0].permitDate, rows[1].company, rows[1].permitDate], ["", "", "", ""]);
});

test("시험 모드가 아니면 넣은 fetch를 그대로 쓰고 시험 자료를 읽지 않는다 (FR-006)", async () => {
  delete process.env.PUBLIC_DATA_MODE;
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ header: { resultCode: "00" }, body: { totalCount: 0, items: "" } }) };
  };
  const result = await loadPermit(new URLSearchParams({ name: "인플루엔자" }), { fetchImpl, rawKey: "KEY" });
  assert.equal(called, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(await loadPermit(new URLSearchParams({ name: "인플루엔자" }), { fetchImpl, rawKey: undefined }), { ok: false, reason: "인증키 없음" });
});

test("가짜 호출: 회수 주소는 회수 자료, 최근 공지(검색어 없음)는 정상 자료 (FR-002)", async () => {
  const recall = await fixtureFetch(new URL("https://apis.data.go.kr/1471000/MdcinRtrvlSleStpgeInfoService05/getMdcinRtrvlSleStpgeItem05?numOfRows=5"));
  const body = JSON.parse(await recall.text());
  assert.equal(body.body.items.length, 3);
  const none = await fixtureFetch(new URL("https://apis.data.go.kr/1471000/MdcinRtrvlSleStpgeInfoService05/x?Prduct=없음"));
  assert.equal(JSON.parse(await none.text()).body.items, "");
});

test("응답에 시험 자료 표시: 시험 모드면 fixture true, 아니면 없음 (FR-003)", async () => {
  const run = async () => {
    const res = { statusCode: 0, body: "", setHeader() {}, end(text) { this.body = text; } };
    const handler = createPublicHandler({ verify: async () => "user", load: async () => ({ ok: true, items: [], totalCount: 0 }) });
    await handler({ url: "/api/permit?name=a", headers: {} }, res);
    return JSON.parse(res.body);
  };
  process.env.PUBLIC_DATA_MODE = "fixtures";
  assert.equal((await run()).fixture, true);
  delete process.env.PUBLIC_DATA_MODE;
  assert.equal((await run()).fixture, undefined);
});

test("출처 글자: 시험 자료면 '출처: 시험 자료(fixtures)' (FR-003)", () => {
  const at = new Date(2026, 9, 28, 9, 5);
  assert.equal(sourceText(at), "출처: 식약처 공공데이터 · 조회 10/28 09:05");
  assert.equal(sourceText(at, { fixture: true }), "출처: 시험 자료(fixtures) · 조회 10/28 09:05");
});
