// spec 025 v0.6 FR-010 (plan v0.5 10단계): AI 도우미 앱 전체 조회 13가지 — 목록·역할·조건 검사·결과 → 근거 줄
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_QUERIES, checkQueryInput, queriesFor, queryScope, queryTool } from "../src/domain/app-query-rules.js";
import { QUERY_TOP, queryFacts } from "../src/domain/app-query-facts.js";

const NOW = new Date("2026-10-29T03:00:00.000Z"); // 한국 10/29 12시
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

test("조회 13가지, 역할별로 QA 13·QC 9·생산 11, 열람자 0 (FR-010 조회 목록)", () => {
  assert.equal(Object.keys(APP_QUERIES).length, 13);
  assert.deepEqual(["qa_manager", "qc_analyst", "production_operator", "viewer"].map((role) => queriesFor(role).length), [13, 9, 11, 0]);
  assert.ok(!queriesFor("qc_analyst").includes("pending_reviews"));
  assert.ok(queriesFor("production_operator").includes("overdue_orders"));
  assert.ok(!queriesFor("production_operator").includes("pending_requests"));
});

test("조건 검사: 모르는 조회·못 쓰는 조회는 이유와 함께 거부, 기간은 기본 30·7~180 안으로, 조치 종류는 정해진 값만 (Q101, FR-010 수용 기준 3·6)", () => {
  assert.deepEqual(checkQueryInput("qa_manager", { query: "drop_all" }), { ok: false, reason: "조회 목록에 없는 조회입니다. 조회 목록 밖의 기록은 찾을 수 없습니다." });
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "pending_reviews" }), { ok: false, reason: "평가 검토 대기는 QA 관리자가 보는 기록이라 이 역할로는 조회하지 않습니다." });
  assert.deepEqual(checkQueryInput("production_operator", { query: "pending_requests" }).ok, false);
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "issues_by_product" }), { ok: true, kind: "issues_by_product", params: { days: 30 } });
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "issues_by_product", days: 3 }).params, { days: 7 });
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "issues_by_product", days: 400 }).params, { days: 180 });
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "issues_by_product", days: "많이" }).params, { days: 30 });
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "old_open_issues" }).params, { days: 7 });
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "lot_status_counts", days: 90, sql: "x" }).params, {}); // 조건 없는 조회, 모르는 칸은 버림
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "my_actions", action_type: "retest" }).params, { actionType: "retest" });
  assert.deepEqual(checkQueryInput("qc_analyst", { query: "my_actions", action_type: "delete" }).params, {});
  assert.equal(checkQueryInput("qa_manager", null).ok, false);
});

test("AI 도구 설명: 그 역할이 쓸 수 있는 조회만 고를 수 있고, 조건은 기간·조치 종류뿐", () => {
  const tool = queryTool("production_operator");
  assert.equal(tool.name, "app_query");
  assert.deepEqual(tool.input_schema.properties.query.enum, queriesFor("production_operator"));
  assert.deepEqual(Object.keys(tool.input_schema.properties).sort(), ["action_type", "days", "query"]);
  assert.deepEqual(tool.input_schema.required, ["query"]);
  assert.match(tool.description, /제품별 품질 이슈/);
  assert.ok(!tool.description.includes("평가 검토 대기")); // 생산은 못 쓰는 조회
});

test("조회 이름·조건 글 (답 아래 \"조회:\" 줄)", () => {
  assert.equal(queryScope("issues_by_product", { days: 30 }), "제품별 품질 이슈 · 최근 30일");
  assert.equal(queryScope("old_open_issues", { days: 7 }), "오래 열린 이슈 · 7일 넘게 처리 중");
  assert.equal(queryScope("lot_status_counts", {}), "상태별 로트 수");
});

const issue = (product, kind, source = "test") => ({ id: `${product}-${kind}-${source}`, kind, source, status: "open", opened_at: daysAgo(3), batch: { id: "b", batch_number: "X-2610-001", product: { item_name: product } } });

test("제품별 품질 이슈: 많은 순으로 묶어 세고 종류를 나눈다, 요약 줄에 전체 건수 (FR-010 수용 기준 1)", () => {
  const rows = [issue("Tdap", "spec"), issue("HBV", "spec"), issue("HBV", "alert"), issue("HBV", "spec", "process")];
  const facts = queryFacts("issues_by_product", { rows, truncated: false }, { params: { days: 30 }, now: NOW, prefix: "q1" });
  assert.deepEqual(facts.map((row) => [row.id, row.value, row.state]), [
    ["q1", "새 품질 이슈 4건 · 제품 2개", "ok"],
    ["q1_1", "HBV: 3건 (규격 이탈 1건 · 관리기준 이탈 1건 · 공정 이탈 1건)", "ok"],
    ["q1_2", "Tdap: 1건 (규격 이탈 1건)", "ok"],
  ]);
  assert.equal(facts[0].label, "제품별 품질 이슈 · 최근 30일");
});

test("못 읽음·일부만·10줄 상한: 0으로 바꾸지 않는다, 넘으면 앞 10줄과 \"일부만\" (FR-010 수용 기준 5, Q104)", () => {
  assert.deepEqual(queryFacts("issues_by_product", null, { params: { days: 30 }, now: NOW, prefix: "q1" }).map((row) => [row.id, row.value, row.state]), [["q1", "읽지 못했습니다(알 수 없음)", "failed"]]);
  const many = Array.from({ length: 12 }, (_, index) => ({ id: `i${index}`, kind: "spec", source: "test", status: "open", opened_at: daysAgo(10 + index), batch: { id: `b${index}`, batch_number: `HBV-2610-${String(index).padStart(3, "0")}`, product: { item_name: "HBV" } } }));
  const facts = queryFacts("old_open_issues", { rows: many, truncated: true }, { params: { days: 7 }, now: NOW, prefix: "q2" });
  assert.equal(facts.length, 1 + QUERY_TOP);
  assert.equal(facts[0].value, "12건 이상 · 앞 10건만 · 일부만 읽었습니다");
  assert.equal(facts[1].value, "로트 HBV-2610-011 · 규격 이탈 · 21일째 처리 중"); // 오래된 순
  assert.equal(facts[1].href, "#/issues/i11");
});

test("오래 열린 이슈는 기준 일수를 넘은 것만, 없으면 0건이 아니라 \"없습니다\"", () => {
  const facts = queryFacts("old_open_issues", { rows: [{ id: "i1", kind: "alert", source: "test", status: "open", opened_at: daysAgo(2), batch: { id: "b", batch_number: "IFV-2610-002", product: { item_name: "IFV" } } }], truncated: false }, { params: { days: 7 }, now: NOW, prefix: "q1" });
  assert.deepEqual(facts.map((row) => row.value), ["0건 (조건에 맞는 기록이 없습니다)"]);
});

test("상태별 로트 수·출하 검토 결과·검체·진행 중 단계·항목별 이탈·규격 이탈 로트·승인 대기 조치 요청 (FR-010 조회 목록)", () => {
  const status = queryFacts("lot_status_counts", { rows: [{ status: "on_hold" }, { status: "on_hold" }, { status: "shipped" }], truncated: false }, { params: {}, now: NOW, prefix: "q1" });
  assert.deepEqual(status.map((row) => row.value), ["로트 3개", "보류 2개", "출하 완료 1개"]);
  const decisions = queryFacts("release_decisions", { rows: [
    { batch_id: "b1", batch_number: "HBV-2610-004", action: "출하 완료", created_at: daysAgo(1), status: "shipped" },
    { batch_id: "b2", batch_number: "HBV-2610-003", action: "내부 출하 검토", created_at: daysAgo(5), status: "discarded" },
  ], truncated: false }, { params: { days: 30 }, now: NOW, prefix: "q2" });
  assert.deepEqual(decisions.map((row) => row.value), ["2건 · 출하 완료 1건 · 폐기 1건", "로트 HBV-2610-004 · 출하 완료 · 10/28", "로트 HBV-2610-003 · 폐기 · 10/24"]);
  const samples = queryFacts("samples_to_check", { rows: [{ id: "s1", status: "pending", from_team: "production", to_team: "qc", sample_kind: "test", quantity: 10, unit: "바이알", sent_at: daysAgo(2), batch: { id: "b", batch_number: "IFV-2610-002" } }], truncated: false }, { params: {}, now: NOW, prefix: "q3" });
  assert.deepEqual(samples.map((row) => row.value), ["1건", "로트 IFV-2610-002 · 생산 → QC 시험 검체 10바이알 · 인수 대기 2일째"]);
  const steps = queryFacts("running_steps", { rows: [{ id: "r1", step_label: "충전", started_at: daysAgo(1), batch: { id: "b9", batch_number: "TDP-2610-003" } }], truncated: false }, { params: {}, now: NOW, prefix: "q4" });
  assert.deepEqual(steps.map((row) => [row.value, row.href]), [["1건", null], ["로트 TDP-2610-003 · 충전 · 1일째 진행 중", "#/batches/b9?tab=process"]]);
  const items = queryFacts("deviations_by_item", { rows: [
    { result: "out_of_spec", specification: { item_name: "역가", category: "test" } }, { result: "out_of_alert", specification: { item_name: "역가", category: "test" } },
    { result: "out_of_spec", specification: { item_name: "보관 온도", category: "process" } },
  ], truncated: false }, { params: { days: 90 }, now: NOW, prefix: "q5" });
  assert.deepEqual(items.map((row) => row.value), ["이탈 측정값 3건 · 항목 2개", "역가(시험): 2건 (규격 이탈 1건 · 관리기준 이탈 1건)", "보관 온도(공정): 1건 (규격 이탈 1건)"]);
  const lots = queryFacts("out_of_spec_lots", { rows: [
    { batch: { id: "b1", batch_number: "HBV-2610-001", product: { item_name: "HBV" } }, specification: { item_name: "역가" } },
    { batch: { id: "b1", batch_number: "HBV-2610-001", product: { item_name: "HBV" } }, specification: { item_name: "역가" } },
  ], truncated: false }, { params: { days: 30 }, now: NOW, prefix: "q6" });
  assert.deepEqual(lots.map((row) => [row.value, row.href]), [["로트 1개 · 규격 이탈 측정값 2건", null], ["로트 HBV-2610-001 · HBV · 역가 2건", "#/batches/b1"]]);
  const requests = queryFacts("pending_requests", { rows: [{ id: "a1", action_type: "retest", requested_at: daysAgo(4), quality_issue_id: "i1", issue: { batch: { batch_number: "HBV-2610-002" } } }], truncated: false }, { params: { days: 0 }, now: NOW, prefix: "q7" });
  assert.deepEqual(requests.map((row) => row.value), ["1건", "로트 HBV-2610-002 · 재시험 · 승인 대기 4일째"]);
});

test("업무 찾아보기 4종은 그 규칙(askRows)을 다시 쓴다, 근거 줄에 사람 이름·이메일이 없다 (FR-010 수용 기준 7)", () => {
  const held = queryFacts("held_lots", { rows: [{ id: "b1", batch_number: "TDP-2610-001", hold_reason: "보관 온도", product: { item_name: "Tdap" } }], issues: [{ batch_id: "b1", opened_at: daysAgo(4) }], truncated: false }, { params: { days: 0 }, now: NOW, prefix: "q1" });
  assert.deepEqual(held.map((row) => row.value), ["1건", "로트 TDP-2610-001 · Tdap · 보류 사유 보관 온도 · 가장 오래된 열린 이슈 4일째"]);
  const orders = queryFacts("overdue_orders", { rows: [{ id: "w1", order_number: "WO-2610-010", planned_end: "2026-10-28", status: "in_progress", product: { item_name: "IFV" } }], truncated: false }, { params: { days: 1 }, now: NOW, prefix: "q2" });
  assert.match(orders[1].value, /^작업지시 WO-2610-010 · IFV · 진행 중 · 계획 종료일 2026-10-28\(1일 지남\)$/);
  const text = JSON.stringify([...held, ...orders]);
  assert.ok(!/@|display_name/.test(text));
});
