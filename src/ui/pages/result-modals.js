// IA QI_010104_MD 조치 결과 입력 (FR-007), 품질 이슈 닫기 확인 (FR-008). spec 002
import { h } from "../dom.js";
import { openModal, field } from "../modal.js";
import { actionTypeLabel } from "../../domain/action-rules.js";
import { batchStatusLabel } from "../../domain/batch-rules.js";
import { parseNumberInput } from "../../domain/input-rules.js";
import { criteriaText } from "../../domain/judgement-rules.js";
import { closeQualityIssue, completeActionRequest } from "../../infrastructure/store-actions.js";

const NOTE_HINT = "무엇을 했고 결과가 어땠는지 적습니다.";

/**
 * 재시험: 시험 항목과 기준은 고정, 측정값만 받는다 (FR-007 수용 기준 1, Q20). 판정 기준은 지금 기준 (spec 004 FR-007)
 * @param {{ target: { specification: { item_name: string, unit: string | null, min_value: number, max_value: number, alert_min_value: number | null, alert_max_value: number | null, version: number } } }} options
 */
function retestFields({ target }) {
  const spec = target.specification;
  const unit = spec.unit ?? "";
  const value = h("input", { class: "input mono", name: "value", inputmode: "decimal", autocomplete: "off", required: true });
  return {
    value,
    nodes: [
      h("p", { class: "field-hint" }, `시험 항목 ${spec.item_name} · ${criteriaText(spec, spec.unit)} · 교육용 가상 기준`),
      field(`측정값${unit ? ` (${unit})` : ""}`, value),
    ],
  };
}

// FR-007 수용 기준 2·3: 판정 결과로 안내를 고른다. 재이탈이면 이슈는 열린 채로.
// spec 004 FR-007: 관리기준 이탈로 열린 이슈가 규격 이탈로 나빠지면 종류가 바뀌고 로트가 보류된다 (Q28: 반대로는 안 바뀜)
function retestNotice(result, target) {
  if (result?.result === "out_of_spec" && target?.result === "out_of_alert") {
    return "재시험 결과 규격 이탈입니다. 이 이슈는 규격 이탈로 바뀌고 로트가 보류되었습니다. 같은 이슈에 붙었고 이슈는 처리 중으로 남습니다. 다른 조치 요청을 등록해 주세요.";
  }
  if (result?.result === "out_of_spec") {
    return "재시험 결과도 규격 이탈입니다. 같은 이슈에 붙었고 이슈는 처리 중으로 남습니다. 다른 조치 요청을 등록해 주세요.";
  }
  if (result?.result === "out_of_alert") {
    return "재시험 결과 관리기준 이탈(규격 안)입니다. 조치 요청이 완료됐습니다. 이제 이슈를 종결할 수 있습니다.";
  }
  return "재시험 결과 정상입니다. 조치 요청이 완료됐습니다. 이제 이슈를 종결할 수 있습니다.";
}

/**
 * @param {{ request: { id: string, action_type: string }, target: object | null, onDone: (notice?: string) => void }} options
 */
export function openCompleteModal({ request, target, onDone }) {
  const isRetest = request.action_type === "retest";
  if (isRetest && !target) return Promise.reject(new Error("다시 잴 시험 항목을 찾을 수 없습니다. QA 관리자에게 알려 주세요."));
  const retest = isRetest ? retestFields({ target }) : null;
  const note = h("textarea", { class: "input textarea", name: "result_note", rows: "3", maxlength: "500", required: !isRetest });

  openModal({
    title: `조치 결과 입력 · ${actionTypeLabel(request.action_type)}`,
    fields: [
      ...(retest ? retest.nodes : []),
      field(isRetest ? "결과 메모" : "조치 결과", note, isRetest ? "비워 둘 수 있습니다." : NOTE_HINT),
    ],
    submitLabel: "저장",
    onSubmit: async () => {
      if (!isRetest) {
        if (!note.value.trim()) throw new Error("조치 결과를 입력해 주세요."); // FR-007 수용 기준 4
        await completeActionRequest(request.id, note.value, null);
        onDone("조치 결과를 저장했습니다. 조치 요청이 완료됐습니다.");
        return;
      }
      const parsed = parseNumberInput(retest.value.value);
      if (!parsed.ok) throw new Error(parsed.error); // 모달 아래 오류 문구 한 곳에만
      const result = await completeActionRequest(request.id, note.value, parsed.value);
      onDone(retestNotice(result, target));
    },
  });
  return Promise.resolve();
}

/**
 * FR-008 수용 기준 2~4: 닫은 뒤 배치 상태를 알려 준다 (Q2: 직접 보류 사유가 있으면 보류로 남음)
 * @param {{ issue: { id: string, batch: { batch_number: string } }, onDone: (notice?: string) => void }} options
 */
export function openCloseIssueModal({ issue, onDone }) {
  openModal({
    title: "품질 이슈 종결",
    fields: [h("p", null, `로트 ${issue.batch.batch_number}의 이 품질 이슈를 종결합니다. 종결한 뒤에는 조치 요청을 더 등록할 수 없습니다.`)],
    submitLabel: "종결",
    onSubmit: async () => {
      const result = await closeQualityIssue(issue.id);
      onDone(`품질 이슈를 종결했습니다. 로트 상태: ${batchStatusLabel(result.batch_status)}`);
    },
  });
  return Promise.resolve();
}
