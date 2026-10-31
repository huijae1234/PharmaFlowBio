// AI 도우미 화면 근거 표 읽기 (spec 025 v0.5 8·9단계 FR-004 수용 기준 5·6). 로그인한 사람의 토큰으로 읽어 그 사람에게 보이는 자료만 온다(관리자 키를 쓰지 않는다).
// 홈 3개는 DB 함수 my_briefing_items(아침 브리핑과 같은 항목), 로트 상세는 화면이 읽는 것과 같은 표들. 화면이 보낸 표는 믿지 않는다. 못 읽으면 null → 근거 표 없이 답한다.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/config.js";
import { homeScreenFacts, lotScreenFacts } from "../src/domain/chat-rules.js";

const TIMEOUT_MS = 5000;

export async function readHomeItems(req, { supabaseUrl = SUPABASE_URL, anonKey = SUPABASE_PUBLISHABLE_KEY, fetchImpl = fetch } = {}) {
  try {
    const url = new URL("/rest/v1/rpc/my_briefing_items", supabaseUrl);
    const response = await fetchImpl(url, {
      method: "POST", body: "{}",
      headers: { apikey: anonKey, Authorization: req.headers.authorization, "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const items = JSON.parse(await response.text());
    return Array.isArray(items?.sections) ? items : null;
  } catch {
    return null;
  }
}

// 로트 상세 화면(batch-detail.js)이 읽는 것과 같은 열. 사람 이름은 근거 표에 쓰지 않아 읽지 않는다
const MEASURE = "id,value,result,measured_at,action_request_id,quality_issue_id,process_record_id,specification_id,applied_min_value,applied_max_value,applied_alert_min_value,applied_alert_max_value,applied_spec_version,specification:specification_id(item_name,unit,category,min_value,max_value)";
const SPEC = "id,category,item_name,unit,min_value,max_value,alert_min_value,alert_max_value,version,process_step_id";
const SAMPLE = "id,from_team,to_team,quantity,status,returned_quantity,disposed_quantity";

/**
 * 로트 하나와 출하 판단 근거에 드는 자료. 로트가 없거나(그 사람에게 안 보임) 핵심 자료를 못 읽으면 null.
 * 공정 기록·검체는 화면처럼 못 읽으면 그 칸만 null("확인하지 못했습니다")
 */
export async function readLotBundle(req, batchId, { supabaseUrl = SUPABASE_URL, anonKey = SUPABASE_PUBLISHABLE_KEY, fetchImpl = fetch } = {}) {
  async function rest(table, params) {
    const url = new URL(`/rest/v1/${table}`, supabaseUrl);
    url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, { headers: { apikey: anonKey, Authorization: req.headers.authorization }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error("rest");
    const rows = JSON.parse(await response.text());
    if (!Array.isArray(rows)) throw new Error("rest");
    return rows;
  }
  try {
    const [batch] = await rest("batch", { id: `eq.${batchId}`, select: "id,batch_number,status,product_id" });
    if (!batch) return null;
    const lot = `eq.${batch.id}`;
    const [measurements, issues, testSpecs, workOrders, steps, runs, processRecords, transfers] = await Promise.all([
      rest("measurement", { batch_id: lot, select: MEASURE, order: "measured_at.desc" }),
      rest("quality_issue", { batch_id: lot, select: "id,source,kind,status,opened_at,process_record_id", order: "opened_at.desc" }),
      rest("specification", { product_id: `eq.${batch.product_id}`, category: "eq.test", select: SPEC, order: "item_name" }),
      rest("work_order", { batch_id: lot, select: "id,status" }),
      rest("process_step", { product_id: `eq.${batch.product_id}`, select: "id,product_id,step_order,name,retired_at", order: "step_order" }),
      rest("step_run", { batch_id: lot, select: "id,batch_id,process_step_id,status", order: "started_at" }),
      rest("process_record", { batch_id: lot, select: "id" }).catch(() => null),
      rest("sample_transfer", { batch_id: lot, select: SAMPLE }).catch(() => null),
    ]);
    const issueIds = issues.map((issue) => issue.id);
    const [requests, reviews] = issueIds.length ? await Promise.all([
      rest("action_request", { quality_issue_id: `in.(${issueIds.join(",")})`, select: "id,status,quality_issue_id" }),
      rest("deviation_review", { quality_issue_id: `in.(${issueIds.join(",")})`, select: "id,quality_issue_id,status" }),
    ]) : [[], []];
    return { batch, measurements, issues, testSpecs, workOrder: workOrders[0] ?? null, steps, runs, processRecords, transfers, requests, reviews };
  } catch {
    return null;
  }
}

/** 화면 종류별 근거 표 읽기. 시험에서는 읽기 함수를 바꿔 끼운다 */
export function makeScreenReader({ homeItems = readHomeItems, lotBundle = readLotBundle } = {}) {
  return async function readScreen(req, screen, asOf) {
    if (screen?.kind === "home") return homeScreenFacts(await homeItems(req), asOf);
    if (screen?.kind === "lot") return lotScreenFacts(await lotBundle(req, screen.batchId), asOf);
    return null;
  };
}
