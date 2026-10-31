import { test } from "node:test";
import assert from "node:assert/strict";
import { canShip, checkShipment, shipmentText } from "../src/domain/shipment-rules.js";
import { batchStatusLabel, isBatchEditable } from "../src/domain/batch-rules.js";

const NOW = new Date("2026-10-28T05:00:00Z");

test("출하 완료 버튼: 생산 담당자이고 출하 가능 로트일 때만 (spec 017 FR-005 수용 기준 3·4)", () => {
  assert.equal(canShip("releasable", "production_operator"), true);
  for (const role of ["qa_manager", "qc_analyst", "viewer"]) assert.equal(canShip("releasable", role), false, role);
  for (const status of ["in_production", "in_testing", "on_hold", "discarded", "shipped"]) {
    assert.equal(canShip(status, "production_operator"), false, status);
  }
});

test("출하 일시·메모 검사 (FR-005 경계 상황)", () => {
  assert.deepEqual(checkShipment({ shippedAt: "", note: "", now: NOW }), { ok: false, error: "출하 일시를 입력해 주세요." });
  assert.deepEqual(checkShipment({ shippedAt: "2026-10-28T05:01:00Z", note: "", now: NOW }),
    { ok: false, error: "출하 일시는 지금보다 뒤일 수 없습니다." });
  assert.deepEqual(checkShipment({ shippedAt: "2026-10-28T04:00:00Z", note: "가".repeat(201), now: NOW }),
    { ok: false, error: "메모는 200자까지 입력해 주세요." });
  assert.deepEqual(checkShipment({ shippedAt: "2026-10-28T04:00:00Z", note: "  1차 출고 ", now: NOW }),
    { ok: true, value: { shippedAt: "2026-10-28T04:00:00.000Z", note: "1차 출고" } });
  assert.deepEqual(checkShipment({ shippedAt: "2026-10-28T05:00:00Z", note: " ", now: NOW }),
    { ok: true, value: { shippedAt: "2026-10-28T05:00:00.000Z", note: null } });
});

test("출하 완료 이름과 읽기만 (FR-006)", () => {
  assert.equal(batchStatusLabel("shipped"), "출하 완료");
  assert.equal(isBatchEditable("shipped"), false);
});

test("로트 위쪽 출하 완료 줄 (FR-005 수용 기준 1)", () => {
  const fmt = (iso) => `T(${iso.slice(11, 16)})`;
  const batch = { status: "shipped", shipped_at: "2026-10-28T05:00:00Z", shipper: { display_name: "김희재" } };
  assert.equal(shipmentText(batch, fmt), "출하 완료 · T(05:00) · 김희재");
  assert.equal(shipmentText({ status: "releasable" }, fmt), "");
});
