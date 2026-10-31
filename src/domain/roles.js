// 화면에 버튼을 보일지 정하는 표다. 실제로 막는 것은 데이터베이스 규칙(RLS)과 함수다 (ADR 0002).

const ROLE_LABELS = {
  viewer: "열람자",
  qc_analyst: "QC 시험 담당자",
  production_operator: "생산 담당자",
  qa_manager: "QA 관리자",
};

// FR-005 (spec 001), IA 확인된 사항 "첫 화면"
const HOME_PATHS = {
  qa_manager: "#/home/qa",
  qc_analyst: "#/home/qc",
  production_operator: "#/home/production",
  viewer: "#/batches",
};

// FR-006 (spec 001), IA "역할별로 쓸 수 있는 화면"
const ALLOWED_ACTIONS = {
  viewer: [],
  qc_analyst: ["record_test", "request_action"],
  // spec 010 FR-007: 생산 담당자는 로트를 직접 등록하지 않고 작업지시를 착수해 만든다
  production_operator: [
    "record_process", "hold_batch", "request_action", "create_work_order", "start_work_order", "cancel_work_order",
    "ship_batch", // spec 017 FR-005: 출하 완료는 생산 담당자만
  ],
  qa_manager: [
    "record_test", "record_process", "hold_batch", "create_batch", "edit_specification", "assign_role",
    "request_action", "review_action", "decide_release", // spec 002
    "create_product", // spec 003
    "create_work_order", "release_work_order", "start_work_order", "cancel_work_order", // spec 010
  ],
};

// 사용자·역할 화면의 선택지 순서 (FR-004)
export const ROLES = Object.keys(ROLE_LABELS);

// IA 네비게이션 모델: 다른 역할은 자기 첫 화면만, QA 관리자는 모든 첫 화면과 관리 메뉴
const RESTRICTED_PAGES = {
  "#/home/qa": ["qa_manager"],
  "#/home/qc": ["qc_analyst", "qa_manager"],
  "#/home/production": ["production_operator", "qa_manager"],
  "#/admin/users": ["qa_manager"],
  "#/admin/approvals": ["qa_manager"], // spec 002 FR-011
  "#/admin/history": ["qa_manager"], // spec 002 FR-013
  "#/admin/usage": ["qa_manager"], // spec 003 FR-009
};

/**
 * FR-004, FR-005 (spec 001): 이 역할이 이 주소의 화면을 열 수 있는가
 * @param {string | undefined} role
 * @param {string} path 해시 주소 (예: "#/home/qa")
 */
export function canOpen(role, path) {
  const allowed = RESTRICTED_PAGES[path];
  return !allowed || allowed.includes(role);
}

/** @param {string | undefined} role */
export function roleLabel(role) {
  return ROLE_LABELS[role] ?? ROLE_LABELS.viewer;
}

/** @param {string | undefined} role */
export function homePathFor(role) {
  return HOME_PATHS[role] ?? HOME_PATHS.viewer;
}

/** FR-003 (spec 001) @param {string | undefined} role */
export function isReadOnly(role) {
  return !ALLOWED_ACTIONS[role]?.length;
}

/**
 * @param {string | undefined} role
 * @param {string} action
 */
export function can(role, action) {
  return ALLOWED_ACTIONS[role]?.includes(action) ?? false;
}

/**
 * IA 네비게이션 모델: 홈, 로트, 품질 이슈, 제품, 관리(QA 관리자만). MSDS는 각 홈 아래 링크 (spec 007 FR-007)
 * spec 007 FR-002: 첫 줄 이름은 "홈"(역할별 첫 화면). FR-003: 예시 자료 되돌리기 메뉴는 없다
 * @param {string | undefined} role
 * @returns {{ label: string, path: string }[]}
 */
export function menuFor(role) {
  const items = [
    { label: "로트", path: "#/batches" },
    { label: "작업지시", path: "#/work-orders" }, // spec 010 IA WO_010000_PG
    { label: "품질 이슈", path: "#/issues" },
    { label: "제품", path: "#/products" },
    { label: "검체", path: "#/samples" }, // spec 008 IA SM_010000_PG
  ];
  // 열람자의 첫 화면은 로트 목록이라 같은 메뉴를 두 번 보이지 않는다
  const home = homePathFor(role);
  if (!items.some((item) => item.path === home)) items.unshift({ label: "홈", path: home });
  if (role === "qa_manager") {
    items.push(
      { label: "승인 대기", path: "#/admin/approvals" },
      { label: "전체 업무 이력", path: "#/admin/history" },
      { label: "사용 기록", path: "#/admin/usage" },
      { label: "사용자·역할", path: "#/admin/users" },
    );
  }
  return items;
}
