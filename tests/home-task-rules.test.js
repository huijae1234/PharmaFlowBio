import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalTasks, assignedTasks, countByKind, releaseTasks, returnedTasks, reviewTasks, statusSegments,
} from "../src/domain/home-task-rules.js";

const issue = (id, number) => ({ id, batch: { id: `b-${id}`, batch_number: number } });

test("승인 대기 조치 요청: 오래된 것부터, 로트번호와 이슈 링크 (홈 개편)", () => {
  const tasks = approvalTasks([
    { id: "2", issue: issue("i2", "IFV-2"), action_type: "retest", requester: { display_name: "나" }, requested_at: "2026-10-24T10:00:00Z" },
    { id: "1", issue: issue("i1", "IFV-1"), action_type: "equipment_check", requester: { display_name: "너" }, requested_at: "2026-10-23T10:00:00Z" },
  ]);
  assert.deepEqual(tasks.map((task) => task.ref), ["IFV-1", "IFV-2"]);
  assert.equal(tasks[0].href, "#/issues/i1");
  assert.equal(tasks[0].cta, "승인·반려");
  assert.equal(tasks[0].who, "너");
});

test("영향 평가 검토: 종류와 담당 문구", () => {
  const [task] = reviewTasks([{ id: "r1", issue: issue("i1", "HBV-1"), requester: { display_name: "윤○○" }, requested_at: "2026-10-23T12:00:00Z" }]);
  assert.equal(task.kind, "영향 평가 검토");
  assert.equal(task.text, "품질 영향 평가");
  assert.equal(task.refHref, "#/batches/b-i1");
});

test("배정된 조치: 조치 종류와 요청 내용을 한 줄로", () => {
  const [task] = assignedTasks([{ id: "a1", issue: issue("i1", "HBV-2"), action_type: "retest", description: "엔도톡신 재시험", reviewed_at: "2026-10-25T09:00:00Z" }]);
  assert.match(task.text, /엔도톡신 재시험/);
  assert.equal(task.cta, "결과 입력");
});

test("보완 필요: 반려된 조치 요청과 보완 요청된 평가를 최근 것부터", () => {
  const tasks = returnedTasks(
    [{ id: "q1", issue: issue("i1", "A"), rejection_reason: "근거 부족", reviewed_at: "2026-10-20T00:00:00Z" }],
    [{ id: "r1", issue: issue("i2", "B"), status: "revision_requested", review_comment: "원인 보완", reviewed_at: "2026-10-22T00:00:00Z" }],
  );
  assert.deepEqual(tasks.map((task) => task.ref), ["B", "A"]);
  assert.match(tasks[1].text, /근거 부족/);
  assert.match(tasks[0].text, /원인 보완/);
});

test("내부 출하 검토 대기 로트: 로트 상세로 간다", () => {
  const [task] = releaseTasks([{ id: "b1", batch_number: "IFV-2610-003", created_at: "2026-10-16T00:00:00Z", product: { item_name: "인플루엔자 4가" } }]);
  assert.equal(task.href, "#/batches/b1");
  assert.equal(task.text, "인플루엔자 4가 · 열린 이슈 없음");
});

test("종류별 건수: 처음 나온 순서를 지킨다", () => {
  assert.deepEqual(countByKind([{ kind: "가" }, { kind: "나" }, { kind: "가" }]), [["가", 2], ["나", 1]]);
  assert.deepEqual(countByKind([]), []);
});

test("로트 상태 막대: 합이 100이고 0건은 0%", () => {
  const segments = statusSegments({ in_production: 5, in_testing: 3, on_hold: 4, releasable: 2, shipped: 1, discarded: 1 });
  assert.equal(segments.length, 6); // spec 017: 출하 완료 포함
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.percent, 0) - 100) < 1e-9);
  assert.equal(statusSegments({}).every((segment) => segment.percent === 0), true);
});
