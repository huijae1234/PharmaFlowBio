import test from "node:test";
import assert from "node:assert/strict";
import { latestByLot, previewResult, rangeModel, siblingRows } from "../src/domain/compare-rules.js";
import { readinessChecklist } from "../src/domain/release-readiness-rules.js";

const row = (id, number, value, at, result = "pass", item = "역가") => ({
  batch: { id, batch_number: number, status: "in_testing" }, specification: { item_name: item }, value, result, measured_at: at,
});

test("로트별 가장 최근 값만, 최근순 (재시험이 있으면 그 값)", () => {
  const rows = [
    row("a", "A-1", 80, "2026-10-01T00:00:00Z"),
    row("a", "A-1", 99, "2026-10-03T00:00:00Z"),
    row("b", "B-1", 101, "2026-10-02T00:00:00Z"),
    row("c", "C-1", 5, "2026-10-04T00:00:00Z", "pass", "pH"),
  ];
  const result = latestByLot(rows, "역가");
  assert.deepEqual(result.map((r) => [r.batchNumber, r.value]), [["A-1", 99], ["B-1", 101]]);
});

test("비교 줄: 최근 N개, 지금 로트는 밀려나도 반드시 포함", () => {
  const rows = ["1", "2", "3", "4"].map((n, i) => row(`b${n}`, `L-${n}`, 90 + i, `2026-10-0${i + 1}T00:00:00Z`));
  const shown = siblingRows(rows, "역가", "b1", 3);
  assert.equal(shown.length, 3);
  assert.ok(shown.some((r) => r.isCurrent && r.batchNumber === "L-1"));
  assert.deepEqual(shown.map((r) => r.batchNumber), ["L-4", "L-3", "L-1"]);
});

test("범위 막대: 규격·관리기준 위치와 값 위치, 값이 밖이면 축을 넓힌다", () => {
  const model = rangeModel({ min: 80, max: 125, alertMin: 90, alertMax: 115 }, [60]);
  assert.ok(model.spec.from > 0 && model.spec.to < 100);
  assert.ok(model.alert.from > model.spec.from && model.alert.to < model.spec.to);
  assert.ok(model.at(60) >= 0 && model.at(60) < model.spec.from);
  assert.equal(rangeModel({ min: 1, max: 2 }).alert, null);
});

test("판정 미리보기: 경계는 범위 안, 규격 밖은 이탈, 관리기준 밖은 관리기준 이탈", () => {
  const spec = { min_value: 80, max_value: 125, alert_min_value: 90, alert_max_value: 115 };
  assert.equal(previewResult(80, spec), "out_of_alert");
  assert.equal(previewResult(90, spec), "pass");
  assert.equal(previewResult(125, spec), "out_of_alert");
  assert.equal(previewResult(79.9, spec), "out_of_spec");
  assert.equal(previewResult(102, spec), "pass");
  assert.equal(previewResult(100, { min_value: 0, max_value: 10 }), "out_of_spec");
  assert.equal(previewResult(5, { min_value: 0, max_value: 10, alert_min_value: null, alert_max_value: null }), "pass");
});

const specs = [{ id: "s1", item_name: "역가", version: 2 }, { id: "s2", item_name: "pH", version: 1 }];
const base = { testSpecs: specs, openIssueCount: 0, board: null, processRecordCount: 2, retainedQuantity: 4 };

test("출하 근거: 모두 정상이면 시험·이슈·공정·검체 ok, 기준 버전이 다르면 경고", () => {
  const items = readinessChecklist({ ...base, measurements: [
    { specification_id: "s1", result: "pass", measured_at: "2026-10-01", applied_spec_version: 1 },
    { specification_id: "s2", result: "pass", measured_at: "2026-10-01", applied_spec_version: 1 },
  ] });
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by.tests.status, "ok");
  assert.equal(by.issues.status, "ok");
  assert.equal(by.process.status, "ok");
  assert.equal(by.samples.status, "ok");
  assert.equal(by.version.status, "warn");
  assert.match(by.version.detail, /역가/);
});

test("출하 근거: 미입력·규격 이탈·열린 이슈는 bad, 관리기준 이탈은 경고, 검체 못 읽으면 경고", () => {
  const items = readinessChecklist({ ...base, openIssueCount: 2, retainedQuantity: null, measurements: [
    { specification_id: "s1", result: "out_of_spec", measured_at: "2026-10-01", applied_spec_version: 2 },
  ] });
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by.tests.status, "bad");
  assert.match(by.tests.detail, /pH 미입력/);
  assert.match(by.tests.detail, /역가 규격 이탈/);
  assert.equal(by.issues.status, "bad");
  assert.equal(by.samples.status, "warn");
  const alertOnly = readinessChecklist({ ...base, board: [{ status: "completed" }, { status: "waiting" }], measurements: [
    { specification_id: "s1", result: "out_of_alert", measured_at: "2026-10-01", applied_spec_version: 2 },
    { specification_id: "s2", result: "pass", measured_at: "2026-10-01", applied_spec_version: 1 },
  ] });
  assert.equal(alertOnly.find((i) => i.key === "tests").status, "warn");
  assert.equal(alertOnly.find((i) => i.key === "process").detail, "1/2 단계 완료");
});

test("출하 근거: 공정 기록을 못 읽으면 '기록 없음'이 아니라 '확인하지 못했습니다' (조회 실패를 없음으로 바꾸지 않음)", () => {
  const find = (count, board = null) => readinessChecklist({ ...base, processRecordCount: count, board, measurements: [] }).find((item) => item.key === "process");
  assert.deepEqual(find(null), { key: "process", label: "공정", status: "warn", detail: "확인하지 못했습니다" });
  assert.equal(find(0).detail, "공정 조건 기록 없음");
  assert.equal(find(3).detail, "공정 조건 기록 3건");
  assert.equal(find(null, [{ status: "completed" }]).detail, "1/1 단계 완료"); // 공정 단계 화면은 이 기록을 쓰지 않는다
});

test("기준 수정 영향: 로트마다 최근 값만 새 기준으로 다시 보고 판정이 달라지는 것만", async () => {
  const { affectedLots } = await import("../src/domain/compare-rules.js");
  const r = (id, num, value, result, at, spec = "s1") => ({ batch: { id, batch_number: num }, specification_id: spec, value, result, measured_at: at });
  const rows = [
    r("a", "A-1", 102, "pass", "2026-10-03T00:00:00Z"),
    r("a", "A-1", 70, "out_of_spec", "2026-10-01T00:00:00Z"),
    r("b", "B-1", 98, "pass", "2026-10-02T00:00:00Z"),
    r("c", "C-1", 100, "pass", "2026-10-04T00:00:00Z", "s2"),
  ];
  const next = { min_value: 80, max_value: 125, alert_min_value: 105, alert_max_value: 115 };
  const result = affectedLots(rows, "s1", next);
  assert.deepEqual(result.map((e) => [e.batchNumber, e.from, e.to]), [["A-1", "pass", "out_of_alert"], ["B-1", "pass", "out_of_alert"]]);
  assert.deepEqual(affectedLots(rows, "s1", { min_value: 80, max_value: 125 }), []);
});

test("기준 수정 영향: 지금 기준과 비교하면 측정 뒤 기준 버전이 바뀐 값이 값을 안 고쳐도 달라진 것으로 나오지 않는다", async () => {
  const { affectedLots } = await import("../src/domain/compare-rules.js");
  // 예전 기준(v1: 관리기준 90~115)으로 pass였던 값 85가 아니라, 저장된 판정(pass)과 지금 기준의 판정이 다른 값
  const rows = [{ batch: { id: "a", batch_number: "A-1" }, specification_id: "s1", value: 85, result: "pass", measured_at: "2026-10-01T00:00:00Z" }];
  const current = { min_value: 80, max_value: 125, alert_min_value: 90, alert_max_value: 115 }; // 지금(v2): 85는 관리기준 이탈
  // 값을 하나도 안 고친 채 비교: 저장된 판정(pass) 기준이면 "달라짐"으로 잘못 나오지만, 지금 기준과 비교하면 달라지지 않는다
  assert.equal(affectedLots(rows, "s1", current).length, 1);
  assert.equal(affectedLots(rows, "s1", current, current).length, 0);
  // 실제로 고치면(관리기준 하한 80) 지금 기준(관리기준 이탈)에서 정상으로 달라진다
  const next = { ...current, alert_min_value: 80 };
  assert.deepEqual(affectedLots(rows, "s1", next, current).map((e) => [e.from, e.to]), [["out_of_alert", "pass"]]);
});
