// 공공데이터 응답 → 화면에 보일 모양 (spec 003 FR-001~003). 응답 항목 이름은 2026-10-22 실제 호출로 확인 (Intent Q8 해결)

/**
 * FR-001 경계: 빈 값·공백만이면 부르지 않는다. 1글자는 그대로 부른다
 * @param {string} text
 * @param {string} emptyMessage
 */
export function checkSearchTerm(text, emptyMessage) {
  const value = String(text ?? "").trim();
  return value ? { ok: true, value } : { ok: false, error: emptyMessage };
}

/** "20261021"(또는 뒤에 시각이 붙은 값) → "2026-10-21". 형식이 아니면 빈 글자 */
export function formatYmd(text) {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(String(text ?? ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

/** 허가정보 한 줄: 품목기준코드·품목명·업체명·주성분·전문/일반·허가일·취소 상태 */
export function permitRow(item) {
  return {
    code: item.ITEM_SEQ ?? "",
    name: item.ITEM_NAME ?? "",
    company: item.ENTP_NAME ?? "",
    ingredient: item.ITEM_INGR_NAME ?? "",
    kind: item.SPCLTY_PBLC ?? "",
    permitDate: formatYmd(item.ITEM_PERMIT_DATE),
    status: item.CANCEL_NAME ?? "",
    type: item.PRDUCT_TYPE ?? "", // 품목 구분 (spec 006 FR-001)
  };
}

const VACCINE_TYPE = "백신류"; // 2026-10-22 실제 응답 "[06310]백신류" (전환 §11)

/** spec 006 FR-001: 품목 구분이 백신류인 허가정보 @param {{ PRDUCT_TYPE?: string }} item */
export function isVaccineItem(item) {
  return String(item?.PRDUCT_TYPE ?? "").includes(VACCINE_TYPE);
}

/**
 * spec 006 FR-002: "출처: 식약처 공공데이터 · 조회 10/26 09:05". spec 019 FR-003: 시험 자료면 "출처: 시험 자료(fixtures) · …"
 * @param {Date} fetchedAt 결과를 받은 시각
 * @param {{ fixture?: boolean }} [options]
 */
export function sourceText(fetchedAt, { fixture = false } = {}) {
  return `출처: ${fixture ? "시험 자료(fixtures)" : "식약처 공공데이터"} · 조회 ${shortStamp(fetchedAt)}`;
}

/** spec 006 FR-003: "마지막 정상 조회 10/25 08:07 (지금 결과가 아닐 수 있습니다)" @param {string} savedAt ISO 시각 */
export function lastGoodText(savedAt) {
  return `마지막 정상 조회 ${shortStamp(new Date(savedAt))} (지금 결과가 아닐 수 있습니다)`;
}

// "10/26 09:05": 월·일은 앞에 0을 붙이지 않고, 시·분은 두 자리
function shortStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * spec 006 FR-003: 마지막 정상 결과를 조회(종류 + 검색 조건)마다 따로 보관하는 열쇠. 조건 순서는 상관없다
 * @param {string} name
 * @param {Record<string, string | number>} params
 */
export function publicCacheKey(name, params) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  query.sort();
  return `pharmaflow.public.${name}?${query}`;
}

/** 회수·판매중지 공지 한 줄 */
export function recallRow(item) {
  return {
    code: item.ITEM_SEQ ?? "",
    product: item.PRDUCT ?? "",
    company: item.ENTRPS ?? "",
    reason: item.RTRVL_RESN ?? "",
    commandDate: formatYmd(item.RECALL_COMMAND_DATE),
    lotNumber: item.MNFCTUR_NO ?? "",
  };
}

function newestFirst(rows) {
  return [...rows].sort((a, b) => b.commandDate.localeCompare(a.commandDate));
}

/**
 * Q25: 품목명으로 찾은 공지 중 같은 품목기준코드만, 최근순. 이름이 비슷한 다른 품목은 빠진다
 * @param {object[]} items 회수 API 응답 items
 * @param {string | null} permitCode 제품의 품목기준코드
 */
export function matchRecalls(items, permitCode) {
  if (!permitCode) return [];
  return newestFirst(items.filter((item) => item.ITEM_SEQ === permitCode).map(recallRow));
}

/** FR-003: 최근 회수 공지 (기본 5건, 최근순) */
export function recentRecalls(items, count = 5) {
  return newestFirst(items.map(recallRow)).slice(0, count);
}
