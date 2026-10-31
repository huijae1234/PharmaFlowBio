// spec 023 시험용 가상 자료 (교육용). 이 파일은 시험이 아니라 자료 틀이다(`.test.js`가 아니라 실행되지 않음).
export const NOW = new Date("2026-10-29T03:00:00.000Z");
export const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
const DAY = 86400000;
export const daysAgo = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

export const measurement = (over = {}) => ({
  id: "m1", value: 88, result: "out_of_spec", measured_at: daysAgo(3), action_request_id: null, process_record_id: null, quality_issue_id: ISSUE_ID,
  applied_min_value: 90, applied_max_value: 110, applied_alert_min_value: null, applied_alert_max_value: null, applied_spec_version: 1,
  specification_id: "s1", batch_id: "b1", batch: { id: "b1", batch_number: "HBV-2610-001" },
  specification: { item_name: "역가", unit: "%", category: "test", version: 1, min_value: 90, max_value: 110 }, ...over,
});

export const testIssue = (over = {}) => ({
  id: ISSUE_ID, source: "test", kind: "spec", status: "open", opened_at: daysAgo(3), process_record_id: null, process_record: null,
  batch: { id: "b1", batch_number: "HBV-2610-001", status: "on_hold", product: { item_name: "B형간염 백신 주 (교육용)" } }, ...over,
});

export const processIssue = (over = {}) => testIssue({
  source: "process", process_record_id: "pr1",
  process_record: { id: "pr1", recorded_at: daysAgo(3), equipment_status: "abnormal", production_quantity: 1200, recorder: { display_name: "홍길동" } }, ...over,
});

export const request = (over = {}) => ({
  id: "r1", action_type: "equipment_check", status: "approved", description: "설비 점검 요청 (010-1234-5678)", requested_at: daysAgo(2),
  result_note: null, completed_at: null, requester: { display_name: "김하나" }, assignee: { display_name: "이둘" }, ...over,
});

export const review = (over = {}) => ({
  id: "v1", status: "submitted", deviation_summary: "역할 시험에서 역가가 88%로 규격 90~110%를 벗어남", probable_cause: "시료 취급 중 온도 변화로 추정",
  impact_assessment: "해당 로트에 한정되며 다른 로트 영향은 낮음", proposed_action: "재시험 후 판단", evidence: "시험 기록 확인", ...over,
});

export const VALUES = {
  deviation_summary: "역가가 88%로 규격 90~110%를 벗어남", probable_cause: "시료 취급 중 온도 변화로 추정", impact_assessment: "해당 로트에 한정됨",
  proposed_action: "재시험 후 판단", evidence: "시험 기록 확인",
};

export const base = (over = {}) => ({ issue: testIssue(), opening: [measurement()], processItems: [], retests: [], requests: [], ...over });
