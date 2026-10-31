import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routesFor, availableActions, checkQuantity, checkLocation, checkReturnQuantity, retainedQuantity, routeLabel,
} from "../src/domain/sample-rules.js";

const transfer = (from_team, to_team, status, extra = {}) => ({
  from_team, to_team, status, sample_kind: from_team === "production" && to_team === "qc" ? "test" : "retention", quantity: 2, ...extra,
});

test("역할별 길: 생산 2길, QA는 QA → QC 하나, QC·열람자는 없음 (spec 008 FR-001 수용 기준 2~4)", () => {
  assert.deepEqual(routesFor("production_operator").map(routeLabel), ["생산 → QC · 시험 검체", "생산 → QA · 보존 검체"]);
  assert.deepEqual(routesFor("qa_manager").map(routeLabel), ["QA → QC · 보존 검체"]);
  assert.deepEqual(routesFor("qc_analyst"), []);
  assert.deepEqual(routesFor("viewer"), []);
  assert.deepEqual(routesFor(undefined), []);
});

test("버튼: 인수 대기는 받는 팀만 인수 확인 (FR-002 수용 기준 2)", () => {
  const toQa = transfer("production", "qa", "pending");
  assert.deepEqual(availableActions("qa_manager", toQa), ["receive"]);
  assert.deepEqual(availableActions("production_operator", toQa), []);
  assert.deepEqual(availableActions("qc_analyst", toQa), []);
  assert.deepEqual(availableActions("viewer", toQa), []);
});

test("버튼: 보관 중은 받는 팀이 반납, QC가 받은 건만 소진 (FR-003, FR-004)", () => {
  assert.deepEqual(availableActions("qc_analyst", transfer("production", "qc", "held")), ["return", "consume"]);
  assert.deepEqual(availableActions("qc_analyst", transfer("qa", "qc", "held")), ["return", "consume"]);
  assert.deepEqual(availableActions("qa_manager", transfer("production", "qa", "held")), ["return"]);
  assert.deepEqual(availableActions("production_operator", transfer("production", "qa", "held")), []);
});

test("버튼: 반납 대기는 보낸 팀만 반납 확인, 끝난 건은 버튼 없음 (FR-003 수용 기준 2)", () => {
  assert.deepEqual(availableActions("qa_manager", transfer("qa", "qc", "return_pending")), ["confirm_return"]);
  assert.deepEqual(availableActions("qc_analyst", transfer("qa", "qc", "return_pending")), []);
  assert.deepEqual(availableActions("production_operator", transfer("production", "qc", "return_pending")), ["confirm_return"]);
  for (const status of ["returned", "consumed"]) {
    for (const role of ["qa_manager", "qc_analyst", "production_operator", "viewer"]) {
      assert.deepEqual(availableActions(role, transfer("qa", "qc", status)), [], `${role} ${status}`);
    }
  }
});

test("수량: 1~9999 정수만 (spec 008 경계 상황)", () => {
  const error = { ok: false, error: "수량은 1부터 9999까지 숫자로 입력해 주세요." };
  for (const text of ["0", "-1", "1.5", "", "  ", "10000", "abc", null, undefined]) {
    assert.deepEqual(checkQuantity(text), error, `입력: ${text}`);
  }
  assert.deepEqual(checkQuantity(" 1 "), { ok: true, value: 1 });
  assert.deepEqual(checkQuantity("9999"), { ok: true, value: 9999 });
});

test("보관 위치: 공백 정리, 1~60자 (FR-002 수용 기준 3)", () => {
  const empty = { ok: false, error: "보관 위치를 입력해 주세요. 예: 보존검체실 냉장고 R-02 3단" };
  assert.deepEqual(checkLocation("   "), empty);
  assert.deepEqual(checkLocation(undefined), empty);
  assert.deepEqual(checkLocation("x".repeat(61)), { ok: false, error: "보관 위치는 60자까지 입력해 주세요." });
  assert.deepEqual(checkLocation("  QC 시험실 냉장고 R-01 "), { ok: true, value: "QC 시험실 냉장고 R-01" });
});

test("반납 수량: 1부터 받은 수량까지 (FR-003 수용 기준 3)", () => {
  const error = { ok: false, error: "반납 수량은 1부터 받은 수량(2)까지 입력해 주세요." };
  for (const text of ["0", "3", "-1", "1.5", ""]) assert.deepEqual(checkReturnQuantity(text, 2), error, `입력: ${text}`);
  assert.deepEqual(checkReturnQuantity("1", 2), { ok: true, value: 1 });
  assert.deepEqual(checkReturnQuantity("2", 2), { ok: true, value: 2 });
});

test("QA 보관 중 보존 검체 수 (FR-006, Q47)", () => {
  const records = [
    transfer("production", "qa", "held", { quantity: 4 }),
    transfer("production", "qa", "pending", { quantity: 4 }),
    transfer("qa", "qc", "returned", { quantity: 2, returned_quantity: 1 }),
    transfer("production", "qc", "held", { quantity: 6 }),
  ];
  assert.equal(retainedQuantity(records), 3);
  assert.equal(retainedQuantity([...records, transfer("qa", "qc", "pending", { quantity: 1 })]), 2);
  assert.equal(retainedQuantity([]), 0);
});

// ── spec 018 보관 기한·폐기 ──
import {
  SAMPLE_STATUS_LABELS, retentionDueDate, isRetentionDue, canDispose, checkDisposal, disposalQuantity, seoulDate,
} from "../src/domain/sample-rules.js";

const retention = (extra = {}) => transfer("production", "qa", "held", { quantity: 4, received_at: "2026-10-12T02:00:00Z", ...extra });

test("검체 상태 이름에 폐기 (spec 018 FR-004)", () => {
  assert.equal(SAMPLE_STATUS_LABELS.disposed, "폐기");
});

test("보관 기한: 인수한 한국 날짜 + 2년, 생산 → QA 보존 검체만 (spec 018 FR-002, Q80)", () => {
  assert.equal(retentionDueDate(retention()), "2028-10-12");
  assert.equal(retentionDueDate(retention({ received_at: "2026-10-11T15:30:00Z" })), "2028-10-12"); // 한국 0시 30분
  assert.equal(retentionDueDate(retention({ received_at: "2026-10-11T14:59:00Z" })), "2028-10-11");
  assert.equal(retentionDueDate(retention({ received_at: "2024-02-29T01:00:00Z" })), "2026-02-28");
  assert.equal(retentionDueDate(retention({ status: "disposed" })), "2028-10-12"); // 끝난 건도 기한은 보인다
  assert.equal(retentionDueDate(transfer("production", "qc", "held", { received_at: "2026-10-12T02:00:00Z" })), null);
  assert.equal(retentionDueDate(transfer("qa", "qc", "held", { received_at: "2026-10-12T02:00:00Z" })), null);
  assert.equal(retentionDueDate(transfer("production", "qa", "pending")), null);
});

test("한국 날짜 (spec 018 경계 상황)", () => {
  assert.equal(seoulDate(new Date("2026-10-27T15:00:00Z")), "2026-10-28");
  assert.equal(seoulDate(new Date("2026-10-27T14:59:59Z")), "2026-10-27");
});

test("기한 지남: 보관 중이고 오늘 ≥ 기한 (spec 018 FR-002 수용 기준 3·4)", () => {
  assert.equal(isRetentionDue(retention(), "2028-10-12"), true);
  assert.equal(isRetentionDue(retention(), "2028-10-11"), false);
  assert.equal(isRetentionDue(retention({ status: "disposed" }), "2029-01-01"), false);
  assert.equal(isRetentionDue(retention({ status: "returned" }), "2029-01-01"), false);
  assert.equal(isRetentionDue(transfer("production", "qc", "held"), "2029-01-01"), false);
});

test("폐기 버튼: QA 관리자 + 기한 지남만 (spec 018 FR-004 수용 기준 1)", () => {
  assert.equal(canDispose("qa_manager", retention(), "2028-10-12"), true);
  assert.equal(canDispose("qc_analyst", retention(), "2028-10-12"), false);
  assert.equal(canDispose("production_operator", retention(), "2028-10-12"), false);
  assert.equal(canDispose("viewer", retention(), "2028-10-12"), false);
  assert.equal(canDispose("qa_manager", retention(), "2028-10-11"), false);
  assert.equal(canDispose("qa_manager", retention({ status: "disposed" }), "2029-01-01"), false);
});

test("폐기 입력 검사 (spec 018 경계 상황)", () => {
  const now = new Date("2028-10-20T03:00:00Z");
  const base = { note: "", now, dueDate: "2028-10-12" };
  assert.deepEqual(checkDisposal({ ...base, disposedAt: "" }), { ok: false, error: "폐기 일시를 입력해 주세요." });
  assert.deepEqual(checkDisposal({ ...base, disposedAt: "2028-10-21T10:00" }), { ok: false, error: "폐기 일시는 지금보다 뒤일 수 없습니다." });
  assert.deepEqual(checkDisposal({ ...base, disposedAt: "2028-10-11T23:00:00+09:00" }), { ok: false, error: "폐기 일시는 보관 기한 뒤여야 합니다." });
  assert.deepEqual(checkDisposal({ ...base, disposedAt: "2028-10-12T00:10:00+09:00", note: "가".repeat(201) }),
    { ok: false, error: "메모는 200자까지 입력해 주세요." });
  assert.deepEqual(checkDisposal({ ...base, disposedAt: "2028-10-12T00:10:00+09:00", note: "  소각 위탁  " }),
    { ok: true, value: { disposedAt: "2028-10-11T15:10:00.000Z", note: "소각 위탁" } });
  assert.deepEqual(checkDisposal({ ...base, disposedAt: "2028-10-20T11:00:00+09:00" }),
    { ok: true, value: { disposedAt: "2028-10-20T02:00:00.000Z", note: null } });
});

test("폐기 수량·보관 수: 기록 수량과 QA 보관 수 중 작은 값, 폐기 뒤 0 (spec 018 FR-004 수용 기준 4, Q82)", () => {
  const record = retention();
  const lent = transfer("qa", "qc", "returned", { quantity: 2, returned_quantity: 1 });
  assert.equal(disposalQuantity(record, [record, lent]), 3);
  assert.equal(disposalQuantity(record, [record]), 4);
  const disposed = { ...record, status: "disposed", disposed_quantity: 3 };
  assert.equal(retainedQuantity([disposed, lent]), 0);
  assert.equal(retainedQuantity([{ ...record, status: "disposed", disposed_quantity: 4 }]), 0);
});
