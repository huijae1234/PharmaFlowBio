// AI 칸(spec 023·024)이 쓰는 저장된 사실을 서버가 직접 읽는다. 호출한 사람의 토큰으로 읽으므로 RLS가 보여 주는 자료만 온다.
// 화면이 보내는 근거 표·역할·작성자·담당자 값은 믿지 않는다: 대상 ID와 로그인한 사용자로 여기서 읽는다. 읽기만 하고 `_`로 시작해 함수로 열리지 않는다.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../src/config.js";
import { SPEC_IMPACT_CAP } from "../src/domain/ai-spec-impact-rules.js";
import { SCHEDULE_LIMITS } from "../src/domain/ai-schedule-rules.js";
import { FOLLOWUP_RULES, baselineOf, toCandidate } from "../src/domain/ai-followup-rules.js";
import { retestTarget } from "../src/domain/action-rules.js";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ASK_READ_CAP = 200; // 질문 조회가 한 번에 읽는 최대 줄 수: 넘으면 일부만 읽었다고 알린다

const ISSUE = "id,source,kind,status,opened_at,closed_at,batch_id,process_record_id,batch:batch_id(id,batch_number,status,product_id,product:product_id(item_name)),process_record:process_record_id(id,recorded_at,equipment_status,production_quantity)";
const MEASURE = "id,value,result,measured_at,action_request_id,process_record_id,quality_issue_id,batch_id,specification_id,applied_min_value,applied_max_value,applied_alert_min_value,applied_alert_max_value,applied_spec_version,batch:batch_id(id,batch_number),specification:specification_id(item_name,unit,min_value,max_value,alert_min_value,alert_max_value,version,category)";
const FOLLOW = "id,value,result,measured_at,batch_id,action_request_id,applied_spec_version,specification_id,batch:batch_id(id,batch_number),specification:specification_id(item_name,unit,category),process_record:process_record_id(step_run:step_run_id(process_step_id))";

/** @param {{ supabaseUrl?: string, anonKey?: string, fetchImpl?: typeof fetch }} [options] */
export function makeData({ supabaseUrl = SUPABASE_URL, anonKey = SUPABASE_PUBLISHABLE_KEY, fetchImpl = fetch } = {}) {
  async function rest(req, path, params) {
    const url = new URL(`/rest/v1/${path}`, supabaseUrl);
    url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, { headers: { apikey: anonKey, Authorization: req.headers.authorization }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("rest");
    const rows = JSON.parse(await response.text());
    if (!Array.isArray(rows)) throw new Error("rest");
    return rows;
  }
  const soft = (promise, fallback) => promise.then((rows) => ({ ok: true, rows }), () => ({ ok: false, rows: fallback }));
  const inList = (ids) => `in.(${ids.join(",")})`;

  return {
    /** 이슈 한 건과 그 측정값·조치 요청·평가서·공정 단계 이름. 없거나 RLS가 가리면 null, 못 읽으면 던진다 */
    async issueBundle(req, issueId) {
      const [issue] = await rest(req, "quality_issue", { id: `eq.${issueId}`, select: ISSUE });
      if (!issue) return null;
      const filter = `(quality_issue_id.eq.${issueId}${issue.process_record_id ? `,process_record_id.eq.${issue.process_record_id}` : ""})`;
      const [measurements, requests, reviews, step] = await Promise.all([
        rest(req, "measurement", { select: MEASURE, or: filter, order: "measured_at" }),
        rest(req, "action_request", { quality_issue_id: `eq.${issueId}`, select: "id,quality_issue_id,action_type,status,requested_at,requested_by,assignee_id,result_note,completed_at", order: "requested_at" }),
        rest(req, "deviation_review", { quality_issue_id: `eq.${issueId}`, select: "id,quality_issue_id,status,requested_by,deviation_summary,probable_cause,impact_assessment,proposed_action,evidence" }),
        issue.process_record_id ? rest(req, "process_record", { id: `eq.${issue.process_record_id}`, select: "step_run:step_run_id(step_label)" }).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const stepLabel = issue.process_record_id ? (step === undefined ? undefined : step[0]?.step_run?.step_label ?? null) : undefined; // 못 읽으면 undefined: 근거 표가 줄을 만들지 않는다
      return { issue, batch: issue.batch, measurements, requests, review: reviews[0] ?? null, stepLabel };
    },

    /** 조치 이후 비교에 쓸 자료 (store-ai-context.js의 loadFollowup과 같은 규칙) */
    async followup(req, issueId, measurements) {
      const target = retestTarget(measurements.filter((m) => m.quality_issue_id === issueId && !m.action_request_id)); // 화면과 같은 기준: 이슈에 연결된 처음 이탈 값
      if (!target) return { baseline: null, read: { ok: true, rows: [] } };
      try {
        const [row] = await rest(req, "measurement", { id: `eq.${target.id}`, select: FOLLOW });
        const baseline = row ? baselineOf(row, row.process_record?.step_run?.process_step_id ?? null) : null;
        if (!baseline) return { baseline: null, read: { ok: true, rows: [] } };
        const rows = await rest(req, "measurement", { specification_id: `eq.${baseline.specificationId}`, measured_at: `gte.${baseline.measuredAt}`, select: FOLLOW, order: "measured_at.desc", limit: String(FOLLOWUP_RULES.fetchCap + 1) });
        return { baseline, read: { ok: true, truncated: rows.length > FOLLOWUP_RULES.fetchCap, rows: rows.slice(0, FOLLOWUP_RULES.fetchCap).map(toCandidate) } };
      } catch {
        return { baseline: null, read: { ok: false } };
      }
    },

    /** 기준 한 건과 그 항목의 측정값 (상한을 넘기면 truncated) */
    async specBundle(req, specId) {
      const [spec] = await rest(req, "specification", { id: `eq.${specId}`, select: "id,product_id,category,item_name,unit,min_value,max_value,alert_min_value,alert_max_value,version" });
      if (!spec) return null;
      const read = await soft(rest(req, "measurement", { specification_id: `eq.${specId}`, select: "id,value,result,batch_id,applied_min_value,applied_max_value,applied_alert_min_value,applied_alert_max_value,applied_spec_version,batch:batch_id(id,batch_number)", order: "measured_at.desc", limit: String(SPEC_IMPACT_CAP + 1) }), []);
      return { spec, measurements: read.rows.slice(0, SPEC_IMPACT_CAP), read: { ok: read.ok, truncated: read.rows.length > SPEC_IMPACT_CAP } };
    },

    /** 진행 전·진행 중 작업지시와, 그 로트의 열린 이슈·평가·조치·진행 공정. 이슈 쪽을 못 읽으면 tasks.ok=false */
    async scheduleBundle(req) {
      const cap = SCHEDULE_LIMITS.orderCap;
      const orderRead = await soft(rest(req, "work_order", { status: "in.(draft,released,in_progress)", select: "id,order_number,product_id,planned_start,planned_end,status,batch_id,product:product_id(item_name),batch:batch_id(id,batch_number,status)", order: "planned_end.asc", limit: String(cap + 1) }), []);
      const orders = orderRead.rows.slice(0, cap);
      const lotIds = [...new Set(orders.map((order) => order.batch_id).filter(Boolean))].slice(0, 100);
      let tasks = { ok: orders.filter((order) => order.batch_id).length <= 100 }; // 100개 로트를 넘으면 일부만 읽은 것
      let issues = [], reviews = [], requests = [], steps = [];
      if (lotIds.length) {
        const issueRead = await soft(rest(req, "quality_issue", { status: "eq.open", batch_id: inList(lotIds), select: "id,batch_id,source,kind,status,opened_at" }), []);
        issues = issueRead.rows;
        const ids = issues.map((issue) => issue.id).slice(0, 100);
        const [reviewRead, requestRead, stepRead] = await Promise.all([
          ids.length ? soft(rest(req, "deviation_review", { quality_issue_id: inList(ids), select: "quality_issue_id,status" }), []) : { ok: true, rows: [] },
          ids.length ? soft(rest(req, "action_request", { quality_issue_id: inList(ids), select: "quality_issue_id,status,action_type" }), []) : { ok: true, rows: [] },
          soft(rest(req, "step_run", { batch_id: inList(lotIds), status: "eq.in_progress", select: "batch_id,step_label" }), []),
        ]);
        reviews = reviewRead.rows; requests = requestRead.rows; steps = stepRead.rows;
        tasks = { ok: tasks.ok && issueRead.ok && reviewRead.ok && requestRead.ok && stepRead.ok && issues.length <= 100 };
      }
      return { orders, issues, reviews, requests, steps, read: { orders: { ok: orderRead.ok, truncated: orderRead.rows.length > cap }, tasks } };
    },

    /** 업무 찾아보기의 준비된 읽기 4개. 사용자는 로그인한 사람으로만 정한다 (질문에 적힌 사람은 쓰지 않는다) */
    async askData(req, kind, { userId, today }) {
      const limit = String(ASK_READ_CAP + 1);
      let rows;
      let issues;
      if (kind === "held_lots") {
        rows = await rest(req, "batch", { status: "eq.on_hold", select: "id,batch_number,hold_reason,product:product_id(item_name)", order: "created_at.asc", limit });
        const ids = rows.slice(0, ASK_READ_CAP).map((batch) => batch.id);
        issues = ids.length ? await rest(req, "quality_issue", { status: "eq.open", batch_id: inList(ids), select: "batch_id,opened_at" }) : [];
      } else if (kind === "pending_reviews") {
        rows = await rest(req, "deviation_review", { status: "eq.submitted", select: "id,quality_issue_id,requested_at,issue:quality_issue_id(id,batch:batch_id(batch_number))", order: "requested_at.asc", limit });
      } else if (kind === "my_actions") {
        if (!UUID.test(userId)) throw new Error("user");
        rows = await rest(req, "action_request", { assignee_id: `eq.${userId}`, status: "eq.approved", select: "id,quality_issue_id,action_type,reviewed_at,issue:quality_issue!action_request_quality_issue_id_fkey(id,batch:batch_id(batch_number))", order: "reviewed_at.asc", limit });
      } else {
        rows = await rest(req, "work_order", { status: "in.(draft,released,in_progress)", planned_end: `lt.${today}`, select: "id,order_number,planned_end,status,product:product_id(item_name)", order: "planned_end.asc", limit });
      }
      return { rows: rows.slice(0, ASK_READ_CAP), issues, truncated: rows.length > ASK_READ_CAP };
    },
  };
}

export const defaultData = makeData();
