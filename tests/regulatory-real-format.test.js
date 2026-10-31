import { test } from "node:test";
import assert from "node:assert/strict";
import { gmpRow, latestGmp } from "../src/domain/regulatory-rules.js";

// 실제 GMP API는 유효기간을 "2027-02-27"처럼 하이픈을 넣어 준다 (2026-10-29 실제 키로 확인). 시험 자료는 "20270227"이라 놓쳤다
test("GMP 유효기간: 실제 응답의 하이픈 날짜도 YYYY-MM-DD로 읽는다 (FR-001, qa 021 실패와 조치)", () => {
  assert.equal(gmpRow({ BSSH_NM: "가상백신(주)", VLD_PRD_YMD: "2027-02-27" }).validUntil, "2027-02-27");
  assert.equal(gmpRow({ BSSH_NM: "가상백신(주)", VLD_PRD_YMD: "20270227" }).validUntil, "2027-02-27");
});

test("GMP: 하이픈 날짜만 있어도 가장 늦은 유효기간 줄을 고른다 (FR-001 수용 기준 1)", () => {
  const rows = [
    gmpRow({ BSSH_NM: "(주)가상백신", VLD_PRD_YMD: "2027-02-27" }),
    gmpRow({ BSSH_NM: "(주)가상백신", VLD_PRD_YMD: "2028-10-10" }),
  ];
  assert.equal(latestGmp(rows, "(주)가상백신").row.validUntil, "2028-10-10");
});
