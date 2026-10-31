// IA QI_010101_MD 조치 요청 등록 (FR-003), QI_010102_MD 승인 (FR-004), QI_010103_MD 반려·다시 제출 (FR-005). 결과 입력은 4단계
import { h } from "../dom.js";
import { openModal, field } from "../modal.js";
import { actionTypeLabel, actionTypesFor, assignableUsers } from "../../domain/action-rules.js";
import { listUsers } from "../../infrastructure/store.js";
import {
  approveActionRequest, rejectActionRequest, resubmitActionRequest, submitActionRequest,
} from "../../infrastructure/store-actions.js";

// FR-006, UJ E5: 이 문구로 거부되면 모달을 닫고 최신 상태를 다시 그린다 (0008_actions.sql)
const ALREADY_HANDLED = "다른 사람이 먼저 처리했습니다";

/**
 * 저장이 끝나면 onDone(), 다른 사람이 먼저 처리했으면 onDone(그 문구). 그 밖의 실패는 모달에 그대로 보인다
 * @param {() => Promise<unknown>} save
 * @param {(notice?: string) => void} onDone
 */
async function saveOrRefresh(save, onDone) {
  try {
    await save();
  } catch (error) {
    if (!error.message.includes(ALREADY_HANDLED)) throw error;
    onDone(error.message);
    return;
  }
  onDone();
}

function typeSelect(source, selected) {
  return h("select", { class: "select", name: "action_type", required: true },
    h("option", { value: "" }, "조치 종류를 고르세요"),
    ...actionTypesFor(source).map((value) => h("option", { value, selected: value === selected }, actionTypeLabel(value))));
}

function descriptionInput(value) {
  const input = h("textarea", { class: "input textarea", name: "description", rows: "3", maxlength: "500" });
  input.value = value ?? "";
  return input;
}

function typeField(source, select) {
  return field("조치 종류", select, source === "test" ? null : "재시험은 시험 이슈에만 요청할 수 있습니다.");
}

/**
 * initial: AI 초안(spec 023)을 미리 채운다. 채워도 저장되지 않고 사람이 고친 뒤 "요청"을 눌러야 저장된다
 * @param {{ issue: { id: string, source: "test" | "process", batch: { batch_number: string } }, summary: string, onDone: (notice?: string) => void,
 *   initial?: { actionType: string, description: string } }} options
 */
export function openSubmitRequestModal({ issue, summary, onDone, initial }) {
  const type = typeSelect(issue.source, initial?.actionType);
  const description = descriptionInput(initial?.description);
  openModal({
    title: "조치 요청 등록",
    fields: [
      // FR-003 수용 기준 1: 이슈 정보가 자동으로 채워져 있다
      h("p", { class: "field-hint" }, `로트 ${issue.batch.batch_number} · ${summary}`),
      initial ? h("p", { class: "release-notice", role: "note" }, "AI가 만든 초안을 채웠습니다. 저장되지 않았으니 직접 읽고 고친 뒤 '요청'을 눌러야 저장됩니다.") : null,
      typeField(issue.source, type),
      field("요청 내용", description, "무엇을 왜 해야 하는지 적습니다. 비워 둘 수 있습니다."),
    ],
    submitLabel: "요청",
    onSubmit: async () => {
      if (!type.value) throw new Error("조치 종류를 골라 주세요.");
      await submitActionRequest(issue.id, type.value, description.value);
      onDone();
    },
  });
  return Promise.resolve();
}

/**
 * FR-004: 담당자는 필수, 조치 종류에 맞는 역할인 사람만 (Q18)
 * @param {{ request: { id: string, action_type: string }, onDone: (notice?: string) => void }} options
 */
export async function openApproveModal({ request, onDone }) {
  const candidates = assignableUsers(await listUsers(), request.action_type);
  const assignee = h("select", { class: "select", name: "assignee", required: true },
    h("option", { value: "" }, "담당자를 고르세요"),
    ...candidates.map((user) => h("option", { value: user.id }, user.display_name)));
  openModal({
    title: "조치 요청 승인",
    fields: [
      h("p", { class: "field-hint" }, `${actionTypeLabel(request.action_type)} 요청을 승인하고 담당자를 배정합니다.`),
      field("담당자", assignee, candidates.length ? null : "이 조치를 맡을 수 있는 역할의 사람이 없습니다. 사용자·역할에서 먼저 역할을 지정해 주세요."),
    ],
    submitLabel: "승인",
    onSubmit: async () => {
      if (!assignee.value) throw new Error("담당자를 골라 주세요.");
      await saveOrRefresh(() => approveActionRequest(request.id, assignee.value), onDone);
    },
  });
}

/**
 * FR-005 수용 기준 1: 사유 필수 (공백만이면 빈 값, DB가 거부)
 * @param {{ request: { id: string, action_type: string }, onDone: (notice?: string) => void }} options
 */
export function openRejectModal({ request, onDone }) {
  const reason = h("textarea", { class: "input textarea", name: "reason", rows: "3", maxlength: "500", required: true });
  openModal({
    title: "조치 요청 반려",
    fields: [
      h("p", { class: "field-hint" }, `${actionTypeLabel(request.action_type)} 요청을 반려합니다. 사유는 요청자에게 보입니다.`),
      field("반려 사유", reason),
    ],
    submitLabel: "반려",
    onSubmit: async () => {
      if (!reason.value.trim()) throw new Error("반려 사유를 입력해 주세요.");
      await saveOrRefresh(() => rejectActionRequest(request.id, reason.value), onDone);
    },
  });
  return Promise.resolve();
}

/**
 * FR-005 수용 기준 3: 요청자가 종류·내용을 고쳐 다시 제출 (Q21)
 * @param {{ request: { id: string, action_type: string, description: string | null, rejection_reason: string | null }, source: "test" | "process", onDone: (notice?: string) => void }} options
 */
export function openResubmitModal({ request, source, onDone }) {
  const type = typeSelect(source, request.action_type);
  const description = descriptionInput(request.description);
  openModal({
    title: "조치 요청 다시 제출",
    fields: [
      h("p", { class: "rejected-reason" }, `반려 사유: ${request.rejection_reason ?? ""}`),
      typeField(source, type),
      field("요청 내용", description),
    ],
    submitLabel: "다시 제출",
    onSubmit: async () => {
      if (!type.value) throw new Error("조치 종류를 골라 주세요.");
      await saveOrRefresh(() => resubmitActionRequest(request.id, type.value, description.value), onDone);
    },
  });
  return Promise.resolve();
}
