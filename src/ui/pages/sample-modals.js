// IA SM_010100_MD 검체 전달 등록, SM_010101~010104_MD 인수 확인·반납·반납 확인·소진 (spec 008 FR-001~004), SM_010105_MD 검체 폐기 (spec 018)
import { h, localMinuteNow } from "../dom.js";
import { openModal, field } from "../modal.js";
import {
  SAMPLE_UNITS, checkDisposal, checkLocation, checkQuantity, checkReturnQuantity, disposalQuantity, retainedQuantity,
  retentionDueDate, routeLabel, routesFor,
} from "../../domain/sample-rules.js";
import {
  confirmSampleReturn, consumeSample, disposeSample, receiveSample, returnSample, sendSample,
} from "../../infrastructure/store-samples.js";

/** "IFV-2610-003 · 생산 → QA · 보존 검체 · 4 바이알" */
export function transferLine(transfer) {
  const route = routeLabel({ from: transfer.from_team, to: transfer.to_team, kind: transfer.sample_kind });
  return `${transfer.batch?.batch_number ?? ""} · ${route} · ${transfer.quantity} ${transfer.unit}`;
}

function summary(transfer) {
  return h("p", { class: "mono" }, transferLine(transfer));
}

/**
 * FR-001: 검체 전달 등록. 로트 상세 탭에서 열면 로트가 정해져 있다
 * @param {{ role: string, batches: { id: string, batch_number: string }[], transfers: object[], fixedBatchId?: string, onSaved: () => void }} options
 */
export function openSendModal({ role, batches, transfers, fixedBatchId, onSaved }) {
  const routes = routesFor(role);
  const batch = h("select", { class: "select", name: "batch", required: true },
    h("option", { value: "" }, "로트를 고르세요"),
    ...batches.map((item) => h("option", { value: item.id, selected: item.id === fixedBatchId }, item.batch_number)));
  if (fixedBatchId) batch.disabled = true;
  const route = h("select", { class: "select", name: "route" },
    ...routes.map((item, index) => h("option", { value: String(index) }, routeLabel(item))));
  const quantity = h("input", { class: "input", name: "quantity", inputmode: "numeric", autocomplete: "off", required: true });
  const unit = h("select", { class: "select", name: "unit" }, ...SAMPLE_UNITS.map((value) => h("option", { value }, value)));
  const note = h("textarea", { class: "input", name: "note", rows: "2", maxlength: "200" });
  // FR-001 수용 기준 3: QA → QC는 그 로트에 QA가 보관 중인 보존 검체 안에서만
  const retainedHint = h("p", { class: "field-hint", role: "status" });
  const updateHint = () => {
    const chosen = routes[Number(route.value)];
    retainedHint.textContent = chosen?.from === "qa" && batch.value
      ? `이 로트에 QA가 보관 중인 보존 검체: ${retainedQuantity(transfers.filter((t) => t.batch_id === batch.value))}`
      : "";
  };
  batch.addEventListener("change", updateHint);
  route.addEventListener("change", updateHint);
  updateHint();

  openModal({
    title: "검체 전달 등록",
    fields: [
      field("로트", batch), field("보내는 길", route), retainedHint,
      field("수량", quantity, "1~9999"), field("단위", unit), field("메모 (선택)", note, "200자까지"),
    ],
    submitLabel: "전달 등록",
    onSubmit: async () => {
      if (!batch.value) throw new Error("로트를 골라 주세요.");
      const checked = checkQuantity(quantity.value);
      if (!checked.ok) throw new Error(checked.error);
      const chosen = routes[Number(route.value)];
      await sendSample(batch.value, {
        from_team: chosen.from, to_team: chosen.to, sample_kind: chosen.kind,
        quantity: checked.value, unit: unit.value, note: note.value,
      });
      onSaved("검체 전달을 등록했습니다. 받는 팀이 인수 확인하면 보관 중으로 바뀝니다.");
    },
  });
}

/** FR-002: 인수 확인 (받는 팀) */
export function openReceiveModal(transfer, onSaved) {
  const location = h("input", { class: "input", name: "storage_location", maxlength: "60", autocomplete: "off", required: true });
  openModal({
    title: "인수 확인",
    fields: [summary(transfer), field("보관 위치", location, "예: 보존검체실 냉장고 R-02 3단")],
    submitLabel: "인수 확인",
    onSubmit: async () => {
      const checked = checkLocation(location.value);
      if (!checked.ok) throw new Error(checked.error);
      await receiveSample(transfer.id, checked.value);
      onSaved("인수 확인했습니다.");
    },
  });
}

/** FR-003: 반납 (받은 팀) */
export function openReturnModal(transfer, onSaved) {
  const quantity = h("input", { class: "input", name: "returned_quantity", inputmode: "numeric", value: String(transfer.quantity), required: true });
  openModal({
    title: "반납",
    fields: [summary(transfer), field("반납 수량", quantity, `1~${transfer.quantity} ${transfer.unit}. 보낸 팀이 반납 확인하면 끝납니다.`)],
    submitLabel: "반납",
    onSubmit: async () => {
      const checked = checkReturnQuantity(quantity.value, transfer.quantity);
      if (!checked.ok) throw new Error(checked.error);
      await returnSample(transfer.id, checked.value);
      onSaved("반납을 등록했습니다. 보낸 팀이 반납 확인을 기다립니다.");
    },
  });
}

/** FR-003: 반납 확인 (보낸 팀) */
export function openConfirmReturnModal(transfer, onSaved) {
  openModal({
    title: "반납 확인",
    fields: [summary(transfer),
      h("p", null, `반납 수량 ${transfer.returned_quantity} ${transfer.unit} · 반납자 ${transfer.returner?.display_name ?? ""}`),
      h("p", { class: "muted" }, "검체 실물을 받았을 때 누릅니다.")],
    submitLabel: "반납 확인",
    onSubmit: async () => {
      await confirmSampleReturn(transfer.id);
      onSaved("반납 확인했습니다.");
    },
  });
}

/** FR-004: 소진 (QC가 받은 검체) */
export function openConsumeModal(transfer, onSaved) {
  openModal({
    title: "소진",
    fields: [summary(transfer), h("p", { class: "muted" }, "시험에 다 써서 돌려줄 검체가 없을 때 누릅니다. 되돌릴 수 없습니다.")],
    submitLabel: "소진 처리",
    onSubmit: async () => {
      await consumeSample(transfer.id);
      onSaved("소진 처리했습니다.");
    },
  });
}

/**
 * spec 018 FR-004: 보존 검체 폐기 (QA 관리자, 기한 지난 보관 중 건). 실물을 버린 뒤 기록한다
 * @param {object} transfer
 * @param {object[]} lotTransfers 같은 로트의 검체 기록 (폐기 수량 미리 보기, Q82)
 * @param {(notice: string) => void} onSaved
 */
export function openDisposeModal(transfer, lotTransfers, onSaved) {
  const dueDate = retentionDueDate(transfer);
  const now = localMinuteNow();
  const disposedAt = h("input", { class: "input", type: "datetime-local", name: "disposed_at", value: now, max: now, required: true });
  const note = h("textarea", { class: "input textarea", name: "note", rows: "2", maxlength: "200" });
  openModal({
    title: `검체 폐기 · ${transfer.batch?.batch_number ?? ""}`,
    fields: [
      summary(transfer),
      h("p", null, `보관 기한 ${dueDate} · 폐기 수량 ${disposalQuantity(transfer, lotTransfers)} ${transfer.unit}`),
      h("p", { class: "field-hint", role: "note" }, "실물을 폐기한 뒤 기록해 주세요. 기록한 뒤에는 되돌릴 수 없습니다."),
      field("폐기 일시", disposedAt),
      field("메모 (선택)", note, "200자까지"),
    ],
    submitLabel: "폐기 기록",
    onSubmit: async () => {
      const checked = checkDisposal({ disposedAt: disposedAt.value, note: note.value, now: new Date(), dueDate });
      if (!checked.ok) throw new Error(checked.error);
      const result = await disposeSample(transfer.id, checked.value);
      onSaved(`검체 폐기를 기록했습니다. 폐기 수량 ${result?.disposed_quantity ?? ""} ${transfer.unit}.`);
    },
  });
}
