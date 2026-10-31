// 조치 요청 규칙 (spec 002). 화면 표시용이다. 실제로 막는 것은 데이터베이스 함수 (supabase/migrations/0008_actions.sql)

const ACTION_TYPE_LABELS = {
  retest: "재시험",
  equipment_check: "설비 점검",
  material_check: "원료 확인",
  batch_discard: "로트 폐기",
};

const ACTION_STATUS_LABELS = {
  pending_approval: "승인 대기",
  approved: "승인됨",
  rejected: "반려됨",
  completed: "완료",
};

const ISSUE_SOURCE_LABELS = { test: "시험", process: "공정" };

// Q18: 데이터베이스 private.assignable_roles와 같은 표
const ASSIGNABLE_ROLES = {
  retest: ["qc_analyst", "qa_manager"],
  equipment_check: ["production_operator", "qa_manager"],
  material_check: ["qc_analyst", "production_operator", "qa_manager"],
  batch_discard: ["qa_manager"],
};

const OPEN_STATUSES = new Set(["pending_approval", "approved"]);

/** @param {string} type */
export function actionTypeLabel(type) {
  return ACTION_TYPE_LABELS[type] ?? type;
}

/** @param {string} status */
export function actionStatusLabel(status) {
  return ACTION_STATUS_LABELS[status] ?? status;
}

/** @param {string} source */
export function issueSourceLabel(source) {
  return ISSUE_SOURCE_LABELS[source] ?? source;
}

/**
 * Q20: 재시험은 시험 이슈에만 고를 수 있다
 * @param {"test" | "process"} source
 * @returns {string[]}
 */
export function actionTypesFor(source) {
  const types = Object.keys(ACTION_TYPE_LABELS);
  return source === "test" ? types : types.filter((type) => type !== "retest");
}

/** Q18 @param {string} type @returns {string[]} */
export function assignableRoles(type) {
  return ASSIGNABLE_ROLES[type] ?? [];
}

/**
 * FR-004 수용 기준 2 (spec 002): 승인 모달의 담당자 후보. 조치 종류에 맞는 역할인 사람만, 이름순
 * @param {{ display_name: string, role: string }[]} users
 * @param {string} type
 */
export function assignableUsers(users, type) {
  const roles = assignableRoles(type);
  return users
    .filter((user) => roles.includes(user.role))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ko"));
}

/** @param {{ status: string }[]} requests */
export function openRequestCount(requests) {
  return requests.filter((request) => OPEN_STATUSES.has(request.status)).length;
}

/**
 * FR-007 수용 기준 5 (spec 002): 승인된 요청에 배정된 사람이나 QA 관리자. 배정 뒤 열람자가 되면 못 한다 (spec 3절)
 * @param {{ status: string, assignee_id: string | null }} request
 * @param {{ id: string, role: string }} profile
 */
export function canCompleteRequest(request, profile) {
  if (request.status !== "approved" || profile.role === "viewer") return false;
  return profile.role === "qa_manager" || request.assignee_id === profile.id;
}

/**
 * FR-008 수용 기준 5, Q19: 이슈 닫기 버튼을 볼 사람. QA 관리자나 이 이슈의 요청에 배정됐던 사람
 * @param {{ assignee_id?: string | null }[]} requests
 * @param {{ id: string, role: string }} profile
 */
export function canCloseAs(requests, profile) {
  if (profile.role === "viewer") return false;
  return profile.role === "qa_manager" || requests.some((request) => request.assignee_id === profile.id);
}

/**
 * Q20: 재시험할 항목은 이슈를 연 첫 이탈 측정값의 항목 (measured_at 순으로 받은 목록). 관리기준 이탈 포함 (spec 004 FR-007)
 * @template {{ result: string, action_request_id: string | null }} T
 * @param {T[]} measurements
 * @returns {T | null}
 */
export function retestTarget(measurements) {
  return measurements.find((m) => !m.action_request_id && (m.result === "out_of_spec" || m.result === "out_of_alert")) ?? null;
}
