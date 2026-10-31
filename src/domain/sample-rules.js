// 검체 인계 (spec 008). 화면에 버튼을 보일지 정하는 규칙이다. 실제로 막는 것은 데이터베이스 함수다 (ADR 0002)

export const TEAM_LABELS = { production: "생산", qc: "QC", qa: "QA" };
export const SAMPLE_KIND_LABELS = { test: "시험 검체", retention: "보존 검체" };
export const SAMPLE_STATUS_LABELS = {
  pending: "인수 대기",
  held: "보관 중",
  return_pending: "반납 대기",
  returned: "반납 완료",
  consumed: "소진",
  disposed: "폐기", // spec 018 FR-004
};
// Q46 가정: 단위 네 가지
export const SAMPLE_UNITS = ["바이알", "mL", "g", "개"];

const ROLE_TEAMS = { production_operator: "production", qc_analyst: "qc", qa_manager: "qa" };

// FR-001 수용 기준 2·3: 생산은 QC(시험 검체)·QA(보존 검체)로, QA는 보존 검체를 QC로
const ROUTES = [
  { from: "production", to: "qc", kind: "test" },
  { from: "production", to: "qa", kind: "retention" },
  { from: "qa", to: "qc", kind: "retention" },
];

const QUANTITY_PATTERN = /^\d+$/;
const MAX_QUANTITY = 9999;
const MAX_LOCATION = 60;

/** @param {string | undefined} role @returns {string | undefined} */
export function teamOf(role) {
  return ROLE_TEAMS[role];
}

/** FR-001 @param {string | undefined} role */
export function routesFor(role) {
  const team = teamOf(role);
  return ROUTES.filter((route) => route.from === team);
}

/** "생산 → QC · 시험 검체" @param {{ from: string, to: string, kind: string }} route */
export function routeLabel(route) {
  return `${TEAM_LABELS[route.from]} → ${TEAM_LABELS[route.to]} · ${SAMPLE_KIND_LABELS[route.kind]}`;
}

/**
 * FR-002~004: 이 역할이 이 기록에서 할 수 있는 처리
 * @param {string | undefined} role
 * @param {{ from_team: string, to_team: string, status: string }} transfer
 * @returns {("receive" | "return" | "consume" | "confirm_return")[]}
 */
export function availableActions(role, transfer) {
  const team = teamOf(role);
  if (!team) return [];
  if (transfer.status === "pending" && team === transfer.to_team) return ["receive"];
  if (transfer.status === "held" && team === transfer.to_team) {
    return team === "qc" ? ["return", "consume"] : ["return"];
  }
  if (transfer.status === "return_pending" && team === transfer.from_team) return ["confirm_return"];
  return [];
}

function parseCount(text, max) {
  const trimmed = String(text ?? "").trim();
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= max ? value : null;
}

/** 경계 상황: 수량 1~9999 정수 @param {string | null | undefined} text */
export function checkQuantity(text) {
  const value = parseCount(text, MAX_QUANTITY);
  if (value === null) return { ok: false, error: "수량은 1부터 9999까지 숫자로 입력해 주세요." };
  return { ok: true, value };
}

/** FR-002 수용 기준 3 @param {string | null | undefined} text */
export function checkLocation(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, error: "보관 위치를 입력해 주세요. 예: 보존검체실 냉장고 R-02 3단" };
  if (trimmed.length > MAX_LOCATION) return { ok: false, error: "보관 위치는 60자까지 입력해 주세요." };
  return { ok: true, value: trimmed };
}

/**
 * FR-003 수용 기준 3
 * @param {string | null | undefined} text
 * @param {number} received 받은 수량
 */
export function checkReturnQuantity(text, received) {
  const value = parseCount(text, received);
  if (value === null) return { ok: false, error: `반납 수량은 1부터 받은 수량(${received})까지 입력해 주세요.` };
  return { ok: true, value };
}

/**
 * FR-006, Q47: 한 로트에서 QA가 보관 중인 보존 검체 수.
 * 생산 → QA 보관 중 − QA → QC로 넘긴 수량 + QA → QC에서 반납 완료된 수량 (+ 폐기 기록은 폐기하지 않은 몫, spec 018).
 * DB 함수 private.qa_retained_quantity와 같은 식
 * @param {{ from_team: string, to_team: string, status: string, quantity: number, returned_quantity?: number | null }[]} transfers
 */
export function retainedQuantity(transfers) {
  return transfers.reduce((sum, t) => {
    if (t.from_team === "production" && t.to_team === "qa") {
      if (t.status === "held") return sum + t.quantity;
      // spec 018 Q82: 폐기한 기록은 폐기하지 않은 몫만 남는다
      return t.status === "disposed" ? sum + t.quantity - (t.disposed_quantity ?? 0) : sum;
    }
    if (t.from_team === "qa" && t.to_team === "qc") {
      return sum - t.quantity + (t.status === "returned" ? t.returned_quantity ?? 0 : 0);
    }
    return sum;
  }, 0);
}

// ── 보관 기한·폐기 (spec 018). 막는 것은 데이터베이스 함수 dispose_sample, 기한 식은 private.retention_due와 같다 ──
const RETENTION_YEARS = 2;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const NOTE_LIMIT = 200;

/** 한국 날짜 "YYYY-MM-DD" (한국은 서머타임이 없어 9시간을 더한다) @param {Date} date */
export function seoulDate(date) {
  return new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

function isRetentionRecord(t) {
  return t.from_team === "production" && t.to_team === "qa" && t.sample_kind === "retention";
}

/**
 * FR-002: 인수 확인한 한국 날짜 + 2년. 2월 29일은 2월 28일(Q80). 생산 → QA 보존 검체가 아니거나 인수 전이면 null
 * @param {{ from_team: string, to_team: string, sample_kind: string, received_at?: string | null }} t
 */
export function retentionDueDate(t) {
  if (!isRetentionRecord(t) || !t.received_at) return null;
  const [year, month, day] = seoulDate(new Date(t.received_at)).split("-").map(Number);
  const dueDay = month === 2 && day === 29 ? 28 : day;
  return `${year + RETENTION_YEARS}-${String(month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
}

/** FR-002 수용 기준 3·4: 보관 중이고 오늘(한국 날짜)이 기한과 같거나 뒤 @param {object} t @param {string} today */
export function isRetentionDue(t, today) {
  const due = retentionDueDate(t);
  return t.status === "held" && due !== null && today >= due;
}

/** FR-004 수용 기준 1 @param {string | undefined} role @param {object} t @param {string} today */
export function canDispose(role, t, today) {
  return role === "qa_manager" && isRetentionDue(t, today);
}

/**
 * FR-004 수용 기준 4, Q82: 기록 수량과 그 로트 QA 보관 수 중 작은 값
 * @param {{ quantity: number }} record
 * @param {object[]} lotTransfers 같은 로트의 검체 기록 전부
 */
export function disposalQuantity(record, lotTransfers) {
  return Math.max(0, Math.min(record.quantity, retainedQuantity(lotTransfers)));
}

/**
 * FR-004 경계 상황
 * @param {{ disposedAt: string, note: string, now: Date, dueDate: string }} input
 * @returns {{ ok: true, value: { disposedAt: string, note: string | null } } | { ok: false, error: string }}
 */
export function checkDisposal({ disposedAt, note, now, dueDate }) {
  const at = disposedAt ? new Date(disposedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return { ok: false, error: "폐기 일시를 입력해 주세요." };
  if (at.getTime() > now.getTime()) return { ok: false, error: "폐기 일시는 지금보다 뒤일 수 없습니다." };
  if (seoulDate(at) < dueDate) return { ok: false, error: "폐기 일시는 보관 기한 뒤여야 합니다." };
  const trimmed = String(note ?? "").trim();
  if (trimmed.length > NOTE_LIMIT) return { ok: false, error: "메모는 200자까지 입력해 주세요." };
  return { ok: true, value: { disposedAt: at.toISOString(), note: trimmed || null } };
}
