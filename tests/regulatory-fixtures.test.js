// spec 021 FR-006: 시험 모드(fixtures/public/gmp-*, shipment-*)로 GMP·승인 응답을 만들고 규칙까지 이어서 본다
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGmp } from "../api/gmp.js";
import { loadShipment } from "../api/shipment.js";
import { readFileSync } from "node:fs";
import { matchRecalls } from "../src/domain/public-data-rules.js";
import { gmpRow, hasVaccineGroup, latestGmp, matchApprovals, reviewFlag } from "../src/domain/regulatory-rules.js";
import { overallReview } from "../src/domain/regulatory-review.js";

const TODAY = new Date(2026, 9, 28);
const V = "가상백신(주) (시험 자료)";
const B = "가상바이오(주) (시험 자료)";
const J = "가상제약(주) (시험 자료)";

async function inFixtureMode(run) {
  const before = { mode: process.env.PUBLIC_DATA_MODE, vercel: process.env.VERCEL };
  process.env.PUBLIC_DATA_MODE = "fixtures";
  delete process.env.VERCEL;
  try { return await run(); } finally {
    if (before.mode === undefined) delete process.env.PUBLIC_DATA_MODE; else process.env.PUBLIC_DATA_MODE = before.mode;
    if (before.vercel !== undefined) process.env.VERCEL = before.vercel;
  }
}

const gmpFor = async (name) => inFixtureMode(() => loadGmp(new URLSearchParams({ name })));
const approvalsFor = async (product, company) => {
  const result = await inFixtureMode(() => loadShipment(new URLSearchParams({ name: product })));
  return { result, rows: matchApprovals(result.items, { productName: product, company }) };
};

test("시험 자료 제품 4개: 승인 이력과 GMP를 이어 QA 확인 필요가 맞게 나온다 (FR-004, FR-006)", async () => {
  const cases = [
    ["시험인플루엔자4가백신주 (시험 자료)", V, { approvals: 3, needed: false, level: "ok" }],
    ["시험B형간염백신주 (시험 자료)", V, { approvals: 1, needed: false, level: "ok" }],
    ["시험파상풍백신주 (시험 자료)", B, { approvals: 2, needed: true, level: "soon" }],
  ];
  for (const [product, company, want] of cases) {
    const gmp = latestGmp((await gmpFor(company)).items.map(gmpRow), company);
    const { rows } = await approvalsFor(product, company);
    const flag = reviewFlag({ approvals: rows, gmp, today: TODAY });
    assert.deepEqual({ approvals: rows.length, needed: flag.needed, level: flag.level }, want, product);
  }
});

test("시험 자료: 인플루엔자는 4건 중 최근 3건만, 비슷한 업체 줄은 표시가 붙는다 (FR-002, FR-003)", async () => {
  const { result, rows } = await approvalsFor("시험인플루엔자4가백신주 (시험 자료)", V);
  assert.equal(result.items.length, 4);
  assert.deepEqual(rows.map((row) => row.lotNumber), ["T2610A", "T2609C", "T2608B"]);
  assert.deepEqual(rows.map((row) => row.match), ["same", "same", "similar"]);
  assert.equal(result.scanned, 8); // 시험 자료는 8줄이라 끝 쪽(1쪽)만 받는다
});

test("시험 자료: GMP 이전 기록(이미 끝남)이 있어도 가장 늦은 줄을 쓴다 (FR-001)", async () => {
  const gmp = latestGmp((await gmpFor(V)).items.map(gmpRow), V);
  assert.equal(gmp.row.validUntil, "2030-12-31");
  assert.equal(hasVaccineGroup(gmp.row.group), true);
});

test("GMP 검색어로 고르는 시험 자료: 임박·만료·다른 회사·백신 없음·0건 (FR-006 수용 기준 1)", async () => {
  const soon = latestGmp((await gmpFor("임박")).items.map(gmpRow), B);
  assert.equal(reviewFlag({ approvals: [{}], gmp: soon, today: TODAY }).level, "soon");
  const expired = latestGmp((await gmpFor("만료")).items.map(gmpRow), B);
  assert.equal(reviewFlag({ approvals: [{}], gmp: expired, today: TODAY }).label, "GMP 유효기간 지남");
  assert.equal(latestGmp((await gmpFor("다른회사")).items.map(gmpRow), V), null); // 업체명이 달라 잘못 이어 붙이지 않는다
  const noVaccine = latestGmp((await gmpFor("비백신")).items.map(gmpRow), V);
  assert.equal(hasVaccineGroup(noVaccine.row.group), false);
  assert.deepEqual((await gmpFor("없음")).items, []);
});

test("시험 자료: 비백신 제품의 GMP도 나오고, 오류 검색어는 안전한 실패로 (FR-006)", async () => {
  assert.equal(latestGmp((await gmpFor(J)).items.map(gmpRow), J).row.validUntil, "2029-05-31");
  assert.equal((await gmpFor("실패")).ok, false);
  assert.equal((await gmpFor("XML")).ok, false);
  assert.equal((await gmpFor("깨짐")).ok, false);
});

test("시험 자료: 인플루엔자 제품의 승인 로트 T2610A가 회수 공지에도 있어 위험으로 나온다 (FR-008·009)", async () => {
  const result = await inFixtureMode(() => loadShipment(new URLSearchParams({ name: "시험인플루엔자4가백신주 (시험 자료)" })));
  const approvals = matchApprovals(result.items, { productName: "시험인플루엔자4가백신주 (시험 자료)", company: V }, Infinity);
  const recallBody = JSON.parse(readFileSync(new URL("../fixtures/public/recall-normal.json", import.meta.url), "utf8")).body;
  const recalls = matchRecalls(recallBody.items.map((entry) => entry.item), "900000001");
  const gmp = latestGmp((await gmpFor(V)).items.map(gmpRow), V);
  const review = overallReview({ approvals, gmp, recalls, today: TODAY });
  assert.equal(review.needed, true);
  assert.equal(review.items[0].key, "recalled_lot");
  assert.match(review.items[0].reason, /T2610A/);
});
