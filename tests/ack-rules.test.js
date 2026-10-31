import { test } from "node:test";
import assert from "node:assert/strict";
import { ackText, groupByTarget, lotAckText, newlyAcked, isAcked, latestNotes } from "../src/domain/ack-rules.js";

const fmt = (iso) => `T(${iso.slice(11, 16)})`;
const note = (name, extra = {}) => ({ target_id: "t1", recipient: { display_name: name }, status: "sent", slack_acknowledged_at: null, ...extra });

test("한 명: 확인함·확인 전 (spec 009 v0.7 FR-009 수용 기준 1·2)", () => {
  assert.equal(ackText([note("유○○", { slack_acknowledged_at: "2026-10-27T05:05:00Z" })], fmt), "✓ 유○○ 확인 · T(05:05)");
  assert.equal(ackText([note("유○○")], fmt), "알림 · 유○○ 확인 전");
});

test("한 명: 채널로 보냄·보내지 못함·보내는 중 (FR-009 수용 기준 7)", () => {
  assert.equal(ackText([note("유○○", { status: "sent_channel" })], fmt), "채널로 보냄 · 슬랙 확인 없음");
  assert.equal(ackText([note("유○○", { status: "failed" })], fmt), "알림 · 보내지 못함");
  assert.equal(ackText([note("유○○", { status: "pending" })], fmt), "알림 · 유○○ 확인 전");
});

test("여러 명(팀 전체): 몇 명 중 몇 명, 가장 먼저 확인한 사람 (FR-009)", () => {
  const two = [note("유○○", { slack_acknowledged_at: "2026-10-27T05:05:00Z" }), note("이QA")];
  assert.equal(ackText(two, fmt), "✓ 2명 중 1명 확인 (유○○ T(05:05))");
  assert.equal(ackText([note("유○○"), note("이QA")], fmt), "알림 · 2명 확인 전");
  const both = [note("이QA", { slack_acknowledged_at: "2026-10-27T06:00:00Z" }), note("유○○", { slack_acknowledged_at: "2026-10-27T05:05:00Z" })];
  assert.equal(ackText(both, fmt), "✓ 2명 중 2명 확인 (유○○ T(05:05))");
});

test("알림이 없으면 빈 글자 (표시 안 함)", () => {
  assert.equal(ackText([], fmt), "");
  assert.equal(ackText(undefined, fmt), "");
});

test("기록별로 묶기, 확인 여부 (FR-009)", () => {
  const rows = [note("a", { target_id: "x" }), note("b", { target_id: "y", slack_acknowledged_at: "2026-10-27T05:05:00Z" }), note("c", { target_id: "x" })];
  const grouped = groupByTarget(rows);
  assert.deepEqual([...grouped.keys()], ["x", "y"]);
  assert.equal(grouped.get("x").length, 2);
  assert.equal(isAcked(grouped.get("y")), true);
  assert.equal(isAcked(grouped.get("x")), false);
});

test("새로 확인된 기록만 강조 (FR-009 수용 기준 2)", () => {
  const before = groupByTarget([note("a", { target_id: "x" }), note("b", { target_id: "y" })]);
  const after = groupByTarget([note("a", { target_id: "x", slack_acknowledged_at: "2026-10-27T05:05:00Z" }), note("b", { target_id: "y" }),
    note("c", { target_id: "z", slack_acknowledged_at: "2026-10-27T05:06:00Z" })]);
  assert.deepEqual(newlyAcked(before, after), ["x", "z"]);
  assert.deepEqual(newlyAcked(after, after), []);
});

test("로트 위쪽 집계 (FR-009 수용 기준 4)", () => {
  assert.equal(lotAckText(3, 2), "이 로트 알림 3건 중 2건 확인");
  assert.equal(lotAckText(0, 0), "");
});

test("한 기록에 알림이 여러 번 갔으면 가장 최근 알림(같은 종류, 같은 때)만 본다", () => {
  const rows = [
    note("유○○", { kind: "approval_waiting", created_at: "2026-10-27T01:00:00.100Z", slack_acknowledged_at: "2026-10-27T01:05:00Z" }),
    note("이QA", { kind: "approval_waiting", created_at: "2026-10-27T01:00:00.300Z" }),
    note("윤○○", { kind: "action_assigned", created_at: "2026-10-27T02:00:00.000Z" }),
  ];
  assert.deepEqual(latestNotes(rows).map((n) => n.recipient.display_name), ["윤○○"]);
  assert.deepEqual(latestNotes(rows.slice(0, 2)).map((n) => n.recipient.display_name), ["유○○", "이QA"]);
  assert.deepEqual(latestNotes([]), []);
});
