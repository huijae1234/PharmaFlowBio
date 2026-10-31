import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxLabel, inboxAriaLabel, isSafeAppPath } from "../src/domain/inbox-rules.js";

test("알림 버튼 글자: 안 읽은 수를 숫자와 글자로 (spec 009 FR-007 수용 기준 1)", () => {
  assert.equal(inboxLabel(0), "알림");
  assert.equal(inboxLabel(2), "알림 2");
  assert.equal(inboxLabel(120), "알림 99+");
  assert.equal(inboxAriaLabel(0), "알림, 새 알림 없음");
  assert.equal(inboxAriaLabel(2), "알림, 새 알림 2건");
});

test("알림 링크는 앱 안 주소(#/…)만 따라간다", () => {
  assert.equal(isSafeAppPath("#/samples"), true);
  assert.equal(isSafeAppPath("#/issues/abc"), true);
  assert.equal(isSafeAppPath("https://evil.example"), false);
  assert.equal(isSafeAppPath("javascript:alert(1)"), false);
  assert.equal(isSafeAppPath(null), false);
});

import { inboxMetaText } from "../src/domain/inbox-rules.js";

test("알림 함 시각 줄: 보관 기한 도래는 앱을 연 사람 이름을 붙이지 않는다 (spec 018 FR-003)", () => {
  const format = () => "10/28 14:22";
  assert.equal(inboxMetaText({ kind: "lot_shipped", created_at: "x", creator: { display_name: "김희재" } }, format), "10/28 14:22 · 김희재");
  assert.equal(inboxMetaText({ kind: "retention_due", created_at: "x", creator: { display_name: "유○○" } }, format), "10/28 14:22");
});
