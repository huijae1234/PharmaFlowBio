// 홈 보류 로트 정렬·거르기 (UI 개편): 기본은 오래된 것이 위. "오래됨"은 가장 오래된 열린 이슈가 열린 때, 이슈가 없으면 로트 등록 때.
// 저장하지 않고 이미 읽은 로트·이슈로 계산한다

/**
 * @param {{ id: string, created_at: string }} batch
 * @param {{ batch_id: string, status: string, opened_at: string }[]} issues
 * @returns {string} 시각 (ISO)
 */
export function holdSince(batch, issues) {
  const opened = issues.filter((issue) => issue.batch_id === batch.id && issue.status === "open").map((issue) => issue.opened_at).sort();
  return opened[0] ?? batch.created_at;
}

/**
 * @template {{ id: string, created_at: string }} T
 * @param {T[]} batches
 * @param {Parameters<typeof holdSince>[1]} issues
 * @param {"oldest" | "newest"} [order]
 * @returns {T[]}
 */
export function sortHolds(batches, issues, order = "oldest") {
  const direction = order === "newest" ? -1 : 1;
  return [...batches].sort((a, b) => direction * holdSince(a, issues).localeCompare(holdSince(b, issues)));
}

/** 제품 이름 목록 (가나다순, 중복 없음) @param {{ product?: { item_name: string } | null }[]} batches */
export function holdProducts(batches) {
  return [...new Set(batches.map((batch) => batch.product?.item_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

/** 제품 이름으로 거르기. 빈 값이면 모두 @param {string} name */
export function filterByProduct(batches, name) {
  return name ? batches.filter((batch) => batch.product?.item_name === name) : batches;
}
