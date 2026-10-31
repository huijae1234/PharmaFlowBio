// 기능 003: 제품 등록·취급점검·되돌리기·사용 기록. 연결과 오류 처리는 store.js와 같다
import { call, client, read } from "./store.js";
import { usageEntry } from "../domain/usage-rules.js";

/** FR-001: 허가정보에서 고른 제품 등록 (QA 관리자) */
export async function createProduct({ itemName, mainIngredient, manufacturer, permitItemCode }) {
  return call("create_product", {
    p_item_name: itemName, p_main_ingredient: mainIngredient, p_manufacturer: manufacturer, p_permit_item_code: permitItemCode,
  });
}

/**
 * FR-008: 사용 기록 한 줄 (RLS "본인 기록만 추가"). 남기지 못해도 화면 동작은 막지 않는다 (수용 기준 5)
 * @param {string | null} userId
 * @param {string} type
 * @param {object} [detail]
 */
export async function logUsage(userId, type, detail) {
  const row = usageEntry(userId, type, detail);
  if (!row) return;
  try {
    const { error } = await client.from("usage_log").insert(row);
    if (error) console.warn("사용 기록을 남기지 못했습니다:", error.message);
  } catch (failure) {
    console.warn("사용 기록을 남기지 못했습니다:", failure.message);
  }
}

export const USAGE_PAGE_SIZE = 50;

/**
 * FR-009: 사용 기록 최근순 50개씩 (RLS: QA 관리자만 읽음). 한 줄을 더 받아 다음 쪽이 있는지 안다
 * @param {{ userId?: string, type?: string, page?: number }} filter
 */
/** @param {{ userId?: string, types: string[], page?: number }} filters */
export async function listUsage({ userId, types, page = 0 }) {
  const start = page * USAGE_PAGE_SIZE;
  let query = client
    .from("usage_log")
    .select("id, event_type, path, search_term, api_name, success, duration_ms, created_at, user:user_id (display_name)")
    .order("created_at", { ascending: false })
    .range(start, start + USAGE_PAGE_SIZE);
  if (userId) query = query.eq("user_id", userId);
  query = query.in("event_type", types);
  const rows = await read(query);
  return { rows: rows.slice(0, USAGE_PAGE_SIZE), hasMore: rows.length > USAGE_PAGE_SIZE };
}

