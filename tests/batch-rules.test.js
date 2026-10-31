import { test } from "node:test";
import assert from "node:assert/strict";
import { batchStatusLabel, isBatchEditable, measuredSpecificationIds } from "../src/domain/batch-rules.js";

test("배치 상태 이름은 GLOSSARY 용어 (FR-008)", () => {
  assert.equal(batchStatusLabel("in_production"), "생산 중");
  assert.equal(batchStatusLabel("in_testing"), "시험 중");
  assert.equal(batchStatusLabel("on_hold"), "보류");
  assert.equal(batchStatusLabel("releasable"), "출하 가능");
  assert.equal(batchStatusLabel("discarded"), "폐기");
});

test("출하 판정이 끝난 배치는 입력할 수 없다 (Q11)", () => {
  assert.equal(isBatchEditable("in_production"), true);
  assert.equal(isBatchEditable("in_testing"), true);
  assert.equal(isBatchEditable("on_hold"), true);
  assert.equal(isBatchEditable("releasable"), false);
  assert.equal(isBatchEditable("discarded"), false);
});

test("재시험 측정값은 일반 입력 여부에 세지 않는다 (Q10, 재시험은 기능 002)", () => {
  const measurements = [
    { specification_id: "purity", action_request_id: "retest-1" },
    { specification_id: "assay", action_request_id: null },
  ];
  assert.deepEqual(measuredSpecificationIds(measurements), new Set(["assay"]));
});

test("이미 측정한 기준 항목을 찾는다 (Q10)", () => {
  const measurements = [
    { specification_id: "purity" },
    { specification_id: "assay" },
    { specification_id: "purity" },
  ];
  assert.deepEqual(measuredSpecificationIds(measurements), new Set(["purity", "assay"]));
  assert.deepEqual(measuredSpecificationIds([]), new Set());
});
