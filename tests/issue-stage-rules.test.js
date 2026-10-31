import test from "node:test";
import assert from "node:assert/strict";
import { stageCards } from "../src/domain/issue-stage-rules.js";
import { lotGroup, lotGroups, productOptions } from "../src/domain/lot-group-rules.js";
import { ageInfo } from "../src/domain/home-task-rules.js";

const issue = { kind: "spec", status: "open", batch: { status: "on_hold" } };

test("단계 카드: 지나온 단계·지금·남은 단계, 다음에 할 일은 지금 카드에만 (UI 개편)", () => {
  const cards = stageCards({
    issue, summary: "역가 76%",
    review: { status: "submitted", requester: { display_name: "윤○○" } },
    requests: [],
    step: { stage: 1, next: "영향 평가 검토", owner: "QA 관리자" },
  });
  assert.deepEqual(cards.map((card) => card.state), ["done", "current", "todo", "todo", "todo"]);
  assert.equal(cards[0].headline, "규격 이탈");
  assert.equal(cards[0].sub, "역가 76%");
  assert.equal(cards[1].headline, "검토 요청");
  assert.equal(cards[1].next, "영향 평가 검토");
  assert.equal(cards.filter((card) => card.next).length, 1);
});

test("단계 카드: 평가 전·조치 선택(관리기준 이탈)·종결·로트 상태", () => {
  const cards = stageCards({
    issue: { kind: "alert", status: "closed", closer: { display_name: "나" }, batch: { status: "in_testing" } },
    summary: "-", review: null,
    requests: [{ status: "completed" }, { status: "approved" }],
    step: { stage: 4, next: "내부 출하 검토", owner: "QA 관리자" },
  });
  assert.equal(cards[0].sub, "");
  assert.equal(cards[1].headline, "작성 전");
  assert.equal(cards[2].headline, "요청 2건");
  assert.equal(cards[2].sub, "완료 1 · 선택");
  assert.equal(cards[3].headline, "종결됨");
  assert.equal(cards[3].sub, "나");
  assert.equal(cards[4].headline, "시험 중");
  assert.equal(cards[4].state, "current");
});

test("제품군: 로트번호 앞 영문, 없으면 기타", () => {
  assert.equal(lotGroup("QA-PS-003"), "QA");
  assert.equal(lotGroup("ifv-2610-005"), "IFV");
  assert.equal(lotGroup("WO-2611-002"), "WO");
  assert.equal(lotGroup("2610-001"), "기타");
  assert.equal(lotGroup(null), "기타");
});

test("제품군 목록: 많은 것부터, 같으면 이름순", () => {
  const rows = lotGroups([{ batch_number: "IFV-1" }, { batch_number: "QA-1" }, { batch_number: "IFV-2" }, { batch_number: "HBV-1" }]);
  assert.deepEqual(rows, [{ group: "IFV", count: 2 }, { group: "HBV", count: 1 }, { group: "QA", count: 1 }]);
});

test("기다린 날수: 오늘·N일째·7일이면 지연, 읽을 수 없으면 null", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  assert.deepEqual(ageInfo("2026-10-28T01:00:00Z", now), { days: 0, text: "오늘", late: false });
  assert.deepEqual(ageInfo("2026-10-25T12:00:00Z", now), { days: 3, text: "3일째", late: false });
  assert.equal(ageInfo("2026-10-21T12:00:00Z", now).late, true);
  assert.equal(ageInfo(null, now), null);
  assert.equal(ageInfo("엉터리", now), null);
});

test("보류 로트 설명: 열린 이슈 수와 며칠째, 직접 보류 사유", async () => {
  const { holdSummary } = await import("../src/domain/home-task-rules.js");
  const now = new Date("2026-10-28T12:00:00Z");
  const issues = [
    { batch_id: "a", status: "open", opened_at: "2026-10-21T12:00:00Z" },
    { batch_id: "a", status: "open", opened_at: "2026-10-27T12:00:00Z" },
    { batch_id: "a", status: "closed", opened_at: "2026-09-01T00:00:00Z" },
    { batch_id: "b", status: "open", opened_at: "2026-10-28T01:00:00Z" },
  ];
  assert.equal(holdSummary({ id: "a" }, issues, now), "열린 이슈 2건 · 7일째");
  assert.equal(holdSummary({ id: "b", hold_reason: "포장 라인 점검" }, issues, now), "열린 이슈 1건 · 오늘 · 사유: 포장 라인 점검");
  assert.equal(holdSummary({ id: "c", hold_reason: "점검" }, issues, now), "사유: 점검");
  assert.equal(holdSummary({ id: "d" }, issues, now), "");
});

test("제품 거르기 목록: product_id 기준, 많은 것부터, 이름 없으면 표시", () => {
  const rows = productOptions([
    { product_id: "a", product: { item_name: "나 백신" } },
    { product_id: "b", product: { item_name: "가 백신" } },
    { product_id: "a", product: { item_name: "나 백신" } },
    { product_id: "c", product: { item_name: "다 백신" } },
    { product_id: null },
  ]);
  assert.deepEqual(rows, [
    { id: "a", name: "나 백신", count: 2 },
    { id: "b", name: "가 백신", count: 1 },
    { id: "c", name: "다 백신", count: 1 },
  ]);
});

test("제품 거르기 목록: 이름을 못 읽은 제품도 목록에 남는다", () => {
  assert.deepEqual(productOptions([{ product_id: "d", product: null }]), [{ id: "d", name: "(이름 없음)", count: 1 }]);
});
