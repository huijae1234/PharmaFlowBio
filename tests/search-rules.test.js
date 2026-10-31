import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch, normalizeSearch } from "../src/domain/search-rules.js";

test("검색어 정리: 앞뒤 공백 정리, 빈 값은 빈 글자 (spec 007 FR-008)", () => {
  assert.equal(normalizeSearch("  HBV  "), "HBV");
  assert.equal(normalizeSearch("   "), "");
  assert.equal(normalizeSearch(undefined), "");
});

test("검색: 어느 칸이든 글자가 들어가면 맞음, 대소문자 상관없음 (FR-008 수용 기준 1·2)", () => {
  const lot = ["HBV-2610-001", "B형간염 백신 주 (가상)"];
  assert.equal(matchesSearch(lot, "hbv"), true);
  assert.equal(matchesSearch(lot, "간염"), true);
  assert.equal(matchesSearch(lot, "IFV"), false);
  assert.equal(matchesSearch(["인플루엔자 4가 백신 프리필드주 (가상)", null, "가상바이오(주)"], "인플루엔자"), true);
});

test("검색: 빈 검색어는 모두 맞음 (FR-008 수용 기준 3)", () => {
  assert.equal(matchesSearch(["IFV-2610-001"], ""), true);
  assert.equal(matchesSearch(["IFV-2610-001"], "   "), true);
});
