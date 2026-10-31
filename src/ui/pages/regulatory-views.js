// "공개 규제 현황" 탭의 화면 조각 (spec 021). state를 받아 그리기만 한다: 부르기와 저장은 product-regulatory.js
// 이 앱은 승인이나 GMP 적합 여부를 정하지 않는다. 식약처 공개 값과 사내 가상 일정을 맞춰 "확인하라"고 표시할 뿐이다
import { h, badge } from "../dom.js";
import { daysLeft, hasVaccineGroup, scanRangeText } from "../../domain/regulatory-rules.js";
import { approvalTrend, companyCheck, LOT_SOON_DAYS, overallReview, scheduleCheck } from "../../domain/regulatory-review.js";

const SIMILAR_NOTE = "비슷한 이름: 같은 회사인지 확인 필요";
const ICONS = { danger: "⚠", warning: "⚠", info: "ℹ" };
const COMPANY_LABELS = { same: "✓ 같음", similar: "≈ 비슷함", different: "✗ 다름", none: "– 확인 불가" };
const SCHEDULE_LABELS = { danger: "⚠ 위험", warning: "⚠ 주의", ok: "✓ 유효기간 안" };

const muted = (text) => h("p", { class: "muted" }, text);
const table = (titles, rows) => h("div", { class: "table-wrap" }, h("table", { class: "table" },
  h("thead", null, h("tr", null, ...titles.map((title) => h("th", { scope: "col" }, title)))),
  h("tbody", null, ...rows)));

const companyOf = (state) => companyCheck({ approvals: state.allApprovals, otherApprovals: state.otherApprovals, gmp: state.gmp ?? null });
// 작업지시와 GMP가 모두 준비돼야 대조한다 (GMP를 못 찾아 null이어도 대조 결과는 "못 함"으로 나온다)
const scheduleOf = (state) => (Array.isArray(state.workOrders) && state.gmp !== undefined
  ? scheduleCheck({ workOrders: state.workOrders, gmp: state.gmp }) : undefined);

function leftText(days) {
  if (days === null) return "-";
  return days <= 0 ? `유효기간 지남 (${-days}일 전)` : `${days}일 남음`;
}

// FR-010: 허가정보·승인·GMP의 업체명이 서로 같은지. 같은 회사인지는 사람이 확인한다
export function companyView(state) {
  if (state.approvals === undefined) return muted("승인 이력을 불러와야 대조할 수 있습니다.");
  if (state.notVaccine) return muted("백신류가 아니어서 승인 이력과의 업체명 대조는 하지 않습니다.");
  return table(["대조", "결과", "설명"], companyOf(state).rows.map((row) => h("tr", null,
    h("td", null, row.pair), h("td", null, badge(`company_${row.status}`, COMPANY_LABELS[row.status])), h("td", null, row.text))));
}

// FR-011: 진행 전·진행 중 작업지시(가상 자료)의 계획 기간과 실제 GMP 유효기간
export function scheduleView(state) {
  if (state.workOrders === undefined) return muted("작업지시를 불러오는 중…");
  if (state.workOrders === null) return muted("작업지시를 불러오지 못했습니다. 승인·GMP 칸은 그대로 볼 수 있습니다.");
  if (state.gmp === undefined) return muted("GMP를 불러온 뒤 대조합니다.");
  const check = scheduleCheck({ workOrders: state.workOrders, gmp: state.gmp });
  if (!check.rows.length) return muted(check.reason);
  return table(["작업지시", "계획 기간", "결과", "설명"], check.rows.map((row) => h("tr", null,
    h("td", { class: "mono" }, row.orderNumber), h("td", { class: "mono" }, `${row.plannedStart} ~ ${row.plannedEnd}`),
    h("td", null, badge(`schedule_${row.level}`, SCHEDULE_LABELS[row.level])), h("td", null, row.text))));
}

/** 종합 확인 목록. 아직 못 그리면(승인 이력 전) null. GMP·회수 공지·작업지시가 늦거나 실패해도 이미 불러온 쪽의 결과(예: 승인 로트 회수됨)는 가리지 않는다 */
export function reviewOf(state) {
  if (state.approvals === undefined || state.notVaccine) return null;
  return overallReview({
    approvals: state.allApprovals, gmp: state.gmp ?? null, recalls: state.recallDone ? state.recalls : null,
    companies: companyOf(state), schedule: scheduleOf(state), trend: state.allApprovals.length ? approvalTrend(state.allApprovals) : undefined,
  });
}

export function flagView(state) {
  if (state.approvals === undefined) return muted("승인 이력을 불러와야 확인할 수 있습니다.");
  if (state.notVaccine) return muted("백신류가 아니어서 승인 이력 기준의 확인은 하지 않습니다.");
  const review = reviewOf(state);
  const gmpPending = state.gmp === undefined ? muted("GMP를 아직 불러오지 못해 GMP 기준 확인은 보류했습니다.") : null;
  // 백신류 제품일 때만: 제형군에 "백신"이 없으면 그 GMP가 백신을 포함하는지 사람이 확인해야 한다 (spec Q8)
  const groupNote = state.gmp && !hasVaccineGroup(state.gmp.row.group)
    ? h("p", { class: "error-text" }, "GMP 제형군에 '백신'이 없어 백신 제형이 포함되는지 확인이 필요합니다.") : null;
  const findings = review.items.map((item) => h("div", { class: "regulatory-finding" },
    badge(item.key, `${ICONS[item.level]} ${item.level === "info" ? "" : "QA 확인 필요 · "}${item.label}`), muted(item.reason)));
  if (!review.needed) return h("div", null, gmpPending ?? muted(review.gmpReason), ...findings, groupNote);
  return h("div", null, ...findings, muted("자동 판정이 아니라 확인하라는 표시입니다. QA 관리자와 확인하세요."), gmpPending, groupNote);
}

/** @param {{ row: object, match: string } | null} found 유효기간이 가장 늦은 한 줄 @param {object[]} all 같은·비슷한 업체의 전체 줄 (FR-013) */
export function gmpDetails(found, all) {
  if (!found) return muted("이 업체명으로 찾은 GMP 적합판정서가 없습니다. 업체명이 다르게 등록됐을 수 있습니다.");
  const { row, match } = found;
  return h("div", null,
    h("dl", { class: "info-list" }, ...[["업체명", row.company], ["공장 소재지", row.factory], ["완제·원료", row.kind],
      ["제형군·제조방법", row.group], ["유효기간", row.validUntil], ["남은 기간", leftText(daysLeft(row.validUntil))]]
      .flatMap(([label, value]) => [h("dt", null, label), h("dd", null, value || "-")])),
    match === "similar" ? h("p", { class: "error-text" }, SIMILAR_NOTE) : null,
    all.length > 1 ? gmpAll(all) : null);
}

function gmpAll(all) {
  return h("div", null, h("h4", { class: "subsection-title" }, `이 업체의 GMP 적합판정서 전체 ${all.length}건`),
    table(["업체명", "공장 소재지", "완제·원료", "제형군·제조방법", "유효기간", "남은 기간"], all.map((row) => h("tr", null,
      h("td", null, row.company, row.match === "similar" ? h("div", { class: "error-text" }, SIMILAR_NOTE) : null),
      h("td", null, row.factory || "-"), h("td", null, row.kind || "-"), h("td", null, row.group || "-"),
      h("td", { class: "mono" }, row.validUntil || "-"), h("td", null, leftText(row.days))))));
}

// FR-012: 찾은 승인 이력으로 센 값. 조회한 범위 안의 값이라는 말을 붙인다
function trendLine(approvals) {
  const trend = approvalTrend(approvals);
  const latest = trend.latestDate ? `${trend.latestDate}(${trend.daysSinceLatest}일 전)` : "-";
  const interval = trend.avgIntervalDays === null ? "-" : `약 ${trend.avgIntervalDays}일`;
  return muted(`승인 ${trend.count}건 · 마지막 승인 ${latest} · 평균 간격 ${interval} · 유효기간 지남 ${trend.expiredCount}건 · ${LOT_SOON_DAYS}일 이내 ${trend.soonCount}건 (조회한 범위 안의 값)`);
}

/** @param {object[]} shown 화면에 보일 승인 줄 @param {object[]} all 찾은 승인 전체 (추이 계산용) */
export function approvalList(shown, all, { scanned = 0, totalCount = 0, since = null }) {
  // 이 API는 제품명으로 못 거른다. 최신 끝 쪽만 훑으므로 언제부터 본 것인지 밝힌다 (spec Q3, 2026-10-29 순서 고침)
  const range = scanRangeText({ scanned, since, totalCount });
  if (!shown.length) return muted(`${range} 안에는 이 제품의 승인 이력이 없습니다. 그보다 오래된 이력은 보지 않았습니다.`);
  return h("div", null,
    table(["결과일", "제조번호", "유효기간", "제조·수입사"], shown.map((row) => h("tr", null,
      h("td", { class: "mono" }, row.resultDate), h("td", { class: "mono" }, row.lotNumber), h("td", { class: "mono" }, row.validUntil),
      h("td", null, row.company, row.match === "similar" ? h("div", { class: "error-text" }, SIMILAR_NOTE) : null)))),
    trendLine(all),
    muted(`${range} 안에서 찾았습니다. 그보다 오래된 이력은 보지 않았습니다.`));
}
