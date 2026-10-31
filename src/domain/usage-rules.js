// 사용 기록 (spec 003 FR-008, FR-009, ERD usage_log). 사용자 ID만 남기고 이메일은 넣지 않는다

const EVENT_LABELS = {
  login: "로그인",
  logout: "로그아웃",
  page_view: "화면 이동",
  search: "검색",
  public_api_call: "공공데이터 호출",
};
// spec 003 v0.4 FR-009 (Q63): 화면에는 화면 이동을 보이지 않는다. 기록은 계속 남겨 나중에 다시 볼 수 있게 한다
export const SHOWN_USAGE_TYPES = ["login", "logout", "search", "public_api_call"];
const API_LABELS = { permit: "허가정보", recall: "회수·판매중지", msds: "MSDS", gmp: "GMP 적합판정서", shipment: "국가출하승인", ai: "AI 요약" };

/**
 * 종류마다 맞는 칸만 넣은 한 줄. 남길 수 없으면 null (없는 종류, 사용자 없음, 빈 검색어)
 * @param {string | null} userId
 * @param {string} type
 * @param {{ path?: string, searchTerm?: string, apiName?: string, success?: boolean, durationMs?: number }} [detail]
 */
export function usageEntry(userId, type, detail = {}) {
  if (!userId || !(type in EVENT_LABELS)) return null;
  const row = { user_id: userId, event_type: type };
  if (type === "page_view") row.path = detail.path;
  if (type === "search") {
    const term = String(detail.searchTerm ?? "").trim();
    if (!term) return null;
    row.search_term = term;
  }
  if (type === "public_api_call") {
    row.api_name = detail.apiName;
    row.success = Boolean(detail.success);
    row.duration_ms = Math.round(detail.durationMs ?? 0);
  }
  return row;
}

/** 화면 이동 기록용 주소: 거르기 조건(쿼리)은 뺀다 */
export function pagePath(hash) {
  return (hash || "#/").split("?")[0];
}

export function eventLabel(type) {
  return EVENT_LABELS[type] ?? type;
}

export function apiLabel(name) {
  return API_LABELS[name] ?? name ?? "";
}

/** FR-009 수용 기준 1: 내용 칸 (주소·검색어·호출 대상) */
export function usageDetail(row) {
  if (row.event_type === "page_view") return row.path ?? "";
  if (row.event_type === "search") return row.search_term ?? "";
  if (row.event_type === "public_api_call") return apiLabel(row.api_name);
  return "";
}

/** FR-009 수용 기준 2: 성공 여부는 색이 아니라 글자로 */
export function successLabel(success) {
  if (success === true) return "성공";
  if (success === false) return "실패";
  return "";
}

// spec 009 FR-005: 슬랙 알림 결과 (ERD notification.status)
const NOTIFICATION_STATUS_LABELS = {
  pending: "보내기 전",
  sending: "보내는 중",
  sent: "보냄",
  sent_channel: "채널로 보냄",
  failed: "보내지 못함",
};

/** 상태와 이유를 한 줄로: "보내지 못함 · 슬랙 설정 없음" @param {{ status: string, reason: string | null }} row */
export function notificationResultText(row) {
  const label = NOTIFICATION_STATUS_LABELS[row.status] ?? row.status;
  return row.reason ? `${label} · ${row.reason}` : label;
}
