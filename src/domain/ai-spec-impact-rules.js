// 기준 변경 영향 설명 (spec 024 FR-001). 순수 함수.
// 측정값에는 판정 당시의 기준과 버전(applied_*)이 저장돼 있다. 같은 측정값을 그때 판정과 "현재 기준"으로 다시 비교해 변경·유지·비교 불가를 센다.
// 저장돼 있지 않은 과거 기준은 복원하지 않는다(버전만 같으면 같은 기준이다). 원래 판정·로트 상태·승인 이력은 바꾸지 않는 참고 결과다.
import { cleanText, fact } from "./ai-facts-rules.js";
import { resultLabel } from "./judgement-rules.js";

export const SPEC_IMPACT_CAP = 300; // 이 수까지만 읽는다. 넘으면 일부만 읽은 것이라 비교하지 않는다

/** 데이터베이스 private.judge와 같은 규칙: 규격 밖이면 규격 이탈, 관리기준이 있고 그 밖이면 관리기준 이탈 */
export function judgeValue(value, range) {
  if (value < range.min_value || value > range.max_value) return "out_of_spec";
  if (range.alert_min_value !== null && range.alert_min_value !== undefined && (value < range.alert_min_value || value > range.alert_max_value)) return "out_of_alert";
  return "pass";
}

const num = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const rangeText = (min, max, alertMin, alertMax, unit) => `규격 ${min}~${max}${unit ?? ""} · ${num(alertMin) ? `관리기준 ${alertMin}~${alertMax}${unit ?? ""}` : "관리기준 없음"}`;

/** 측정값이 판정 당시 기준을 갖고 있는가 (옛 자료에는 없을 수 있다: 그때 기준을 임의로 채우지 않는다) */
const hasApplied = (m) => Number.isInteger(m.applied_spec_version) && num(m.applied_min_value) && num(m.applied_max_value);

/**
 * @param {{ spec: { item_name: string, unit: string | null, min_value: number, max_value: number, alert_min_value: number | null, alert_max_value: number | null, version: number },
 *   measurements: { id: string, value: number, result: string, batch_id: string, batch?: { batch_number: string } | null, applied_unit?: string | null }[],
 *   read: { ok: boolean, truncated?: boolean } }} input
 */
export function specImpact({ spec, measurements, read }) {
  if (!read?.ok) return { status: "failed", reason: "측정값을 읽지 못했습니다", spec };
  if (read.truncated) return { status: "failed", reason: `조회 상한(${SPEC_IMPACT_CAP}건)에 닿아 일부만 읽었습니다`, spec };
  if (!measurements.length) return { status: "no_data", spec };
  const counts = { total: measurements.length, sameVersion: 0, kept: 0, changed: 0, missing: 0, unit: 0 };
  const changed = [];
  const versions = new Map();
  for (const m of measurements) {
    if (!hasApplied(m)) { counts.missing += 1; continue; } // 기준 누락: 비교 불가
    if (m.applied_unit !== undefined && m.applied_unit !== null && m.applied_unit !== (spec.unit ?? null)) { counts.unit += 1; continue; } // 단위 차이: 비교 불가
    const entry = versions.get(m.applied_spec_version) ?? { version: m.applied_spec_version, count: 0, text: rangeText(m.applied_min_value, m.applied_max_value, m.applied_alert_min_value, m.applied_alert_max_value, spec.unit) };
    entry.count += 1;
    versions.set(m.applied_spec_version, entry);
    if (m.applied_spec_version === spec.version) { counts.sameVersion += 1; continue; } // 같은 버전이면 같은 기준이다
    const now = judgeValue(Number(m.value), spec);
    if (now === m.result) counts.kept += 1;
    else {
      counts.changed += 1;
      changed.push({ batchId: m.batch_id, batchNumber: m.batch?.batch_number ?? "", value: m.value, from: m.result, to: now, version: m.applied_spec_version });
    }
  }
  return { status: counts.total === counts.missing + counts.unit ? "not_comparable" : "computed", spec, counts, changed, versions: [...versions.values()].sort((a, b) => a.version - b.version) };
}

/** 코드가 쓰는 한 줄 결과 (AI가 없어도 보인다) */
export function specImpactHeadline(result) {
  if (result.status === "failed") return `${result.reason}. 비교하지 않았고, 판정이 그대로라는 뜻이 아닙니다.`;
  if (result.status === "no_data") return "이 항목의 측정값이 없어 비교할 것이 없습니다(판정이 바뀌지 않는다는 뜻이 아닙니다).";
  const { counts } = result;
  if (result.status === "not_comparable") return `비교할 수 없습니다: 측정값 ${counts.total}건 모두 판정 당시 기준이 저장돼 있지 않거나 단위가 달라 현재 기준과 맞춰 볼 수 없습니다.`;
  return `현재 기준(v${result.spec.version})으로 비교한 참고 결과: 측정값 ${counts.total}건 중 판정이 달라지는 것 ${counts.changed}건, 같은 판정 ${counts.kept}건, 같은 버전 ${counts.sameVersion}건, 비교 불가 ${counts.missing + counts.unit}건. 원래 판정은 바뀌지 않습니다.`;
}

/** AI는 비교한 측정이 있을 때만 부른다 */
export const canExplain = (result) => result.status === "computed";

/** 근거 표: 코드가 센 값만. 측정 당시 단위는 저장되지 않는다는 한계를 줄로 남긴다 */
export function specImpactFacts(result, now = new Date()) {
  const { spec, counts } = result;
  return {
    asOf: now.toISOString(),
    rows: [
      fact("spec", "현재 기준", `${cleanText(spec.item_name, 60)} · v${spec.version} · ${rangeText(spec.min_value, spec.max_value, spec.alert_min_value, spec.alert_max_value, spec.unit)}`),
      ...result.versions.slice(0, 4).map((entry, index) => fact(`applied_${index + 1}`, `측정 당시 저장된 기준 v${entry.version}`, `${entry.text} · 측정값 ${entry.count}건`)),
      fact("total", "읽은 측정값", `${counts.total}건`),
      fact("changed", "현재 기준으로 비교하면 판정이 달라지는 측정", `${counts.changed}건`, { must: counts.changed > 0 }),
      fact("kept", "기준 버전이 달라도 판정이 같은 측정", `${counts.kept}건`),
      fact("same_version", "현재와 같은 버전의 측정", `${counts.sameVersion}건`),
      fact("unusable", "비교 불가(판정 당시 기준 누락·단위 차이)", `${counts.missing + counts.unit}건 (기준 누락 ${counts.missing}건 · 단위 차이 ${counts.unit}건)`, { must: counts.missing + counts.unit > 0 }),
      fact("unit", "측정 당시 단위", "저장되지 않았습니다. 단위 차이를 확인할 수 없습니다", { state: "none" }),
      ...result.changed.slice(0, 5).map((row, index) => fact(`case_${index + 1}`, `판정이 달라지는 사례 ${index + 1}`,
        `로트 ${row.batchNumber} · 측정값 ${row.value}${spec.unit ?? ""} · 당시 v${row.version} 판정 ${resultLabel(row.from)} → 현재 기준 ${resultLabel(row.to)}`, { href: `#/batches/${row.batchId}` })),
    ],
    limits: [
      "현재 기준으로 비교한 참고 결과입니다. 원래 판정·로트 상태·승인 이력은 바뀌지 않습니다.",
      "측정값은 기록한 값 그대로이고, 달라지는 것은 기준입니다. 저장돼 있지 않은 과거 기준은 복원하지 않았습니다.",
      "기준 수정·소급 판정·출하 승인은 이 기능에서 하지 않습니다.",
    ],
  };
}
