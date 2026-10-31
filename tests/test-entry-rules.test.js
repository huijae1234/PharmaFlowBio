import { test } from "node:test";
import assert from "node:assert/strict";
import { remainingTestSpecs, checkTestEntries, resultSummaryText } from "../src/domain/test-entry-rules.js";

const SPECS = [{ id: "s1", item_name: "역가" }, { id: "s2", item_name: "엔도톡신" }, { id: "s3", item_name: "pH" }];

test("남은 시험 항목: 첫 측정값이 없는 항목만, 재시험 측정값은 입력됨으로 치지 않는다 (spec 017 FR-003)", () => {
  const measurements = [{ specification_id: "s1", action_request_id: null }, { specification_id: "s2", action_request_id: "a1" }];
  assert.deepEqual(remainingTestSpecs(SPECS, measurements).map((s) => s.id), ["s2", "s3"]);
  assert.deepEqual(remainingTestSpecs(SPECS, []).map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(remainingTestSpecs([], []), []);
});

test("칸 검사: 빈칸은 건너뛰고 넣은 값만 숫자로 (FR-004 수용 기준 2)", () => {
  const result = checkTestEntries([{ specificationId: "s1", text: " 98.5 " }, { specificationId: "s2", text: "" }, { specificationId: "s3", text: "7" }]);
  assert.deepEqual(result, { ok: true, values: [{ specification_id: "s1", value: 98.5 }, { specification_id: "s3", value: 7 }] });
});

test("칸 검사: 숫자가 아닌 칸은 그 칸에 문구, 하나라도 틀리면 저장하지 않는다 (FR-004 수용 기준 3)", () => {
  const result = checkTestEntries([{ specificationId: "s1", text: "12a" }, { specificationId: "s2", text: "5" }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, { s1: "숫자로 입력해 주세요." });
});

test("칸 검사: 모두 빈칸이면 하나 이상 넣으라는 문구 (FR-004 수용 기준 4)", () => {
  const result = checkTestEntries([{ specificationId: "s1", text: " " }, { specificationId: "s2", text: "" }]);
  assert.deepEqual(result, { ok: false, errors: {}, error: "시험값을 하나 이상 입력해 주세요." });
});

test("저장 뒤 항목별 판정 글자 (FR-004 수용 기준 1)", () => {
  const results = [{ specification_id: "s1", result: "pass" }, { specification_id: "s2", result: "out_of_alert" }, { specification_id: "s3", result: "out_of_spec" }];
  assert.equal(resultSummaryText(results, SPECS), "역가 정상 · 엔도톡신 관리기준 이탈 · pH 규격 이탈");
});
