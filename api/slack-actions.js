// 슬랙 [확인] 버튼을 받는 곳 (spec 009 v0.6 FR-008). 로그인 대신 슬랙 서명으로 확인한다.
// 기록은 service 키로 acknowledge_notification 하나만 부른다. 그 함수는 알림의 확인 시각·읽은 시각만 바꾼다.
// 기록 → 슬랙에 답하기 → 200 순서로 한다(Vercel이 응답 뒤 남은 일을 끊을 수 있어서, plan 009 7단계 위험).
import { SUPABASE_URL } from "../src/config.js";
import { sendJson } from "./_public-data.js";
import { ackedBlocks, parseAckAction, verifySlackSignature } from "./_slack-actions.js";

const NOT_RECIPIENT = "받는 사람만 확인할 수 있습니다.";
const RECORD_FAILED = "확인을 기록하지 못했습니다. 앱에서 알림을 열어 주세요.";

/**
 * 서명은 원문 기준이라 요청 몸통을 그대로 읽는다. Vercel의 req.body(자동 풀기)는 건드리지 않는다 — 건드리면 원문을 잃는다
 * @param {import("node:http").IncomingMessage} req
 */
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, readBody?: typeof readRawBody, nowSeconds?: () => number }} [options]
 */
export function createSlackActionsHandler({
  env = process.env, fetchImpl = fetch, readBody = readRawBody, nowSeconds = () => Math.floor(Date.now() / 1000),
} = {}) {
  async function acknowledge(action) {
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error("service 키 없음");
    const response = await fetchImpl(new URL("/rest/v1/rpc/acknowledge_notification", SUPABASE_URL), {
      method: "POST",
      // 새 secret 키(sb_secret_…)는 JWT가 아니라 apikey 머리글로만 보낸다 (Supabase 문서 "Migrating to publishable and secret API keys")
      headers: { apikey: serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_id: action.notificationId, p_slack_user: action.slackUser ?? null }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`acknowledge_notification ${response.status}`);
    return JSON.parse(await response.text());
  }

  async function reply(responseUrl, body) {
    await fetchImpl(responseUrl, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000),
    });
  }

  return async function handler(req, res) {
    if (req.method !== "POST") return sendJson(res, 405, { ok: false });
    const body = await readBody(req);
    const trusted = verifySlackSignature({
      secret: env.SLACK_SIGNING_SECRET,
      timestamp: req.headers["x-slack-request-timestamp"],
      signature: req.headers["x-slack-signature"],
      body,
      nowSeconds: nowSeconds(),
    });
    if (!trusted) return sendJson(res, 401, { ok: false });

    const action = parseAckAction(body);
    if (!action) return sendJson(res, 200, { ok: true }); // 다른 버튼·형식은 받기만 한다
    try {
      const result = await acknowledge(action);
      await reply(action.responseUrl, result?.status === "acknowledged"
        ? { replace_original: true, text: "확인함", blocks: ackedBlocks(action.blocks, result.acknowledged_at) }
        : { response_type: "ephemeral", replace_original: false, text: NOT_RECIPIENT });
    } catch (error) {
      console.error("api/slack-actions:", error.message);
      await reply(action.responseUrl, { response_type: "ephemeral", replace_original: false, text: RECORD_FAILED }).catch(() => {});
    }
    return sendJson(res, 200, { ok: true });
  };
}

// Vercel이 몸통을 미리 풀지 않게 한다 (Vercel 문서: 서명 확인 함수는 bodyParser: false)
export const config = { api: { bodyParser: false } };

export default createSlackActionsHandler();
