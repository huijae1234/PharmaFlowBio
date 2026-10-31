// 목록 검색 (spec 007 FR-008): 로트 목록·제품 목록에서 입력한 글자가 들어간 줄만. 화면에 이미 받은 목록을 거른다

/** 앞뒤 공백을 정리한 검색어. 없으면 빈 글자 @param {string | undefined | null} text */
export function normalizeSearch(text) {
  return String(text ?? "").trim();
}

/**
 * 칸 중 하나라도 검색어를 포함하면 맞음 (대소문자 상관없이). 빈 검색어는 모두 맞음
 * @param {(string | null | undefined)[]} fields
 * @param {string | undefined} term
 */
export function matchesSearch(fields, term) {
  const needle = normalizeSearch(term).toLowerCase();
  if (!needle) return true;
  return fields.some((field) => String(field ?? "").toLowerCase().includes(needle));
}
