// 공정 단계 실행 (spec 011). 단계 상태·착수/완료 가능 여부·화면 글자. 실제로 막는 것은 데이터베이스 함수다 (ADR 0002)

// FR-004, Q69: 모든 제품·단계에 같은 4가지
export const CLEARANCE_ITEMS = [
  { key: "no_previous_material", label: "이전 제품·원료·자재가 작업 구역에 남아 있지 않다" },
  { key: "no_previous_label", label: "이전 제품의 라벨·문서가 남아 있지 않다" },
  { key: "equipment_cleaned", label: "설비에 \"세척 완료\" 표시가 있다" },
  { key: "area_clean", label: "작업 구역이 깨끗하고 정리돼 있다" },
];

export const STEP_STATUS_LABELS = { waiting: "대기", in_progress: "진행 중", completed: "완료" };

const HOLD_REASON = "로트가 보류 중입니다. 품질 이슈를 처리하고 보류가 풀린 뒤 진행해 주세요.";
const NOT_PRODUCING = "생산 중인 로트만 진행할 수 있습니다.";
const PREVIOUS_FIRST = "앞 단계를 완료한 뒤 착수할 수 있습니다.";
const MAX_NAME = 40;

/** FR-001 경계 상황 @param {string | null | undefined} text */
export function checkStepName(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, error: "단계 이름을 입력해 주세요." };
  if (trimmed.length > MAX_NAME) return { ok: false, error: "단계 이름은 40자까지 입력해 주세요." };
  return { ok: true, value: trimmed };
}

/** FR-004 수용 기준 2: 4가지 모두 확인 @param {string[]} checkedKeys */
export function checkClearance(checkedKeys) {
  const all = CLEARANCE_ITEMS.map((item) => item.key);
  if (!all.every((key) => checkedKeys.includes(key))) {
    return { ok: false, error: "라인 클리어런스 4가지를 모두 확인해 주세요." };
  }
  return { ok: true, value: all };
}

function blockedReason(batchStatus, status, previousDone) {
  if (status === "completed") return null;
  if (batchStatus === "on_hold") return HOLD_REASON;
  if (batchStatus !== "in_production") return NOT_PRODUCING;
  if (status === "waiting" && !previousDone) return PREVIOUS_FIRST;
  return null;
}

/**
 * FR-003·004: 단계마다 상태와 착수·완료 가능 여부. 쓰지 않음 단계는 실행 기록이 있을 때만 보이고 번호에서 빠진다
 * @param {{ id: string, step_order: number, name: string, retired_at: string | null }[]} steps
 * @param {{ process_step_id: string, status: "in_progress" | "completed" }[]} runs
 * @param {string} batchStatus
 */
export function stepBoard(steps, runs, batchStatus) {
  const runOf = new Map(runs.map((run) => [run.process_step_id, run]));
  const sorted = [...steps].sort((a, b) => a.step_order - b.step_order);
  const active = sorted.filter((step) => !step.retired_at);
  const anyRunning = runs.some((run) => run.status === "in_progress");
  let previousDone = true;
  return sorted
    .filter((step) => !step.retired_at || runOf.has(step.id))
    .map((step) => {
      const run = runOf.get(step.id) ?? null;
      const status = run?.status ?? "waiting";
      const index = active.indexOf(step);
      const producing = batchStatus === "in_production";
      const entry = {
        step,
        run,
        status,
        label: index >= 0 ? `${index + 1}/${active.length}` : null,
        canStart: status === "waiting" && producing && previousDone && !anyRunning && !step.retired_at,
        canComplete: status === "in_progress" && producing,
        blockedReason: blockedReason(batchStatus, status, previousDone && !anyRunning),
      };
      if (!step.retired_at && status !== "completed") previousDone = false;
      return entry;
    });
}

/**
 * FR-002, Q71: 이 단계 완료 때 받을 공정 기준. 마지막 단계는 단계 미지정 기준도 받는다
 * @template {{ process_step_id: string | null }} T
 * @param {T[]} specs
 * @param {{ id: string }} step
 * @param {boolean} isLast
 * @returns {T[]}
 */
export function specsForStep(specs, step, isLast) {
  return specs.filter((spec) => spec.process_step_id === step.id || (isLast && !spec.process_step_id));
}

/**
 * "3/5" 같은 단계 글자를 번호와 전체 수로 나눈다. 분수로 보이면 날짜·진행률로 오해돼서 화면에는 "전체 5단계 중 3번째"로 풀어 쓴다
 * @param {string | null | undefined} label
 */
export function splitStepLabel(label) {
  const [no = "", total = ""] = String(label ?? "").split("/");
  return { no, total };
}

/** FR-007: 로트 위쪽 "현재 단계: 원액 여과 (전체 5단계 중 3번째) · 진행 중" @param {ReturnType<typeof stepBoard>} board */
export function currentStepText(board) {
  if (!board.length) return "";
  const running = board.find((entry) => entry.status === "in_progress");
  const next = board.find((entry) => entry.status === "waiting" && entry.label);
  const target = running ?? next;
  if (!target) return "모든 단계 완료";
  const { no, total } = splitStepLabel(target.label);
  const text = `${running ? "현재" : "다음"} 단계: ${target.step.name} (전체 ${total}단계 중 ${no}번째) · ${STEP_STATUS_LABELS[target.status]}`;
  return target.blockedReason?.startsWith("로트가 보류") ? `${text} · 보류 중이라 다음 단계를 진행할 수 없습니다` : text;
}
