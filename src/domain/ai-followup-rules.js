// 조치 완료 후 "비슷한 이탈이 다시 관찰되는가" 비교 (spec 023 FR-003). 순수 함수.
// 비교 기간·대상 수·이탈 수·제외 사유는 코드가 센다. Claude는 이 값을 읽기 쉬운 문장으로 정리할 뿐이다.
// "비슷한 이탈이 관찰됨"은 "같은 원인으로 재발함"이 아니다: 조치 효과·원인·미래 재발·안전은 이 비교로 알 수 없다.
import { fact } from "./ai-facts-rules.js";
import { actionTypeLabel } from "./action-rules.js";
import { resultLabel } from "./judgement-rules.js";

/** 교육용 가정이다(실제 QA 기준이 아님). 한곳에서 바꾼다 (spec 023 5절) */
export const FOLLOWUP_RULES = { windowDays: 90, minDays: 14, minLots: 3, fetchCap: 500 };

const DAY_MS = 24 * 60 * 60 * 1000;
const time = (iso) => Date.parse(iso ?? "");

/** 기준 이슈의 이탈 측정값에서 비교 기준을 뽑는다. 비교할 측정이 없으면 null */
export function baselineOf(measurement, stepId) {
  if (!measurement?.specification_id || !Number.isFinite(measurement.applied_spec_version)) return null;
  const spec = measurement.specification ?? {};
  return {
    batchId: measurement.batch_id, batchNumber: measurement.batch?.batch_number ?? "", specificationId: measurement.specification_id,
    itemName: spec.item_name ?? "", unit: spec.unit ?? null, specVersion: measurement.applied_spec_version, result: measurement.result,
    measuredAt: measurement.measured_at, processItem: spec.category === "process", stepId: stepId ?? null,
  };
}

/** 측정값 한 줄(데이터베이스 모양)을 비교 후보로. 서버(api/_ai-data.js)와 화면(store-ai-context.js)이 같이 쓴다 */
export const toCandidate = (row) => ({
  id: row.id, batchId: row.batch_id, batchNumber: row.batch?.batch_number ?? "", value: row.value, result: row.result, measuredAt: row.measured_at,
  specVersion: row.applied_spec_version, unit: row.specification?.unit ?? null, stepId: row.process_record?.step_run?.process_step_id ?? null, actionRequestId: row.action_request_id,
});

function classify(candidates, baseline, action, rules) {
  const completed = time(action.completedAt);
  const excluded = { before: 0, afterWindow: 0, actionRetest: 0, unit: 0, version: 0, link: 0, step: 0 };
  const sameLot = { count: 0, deviations: 0 };
  const lots = new Map(); // 다른 로트별 (같은 로트의 재시험은 한 로트로 센다)
  for (const row of candidates) {
    const at = time(row.measuredAt);
    if (row.actionRequestId) excluded.actionRetest += 1; // 조치 결과로 넣은 재시험 측정: 조치 이후 관찰이 아니다
    else if (!(at > completed)) excluded.before += 1;
    else if (at > completed + rules.windowDays * DAY_MS) excluded.afterWindow += 1;
    else if ((row.unit ?? null) !== baseline.unit) excluded.unit += 1;
    else if (row.specVersion !== baseline.specVersion) excluded.version += 1;
    else if (baseline.processItem && !row.stepId) excluded.link += 1; // 공정 항목은 어느 단계에서 쟀는지 연결돼야 비교한다
    else if (baseline.processItem && row.stepId !== baseline.stepId) excluded.step += 1;
    else if (row.batchId === baseline.batchId) {
      sameLot.count += 1;
      if (row.result !== "pass") sameLot.deviations += 1;
    } else {
      const lot = lots.get(row.batchId) ?? { batchNumber: row.batchNumber, deviations: [] };
      if (row.result !== "pass") lot.deviations.push(row);
      lots.set(row.batchId, lot);
    }
  }
  const similar = [...lots.values()].filter((lot) => lot.deviations.length).map((lot) => ({ ...lot.deviations.sort((a, b) => time(b.measuredAt) - time(a.measuredAt))[0], batchNumber: lot.batchNumber }));
  return { excluded, sameLot, comparableLots: lots.size, similar };
}

/**
 * @param {{ baseline: ReturnType<typeof baselineOf>, action: { id: string, type: string, completedAt: string, hasNote?: boolean },
 *   read: { ok: boolean, truncated?: boolean, rows?: object[] }, now?: Date, rules?: typeof FOLLOWUP_RULES }} input
 * @returns {{ status: "failed" | "not_comparable" | "short_window" | "few_samples" | "observed" | "none_observed", reason?: string, baseline: object | null, action: object, observedDays: number, rules: typeof FOLLOWUP_RULES } & Partial<ReturnType<typeof classify>>}
 */
export function compareAfterAction({ baseline, action, read, now = new Date(), rules = FOLLOWUP_RULES }) {
  const observedDays = Math.max(0, Math.floor((now.getTime() - time(action.completedAt)) / DAY_MS)) || 0;
  const base = { baseline, action, observedDays, rules };
  if (!Number.isFinite(time(action.completedAt))) return { ...base, status: "failed", reason: "조치 완료 시각을 읽지 못했습니다" };
  if (!read?.ok) return { ...base, status: "failed", reason: "조치 이후 측정값을 읽지 못했습니다" };
  if (read.truncated) return { ...base, status: "failed", reason: `조회 상한(${rules.fetchCap}건)에 닿아 일부만 읽었습니다` }; // 잘린 자료로 "없음"을 말하지 않는다
  if (!baseline) return { ...base, status: "not_comparable", reason: "기준 이슈에 비교할 측정 항목(시험·공정 값과 기준 버전)이 없습니다" };
  if (baseline.processItem && !baseline.stepId) return { ...base, status: "not_comparable", reason: "기준 이슈의 공정 기록에 공정 단계 연결이 없어 같은 단계끼리 비교할 수 없습니다" };
  const found = classify(read.rows ?? [], baseline, action, rules);
  const status = found.similar.length ? "observed" : observedDays < rules.minDays ? "short_window" : found.comparableLots < rules.minLots ? "few_samples" : "none_observed";
  return { ...base, ...found, status };
}

/** 코드가 쓰는 한 줄 결과 (AI가 없어도 보인다). 자료가 부족하면 필요한 자료를 함께 */
export function followupHeadline(result) {
  const { rules, observedDays, baseline } = result;
  const item = baseline ? `${baseline.itemName}(기준 v${baseline.specVersion})` : "비교 항목";
  switch (result.status) {
    case "failed": return { text: `조치 이후 자료를 확인하지 못했습니다. ${result.reason}. 이탈이 없다는 뜻이 아닙니다.`, need: "다시 시도해 주세요." };
    case "not_comparable": return { text: `비교할 수 없습니다. ${result.reason}.`, need: "필요한 자료: 같은 시험·공정 항목의 측정값과 공정 단계 연결." };
    case "short_window": return { text: `조치 이후 비교 자료가 부족합니다. 완료 후 ${observedDays}일이 지났고 최소 ${rules.minDays}일이 필요합니다(비교 기간 부족). 이탈이 없다는 뜻이 아닙니다.`, need: `필요한 자료: 조치 완료 후 ${rules.minDays}일 이상의 관찰과 ${item}의 다른 로트 측정값 ${rules.minLots}개 이상.` };
    case "few_samples": return { text: `조치 이후 비교 자료가 부족합니다. 비교 가능한 다른 로트가 ${result.comparableLots}개이고 최소 ${rules.minLots}개가 필요합니다(표본 부족). 이탈이 없다는 뜻이 아닙니다.`, need: `필요한 자료: 조치 완료 후 ${item}의 다른 로트 측정값(같은 단위·같은 기준 버전) ${rules.minLots}개 로트 이상.` };
    case "observed": return { text: `조치 이후 비슷한 이탈이 다른 로트 ${result.similar.length}개에서 관찰되었습니다. 같은 원인으로 재발했다는 뜻은 아닙니다.`, need: null };
    default: return { text: `충분한 비교 자료(다른 로트 ${result.comparableLots}개, 조치 후 ${observedDays}일)에서 비슷한 이탈이 관찰되지 않았습니다. 조치 효과를 입증하지 않습니다.`, need: null };
  }
}

/** AI는 비교가 끝나 말할 거리가 있을 때만 부른다 (자료 부족·조회 실패·비교 불가는 코드 문구만) */
export const canSummarize = (result) => result.status === "observed" || result.status === "none_observed";

const dateText = (iso) => String(iso ?? "").slice(0, 10);

/** FR-003 근거 표: 위 비교 결과의 숫자와 제외 사유. 줄의 값은 모두 코드가 센 값이다 */
export function followupFacts(result, now = new Date()) {
  const { baseline, action, rules, excluded, sameLot } = result;
  const lots = result.similar.map((row, index) => fact(`case_${index + 1}`, `비슷한 이탈 사례 ${index + 1}`, `로트 ${row.batchNumber} · ${row.value}${baseline.unit ?? ""} · ${resultLabel(row.result)} · ${dateText(row.measuredAt)}`, { href: `#/batches/${row.batchId}` }));
  const levels = result.similar.reduce((sum, row) => ({ ...sum, [row.result]: (sum[row.result] ?? 0) + 1 }), {});
  return {
    asOf: now.toISOString(),
    rows: [
      fact("base", "기준 이슈", `로트 ${baseline.batchNumber} · ${baseline.itemName} · ${resultLabel(baseline.result)} · 기준 v${baseline.specVersion}`),
      fact("action", "완료된 조치", `${actionTypeLabel(action.type)} · 완료 ${dateText(action.completedAt)} · 조치 후 ${result.observedDays}일 · ${action.hasNote ? "결과 글 기록됨" : "결과 글 없음"}`),
      fact("rule", "비교 기준(교육용 가정)", `같은 제품·같은 항목·같은 단위·같은 기준 버전의 다른 로트, 조치 완료 후 ${rules.windowDays}일 안. 최소 ${rules.minDays}일·${rules.minLots}개 로트`),
      fact("cmp_lots", "비교 가능한 다른 로트", `${result.comparableLots}개`),
      fact("similar", "비슷한 이탈이 관찰된 다른 로트", `${result.similar.length}개 (규격 이탈 ${levels.out_of_spec ?? 0}개 · 관리기준 이탈 ${levels.out_of_alert ?? 0}개)`, { must: result.similar.length > 0 }),
      ...lots.slice(0, 3),
      fact("same_lot", "같은 로트의 조치 이후 재측정", `${sameLot.count}건 (이탈 ${sameLot.deviations}건). 다른 로트 비교에는 넣지 않았습니다`),
      fact("excluded", "제외한 기록", `조치 완료 전 ${excluded.before}건 · 조치 결과 재시험 ${excluded.actionRetest}건 · 관찰 기간 밖 ${excluded.afterWindow}건 · 단위 다름 ${excluded.unit}건 · 기준 버전 다름 ${excluded.version}건 · 대상 연결 불분명 ${excluded.link}건 · 공정 단계 다름 ${excluded.step}건`),
    ],
    limits: [
      "비슷한 이탈이 관찰됨은 같은 원인으로 재발했다는 뜻이 아닙니다.",
      "조치 효과 입증·원인·미래 재발 가능성·안전 판정은 이 비교로 알 수 없습니다.",
      "비교 기간과 최소 자료 기준은 교육용 가정입니다.",
    ],
  };
}
