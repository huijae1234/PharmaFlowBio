// 로트번호 앞 영문 이니셜(QA-PS-003 → QA, IFV-2610-005 → IFV, WO-2611-002 → WO): 같은 제품 로트 비교 전환과 제품 화면 정리용.
// 번호 규칙이 없는 로트는 "기타". 이니셜은 제품과 1:1이 아니라서 로트 목록의 제품 거르기는 productOptions(product_id 기준)를 쓴다. 저장하지 않고 화면에서 계산한다

/**
 * 로트 목록의 제품 거르기: 실제 제품(product_id) 기준, 많은 것부터
 * @param {{ product_id: string, product?: { item_name: string } | null }[]} batches
 * @returns {{ id: string, name: string, count: number }[]}
 */
export function productOptions(batches) {
  const byId = new Map();
  for (const batch of batches) {
    if (!batch.product_id) continue;
    const entry = byId.get(batch.product_id) ?? { id: batch.product_id, name: batch.product?.item_name ?? "(이름 없음)", count: 0 };
    entry.count += 1;
    byId.set(batch.product_id, entry);
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

/** @param {string | null | undefined} batchNumber */
export function lotGroup(batchNumber) {
  const match = /^[A-Za-z]+/.exec(String(batchNumber ?? "").trim());
  return match ? match[0].toUpperCase() : "기타";
}

/**
 * 제품군과 로트 수: 많은 것부터, 같으면 이름순
 * @param {{ batch_number: string }[]} batches
 * @returns {{ group: string, count: number }[]}
 */
export function lotGroups(batches) {
  const counts = new Map();
  for (const batch of batches) counts.set(lotGroup(batch.batch_number), (counts.get(lotGroup(batch.batch_number)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
}
