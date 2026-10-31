// spec 025 FR-003~007: api/chat.js AI 도우미 서버 함수 (로그인·역할·질문 검사·키·동시 호출·하루 한도·Claude 요청 모양·답 검증·시험 모드)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatHandler } from "../api/chat.js";
import { makeScreenReader, readHomeItems, readLotBundle } from "../api/_chat-screen.js";

const LOT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const FACTS = {
  asOf: "2026-10-29T01:00:00.000Z", limits: ["원인은 알 수 없습니다."],
  rows: [
    { id: "held", label: "보류 로트", value: "3개", state: "ok" },
    { id: "equipment", label: "설비 이상 기록(최근 30일)", value: "못 읽었습니다", state: "failed" },
  ],
};
const GOOD = JSON.stringify({ parts: [{ text: "보류 로트 3개를 먼저 보세요.", refs: ["held"], guide: ["menu_batches"] }], outOfScope: false });

const fakeRes = () => ({ statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = text; } });
const ask = (extra = {}, method = "POST") => ({ method, url: "/api/chat", headers: { authorization: "Bearer t" }, body: { question: "오늘 뭐부터 봐야 해?", history: [], screen: { kind: "lot", batchId: LOT_ID }, ...extra } });
const message = (text, { status = 200, stop = "end_turn" } = {}) => async () => ({
  ok: status === 200, status, text: async () => JSON.stringify({ stop_reason: stop, usage: { input_tokens: 900, output_tokens: 120 }, content: [{ type: "thinking", thinking: "" }, { type: "text", text }] }),
});
const newState = () => ({ day: "", perUser: new Map(), total: 0, inflight: new Set() });

async function run(options, req) {
  const res = fakeRes();
  await createChatHandler({ verify: async () => "u1", role: async () => "qa_manager", env: { ANTHROPIC_API_KEY: "sk-test-key" }, state: newState(), shared: newState(), fetchImpl: message(GOOD), readScreen: async (r, screen) => (screen ? FACTS : null), ...options })(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body), raw: res.body };
}

test("로그인 없음 401, POST가 아니면 405이고 Claude를 부르지 않는다 (FR-001)", async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; };
  assert.equal((await run({ verify: async () => null, fetchImpl }, ask())).status, 401);
  assert.equal((await run({ fetchImpl }, ask({}, "GET"))).status, 405);
  assert.equal(called, 0);
});

test("열람자·역할 못 읽음은 403 (FR-001 수용 기준 2)", async () => {
  for (const role of [async () => "viewer", async () => null]) {
    const { status, json } = await run({ role }, ask());
    assert.equal(status, 403);
    assert.equal(json.reason, "AI 도우미는 QA 관리자·QC 시험 담당자·생산 담당자만 쓸 수 있습니다.");
  }
});

test("질문 검사: 빈 질문·301자·앞 대화 6개·근거 표 모양 틀림은 400, Claude를 부르지 않는다 (경계)", async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; };
  for (const [extra, reason] of [
    [{ question: "  " }, "질문을 적어 주세요."], [{ question: "가".repeat(301) }, "질문은 300자까지 쓸 수 있습니다."],
    [{ history: Array(6).fill({ q: "q", a: "a" }) }, "새 대화를 시작해 주세요."], [{ screen: { kind: "samples", facts: FACTS } }, "화면 근거 표의 모양이 맞지 않습니다."],
  ]) {
    const { status, json } = await run({ fetchImpl }, ask(extra));
    assert.deepEqual([status, json.reason], [400, reason]);
  }
  assert.equal(called, 0);
});

test("키가 없으면 503, 같은 사람이 답을 기다리는 중이면 409 (FR-007 수용 기준 3)", async () => {
  assert.equal((await run({ env: {} }, ask())).status, 503);
  const state = newState();
  state.inflight.add("u1");
  const { status, json } = await run({ state }, ask());
  assert.deepEqual([status, json.reason], [409, "이미 답을 만드는 중입니다."]);
});

test("하루 한도: 사람별 30번은 도우미만 세고, 서버 전체는 브리핑과 같은 수를 쓴다 (FR-007 수용 기준 1, Q91)", async () => {
  const state = newState();
  state.day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  state.perUser.set("u1", 30);
  assert.deepEqual([(await run({ state }, ask())).json.reason], ["오늘 AI 도우미 사용 한도에 도달했습니다."]);
  const shared = newState();
  shared.day = state.day;
  shared.total = 100;
  const full = await run({ shared }, ask());
  assert.deepEqual([full.status, full.json.reason], [429, "이 서버의 오늘 AI 호출 한도에 도달했습니다."]);
});

test("정상: Haiku 5.5에 시스템(안내서·근거 표)과 앞 대화를 보내고, 검증한 답을 돌려준다. 키·응답 원문은 나가지 않는다 (FR-003·004·005)", async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url: String(url), init }; return message(GOOD)(); };
  const shared = newState();
  const { status, json, raw } = await run({ fetchImpl, shared }, ask({ history: [{ q: "첫 질문", a: "첫 답" }] }));
  assert.equal(status, 200);
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  const body = JSON.parse(sent.init.body);
  assert.equal(body.model, "claude-haiku-5-5");
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.match(body.system, /\[menu_batches\]/);
  assert.match(body.system, /\[held\] 보류 로트: 3개/);
  assert.deepEqual(body.messages.map((item) => item.role), ["user", "assistant", "user"]);
  assert.equal(json.ok, true);
  assert.equal(json.verified, true);
  assert.deepEqual(json.parts[0].links.map((link) => link.href), ["#/batches"]); // 근거 표 줄은 서버에 주소가 없어 화면이 붙인다
  assert.equal(json.screen, "lot");
  assert.deepEqual(json.usage, { input: 900, output: 120 });
  assert.equal(shared.total, 1); // 서버 전체 한도를 브리핑과 함께 센다
  assert.ok(!raw.includes("sk-test-key"));
});

test("근거 표 없이 물으면 프롬프트에 근거 표가 없다고 쓰고 screen은 null (FR-004 수용 기준 4)", async () => {
  let system;
  const fetchImpl = async (url, init) => { system = JSON.parse(init.body).system; return message(GOOD)(); };
  const { json } = await run({ fetchImpl }, ask({ screen: null }));
  assert.match(system, /근거 표 없음/);
  assert.equal(json.screen, null);
  assert.equal(json.parts[0].refs.length, 0); // 근거 표 id는 버리고 bad_ref로 경고
  assert.ok(json.parts[0].flags.some((flag) => flag.code === "bad_ref"));
});

test("Claude 실패: 연결 실패·HTTP 오류는 502이고 한도를 돌려준다, 읽지 못한 답·거절·잘림은 502이고 돌려주지 않는다 (FR-007 수용 기준 2)", async () => {
  const cases = [
    [async () => { throw new Error("down"); }, "AI에 연결하지 못했습니다.", 0],
    [message("", { status: 500 }), "AI에 연결하지 못했습니다.", 0],
    [message("JSON 아님"), "답을 읽지 못했습니다.", 1],
    [message("", { stop: "max_tokens" }), "AI 응답이 길어 중간에 끊겼습니다.", 1],
  ];
  for (const [fetchImpl, reason, used] of cases) {
    const state = newState();
    const { status, json } = await run({ fetchImpl, state }, ask());
    assert.deepEqual([status, json.reason, state.perUser.get("u1") ?? 0], [502, reason, used], reason);
    assert.equal(state.inflight.size, 0);
  }
});

test("못된 답(승인·밖 주소)은 경고로 돌아오고 링크가 없다 (FR-006)", async () => {
  const bad = JSON.stringify({ parts: [{ text: "출하해도 안전합니다. https://evil.example 참고", refs: ["held"], guide: [] }], outOfScope: false });
  const { json } = await run({ fetchImpl: message(bad) }, ask());
  assert.equal(json.verified, false);
  assert.deepEqual(json.parts[0].flags.map((flag) => flag.code).sort(), ["forbidden", "outside_link"]);
  assert.deepEqual(json.parts[0].links, []);
  assert.doesNotMatch(json.parts[0].text, /https?:/);
});

test("시험 모드(로컬만): 키 없이 정해진 응답, 범위 밖·승인·주입·실패를 흉내 낸다. Vercel에서는 꺼진다 (FR-007, spec 022 FR-006)", async () => {
  const env = { AI_MODE: "fixtures" };
  const fetchImpl = async () => { throw new Error("Claude를 부르면 안 됨"); };
  const normal = await run({ env, fetchImpl }, ask());
  assert.equal(normal.status, 200);
  assert.equal(normal.json.model, "시험 응답");
  assert.equal(normal.json.verified, true);
  assert.ok(normal.json.parts.every((part) => part.text.startsWith("(시험 응답)")));
  assert.equal((await run({ env, fetchImpl }, ask({ fixtureCase: "outofscope" }))).json.outOfScope, true);
  assert.equal((await run({ env, fetchImpl }, ask({ fixtureCase: "approve" }))).json.verified, false);
  assert.equal((await run({ env, fetchImpl }, ask({ fixtureCase: "inject" }))).json.verified, false);
  assert.equal((await run({ env, fetchImpl }, ask({ fixtureCase: "fail" }))).status, 502);
  assert.equal((await run({ env, fetchImpl }, ask({ fixtureCase: "nokey" }))).status, 503);
  assert.equal((await run({ env: { AI_MODE: "fixtures", VERCEL: "1", ANTHROPIC_API_KEY: "sk-test-key" }, fetchImpl: message(GOOD) }, ask())).json.model, "claude-haiku-5-5");
});

const ITEMS = { role: "production_operator", sections: [
  { key: "process_issues", state: "ok", count: 1, top: [{ text: "TDP-2610-001 · 4일째", path: "#/issues/i1" }] },
  { key: "counts", state: "ok", count: 0, top: [], parts: [{ key: "held_lots", count: 2 }] },
] };
const HOME_ANSWER = JSON.stringify({ parts: [{ text: "처리 중인 공정 이슈 1건을 먼저 보세요.", refs: ["process_issues", "process_issues_1"], guide: [] }], outOfScope: false });

test("홈은 서버가 그 사람의 \"오늘 내 일\"을 읽어 근거 표로 쓰고, 화면이 보낸 표는 버린다 (FR-004 수용 기준 6, v0.5 8단계)", async () => {
  let system;
  let askedWith;
  const fetchImpl = async (url, init) => { system = JSON.parse(init.body).system; return message(HOME_ANSWER)(); };
  const homeItems = async (req) => { askedWith = req.headers.authorization; return ITEMS; };
  const { status, json } = await run({ fetchImpl, readScreen: makeScreenReader({ homeItems }), role: async () => "production_operator" }, ask({ screen: { kind: "home", facts: FACTS } }));
  assert.equal(status, 200);
  assert.equal(askedWith, "Bearer t"); // 로그인한 사람의 토큰으로 자기 것만 읽는다
  assert.match(system, /제조공정 홈 화면이 코드로 센 값/);
  assert.match(system, /\[process_issues_1\] 처리 중인 공정 이슈 1: TDP-2610-001 · 4일째/);
  assert.match(system, /\[held_lots\] 보류 로트: 2건/);
  assert.ok(!system.includes("[held] 보류 로트: 3개")); // 화면이 보낸 표는 쓰지 않는다
  assert.equal(json.verified, true);
  assert.deepEqual(json.parts[0].links.map((link) => link.href), ["#/issues/i1"]);
  assert.equal(json.screen, "home");
});

test("홈 근거 표를 못 읽으면 근거 표 없이 답하고, 화면 이름은 역할마다 다르다 (FR-004 수용 기준 6)", async () => {
  const titles = [];
  for (const [role, title] of [["qa_manager", "관리자 대시보드"], ["qc_analyst", "품질시험 홈"]]) {
    let system;
    const fetchImpl = async (url, init) => { system = JSON.parse(init.body).system; return message(GOOD)(); };
    await run({ fetchImpl, role: async () => role, readScreen: makeScreenReader({ homeItems: async () => ({ role, sections: [{ key: "counts", state: "ok", count: 0, top: [], parts: [{ key: "held_lots", count: 1 }] }] }) }) }, ask({ screen: { kind: "home" } }));
    titles.push(system.includes(`${title} 화면이 코드로 센 값`));
  }
  assert.deepEqual(titles, [true, true]);
  let system;
  const fetchImpl = async (url, init) => { system = JSON.parse(init.body).system; return message(GOOD)(); };
  const { status } = await run({ fetchImpl, readScreen: makeScreenReader({ homeItems: async () => null }) }, ask({ screen: { kind: "home" } }));
  assert.equal(status, 200);
  assert.match(system, /근거 표 없음/);
});

test("readHomeItems: 로그인 토큰으로 my_briefing_items를 부르고, 실패·모양 틀림은 null (FR-004 수용 기준 6)", async () => {
  let sent;
  const ok = async (url, init) => { sent = { url: String(url), init }; return { ok: true, text: async () => JSON.stringify(ITEMS) }; };
  const req = { headers: { authorization: "Bearer user-token" } };
  assert.deepEqual(await readHomeItems(req, { supabaseUrl: "https://db.example", anonKey: "anon", fetchImpl: ok }), ITEMS);
  assert.equal(sent.url, "https://db.example/rest/v1/rpc/my_briefing_items");
  assert.equal(sent.init.method, "POST");
  assert.equal(sent.init.headers.Authorization, "Bearer user-token");
  for (const fetchImpl of [async () => ({ ok: false, text: async () => "" }), async () => { throw new Error("down"); }, async () => ({ ok: true, text: async () => "null" })]) {
    assert.equal(await readHomeItems(req, { supabaseUrl: "https://db.example", anonKey: "anon", fetchImpl }), null);
  }
});

const BUNDLE = {
  batch: { id: LOT_ID, batch_number: "HBV-2610-001", status: "on_hold", product_id: "p1" },
  testSpecs: [{ id: "s1", item_name: "역가", version: 1 }], measurements: [], issues: [], requests: [], reviews: [],
  workOrder: null, steps: [], runs: [], processRecords: [], transfers: [],
};

test("로트 상세는 서버가 로트 id로 그 사람에게 보이는 자료를 읽어 근거 표를 만들고, 화면이 보낸 표는 버린다 (FR-004 수용 기준 5, 9단계)", async () => {
  let system;
  let asked;
  const fetchImpl = async (url, init) => { system = JSON.parse(init.body).system; return message(GOOD)(); };
  const lotBundle = async (req, batchId) => { asked = [req.headers.authorization, batchId]; return BUNDLE; };
  const { status, json } = await run({ fetchImpl, readScreen: makeScreenReader({ lotBundle }) }, ask({ screen: { kind: "lot", batchId: LOT_ID, facts: FACTS } }));
  assert.equal(status, 200);
  assert.deepEqual(asked, ["Bearer t", LOT_ID]);
  assert.match(system, /로트 상세 화면이 코드로 센 값/);
  assert.match(system, /\[lot_no\] 로트: HBV-2610-001/);
  assert.ok(!system.includes("[held] 보류 로트: 3개"));
  assert.equal(json.screen, "lot");
  let none;
  await run({ fetchImpl: async (url, init) => { none = JSON.parse(init.body).system; return message(GOOD)(); }, readScreen: makeScreenReader({ lotBundle: async () => null }) }, ask());
  assert.match(none, /\[lot_no\] 로트: 이 로트를 확인하지 못했습니다/); // 안 보이는 로트·못 읽음 → 못 읽음 줄 하나
});

test("readLotBundle: 로그인 토큰으로 로트·측정값·기준·이슈·조치·평가·작업지시·단계·공정 기록·검체를 읽고, 없거나 못 읽으면 null, 보조 자료만 실패하면 그 칸만 null (9단계)", async () => {
  const tables = {
    batch: [BUNDLE.batch], measurement: [], specification: BUNDLE.testSpecs, quality_issue: [{ id: "i1", status: "open" }], work_order: [],
    process_step: [], step_run: [], process_record: "fail", sample_transfer: [], action_request: [{ id: "a1", quality_issue_id: "i1", status: "approved" }], deviation_review: [],
  };
  const seen = [];
  const fake = (rows) => async (url, init) => {
    const table = new URL(url).pathname.split("/").pop();
    seen.push([table, init.headers.Authorization]);
    const data = rows[table];
    return data === "fail" ? { ok: false, text: async () => "" } : { ok: true, text: async () => JSON.stringify(data) };
  };
  const req = { headers: { authorization: "Bearer user-token" } };
  const bundle = await readLotBundle(req, LOT_ID, { supabaseUrl: "https://db.example", anonKey: "anon", fetchImpl: fake(tables) });
  assert.equal(bundle.batch.batch_number, "HBV-2610-001");
  assert.equal(bundle.processRecords, null); // 보조 자료 실패는 "못 읽음"으로
  assert.deepEqual(bundle.requests.map((row) => row.id), ["a1"]);
  assert.ok(seen.every(([, token]) => token === "Bearer user-token"));
  assert.equal(await readLotBundle(req, LOT_ID, { supabaseUrl: "https://db.example", anonKey: "anon", fetchImpl: fake({ ...tables, batch: [] }) }), null);
  assert.equal(await readLotBundle(req, LOT_ID, { supabaseUrl: "https://db.example", anonKey: "anon", fetchImpl: fake({ ...tables, measurement: "fail" }) }), null);
});
