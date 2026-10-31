// 아침 브리핑이 쓰는 DB 함수 네 개 (spec 026, 마이그레이션 0036). `_`로 시작해 Vercel이 함수로 만들지 않는다.
// 새벽에는 로그인한 사람이 없어 Supabase 관리자 키(service role)로 부른다. 관리자 키는 RLS를 건너뛰므로 표는 직접 읽지 않고,
// 역할 범위를 거르는 DB 함수만 부른다. 키는 이 파일에서만 쓰고 오류 문구·응답에 넣지 않는다.
import { SUPABASE_URL } from "../src/config.js";

const TIMEOUT_MS = 10000;

/** @param {{ key: string, url?: string, fetchImpl?: typeof fetch }} options */
export function serviceData({ key, url = SUPABASE_URL, fetchImpl = fetch }) {
  async function rpc(name, args) {
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, url), {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`데이터베이스 함수 ${name} 실패(${response.status})`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    recipients: () => rpc("morning_briefing_recipients", {}),
    items: (id) => rpc("morning_briefing_items", { p_user: id }),
    alreadySent: (id, day) => rpc("morning_briefing_already_sent", { p_user: id, p_day: day }),
    record: (id, day, status) => rpc("record_morning_briefing", { p_user: id, p_day: day, p_status: status }),
  };
}
