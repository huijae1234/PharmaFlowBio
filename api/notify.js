// 슬랙 알림 보내기 (spec 009 FR-002~004, ADR 0003). 화면이 저장에 성공한 뒤 기다리지 않고 부른다.
// 로그인한 사람의 토큰으로 데이터베이스 함수를 불러, 그 사람이 일으킨 대기 알림만 가져가고 결과를 적는다.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../src/config.js";
import { sendJson, verifyUser } from "./_public-data.js";
import { deliver } from "./_slack.js";

function appOrigin(req, env) {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, "");
  const host = req.headers?.host ?? "localhost";
  const proto = req.headers?.["x-forwarded-proto"] ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * @param {{ verify?: typeof verifyUser, fetchImpl?: typeof fetch, env?: Record<string, string | undefined> }} [options]
 */
export function createNotifyHandler({ verify = verifyUser, fetchImpl = fetch, env = process.env } = {}) {
  async function rpc(name, auth, args = {}) {
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, SUPABASE_URL), {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`데이터베이스 함수 ${name} 실패`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return async function handler(req, res) {
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, reason: "POST만 받습니다" });
    if (!(await verify(req))) return sendJson(res, 401, { ok: false, reason: "로그인 필요" });
    const auth = req.headers.authorization;
    const counts = { claimed: 0, sent: 0, failed: 0 };
    try {
      const notes = (await rpc("claim_my_notifications", auth)) ?? [];
      counts.claimed = notes.length;
      const origin = appOrigin(req, env);
      for (const note of notes) {
        const result = await deliver(note, { token: env.SLACK_BOT_TOKEN, channel: env.SLACK_FALLBACK_CHANNEL, origin, fetchImpl });
        await rpc("finish_notification", auth, { p_id: note.notification_id, p_status: result.status, p_reason: result.reason, p_slack_user: result.slackUser ?? null });
        counts[result.status === "failed" ? "failed" : "sent"] += 1;
      }
    } catch (error) {
      // FR-004: 알림이 안 돼도 업무는 그대로. 결과를 못 적은 알림은 10분 뒤 다음 호출이 다시 가져간다
      console.error("api/notify:", error.message);
    }
    return sendJson(res, 200, { ok: true, ...counts });
  };
}

export default createNotifyHandler();
