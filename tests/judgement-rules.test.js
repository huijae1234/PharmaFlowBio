import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAlertRange, criteriaText, issueKindLabel, resultLabel, ISSUE_STATUS_LABELS } from "../src/domain/judgement-rules.js";

const ALERT_ERROR = "사내 관리기준은 시험 규격 안쪽 범위로, 최솟값과 최댓값을 함께 입력해 주세요.";

test("관리기준은 둘 다 비우거나, 규격 안쪽으로 둘 다 (FR-001 수용 기준 1·2, 경계·예외)", () => {
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: null, alertMax: null }), { ok: true });
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: 90, alertMax: 115 }), { ok: true });
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: 80, alertMax: 125 }), { ok: true });
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: 100, alertMax: 100 }), { ok: true });
  assert.deepEqual(checkAlertRange({ min: 80, max: 125 }), { ok: true });
});

test("한쪽만, 규격 밖, 뒤집힘은 거부 (FR-001 수용 기준 3)", () => {
  const bad = { ok: false, error: ALERT_ERROR };
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: 90, alertMax: null }), bad);
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: null, alertMax: 115 }), bad);
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: 70, alertMax: 115 }), bad);
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: 90, alertMax: 130 }), bad);
  assert.deepEqual(checkAlertRange({ min: 80, max: 125, alertMin: 115, alertMax: 90 }), bad);
});

test("판정·이슈 종류 이름은 GLOSSARY 용어 (FR-003, FR-005)", () => {
  assert.equal(resultLabel("pass"), "정상");
  assert.equal(resultLabel("out_of_alert"), "관리기준 이탈");
  assert.equal(resultLabel("out_of_spec"), "규격 이탈");
  assert.equal(issueKindLabel("spec"), "규격 이탈");
  assert.equal(issueKindLabel("alert"), "관리기준 이탈");
});

test("기준 글자: 기준이면 지금 값, 측정값이면 그때 값 (FR-004)", () => {
  const spec = { min_value: 80, max_value: 125, alert_min_value: 90, alert_max_value: 115, version: 2 };
  assert.equal(criteriaText(spec), "규격 80~125 · 관리기준 90~115 · v2");
  const old = { applied_min_value: 95, applied_max_value: 105, applied_alert_min_value: null, applied_alert_max_value: null, applied_spec_version: 1 };
  assert.equal(criteriaText(old), "규격 95~105 · 관리기준 없음 · v1");
});

test("단위가 있으면 범위 뒤에 붙인다", () => {
  const spec = { min_value: 0, max_value: 10, alert_min_value: 0, alert_max_value: 5, version: 1 };
  assert.equal(criteriaText(spec, "EU/mL"), "규격 0~10 EU/mL · 관리기준 0~5 EU/mL · v1");
});

test("품질 이슈 상태 이름: 처리 중·종결 (spec 007 FR-005)", () => {
  assert.deepEqual(ISSUE_STATUS_LABELS, { open: "처리 중", closed: "종결" });
});
