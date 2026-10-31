import { test } from "node:test";
import assert from "node:assert/strict";
import { productFilterValue } from "../src/domain/batch-filter-rules.js";

const products = [{ id: "p-hbv", item_name: "B형간염 백신 주 (가상)" }, { id: "p-ifv", item_name: "인플루엔자 4가 백신 프리필드주 (가상)" }];

test("제품 값 정리: 목록에 있는 제품만, 아니면 모든 제품 (spec 018 FR-001, 경계 상황)", () => {
  assert.equal(productFilterValue(products, "p-hbv"), "p-hbv");
  assert.equal(productFilterValue(products, "없는-제품"), "");
  assert.equal(productFilterValue(products, ""), "");
  assert.equal(productFilterValue(products, undefined), "");
  assert.equal(productFilterValue([], "p-hbv"), "");
});
