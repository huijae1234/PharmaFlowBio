import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, issueKpis, releaseWaiting, dayRange } from "../src/domain/dashboard-rules.js";

test("이번 주는 월요일 0시부터 (Q22 임시 처리)", () => {
  // 2026-10-22는 목요일
  const start = weekStart(new Date(2026, 9, 22, 15, 30));
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 9);
  assert.equal(start.getDate(), 19);
  assert.equal(start.getHours(), 0);
  assert.equal(weekStart(new Date(2026, 9, 19, 0, 0)).getDate(), 19, "월요일 0시는 그 주");
  assert.equal(weekStart(new Date(2026, 9, 25, 23, 59)).getDate(), 19, "일요일은 앞 월요일");
  assert.equal(weekStart(new Date(2026, 10, 1, 9)).getDate(), 26, "달이 바뀌어도");
  assert.equal(weekStart(new Date(2026, 10, 1, 9)).getMonth(), 9);
});

test("KPI: 열린 이슈 수와 평균 처리 일수(소수 첫째 자리) (FR-010 수용 기준 3)", () => {
  const issues = [
    { status: "open", opened_at: "2026-10-20T00:00:00Z", closed_at: null },
    { status: "closed", opened_at: "2026-10-20T00:00:00Z", closed_at: "2026-10-21T00:00:00Z" }, // 1일
    { status: "closed", opened_at: "2026-10-20T00:00:00Z", closed_at: "2026-10-22T12:00:00Z" }, // 2.5일
  ];
  assert.deepEqual(issueKpis(issues), { openCount: 1, averageDays: 1.8 });
  assert.deepEqual(issueKpis([]), { openCount: 0, averageDays: null }, "닫힌 이슈가 없으면 평균 없음");
  assert.deepEqual(issueKpis([{ status: "closed", opened_at: "2026-10-22T00:00:00Z", closed_at: "2026-10-22T01:00:00Z" }]),
    { openCount: 0, averageDays: 0 });
});

test("출하 판정 대기: 시험 중이고 열린 이슈가 없는 배치 (FR-010 수용 기준 2)", () => {
  const batches = [
    { id: "b1", status: "in_testing" },
    { id: "b2", status: "in_testing" },
    { id: "b3", status: "on_hold" },
    { id: "b4", status: "releasable" },
  ];
  const issues = [{ batch_id: "b2", status: "open" }, { batch_id: "b1", status: "closed" }];
  assert.deepEqual(releaseWaiting(batches, issues).map((b) => b.id), ["b1"]);
  assert.deepEqual(releaseWaiting([], issues), []);
});

test("업무 이력 기간: 시작일 0시 ~ 끝일 다음 날 0시 (FR-013 수용 기준 2)", () => {
  const range = dayRange("2026-10-22", "2026-10-22");
  assert.equal(range.ok, true);
  assert.equal(range.from, new Date(2026, 9, 22).toISOString());
  assert.equal(range.to, new Date(2026, 9, 23).toISOString());
  assert.deepEqual(dayRange("", ""), { ok: true, from: null, to: null });
  assert.equal(dayRange("2026-10-20", "").to, null);
  assert.equal(dayRange("", "2026-10-21").from, null);
  assert.deepEqual(dayRange("2026-10-23", "2026-10-22"), { ok: false, error: "기간 시작일이 끝일보다 늦습니다. 날짜를 다시 골라 주세요." });
  assert.deepEqual(dayRange("2026-13-40", ""), { ok: false, error: "날짜 형식이 맞지 않습니다. 2026-10-22처럼 골라 주세요." });
});
