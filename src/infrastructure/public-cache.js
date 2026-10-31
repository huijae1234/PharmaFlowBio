// spec 006 FR-003, 전환 D10: 공공데이터의 마지막 정상 결과를 이 기기의 브라우저에만 둔다 (데이터베이스에는 저장하지 않음).
// 저장소가 막힌 브라우저(사생활 모드 등)에서는 조용히 없음으로 동작한다. 인증키·로그인 토큰은 넣지 않는다 (items만)

/**
 * @param {string} key publicCacheKey로 만든 열쇠
 * @returns {{ savedAt: string, items: object[], totalCount: number } | null}
 */
export function readLastGood(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    return saved && Array.isArray(saved.items) && saved.savedAt ? saved : null;
  } catch {
    return null;
  }
}

/** @param {string} key @param {{ items: object[], totalCount?: number }} result @param {Date} savedAt */
export function saveLastGood(key, result, savedAt) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: savedAt.toISOString(), items: result.items, totalCount: result.totalCount ?? 0 }));
  } catch {
    // 저장이 막혀도 화면은 그대로 쓴다 (spec 006 FR-003 수용 기준 5)
  }
}
