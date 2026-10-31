// spec 023 FR-003: 조치 이후 비슷한 이탈 비교 (코드가 기간·대상 수·이탈 수·제외 사유를 센다). 모두 가상 사례다
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOWUP_RULES, baselineOf, canSummarize, compareAfterAction, followupFacts, followupHeadline } from "../src/domain/ai-followup-rules.js";
import { requestFacts, validateFacts } from "../src/domain/ai-facts-rules.js";
import { ASSIST_LIMITS } from "../src/domain/ai-assist-rules.js";
import { NOW, daysAgo, measurement } from "./_assist-data.js";

const baseline = () => baselineOf(measurement({ measured_at: daysAgo(40) }), null);
const action = (over = {}) => ({ id: "r1", type: "retest", completedAt: daysAgo(30), hasNote: true, ...over });
// 후보 한 줄 (조치 완료 30일 전~: 완료 후 20일 시점이 기본)
const row = (over = {}) => ({ id: "x", batchId: "b2", batchNumber: "HBV-2610-002", value: 95, result: "pass", measuredAt: daysAgo(10), specVersion: 1, unit: "%", stepId: null, actionRequestId: null, ...over });
const read = (rows, over = {}) => ({ ok: true, truncated: false, rows, ...over });
const lots = (count, over = {}) => Array.from({ length: count }, (_, i) => row({ id: `x${i}`, batchId: `b${i + 2}`, batchNumber: `HBV-2610-00${i + 2}`, ...over }));
const run = (rows, over = {}) => compareAfterAction({ baseline: baseline(), action: action(), read: read(rows), now: NOW, ...over });

test("유사 이탈 있음: 다른 로트의 이탈은 로트별로 세고 사례를 최근순으로 보인다", () => {
  const result = run([...lots(2), row({ id: "d1", batchId: "b9", batchNumber: "HBV-2610-009", value: 85, result: "out_of_spec", measuredAt: daysAgo(12) }), row({ id: "d2", batchId: "b9", batchNumber: "HBV-2610-009", value: 80, result: "out_of_spec", measuredAt: daysAgo(5) })]);
  assert.equal(result.status, "observed");
  assert.equal(result.similar.length, 1); // 같은 로트의 두 이탈은 한 로트
  assert.equal(result.similar[0].value, 80); // 최근 것
  assert.equal(result.comparableLots, 3);
  assert.match(followupHeadline(result).text, /다른 로트 1개에서 관찰되었습니다\. 같은 원인으로 재발했다는 뜻은 아닙니다/);
  assert.equal(canSummarize(result), true);
});

test("충분한 비교 자료에서 관찰된 이탈 없음: 조치 효과를 입증하지 않는다고 적는다", () => {
  const result = run(lots(3));
  assert.equal(result.status, "none_observed");
  assert.equal(result.observedDays, 30);
  assert.match(followupHeadline(result).text, /다른 로트 3개, 조치 후 30일.*관찰되지 않았습니다\. 조치 효과를 입증하지 않습니다/);
  const facts = followupFacts(result, NOW);
  assert.equal(facts.rows.find((entry) => entry.id === "similar").must, false); // 0개는 꼭 인용할 줄이 아니다
  assert.match(facts.rows.find((entry) => entry.id === "similar").value, /^0개/);
});

test("비교 자료 없음·부족은 이탈 0건으로 말하지 않고 필요한 자료를 보인다 (표본 부족·기간 부족을 구분)", () => {
  const none = run([]);
  assert.equal(none.status, "few_samples");
  assert.equal(canSummarize(none), false);
  assert.match(followupHeadline(none).text, /조치 이후 비교 자료가 부족합니다.*비교 가능한 다른 로트가 0개.*표본 부족.*이탈이 없다는 뜻이 아닙니다/);
  assert.match(followupHeadline(none).need, /필요한 자료: 조치 완료 후 역가\(기준 v1\)의 다른 로트 측정값.*3개 로트 이상/);
  assert.equal(run(lots(2)).status, "few_samples");
  const short = run(lots(3, { measuredAt: daysAgo(5) }), { action: action({ completedAt: daysAgo(8) }) });
  assert.equal(short.status, "short_window");
  assert.match(followupHeadline(short).text, /완료 후 8일이 지났고 최소 14일이 필요합니다\(비교 기간 부족\)/);
});

test("기준 버전·단위가 다른 기록과 조치 완료 전·조치 결과 재시험·기간 밖 기록은 섞지 않고 제외 사유로 센다", () => {
  const result = run([
    ...lots(3), row({ id: "v", batchId: "b8", specVersion: 2, result: "out_of_spec" }), row({ id: "u", batchId: "b8", unit: "mg", result: "out_of_spec" }),
    row({ id: "e", batchId: "b8", measuredAt: daysAgo(35), result: "out_of_spec" }), row({ id: "r", batchId: "b8", actionRequestId: "r1", result: "out_of_spec" }),
    row({ id: "w", batchId: "b8", measuredAt: daysAgo(-70), result: "out_of_spec" }),
  ]);
  assert.deepEqual(result.excluded, { before: 1, afterWindow: 1, actionRetest: 1, unit: 1, version: 1, link: 0, step: 0 });
  assert.equal(result.status, "none_observed"); // 제외한 기록의 이탈은 세지 않는다
  assert.equal(result.similar.length, 0);
});

test("같은 로트의 재시험은 다른 로트의 새 이탈과 구분하고 중복해 세지 않는다", () => {
  const result = run([...lots(3), row({ id: "s1", batchId: "b1", batchNumber: "HBV-2610-001", result: "out_of_spec", value: 85 }), row({ id: "s2", batchId: "b1", batchNumber: "HBV-2610-001", result: "pass", value: 96 })]);
  assert.deepEqual(result.sameLot, { count: 2, deviations: 1 });
  assert.equal(result.similar.length, 0); // 같은 로트 이탈은 유사 이탈로 세지 않는다
  assert.equal(result.comparableLots, 3);
  const facts = followupFacts(result, NOW);
  assert.match(facts.rows.find((entry) => entry.id === "same_lot").value, /2건 \(이탈 1건\)\. 다른 로트 비교에는 넣지 않았습니다/);
});

test("공정 항목은 공정 단계 연결을 확인한다: 단계가 다르거나 연결이 불분명하면 제외, 기준에 단계가 없으면 비교 불가", () => {
  const processBase = baselineOf(measurement({ specification: { item_name: "충전 온도", unit: "℃", category: "process", version: 1 }, measured_at: daysAgo(40) }), "step-fill");
  const rows = [...lots(3, { unit: "℃", stepId: "step-fill" }), row({ id: "o", batchId: "b8", unit: "℃", stepId: "step-seal", result: "out_of_spec" }), row({ id: "n", batchId: "b8", unit: "℃", stepId: null, result: "out_of_spec" })];
  const result = compareAfterAction({ baseline: processBase, action: action(), read: read(rows), now: NOW });
  assert.equal(result.excluded.step, 1);
  assert.equal(result.excluded.link, 1);
  assert.equal(result.status, "none_observed");
  const noStep = compareAfterAction({ baseline: { ...processBase, stepId: null }, action: action(), read: read(rows), now: NOW });
  assert.equal(noStep.status, "not_comparable");
  assert.match(followupHeadline(noStep).text, /공정 단계 연결이 없어 같은 단계끼리 비교할 수 없습니다/);
});

test("조회 실패·조회 상한·비교 기준 없음은 비교하지 않는다 (없음으로 말하지 않는다)", () => {
  assert.equal(run([], { read: { ok: false } }).status, "failed");
  const capped = run([], { read: read([], { truncated: true }) });
  assert.equal(capped.status, "failed");
  assert.match(capped.reason, /조회 상한\(500건\)/);
  assert.match(followupHeadline(capped).text, /확인하지 못했습니다.*이탈이 없다는 뜻이 아닙니다/);
  const none = compareAfterAction({ baseline: baselineOf(measurement({ applied_spec_version: null }), null), action: action(), read: read([]), now: NOW });
  assert.equal(none.status, "not_comparable");
  assert.equal(baselineOf(null, null), null); // 설비 상태만 기록된 공정 이슈: 비교할 측정이 없다
  assert.equal(canSummarize(none), false);
});

test("근거 표: 코드가 센 값만 줄이 되고 서버 검사를 통과하며 한계를 적는다", () => {
  const facts = followupFacts(run([...lots(2), row({ id: "d1", batchId: "b9", batchNumber: "HBV-2610-009", value: 85, result: "out_of_alert", measuredAt: daysAgo(5) })]), NOW);
  const by = (id) => facts.rows.find((entry) => entry.id === id);
  assert.equal(by("base").value, "로트 HBV-2610-001 · 역가 · 규격 이탈 · 기준 v1");
  assert.equal(by("action").value, `재시험 · 완료 ${daysAgo(30).slice(0, 10)} · 조치 후 30일 · 결과 글 기록됨`);
  assert.equal(by("similar").value, "1개 (규격 이탈 0개 · 관리기준 이탈 1개)");
  assert.equal(by("similar").must, true);
  assert.equal(by("case_1").value, `로트 HBV-2610-009 · 85% · 관리기준 이탈 · ${daysAgo(5).slice(0, 10)}`);
  assert.match(by("rule").value, new RegExp(`${FOLLOWUP_RULES.windowDays}일 안.*최소 ${FOLLOWUP_RULES.minDays}일·${FOLLOWUP_RULES.minLots}개 로트`));
  assert.equal(validateFacts(requestFacts(facts), ASSIST_LIMITS.after_action), null);
  assert.ok(facts.limits.some((line) => line.includes("같은 원인으로 재발했다는 뜻이 아닙니다")));
  assert.ok(facts.limits.some((line) => line.includes("교육용 가정")));
});
