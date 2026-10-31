// IA URL 전략: 해시 주소. 상세는 #/batches/:id, #/products/:id, #/issues/:id, 탭·거르기는 ?tab= ?status= (FR-008 수용 기준 4)

const DETAIL_PATTERN = /^#\/(batches|products|issues)\/([^/]+)$/;

/**
 * @param {string} hash 예: "#/batches/abc?tab=tests"
 * @returns {{ path: string, id: string | null, query: Record<string, string> }}
 */
export function parseRoute(hash) {
  const [rawPath, rawQuery = ""] = hash.split("?");
  const query = Object.fromEntries(new URLSearchParams(rawQuery));
  const detail = rawPath.match(DETAIL_PATTERN);
  if (detail) return { path: `#/${detail[1]}/:id`, id: decodeURIComponent(detail[2]), query };
  return { path: rawPath, id: null, query };
}
