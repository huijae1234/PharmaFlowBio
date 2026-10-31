// 출하 완료 기록 (spec 017 FR-005·006). 버튼을 보일지와 입력 검사만 — 막는 것은 데이터베이스 함수(ship_batch)
const NOTE_LIMIT = 200;

/** FR-005 수용 기준 3·4 @param {string} status @param {string} role */
export function canShip(status, role) {
  return status === "releasable" && role === "production_operator";
}

/**
 * FR-005 경계 상황. "출하 가능 판정 뒤" 검사는 판정 시각을 아는 데이터베이스만 한다
 * @param {{ shippedAt: string, note: string, now: Date }} input
 * @returns {{ ok: true, value: { shippedAt: string, note: string | null } } | { ok: false, error: string }}
 */
export function checkShipment({ shippedAt, note, now }) {
  const at = shippedAt ? new Date(shippedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return { ok: false, error: "출하 일시를 입력해 주세요." };
  if (at.getTime() > now.getTime()) return { ok: false, error: "출하 일시는 지금보다 뒤일 수 없습니다." };
  const trimmed = String(note ?? "").trim();
  if (trimmed.length > NOTE_LIMIT) return { ok: false, error: "메모는 200자까지 입력해 주세요." };
  return { ok: true, value: { shippedAt: at.toISOString(), note: trimmed || null } };
}

/**
 * FR-005 수용 기준 1: 로트 위쪽 "출하 완료 · 10/28 14:00 · 김희재". 출하 완료가 아니면 빈 글자
 * @param {{ status: string, shipped_at?: string | null, shipper?: { display_name: string } | null }} batch
 * @param {(iso: string) => string} format 화면의 시각 글자 함수
 */
export function shipmentText(batch, format) {
  if (batch.status !== "shipped" || !batch.shipped_at) return "";
  return `출하 완료 · ${format(batch.shipped_at)} · ${batch.shipper?.display_name ?? ""}`;
}
