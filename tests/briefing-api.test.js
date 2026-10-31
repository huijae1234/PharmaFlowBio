// spec 026 FR-001·002·007~010: api/briefing.js 아침 브리핑 발송 함수 (비밀 값·평일·받는 사람·같은 날 한 번·실패 격리·AI 줄·시험 모드)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBriefingHandler } from "../api/briefing.js";
import { briefingPrompt } from "../src/domain/briefing-rules.js";

const MONDAY_8 = new Date("2026-11-01T23:00:00Z"); // 한국 11/2(월) 08:00
const SUNDAY_8 = new Date("2026-10-31T23:00:00Z"); // 한국 11/1(일) 08:00
const SECRET = "cron-secret-test";
const PEOPLE = [
  { id: "11111111-1111-4111-8111-111111111111", display_name: "가상 QA", email: "qa@test.local", role: "qa_manager" },
  { id: "22222222-2222-4222-8222-222222222222", display_name: "가상 QC", email: "qc@test.local", role: "qc_analyst" },
  { id: "33333333-3333-4333-8333-333333333333", display_name: "가상 생산", email: "prod@test.local", role: "production_operator" },
];
const ITEMS = {
  qa_manager: [{ key: "qa_waiting_issues", state: "ok", count: 2, top: [{ text: "B-001 · 3일째", path: "#/issues/a" }] }],
  qc_analyst: [{ key: "test_issues", state: "ok", count: 1, top: [] }],
  production_operator: [{ key: "process_issues", state: "ok", count: 0, top: [] }],
};

function fakeData({ sent = [] } = {}) {
  const calls = { record: [], items: [] };
  return {
    calls,
    recipients: async () => PEOPLE,
    items: async (id) => { calls.items.push(id); const role = PEOPLE.find((p) => p.id === id).role; return { role, sections: ITEMS[role] }; },
    alreadySent: async (id) => sent.includes(id),
    record: async (id, day, status) => { calls.record.push([id, day, status]); return true; },
  };
}
const fakeRes = () => ({ statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = text; } });
const req = ({ secret = SECRET, query = "" } = {}) => ({ method: "GET", url: `/api/briefing${query}`, headers: { authorization: secret === null ? undefined : `Bearer ${secret}`, host: "pharmaflow.example", "x-forwarded-proto": "https" } });

async function run(options = {}, request = req()) {
  const delivered = [];
  const deliverImpl = options.deliverImpl ?? (async (note) => { delivered.push(note); return { status: "sent", reason: null }; });
  const data = options.data ?? fakeData();
  const res = fakeRes();
  const logs = [];
  await createBriefingHandler({ data, deliverImpl, now: () => options.now ?? MONDAY_8, env: { CRON_SECRET: SECRET, SLACK_BOT_TOKEN: "xoxb-test", ...(options.env ?? {}) }, fetchImpl: options.fetchImpl ?? (async () => { throw new Error("AI 안 부름"); }), log: (line) => logs.push(line) })(request, res);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}"), raw: res.body, delivered, data, logs };
}

test("비밀 값이 없거나 틀리면 401이고 아무것도 읽거나 보내지 않는다 (FR-010 수용 기준 2)", async () => {
  for (const secret of [null, "wrong"]) {
    const { status, delivered, data } = await run({}, req({ secret }));
    assert.equal(status, 401);
    assert.equal(delivered.length, 0);
    assert.equal(data.calls.items.length, 0);
  }
  const noSecretEnv = await run({ env: { CRON_SECRET: "" } }, req({ secret: "" }));
  assert.equal(noSecretEnv.status, 401); // 서버에 비밀 값이 없으면 누구도 통과 못 한다
});

test("주말이면 아무것도 보내지 않는다 (FR-001 수용 기준 1)", async () => {
  const { status, json, delivered } = await run({ now: SUNDAY_8 });
  assert.equal(status, 200);
  assert.equal(json.skipped, "weekend");
  assert.equal(delivered.length, 0);
});

test("평일: 직원마다 그 직무 글을 개인 메시지로, 홈 링크는 역할 홈, 채널 대체 없음, 결과는 sent로 기록 (FR-001~005, FR-008)", async () => {
  const deliverCalls = [];
  const deliverImpl = async (note, options) => { deliverCalls.push([note, options]); return { status: "sent", reason: null }; };
  const { json, data } = await run({ deliverImpl });
  assert.equal(deliverCalls.length, 3);
  const [qaNote, qaOptions] = deliverCalls[0];
  assert.match(qaNote.body, /^\*아침 브리핑 · 11\/2\(월\) · QA 관리자\*/);
  assert.match(qaNote.body, /평가서 검토·조치 승인을 기다리는 이슈 2건/);
  assert.equal(qaNote.path, "#/home/qa");
  assert.equal(qaNote.recipient_email, "qa@test.local");
  assert.equal(qaOptions.channel, undefined); // 공용 채널로 보내지 않는다
  assert.equal(qaOptions.origin, "https://pharmaflow.example");
  assert.equal(deliverCalls[2][0].path, "#/home/production");
  assert.deepEqual(data.calls.record.map((r) => [r[1], r[2]]), [["2026-11-02", "sent"], ["2026-11-02", "sent"], ["2026-11-02", "sent"]]);
  assert.deepEqual({ sent: json.sent, failed: json.failed, skipped: json.skippedPeople }, { sent: 3, failed: 0, skipped: 0 });
});

test("같은 날 이미 보낸 사람은 건너뛴다 (FR-001 수용 기준 2)", async () => {
  const { json, delivered } = await run({ data: fakeData({ sent: [PEOPLE[0].id] }) });
  assert.equal(delivered.length, 2);
  assert.equal(json.skippedPeople, 1);
});

test("슬랙 계정을 못 찾으면 failed로 기록(알림 함 안내), 한 사람의 오류가 다음 사람을 막지 않는다 (FR-002 수용 기준 2, FR-009)", async () => {
  let n = 0;
  const deliverImpl = async () => { n += 1; if (n === 1) return { status: "failed", reason: "슬랙 계정을 찾지 못함" }; if (n === 2) throw new Error("뜻밖의 오류"); return { status: "sent", reason: null }; };
  const { json, data, logs } = await run({ deliverImpl });
  assert.deepEqual(data.calls.record.map((r) => r[2]), ["failed", "failed", "sent"]);
  assert.deepEqual({ sent: json.sent, failed: json.failed }, { sent: 1, failed: 2 });
  assert.deepEqual(logs, ["아침 브리핑 2026-11-02 · 보냄 1 · 못 보냄 2 · 건너뜀 0"]); // 기록은 개수만
});

test("받는 사람을 못 읽으면(DB가 안 됨) 502와 기록 한 줄, 아무에게도 보내지 않는다 (FR-009)", async () => {
  const data = { ...fakeData(), recipients: async () => { throw new Error("db down"); } };
  const { status, json, delivered, logs } = await run({ data });
  assert.deepEqual([status, json.reason, delivered.length], [502, "받는 사람을 읽지 못했습니다.", 0]);
  assert.deepEqual(logs, ["아침 브리핑 2026-11-02 · 받는 사람을 읽지 못함"]);
});

test("응답·기록에 키·이메일·브리핑 내용이 없다 (FR-009·010)", async () => {
  const { raw, logs } = await run({ env: { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_never" } });
  for (const text of [raw, ...logs]) {
    assert.doesNotMatch(text, /sb_secret_never|xoxb-test|cron-secret-test|@test\.local|기다리는 이슈/);
  }
});

test("AI 한두 줄: 검증을 통과하면 붙고, 숫자가 틀리거나 호출이 실패하면 목록만 보낸다 (FR-007)", async () => {
  const answer = (text) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ claims: [{ text, refs: ["qa_waiting_issues"] }], unknowns: [] }) }] }) });
  const env = { ANTHROPIC_API_KEY: "sk-test" };
  const good = await run({ env, fetchImpl: answer("검토를 기다리는 이슈 2건을 먼저 보세요.") });
  assert.match(good.delivered[0].body, /먼저 볼 것 \(AI 참고 의견\): 검토를 기다리는 이슈 2건을 먼저 보세요\./);
  const bad = await run({ env, fetchImpl: answer("이슈 9건을 보세요.") });
  assert.doesNotMatch(bad.delivered[0].body, /AI 참고 의견/);
  const down = await run({ env, fetchImpl: async () => { throw new Error("down"); } });
  assert.doesNotMatch(down.delivered[0].body, /AI 참고 의견/);
  assert.equal(down.json.sent, 3);
});

test("AI 프롬프트: spec 022 공통 규칙과 근거 표, 2문장 이내 (FR-007)", () => {
  const prompt = briefingPrompt({ asOf: "2026-11-01T23:00:00.000Z", rows: [{ id: "qa_waiting_issues", label: "검토 대기", value: "2건", state: "ok" }], limits: [] });
  assert.match(prompt.system, /근거 표/);
  assert.match(prompt.system, /2개 이내/);
  assert.match(prompt.user, /\[qa_waiting_issues\] 검토 대기: 2건/);
});

test("dry=1: 보내지도 기록하지도 않고 직무별 글을 돌려준다 (미리 보기). only=사람 id는 그 사람만 (4단계 본인 확인용)", async () => {
  const dry = await run({}, req({ query: "?dry=1" }));
  assert.equal(dry.delivered.length, 0);
  assert.equal(dry.data.calls.record.length, 0);
  assert.deepEqual(dry.json.previews.map((p) => p.role), ["qa_manager", "qc_analyst", "production_operator"]);
  assert.match(dry.json.previews[1].text, /처리 중인 시험 이슈 1건/);
  const only = await run({}, req({ query: `?only=${PEOPLE[2].id}` }));
  assert.equal(only.delivered.length, 1);
  assert.equal(only.delivered[0].path, "#/home/production");
  assert.equal((await run({}, req({ query: "?only=not-a-uuid" }))).status, 400);
  const sunday = await run({ now: SUNDAY_8 }, req({ query: "?dry=1" }));
  assert.equal(sunday.json.previews.length, 3); // 미리 보기는 주말에도 된다
});

test("시험 모드(로컬만): 관리자 키·DB 없이 가짜 세 사람으로 미리 보기, Vercel에서는 꺼진다", async () => {
  const res = fakeRes();
  await createBriefingHandler({ now: () => MONDAY_8, env: { CRON_SECRET: SECRET, BRIEFING_MODE: "fixtures" }, log: () => {} })(req({ query: "?dry=1" }), res);
  const json = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(json.previews.length, 3);
  assert.ok(json.previews.every((p) => p.text.includes("(시험 자료)")));
  const vercel = fakeRes();
  await createBriefingHandler({ now: () => MONDAY_8, env: { CRON_SECRET: SECRET, BRIEFING_MODE: "fixtures", VERCEL: "1" }, log: () => {} })(req({ query: "?dry=1" }), vercel);
  assert.equal(vercel.statusCode, 503); // Vercel에서는 시험 모드가 꺼지고, 관리자 키가 없으면 503
});
