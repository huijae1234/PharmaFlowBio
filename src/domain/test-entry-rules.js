// 시험값 한 번에 입력 (spec 017 FR-003·004). 칸 검사와 글자만 — 판정은 데이터베이스 함수가 한다
import { parseNumberInput } from "./input-rules.js";
import { measuredSpecificationIds } from "./batch-rules.js";
import { resultLabel } from "./judgement-rules.js";

/**
 * FR-003: 아직 첫 측정값이 없는 시험 항목 (재시험 측정값은 입력됨으로 치지 않는다)
 * @template {{ id: string }} T
 * @param {T[]} specs
 * @param {{ specification_id: string, action_request_id?: string | null }[]} measurements
 * @returns {T[]}
 */
export function remainingTestSpecs(specs, measurements) {
  const measured = measuredSpecificationIds(measurements);
  return specs.filter((spec) => !measured.has(spec.id));
}

/**
 * FR-004: 빈칸은 건너뛰고, 숫자가 아닌 칸이 하나라도 있으면 그 칸에 문구를 달고 저장하지 않는다
 * @param {{ specificationId: string, text: string }[]} entries
 * @returns {{ ok: true, values: { specification_id: string, value: number }[] } | { ok: false, errors: Record<string, string>, error?: string }}
 */
export function checkTestEntries(entries) {
  const values = [];
  const errors = {};
  for (const { specificationId, text } of entries) {
    if (!String(text ?? "").trim()) continue;
    const parsed = parseNumberInput(text);
    if (parsed.ok) values.push({ specification_id: specificationId, value: parsed.value });
    else errors[specificationId] = parsed.error;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!values.length) return { ok: false, errors: {}, error: "시험값을 하나 이상 입력해 주세요." };
  return { ok: true, values };
}

/**
 * FR-004 수용 기준 1: "역가 정상 · 엔도톡신 관리기준 이탈"
 * @param {{ specification_id: string, result: string }[]} results
 * @param {{ id: string, item_name: string }[]} specs
 */
export function resultSummaryText(results, specs) {
  const names = new Map(specs.map((spec) => [spec.id, spec.item_name]));
  return results.map((r) => `${names.get(r.specification_id) ?? "시험 항목"} ${resultLabel(r.result)}`).join(" · ");
}
