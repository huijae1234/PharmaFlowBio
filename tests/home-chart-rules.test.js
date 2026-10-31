import test from "node:test";
import assert from "node:assert/strict";
import { deviationRanking, weeklyIssueCounts } from "../src/domain/home-chart-rules.js";

test("주별 이슈: 월요일 시작 6주, 열린 수와 종결 수를 따로, 오래된 주부터", () => {
  const now = new Date(2026, 9, 28, 12, 0, 0); // 2026-10-28 (수). 이번 주 월요일은 10/26
  const at = (month, day) => new Date(2026, month, day, 10).toISOString();
  const issues = [
    { opened_at: at(9, 27), closed_at: null },          // 이번 주
    { opened_at: at(9, 20), closed_at: at(9, 28) },     // 지난주에 열림, 이번 주에 종결
    { opened_at: at(9, 21), closed_at: null },          // 지난주
    { opened_at: at(8, 1), closed_at: null },           // 범위 밖 (6주보다 오래됨)
  ];
  const weeks = weeklyIssueCounts(issues, now, 6);
  assert.equal(weeks.length, 6);
  assert.equal(weeks[5].label, "10/26");
  assert.deepEqual([weeks[5].opened, weeks[5].closed], [1, 1]);
  assert.deepEqual([weeks[4].opened, weeks[4].closed], [2, 0]);
  assert.equal(weeks.slice(0, 4).every((w) => w.opened === 0 && w.closed === 0), true);
});

test("주별 이슈: 시각이 없거나 읽을 수 없으면 세지 않는다", () => {
  const weeks = weeklyIssueCounts([{ opened_at: "엉터리", closed_at: null }], new Date(2026, 9, 28), 2);
  assert.deepEqual(weeks.map((w) => [w.opened, w.closed]), [[0, 0], [0, 0]]);
});

test("이탈 순위: 항목별 규격 이탈·관리기준 이탈을 나눠 세고 많은 순, 5개까지", () => {
  const row = (item, result) => ({ result, specification: { item_name: item } });
  const rows = [row("역가", "out_of_spec"), row("역가", "out_of_alert"), row("엔도톡신", "out_of_alert"), row("엔도톡신", "out_of_alert"), row("pH", "out_of_alert"), row("pass", "pass"), { result: "out_of_spec", specification: null }];
  const ranking = deviationRanking(rows);
  assert.deepEqual(ranking.map((r) => [r.item, r.spec, r.alert, r.total]), [["엔도톡신", 0, 2, 2], ["역가", 1, 1, 2], ["pH", 0, 1, 1]]);
  assert.equal(deviationRanking(Array.from({ length: 9 }, (_, i) => row(`항목${i}`, "out_of_spec"))).length, 5);
  assert.deepEqual(deviationRanking([]), []);
});

test("보류 로트 담당: 오래된 열린 이슈부터, 평가·조치 상태에 따라", async () => {
  const { holdOwner } = await import("../src/domain/home-task-rules.js");
  const issues = [
    { id: "i2", batch_id: "b", status: "open", opened_at: "2026-10-20" },
    { id: "i1", batch_id: "b", status: "open", opened_at: "2026-10-10" },
    { id: "x", batch_id: "other", status: "open", opened_at: "2026-10-01" },
  ];
  assert.equal(holdOwner({ id: "b" }, issues, [], [{ quality_issue_id: "i1", status: "submitted" }]), "QA 평가 검토 대기");
  assert.equal(holdOwner({ id: "b" }, issues, [{ quality_issue_id: "i1", status: "approved", assignee: { display_name: "윤○○" } }], []), "윤○○ 조치 결과 입력");
  assert.equal(holdOwner({ id: "b" }, issues, [{ quality_issue_id: "i2", status: "pending_approval" }], []), "QA 조치 요청 승인 대기");
  assert.equal(holdOwner({ id: "b" }, issues, [], []), "");
});
