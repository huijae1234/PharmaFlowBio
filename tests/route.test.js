import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute } from "../src/ui/route.js";

test("주소 해석: 경로와 쿼리 (IA URL 전략)", () => {
  assert.deepEqual(parseRoute("#/batches"), { path: "#/batches", id: null, query: {} });
  assert.deepEqual(parseRoute("#/batches?status=on_hold"), { path: "#/batches", id: null, query: { status: "on_hold" } });
});

test("배치 상세 주소에서 배치 id와 탭 (FR-008 수용 기준 4)", () => {
  assert.deepEqual(parseRoute("#/batches/9ca1-x?tab=tests"), { path: "#/batches/:id", id: "9ca1-x", query: { tab: "tests" } });
  assert.deepEqual(parseRoute("#/batches/abc"), { path: "#/batches/:id", id: "abc", query: {} });
});

test("제품 상세 주소에서 제품 id (IA PD_010200_PG)", () => {
  assert.deepEqual(parseRoute("#/products/p-1"), { path: "#/products/:id", id: "p-1", query: {} });
  assert.deepEqual(parseRoute("#/products"), { path: "#/products", id: null, query: {} });
});

test("빈 주소", () => {
  assert.deepEqual(parseRoute(""), { path: "", id: null, query: {} });
  assert.deepEqual(parseRoute("#/"), { path: "#/", id: null, query: {} });
});

test("품질 이슈 상세 주소 (IA QI_010100_PG)", () => {
  assert.deepEqual(parseRoute("#/issues/i-1"), { path: "#/issues/:id", id: "i-1", query: {} });
  assert.deepEqual(parseRoute("#/issues?status=open&source=test"), { path: "#/issues", id: null, query: { status: "open", source: "test" } });
});
