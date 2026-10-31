// 출하 판단 근거 체크리스트 (UI 개편): 내부 출하 검토 전에 한 화면에서 보는 5가지.
// 막는 것은 release-rules.js(releaseBlockers)와 데이터베이스 함수 decide_release다. 여기는 보여 주기만 하며 같은 자료로 계산한다
import { lotTodos } from "./lot-todo-rules.js";
import { stepBoard } from "./process-step-rules.js";
import { retainedQuantity } from "./sample-rules.js";

const WITHIN_SPEC = new Set(["pass", "out_of_alert"]);

function latestBySpec(measurements) {
  const latest = new Map();
  for (const m of measurements) {
    const current = latest.get(m.specification_id);
    if (!current || m.measured_at > current.measured_at) latest.set(m.specification_id, m);
  }
  return latest;
}

/**
 * @param {{
 *   testSpecs: { id: string, item_name: string, version?: number }[],
 *   measurements: { specification_id: string, result: string, measured_at: string, applied_spec_version?: number | null }[],
 *   openIssueCount: number,
 *   board: { status: string }[] | null,
 *   processRecordCount: number | null,
 *   retainedQuantity: number | null,
 * }} input retainedQuantity·processRecordCount가 null이면 그 정보를 못 읽은 것 ("기록 없음"과 다르다)
 * @returns {{ key: string, label: string, status: "ok" | "warn" | "bad", detail: string }[]}
 */
export function readinessChecklist({ testSpecs, measurements, openIssueCount, board, processRecordCount, retainedQuantity }) {
  const latest = latestBySpec(measurements);
  const missing = testSpecs.filter((spec) => !latest.has(spec.id));
  const outOfSpec = testSpecs.filter((spec) => latest.has(spec.id) && !WITHIN_SPEC.has(latest.get(spec.id).result));
  const alerts = testSpecs.filter((spec) => latest.get(spec.id)?.result === "out_of_alert");
  const within = testSpecs.length - missing.length - outOfSpec.length;

  const tests = missing.length || outOfSpec.length
    ? { status: "bad", detail: `${within}/${testSpecs.length} 규격 안 · ${[...missing.map((s) => `${s.item_name} 미입력`), ...outOfSpec.map((s) => `${s.item_name} 규격 이탈`)].join(", ")}` }
    : alerts.length
      ? { status: "warn", detail: `${within}/${testSpecs.length} 규격 안 · 관리기준 이탈 ${alerts.map((s) => s.item_name).join(", ")}` }
      : { status: "ok", detail: `${within}/${testSpecs.length} 모두 정상` };

  const stale = testSpecs.filter((spec) => {
    const applied = latest.get(spec.id)?.applied_spec_version;
    return applied !== null && applied !== undefined && spec.version !== undefined && applied !== spec.version;
  });

  let process;
  if (board) {
    const total = board.length;
    const done = board.filter((entry) => entry.status === "completed").length;
    process = { status: done === total ? "ok" : "warn", detail: `${done}/${total} 단계 완료` };
  } else if (processRecordCount === null) {
    process = { status: "warn", detail: "확인하지 못했습니다" }; // 읽기에 실패한 것을 "기록 없음"으로 보이지 않게 (검체 수와 같은 방식)
  } else {
    process = processRecordCount
      ? { status: "ok", detail: `공정 조건 기록 ${processRecordCount}건` }
      : { status: "warn", detail: "공정 조건 기록 없음" };
  }

  return [
    { key: "tests", label: "시험 결과", ...tests },
    { key: "issues", label: "열린 품질 이슈", status: openIssueCount ? "bad" : "ok", detail: openIssueCount ? `${openIssueCount}건 처리 중` : "없음" },
    { key: "process", label: "공정", ...process },
    {
      key: "samples", label: "QA 보존 검체",
      ...(retainedQuantity === null ? { status: "warn", detail: "확인하지 못했습니다" } : retainedQuantity > 0 ? { status: "ok", detail: `보관 중 ${retainedQuantity}` } : { status: "warn", detail: "보관 중인 수량 없음" }),
    },
    {
      key: "version", label: "적용 기준 버전",
      status: stale.length ? "warn" : "ok",
      detail: stale.length ? `${stale.map((s) => s.item_name).join(", ")}: 판정 당시와 현재 기준 버전이 다릅니다` : "모두 현재 기준",
    },
  ];
}

/**
 * 로트 상세 화면과 AI 도우미 서버(spec 025 9단계)가 같은 자료로 같은 계산을 하게 한 곳에 둔다:
 * 공정 단계 보드(작업지시 로트이고 단계가 있을 때만), 지금 할 일, 출하 판단 근거.
 * 공정 기록·검체를 못 읽었으면(null) 그 줄은 "확인하지 못했습니다"
 */
export function lotReadiness({ batch, measurements, issues, testSpecs, workOrder, steps, runs, processRecords, transfers, requests, reviews }) {
  const board = workOrder && steps.some((step) => !step.retired_at) ? stepBoard(steps, runs, batch.status) : null;
  const todos = lotTodos({ issues, reviews, requests, batch, measurements });
  const checklist = readinessChecklist({
    testSpecs, measurements, openIssueCount: todos.length, board, processRecordCount: processRecords ? processRecords.length : null,
    retainedQuantity: transfers ? retainedQuantity(transfers) : null,
  });
  return { board, todos, checklist };
}
