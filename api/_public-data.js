// 공공데이터 대신 호출 공통 부분 (ADR 0001, spec 003 FR-004). `_`로 시작해 Vercel이 함수로 만들지 않는다.
// 인증키는 환경변수에서만 읽고, 응답·오류 문구·로그 어디에도 넣지 않는다 (SC-003).
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../src/config.js";
import { fixtureFetch, fixtureModeOn } from "./_fixture-mode.js";

// Q14: 15초가 넘으면 실패로 본다 (2026-10-22 측정 0.5~15초 넘음)
const TIMEOUT_MS = 15000;
const SERVICE_ERROR = "공공데이터가 오류를 돌려주었습니다.";

/**
 * 공공데이터포털은 Encoding 키(%가 들어 있음)와 Decoding 키를 둘 다 준다.
 * 주소를 만들 때 다시 인코딩하므로 Encoding 키는 한 번 풀어 둔다. 두 번 인코딩하면 "등록되지 않은 서비스키"가 된다.
 * @param {string | undefined} raw
 */
export function normalizeServiceKey(raw) {
  const key = raw?.trim();
  if (!key) return null;
  return key.includes("%") ? decodeURIComponent(key) : key;
}

// 허가정보는 items: [...], 회수는 items: [{ item: {...} }] 모양이다. 0건이면 items가 ""로 온다
function flattenItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((entry) => (entry && typeof entry === "object" && entry.item ? entry.item : entry));
}

/**
 * @param {{ endpoint: string, params: Record<string, string>, rawKey: string | undefined, fetchImpl?: typeof fetch, keyParam?: string }} options
 * keyParam: 인증키 요청변수 이름. 국가출하승인 문서만 "ServiceKey"라 적혀 있다 (spec 021)
 * @returns {Promise<{ ok: true, totalCount: number, items: object[] } | { ok: false, reason: string }>}
 */
export async function fetchPublicData({ endpoint, params, rawKey, fetchImpl = fetch, keyParam = "serviceKey" }) {
  // spec 019 FR-002: 시험 모드면 실제 키도 실제 사이트도 쓰지 않는다
  if (fixtureModeOn()) {
    fetchImpl = fixtureFetch;
    rawKey = "fixture";
  }
  const serviceKey = normalizeServiceKey(rawKey);
  if (!serviceKey) return { ok: false, reason: "인증키 없음" };
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ [keyParam]: serviceKey, ...params }).toString();
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: SERVICE_ERROR }; // 오류일 때는 XML이 온다. 본문은 밖으로 내보내지 않는다
    }
    if (!response.ok || data?.header?.resultCode !== "00") return { ok: false, reason: SERVICE_ERROR };
    return { ok: true, totalCount: Number(data.body?.totalCount ?? 0), items: flattenItems(data.body?.items) };
  } catch (error) {
    return { ok: false, reason: error?.name === "TimeoutError" ? "시간 초과" : "연결 실패" };
  }
}

/**
 * 로그인한 사람의 요청만 받는다 (plan 003 §1: 우리 키의 하루 한도 보호). 확인되면 사용자 id, 아니면 null
 * @param {{ headers: Record<string, string | undefined> }} req
 */
export async function verifyUser(req, { supabaseUrl = SUPABASE_URL, anonKey = SUPABASE_PUBLISHABLE_KEY, fetchImpl = fetch } = {}) {
  const header = req.headers?.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const response = await fetchImpl(new URL("/auth/v1/user", supabaseUrl), {
      headers: { apikey: anonKey, Authorization: header },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return JSON.parse(await response.text())?.id ?? null;
  } catch {
    return null;
  }
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store"); // 결과를 저장해 두지 않는다 (PRD §9)
  res.end(JSON.stringify(body));
}

/**
 * 함수 틀: 로그인 확인 → load(검색 조건) → 걸린 시간과 함께 응답.
 * load가 { status, body }를 돌려주면 그대로(검색어 검사 실패 등), 공공데이터 실패면 502
 * @param {{ verify?: typeof verifyUser, load: (query: URLSearchParams) => Promise<object> }} options
 */
export function createPublicHandler({ verify = verifyUser, load }) {
  return async function handler(req, res) {
    const userId = await verify(req);
    if (!userId) return sendJson(res, 401, { ok: false, reason: "로그인 필요" });
    const query = new URL(req.url, "http://local").searchParams;
    const started = Date.now();
    const result = await load(query);
    if (result.status) return sendJson(res, result.status, result.body);
    const fixture = fixtureModeOn() ? { fixture: true } : {}; // spec 019 FR-003: 화면이 "시험 자료"를 표시
    sendJson(res, result.ok ? 200 : 502, { ...result, ...fixture, ms: Date.now() - started });
  };
}
