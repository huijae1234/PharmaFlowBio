import test from "node:test";
import assert from "node:assert/strict";
import { filterByProduct, holdProducts, holdSince, sortHolds } from "../src/domain/hold-sort-rules.js";

const lot = (id, created, product = "A") => ({ id, created_at: created, product: { item_name: product } });
const issue = (batchId, opened, status = "open") => ({ batch_id: batchId, status, opened_at: opened });

test("보류 기준 시각: 가장 오래된 열린 이슈, 없으면 로트 등록 때", () => {
  const issues = [issue("a", "2026-10-20T00:00:00Z"), issue("a", "2026-10-10T00:00:00Z"), issue("a", "2026-09-01T00:00:00Z", "closed")];
  assert.equal(holdSince(lot("a", "2026-08-01T00:00:00Z"), issues), "2026-10-10T00:00:00Z");
  assert.equal(holdSince(lot("b", "2026-08-01T00:00:00Z"), issues), "2026-08-01T00:00:00Z");
});

test("정렬: 기본은 오래된 것이 위, 최신순은 반대, 원본은 바꾸지 않는다", () => {
  const batches = [lot("a", "2026-10-01T00:00:00Z"), lot("b", "2026-10-03T00:00:00Z"), lot("c", "2026-10-02T00:00:00Z")];
  assert.deepEqual(sortHolds(batches, []).map((b) => b.id), ["a", "c", "b"]);
  assert.deepEqual(sortHolds(batches, [], "newest").map((b) => b.id), ["b", "c", "a"]);
  assert.deepEqual(batches.map((b) => b.id), ["a", "b", "c"]);
  // 열린 이슈가 더 오래된 로트가 먼저
  assert.equal(sortHolds(batches, [issue("b", "2026-09-01T00:00:00Z")])[0].id, "b");
});

test("제품 목록과 거르기", () => {
  const batches = [lot("a", "x", "인플루엔자"), lot("b", "x", "간염"), lot("c", "x", "인플루엔자")];
  assert.deepEqual(holdProducts(batches), ["간염", "인플루엔자"]);
  assert.deepEqual(filterByProduct(batches, "인플루엔자").map((b) => b.id), ["a", "c"]);
  assert.equal(filterByProduct(batches, "").length, 3);
});
