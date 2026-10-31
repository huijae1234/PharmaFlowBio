// 로트 목록 거르기 (spec 018 FR-001)

/**
 * 주소의 제품 값이 등록된 제품이면 그 값, 아니면 "" (모든 제품). 경계 상황: 없는 제품 값
 * @param {{ id: string }[]} products
 * @param {string | undefined} raw
 */
export function productFilterValue(products, raw) {
  return products.some((product) => product.id === raw) ? raw : "";
}
