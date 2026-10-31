import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSearchTerm, formatYmd, permitRow, recallRow, matchRecalls, recentRecalls, isVaccineItem, sourceText, lastGoodText, publicCacheKey,
} from "../src/domain/public-data-rules.js";

test("검색어 검사: 빈 값·공백만은 안내, 1글자는 통과, 앞뒤 공백 정리 (FR-001 경계)", () => {
  assert.deepEqual(checkSearchTerm("", "품목명을 입력해 주세요."), { ok: false, error: "품목명을 입력해 주세요." });
  assert.deepEqual(checkSearchTerm("   ", "품목명을 입력해 주세요."), { ok: false, error: "품목명을 입력해 주세요." });
  assert.deepEqual(checkSearchTerm("정", "품목명을 입력해 주세요."), { ok: true, value: "정" });
  assert.deepEqual(checkSearchTerm("  타이레놀 ", "품목명을 입력해 주세요."), { ok: true, value: "타이레놀" });
});

test("날짜 \"20261021\" → \"2026-10-21\", 이상한 값은 빈 글자", () => {
  assert.equal(formatYmd("20261021"), "2026-10-21");
  assert.equal(formatYmd("20261021000000"), "2026-10-21");
  assert.equal(formatYmd(null), "");
  assert.equal(formatYmd("2026"), "");
});

test("허가정보 한 줄 (2026-10-22 실제 응답 모양, FR-001·002)", () => {
  const item = {
    ITEM_SEQ: "202106092", ITEM_NAME: "타이레놀정500밀리그람(아세트아미노펜)", ENTP_NAME: "켄뷰코리아판매유한회사",
    ITEM_INGR_NAME: "Acetaminophen", SPCLTY_PBLC: "일반의약품", ITEM_PERMIT_DATE: "20210929", CANCEL_NAME: "정상",
  };
  assert.deepEqual(permitRow(item), {
    code: "202106092", name: "타이레놀정500밀리그람(아세트아미노펜)", company: "켄뷰코리아판매유한회사",
    ingredient: "Acetaminophen", kind: "일반의약품", permitDate: "2021-09-29", status: "정상", type: "",
  });
  assert.equal(permitRow({ ITEM_SEQ: "1", ITEM_NAME: "가", CANCEL_NAME: null }).status, "");
});

test("회수 공지 한 줄", () => {
  assert.deepEqual(recallRow({
    ITEM_SEQ: "200805926", PRDUCT: "엑스프리벤정", ENTRPS: "(주)다림바이오텍", RTRVL_RESN: "혼입 우려",
    RECALL_COMMAND_DATE: "20261021", MNFCTUR_NO: "25040",
  }), {
    code: "200805926", product: "엑스프리벤정", company: "(주)다림바이오텍", reason: "혼입 우려",
    commandDate: "2026-10-21", lotNumber: "25040",
  });
});

test("제품의 회수 공지: 같은 품목기준코드만, 최근순 (Q25)", () => {
  const items = [
    { ITEM_SEQ: "A", PRDUCT: "가정", RECALL_COMMAND_DATE: "20250101", MNFCTUR_NO: "1" },
    { ITEM_SEQ: "B", PRDUCT: "가정", RECALL_COMMAND_DATE: "20261001", MNFCTUR_NO: "2" }, // 이름은 같고 다른 품목
    { ITEM_SEQ: "A", PRDUCT: "가정", RECALL_COMMAND_DATE: "20261020", MNFCTUR_NO: "3" },
  ];
  assert.deepEqual(matchRecalls(items, "A").map((row) => row.lotNumber), ["3", "1"]);
  assert.deepEqual(matchRecalls(items, "Z"), []);
  assert.deepEqual(matchRecalls([], "A"), []);
  assert.deepEqual(matchRecalls(items, null), [], "품목기준코드가 없으면 맞추지 않는다");
});

test("최근 회수 공지 5건: 최근순 (FR-003)", () => {
  const items = ["20261001", "20261021", "20260901", "20261015", "20261010", "20261020", "20260801"]
    .map((date, i) => ({ ITEM_SEQ: String(i), RECALL_COMMAND_DATE: date }));
  assert.deepEqual(recentRecalls(items).map((row) => row.commandDate),
    ["2026-10-21", "2026-10-20", "2026-10-15", "2026-10-10", "2026-10-01"]);
  assert.equal(recentRecalls(items.slice(0, 2)).length, 2);
});

test("백신 품목 판별: 품목 구분에 백신류 (spec 006 FR-001)", () => {
  assert.equal(isVaccineItem({ PRDUCT_TYPE: "[06310]백신류" }), true);
  assert.equal(isVaccineItem({ PRDUCT_TYPE: "[01140]해열.진통.소염제" }), false);
  assert.equal(isVaccineItem({}), false);
  assert.equal(permitRow({ ITEM_SEQ: "1", PRDUCT_TYPE: "[06310]백신류" }).type, "[06310]백신류");
});

test("출처·조회 시각 글자 (spec 006 FR-002)", () => {
  assert.equal(sourceText(new Date(2026, 9, 26, 9, 5)), "출처: 식약처 공공데이터 · 조회 10/26 09:05");
  assert.equal(sourceText(new Date(2026, 0, 3, 14, 30)), "출처: 식약처 공공데이터 · 조회 1/3 14:30");
});

test("마지막 정상 조회 글자: 저장한 시각(ISO 글자)을 이 기기 시각으로 (spec 006 FR-003 수용 기준 1)", () => {
  const savedAt = new Date(2026, 9, 25, 8, 7).toISOString();
  assert.equal(lastGoodText(savedAt), "마지막 정상 조회 10/25 08:07 (지금 결과가 아닐 수 있습니다)");
});

test("마지막 정상 결과 열쇠: 조건 순서 상관없이 같고, 조건이 다르면 다르다 (spec 006 FR-003)", () => {
  assert.equal(publicCacheKey("permit", { name: "인플루엔자", vaccine: 1 }), publicCacheKey("permit", { vaccine: 1, name: "인플루엔자" }));
  assert.notEqual(publicCacheKey("permit", { name: "A" }), publicCacheKey("permit", { name: "B" }));
  assert.notEqual(publicCacheKey("permit", { name: "A" }), publicCacheKey("recall", { name: "A" }));
  assert.match(publicCacheKey("recall", { recent: 20 }), /^pharmaflow\.public\.recall\?/);
});
