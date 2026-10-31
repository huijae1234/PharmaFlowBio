// 화면 → api/ 함수 호출 (spec 003 FR-004, ADR 0001). 인증키는 함수에만 있고, 여기서는 로그인 토큰만 붙인다.
// 공공데이터 실패는 오류로 던지지 않고 { ok:false }로 돌려준다: 그 칸만 실패 안내를 보이게 (UJ E4)
import { client } from "./store.js";
import { logUsage } from "./store-products.js";

/**
 * @param {"permit" | "recall" | "gmp" | "shipment"} name
 * @param {Record<string, string | number>} params
 * @returns {Promise<{ ok: true, items: object[], totalCount: number, ms: number } | { ok: false, reason: string, ms: number }>}
 */
export async function callPublicData(name, params) {
  const { data } = await client.auth.getSession().catch(() => ({ data: {} }));
  const session = data?.session;
  const result = await requestPublicData(name, params, session?.access_token);
  // FR-008 수용 기준 2·3: 호출마다 성공 여부와 걸린 시간 (UJ E4 검증 방법). 기다리지 않는다
  logUsage(session?.user?.id ?? null, "public_api_call", { apiName: name, success: result.ok, durationMs: result.ms });
  return result;
}

async function requestPublicData(name, params, token) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if (!token) return { ok: false, reason: "로그인 필요", ms: elapsed() };
  try {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
    const response = await fetch(`/api/${name}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({ ok: false, reason: "응답을 읽지 못함" }));
    return { ...body, ok: response.ok && body.ok === true, ms: elapsed() };
  } catch {
    return { ok: false, reason: "연결 실패", ms: elapsed() };
  }
}
