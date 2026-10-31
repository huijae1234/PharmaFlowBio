// spec 021: 공개 규제 현황 규칙 (업체명 맞춤, GMP 남은 일수, 승인 이력 거르기, QA 확인 필요)
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCompany, companyMatch, gmpRow, latestGmp, daysLeft, gmpLevel, SOON_DAYS, approvalRow, matchApprovals, reviewFlag, otherCompanyApprovals } from "../src/domain/regulatory-rules.js";
import { recalledLots, overallReview, companyCheck, scheduleCheck, approvalTrend, gmpRowsFor } from "../src/domain/regulatory-review.js";

const TODAY = new Date(2026, 9, 28); // 2026-10-28 (로컬 날짜)

test("업체명 정리: 공백·(주)·주식회사를 뺀다 (FR-003 수용 기준 1)", () => {
  assert.equal(normalizeCompany("가상백신(주) (시험 자료)"), "가상백신"); // 시험 자료 표시도 뺀다
  assert.equal(normalizeCompany("주식회사 가상백신"), "가상백신");
  assert.equal(normalizeCompany("㈜가상백신"), "가상백신");
  assert.equal(normalizeCompany(null), "");
});

test("업체명 맞춤: 같음 / 비슷함 / 다름 (FR-003)", () => {
  assert.equal(companyMatch("가상백신(주)", "주식회사 가상백신"), "same");
  assert.equal(companyMatch("가상백신", "가상백신바이오"), "similar");
  assert.equal(companyMatch("가상백신", "다른제약"), "different");
  assert.equal(companyMatch("", "가상백신"), "different");
  assert.equal(companyMatch("가", "가상백신"), "different"); // 한 글자는 포함으로 치지 않는다
});

test("GMP 한 줄: 항목 이름을 화면 모양으로, 날짜는 YYYY-MM-DD (FR-001)", () => {
  assert.deepEqual(gmpRow({ BSSH_NM: "가상백신(주)", FCTR_ADDR: "충북", KGMP_BGMP_NAME: "완제", GMP_INGR_MM_GROUP_NAME: "백신 주사제", VLD_PRD_YMD: "20270131" }),
    { company: "가상백신(주)", factory: "충북", kind: "완제", group: "백신 주사제", validUntil: "2027-01-31" });
  assert.equal(gmpRow({}).validUntil, "");
});

test("가장 늦은 유효기간의 GMP를 고른다. 다른 회사 줄과 날짜 없는 줄은 뺀다 (FR-001 수용 기준 1, 경계)", () => {
  const rows = [
    gmpRow({ BSSH_NM: "가상백신(주)", VLD_PRD_YMD: "20260601" }),
    gmpRow({ BSSH_NM: "가상백신(주)", VLD_PRD_YMD: "20280601" }),
    gmpRow({ BSSH_NM: "다른제약", VLD_PRD_YMD: "20300101" }),
    gmpRow({ BSSH_NM: "가상백신(주)", VLD_PRD_YMD: "깨짐" }),
  ];
  const found = latestGmp(rows, "가상백신(주)");
  assert.equal(found.row.validUntil, "2028-06-01");
  assert.equal(found.match, "same");
  assert.equal(latestGmp(rows, "없는회사"), null);
  assert.equal(latestGmp([], "가상백신(주)"), null);
});

test("같은 업체 줄이 있으면 비슷한 이름 업체의 더 늦은 GMP보다 먼저 쓴다 (경계)", () => {
  const rows = [
    gmpRow({ BSSH_NM: "가상백신", VLD_PRD_YMD: "20270131" }),
    gmpRow({ BSSH_NM: "가상백신바이오", VLD_PRD_YMD: "20301231" }),
  ];
  const found = latestGmp(rows, "가상백신(주)");
  assert.equal(found.match, "same");
  assert.equal(found.row.validUntil, "2027-01-31");
  assert.equal(latestGmp([rows[1]], "가상백신(주)").match, "similar"); // 같은 업체가 없으면 비슷한 업체를 쓴다
});

test("남은 일수와 단계: 0 이하는 지남, 180 이하는 임박, 그 위는 여유 (FR-004 수용 기준 1, 경계값)", () => {
  assert.equal(daysLeft("2026-10-28", TODAY), 0);
  assert.equal(daysLeft("2026-10-27", TODAY), -1);
  assert.equal(daysLeft("2027-04-26", TODAY), 180);
  assert.equal(daysLeft("깨짐", TODAY), null);
  assert.equal(daysLeft("", TODAY), null);
  assert.equal(SOON_DAYS, 180);
  assert.equal(gmpLevel(0), "expired");
  assert.equal(gmpLevel(-5), "expired");
  assert.equal(gmpLevel(1), "soon");
  assert.equal(gmpLevel(180), "soon");
  assert.equal(gmpLevel(181), "ok");
  assert.equal(gmpLevel(null), "none");
});

test("승인 이력: 제품명이 맞고 같은·비슷한 업체만, 최근순 3건 (FR-002, FR-003)", () => {
  const items = [
    { RCPT_PRCS_NO: "1", PRDLST_NM: "시험독감백신주", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: "A1", RESULT_TIME: "20260101120000", VLD_PRD: "20270101" },
    { RCPT_PRCS_NO: "2", PRDLST_NM: "시험독감백신주", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: "A2", RESULT_TIME: "20260301", VLD_PRD: "20270301" },
    { RCPT_PRCS_NO: "3", PRDLST_NM: "시험독감백신주", MNFT_SALPS_NM: "가상백신바이오", MNFT_NO: "A3", RESULT_TIME: "20260201", VLD_PRD: "20270201" },
    { RCPT_PRCS_NO: "4", PRDLST_NM: "시험독감백신주", MNFT_SALPS_NM: "다른제약", MNFT_NO: "A4", RESULT_TIME: "20260401", VLD_PRD: "20270401" },
    { RCPT_PRCS_NO: "5", PRDLST_NM: "다른제품", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: "A5", RESULT_TIME: "20260501", VLD_PRD: "20270501" },
    { RCPT_PRCS_NO: "6", PRDLST_NM: "시험독감백신주", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: "A6", RESULT_TIME: "20250101", VLD_PRD: "20260101" },
  ];
  const rows = matchApprovals(items, { productName: "시험독감 백신주", company: "가상백신(주)" });
  assert.deepEqual(rows.map((row) => row.lotNumber), ["A2", "A3", "A1"]); // 최근순, 3건까지, 다른 업체·다른 제품 빠짐
  assert.equal(rows[0].match, "same");
  assert.equal(rows[1].match, "similar");
  assert.equal(rows[0].resultDate, "2026-03-01");
  assert.equal(rows[0].validUntil, "2027-03-01");
  assert.deepEqual(matchApprovals([], { productName: "x", company: "y" }), []);
});

test("승인 한 줄: 날짜가 아니면 빈 글자 (경계)", () => {
  assert.equal(approvalRow({ RESULT_TIME: "미정", VLD_PRD: "" }).resultDate, "");
});

test("QA 확인 필요: 승인 이력이 있고 GMP가 지났거나 180일 안일 때만 (FR-004)", () => {
  const approvals = [{ lotNumber: "A1" }];
  const gmp = (ymd) => ({ row: gmpRow({ BSSH_NM: "가상백신", VLD_PRD_YMD: ymd }), match: "same" });
  const soon = reviewFlag({ approvals, gmp: gmp("20270131"), today: TODAY });
  assert.equal(soon.needed, true);
  assert.equal(soon.level, "soon");
  assert.equal(soon.label, "GMP 갱신 확인 필요 (95일 남음)");
  const expired = reviewFlag({ approvals, gmp: gmp("20260630"), today: TODAY });
  assert.equal(expired.needed, true);
  assert.equal(expired.label, "GMP 유효기간 지남");
  const ok = reviewFlag({ approvals, gmp: gmp("20301231"), today: TODAY });
  assert.equal(ok.needed, false);
  assert.equal(ok.label, null);
});

test("QA 확인 필요: 승인 이력이나 GMP를 못 찾으면 만들지 않고 이유를 준다 (FR-004 수용 기준 2)", () => {
  const gmp = { row: gmpRow({ BSSH_NM: "가상백신", VLD_PRD_YMD: "20260630" }), match: "same" };
  const noApproval = reviewFlag({ approvals: [], gmp, today: TODAY });
  assert.equal(noApproval.needed, false);
  assert.match(noApproval.reason, /승인 이력/);
  const noGmp = reviewFlag({ approvals: [{ lotNumber: "A1" }], gmp: null, today: TODAY });
  assert.equal(noGmp.needed, false);
  assert.match(noGmp.reason, /GMP/);
});

// ---- FR-008·009 승인 로트 ↔ 회수 공지 대조, 종합 한 줄 ----
const appr = (lotNumber, resultDate = "2026-10-01") => ({ lotNumber, resultDate });
const recall = (lotNumber, commandDate = "2026-10-20", reason = "역가 부적합") => ({ lotNumber, commandDate, reason });
const gmpOk = { row: { validUntil: "2030-12-31" }, match: "same" };
const gmpSoon = { row: { validUntil: "2027-01-31" }, match: "same" };

test("회수 대조: 제조번호가 같은 로트만 겹친다, 대소문자·공백·쉼표를 가리지 않는다 (FR-008 수용 기준 1·4)", () => {
  const hits = recalledLots([appr("T2610A"), appr("T2609C"), appr("")], [recall(" t2610a, T9999Z ")]);
  assert.deepEqual(hits.map((hit) => hit.lotNumber), ["T2610A"]);
  assert.equal(hits[0].recall.reason, "역가 부적합");
});

test("회수 대조: 낱말이 아니라 일부만 같으면 겹치지 않는다, 범위 표기는 풀지 않는다 (FR-008 수용 기준 4)", () => {
  assert.equal(recalledLots([appr("T26")], [recall("T2610A")]).length, 0);
  assert.equal(recalledLots([appr("A5")], [recall("A1~A9")]).length, 0);
  assert.equal(recalledLots([appr("A1")], [recall("T2610A(1,000병)")]).length, 0);
  assert.equal(recalledLots([appr("T2610A")], [recall("T2610A(1,000병)")]).length, 1); // 괄호 앞 낱말은 같다
});

test("종합: 승인 로트가 회수되면 위험이 맨 앞, GMP 임박이 그 뒤 (FR-009 수용 기준 1·2)", () => {
  const review = overallReview({ approvals: [appr("T2610A")], gmp: gmpSoon, recalls: [recall("T2610A")], today: TODAY });
  assert.equal(review.needed, true);
  assert.deepEqual(review.items.map((item) => item.key), ["recalled_lot", "gmp_soon"]);
  assert.match(review.items[0].reason, /T2610A/);
  assert.match(review.items[0].reason, /2026-10-20/);
});

test("종합: GMP 만료는 위험 항목으로 승인 로트 회수 다음에 온다 (FR-009 수용 기준 1)", () => {
  const review = overallReview({ approvals: [appr("T1")], gmp: { row: { validUntil: "2026-06-30" }, match: "same" }, recalls: [recall("T1")], today: TODAY });
  assert.deepEqual(review.items.map((item) => item.key), ["recalled_lot", "gmp_expired"]);
  assert.deepEqual(review.items.map((item) => item.level), ["danger", "danger"]);
});

test("종합: 회수 공지만 있고 겹치지 않으면 안내만, QA 확인 필요는 아니다 (FR-008 수용 기준 2, FR-009 수용 기준 4)", () => {
  const review = overallReview({ approvals: [appr("T2609C")], gmp: gmpOk, recalls: [recall("T2610A")], today: TODAY });
  assert.equal(review.needed, false);
  assert.deepEqual(review.items.map((item) => [item.key, item.level]), [["recall_info", "info"]]);
  assert.match(review.items[0].reason, /이상이 없다는 뜻이 아닙니다/);
  assert.match(review.gmpReason, /2030-12-31/);
});

test("종합: 승인 이력이 없으면 제조번호를 대조하지 못했다고 말한다 (FR-008)", () => {
  const review = overallReview({ approvals: [], gmp: gmpOk, recalls: [recall("T2610A")], today: TODAY });
  assert.equal(review.needed, false);
  assert.match(review.items[0].reason, /승인 이력을 찾지 못해/);
});

test("종합: 회수 공지를 못 불러오면 대조하지 못했다고 안내하고 GMP 판정은 그대로 (FR-008 수용 기준 3)", () => {
  const review = overallReview({ approvals: [appr("T1")], gmp: gmpSoon, recalls: undefined, today: TODAY });
  assert.deepEqual(review.items.map((item) => item.key), ["gmp_soon", "recall_info"]);
  assert.match(review.items[1].label, /대조하지 못함/);
  assert.equal(review.needed, true);
});

test("종합: 회수 공지가 0건이면 아무 항목도 만들지 않는다", () => {
  const review = overallReview({ approvals: [appr("T1")], gmp: gmpOk, recalls: [], today: TODAY });
  assert.deepEqual(review.items, []);
  assert.equal(review.needed, false);
});

test("승인 이력 전체를 대조에 쓰고 화면에는 3건만 (FR-008 수용 기준 5)", () => {
  const items = ["A", "B", "C", "D", "E"].map((lot, index) => ({ PRDLST_NM: "시험인플루엔자4가백신주", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: lot, RESULT_TIME: `2026100${index + 1}` }));
  const product = { productName: "시험인플루엔자4가백신주", company: "가상백신(주)" };
  assert.equal(matchApprovals(items, product).length, 3);
  assert.equal(matchApprovals(items, product, Infinity).length, 5);
});

// ---- FR-010 세 곳 업체명 대조 (허가정보 ↔ 승인 ↔ GMP) ----
const ap = (company, match, resultDate = "2026-10-01") => ({ company, match, resultDate, lotNumber: "L" });
const gm = (company, match) => ({ row: { company, validUntil: "2030-12-31" }, match });

test("업체명 대조: 세 곳이 모두 같으면 모두 같음이고 확인은 필요 없다 (FR-010 수용 기준 1)", () => {
  const check = companyCheck({ approvals: [ap("가상백신(주)", "same")], otherApprovals: [], gmp: gm("가상백신(주)", "same") });
  assert.deepEqual(check.rows.map((row) => row.status), ["same", "same", "same"]);
  assert.equal(check.needsCheck, false);
});

test("업체명 대조: GMP 업체가 비슷한 이름이면 허가↔GMP와 승인↔GMP가 비슷함 (FR-010 수용 기준 2)", () => {
  const check = companyCheck({ approvals: [ap("가상백신(주)", "same")], otherApprovals: [], gmp: gm("가상백신바이오(주)", "similar") });
  assert.deepEqual(check.rows.map((row) => row.status), ["same", "similar", "similar"]);
  assert.equal(check.needsCheck, true);
});

test("업체명 대조: 같은 제품명인데 업체가 다른 승인만 있으면 다름, 건수와 업체를 말한다 (FR-010 수용 기준 3)", () => {
  const other = otherCompanyApprovals(
    [{ PRDLST_NM: "시험인플루엔자4가백신주", MNFT_SALPS_NM: "가상수입(주)", MNFT_NO: "X1", RESULT_TIME: "20261001" },
      { PRDLST_NM: "시험인플루엔자4가백신주", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: "X2", RESULT_TIME: "20261002" },
      { PRDLST_NM: "다른약품", MNFT_SALPS_NM: "가상수입(주)", MNFT_NO: "X3", RESULT_TIME: "20261003" }],
    { productName: "시험인플루엔자4가백신주", company: "가상백신(주)" });
  assert.deepEqual(other.map((row) => row.lotNumber), ["X1"]);
  const check = companyCheck({ approvals: [], otherApprovals: other, gmp: gm("가상백신(주)", "same") });
  assert.equal(check.rows[0].status, "different");
  assert.match(check.rows[0].text, /1건/);
  assert.match(check.rows[0].text, /가상수입/);
  assert.equal(check.needsCheck, true);
});

test("업체명 대조: 승인이 있고 다른 업체 승인이 더 있으면 같음을 지키되 제외한 건수를 말한다 (FR-010)", () => {
  const check = companyCheck({ approvals: [ap("가상백신(주)", "same")], otherApprovals: [{ company: "가상수입(주)" }], gmp: gm("가상백신(주)", "same") });
  assert.equal(check.rows[0].status, "same");
  assert.match(check.rows[0].text, /다른 업체 1건/);
});

test("업체명 대조: 승인이나 GMP를 못 찾으면 확인 불가이고 그것만으로 확인 필요는 아니다 (FR-010 수용 기준 4)", () => {
  const check = companyCheck({ approvals: [], otherApprovals: [], gmp: null });
  assert.deepEqual(check.rows.map((row) => row.status), ["none", "none", "none"]);
  assert.equal(check.needsCheck, false);
});

test("종합: 업체명 대조가 필요하면 안내 항목을 더한다, 위험·주의가 없으면 QA 확인 필요는 아니다 (FR-010)", () => {
  const companies = companyCheck({ approvals: [ap("가상백신(주)", "same")], otherApprovals: [], gmp: gm("가상백신바이오(주)", "similar") });
  const review = overallReview({ approvals: [], gmp: gmpOk, recalls: [], companies, today: TODAY });
  assert.deepEqual(review.items.map((item) => [item.key, item.level]), [["company_info", "info"]]);
  assert.equal(review.needed, false);
});

test("종합: 회수 공지를 아직 불러오는 중(null)이면 실패 안내를 만들지 않는다 (리뷰 반영)", () => {
  const review = overallReview({ approvals: [appr("T1")], gmp: gmpOk, recalls: null, today: TODAY });
  assert.deepEqual(review.items, []);
});

test("제품에 업체명이 없으면 승인 이력을 다른 업체로 빼지 않고 비슷함으로 둔다 (리뷰 반영)", () => {
  const items = [{ PRDLST_NM: "시험인플루엔자4가백신주", MNFT_SALPS_NM: "가상백신(주)", MNFT_NO: "A", RESULT_TIME: "20261001" }];
  const product = { productName: "시험인플루엔자4가백신주", company: "" };
  assert.deepEqual(matchApprovals(items, product).map((row) => row.match), ["similar"]);
  assert.equal(otherCompanyApprovals(items, product).length, 0);
});

// ---- FR-011 계획된 생산 ↔ GMP, FR-012 승인 추이, FR-013 GMP 전체 ----
const wo = (orderNumber, plannedStart, plannedEnd, status = "released") => ({ orderNumber, plannedStart, plannedEnd, status });
const gmpUntil = (validUntil) => ({ row: { validUntil, company: "가상백신(주)" }, match: "same" });

test("일정 대조: 계획이 GMP 안에 끝나면 이상 없음, 종료 뒤 90일 이내 만료는 주의, 기간 중 만료는 위험 (FR-011 수용 기준 1)", () => {
  const check = scheduleCheck({ workOrders: [wo("WO-1", "2026-11-01", "2026-11-10"), wo("WO-2", "2026-11-01", "2026-11-10"), wo("WO-3", "2026-11-01", "2026-11-10")], gmp: gmpUntil("2030-12-31") });
  assert.deepEqual(check.rows.map((row) => row.level), ["ok", "ok", "ok"]);
  assert.equal(check.needed, false);
  const soon = scheduleCheck({ workOrders: [wo("WO-2", "2026-11-01", "2026-11-10")], gmp: gmpUntil("2027-01-20") }); // 종료 71일 뒤 만료
  assert.deepEqual(soon.rows.map((row) => row.level), ["warning"]);
  const during = scheduleCheck({ workOrders: [wo("WO-3", "2026-11-01", "2026-11-10")], gmp: gmpUntil("2026-11-05") });
  assert.deepEqual(during.rows.map((row) => row.level), ["danger"]);
  assert.match(during.rows[0].text, /2026-11-05/);
});

test("일정 대조: 시작일에 이미 GMP가 지났으면 위험, 가장 심각한 수준이 전체 수준이다 (FR-011 수용 기준 1)", () => {
  const check = scheduleCheck({ workOrders: [wo("WO-1", "2026-11-01", "2026-11-10"), wo("WO-2", "2026-12-01", "2026-12-10")], gmp: gmpUntil("2026-10-31") });
  assert.deepEqual(check.rows.map((row) => row.level), ["danger", "danger"]);
  assert.match(check.rows[0].text, /이미/);
  assert.equal(check.level, "danger");
  assert.equal(check.needed, true);
});

test("일정 대조: 완료·취소는 빼고, 작업지시가 없거나 GMP가 없으면 이유를 말한다 (FR-011 수용 기준 3·4)", () => {
  assert.deepEqual(scheduleCheck({ workOrders: [wo("WO-1", "2026-11-01", "2026-11-10", "completed"), wo("WO-2", "2026-11-01", "2026-11-10", "cancelled")], gmp: gmpUntil("2026-11-05") }).rows, []);
  assert.match(scheduleCheck({ workOrders: [], gmp: gmpUntil("2026-11-05") }).reason, /작업지시가 없습니다/);
  assert.match(scheduleCheck({ workOrders: [wo("WO-1", "2026-11-01", "2026-11-10")], gmp: null }).reason, /GMP 적합판정서를 찾지 못해/);
});

test("종합: 일정이 GMP와 안 맞으면 위험을 더한다, 회수 다음·GMP 앞 (FR-011 수용 기준 2)", () => {
  const schedule = scheduleCheck({ workOrders: [wo("WO-7", "2026-11-01", "2026-11-10")], gmp: gmpUntil("2026-11-05") });
  const review = overallReview({ approvals: [appr("T1")], gmp: { row: { validUntil: "2026-11-05" }, match: "same" }, recalls: [recall("T1")], schedule, today: TODAY });
  assert.deepEqual(review.items.map((item) => item.key), ["recalled_lot", "schedule_danger", "gmp_soon"]);
  assert.match(review.items[1].reason, /WO-7/);
});

test("승인 추이: 마지막 승인 경과일·평균 간격·유효기간 임박/지남 수를 센다 (FR-012 수용 기준 1)", () => {
  const trend = approvalTrend([
    { resultDate: "2026-10-18", validUntil: "2026-12-01" }, { resultDate: "2026-09-18", validUntil: "2026-10-01" },
    { resultDate: "2026-08-19", validUntil: "2027-08-18" }, { resultDate: "", validUntil: "" },
  ], TODAY);
  assert.equal(trend.count, 4);
  assert.equal(trend.latestDate, "2026-10-18");
  assert.equal(trend.daysSinceLatest, 10);
  assert.equal(trend.avgIntervalDays, 30);
  assert.equal(trend.soonCount, 1);
  assert.equal(trend.expiredCount, 1);
  assert.equal(trend.gap, false);
});

test("승인 추이: 경과일이 평균 간격의 2배를 넘으면 공백, 승인이 2건 미만이면 판단하지 않는다 (FR-012 수용 기준 2·3)", () => {
  const old = approvalTrend([{ resultDate: "2026-06-01", validUntil: "" }, { resultDate: "2026-05-01", validUntil: "" }, { resultDate: "2026-04-01", validUntil: "" }], TODAY);
  assert.equal(old.gap, true);
  const one = approvalTrend([{ resultDate: "2026-01-01", validUntil: "" }], TODAY);
  assert.equal(one.avgIntervalDays, null);
  assert.equal(one.gap, false);
  assert.equal(approvalTrend([], TODAY).latestDate, null);
});

test("종합: 승인 공백과 유효기간 임박 승인 로트는 안내로만 더한다 (FR-012 수용 기준 2)", () => {
  const trend = approvalTrend([{ resultDate: "2026-06-01", validUntil: "2026-11-30" }, { resultDate: "2026-05-01", validUntil: "" }, { resultDate: "2026-04-01", validUntil: "" }], TODAY);
  const review = overallReview({ approvals: [], gmp: gmpOk, recalls: [], trend, today: TODAY });
  assert.deepEqual(review.items.map((item) => [item.key, item.level]), [["trend_info", "info"], ["trend_info", "info"]]);
  assert.equal(review.needed, false);
});

test("GMP 전체: 같은·비슷한 업체만, 유효기간 늦은 순, 남은 일수를 붙인다 (FR-013)", () => {
  const rows = gmpRowsFor([
    { company: "가상백신(주)", factory: "A", kind: "완제", group: "백신", validUntil: "2027-01-31" },
    { company: "가상백신바이오(주)", factory: "B", kind: "완제", group: "백신", validUntil: "2030-12-31" },
    { company: "가상제약(주)", factory: "C", kind: "완제", group: "정제", validUntil: "2030-12-31" },
    { company: "가상백신(주)", factory: "D", kind: "원료", group: "", validUntil: "" },
  ], "가상백신(주)", TODAY);
  assert.deepEqual(rows.map((row) => row.factory), ["B", "A", "D"]);
  assert.deepEqual(rows.map((row) => row.match), ["similar", "same", "same"]);
  assert.equal(rows[1].days, 95);
  assert.equal(rows[2].days, null);
});
