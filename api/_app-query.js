// AI 도우미 앱 전체 조회 읽기 (spec 025 v0.6 FR-010). 로그인한 사람의 토큰으로 GET만 하므로 RLS가 보여 주는 기록만 온다.
// 조회 이름·조건은 app-query-rules.js checkQueryInput을 거친 것만 받는다. 사람 이름은 읽지 않는다. `_`로 시작해 함수로 열리지 않는다.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/config.js";
import { kstDate } from "../src/domain/ai-schedule-rules.js";
import { makeData } from "./_ai-data.js";

// 묶어 세는 조회는 1,000줄, 목록 조회는 200줄(spec 024 ASK_READ_CAP과 같음)까지 읽는다. 넘으면 "일부만 읽었습니다"
export const QUERY_READ_CAP = { count: 1000, list: 200 };
const DAY_MS = 86400000;
const TIMEOUT_MS = 5000;
const ASK_KINDS = new Set(["held_lots", "pending_reviews", "my_actions", "overdue_orders"]);
const LOT = "batch:batch_id(id,batch_number)";
const LOT_PRODUCT = "batch:batch_id(id,batch_number,product:product_id(item_name))";

const daysBefore = (now, days) => new Date(now.getTime() - days * DAY_MS).toISOString();

/** 조회마다 [표, 조건, 상한]. since·before는 기간·일수에서 만든다 */
const READS = {
  issues_by_product: ({ since }) => ["quality_issue", { opened_at: `gte.${since}`, select: `id,kind,source,status,opened_at,${LOT_PRODUCT}` }, "count"],
  deviations_by_item: ({ since }) => ["measurement", { result: "in.(out_of_spec,out_of_alert)", measured_at: `gte.${since}`, select: "result,specification:specification_id(item_name,category)" }, "count"],
  out_of_spec_lots: ({ since }) => ["measurement", { result: "eq.out_of_spec", measured_at: `gte.${since}`, select: `${LOT_PRODUCT},specification:specification_id(item_name)` }, "count"],
  old_open_issues: ({ before }) => ["quality_issue", { status: "eq.open", opened_at: `lte.${before}`, select: `id,kind,source,status,opened_at,${LOT}`, order: "opened_at.asc" }, "list"],
  pending_requests: () => ["action_request", { status: "eq.pending_approval", select: "id,action_type,requested_at,quality_issue_id,issue:quality_issue!action_request_quality_issue_id_fkey(batch:batch_id(batch_number))", order: "requested_at.asc" }, "list"],
  lot_status_counts: () => ["batch", { select: "status" }, "count"],
  release_decisions: ({ since }) => ["work_history", { target_table: "eq.batch", action: "in.(\"내부 출하 검토\",\"출하 완료\")", created_at: `gte.${since}`, select: "batch_id,batch_number,action,created_at,status:after_data->>status", order: "created_at.desc" }, "list"],
  running_steps: () => ["step_run", { status: "eq.in_progress", select: `id,step_label,started_at,${LOT}`, order: "started_at.asc" }, "list"],
  samples_to_check: () => ["sample_transfer", { status: "in.(pending,return_pending)", select: `id,status,from_team,to_team,sample_kind,quantity,unit,sent_at,return_requested_at,${LOT}`, order: "sent_at.asc" }, "list"],
};

/**
 * 검사를 거친 조회 하나를 읽는다. 못 읽으면 null(화면에 "못 읽음")
 * @param {{ headers: { authorization?: string } }} req
 * @param {string} kind
 * @param {{ days?: number }} params
 * @param {{ userId: string, now: Date, supabaseUrl?: string, anonKey?: string, fetchImpl?: typeof fetch, askData?: Function }} options
 * @returns {Promise<{ rows: object[], issues?: object[], truncated: boolean } | null>}
 */
export async function readQuery(req, kind, params, { userId, now, supabaseUrl = SUPABASE_URL, anonKey = SUPABASE_PUBLISHABLE_KEY, fetchImpl = fetch, askData }) {
  try {
    if (ASK_KINDS.has(kind)) {
      const read = askData ?? makeData({ supabaseUrl, anonKey, fetchImpl }).askData; // 업무 찾아보기 읽기 그대로 (spec 024)
      return await read(req, kind, { userId, today: kstDate(now) });
    }
    const days = params.days ?? 0;
    const [table, query, cap] = READS[kind]({ since: daysBefore(now, days), before: daysBefore(now, days) });
    const limit = QUERY_READ_CAP[cap];
    const url = new URL(`/rest/v1/${table}`, supabaseUrl);
    url.search = new URLSearchParams({ ...query, limit: String(limit + 1) }).toString();
    const response = await fetchImpl(url, { headers: { apikey: anonKey, Authorization: req.headers.authorization }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const rows = JSON.parse(await response.text());
    if (!Array.isArray(rows)) return null;
    return { rows: rows.slice(0, limit), truncated: rows.length > limit };
  } catch {
    return null;
  }
}
