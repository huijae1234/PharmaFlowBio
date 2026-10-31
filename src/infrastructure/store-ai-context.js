// 새 AI 칸(spec 023)에 필요한 추가 읽기 두 가지. 읽기뿐이고 저장하지 않는다. 못 읽으면 "읽지 못함"으로 돌려 화면이 없음과 구분한다.
import { client, read } from "./store.js";
import { FOLLOWUP_RULES, baselineOf, toCandidate } from "../domain/ai-followup-rules.js";

const MEASUREMENT_FIELDS = "id, value, result, measured_at, batch_id, action_request_id, applied_spec_version, specification_id, batch:batch_id (id, batch_number), specification:specification_id (item_name, unit, category), process_record:process_record_id (step_run:step_run_id (process_step_id))";

/** 공정 이슈의 공정 기록에 연결된 공정 단계 이름. 연결이 없으면 null, 읽지 못하면 undefined (근거 표가 줄을 만들지 않는다) */
export async function loadStepLabel(processRecordId) {
  try {
    const row = await read(client.from("process_record").select("step_run:step_run_id (step_label)").eq("id", processRecordId).maybeSingle());
    return row?.step_run?.step_label ?? null;
  } catch {
    return undefined;
  }
}

/**
 * 조치 이후 비교에 쓸 자료: 기준 이슈의 이탈 측정값 하나로 비교 기준을 만들고, 같은 항목의 그 뒤 측정값을 읽는다.
 * 기준 이슈를 연 시각부터 읽어 "조치 완료 전 기록"도 셀 수 있게 한다. 상한을 넘기면 truncated로 알린다
 * @returns {Promise<{ baseline: object | null, read: { ok: boolean, truncated?: boolean, rows?: object[] } }>}
 */
export async function loadFollowup(measurementId, rules = FOLLOWUP_RULES) {
  try {
    const row = await read(client.from("measurement").select(MEASUREMENT_FIELDS).eq("id", measurementId).maybeSingle());
    const baseline = row ? baselineOf(row, row.process_record?.step_run?.process_step_id ?? null) : null;
    if (!baseline) return { baseline: null, read: { ok: true, rows: [] } };
    const rows = await read(client.from("measurement").select(MEASUREMENT_FIELDS).eq("specification_id", baseline.specificationId)
      .gte("measured_at", baseline.measuredAt).order("measured_at", { ascending: false }).limit(rules.fetchCap + 1));
    return { baseline, read: { ok: true, truncated: rows.length > rules.fetchCap, rows: rows.slice(0, rules.fetchCap).map(toCandidate) } };
  } catch {
    return { baseline: null, read: { ok: false } };
  }
}
