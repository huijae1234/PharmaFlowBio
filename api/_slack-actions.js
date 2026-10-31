// 슬랙 [확인] 버튼 받기의 순수 규칙 (spec 009 v0.6 FR-008). `_`로 시작해 Vercel이 함수로 만들지 않는다.
// 서명 비밀값은 인자로만 받고, 결과·로그 어디에도 넣지 않는다 (plan 009 §5 보안).
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 300; // FR-008 수용 기준 6: 5분 넘은 요청은 거절

/**
 * 슬랙이 보낸 요청인가: v0=HMAC-SHA256(비밀값, "v0:시각:원문")
 * @param {{ secret?: string, timestamp?: string, body: string, signature?: string, nowSeconds: number }} input
 */
export function verifySlackSignature({ secret, timestamp, body, signature, nowSeconds }) {
  if (!secret || !timestamp || !signature) return false;
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(nowSeconds - sent) > MAX_AGE_SECONDS) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * [확인] 버튼 요청에서 필요한 것만 꺼낸다. 다른 버튼·깨진 요청은 null
 * @param {string} body application/x-www-form-urlencoded 원문 (payload=JSON)
 */
export function parseAckAction(body) {
  try {
    const payload = JSON.parse(new URLSearchParams(body).get("payload") ?? "");
    const action = payload?.actions?.[0];
    if (payload?.type !== "block_actions" || action?.action_id !== "ack" || !action.value) return null;
    return {
      notificationId: action.value,
      slackUser: payload.user?.id,
      responseUrl: payload.response_url,
      blocks: payload.message?.blocks ?? [],
    };
  } catch {
    return null;
  }
}

/** "10-27 14:05" (한국 시각) @param {string} iso */
export function kstLabel(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * FR-008 수용 기준 2: 본문은 그대로 두고 버튼 줄을 "✅ 확인함 · 시각"으로 바꾼다
 * @param {object[]} blocks 원래 메시지의 blocks
 * @param {string} acknowledgedAt
 */
export function ackedBlocks(blocks, acknowledgedAt) {
  return [
    ...blocks.filter((block) => block.type !== "actions"),
    { type: "context", elements: [{ type: "mrkdwn", text: `✅ 확인함 · ${kstLabel(acknowledgedAt)}` }] },
  ];
}
