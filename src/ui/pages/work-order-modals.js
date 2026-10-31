// IA WO_010100_MD 작성, WO_010101_MD 발행, WO_010102_MD 착수, WO_010103_MD 취소 (spec 010 FR-001~004)
import { h } from "../dom.js";
import { openModal, field } from "../modal.js";
import {
  WORK_ORDER_UNITS, checkCancelReason, checkLotNumber, checkPlannedPeriod, checkPlannedQuantity, checkUnit, periodText, quantityText,
} from "../../domain/work-order-rules.js";
import { listProducts } from "../../infrastructure/store.js";
import { cancelWorkOrder, createWorkOrder, releaseWorkOrder, startWorkOrder } from "../../infrastructure/store-work-orders.js";

// 창 위쪽에 무엇을 다루는지 보여 준다: "WO-2611-001 · 인플루엔자 … · 5,000 바이알 · 11-02 ~ 11-06"
function summary(order) {
  return h("p", { class: "mono" },
    `${order.order_number} · ${order.product?.item_name ?? ""} · ${quantityText(order)} · ${periodText(order)}`);
}

/** FR-001: 작성. 번호는 데이터베이스가 매긴다 (Q61) @param {(notice: string) => void} onSaved */
export async function openCreateModal(onSaved) {
  const products = await listProducts();
  const product = h("select", { class: "select", name: "product", required: true },
    h("option", { value: "" }, "제품을 고르세요"),
    ...products.map((item) => h("option", { value: item.id }, item.item_name)));
  const quantity = h("input", { class: "input", name: "planned_quantity", inputmode: "decimal", autocomplete: "off", required: true });
  const unit = h("select", { class: "select", name: "unit" }, ...WORK_ORDER_UNITS.map((value) => h("option", { value }, value)));
  const start = h("input", { class: "input", name: "planned_start", type: "date", required: true });
  const end = h("input", { class: "input", name: "planned_end", type: "date", required: true });
  const note = h("textarea", { class: "input", name: "note", rows: "2", maxlength: "200" });

  openModal({
    title: "작업지시 작성",
    fields: [
      field("제품", product), field("계획 수량", quantity, "0보다 크고 1,000,000 이하. 예: 5000"), field("단위", unit),
      field("계획 시작일", start), field("계획 종료일", end, "시작일과 같거나 뒤"), field("메모 (선택)", note, "200자까지"),
    ],
    submitLabel: "작성",
    onSubmit: async () => {
      if (!product.value) throw new Error("제품을 골라 주세요.");
      const checkedQuantity = checkPlannedQuantity(quantity.value);
      if (!checkedQuantity.ok) throw new Error(checkedQuantity.error);
      const checkedUnit = checkUnit(unit.value);
      if (!checkedUnit.ok) throw new Error(checkedUnit.error);
      const checkedPeriod = checkPlannedPeriod(start.value, end.value);
      if (!checkedPeriod.ok) throw new Error(checkedPeriod.error);
      const saved = await createWorkOrder({
        product_id: product.value, planned_quantity: checkedQuantity.value, unit: checkedUnit.value,
        planned_start: start.value, planned_end: end.value, note: note.value,
      });
      onSaved(`작업지시 ${saved.order_number}을 작성했습니다. QA 관리자가 발행하면 착수할 수 있습니다.`);
    },
  });
}

/** FR-002: 발행 (QA 관리자). 내용을 보여 주고 확인받는다 */
export function openReleaseModal(order, onSaved) {
  openModal({
    title: "작업지시 발행",
    fields: [
      summary(order),
      h("p", null, `작성 ${order.creator?.display_name ?? ""}`),
      order.note ? h("p", { class: "muted" }, `메모: ${order.note}`) : null,
      h("p", { class: "muted" }, "발행하면 생산 담당자에게 알림이 가고, 생산 담당자가 착수할 수 있습니다."),
    ].filter(Boolean),
    submitLabel: "발행",
    onSubmit: async () => {
      await releaseWorkOrder(order.id);
      onSaved(`작업지시 ${order.order_number}을 발행했습니다.`);
    },
  });
}

/** FR-003: 착수 — 로트번호를 받아 생산 중 로트를 만들고 그 로트로 간다 */
export function openStartModal(order) {
  const lotNumber = h("input", { class: "input mono", name: "batch_number", maxlength: "40", autocomplete: "off", required: true, value: order.planned_lot ?? "" });
  const hint = order.planned_lot
    ? "제품 약자·착수하는 달·다음 번호로 미리 넣었습니다. 필요하면 바꿀 수 있습니다. 착수하면 이 번호로 생산 중 로트가 생깁니다."
    : "예: IFV-2610-005처럼 제품 약자로 시작합니다. 착수하면 이 번호로 생산 중 로트가 생깁니다.";
  openModal({
    title: "작업 착수",
    fields: [
      summary(order),
      field("로트번호", lotNumber, hint),
    ],
    submitLabel: "착수",
    onSubmit: async () => {
      const checked = checkLotNumber(lotNumber.value);
      if (!checked.ok) throw new Error(checked.error);
      const started = await startWorkOrder(order.id, checked.value);
      location.hash = `#/batches/${started.batch_id}`;
    },
  });
}

/** FR-004: 취소 (작성·발행 상태만, 사유 필수) */
export function openCancelModal(order, onSaved) {
  const reason = h("textarea", { class: "input", name: "cancel_reason", rows: "2", maxlength: "200", required: true });
  openModal({
    title: "작업지시 취소",
    fields: [summary(order), field("취소 사유", reason, "200자까지. 취소한 작업지시는 되돌릴 수 없습니다.")],
    submitLabel: "작업지시 취소",
    onSubmit: async () => {
      const checked = checkCancelReason(reason.value);
      if (!checked.ok) throw new Error(checked.error);
      await cancelWorkOrder(order.id, checked.value);
      onSaved(`작업지시 ${order.order_number}을 취소했습니다.`);
    },
  });
}
