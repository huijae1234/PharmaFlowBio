// 작업지시 (spec 010). 화면에 버튼을 보일지 정하고 입력 형식을 검사한다. 실제로 막는 것은 데이터베이스 함수다 (ADR 0002)

export const WORK_ORDER_STATUS_LABELS = {
  draft: "작성",
  released: "발행",
  in_progress: "진행 중",
  completed: "완료",
  cancelled: "취소",
};
// Q62 가정: 단위 네 가지
export const WORK_ORDER_UNITS = ["바이알", "mL", "L", "개"];

const NUMBER_PATTERN = /^\d+(\.\d+)?$/;
const MAX_QUANTITY = 1000000;
const MAX_REASON = 200;

/**
 * FR-002~005: 이 역할이 이 작업지시에서 할 수 있는 처리. 발행은 QA 관리자만 (Q55)
 * @param {string | undefined} role
 * @param {{ status: string }} order
 * @returns {("release" | "start" | "cancel")[]}
 */
export function workOrderActions(role, order) {
  if (role !== "qa_manager" && role !== "production_operator") return [];
  if (order.status === "draft") return role === "qa_manager" ? ["release", "cancel"] : ["cancel"];
  if (order.status === "released") return ["start", "cancel"];
  return [];
}

/** 경계 상황: 0보다 크고 1,000,000 이하, 소수 허용 @param {string | null | undefined} text */
export function checkPlannedQuantity(text) {
  const trimmed = String(text ?? "").trim();
  const value = Number(trimmed);
  if (!NUMBER_PATTERN.test(trimmed) || value <= 0) {
    return { ok: false, error: "계획 수량은 0보다 큰 숫자로 입력해 주세요." };
  }
  if (value > MAX_QUANTITY) return { ok: false, error: "계획 수량이 너무 큽니다. 1,000,000 이하로 입력해 주세요." };
  return { ok: true, value };
}

/**
 * 경계 상황: 같은 날은 허용, 지난 날짜도 허용(늦게 입력하는 경우)
 * @param {string} start "YYYY-MM-DD"
 * @param {string} end "YYYY-MM-DD"
 */
export function checkPlannedPeriod(start, end) {
  if (!start || !end) return { ok: false, error: "계획 시작일과 종료일을 입력해 주세요." };
  if (end < start) return { ok: false, error: "계획 종료일은 시작일과 같거나 뒤여야 합니다." };
  return { ok: true };
}

/** Q62 @param {string | null | undefined} unit */
export function checkUnit(unit) {
  if (!WORK_ORDER_UNITS.includes(unit)) return { ok: false, error: "단위를 골라 주세요." };
  return { ok: true, value: unit };
}

/** FR-003 경계 상황 @param {string | null | undefined} text */
export function checkLotNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, error: "로트번호를 입력해 주세요." };
  // 작업지시 번호를 로트번호로 쓴 일이 있었다 (2026-10-29 사용자 요청으로 이름을 바꿈, 0038)
  if (/^WO-/i.test(trimmed)) return { ok: false, error: "작업지시 번호는 로트번호로 쓸 수 없습니다. TDP-2610-005처럼 제품 약자로 시작해 주세요." };
  return { ok: true, value: trimmed };
}

/** FR-004 수용 기준 2 @param {string | null | undefined} text */
export function checkCancelReason(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, error: "취소 사유를 입력해 주세요." };
  if (trimmed.length > MAX_REASON) return { ok: false, error: "취소 사유는 200자까지 입력해 주세요." };
  return { ok: true, value: trimmed };
}

/**
 * FR-006 수용 기준 3: 제조공정 홈 "착수할 작업지시" — 발행 상태만, 계획 시작일 빠른 순
 * @template {{ status: string, planned_start: string }} T
 * @param {T[]} orders
 * @returns {T[]}
 */
export function ordersToStart(orders) {
  return orders
    .filter((o) => o.status === "released")
    .sort((a, b) => a.planned_start.localeCompare(b.planned_start));
}

/** FR-005·006 화면 글자: "5,000 바이알" @param {{ planned_quantity: number | string, unit: string }} order */
export function quantityText(order) {
  return `${Number(order.planned_quantity).toLocaleString("ko-KR")} ${order.unit}`;
}

/** FR-005·006 화면 글자: "11-02 ~ 11-06", 같은 날이면 "11-02" @param {{ planned_start: string, planned_end: string }} order */
export function periodText(order) {
  const short = (day) => day.slice(5);
  return order.planned_start === order.planned_end ? short(order.planned_start) : `${short(order.planned_start)} ~ ${short(order.planned_end)}`;
}

const LOT_PATTERN = /^([A-Z]{2,5})-(\d{4})-(\d{3})$/;
const NOT_PRODUCT_PREFIX = ["WO", "QA"]; // 작업지시 번호·확인용 로트는 제품 약자가 아니다
const KST_MS = 9 * 3600 * 1000;

/**
 * 그 제품 로트번호에서 가장 많이 쓴 제품 약자(IFV·HBV·TDP 등). 없으면 null
 * @param {string[]} batchNumbers
 */
export function lotPrefix(batchNumbers) {
  const counts = new Map();
  for (const number of batchNumbers) {
    const prefix = LOT_PATTERN.exec(number)?.[1];
    if (prefix && !NOT_PRODUCT_PREFIX.includes(prefix)) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * 착수 전에 보여 줄 예정 로트번호 (2026-10-29 사용자 요청): 제품 약자-착수하는 달(한국 시각 YYMM)-다음 번호.
 * 같은 제품의 발행된 작업지시는 계획 시작일 순으로 번호를 이어 준다. 약자를 모르는 제품은 빠진다(직접 입력)
 * @param {{ id: string, status: string, product_id: string, planned_start: string }[]} orders
 * @param {{ batch_number: string, product_id: string }[]} lots
 * @param {Date} now
 * @returns {Map<string, string>} 작업지시 id → 예정 로트번호
 */
export function plannedLotNumbers(orders, lots, now) {
  const month = new Date(now.getTime() + KST_MS).toISOString().slice(2, 7).replace("-", "");
  const used = new Map(); // 약자 → 이 달에 쓴 가장 큰 번호
  for (const lot of lots) {
    const match = LOT_PATTERN.exec(lot.batch_number);
    if (match && match[2] === month) used.set(match[1], Math.max(used.get(match[1]) ?? 0, Number(match[3])));
  }
  const planned = new Map();
  const released = orders.filter((order) => order.status === "released").sort((a, b) => String(a.planned_start).localeCompare(String(b.planned_start)));
  for (const order of released) {
    const prefix = lotPrefix(lots.filter((lot) => lot.product_id === order.product_id).map((lot) => lot.batch_number));
    if (!prefix) continue;
    const next = (used.get(prefix) ?? 0) + 1;
    used.set(prefix, next);
    planned.set(order.id, `${prefix}-${month}-${String(next).padStart(3, "0")}`);
  }
  return planned;
}
