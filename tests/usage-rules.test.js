import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOWN_USAGE_TYPES, usageEntry, pagePath, eventLabel, apiLabel, usageDetail, successLabel, notificationResultText } from "../src/domain/usage-rules.js";

test("기록 한 줄: 사용자 ID와 종류별 칸만, 이메일은 넣지 않는다 (FR-008, ERD usage_log)", () => {
  assert.deepEqual(usageEntry("u1", "login"), { user_id: "u1", event_type: "login" });
  assert.deepEqual(usageEntry("u1", "page_view", { path: "#/batches" }), { user_id: "u1", event_type: "page_view", path: "#/batches" });
  assert.deepEqual(usageEntry("u1", "search", { searchTerm: "  타이레놀 " }), { user_id: "u1", event_type: "search", search_term: "타이레놀" });
  assert.deepEqual(usageEntry("u1", "public_api_call", { apiName: "permit", success: false, durationMs: 15012.6 }),
    { user_id: "u1", event_type: "public_api_call", api_name: "permit", success: false, duration_ms: 15013 });
  const withEmail = usageEntry("u1", "login", { email: "a@b.c", path: "x" });
  assert.equal("email" in withEmail, false);
  assert.equal("path" in withEmail, false, "종류에 맞지 않는 칸은 넣지 않는다");
});

test("없는 종류·사용자 없음은 기록하지 않는다", () => {
  assert.equal(usageEntry("u1", "delete_everything"), null);
  assert.equal(usageEntry(null, "login"), null);
  assert.equal(usageEntry("u1", "search", { searchTerm: "   " }), null, "빈 검색어");
});

test("화면 주소: 쿼리(거르기 조건)는 빼고 같은 주소를 연달아 두 번 남기지 않는다", () => {
  assert.equal(pagePath("#/admin/history?actor=abc&from=2026-10-22"), "#/admin/history");
  assert.equal(pagePath("#/batches/12"), "#/batches/12");
  assert.equal(pagePath(""), "#/");
});

test("화면용 이름: 종류·호출 대상·내용·성공 여부(글자)", () => {
  assert.equal(eventLabel("login"), "로그인");
  assert.equal(eventLabel("logout"), "로그아웃");
  assert.equal(eventLabel("page_view"), "화면 이동");
  assert.equal(eventLabel("search"), "검색");
  assert.equal(eventLabel("public_api_call"), "공공데이터 호출");
  assert.equal(apiLabel("permit"), "허가정보");
  assert.equal(apiLabel("recall"), "회수·판매중지");
  assert.equal(apiLabel("gmp"), "GMP 적합판정서"); // spec 021
  assert.equal(apiLabel("shipment"), "국가출하승인");
  assert.equal(apiLabel("msds"), "MSDS");
  assert.equal(usageDetail({ event_type: "page_view", path: "#/batches" }), "#/batches");
  assert.equal(usageDetail({ event_type: "search", search_term: "타이레놀" }), "타이레놀");
  assert.equal(usageDetail({ event_type: "public_api_call", api_name: "recall" }), "회수·판매중지");
  assert.equal(usageDetail({ event_type: "login" }), "");
  assert.equal(successLabel(true), "성공");
  assert.equal(successLabel(false), "실패");
  assert.equal(successLabel(null), "");
});

test("슬랙 알림 결과 글자: 상태와 이유를 함께, 색이 아니라 글자로 (spec 009 FR-005)", () => {
  assert.equal(notificationResultText({ status: "sent", reason: null }), "보냄");
  assert.equal(notificationResultText({ status: "sent_channel", reason: "슬랙 계정을 찾지 못함" }), "채널로 보냄 · 슬랙 계정을 찾지 못함");
  assert.equal(notificationResultText({ status: "failed", reason: "슬랙 설정 없음" }), "보내지 못함 · 슬랙 설정 없음");
  assert.equal(notificationResultText({ status: "pending", reason: null }), "보내기 전");
  assert.equal(notificationResultText({ status: "sending", reason: null }), "보내는 중");
});

test("사용 기록 화면에는 화면 이동을 보이지 않는다. 기록은 계속 남는다 (spec 003 v0.4 FR-009, Q63)", () => {
  assert.deepEqual(SHOWN_USAGE_TYPES, ["login", "logout", "search", "public_api_call"]);
  assert.deepEqual(usageEntry("u1", "page_view", { path: "#/batches" }), { user_id: "u1", event_type: "page_view", path: "#/batches" });
});
