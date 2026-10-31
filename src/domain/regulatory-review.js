// 공개 규제 현황의 비교·종합 규칙 (spec 021 FR-008~013). 순수 함수: 화면·저장을 부르지 않는다.
// 이 앱은 승인이나 GMP 적합 여부를 정하지 않는다. 불러온 값과 사내 가상 일정을 맞춰 "확인하라"고 표시할 뿐이다
import { companyMatch, daysBetween, daysLeft, reviewFlag, ymdToUtc } from "./regulatory-rules.js";

export const SCHEDULE_MARGIN_DAYS = 90; // spec Q11: 계획 종료 뒤 이 일수 안에 GMP가 끝나면 주의
export const LOT_SOON_DAYS = 90; // FR-012: 승인 로트 유효기간이 이 일수 이하면 임박
const GAP_FACTOR = 2; // spec Q12: 마지막 승인 이후 경과일이 평균 간격의 이 배수를 넘으면 공백

// 회수 공지의 제조번호 글자를 낱말로 나눈다. shortcut: "A1~A9" 같은 범위 표기는 풀지 않는다, 실제 응답 모양을 본 뒤 필요하면 푼다
function lotTokens(text) {
  return String(text ?? "").toUpperCase().split(/[\s,;/·()]+/).filter(Boolean);
}

/**
 * FR-008: 승인된 로트 중 회수 공지의 제조번호에 있는 것
 * @param {{ lotNumber: string }[]} approvals 승인 이력 전체
 * @param {{ lotNumber: string, commandDate: string, reason: string }[]} recalls 같은 품목의 회수 공지
 */
export function recalledLots(approvals, recalls) {
  const hits = [];
  for (const approval of approvals) {
    const lot = approval.lotNumber.trim().toUpperCase();
    const recall = lot && recalls.find((row) => lotTokens(row.lotNumber).includes(lot));
    if (recall) hits.push({ lotNumber: approval.lotNumber, approval, recall });
  }
  return hits;
}

const LEVEL_ORDER = { danger: 0, warning: 1, info: 2 };

/**
 * FR-009 종합 한 줄: 승인 로트 회수, GMP, 회수 공지를 심각한 것부터 한 목록으로. 자동 판정이 아니라 확인하라는 표시다
 * @param {{ approvals: object[], gmp: object | null, recalls: object[] | null | undefined, companies?: { needsCheck: boolean }, schedule?: ReturnType<typeof scheduleCheck>, trend?: ReturnType<typeof approvalTrend>, today?: Date }} input recalls: null이면 불러오는 중, undefined면 불러오지 못한 것
 * @returns {{ needed: boolean, items: { key: string, level: "danger" | "warning" | "info", label: string, reason: string }[], gmpReason: string }}
 */
export function overallReview({ approvals, gmp, recalls, companies, schedule, trend, today = new Date() }) {
  const items = [];
  // 같은 위험끼리는 넣은 순서가 곧 순서: 승인 로트 회수가 GMP보다 앞
  if (recalls === null) {
    // 아직 불러오는 중: 실패로 읽히는 안내를 보이지 않는다
  } else if (recalls === undefined) {
    items.push({ key: "recall_info", level: "info", label: "회수 공지 대조하지 못함", reason: "회수 공지를 불러오지 못해 승인 로트와 대조하지 못했습니다." });
  } else if (recalls.length) {
    items.push(recallItem(approvals, recalls));
  }
  if (schedule?.needed) items.push(scheduleItem(schedule));
  const gmpFlag = reviewFlag({ approvals, gmp, today });
  if (gmpFlag.needed) {
    items.push({ key: gmpFlag.level === "expired" ? "gmp_expired" : "gmp_soon", level: gmpFlag.level === "expired" ? "danger" : "warning", label: gmpFlag.label, reason: gmpFlag.reason });
  }
  if (trend) items.push(...trendItems(trend));
  if (companies?.needsCheck) {
    items.push({ key: "company_info", level: "info", label: "업체명 확인 필요", reason: "허가정보·승인·GMP의 업체명이 서로 같지 않습니다. 아래 업체명 대조를 확인하세요." });
  }
  items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return { needed: items.some((item) => item.level !== "info"), items, gmpReason: gmpFlag.reason };
}

function recallItem(approvals, recalls) {
  const hits = recalledLots(approvals, recalls);
  if (hits.length) {
    const detail = hits.map((hit) => `${hit.lotNumber} (회수 명령일 ${hit.recall.commandDate || "-"}, ${hit.recall.reason || "사유 없음"})`).join(" · ");
    return { key: "recalled_lot", level: "danger", label: `승인된 로트 ${hits.length}건이 회수됨`, reason: `국가출하승인 이력과 회수 공지에 모두 있는 제조번호: ${detail}` };
  }
  const reason = approvals.length
    ? "조회한 승인 이력의 제조번호와 겹치지 않습니다. 승인 이력은 일부만 조회하므로 이상이 없다는 뜻이 아닙니다."
    : "승인 이력을 찾지 못해 제조번호를 대조하지 못했습니다. 이상이 없다는 뜻이 아닙니다.";
  return { key: "recall_info", level: "info", label: `회수 공지 ${recalls.length}건`, reason };
}

const OTHER_NAMES_SHOWN = 2;

/**
 * FR-010 세 곳 업체명 대조: 허가정보(제품 업체) ↔ 국가출하승인 ↔ GMP. 같은 회사인지 사람이 확인하라는 표시다
 * @param {{ approvals: { company: string, match: string }[], otherApprovals: { company: string }[], gmp: { row: { company: string }, match: string } | null }} input
 * @returns {{ needsCheck: boolean, rows: { pair: string, status: "same" | "similar" | "different" | "none", text: string }[] }}
 */
export function companyCheck({ approvals, otherApprovals, gmp }) {
  const rows = [permitVsApproval(approvals, otherApprovals), permitVsGmp(gmp), approvalVsGmp(approvals, gmp)];
  return { needsCheck: rows.some((row) => row.status === "similar" || row.status === "different"), rows };
}

function permitVsApproval(approvals, others) {
  const pair = "허가정보 ↔ 국가출하승인";
  const excluded = others.length ? ` 같은 제품명인데 다른 업체 ${others.length}건(${[...new Set(others.map((row) => row.company))].slice(0, OTHER_NAMES_SHOWN).join(", ")})은 뺐습니다.` : "";
  if (!approvals.length) {
    return others.length ? { pair, status: "different", text: `업체가 같은 승인 이력이 없습니다.${excluded}` } : { pair, status: "none", text: "승인 이력을 찾지 못했습니다." };
  }
  const status = approvals.some((row) => row.match === "similar") ? "similar" : "same";
  return { pair, status, text: (status === "same" ? "업체명이 같습니다." : "비슷한 이름의 업체가 있습니다.") + excluded };
}

function permitVsGmp(gmp) {
  const pair = "허가정보 ↔ GMP";
  if (!gmp) return { pair, status: "none", text: "GMP 적합판정서를 찾지 못했습니다." };
  return { pair, status: gmp.match, text: gmp.match === "same" ? "업체명이 같습니다." : "비슷한 이름입니다." };
}

function approvalVsGmp(approvals, gmp) {
  const pair = "국가출하승인 ↔ GMP";
  if (!approvals.length || !gmp) return { pair, status: "none", text: "둘 중 하나를 찾지 못해 대조하지 못했습니다." };
  const status = companyMatch(approvals[0].company, gmp.row.company); // 가장 최근 승인의 업체
  return { pair, status, text: status === "same" ? "업체명이 같습니다." : status === "similar" ? "비슷한 이름입니다." : "업체명이 다릅니다." };
}

function scheduleItem({ rows, level }) {
  const bad = rows.filter((row) => row.level !== "ok");
  const detail = bad.slice(0, 3).map((row) => `${row.orderNumber}: ${row.text}`).join(" · ");
  return { key: `schedule_${level}`, level, label: `계획된 생산 ${bad.length}건이 GMP 유효기간과 맞지 않음`, reason: `${detail}${bad.length > 3 ? ` 외 ${bad.length - 3}건` : ""} (작업지시는 교육용 가상 자료, GMP는 실제 공개 정보)` };
}

function trendItems(trend) {
  const items = [];
  if (trend.gap) {
    items.push({ key: "trend_info", level: "info", label: "승인 공백 가능성", reason: `마지막 승인(${trend.latestDate})이 ${trend.daysSinceLatest}일 전이고 평균 승인 간격은 약 ${trend.avgIntervalDays}일입니다. 조회한 범위 안에서 본 값입니다.` });
  }
  if (trend.soonCount + trend.expiredCount > 0) {
    items.push({ key: "trend_info", level: "info", label: `승인 로트 유효기간 지남 ${trend.expiredCount}건 · ${LOT_SOON_DAYS}일 이내 ${trend.soonCount}건`, reason: "조회한 승인 이력 중 유효기간이 지났거나 임박한 로트 수입니다." });
  }
  return items;
}

/**
 * FR-011 계획된 생산 ↔ GMP: 진행 전·진행 중 작업지시의 계획 기간과 GMP 유효기간. 작업지시는 가상 자료, 자동 판정이 아니다
 * @param {{ workOrders: { orderNumber: string, plannedStart: string, plannedEnd: string, status: string }[], gmp: { row: { validUntil: string } } | null }} input
 * @returns {{ needed: boolean, level: "danger" | "warning" | "ok" | "none", rows: { orderNumber: string, plannedStart: string, plannedEnd: string, level: "danger" | "warning" | "ok", text: string }[], reason: string }}
 */
export function scheduleCheck({ workOrders, gmp }) {
  if (!gmp) return { needed: false, level: "none", rows: [], reason: "GMP 적합판정서를 찾지 못해 작업지시 일정과 대조하지 못했습니다." };
  const rows = workOrders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).map((order) => scheduleRow(order, gmp.row.validUntil));
  if (!rows.length) return { needed: false, level: "none", rows, reason: "대조할 진행 전·진행 중 작업지시가 없습니다. 이상이 없다는 뜻은 아닙니다." };
  const level = rows.some((row) => row.level === "danger") ? "danger" : rows.some((row) => row.level === "warning") ? "warning" : "ok";
  return { needed: level !== "ok", level, rows, reason: "" };
}

const OPEN_ORDER_STATUSES = ["draft", "released", "in_progress"];

function scheduleRow({ orderNumber, plannedStart, plannedEnd }, validUntil) {
  const base = { orderNumber, plannedStart, plannedEnd };
  const afterStart = daysBetween(plannedStart, validUntil);
  const afterEnd = daysBetween(plannedEnd, validUntil);
  if (afterStart === null || afterEnd === null) return { ...base, level: "ok", text: "날짜를 읽지 못해 대조하지 못했습니다." };
  if (afterStart < 0) return { ...base, level: "danger", text: `계획 시작일(${plannedStart})에 이미 GMP 유효기간(${validUntil})이 지난 상태입니다.` };
  if (afterEnd < 0) return { ...base, level: "danger", text: `생산 기간 중 GMP 유효기간(${validUntil})이 끝납니다 (계획 종료일 ${plannedEnd}).` };
  if (afterEnd <= SCHEDULE_MARGIN_DAYS) return { ...base, level: "warning", text: `계획 종료일(${plannedEnd}) ${afterEnd}일 뒤에 GMP 유효기간(${validUntil})이 끝납니다.` };
  return { ...base, level: "ok", text: "GMP 유효기간 안에 끝납니다." };
}

/**
 * FR-012 승인 추이: 마지막 승인 경과일, 평균 간격, 유효기간 지남·임박 로트 수. 조회한 범위 안의 값이다
 * @param {{ resultDate: string, validUntil: string }[]} approvals
 */
export function approvalTrend(approvals, today = new Date()) {
  const dates = approvals.map((row) => row.resultDate).filter((date) => ymdToUtc(date) !== null).sort().reverse();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const latestDate = dates[0] ?? null;
  const daysSinceLatest = latestDate ? daysBetween(latestDate, todayYmd) : null;
  const avgIntervalDays = dates.length >= 2 ? Math.round(daysBetween(dates[dates.length - 1], dates[0]) / (dates.length - 1)) : null;
  const lefts = approvals.map((row) => daysLeft(row.validUntil, today)).filter((days) => days !== null);
  return {
    count: approvals.length, latestDate, daysSinceLatest, avgIntervalDays,
    expiredCount: lefts.filter((days) => days <= 0).length,
    soonCount: lefts.filter((days) => days > 0 && days <= LOT_SOON_DAYS).length,
    gap: avgIntervalDays !== null && avgIntervalDays > 0 && daysSinceLatest > avgIntervalDays * GAP_FACTOR,
  };
}

/**
 * FR-013 GMP 전체: 같은·비슷한 업체의 줄을 유효기간 늦은 순으로, 남은 일수와 함께
 * @param {ReturnType<typeof gmpRow>[]} rows
 */
export function gmpRowsFor(rows, company, today = new Date()) {
  return rows
    .map((row) => ({ ...row, match: companyMatch(company, row.company), days: daysLeft(row.validUntil, today) }))
    .filter((row) => row.match !== "different")
    .sort((a, b) => b.validUntil.localeCompare(a.validUntil));
}
