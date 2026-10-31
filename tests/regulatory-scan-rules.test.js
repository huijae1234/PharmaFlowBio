// spec 021 FR-002: 국가출하승인은 최신 끝 쪽만 훑는다. 화면이 "언제부터 본 것인지" 밝히는 글자 (2026-10-29 순서 고침)
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanRangeText } from "../src/domain/regulatory-rules.js";

test("훑은 범위 글자: 건수·가장 이른 판정일·전체 건수 (FR-002)", () => {
  assert.equal(scanRangeText({ scanned: 335, since: "20260617", totalCount: 6035 }), "최근 335건(2026-06-17 이후 판정, 전체 6,035건 중)");
});

test("훑은 범위 글자: 판정일을 모르면 날짜 없이, 0건이면 아무것도 못 봤다고 (경계)", () => {
  assert.equal(scanRangeText({ scanned: 12, since: null, totalCount: 12 }), "최근 12건(전체 12건 중)");
  assert.equal(scanRangeText({ scanned: 0, since: null, totalCount: 0 }), "조회한 승인 이력 0건");
});
