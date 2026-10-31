// IA BT_010215_MD 출하 완료 (spec 017 FR-005). 버튼을 보일지는 shipment-rules, 실제로 막는 것은 ship_batch
import { h, localMinuteNow } from "../dom.js";
import { openModal, field } from "../modal.js";
import { checkShipment } from "../../domain/shipment-rules.js";
import { shipBatch } from "../../infrastructure/store-actions.js";

// FR-005 수용 기준 2: 내부 출하 검토 창과 같은 이유로 국가출하승인과 구분한다
const NOT_NATIONAL_RELEASE = "회사 내부 출하 기록이며 국가출하승인이 아닙니다.";

/** @param {{ batch: { id: string, batch_number: string }, onDone: (notice: string) => void }} options */
export function openShipModal({ batch, onDone }) {
  const now = localMinuteNow();
  const shippedAt = h("input", { class: "input", type: "datetime-local", name: "shipped_at", value: now, max: now, required: true });
  const note = h("textarea", { class: "input textarea", name: "note", rows: "3", maxlength: "200" });
  openModal({
    title: `출하 완료 · ${batch.batch_number}`,
    fields: [
      h("p", { class: "release-notice", role: "note" }, NOT_NATIONAL_RELEASE),
      field("출하 일시", shippedAt),
      field("메모 (선택)", note, "200자까지"),
      h("p", { class: "field-hint" }, "기록한 뒤에는 되돌릴 수 없고, 이 로트는 읽기만 됩니다."),
    ],
    submitLabel: "출하 완료 기록",
    onSubmit: async () => {
      const checked = checkShipment({ shippedAt: shippedAt.value, note: note.value, now: new Date() });
      if (!checked.ok) throw new Error(checked.error);
      await shipBatch(batch.id, checked.value);
      onDone("출하 완료로 기록했습니다. QA 관리자에게 알림이 갑니다.");
    },
  });
  return Promise.resolve();
}
