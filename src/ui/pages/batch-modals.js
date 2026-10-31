// IA BT_010205_MD 공정 조건 입력, BT_010206_MD 시험값 입력, BT_010207_MD 배치 보류. FR-009, FR-011, FR-012 (spec 001), 시험값 한 번에 입력 (spec 017)
import { h, badge } from "../dom.js";
import { openModal, field } from "../modal.js";
import { parseNumberInput, checkHoldReason } from "../../domain/input-rules.js";
import { remainingTestSpecs, checkTestEntries } from "../../domain/test-entry-rules.js";
import { previewResult } from "../../domain/compare-rules.js";
import { criteriaText, resultLabel } from "../../domain/judgement-rules.js";
import { holdBatch, listSpecifications, recordProcessConditions, recordTestMeasurements } from "../../infrastructure/store.js";

/**
 * spec 017 FR-003·004: 아직 넣지 않은 시험 항목을 모두 칸으로 보여 주고 한 번에 저장한다. 빈칸은 건너뛰고, 하나라도 틀리면 아무것도 저장하지 않는다
 * @param {{ batch: { id: string, product_id: string }, measurements: object[], onSaved: (results: object[], specs: object[]) => void }} options
 */
export async function openTestValueModal({ batch, measurements, onSaved }) {
  const specs = await listSpecifications(batch.product_id, "test");
  const remaining = remainingTestSpecs(specs, measurements);
  const done = specs.filter((spec) => !remaining.includes(spec));
  // FR-003 수용 기준 1 (spec 004 FR-003 수용 기준 6): 칸마다 시험 규격·사내 관리기준·버전
  const items = remaining.map((spec) => ({ spec, ...numberField(spec.item_name, criteriaHint(spec), `test-${spec.id}`) }));
  // UI 개편: 값을 넣는 즉시 판정을 미리 보여 준다 (저장하면 서버가 최종 판정, 경계값은 범위 안)
  for (const item of items) {
    const live = h("span", { class: "tv-live", "aria-live": "polite" });
    item.node.append(live);
    item.input.addEventListener("input", () => {
      const parsed = parseNumberInput(item.input.value);
      const result = item.input.value.trim() && parsed.ok ? previewResult(parsed.value, item.spec) : null;
      live.replaceChildren(...(result ? [badge(result, resultLabel(result)), h("span", { class: "muted tv-note" }, " 미리보기")] : []));
    });
  }
  const emptyNotice = !specs.length ? NO_TEST_SPECS : !remaining.length ? ALL_ENTERED : null;

  const dialog = openModal({
    title: "시험값 입력",
    fields: [
      emptyNotice ? h("p", { class: "field-hint", role: "note" }, emptyNotice) : null,
      done.length && remaining.length ? h("p", { class: "field-hint" }, `입력됨: ${done.map((spec) => spec.item_name).join(", ")}`) : null,
      ...items.map((item) => item.node),
      items.length ? h("p", { class: "field-hint" }, "빈칸은 건너뜁니다. 넣은 값은 한 번에 저장합니다.") : null,
    ].filter(Boolean),
    submitLabel: "저장",
    onSubmit: async () => {
      for (const item of items) item.error.textContent = "";
      if (!items.length) throw new Error(emptyNotice);
      const checked = checkTestEntries(items.map((item) => ({ specificationId: item.spec.id, text: item.input.value })));
      if (!checked.ok) {
        for (const item of items) item.error.textContent = checked.errors[item.spec.id] ?? ""; // 칸 옆에 (FR-004 수용 기준 3)
        items.find((item) => checked.errors[item.spec.id])?.input.focus();
        throw new Error(checked.error ?? "숫자가 아닌 칸이 있어 아무것도 저장하지 않았습니다.");
      }
      onSaved(await recordTestMeasurements(batch.id, checked.values), specs);
    },
  });
  if (!items.length) dialog.querySelector('button[type="submit"]').disabled = true; // FR-003 수용 기준 3
}

const NO_TEST_SPECS = "이 제품에 시험 항목이 없습니다. 제품 상세에서 기준을 먼저 등록해 주세요.";
const ALL_ENTERED = "모든 시험 항목을 입력했습니다. 다시 재려면 재시험 조치를 요청해 주세요.";

/** "규격 80~125 % · 관리기준 90~115 % · v1 · 교육용 가상 기준" */
export function criteriaHint(spec) {
  return `${criteriaText(spec, spec.unit)} · 교육용 가상 기준`;
}

/** 숫자 입력 칸: 이름표, 기준 안내, 칸 옆 오류 (FR-009·011 경계·예외) */
export function numberField(label, hint, idBase) {
  const hintNode = h("span", { class: "field-hint", id: `${idBase}-hint` }, hint);
  const error = h("span", { class: "error-text", id: `${idBase}-error`, role: "alert" });
  const input = h("input", {
    class: "input mono", inputmode: "decimal", autocomplete: "off",
    "aria-describedby": `${idBase}-hint ${idBase}-error`,
  });
  const node = h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, hintNode, error);
  return { node, input, error };
}

/** 칸마다 숫자를 해석한다. 빈 칸을 허락하면 null. 잘못된 칸은 옆에 오류를 쓰고 undefined */
export function readNumber({ input, error }, { optional }) {
  error.textContent = "";
  if (optional && !input.value.trim()) return null;
  const parsed = parseNumberInput(input.value);
  if (parsed.ok) return parsed.value;
  error.textContent = parsed.error;
  return undefined;
}

/**
 * FR-011: 생산량(기준 없이 기록, Q4), 기준이 있는 공정 조건 항목마다 값, 설비 상태
 * @param {{ batch: { id: string, product_id: string }, onSaved: (result: object) => void }} options
 */
export async function openProcessModal({ batch, onSaved }) {
  const specs = await listSpecifications(batch.product_id, "process");
  const quantity = numberField("생산량", "기준 없이 기록만 합니다. 비워 둘 수 있습니다.", "process-quantity");
  const items = specs.map((spec) => ({
    spec,
    ...numberField(spec.item_name, criteriaHint(spec), `process-${spec.id}`),
  }));
  const equipment = h("select", { class: "select", name: "equipment", required: true },
    h("option", { value: "" }, "설비 상태를 고르세요"),
    h("option", { value: "normal" }, "정상"),
    h("option", { value: "abnormal" }, "이상"));

  openModal({
    title: "공정 조건 입력",
    fields: [quantity.node, ...items.map((item) => item.node), field("설비 상태", equipment, "\"이상\"이면 규격 이탈로 봅니다.")],
    submitLabel: "저장",
    onSubmit: async () => {
      const productionQuantity = readNumber(quantity, { optional: true });
      const values = items.map((item) => ({ specification_id: item.spec.id, value: readNumber(item, { optional: false }) }));
      const invalid = productionQuantity === undefined || values.some((entry) => entry.value === undefined);
      if (invalid) throw new Error("");
      if (!equipment.value) throw new Error("설비 상태를 골라 주세요.");
      const result = await recordProcessConditions({
        batchId: batch.id, productionQuantity, equipmentStatus: equipment.value, values,
      });
      onSaved(result);
    },
  });
}

/**
 * FR-012: 사유를 적어 직접 보류 (생산 담당자·QA 관리자)
 * @param {{ batch: { id: string }, onSaved: () => void }} options
 */
export function openHoldModal({ batch, onSaved }) {
  const reason = h("textarea", { class: "input textarea", name: "reason", rows: "3", maxlength: "500", required: true });
  openModal({
    title: "로트 보류",
    fields: [field("보류 사유", reason, "예: 포장 라인 점검")],
    submitLabel: "보류",
    onSubmit: async () => {
      const checked = checkHoldReason(reason.value);
      if (!checked.ok) throw new Error(checked.error);
      await holdBatch(batch.id, checked.value);
      onSaved();
    },
  });
  return Promise.resolve();
}
