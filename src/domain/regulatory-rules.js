// 공개 규제 현황 규칙 (spec 021). 순수 함수: 화면·저장을 부르지 않는다.
// 이 앱은 승인이나 GMP 적합 여부를 정하지 않는다. 식약처가 공개한 값을 맞추고 날짜를 계산할 뿐이다.
import { formatYmd } from "./public-data-rules.js";

export const SOON_DAYS = 180; // spec Q2: GMP 유효기간이 이 일수 이하면 "곧 끝남"
export const SHOWN_APPROVALS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 공백·(주)·㈜·주식회사·(유)와 시험 자료 표시를 뺀 이름. 맞춤 비교에만 쓴다 (FR-003) */
export function normalizeCompany(name) {
  return String(name ?? "")
    .replace(/\s+/g, "")
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(시험자료\)/g, "")
    .toLowerCase();
}

/** @returns {"same" | "similar" | "different"} 한 글자짜리 이름은 포함 비교를 하지 않는다 */
export function companyMatch(a, b) {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return "different";
  if (x === y) return "same";
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short) ? "similar" : "different";
}

/** GMP 적합판정서 한 줄 (공공데이터포털 15097207 항목 이름) */
export function gmpRow(item) {
  return {
    company: item.BSSH_NM ?? "",
    factory: item.FCTR_ADDR ?? "",
    kind: item.KGMP_BGMP_NAME ?? "", // 완제·원료 구분
    group: item.GMP_INGR_MM_GROUP_NAME ?? "", // 제형군·제조방법
    validUntil: formatYmd(String(item.VLD_PRD_YMD ?? "").replaceAll("-", "")), // 실제 응답은 "2027-02-27" (2026-10-29 확인)
  };
}

export function hasVaccineGroup(group) {
  return String(group ?? "").includes("백신");
}

/**
 * 같은 업체(없으면 비슷한 업체) 중 유효기간이 가장 늦은 한 줄. 날짜가 없는 줄과 다른 업체는 뺀다
 * @param {ReturnType<typeof gmpRow>[]} rows
 * @param {string} company 제품의 업체명
 * @returns {{ row: ReturnType<typeof gmpRow>, match: "same" | "similar" } | null}
 */
export function latestGmp(rows, company) {
  let best = null;
  for (const row of rows) {
    const match = companyMatch(company, row.company);
    if (match === "different" || !row.validUntil) continue;
    // 같은 업체가 비슷한 이름의 다른 업체보다 먼저다. 같은 등급이면 유효기간이 늦은 줄
    const better = !best || (match === "same" && best.match !== "same") || (match === best.match && row.validUntil > best.row.validUntil);
    if (better) best = { row, match };
  }
  return best;
}

export function ymdToUtc(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ""));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/** 두 "YYYY-MM-DD" 사이 일수(to가 늦으면 +). 날짜가 아니면 null */
export function daysBetween(from, to) {
  const a = ymdToUtc(from);
  const b = ymdToUtc(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/** "2027-01-31" → 오늘부터 남은 일수(오늘이면 0). 날짜가 아니면 null */
export function daysLeft(validUntil, today = new Date()) {
  const end = ymdToUtc(validUntil);
  if (end === null) return null;
  return Math.round((end - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
}

/** @returns {"expired" | "soon" | "ok" | "none"} */
export function gmpLevel(days) {
  if (days === null || days === undefined) return "none";
  if (days <= 0) return "expired";
  return days <= SOON_DAYS ? "soon" : "ok";
}

/** 국가출하승인 한 줄 (공공데이터포털 15084883 항목 이름) */
export function approvalRow(item) {
  return {
    receiptNo: item.RCPT_PRCS_NO ?? "",
    product: item.PRDLST_NM ?? "",
    company: item.MNFT_SALPS_NM ?? "", // 제조·수입사
    lotNumber: item.MNFT_NO ?? "",
    resultDate: formatYmd(item.RESULT_TIME),
    validUntil: formatYmd(item.VLD_PRD),
  };
}

function productKey(name) {
  return String(name ?? "").replace(/\s+/g, "").replace(/\(시험자료\)/g, "").toLowerCase();
}

/** 제품명이 서로 포함되면 같은 제품으로 본다 (세 글자 이상) */
export function sameProduct(a, b) {
  const x = productKey(a);
  const y = productKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.includes(short);
}

/**
 * 제품명이 맞고 같은·비슷한 업체인 승인 이력, 결과일시 최근순 3건. 다른 업체와 제품은 잘못 이어 붙이지 않는다
 * @param {object[]} items 국가출하승인 API 응답 items
 * @param {{ productName: string, company: string }} product
 * @param {number} [limit] 화면에 보일 건수. 회수 대조에는 Infinity로 전체를 쓴다 (FR-008)
 */
export function matchApprovals(items, product, limit = SHOWN_APPROVALS) {
  return productApprovals(items, product).filter((row) => row.match !== "different").slice(0, limit);
}

/** FR-010: 제품명은 맞지만 업체가 다른 승인 이력. 화면 목록에서는 빼지만 업체명 대조에서는 이유를 말한다 */
export function otherCompanyApprovals(items, product) {
  return productApprovals(items, product).filter((row) => row.match === "different");
}

function productApprovals(items, { productName, company }) {
  return items
    .filter((item) => sameProduct(productName, item.PRDLST_NM))
    // 제품에 업체명이 없으면 비교할 수 없으니 "다름"으로 빼지 않고 "비슷함"(확인 필요)으로 둔다
    .map((item) => ({ ...approvalRow(item), match: company ? companyMatch(company, item.MNFT_SALPS_NM) : "similar" }))
    .sort((a, b) => b.resultDate.localeCompare(a.resultDate));
}

/**
 * FR-004 "QA 확인 필요": 승인 이력이 있고 GMP가 지났거나 SOON_DAYS 안일 때. 자동 판정이 아니라 보라는 표시다
 * @param {{ approvals: object[], gmp: { row: { validUntil: string } } | null, today?: Date }} input
 */
export function reviewFlag({ approvals, gmp, today = new Date() }) {
  if (!gmp) return { needed: false, level: "none", days: null, label: null, reason: "GMP 적합판정서를 찾지 못해 판단하지 않습니다." };
  const days = daysLeft(gmp.row.validUntil, today);
  const level = gmpLevel(days);
  if (!approvals.length) return { needed: false, level, days, label: null, reason: "승인 이력을 찾지 못해 판단하지 않습니다." };
  if (level === "expired") return { needed: true, level, days, label: "GMP 유효기간 지남", reason: `GMP 유효기간이 ${gmp.row.validUntil}에 끝났습니다.` };
  if (level === "soon") return { needed: true, level, days, label: `GMP 갱신 확인 필요 (${days}일 남음)`, reason: `GMP 유효기간 ${gmp.row.validUntil}까지 ${days}일 남았습니다.` };
  return { needed: false, level, days, label: null, reason: `GMP 유효기간 ${gmp.row.validUntil}까지 ${days}일 남았습니다.` };
}

/**
 * FR-002: 국가출하승인을 어디까지 훑었는지 (최신 끝 쪽만 본다, api/shipment.js). "최근 335건(2026-06-17 이후 판정, 전체 6,035건 중)"
 * @param {{ scanned: number, since?: string | null, totalCount: number }} range
 */
export function scanRangeText({ scanned, since, totalCount }) {
  if (!scanned) return "조회한 승인 이력 0건";
  const from = formatYmd(since) ? `${formatYmd(since)} 이후 판정, ` : "";
  return `최근 ${scanned.toLocaleString("ko-KR")}건(${from}전체 ${totalCount.toLocaleString("ko-KR")}건 중)`;
}
