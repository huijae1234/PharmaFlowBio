// 슬랙 보내기 (spec 009 FR-002~004, ADR 0003). `_`로 시작해 Vercel이 함수로 만들지 않는다.
// 봇 토큰은 환경변수에서만 받고, 결과·오류 문구·로그 어디에도 넣지 않는다 (plan 009 §5 보안).

const SLACK_API = "https://slack.com/api/";
const TIMEOUT_MS = 15000; // spec 009 경계 상황: 15초가 넘으면 보내지 못함

/**
 * FR-001 수용 기준 4: 내용 뒤에 앱 화면 링크 (슬랙 링크 문법 <주소|글자>)
 * @param {{ body: string, path: string }} note
 * @param {string} origin 앱 주소 (https://…)
 */
export function slackText(note, origin) {
  return `${note.body}\n<${origin}/${note.path}|앱에서 열기>`;
}

class SlackError extends Error {}

async function slackCall(method, params, { token, fetchImpl }) {
  const response = await fetchImpl(SLACK_API + method, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({ ok: false, error: "bad_response" }));
  return data;
}

function failure(error) {
  if (error instanceof SlackError) return { status: "failed", reason: error.message };
  return { status: "failed", reason: error?.name === "TimeoutError" ? "시간 초과" : "연결 실패" };
}

// v0.6 FR-008: 개인 메시지에만 [확인] 버튼. 확인은 "봤다"는 뜻이고 업무 처리는 앱에서 한다 (Q65)
function ackBlocks(text, notificationId) {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "context", elements: [{ type: "mrkdwn", text: "업무 처리는 앱에서 합니다. [확인]은 알림을 봤다는 표시입니다." }] },
    { type: "actions", elements: [
      { type: "button", action_id: "ack", value: notificationId, style: "primary", text: { type: "plain_text", text: "확인" } },
    ] },
  ];
}

async function post(channel, text, options, blocks = null) {
  const params = { channel, text, unfurl_links: "false" };
  if (blocks) params.blocks = JSON.stringify(blocks);
  const sent = await slackCall("chat.postMessage", params, options);
  if (!sent.ok) throw new SlackError(`슬랙 오류(${sent.error})`);
}

/**
 * 알림 한 건 보내기: 이메일로 사람을 찾아 개인 메시지, 못 찾으면 알림 채널 (FR-002, FR-003)
 * @param {{ notification_id?: string, recipient_name: string, recipient_email: string | null, body: string, path: string }} note
 * @param {{ token?: string, channel?: string, origin: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ status: "sent" | "sent_channel" | "failed", reason: string | null, slackUser?: string }>}
 */
export async function deliver(note, { token, channel, origin, fetchImpl = fetch }) {
  if (!token) return { status: "failed", reason: "슬랙 설정 없음" };
  const options = { token, fetchImpl };
  const text = slackText(note, origin);
  try {
    const found = note.recipient_email
      ? await slackCall("users.lookupByEmail", { email: note.recipient_email }, options)
      : { ok: false, error: "users_not_found" };
    if (found.ok) {
      await post(found.user.id, text, options, note.notification_id ? ackBlocks(text, note.notification_id) : null);
      return { status: "sent", reason: null, slackUser: found.user.id };
    }
    if (found.error !== "users_not_found") throw new SlackError(`슬랙 오류(${found.error})`);
    // Q52: 슬랙 이메일이 다르면 채널로. 채널도 없으면 보내지 못함 (Q49)
    if (!channel) return { status: "failed", reason: "슬랙 계정을 찾지 못함" };
    await post(channel, `${note.recipient_name} 님(슬랙 계정을 찾지 못함) · ${text}`, options);
    return { status: "sent_channel", reason: "슬랙 계정을 찾지 못함" };
  } catch (error) {
    return failure(error);
  }
}
