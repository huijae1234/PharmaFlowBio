// 입력 형식 검사만 한다. 기준 이탈 판정은 데이터베이스 함수가 한다 (plan 001 §5 위험과 대응).

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * FR-009, FR-011 (spec 001): 측정값 입력 글자를 숫자로 바꾼다.
 * @param {string | null | undefined} text
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parseNumberInput(text) {
  const trimmed = String(text ?? "").trim();
  if (!NUMBER_PATTERN.test(trimmed)) return { ok: false, error: "숫자로 입력해 주세요." };
  return { ok: true, value: Number(trimmed) };
}

/**
 * FR-007 (spec 001): 기준값 범위는 최솟값 ≤ 최댓값이어야 한다.
 * @param {number} min
 * @param {number} max
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkSpecRange(min, max) {
  if (min > max) return { ok: false, error: "최솟값이 최댓값보다 클 수 없습니다." };
  return { ok: true };
}

/**
 * FR-012 (spec 001): 직접 보류에는 사유가 필요하다.
 * @param {string | null | undefined} text
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function checkHoldReason(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, error: "보류 사유를 입력해 주세요." };
  return { ok: true, value: trimmed };
}
