import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLEARANCE_ITEMS, STEP_STATUS_LABELS, checkStepName, checkClearance, stepBoard, specsForStep, currentStepText,
} from "../src/domain/process-step-rules.js";

const step = (id, order, name, extra = {}) => ({ id, step_order: order, name, retired_at: null, ...extra });
const STEPS = [step("s1", 1, "세포 배양"), step("s2", 2, "정제"), step("s3", 3, "원액 여과"), step("s4", 4, "충전"), step("s5", 5, "포장")];
const run = (stepId, status) => ({ process_step_id: stepId, status });

test("라인 클리어런스 4가지와 상태 이름 (spec 011 FR-004, FR-003)", () => {
  assert.equal(CLEARANCE_ITEMS.length, 4);
  assert.deepEqual(STEP_STATUS_LABELS, { waiting: "대기", in_progress: "진행 중", completed: "완료" });
});

test("단계 이름: 빈칸·40자 넘음 막고 앞뒤 빈칸 정리 (FR-001, 경계 상황)", () => {
  assert.deepEqual(checkStepName("  "), { ok: false, error: "단계 이름을 입력해 주세요." });
  assert.deepEqual(checkStepName("가".repeat(41)), { ok: false, error: "단계 이름은 40자까지 입력해 주세요." });
  assert.deepEqual(checkStepName(" 세포 배양 "), { ok: true, value: "세포 배양" });
});

test("라인 클리어런스: 4가지 모두 체크해야 통과 (FR-004 수용 기준 2)", () => {
  const keys = CLEARANCE_ITEMS.map((item) => item.key);
  assert.deepEqual(checkClearance(keys.slice(0, 3)), { ok: false, error: "라인 클리어런스 4가지를 모두 확인해 주세요." });
  assert.deepEqual(checkClearance([...keys, keys[0]]), { ok: true, value: keys });
});

test("단계 상태: 실행 기록으로 완료·진행 중·대기 (FR-003 수용 기준 1)", () => {
  const board = stepBoard(STEPS, [run("s1", "completed"), run("s2", "completed"), run("s3", "in_progress")], "in_production");
  assert.deepEqual(board.map((b) => b.status), ["completed", "completed", "in_progress", "waiting", "waiting"]);
  assert.deepEqual(board.map((b) => b.label), ["1/5", "2/5", "3/5", "4/5", "5/5"]);
  assert.equal(board[2].canComplete, true);
  assert.equal(board[3].canStart, false);
  assert.equal(board[3].blockedReason, "앞 단계를 완료한 뒤 착수할 수 있습니다.");
});

test("착수 가능: 앞 단계가 모두 완료이고 진행 중 단계가 없을 때만 (FR-004 수용 기준 1·3)", () => {
  const board = stepBoard(STEPS, [run("s1", "completed")], "in_production");
  assert.deepEqual(board.map((b) => b.canStart), [false, true, false, false, false]);
  assert.equal(board[1].blockedReason, null);
});

test("로트가 보류면 착수·완료 모두 막고 이유를 글자로 (FR-004 수용 기준 4, 경계 상황)", () => {
  const board = stepBoard(STEPS, [run("s1", "completed"), run("s2", "in_progress")], "on_hold");
  assert.equal(board[1].canComplete, false);
  assert.equal(board[2].canStart, false);
  for (const b of board.filter((x) => x.status !== "completed")) {
    assert.equal(b.blockedReason, "로트가 보류 중입니다. 품질 이슈를 처리하고 보류가 풀린 뒤 진행해 주세요.");
  }
});

test("시험 중·출하 가능·폐기 로트는 진행할 수 없다 (FR-004 수용 기준 5)", () => {
  for (const status of ["in_testing", "releasable", "discarded"]) {
    const board = stepBoard(STEPS, [], status);
    assert.equal(board[0].canStart, false, status);
    assert.equal(board[0].blockedReason, "생산 중인 로트만 진행할 수 있습니다.", status);
  }
});

test("쓰지 않음 단계는 건너뛰고 번호도 쓰는 단계로 센다. 이미 실행한 쓰지 않음 단계는 보인다 (경계 상황)", () => {
  const steps = [STEPS[0], step("s2", 2, "정제", { retired_at: "2026-10-27T00:00:00Z" }), STEPS[2]];
  const board = stepBoard(steps, [run("s1", "completed")], "in_production");
  assert.deepEqual(board.map((b) => `${b.step.id}:${b.label}`), ["s1:1/2", "s3:2/2"]);
  assert.equal(board[1].canStart, true);
  const withRun = stepBoard(steps, [run("s1", "completed"), run("s2", "completed")], "in_production");
  assert.deepEqual(withRun.map((b) => b.step.id), ["s1", "s2", "s3"]);
});

test("단계 기준: 그 단계 기준, 마지막 단계면 단계 미지정 기준도 (FR-002, Q71)", () => {
  const specs = [
    { id: "p1", process_step_id: "s1" }, { id: "p2", process_step_id: "s4" }, { id: "p3", process_step_id: null },
  ];
  assert.deepEqual(specsForStep(specs, STEPS[0], false).map((s) => s.id), ["p1"]);
  assert.deepEqual(specsForStep(specs, STEPS[4], true).map((s) => s.id), ["p3"]);
  assert.deepEqual(specsForStep(specs, STEPS[2], false), []);
});

test("현재 단계 글자 (FR-007)", () => {
  assert.equal(currentStepText(stepBoard(STEPS, [run("s1", "completed"), run("s2", "completed"), run("s3", "in_progress")], "in_production")),
    "현재 단계: 원액 여과 (전체 5단계 중 3번째) · 진행 중");
  assert.equal(currentStepText(stepBoard(STEPS, [run("s1", "completed")], "in_production")), "다음 단계: 정제 (전체 5단계 중 2번째) · 대기");
  assert.equal(currentStepText(stepBoard(STEPS, STEPS.map((s) => run(s.id, "completed")), "in_production")), "모든 단계 완료");
  assert.equal(currentStepText(stepBoard(STEPS, [run("s1", "completed")], "on_hold")),
    "다음 단계: 정제 (전체 5단계 중 2번째) · 대기 · 보류 중이라 다음 단계를 진행할 수 없습니다");
  assert.equal(currentStepText([]), "");
});
