import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORK_ORDER_STATUS_LABELS, WORK_ORDER_UNITS, workOrderActions, checkPlannedQuantity, checkPlannedPeriod,
  checkUnit, checkLotNumber, checkCancelReason, ordersToStart, quantityText, periodText, lotPrefix, plannedLotNumbers,
} from "../src/domain/work-order-rules.js";

const STATUSES = ["draft", "released", "in_progress", "completed", "cancelled"];
const order = (status, extra = {}) => ({ status, planned_start: "2026-11-02", ...extra });

test("상태 이름은 작성·발행·진행 중·완료·취소, 단위는 네 가지 (spec 010 FR-005, Q62)", () => {
  assert.deepEqual(STATUSES.map((s) => WORK_ORDER_STATUS_LABELS[s]), ["작성", "발행", "진행 중", "완료", "취소"]);
  assert.deepEqual(WORK_ORDER_UNITS, ["바이알", "mL", "L", "개"]);
});

test("계획 수량: 0보다 크고 1,000,000 이하 숫자, 소수 허용 (경계 상황)", () => {
  for (const text of ["", "  ", "0", "-1", "abc", "1e3"]) {
    assert.deepEqual(checkPlannedQuantity(text), { ok: false, error: "계획 수량은 0보다 큰 숫자로 입력해 주세요." }, text);
  }
  assert.deepEqual(checkPlannedQuantity("1000001"), { ok: false, error: "계획 수량이 너무 큽니다. 1,000,000 이하로 입력해 주세요." });
  assert.deepEqual(checkPlannedQuantity("0.5"), { ok: true, value: 0.5 });
  assert.deepEqual(checkPlannedQuantity(" 5000 "), { ok: true, value: 5000 });
  assert.deepEqual(checkPlannedQuantity("1000000"), { ok: true, value: 1000000 });
});

test("계획 기간: 빈 값·종료일이 시작일 앞이면 막고, 같은 날은 허용 (경계 상황)", () => {
  const empty = { ok: false, error: "계획 시작일과 종료일을 입력해 주세요." };
  assert.deepEqual(checkPlannedPeriod("", "2026-11-06"), empty);
  assert.deepEqual(checkPlannedPeriod("2026-11-02", ""), empty);
  assert.deepEqual(checkPlannedPeriod("2026-11-06", "2026-11-02"),
    { ok: false, error: "계획 종료일은 시작일과 같거나 뒤여야 합니다." });
  assert.deepEqual(checkPlannedPeriod("2026-11-02", "2026-11-02"), { ok: true });
  assert.deepEqual(checkPlannedPeriod("2026-11-02", "2026-11-06"), { ok: true });
});

test("단위·로트번호 검사 (Q62, FR-003 경계 상황)", () => {
  assert.deepEqual(checkUnit("g"), { ok: false, error: "단위를 골라 주세요." });
  assert.deepEqual(checkUnit("바이알"), { ok: true, value: "바이알" });
  assert.deepEqual(checkLotNumber("   "), { ok: false, error: "로트번호를 입력해 주세요." });
  assert.deepEqual(checkLotNumber(" IFV-2610-005 "), { ok: true, value: "IFV-2610-005" });
  // 작업지시 번호를 로트번호로 쓴 일이 있었다 (2026-10-29 사용자: WO-2611-002 등 로트 이름 바꿈)
  assert.deepEqual(checkLotNumber("wo-2611-002"), { ok: false, error: "작업지시 번호는 로트번호로 쓸 수 없습니다. TDP-2610-005처럼 제품 약자로 시작해 주세요." });
});

test("취소 사유: 빈칸 막음, 200자까지 (FR-004 수용 기준 2)", () => {
  assert.deepEqual(checkCancelReason(" "), { ok: false, error: "취소 사유를 입력해 주세요." });
  assert.deepEqual(checkCancelReason("가".repeat(201)), { ok: false, error: "취소 사유는 200자까지 입력해 주세요." });
  assert.deepEqual(checkCancelReason(" 수량 오기 "), { ok: true, value: "수량 오기" });
});

test("버튼: QA는 작성 줄 발행·취소, 발행 줄 착수·취소 (FR-002~005)", () => {
  assert.deepEqual(workOrderActions("qa_manager", order("draft")), ["release", "cancel"]);
  assert.deepEqual(workOrderActions("qa_manager", order("released")), ["start", "cancel"]);
});

test("버튼: 생산은 발행 없이 작성 줄 취소, 발행 줄 착수·취소 (FR-002 수용 기준 2)", () => {
  assert.deepEqual(workOrderActions("production_operator", order("draft")), ["cancel"]);
  assert.deepEqual(workOrderActions("production_operator", order("released")), ["start", "cancel"]);
});

test("버튼: QC·열람자는 없고, 진행 중·완료·취소 줄은 누구에게도 없음 (FR-001 수용 기준 3, FR-003 수용 기준 3, FR-004 수용 기준 3)", () => {
  for (const status of STATUSES) {
    for (const role of ["qc_analyst", "viewer", undefined]) {
      assert.deepEqual(workOrderActions(role, order(status)), [], `${role} ${status}`);
    }
  }
  for (const status of ["in_progress", "completed", "cancelled"]) {
    for (const role of ["qa_manager", "production_operator"]) {
      assert.deepEqual(workOrderActions(role, order(status)), [], `${role} ${status}`);
    }
  }
});

test("착수할 작업지시: 발행만, 계획 시작일 빠른 순 (FR-006 수용 기준 3)", () => {
  const orders = [
    order("released", { order_number: "WO-2611-003", planned_start: "2026-11-09" }),
    order("draft", { order_number: "WO-2611-001", planned_start: "2026-11-01" }),
    order("released", { order_number: "WO-2611-002", planned_start: "2026-11-02" }),
    order("in_progress", { order_number: "WO-2610-001", planned_start: "2026-10-01" }),
  ];
  assert.deepEqual(ordersToStart(orders).map((o) => o.order_number), ["WO-2611-002", "WO-2611-003"]);
  assert.deepEqual(ordersToStart([]), []);
});

test("화면 글자: 계획 수량은 천 단위 쉼표와 단위, 기간은 월-일 (FR-005, FR-006 수용 기준 1)", () => {
  assert.equal(quantityText({ planned_quantity: "5000", unit: "바이알" }), "5,000 바이알");
  assert.equal(quantityText({ planned_quantity: 0.5, unit: "L" }), "0.5 L");
  assert.equal(periodText({ planned_start: "2026-11-02", planned_end: "2026-11-06" }), "11-02 ~ 11-06");
  assert.equal(periodText({ planned_start: "2026-11-02", planned_end: "2026-11-02" }), "11-02");
});

const LOTS = [
  { batch_number: "TDP-2610-001", product_id: "tdp" }, { batch_number: "TDP-2610-002", product_id: "tdp" }, { batch_number: "WO-2611-009", product_id: "tdp" },
  { batch_number: "IFV-2610-005", product_id: "ifv" }, { batch_number: "QA-WO-001", product_id: "ifv" }, { batch_number: "IFV-2410-001", product_id: "ifv" },
];

test("로트 약자: 그 제품 로트에서 가장 많이 쓴 약자, 작업지시(WO)·확인용(QA) 번호와 규칙 없는 번호는 빼고, 없으면 null", () => {
  assert.equal(lotPrefix(LOTS.filter((lot) => lot.product_id === "tdp").map((lot) => lot.batch_number)), "TDP");
  assert.equal(lotPrefix(["WO-2611-001", "QA-WO-001", "자유이름"]), null);
  assert.equal(lotPrefix([]), null);
});

test("착수 전 예정 로트번호: 제품 약자-착수 달(한국 시각)-다음 번호, 같은 제품 발행 작업지시는 계획 시작일 순으로 이어서 (2026-10-29 사용자 요청)", () => {
  const orders = [
    { id: "b", status: "released", product_id: "tdp", planned_start: "2026-11-04" },
    { id: "a", status: "released", product_id: "tdp", planned_start: "2026-11-01" },
    { id: "c", status: "released", product_id: "ifv", planned_start: "2026-11-02" },
    { id: "d", status: "released", product_id: "new", planned_start: "2026-11-02" },
    { id: "e", status: "in_progress", product_id: "tdp", planned_start: "2026-10-01" },
  ];
  const planned = plannedLotNumbers(orders, LOTS, new Date("2026-10-31T16:00:00Z")); // 한국 11/1 01시 → 2611
  assert.deepEqual(Object.fromEntries(planned), { a: "TDP-2611-001", b: "TDP-2611-002", c: "IFV-2611-001" });
  const october = plannedLotNumbers(orders, LOTS, new Date("2026-10-29T05:00:00Z"));
  assert.equal(october.get("a"), "TDP-2610-003"); // 같은 달 번호는 이미 있는 가장 큰 번호 다음
});
