// Supabase를 부르는 곳은 이 파일 하나다 (CLAUDE.md 스택, plan 001 §2).
// 쓰기는 데이터베이스 함수(rpc)로만 한다. 표에 직접 쓰는 권한은 없다 (supabase/migrations/0003_rls.sql).
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

// index.html에서 CDN으로 불러온 supabase-js (2.117.3)
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  // 해시 주소(#/...)와 섞이지 않게 로그인 결과를 ?code= 로 받는다
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
});

const NETWORK_ERROR = "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 저장해 주세요."; // FR-014 (spec 001)
const LOAD_ERROR = "불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";

/** 데이터베이스 함수가 보낸 한국어 문구는 그대로, 연결 오류는 할 일을 알려 주는 문구로 바꾼다 */
function toKoreanError(error, fallback) {
  const message = error?.message ?? "";
  if (/[가-힣]/.test(message)) return new Error(message);
  if (error?.code === "42501") return new Error("이 작업을 할 권한이 없습니다. 역할을 확인해 주세요.");
  return new Error(fallback);
}

async function read(query) {
  const { data, error } = await query;
  if (error) throw toKoreanError(error, LOAD_ERROR);
  return data;
}

// spec 009 FR-001: 알림을 만들 수 있는 저장. 성공하면 슬랙 보내기를 부른다(기다리지 않음)
const NOTIFYING_FUNCTIONS = new Set([
  "send_sample", "return_sample",
  "submit_action_request", "resubmit_action_request", "approve_action_request", "reject_action_request", "complete_action_request",
  "submit_deviation_review", "resubmit_deviation_review", "review_deviation_review",
  "record_test_measurement", "record_test_measurements", "record_process_conditions", "ship_batch",
  "release_work_order", // spec 010 FR-009
  "complete_step", // spec 011 FR-005·006 (규격 이탈·생산 완료 알림)
]);

async function call(functionName, args) {
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw toKoreanError(error, NETWORK_ERROR);
  if (NOTIFYING_FUNCTIONS.has(functionName)) {
    import("./store-notifications.js").then(({ flushNotifications }) => flushNotifications());
  }
  return data;
}

// ── 로그인 (FR-001) ─────────────────────────────────────────────

export async function getSession() {
  const { data, error } = await client.auth.getSession();
  if (error) throw toKoreanError(error, LOAD_ERROR);
  return data.session;
}

// 포트폴리오 사본은 구글 클라우드 2단계 인증 제한 때문에 GitHub 로그인을 쓴다 (원본은 구글)
export async function signInWithGitHub() {
  const { error } = await client.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: `${location.origin}/` },
  });
  if (error) throw new Error("로그인하지 못했습니다. 다시 시도해 주세요.");
}

// 게스트(익명) 로그인: 열람자 읽기 전용. 포트폴리오 사본에서 계정 없이 둘러보게 한다 (0039)
export async function signInAsGuest() {
  const { error } = await client.auth.signInAnonymously();
  if (error) throw new Error("게스트로 들어가지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
}

export async function signOut() {
  const { data } = await client.auth.getSession();
  // 게스트는 로그아웃할 때 본인 계정을 지운다. 실패해도 로그아웃은 막지 않는다(밤마다 정리)
  if (data.session?.user?.is_anonymous) await client.rpc("delete_guest");
  await client.auth.signOut();
}

/** @param {(event: string) => void} listener */
export function onAuthChange(listener) {
  client.auth.onAuthStateChange((event) => listener(event));
}

// ── 사용자와 역할 (FR-003, FR-004) ──────────────────────────────

/** 이메일은 읽을 수 없으므로(0003_rls) 이름·역할만 */
export async function loadMyProfile(userId) {
  return read(client.from("profile").select("id, display_name, role").eq("id", userId).maybeSingle());
}

export async function listUsers() {
  return call("list_users", {});
}

export async function setUserRole(userId, role) {
  return call("set_user_role", { p_user_id: userId, p_role: role });
}

// ── 배치 (첫 화면용 읽기. 등록·상세는 5단계) ────────────────────

/** @param {{ statuses?: string[], limit?: number }} [options] */
export async function listBatches({ statuses, productId, limit = 50, oldestFirst = false } = {}) {
  let query = client
    .from("batch")
    .select("id, batch_number, status, hold_reason, created_at, product_id, product:product_id (item_name)")
    .order("created_at", { ascending: oldestFirst }) // 오래된 순은 서버에서 정렬 (limit 안에서 뒤집으면 진짜 오래된 것이 빠진다)
    .limit(limit);
  if (statuses?.length) query = query.in("status", statuses);
  if (productId) query = query.eq("product_id", productId); // spec 018 FR-001
  return read(query);
}

/** 한 제품의 로트번호들 (제품 화면의 "로트 이니셜" 정리용, 읽기만) */
export async function listProductLotNumbers(productId) {
  return read(client.from("batch").select("id, batch_number").eq("product_id", productId).order("created_at", { ascending: false }).limit(200));
}

/** 상태별 배치 수 (관리자 대시보드) */
export async function countBatchesByStatus() {
  const rows = await read(client.from("batch").select("status"));
  return rows.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {});
}

/** 최근 이탈 측정값(규격 이탈·관리기준 이탈, spec 004 FR-003). category: "test" | "process" */
export async function listRecentOutOfSpec(category, limit = 5) {
  return read(
    client
      .from("measurement")
      .select("id, value, result, measured_at, batch:batch_id (id, batch_number), specification:specification_id!inner (item_name, unit, category)")
      .in("result", ["out_of_spec", "out_of_alert"])
      .eq("specification.category", category)
      .order("measured_at", { ascending: false })
      .limit(limit),
  );
}

// ── 배치 상세·등록·시험값 (5단계, FR-008~010, FR-013) ─────────────

export async function listProducts() {
  return read(client.from("product").select("id, item_name").order("item_name"));
}

/** FR-008 배치 등록 (생산 담당자·QA 관리자, 함수 안에서 역할 확인) */
export async function createBatch(batchNumber, productId) {
  return call("create_batch", { p_batch_number: batchNumber, p_product_id: productId });
}

const BATCH_COLUMNS = "id, batch_number, status, hold_reason, created_at, product_id, product:product_id (item_name), shipped_at, ship_note, shipper:shipped_by (display_name)";

export async function getBatch(batchId) {
  const find = (columns) => read(client.from("batch").select(columns).eq("id", batchId).maybeSingle());
  // release_reason은 0035 적용 뒤에만 있는 열이다. 아직 없으면(읽기 오류) 이 열 없이 읽어 화면이 깨지지 않게 한다
  try {
    return await find(`${BATCH_COLUMNS}, release_reason`);
  } catch {
    return find(BATCH_COLUMNS);
  }
}

/** 이 배치 제품의 기준값. category: "test" | "process" */
export async function listSpecifications(productId, category) {
  return read(
    client
      .from("specification")
      .select("id, category, item_name, unit, min_value, max_value, alert_min_value, alert_max_value, version, process_step_id")
      .eq("product_id", productId)
      .eq("category", category)
      .order("item_name"),
  );
}

export async function listMeasurements(batchId) {
  return read(
    client
      .from("measurement")
      .select("id, value, result, measured_at, action_request_id, quality_issue_id, process_record_id, specification_id, applied_min_value, applied_max_value, applied_alert_min_value, applied_alert_max_value, applied_spec_version, specification:specification_id (item_name, unit, category, min_value, max_value), measurer:measured_by (display_name)")
      .eq("batch_id", batchId)
      .order("measured_at", { ascending: false }),
  );
}

export async function listProcessRecords(batchId) {
  return read(
    client
      .from("process_record")
      .select("id, production_quantity, equipment_status, recorded_at, step_run_id, recorder:recorded_by (display_name)")
      .eq("batch_id", batchId)
      .order("recorded_at", { ascending: false }),
  );
}

export async function listQualityIssues(batchId) {
  return read(
    client
      .from("quality_issue")
      .select("id, source, kind, status, opened_at, process_record_id")
      .eq("batch_id", batchId)
      .order("opened_at", { ascending: false }),
  );
}

/** FR-013 배치 상세의 업무 이력 탭 */
export async function listBatchHistory(batchId) {
  return read(
    client
      .from("work_history")
      .select("id, actor_name, actor_role, action, target_table, created_at")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false })
      .limit(50),
  );
}

/**
 * spec 017 FR-004: 여러 시험값을 한 번에. 판정·품질 이슈·보류가 데이터베이스 함수 하나 안에서 저장되고, 하나라도 실패하면 모두 되돌린다
 * @param {string} batchId
 * @param {{ specification_id: string, value: number }[]} values
 * @returns {Promise<{ specification_id: string, result: string, quality_issue_id: string | null, batch_status: string }[]>}
 */
export async function recordTestMeasurements(batchId, values) {
  return call("record_test_measurements", { p_batch_id: batchId, p_values: values });
}

// ── 공정 조건·직접 보류·제품·기준값 (6단계, FR-007, FR-011, FR-012) ──

/**
 * FR-011: 공정 기록 + 판정 + (이탈·설비 이상이면) 품질 이슈 1개 + 보류를 한꺼번에
 * @param {{ batchId: string, productionQuantity: number | null, equipmentStatus: "normal" | "abnormal", values: { specification_id: string, value: number }[] }} input
 */
export async function recordProcessConditions({ batchId, productionQuantity, equipmentStatus, values }) {
  return call("record_process_conditions", {
    p_batch_id: batchId,
    p_production_quantity: productionQuantity,
    p_equipment_status: equipmentStatus,
    p_values: values,
  });
}

/** FR-012: 사유를 적어 직접 보류 */
export async function holdBatch(batchId, reason) {
  return call("hold_batch", { p_batch_id: batchId, p_reason: reason });
}

export async function listProductsWithInfo() {
  return read(client.from("product").select("id, item_name, main_ingredient, manufacturer").order("item_name"));
}

export async function getProduct(productId) {
  return read(
    client.from("product").select("id, item_name, main_ingredient, manufacturer, permit_item_code").eq("id", productId).maybeSingle(),
  );
}

/** 제품의 모든 기준값 (시험·공정) */
export async function listAllSpecifications(productId) {
  return read(
    client
      .from("specification")
      .select("id, category, item_name, unit, min_value, max_value, alert_min_value, alert_max_value, version, process_step_id")
      .eq("product_id", productId)
      .order("category")
      .order("item_name"),
  );
}

/**
 * FR-007: 기준값 등록(id 없음)·수정 (QA 관리자만, 함수 안에서 확인). 관리기준은 비우면 없음 (spec 004 FR-001)
 * @param {{ id: string | null, productId: string, category: "test" | "process", itemName: string, unit: string, min: number, max: number, alertMin?: number | null, alertMax?: number | null }} spec
 */
export async function saveSpecification({ id, productId, category, itemName, unit, min, max, alertMin = null, alertMax = null }) {
  return call("save_specification", {
    p_id: id, p_product_id: productId, p_category: category,
    p_item_name: itemName, p_unit: unit, p_min: min, p_max: max,
    p_alert_min: alertMin, p_alert_max: alertMax,
  });
}

// 같은 연결·오류 처리를 쓰는 store-actions.js(기능 002)용
export { client, read, call };

/**
 * UI 개편: 같은 제품 로트들의 측정값 (로트 비교·기준 수정 영향 미리보기용). 최근 300건.
 * 읽기만 하며 새 자료를 만들지 않는다
 * @param {string} productId
 */
export async function listProductMeasurements(productId) {
  return read(
    client
      .from("measurement")
      .select("id, value, result, measured_at, batch_id, specification_id, batch:batch_id (id, batch_number, status), specification:specification_id!inner (item_name, unit, category, product_id, min_value, max_value, alert_min_value, alert_max_value)")
      .eq("specification.product_id", productId)
      .order("measured_at", { ascending: false })
      .limit(300),
  );
}
