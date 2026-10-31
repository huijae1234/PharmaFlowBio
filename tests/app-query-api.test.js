// spec 025 v0.6 FR-010 (plan v0.5 10단계): api/_app-query.js 서버 읽기 — 로그인 토큰·읽기만·상한·실패
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUERY_READ_CAP, readQuery } from "../api/_app-query.js";

const NOW = new Date("2026-10-29T03:00:00.000Z");
const req = { headers: { authorization: "Bearer user-token" } };
const options = (fetchImpl, extra = {}) => ({ userId: "11111111-1111-4111-8111-111111111111", now: NOW, supabaseUrl: "https://db.example", anonKey: "anon", fetchImpl, ...extra });

function recorder(rowsFor) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ table: parsed.pathname.replace("/rest/v1/", ""), params: Object.fromEntries(parsed.searchParams), init });
    const rows = rowsFor(parsed.pathname.replace("/rest/v1/", ""));
    return rows === "fail" ? { ok: false, text: async () => "" } : { ok: true, text: async () => JSON.stringify(rows) };
  };
  return { calls, fetchImpl };
}

test("새 9종은 로그인한 사람의 토큰으로 GET만, 정해진 표·조건으로 읽는다 (FR-010, 읽기 전용)", async () => {
  const expected = {
    issues_by_product: ["quality_issue", { opened_at: "gte.2026-09-29T03:00:00.000Z" }],
    deviations_by_item: ["measurement", { result: "in.(out_of_spec,out_of_alert)", measured_at: "gte.2026-09-29T03:00:00.000Z" }],
    out_of_spec_lots: ["measurement", { result: "eq.out_of_spec" }],
    old_open_issues: ["quality_issue", { status: "eq.open", opened_at: "lte.2026-10-22T03:00:00.000Z" }],
    pending_requests: ["action_request", { status: "eq.pending_approval" }],
    lot_status_counts: ["batch", {}],
    release_decisions: ["work_history", { target_table: "eq.batch", action: "in.(\"내부 출하 검토\",\"출하 완료\")" }],
    running_steps: ["step_run", { status: "eq.in_progress" }],
    samples_to_check: ["sample_transfer", { status: "in.(pending,return_pending)" }],
  };
  for (const [kind, [table, params]] of Object.entries(expected)) {
    const { calls, fetchImpl } = recorder(() => []);
    const days = kind === "old_open_issues" ? 7 : 30;
    const data = await readQuery(req, kind, { days }, options(fetchImpl));
    assert.deepEqual(data, { rows: [], truncated: false }, kind);
    assert.equal(calls.length, 1, kind);
    assert.equal(calls[0].table, table, kind);
    for (const [name, value] of Object.entries(params)) assert.equal(calls[0].params[name], value, `${kind} ${name}`);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[0].init.headers.Authorization, "Bearer user-token");
    assert.ok(!/display_name|email|actor_name/.test(calls[0].params.select), `${kind} 이름을 읽지 않는다`);
  }
});

test("읽기 상한을 넘으면 상한까지만 돌려주고 truncated, 못 읽으면 null (FR-010 수용 기준 5)", async () => {
  const many = Array.from({ length: QUERY_READ_CAP.list + 1 }, (_, index) => ({ id: `i${index}` }));
  const { fetchImpl } = recorder(() => many);
  const data = await readQuery(req, "old_open_issues", { days: 7 }, options(fetchImpl));
  assert.equal(data.rows.length, QUERY_READ_CAP.list);
  assert.equal(data.truncated, true);
  assert.equal(await readQuery(req, "old_open_issues", { days: 7 }, options(recorder(() => "fail").fetchImpl)), null);
  assert.equal(await readQuery(req, "old_open_issues", { days: 7 }, options(async () => { throw new Error("down"); })), null);
});

test("업무 찾아보기 4종은 그 읽기(askData)를 다시 쓰고, \"내 것\"은 로그인한 사람으로 (FR-010, spec 024)", async () => {
  const asked = [];
  const askData = async (r, kind, extra) => { asked.push([r.headers.authorization, kind, extra]); return { rows: [], issues: [], truncated: false }; };
  for (const kind of ["held_lots", "pending_reviews", "my_actions", "overdue_orders"]) {
    assert.deepEqual(await readQuery(req, kind, {}, options(null, { askData })), { rows: [], issues: [], truncated: false });
  }
  assert.deepEqual(asked.map(([token, kind, extra]) => [token, kind, extra.userId, extra.today]), [
    ["Bearer user-token", "held_lots", "11111111-1111-4111-8111-111111111111", "2026-10-29"],
    ["Bearer user-token", "pending_reviews", "11111111-1111-4111-8111-111111111111", "2026-10-29"],
    ["Bearer user-token", "my_actions", "11111111-1111-4111-8111-111111111111", "2026-10-29"],
    ["Bearer user-token", "overdue_orders", "11111111-1111-4111-8111-111111111111", "2026-10-29"],
  ]);
  assert.equal(await readQuery(req, "my_actions", {}, options(null, { askData: async () => { throw new Error("rest"); } })), null);
});
