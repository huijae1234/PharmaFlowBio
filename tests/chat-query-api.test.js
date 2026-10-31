// spec 025 v0.6 FR-010 11단계: AI 도우미가 앱 전체 조회를 골라 쓴다(도구 쓰기). 호출 2번 흐름·권한 재확인·한도·시험 모드
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatHandler } from "../api/chat.js";
import { CHAT_LIMITS, OUT_OF_SCOPE_TEXT, buildChatPrompt, queryLineText } from "../src/domain/chat-rules.js";

const NOW = new Date("2026-10-29T01:00:00.000Z");
const THINKING = { type: "thinking", thinking: "", signature: "sig-1" };
const ISSUES = { rows: [
  { id: "i1", kind: "spec", source: "test", status: "open", opened_at: "2026-10-20T00:00:00Z", batch: { id: "b1", batch_number: "HBV-2610-001", product: { item_name: "B형간염 백신 주" } } },
  { id: "i2", kind: "alert", source: "test", status: "open", opened_at: "2026-10-21T00:00:00Z", batch: { id: "b2", batch_number: "HBV-2610-002", product: { item_name: "B형간염 백신 주" } } },
  { id: "i3", kind: "spec", source: "process", status: "closed", opened_at: "2026-10-22T00:00:00Z", batch: { id: "b3", batch_number: "TDP-2610-001", product: { item_name: "Tdap 혼합 백신 주" } } },
], truncated: false };
const ANSWER = (text, refs) => JSON.stringify({ parts: [{ text, refs, guide: [] }], outOfScope: false });

const fakeRes = () => ({ statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = text; } });
const newState = () => ({ day: "", perUser: new Map(), total: 0, inflight: new Set() });
const ask = (question, extra = {}) => ({ method: "POST", url: "/api/chat", headers: { authorization: "Bearer t" }, body: { question, history: [], screen: { kind: "home" }, ...extra } });
const reply = (content, stop) => ({ ok: true, status: 200, text: async () => JSON.stringify({ stop_reason: stop, usage: { input_tokens: 800, output_tokens: 100 }, content }) });
const toolUse = (id, input) => ({ type: "tool_use", id, name: "app_query", input });

/** Claude 응답을 차례로 돌려주고 보낸 본문을 모은다 */
function claude(...responses) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return responses[sent.length - 1];
  };
  return { sent, fetchImpl };
}

async function run(options) {
  const res = fakeRes();
  const reads = [];
  const readQuery = options.readQuery ?? (async (req, kind, params) => { reads.push([kind, params]); return ISSUES; });
  const shared = options.shared ?? newState();
  await createChatHandler({
    verify: async () => "u1", env: options.env ?? { ANTHROPIC_API_KEY: "sk-test-key" },
    state: newState(), readScreen: async () => null, now: () => NOW, ...options, shared, readQuery, role: async () => options.role ?? "qa_manager",
  })(options.req ?? ask("최근 문제가 자주 발생한 제품 알려줘"), res);
  return { status: res.statusCode, json: JSON.parse(res.body), reads, shared };
}

test("도구를 부르지 않는 답은 지금처럼 1번 호출이고, 요청에 그 역할이 쓸 수 있는 조회만 담은 도구가 있다 (FR-010 수용 기준 8)", async () => {
  const { sent, fetchImpl } = claude(reply([THINKING, { type: "text", text: ANSWER("로트 메뉴에서 볼 수 있습니다.", []) }], "end_turn"));
  const { status, json, reads } = await run({ fetchImpl, role: "qc_analyst" });
  assert.equal(status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tools.length, 1);
  assert.equal(sent[0].tools[0].name, "app_query");
  assert.ok(!sent[0].tools[0].input_schema.properties.query.enum.includes("pending_reviews")); // QA 전용 조회는 QC 도구에 없다
  assert.deepEqual(sent[0].tool_choice, { type: "auto" });
  assert.deepEqual(reads, []);
  assert.deepEqual(json.queries, []);
});

test("도구를 부르면 서버가 다시 검사하고 조회해, 2번째 호출에 1번째 응답 블록 그대로와 결과를 보낸다 (FR-010 수용 기준 1, Q103)", async () => {
  const first = [THINKING, toolUse("toolu_1", { query: "issues_by_product" })];
  const { sent, fetchImpl } = claude(reply(first, "tool_use"), reply([THINKING, { type: "text", text: ANSWER("B형간염 백신 주가 2건으로 가장 많습니다.", ["q1_1"]) }], "end_turn"));
  const { status, json, reads, shared } = await run({ fetchImpl });
  assert.equal(status, 200);
  assert.deepEqual(reads, [["issues_by_product", { days: 30 }]]); // "최근"은 30일 (Q101)
  assert.equal(sent.length, 2);
  assert.equal(sent[1].system, sent[0].system); // 생각 블록이 이어지게 system·tools는 그대로
  assert.deepEqual(sent[1].tools, sent[0].tools);
  assert.deepEqual(sent[1].tool_choice, { type: "none" });
  const [assistant, results] = sent[1].messages.slice(-2);
  assert.deepEqual(assistant, { role: "assistant", content: first });
  assert.equal(results.role, "user");
  assert.equal(results.content[0].type, "tool_result");
  assert.equal(results.content[0].tool_use_id, "toolu_1");
  assert.match(results.content[0].content, /\[q1_1\] 제품별 품질 이슈 1: B형간염 백신 주: 2건 \(규격 이탈 1건 · 관리기준 이탈 1건\)/);
  assert.equal(json.verified, true);
  assert.deepEqual(json.queries, [{ label: "제품별 품질 이슈", scope: "제품별 품질 이슈 · 최근 30일" }]);
  assert.equal(shared.total, 2); // 서버 전체 한도는 실제 호출 수로 센다
});

test("조회 결과와 맞지 않는 숫자에는 경고가 붙는다 (FR-010 수용 기준 2)", async () => {
  const { fetchImpl } = claude(reply([toolUse("toolu_1", { query: "issues_by_product" })], "tool_use"), reply([{ type: "text", text: ANSWER("B형간염 백신 주가 9건입니다.", ["q1_1"]) }], "end_turn"));
  const { json } = await run({ fetchImpl });
  assert.equal(json.verified, false);
  assert.ok(json.parts[0].flags.length > 0);
});

test("한 질문에 조회는 2개까지: 3번째는 실행하지 않고 그 이유를 결과로 돌려준다 (Q102)", async () => {
  const calls = [toolUse("t1", { query: "issues_by_product" }), toolUse("t2", { query: "lot_status_counts" }), toolUse("t3", { query: "samples_to_check" })];
  const { sent, fetchImpl } = claude(reply(calls, "tool_use"), reply([{ type: "text", text: ANSWER("조회 결과를 보세요.", ["q1"]) }], "end_turn"));
  const { reads, json } = await run({ fetchImpl, readQuery: undefined });
  assert.deepEqual(reads.map(([kind]) => kind), ["issues_by_product", "lot_status_counts"]);
  const results = sent[1].messages.at(-1).content;
  assert.deepEqual(results.map((item) => item.tool_use_id), ["t1", "t2", "t3"]); // 모든 도구 호출에 결과를 준다
  assert.equal(results[2].is_error, true);
  assert.match(results[2].content, /2개까지/);
  assert.equal(json.queries.length, 2);
});

test("그 역할이 못 쓰는 조회·모르는 조회는 실행하지 않고 이유를 돌려준다 (FR-010 수용 기준 3·6)", async () => {
  const calls = [toolUse("t1", { query: "pending_reviews" }), toolUse("t2", { query: "drop_all_tables" })];
  const { sent, fetchImpl } = claude(reply(calls, "tool_use"), reply([{ type: "text", text: ANSWER("평가 검토 대기는 QA 관리자가 보는 기록입니다.", []) }], "end_turn"));
  const { reads, json } = await run({ fetchImpl, role: "production_operator" });
  assert.deepEqual(reads, []);
  const results = sent[1].messages.at(-1).content;
  assert.ok(results.every((item) => item.is_error === true));
  assert.match(results[0].content, /QA 관리자가 보는 기록/);
  assert.match(results[1].content, /조회 목록에 없는/);
  assert.deepEqual(json.queries, []);
});

test("조회를 못 읽으면 0이 아니라 \"못 읽음\" 줄로 보낸다 (FR-010 수용 기준 5)", async () => {
  const { sent, fetchImpl } = claude(reply([toolUse("t1", { query: "issues_by_product" })], "tool_use"), reply([{ type: "text", text: ANSWER("제품별 품질 이슈를 읽지 못했습니다.", ["q1"]) }], "end_turn"));
  const { json } = await run({ fetchImpl, readQuery: async () => null });
  assert.match(sent[1].messages.at(-1).content[0].content, /\[q1\] 제품별 품질 이슈 · 최근 30일: 읽지 못했습니다\(알 수 없음\) \[상태: 못 읽음/);
  assert.equal(json.verified, true);
});

test("2번째 호출 전에 서버 전체 한도를 다시 확인한다: 다 찼으면 429이고 Claude를 다시 부르지 않는다 (Q103)", async () => {
  const shared = { ...newState(), day: "2026-10-29", total: CHAT_LIMITS.totalPerDay - 1 }; // 1번째 호출이 마지막 한 번
  const { sent, fetchImpl } = claude(reply([toolUse("t1", { query: "issues_by_product" })], "tool_use"));
  const { status, json } = await run({ fetchImpl, shared });
  assert.equal(status, 429);
  assert.match(json.reason, /한도/);
  assert.equal(sent.length, 1);
});

test("시험 모드 \"query\": 도구를 부르고 조회 결과 줄을 인용해 답한다 (로컬만)", async () => {
  const { status, json, reads } = await run({ env: { AI_MODE: "fixtures" }, req: ask("최근 문제가 자주 발생한 제품 알려줘", { fixtureCase: "query" }), fetchImpl: async () => { throw new Error("부르면 안 됨"); } });
  assert.equal(status, 200);
  assert.deepEqual(reads.map(([kind]) => kind), ["issues_by_product"]);
  assert.match(json.parts[0].text, /^\(시험 응답\) /);
  assert.deepEqual(json.parts[0].refs, ["q1_1"]);
  assert.deepEqual(json.queries, [{ label: "제품별 품질 이슈", scope: "제품별 품질 이슈 · 최근 30일" }]);
});

test("프롬프트와 범위 밖 문구: 화면으로 답할 수 없을 때만 조회, 답하지 않는 범위는 \"사용법과 앱 기록\" (FR-003 수용 기준 2)", () => {
  const { system } = buildChatPrompt({ question: "q", history: [], guide: [], facts: null });
  assert.match(system, /app_query/);
  assert.match(OUT_OF_SCOPE_TEXT, /사용법과 앱 기록/);
});

test("답 아래 조회 줄: 실행한 조회만 \"조회: 이름 · 기간\"으로, 없으면 null (12단계, FR-010 수용 기준 1)", () => {
  assert.equal(queryLineText([]), null);
  assert.equal(queryLineText(undefined), null);
  assert.equal(queryLineText([{ label: "제품별 품질 이슈", scope: "제품별 품질 이슈 · 최근 30일" }, { label: "상태별 로트 수", scope: "상태별 로트 수" }]), "조회: 제품별 품질 이슈 · 최근 30일, 상태별 로트 수");
});

test("조회 결과 줄(q1_1)을 인용한 문장의 기간(\"최근 30일\")은 그 조회의 요약 줄(q1)에서도 찾는다 (12단계 실제 호출 C-23 오탐)", async () => {
  const { fetchImpl } = claude(reply([toolUse("t1", { query: "issues_by_product" })], "tool_use"), reply([{ type: "text", text: ANSWER("최근 30일 동안 가장 많은 제품은 B형간염 백신 주로 2건입니다.", ["q1_1"]) }], "end_turn"));
  const { json } = await run({ fetchImpl });
  assert.deepEqual(json.parts[0].flags, []);
  assert.deepEqual(json.parts[0].refs, ["q1_1"]); // 보여 주는 근거는 인용한 줄 그대로
});

test("한 문장이 근거를 4개까지만 인용해도, 같은 조회 결과의 다른 줄 숫자는 경고하지 않는다 (12단계 실제 호출 \"폐기 1개\" 오탐)", async () => {
  const tdap = (id) => ({ id, kind: "spec", source: "process", status: "open", opened_at: "2026-10-22T00:00:00Z", batch: { id: "b3", batch_number: "TDP-2610-001", product: { item_name: "Tdap 혼합 백신 주" } } });
  const data = { rows: [...ISSUES.rows.slice(0, 2), tdap("t1"), tdap("t2"), tdap("t3")], truncated: false }; // 많은 순: q1_1 Tdap 3건, q1_2 HBV 2건, q1 5건
  const { fetchImpl } = claude(reply([toolUse("t1", { query: "issues_by_product" })], "tool_use"), reply([{ type: "text", text: ANSWER("Tdap 혼합 백신 주가 3건으로 가장 많습니다.", ["q1_2"]) }], "end_turn"));
  const { json } = await run({ fetchImpl, readQuery: async () => data });
  assert.deepEqual(json.parts[0].flags, []);
});

test("조회 결과 어디에도 없는 숫자는 여전히 경고한다", async () => {
  const { fetchImpl } = claude(reply([toolUse("t1", { query: "issues_by_product" })], "tool_use"), reply([{ type: "text", text: ANSWER("Tdap 혼합 백신 주가 7건입니다.", ["q1_1"]) }], "end_turn"));
  const { json } = await run({ fetchImpl });
  assert.equal(json.parts[0].flags[0].code, "number_mismatch");
});
