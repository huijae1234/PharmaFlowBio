import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumberInput, checkSpecRange, checkHoldReason } from "../src/domain/input-rules.js";

const NUMBER_ERROR = "숫자로 입력해 주세요.";

test("숫자 해석: 정상 값은 숫자로 바꾼다 (FR-009)", () => {
  assert.deepEqual(parseNumberInput("97.2"), { ok: true, value: 97.2 });
  assert.deepEqual(parseNumberInput("-5"), { ok: true, value: -5 });
  assert.deepEqual(parseNumberInput("0.125"), { ok: true, value: 0.125 });
  assert.deepEqual(parseNumberInput("  98.0 "), { ok: true, value: 98 });
});

test("숫자 해석: 빈 값과 잘못된 값은 오류 (FR-009 경계·예외)", () => {
  for (const text of ["", "   ", "abc", "9 8", "1e", "1e3", "12,5", ".5", "5.", "--1", null, undefined]) {
    assert.deepEqual(parseNumberInput(text), { ok: false, error: NUMBER_ERROR }, `입력: ${text}`);
  }
});

test("범위 검사: 최솟값 ≤ 최댓값만 통과 (FR-007)", () => {
  assert.deepEqual(checkSpecRange(98, 102), { ok: true });
  assert.deepEqual(checkSpecRange(100, 100), { ok: true });
  assert.deepEqual(checkSpecRange(102, 98), { ok: false, error: "최솟값이 최댓값보다 클 수 없습니다." });
});

test("보류 사유: 비어 있으면 오류 (FR-012)", () => {
  const error = { ok: false, error: "보류 사유를 입력해 주세요." };
  assert.deepEqual(checkHoldReason(""), error);
  assert.deepEqual(checkHoldReason("   "), error);
  assert.deepEqual(checkHoldReason(undefined), error);
  assert.deepEqual(checkHoldReason("  포장 라인 점검 "), { ok: true, value: "포장 라인 점검" });
});
