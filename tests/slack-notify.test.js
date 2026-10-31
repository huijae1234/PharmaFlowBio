import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver, slackText } from "../api/_slack.js";
import { createNotifyHandler } from "../api/notify.js";

const TOKEN = "xoxb-가짜-토큰"; // 시험용 가짜 값
const NOTE = { recipient_name: "윤○○", recipient_email: "qc@example.com", body: "검체 인수 확인이 필요합니다 · IFV-2610-003", path: "#/samples" };
const ORIGIN = "https://pharmaflow.example";

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body };
}

// 슬랙 가짜: 부른 순서를 남기고 메서드별 응답을 돌려준다
function fakeSlack(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const method = String(url).split("/").pop();
    calls.push({ method, init, body: new URLSearchParams(init.body) });
    const next = responses[method];
    if (next instanceof Error) throw next;
    return jsonResponse(next);
  };
  return { calls, fetchImpl };
}

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(text) { this.body = text; },
  };
}

test("슬랙 글: 내용 뒤에 앱 화면 링크 (spec 009 FR-001 수용 기준 4)", () => {
  assert.equal(slackText(NOTE, ORIGIN), "검체 인수 확인이 필요합니다 · IFV-2610-003\n<https://pharmaflow.example/#/samples|앱에서 열기>");
});

test("이메일로 찾으면 그 사람에게 개인 메시지 (FR-002)", async () => {
  const slack = fakeSlack({ "users.lookupByEmail": { ok: true, user: { id: "U1" } }, "chat.postMessage": { ok: true } });
  const result = await deliver(NOTE, { token: TOKEN, channel: "C9", origin: ORIGIN, fetchImpl: slack.fetchImpl });
  assert.deepEqual(result, { status: "sent", reason: null, slackUser: "U1" }); // v0.6: 받은 슬랙 사용자를 적는다
  assert.deepEqual(slack.calls.map((c) => c.method), ["users.lookupByEmail", "chat.postMessage"]);
  assert.equal(slack.calls[0].body.get("email"), "qc@example.com");
  assert.equal(slack.calls[1].body.get("channel"), "U1");
  assert.equal(slack.calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test("못 찾으면 알림 채널에 이름과 함께 (FR-003)", async () => {
  const slack = fakeSlack({ "users.lookupByEmail": { ok: false, error: "users_not_found" }, "chat.postMessage": { ok: true } });
  const result = await deliver(NOTE, { token: TOKEN, channel: "C9", origin: ORIGIN, fetchImpl: slack.fetchImpl });
  assert.deepEqual(result, { status: "sent_channel", reason: "슬랙 계정을 찾지 못함" });
  assert.equal(slack.calls[1].body.get("channel"), "C9");
  assert.match(slack.calls[1].body.get("text"), /^윤○○ 님\(슬랙 계정을 찾지 못함\) · 검체 인수 확인이 필요합니다/);
});

test("못 찾고 채널도 없으면 보내지 못함 (FR-003, Q49)", async () => {
  const slack = fakeSlack({ "users.lookupByEmail": { ok: false, error: "users_not_found" } });
  const result = await deliver(NOTE, { token: TOKEN, channel: "", origin: ORIGIN, fetchImpl: slack.fetchImpl });
  assert.deepEqual(result, { status: "failed", reason: "슬랙 계정을 찾지 못함" });
  assert.equal(slack.calls.length, 1);
});

test("토큰이 없으면 슬랙을 부르지 않고 보내지 못함 (FR-004)", async () => {
  const slack = fakeSlack({});
  const result = await deliver(NOTE, { token: "", channel: "C9", origin: ORIGIN, fetchImpl: slack.fetchImpl });
  assert.deepEqual(result, { status: "failed", reason: "슬랙 설정 없음" });
  assert.equal(slack.calls.length, 0);
});

test("슬랙 오류·시간 초과·연결 실패는 보내지 못함, 이유에 토큰이 없다 (FR-004)", async () => {
  const cases = [
    [{ "users.lookupByEmail": { ok: false, error: "invalid_auth" } }, "슬랙 오류(invalid_auth)"],
    [{ "users.lookupByEmail": { ok: true, user: { id: "U1" } }, "chat.postMessage": { ok: false, error: "not_in_channel" } }, "슬랙 오류(not_in_channel)"],
    [{ "users.lookupByEmail": Object.assign(new Error("t"), { name: "TimeoutError" }) }, "시간 초과"],
    [{ "users.lookupByEmail": new Error("network") }, "연결 실패"],
  ];
  for (const [responses, reason] of cases) {
    const slack = fakeSlack(responses);
    const result = await deliver(NOTE, { token: TOKEN, channel: "C9", origin: ORIGIN, fetchImpl: slack.fetchImpl });
    assert.deepEqual(result, { status: "failed", reason });
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
});

test("notify 함수: POST만, 로그인 필요 (FR-004)", async () => {
  const handler = createNotifyHandler({ verify: async () => null, fetchImpl: async () => { throw new Error("부르면 안 됨"); }, env: {} });
  const getRes = fakeRes();
  await handler({ method: "GET", headers: {} }, getRes);
  assert.equal(getRes.statusCode, 405);
  const postRes = fakeRes();
  await handler({ method: "POST", headers: {} }, postRes);
  assert.equal(postRes.statusCode, 401);
});

test("notify 함수: 내 대기 알림을 가져와 보내고 결과를 적는다, 토큰 없으면 보내지 못함으로 (FR-002, FR-004)", async () => {
  const rpc = [];
  const fetchImpl = async (url, init) => {
    const name = String(url).split("/").pop();
    rpc.push({ name, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    if (name === "claim_my_notifications") {
      return jsonResponse([{ notification_id: "n1", ...NOTE }, { notification_id: "n2", ...NOTE, recipient_email: null }]);
    }
    return jsonResponse(null);
  };
  const handler = createNotifyHandler({ verify: async () => "user-1", fetchImpl, env: {} });
  const res = fakeRes();
  await handler({ method: "POST", headers: { authorization: "Bearer 사용자토큰", host: "localhost:5173" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, claimed: 2, sent: 0, failed: 2 });
  assert.deepEqual(rpc.map((r) => r.name), ["claim_my_notifications", "finish_notification", "finish_notification"]);
  assert.deepEqual(rpc[1].body, { p_id: "n1", p_status: "failed", p_reason: "슬랙 설정 없음", p_slack_user: null });
  assert.equal(rpc[0].auth, "Bearer 사용자토큰"); // 사용자 권한으로만 가져간다 (내가 만든 알림만)
});

test("개인 메시지에 [확인] 버튼(알림 id), 채널 메시지에는 버튼 없음 (spec 009 v0.6 FR-008)", async () => {
  const dm = fakeSlack({ "users.lookupByEmail": { ok: true, user: { id: "U1" } }, "chat.postMessage": { ok: true } });
  await deliver({ ...NOTE, notification_id: "n1" }, { token: TOKEN, channel: "C9", origin: ORIGIN, fetchImpl: dm.fetchImpl });
  const blocks = JSON.parse(dm.calls[1].body.get("blocks"));
  assert.equal(blocks[0].text.text, slackText(NOTE, ORIGIN));
  assert.match(blocks[1].elements[0].text, /업무 처리는 앱에서 합니다/);
  assert.deepEqual(blocks[2].elements[0], {
    type: "button", action_id: "ack", value: "n1", style: "primary", text: { type: "plain_text", text: "확인" },
  });
  assert.equal(dm.calls[1].body.get("text"), slackText(NOTE, ORIGIN), "알림 미리보기 글은 그대로");

  const toChannel = fakeSlack({ "users.lookupByEmail": { ok: false, error: "users_not_found" }, "chat.postMessage": { ok: true } });
  const result = await deliver({ ...NOTE, notification_id: "n1" }, { token: TOKEN, channel: "C9", origin: ORIGIN, fetchImpl: toChannel.fetchImpl });
  assert.equal(toChannel.calls[1].body.get("blocks"), null);
  assert.equal(result.slackUser, undefined);
});
