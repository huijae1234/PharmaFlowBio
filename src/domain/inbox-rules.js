// 앱 안 알림 함 (spec 009 FR-007). 화면 글자 규칙만

const MAX_SHOWN = 99;

/** FR-007 수용 기준 1: "알림 2" (색만으로 구분하지 않고 숫자를 글자로) @param {number} unread */
export function inboxLabel(unread) {
  if (!unread) return "알림";
  return `알림 ${unread > MAX_SHOWN ? `${MAX_SHOWN}+` : unread}`;
}

/** 화면 읽기용 이름 @param {number} unread */
export function inboxAriaLabel(unread) {
  return unread ? `알림, 새 알림 ${unread}건` : "알림, 새 알림 없음";
}

/** 알림이 가리키는 곳은 앱 안 주소만 (DB 값이라도 다른 사이트로 보내지 않는다) @param {string | null | undefined} path */
export function isSafeAppPath(path) {
  return typeof path === "string" && path.startsWith("#/");
}

/**
 * spec 009 v0.6 FR-008 수용 기준 3·4: "슬랙에서 확인함 · 시각". 확인 전이면 빈 글자
 * @param {string | null | undefined} acknowledgedAt
 * @param {(iso: string) => string} format 화면의 시각 글자 함수
 */
export function slackAckText(acknowledgedAt, format) {
  return acknowledgedAt ? `슬랙에서 확인함 · ${format(acknowledgedAt)}` : "";
}

// spec 018 FR-003: 보관 기한 도래는 사람이 한 일이 아니다. 알림을 만든 때 앱을 열고 있던 사람 이름을 붙이지 않는다
const SYSTEM_KINDS = new Set(["retention_due"]);

/**
 * 알림 함 한 줄 아래 "10/28 14:22 · 김희재"
 * @param {{ kind: string, created_at: string, creator?: { display_name: string } | null }} row
 * @param {(iso: string) => string} format
 */
export function inboxMetaText(row, format) {
  const time = format(row.created_at);
  return SYSTEM_KINDS.has(row.kind) ? time : `${time} · ${row.creator?.display_name ?? ""}`;
}
