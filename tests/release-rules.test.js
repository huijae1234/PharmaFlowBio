import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseBlockers, requestStatusSummary } from "../src/domain/release-rules.js";

const specs = [
  { id: "s-purity", item_name: "순도" },
  { id: "s-content", item_name: "함량" },
  { id: "s-dissolution", item_name: "용출률" },
];
const m = (specificationId, result, measuredAt) => ({ specification_id: specificationId, result, measured_at: measuredAt });
const allPass = [
  m("s-purity", "pass", "2026-10-22T01:00:00Z"),
  m("s-content", "pass", "2026-10-22T01:00:00Z"),
  m("s-dissolution", "pass", "2026-10-22T01:00:00Z"),
];
const inTesting = { status: "in_testing", hold_reason: null };

test("조건을 모두 채우면 막는 이유가 없다 (FR-009 수용 기준 3)", () => {
  assert.deepEqual(releaseBlockers({ batch: inTesting, openIssueCount: 0, testSpecs: specs, measurements: allPass }), []);
});

test("열린 이슈가 있으면 건수와 함께 (FR-009 수용 기준 2)", () => {
  const reasons = releaseBlockers({ batch: inTesting, openIssueCount: 2, testSpecs: specs, measurements: allPass });
  assert.deepEqual(reasons, ["처리 중인 품질 이슈가 2건 있어 출하할 수 없습니다."]);
});

test("측정값이 없거나 마지막 값이 이탈인 항목을 이름순으로 (FR-009 수용 기준 4, Q17)", () => {
  const measurements = [
    m("s-purity", "out_of_spec", "2026-10-22T01:00:00Z"),
    m("s-purity", "pass", "2026-10-22T03:00:00Z"), // 재시험 적합이 마지막
    m("s-content", "pass", "2026-10-22T01:00:00Z"),
    m("s-content", "out_of_spec", "2026-10-22T02:00:00Z"), // 마지막이 이탈
  ];
  const reasons = releaseBlockers({ batch: inTesting, openIssueCount: 0, testSpecs: specs, measurements });
  assert.deepEqual(reasons, ["시험이 끝나지 않은 항목이 있습니다: 용출률, 함량"]);
});

test("받은 순서와 상관없이 측정 시각으로 마지막 값을 고른다", () => {
  const measurements = [
    m("s-purity", "pass", "2026-10-22T05:00:00Z"),
    m("s-purity", "out_of_spec", "2026-10-22T01:00:00Z"),
    m("s-content", "pass", "2026-10-22T01:00:00Z"),
    m("s-dissolution", "pass", "2026-10-22T01:00:00Z"),
  ];
  assert.deepEqual(releaseBlockers({ batch: inTesting, openIssueCount: 0, testSpecs: specs, measurements }), []);
});

test("배치 상태: 시험 중 또는 직접 보류만 (Q17, ERD Q2)", () => {
  const args = { openIssueCount: 0, testSpecs: specs, measurements: allPass };
  assert.deepEqual(releaseBlockers({ ...args, batch: { status: "on_hold", hold_reason: "설비 점검 대기" } }), []);
  assert.deepEqual(releaseBlockers({ ...args, batch: { status: "on_hold", hold_reason: null } }),
    ["시험 중인 로트만 출하할 수 있습니다."]);
  assert.deepEqual(releaseBlockers({ ...args, batch: { status: "in_production", hold_reason: null } }),
    ["시험 중인 로트만 출하할 수 있습니다."]);
});

test("이유가 여럿이면 모두 (열린 이슈 → 상태 → 시험 항목 순)", () => {
  const reasons = releaseBlockers({
    batch: { status: "on_hold", hold_reason: null }, openIssueCount: 1, testSpecs: specs, measurements: [],
  });
  assert.deepEqual(reasons, [
    "처리 중인 품질 이슈가 1건 있어 출하할 수 없습니다.",
    "시험 중인 로트만 출하할 수 있습니다.",
    "시험이 끝나지 않은 항목이 있습니다: 순도, 용출률, 함량",
  ]);
});

test("시험 항목이 정해지지 않은 제품은 시험 항목 이유가 없다", () => {
  assert.deepEqual(releaseBlockers({ batch: inTesting, openIssueCount: 0, testSpecs: [], measurements: [] }), []);
});

test("조치 요청 상태 요약 (FR-009 수용 기준 1)", () => {
  const req = (status) => ({ status });
  assert.deepEqual(requestStatusSummary([req("pending_approval"), req("approved"), req("approved"), req("completed"), req("rejected")]),
    { pending_approval: 1, approved: 2, rejected: 1, completed: 1 });
  assert.deepEqual(requestStatusSummary([]), { pending_approval: 0, approved: 0, rejected: 0, completed: 0 });
});

test("마지막 값이 관리기준 이탈이면 규격 안으로 보고 막지 않는다 (spec 004 FR-008 수용 기준 3)", () => {
  const measurements = [
    m("s-purity", "out_of_alert", "2026-10-22T01:00:00Z"),
    m("s-content", "pass", "2026-10-22T01:00:00Z"),
    m("s-dissolution", "out_of_alert", "2026-10-22T01:00:00Z"),
  ];
  assert.deepEqual(releaseBlockers({ batch: inTesting, openIssueCount: 0, testSpecs: specs, measurements }), []);
});

test("관리기준 이탈 이슈가 열려 있으면 막는다 (spec 004 FR-008 수용 기준 2)", () => {
  const measurements = allPass.map((x) => ({ ...x, result: "out_of_alert" }));
  assert.deepEqual(releaseBlockers({ batch: inTesting, openIssueCount: 1, testSpecs: specs, measurements }),
    ["처리 중인 품질 이슈가 1건 있어 출하할 수 없습니다."]);
});
