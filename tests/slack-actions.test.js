import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySlackSignature, parseAckAction, kstLabel, ackedBlocks } from "../api/_slack-actions.js";
import { createSlackActionsHandler } from "../api/slack-actions.js";
import { slackAckText } from "../src/domain/inbox-rules.js";

const SECRET = "가짜-서명-비밀값"; // 시험용 가짜 값
const SERVICE_KEY = "가짜-service-키"; // 시험용 가짜 값
const NOW = 1793000000; // 초

function sign(body, timestamp = NOW, secret = SECRET) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

const MESSAGE_BLOCKS = [
  { type: "section", text: { type: "mrkdwn", text: "검체 인수 확인이 필요합니다 · IFV-2610-003" } },
  { type: "context", elements: [{ type: "mrkdwn", text: "업무 처리는 앱에서 합니다." }] },
  { type: "actions", elements: [{ type: "button", action_id: "ack", value: "n1" }] },
];

function ackBody({ value = "n1", user = "U1", actionId = "ack" } = {}) {
  const payload = {
    type: "block_actions",
    user: { id: user },
    response_url: "https://hooks.slack.com/actions/T/1/abc",
    message: { blocks: MESSAGE_BLOCKS },
    actions: [{ action_id: actionId, value }],
  };
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

test("서명: 맞는 서명만 통과, 틀린 서명·5분 넘은 시각·머리글 없음은 거절 (spec 009 FR-008 수용 기준 6)", () => {
  const body = ackBody();
  const ok = { secret: SECRET, timestamp: String(NOW), body, signature: sign(body), nowSeconds: NOW };
  assert.equal(verifySlackSignature(ok), true);
  assert.equal(verifySlackSignature({ ...ok, signature: sign(body, NOW, "다른-비밀값") }), false);
  assert.equal(verifySlackSignature({ ...ok, body: body + "x" }), false);
  assert.equal(verifySlackSignature({ ...ok, nowSeconds: NOW + 301 }), false);
  assert.equal(verifySlackSignature({ ...ok, timestamp: String(NOW - 301), signature: sign(body, NOW - 301) }), false);
  assert.equal(verifySlackSignature({ ...ok, signature: undefined }), false);
  assert.equal(verifySlackSignature({ ...ok, secret: "" }), false);
});

test("요청 풀기: [확인] 버튼이면 알림 id·누른 사람·답할 주소, 다른 것은 null (FR-008)", () => {
  assert.deepEqual(parseAckAction(ackBody()), {
    notificationId: "n1", slackUser: "U1", responseUrl: "https://hooks.slack.com/actions/T/1/abc", blocks: MESSAGE_BLOCKS,
  });
  assert.equal(parseAckAction(ackBody({ actionId: "other" })), null);
  assert.equal(parseAckAction("payload=%7Bbroken"), null);
  assert.equal(parseAckAction(""), null);
});

test("확인 뒤 메시지: 본문은 그대로, 버튼 자리에 '✅ 확인함 · 한국 시각' (FR-008 수용 기준 2)", () => {
  assert.equal(kstLabel("2026-10-27T05:05:00Z"), "10-27 14:05");
  assert.deepEqual(ackedBlocks(MESSAGE_BLOCKS, "2026-10-27T05:05:00Z"), [
    MESSAGE_BLOCKS[0], MESSAGE_BLOCKS[1],
    { type: "context", elements: [{ type: "mrkdwn", text: "✅ 확인함 · 10-27 14:05" }] },
  ]);
});

test("앱 글자: 슬랙에서 확인한 시각이 있으면 '슬랙에서 확인함 · 시각', 없으면 빈 글자 (FR-008 수용 기준 3·4)", () => {
  const format = (iso) => `F(${iso})`;
  assert.equal(slackAckText("2026-10-27T05:05:00Z", format), "슬랙에서 확인함 · F(2026-10-27T05:05:00Z)");
  assert.equal(slackAckText(null, format), "");
});

function fakeReq(body, headers = {}) {
  return { method: "POST", headers, rawBody: body };
}
function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(text = "") { this.body = text; },
  };
}

function setup(dbResult) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("/rpc/acknowledge_notification")) {
      if (dbResult instanceof Error) throw dbResult;
      return { ok: true, status: 200, text: async () => JSON.stringify(dbResult) };
    }
    return { ok: true, status: 200, text: async () => "ok" };
  };
  const handler = createSlackActionsHandler({
    env: { SLACK_SIGNING_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY },
    fetchImpl, readBody: async (req) => req.rawBody, nowSeconds: () => NOW,
  });
  return { calls, handler };
}

function signedReq(body) {
  return fakeReq(body, { "x-slack-request-timestamp": String(NOW), "x-slack-signature": sign(body) });
}

test("받는 곳: 서명이 틀리면 401, 데이터베이스를 부르지 않는다 (FR-008 수용 기준 6)", async () => {
  const { calls, handler } = setup({ status: "acknowledged", acknowledged_at: "2026-10-27T05:05:00Z" });
  const res = fakeRes();
  await handler(fakeReq(ackBody(), { "x-slack-request-timestamp": String(NOW), "x-slack-signature": "v0=00" }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
  const getRes = fakeRes();
  await handler({ method: "GET", headers: {} }, getRes);
  assert.equal(getRes.statusCode, 405);
});

test("받는 곳: 받는 사람이 누르면 기록하고 원래 메시지를 '확인함'으로 바꾼다 (FR-008 수용 기준 2)", async () => {
  const { calls, handler } = setup({ status: "acknowledged", acknowledged_at: "2026-10-27T05:05:00Z" });
  const res = fakeRes();
  await handler(signedReq(ackBody()), res);
  assert.equal(res.statusCode, 200);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/acknowledge_notification$/);
  assert.deepEqual(calls[0].body, { p_id: "n1", p_slack_user: "U1" });
  assert.equal(calls[0].init.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].init.headers.Authorization, undefined, "secret 키는 Authorization에 넣지 않는다");
  assert.equal(calls[1].url, "https://hooks.slack.com/actions/T/1/abc");
  assert.equal(calls[1].body.replace_original, true);
  assert.equal(calls[1].body.blocks.at(-1).elements[0].text, "✅ 확인함 · 10-27 14:05");
  assert.ok(!JSON.stringify(calls[1].body).includes(SERVICE_KEY));
  assert.ok(!res.body.includes(SERVICE_KEY) && !res.body.includes(SECRET));
});

test("받는 곳: 받는 사람이 아니면 누른 사람에게만 안내, 메시지는 그대로 (경계 상황)", async () => {
  const { calls, handler } = setup({ status: "not_recipient" });
  await handler(signedReq(ackBody({ user: "U9" })), fakeRes());
  assert.deepEqual(calls[1].body, { response_type: "ephemeral", replace_original: false, text: "받는 사람만 확인할 수 있습니다." });
});

test("받는 곳: 기록 실패면 누른 사람에게만 실패 안내 (경계 상황)", async () => {
  const { calls, handler } = setup(new Error("연결 실패"));
  const res = fakeRes();
  await handler(signedReq(ackBody()), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1).body, {
    response_type: "ephemeral", replace_original: false, text: "확인을 기록하지 못했습니다. 앱에서 알림을 열어 주세요.",
  });
});

test("받는 곳: 설정(서명 비밀값) 없으면 거절 (FR-008 수용 기준 6)", async () => {
  const handler = createSlackActionsHandler({ env: {}, fetchImpl: async () => { throw new Error("부르면 안 됨"); },
    readBody: async (req) => req.rawBody, nowSeconds: () => NOW });
  const res = fakeRes();
  await handler(signedReq(ackBody()), res);
  assert.equal(res.statusCode, 401);
});
