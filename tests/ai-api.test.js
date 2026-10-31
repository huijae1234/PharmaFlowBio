// spec 022 FR-001·002·006: api/ai.js 서버 함수 (로그인·역할·한도·동시 호출·키·Haiku 5.5 요청·응답 읽기·문장 검증·시험 모드)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createAiHandler, lookupRole } from "../api/ai.js";

const FACTS = {
  asOf: "2026-10-28T00:00:00.000Z",
  limits: ["원인은 알 수 없습니다."],
  rows: [
    { id: "open_issues", label: "처리 중 품질 이슈", value: "2건", state: "ok" },
    { id: "held_lots", label: "보류 로트", value: "1개", state: "ok" },
    { id: "equipment", label: "설비 이상 기록(최근 30일)", value: "못 읽었습니다", state: "failed" },
  ],
};
const GOOD = JSON.stringify({ claims: [{ text: "처리 중 이슈 2건을 먼저 보세요.", refs: ["open_issues"] }], unknowns: ["원인"] });

function fakeRes() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = text; } };
}
const fakeReq = (body, { method = "POST", url = "/api/ai" } = {}) => ({ method, url, headers: { authorization: "Bearer t" }, body });
const call = (kind = "home", extra = {}) => fakeReq({ kind, facts: FACTS, ...extra });
const message = (text, { status = 200, stop = "end_turn", content } = {}) => async () => ({
  ok: status === 200, status,
  text: async () => JSON.stringify({ stop_reason: stop, usage: { input_tokens: 321, output_tokens: 87 }, content: content ?? [{ type: "text", text }] }),
});

const newState = () => ({ day: "", perUser: new Map(), total: 0, inflight: new Set() });
async function run(handlerOptions, req) {
  const res = fakeRes();
  await createAiHandler({ verify: async () => "u1", role: async () => "qa_manager", env: { ANTHROPIC_API_KEY: "sk-test-key" }, state: newState(), ...handlerOptions })(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body), raw: res.body };
}

test("로그인하지 않으면 401이고 역할도 Claude도 부르지 않는다 (FR-001 수용 기준 1)", async () => {
  let called = 0;
  const { status } = await run({ verify: async () => null, role: async () => { called += 1; return "qa_manager"; }, fetchImpl: async () => { called += 1; } }, call());
  assert.equal(status, 401);
  assert.equal(called, 0);
});

test("POST만 받는다", async () => {
  assert.equal((await run({}, fakeReq({}, { method: "GET" }))).status, 405);
});

test("종류가 없거나 근거 표 모양이 틀리면 400, 크기가 한도를 넘으면 413 (입력 형식·크기)", async () => {
  assert.equal((await run({}, fakeReq({ kind: "other", facts: FACTS }))).status, 400);
  assert.equal((await run({}, fakeReq({ kind: "home", facts: { ...FACTS, rows: "x" } }))).status, 400);
  assert.equal((await run({}, fakeReq({ kind: "home", facts: { ...FACTS, rows: [{ id: "BAD ID", label: "가", value: "나", state: "ok" }] } }))).status, 400);
  assert.equal((await run({}, fakeReq({ kind: "home", facts: { ...FACTS, rows: [{ id: "a", label: "가", value: "x", state: "weird" }] } }))).status, 400);
  const huge = { ...FACTS, rows: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, label: "가".repeat(100), value: "나".repeat(300), state: "ok" })) };
  assert.equal((await run({}, fakeReq({ kind: "home", facts: huge }))).status, 413);
});

test("권한 없음: 열람자·역할을 못 읽은 사용자·홈 브리핑을 QC가 부르면 403이고 Claude를 부르지 않는다 (접근 권한)", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return message(GOOD)(); };
  assert.equal((await run({ role: async () => "viewer", fetchImpl }, call())).status, 403);
  assert.equal((await run({ role: async () => null, fetchImpl }, call())).status, 403); // 못 읽으면 닫힌 쪽으로
  assert.equal((await run({ role: async () => "qc_analyst", fetchImpl }, call("home"))).status, 403);
  assert.equal(called, false);
  assert.equal((await run({ role: async () => "qc_analyst", fetchImpl: message(GOOD) }, call("lot"))).status, 200);
});

test("키가 없으면 503, 키 값은 어디에도 나오지 않는다 (FR-001 수용 기준 2)", async () => {
  const none = await run({ env: {} }, call());
  assert.equal(none.status, 503);
  assert.match(none.json.reason, /키 없음/);
  const ok = await run({ fetchImpl: message(GOOD) }, call());
  assert.equal(ok.raw.includes("sk-test-key"), false);
});

test("정상: Haiku 5.5 요청(생각 몫을 넉넉히 + effort low, 샘플링 값 없음)을 보내고 문장·근거·검증 결과·사용량을 돌려준다 (FR-001·002)", async () => {
  let sent;
  const { status, json } = await run({ fetchImpl: async (url, init) => { sent = { url: String(url), init }; return message(GOOD)(); } }, call());
  assert.equal(status, 200);
  assert.deepEqual(json.claims, [{ text: "처리 중 이슈 2건을 먼저 보세요.", refs: ["open_issues"], flags: [] }]);
  assert.deepEqual([json.ok, json.verified, json.flagged, json.unknowns, json.asOf, json.usage], [true, true, 0, ["원인"], FACTS.asOf, { input: 321, output: 87 }]);
  const payload = JSON.parse(sent.init.body);
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent.init.headers["x-api-key"], "sk-test-key");
  assert.equal(sent.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(payload.model, "claude-haiku-5-5");
  assert.equal(payload.max_tokens, 2000); // 생각이 max_tokens를 먼저 쓰므로 답만의 길이가 아니다
  assert.deepEqual(payload.output_config, { effort: "low" });
  for (const field of ["temperature", "top_p", "top_k", "thinking", "tools", "tool_choice"]) assert.equal(field in payload, false, field);
  assert.match(payload.system, /refs에 넣으세요/);
  assert.match(payload.messages[0].content, /\[open_issues\] 처리 중 품질 이슈: 2건/);
  assert.equal(payload.messages.at(-1).role, "user"); // 마지막이 사용자 글 (prefill 없음)
});

test("모델은 환경변수로 바꿀 수 있다 (spec Q1)", async () => {
  let model;
  await run({ env: { ANTHROPIC_API_KEY: "k", AI_MODEL: "claude-sonnet-5-5" }, fetchImpl: async (url, init) => { model = JSON.parse(init.body).model; return message(GOOD)(); } }, call());
  assert.equal(model, "claude-sonnet-5-5");
});

test("생각 블록이 앞에 와도 text 블록을 type으로 읽는다 (Haiku 5.5는 기본으로 생각한다)", async () => {
  const content = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: GOOD }];
  assert.equal((await run({ fetchImpl: message(null, { content }) }, call())).status, 200);
});

test("문장 검증이 서버까지 이어진다: 인용하지 않은 줄의 숫자·근거 없는 문장·승인 문장은 flags로 돌아온다 (숫자 불일치·근거 없는 승인 문장)", async () => {
  const bad = JSON.stringify({ claims: [
    { text: "처리 중 이슈가 1건입니다.", refs: ["open_issues"] }, // 1은 held_lots의 숫자
    { text: "이 로트는 출하해도 안전합니다.", refs: ["held_lots"] },
    { text: "근거 없는 문장입니다.", refs: [] },
    { text: "설비는 문제가 없습니다.", refs: ["equipment"] },
  ], unknowns: [] });
  const { status, json } = await run({ fetchImpl: message(bad) }, call());
  assert.equal(status, 200);
  assert.equal(json.verified, false);
  assert.equal(json.flagged, 4);
  assert.deepEqual(json.claims.map((claim) => claim.flags.map((flag) => flag.code)), [["number_mismatch"], ["forbidden"], ["no_evidence"], ["masks_gap", "forbidden"]]);
});

test("stop_reason이 max_tokens나 refusal이면 502, 응답을 받았으므로 호출 횟수는 돌려주지 않는다 (잘림·거절, 토큰이 청구됐을 수 있음)", async () => {
  const state = newState();
  const cut = await run({ state, fetchImpl: message('{"claims":[{"text":"중간에', { stop: "max_tokens" }) }, call());
  assert.equal(cut.status, 502);
  assert.match(cut.json.reason, /끊겼습니다/);
  const refused = await run({ state, fetchImpl: message(null, { stop: "refusal", content: [] }) }, call());
  assert.equal(refused.status, 502);
  assert.match(refused.json.reason, /처리하지 않았습니다/);
  assert.equal(state.total, 2);
});

test("Claude 오류·바쁨·시간 초과·연결 실패는 502와 안전한 문구만 낸다, 본문과 키는 나오지 않는다 (외부 조회 실패·시간 초과)", async () => {
  assert.match((await run({ fetchImpl: message("x", { status: 500 }) }, call())).json.reason, /연결하지 못했습니다/);
  assert.match((await run({ fetchImpl: message("x", { status: 429 }) }, call())).json.reason, /바쁩니다/);
  assert.match((await run({ fetchImpl: message("x", { status: 529 }) }, call())).json.reason, /바쁩니다/);
  const timeout = await run({ fetchImpl: async () => { throw Object.assign(new Error("secret detail"), { name: "TimeoutError" }); } }, call());
  assert.equal(timeout.status, 502);
  assert.match(timeout.json.reason, /시간 초과/);
  assert.equal(timeout.raw.includes("secret detail"), false);
  const down = await run({ fetchImpl: async () => { throw new Error("ECONNRESET sk-test-key"); } }, call());
  assert.equal(down.status, 502);
  assert.equal(down.raw.includes("sk-test-key"), false);
});

test("응답이 정해진 모양이 아니면 502이고 호출 횟수는 돌려주지 않는다 (잘못된 응답 형식)", async () => {
  const state = newState();
  const { status, json } = await run({ state, fetchImpl: message("그냥 글입니다") }, call());
  assert.equal(status, 502);
  assert.match(json.reason, /읽지 못/);
  assert.equal(state.total, 1);
  assert.equal((await run({ state, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ stop_reason: "end_turn", content: [] }) }) }, call())).json.reason, "AI 응답을 받지 못했습니다.");
  assert.equal(state.total, 2);
});

test("Claude에 닿지 못한 호출(HTTP 오류·시간 초과·연결 실패)만 호출 횟수를 돌려준다 (비용 방어: 청구됐을 수 있는 호출은 센다)", async () => {
  const state = newState();
  await run({ state, fetchImpl: message("x", { status: 500 }) }, call());
  await run({ state, fetchImpl: async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); } }, call());
  await run({ state, fetchImpl: async () => { throw new Error("down"); } }, call());
  assert.equal(state.total, 0);
  assert.equal(state.perUser.get("u1"), 0);
});

test("호출 한도: 사용자당 한도를 넘으면 429, 성공한 호출만 한도를 쓴다 (호출 한도)", async () => {
  const state = newState();
  const limits = { perUserPerDay: 1, totalPerDay: 5, maxFactsBytes: 12288, maxRows: 40, maxTokens: 2000, timeoutMs: 20000 };
  const options = { state, limits, fetchImpl: message(GOOD) };
  assert.equal((await run(options, call())).status, 200);
  const second = await run(options, call());
  assert.equal(second.status, 429);
  assert.match(second.json.reason, /한도/);
  assert.equal((await run({ ...options, verify: async () => "u2" }, call())).status, 200); // 다른 사람은 따로 센다
  assert.equal((await run({ ...options, verify: async () => "u3", limits: { ...limits, totalPerDay: 2 } }, call())).json.reason, "이 서버의 오늘 AI 호출 한도에 도달했습니다.");
});

test("동시 호출: 같은 사용자의 두 번째 호출은 409이고 다른 사용자는 막지 않는다, 끝나면 풀린다 (중복 클릭·재시도)", async () => {
  const state = newState();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = async () => { await gate; return message(GOOD)(); };
  const first = run({ state, fetchImpl: slow }, call());
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(state.inflight.has("u1"), true);
  const second = await run({ state, fetchImpl: message(GOOD) }, call());
  assert.equal(second.status, 409);
  assert.match(second.json.reason, /만드는 중/);
  assert.equal((await run({ state, verify: async () => "u2", fetchImpl: message(GOOD) }, call())).status, 200);
  release();
  assert.equal((await first).status, 200);
  assert.equal(state.inflight.size, 0);
  assert.equal((await run({ state, fetchImpl: message(GOOD) }, call())).status, 200);
});

test("동시 호출 표시는 실패해도 풀린다", async () => {
  const state = newState();
  await run({ state, fetchImpl: async () => { throw new Error("boom"); } }, call());
  assert.equal(state.inflight.size, 0);
});

test("본문이 JSON이 아니면 400, 스트림으로 온 본문도 읽는다 (로컬 서버)", async () => {
  assert.equal((await run({}, fakeReq("{깨짐"))).status, 400);
  const streamReq = { method: "POST", url: "/api/ai", headers: { authorization: "Bearer t" }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ kind: "home", facts: FACTS })); } };
  assert.equal((await run({ fetchImpl: message(GOOD) }, streamReq)).status, 200);
  const tooBig = { method: "POST", url: "/api/ai", headers: { authorization: "Bearer t" }, async *[Symbol.asyncIterator]() { yield Buffer.alloc(60000, 65); } };
  assert.equal((await run({}, tooBig)).status, 413);
});

test("시험 모드: 가짜 응답으로 키·한도 없이 시험하고 응답에 시험 표시가 붙는다, 못된 모델 흉내도 검증에 걸린다 (FR-006)", async () => {
  const env = { AI_MODE: "fixtures" };
  const fixture = (fixtureCase) => run({ env, fetchImpl: async () => { throw new Error("실제 호출 금지"); } }, call("home", { fixtureCase }));
  const normal = await fixture("normal");
  assert.deepEqual([normal.status, normal.json.fixture, normal.json.verified, normal.json.model], [200, true, true, "시험 응답"]);
  assert.match(normal.json.claims[0].text, /^\(시험 응답\)/);
  assert.equal(normal.json.claims.every((claim) => claim.refs.length === 1 && claim.flags.length === 0), true);
  assert.deepEqual((await fixture("mismatch")).json.claims[0].flags.map((flag) => flag.code), ["number_mismatch"]);
  assert.deepEqual((await fixture("approve")).json.claims[0].flags.map((flag) => flag.code), ["forbidden"]);
  assert.deepEqual((await fixture("noref")).json.claims[0].flags.map((flag) => flag.code), ["no_evidence"]);
  assert.deepEqual((await fixture("badref")).json.claims[0].flags.map((flag) => flag.code), ["bad_ref"]);
  assert.deepEqual((await fixture("masks")).json.claims[0].flags.map((flag) => flag.code), ["masks_gap", "forbidden"]);
  assert.equal((await fixture("badformat")).status, 502);
  assert.equal((await fixture("refusal")).status, 502);
  assert.equal((await fixture("truncated")).status, 502);
  assert.equal((await fixture("nokey")).status, 503);
});

test("시험 모드는 Vercel에서는 꺼진다 (FR-006 수용 기준 2)", async () => {
  const { status } = await run({ env: { AI_MODE: "fixtures", VERCEL: "1" } }, call("home", { fixtureCase: "normal" }));
  assert.equal(status, 503); // 키가 없으니 실제 경로로 간다
});

test("역할 읽기: 그 사람의 토큰으로 본인 profile 줄만 읽고, 못 읽으면 null이다 (접근 권한)", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url: String(url), headers: init.headers }; return { ok: true, text: async () => JSON.stringify([{ role: "qa_manager" }]) }; };
  const req = { headers: { authorization: "Bearer tok" } };
  assert.equal(await lookupRole(req, "u-1", { supabaseUrl: "https://x.supabase.co", anonKey: "anon", fetchImpl }), "qa_manager");
  assert.match(seen.url, /^https:\/\/x\.supabase\.co\/rest\/v1\/profile\?id=eq\.u-1&select=role$/);
  assert.deepEqual(seen.headers, { apikey: "anon", Authorization: "Bearer tok" });
  assert.equal(await lookupRole(req, "u-1", { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await lookupRole(req, "u-1", { fetchImpl: async () => ({ ok: true, text: async () => "[]" }) }), null);
  assert.equal(await lookupRole(req, "u-1", { fetchImpl: async () => ({ ok: true, text: async () => "깨짐" }) }), null);
  assert.equal(await lookupRole(req, "u-1", { fetchImpl: async () => { throw new Error("down"); } }), null);
});

test("AI는 상태·승인·알림을 바꾸지 않는다: AI 파일(이름이 ai·claude·chat·assistant·app-guide·app-query로 시작하는 서버·화면·규칙 파일)에는 쓰기 호출이 없고, 저장소 가져오기는 정해진 한 곳뿐이다 (읽기 전용)", () => {
  const files = ["api", "src/infrastructure", "src/ui", "src/domain"] // spec 025: 공통 호출(_claude.js)과 AI 도우미 파일도 같은 검사에 넣는다
    .flatMap((dir) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((name) => /^_?(ai|claude|chat|assistant|app-guide|app-query)[-.]/.test(name)).map((name) => `${dir}/${name}`)); // 새 AI 파일도 자동으로 검사에 든다
  assert.ok(files.length >= 6, files.join(", "));
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const source = files.map(read).join("\n");
  for (const pattern of [/\.rpc\(/, /\/rest\/v1\/rpc\/(?!my_briefing_items")/, /client\.from\(/, /\.insert\(/, /\.update\(/, /\.upsert\(/, /(?<!inflight)\.delete\(/, /claim_my_notifications/, /SLACK/, /chat\.postMessage/, /decide_release/, /review_deviation_review/, /decideRelease\(/, /approve\w*\(/, /sendSample\(/]) {
    assert.equal(pattern.test(source), false, String(pattern));
  }
  // DB 함수는 읽기만 하는 my_briefing_items(stable, 자기 것만 — supabase/tests/025_rules.sql) 하나만 부른다 (spec 025 v0.5 8단계)
  assert.deepEqual(source.match(/\/rest\/v1\/[a-z_/]+/g), ["/rest/v1/rpc/my_briefing_items", "/rest/v1/profile"]);
  // 저장소 모듈 가져오기: AI 호출 기록(logUsage)을 남기는 src/infrastructure/ai.js 한 곳만 쓴다 (승인·조치·검체 저장소는 AI 파일이 가져오지 않는다)
  const stores = Object.fromEntries(files.map((file) => [file, [...read(file).matchAll(/from\s+["']([^"']*store[^"']*)["']/g)].map((found) => found[1])]).filter(([, list]) => list.length));
  assert.deepEqual(stores, { "src/infrastructure/ai.js": ["./store.js", "./store-products.js"] });
});

test("정상 경로에서 서버가 부르는 곳은 Anthropic 한 곳(POST)뿐이다 (읽기 전용을 실제 호출 기록으로 확인)", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([String(url), init?.method ?? "GET"]); return message(GOOD)(); };
  assert.equal((await run({ fetchImpl }, call())).status, 200);
  assert.deepEqual(calls, [["https://api.anthropic.com/v1/messages", "POST"]]);
});

const MUST_FACTS = { ...FACTS, rows: FACTS.rows.map((entry) => (entry.id === "held_lots" ? { ...entry, must: true } : entry)) };

test("누락 검사가 서버까지 이어진다: 모델이 꼭 인용할 줄을 빠뜨리면 uncovered로 돌아온다, 시험 모드 정상 응답은 모두 다룬다 (중요한 사실 누락)", async () => {
  const skip = await run({ fetchImpl: message(GOOD) }, fakeReq({ kind: "home", facts: MUST_FACTS }));
  assert.deepEqual(skip.json.uncovered, [{ id: "held_lots", label: "보류 로트" }]);
  assert.equal(skip.json.verified, true); // 문장 자체는 맞지만 항목이 빠졌다
  const covered = await run({ env: { AI_MODE: "fixtures" } }, fakeReq({ kind: "home", facts: MUST_FACTS, fixtureCase: "normal" }));
  assert.deepEqual(covered.json.uncovered, []);
  assert.ok(covered.json.claims.some((claim) => claim.refs.includes("held_lots")));
});
