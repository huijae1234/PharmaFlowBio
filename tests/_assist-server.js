// spec 023·024 서버 시험용 가짜 저장소 읽기(api/_ai-data.js와 같은 모양)와 요청 도우미. `.test.js`가 아니라 실행되지 않는 틀이다.
import { createAiHandler } from "../api/ai.js";
import { ISSUE_ID, NOW, daysAgo, measurement, processIssue, request, review, testIssue } from "./_assist-data.js";

export const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
export const SPEC_ID = "33333333-3333-4333-8333-333333333333";
export const PROCESS_ISSUE_ID = "44444444-4444-4444-8444-444444444444";

/** 이슈 묶음: 서버가 읽은 기록 모양 (issue·batch·측정값·조치 요청·평가서·공정 단계 이름) */
export const bundle = (issue = testIssue(), over = {}) => ({ issue, batch: issue.batch, measurements: [measurement({ quality_issue_id: issue.id })], requests: [], review: null, stepLabel: undefined, ...over });

const lots = (count, over = {}) => Array.from({ length: count }, (_, i) => ({ id: `x${i}`, batchId: `b${i + 2}`, batchNumber: `HBV-2610-00${i + 2}`, value: 99, result: "pass", measuredAt: daysAgo(10), specVersion: 1, unit: "%", stepId: null, actionRequestId: null, ...over }));

export function fakeData(over = {}) {
  const calls = [];
  const issues = {
    [ISSUE_ID]: bundle(testIssue(), { requests: [request({ id: REQUEST_ID, status: "completed", assignee_id: "u1", completed_at: daysAgo(30), result_note: "완료", quality_issue_id: ISSUE_ID })] }),
    [PROCESS_ISSUE_ID]: bundle(processIssue({ id: PROCESS_ISSUE_ID }), { requests: [request({ id: "55555555-5555-4555-8555-555555555555", status: "pending_approval", quality_issue_id: PROCESS_ISSUE_ID })], review: review({ status: "submitted", requested_by: "other" }), stepLabel: "충전" }),
    ...(over.issues ?? {}),
  };
  const data = {
    calls,
    async issueBundle(req, id) { calls.push(["issueBundle", id, req.headers.authorization]); if (over.throws) throw new Error("rest"); return issues[id] ?? null; },
    async followup() { calls.push(["followup"]); return over.followup ?? { baseline: { batchId: "b1", batchNumber: "HBV-2610-001", specificationId: "s1", itemName: "역가", unit: "%", specVersion: 1, result: "out_of_spec", measuredAt: daysAgo(40), processItem: false, stepId: null }, read: { ok: true, truncated: false, rows: lots(3) } }; },
    async specBundle(req, id) {
      calls.push(["specBundle", id]);
      if (id !== SPEC_ID) return null;
      return over.spec ?? { spec: { id, item_name: "역가", unit: "%", min_value: 90, max_value: 110, alert_min_value: 95, alert_max_value: 105, version: 2 }, read: { ok: true, truncated: false },
        measurements: [{ id: "m1", value: 92, result: "pass", batch_id: "b1", batch: { batch_number: "HBV-2610-001" }, applied_spec_version: 1, applied_min_value: 80, applied_max_value: 125, applied_alert_min_value: 90, applied_alert_max_value: 115 }] };
    },
    async scheduleBundle() {
      calls.push(["scheduleBundle"]);
      return over.schedule ?? { orders: [{ id: "o1", order_number: "WO-2026-001", product: { item_name: "B형간염" }, status: "in_progress", planned_start: "2026-10-01", planned_end: "2026-10-20", batch_id: null, batch: null }], issues: [], reviews: [], requests: [], steps: [], read: { orders: { ok: true }, tasks: { ok: true } } };
    },
    async askData(req, kind, scope) {
      calls.push(["askData", kind, scope]);
      if (over.askThrows) throw new Error("rest");
      const sets = {
        held_lots: { rows: [{ id: "b1", batch_number: "HBV-2610-001", hold_reason: "역가 규격 이탈", product: { item_name: "B형간염" } }], issues: [{ batch_id: "b1", opened_at: daysAgo(10) }], truncated: false },
        pending_reviews: { rows: [{ id: "r1", quality_issue_id: ISSUE_ID, requested_at: daysAgo(4), issue: { batch: { batch_number: "HBV-2610-001" } } }], truncated: false },
        my_actions: { rows: [{ id: "a1", quality_issue_id: ISSUE_ID, action_type: "retest", reviewed_at: daysAgo(2), issue: { id: ISSUE_ID, batch: { batch_number: "HBV-2610-002" } } }], truncated: false },
        overdue_orders: { rows: [{ id: "o1", order_number: "WO-2026-001", planned_end: "2026-10-20", status: "in_progress", product: { item_name: "B형간염" } }], truncated: false },
      };
      return over.askRows?.[kind] ?? sets[kind];
    },
  };
  return data;
}

export function fakeRes() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = text; } };
}
export const newState = () => ({ day: "", perUser: new Map(), total: 0, inflight: new Set() });
export const post = (body, { method = "POST" } = {}) => ({ method, url: "/api/ai", headers: { authorization: "Bearer user-token" }, body });

/** 핸들러를 한 번 부른다. 기본: 시험 모드(가짜 Claude), 로그인 u1, 역할은 role 인자(서버가 DB에서 읽은 값) */
export async function call(role, body, options = {}) {
  const res = fakeRes();
  const data = options.data ?? fakeData();
  await createAiHandler({ verify: async () => options.userId ?? "u1", role: async () => role, data, env: { AI_MODE: "fixtures" }, state: newState(), now: () => NOW, ...options.handler })(post(body), res);
  return { status: res.statusCode, json: JSON.parse(res.body), raw: res.body, data };
}

export const message = (text) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text }] }) });
