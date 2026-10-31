import test from "node:test";
import assert from "node:assert/strict";
import { lotTodos, todoTone } from "../src/domain/lot-todo-rules.js";

const spec = { item_name: "역가", unit: "%" };
const batch = { status: "on_hold" };

test("처리 중 이슈만, 오래된 순으로 다음에 할 일과 담당을 붙인다 (홈 개편)", () => {
  const todos = lotTodos({
    issues: [
      { id: "new", status: "open", kind: "alert", source: "test", opened_at: "2026-10-22T00:00:00Z" },
      { id: "old", status: "open", kind: "spec", source: "test", opened_at: "2026-10-21T00:00:00Z" },
      { id: "done", status: "closed", kind: "spec", source: "test", opened_at: "2026-10-01T00:00:00Z" },
    ],
    reviews: [{ quality_issue_id: "old", status: "submitted" }],
    requests: [],
    batch,
    measurements: [{ quality_issue_id: "old", action_request_id: null, result: "out_of_spec", value: 76, specification: spec }],
  });
  assert.deepEqual(todos.map((todo) => todo.issueId), ["old", "new"]);
  assert.equal(todos[0].detail, "역가 76%");
  assert.equal(todos[0].next, "영향 평가 검토");
  assert.equal(todos[0].owner, "QA 관리자");
  assert.equal(todos[1].next, "품질 영향 평가 작성");
});

test("재시험 측정값은 이탈 내용으로 쓰지 않는다 / 측정값이 없으면 발생 구분으로", () => {
  const [todo] = lotTodos({
    issues: [{ id: "p", status: "open", kind: "spec", source: "process", opened_at: "2026-10-22T00:00:00Z" }],
    reviews: [], requests: [], batch,
    measurements: [{ quality_issue_id: "p", action_request_id: "a1", result: "out_of_spec", value: 1, specification: spec }],
  });
  assert.equal(todo.detail, "공정 이탈");
});

test("열린 이슈가 없으면 빈 목록, 시험 중이면 출하 검토 가능(ready)", () => {
  const empty = lotTodos({ issues: [], reviews: [], requests: [], batch: { status: "in_testing" }, measurements: [] });
  assert.deepEqual(empty, []);
  assert.equal(todoTone({ todos: empty, batch: { status: "in_testing" } }), "ready");
  assert.equal(todoTone({ todos: empty, batch: { status: "in_production" } }), "idle");
  assert.equal(todoTone({ todos: [{}], batch: { status: "on_hold" } }), "open");
});
