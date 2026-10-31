// spec 026 FR-001·003~007: 아침 브리핑 글 만들기 규칙 (평일·한국 날짜, 직무별 절, 슬랙 글, AI 줄 검증)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_SECTIONS, SECTION_LABELS, briefingFacts, briefingText, isWeekdayKst, kstDay, pickAiLines } from "../src/domain/briefing-rules.js";

const ORIGIN = "https://pharmaflow.example";
const section = (key, count, top = [], state = "ok") => ({ key, state, count, top });
const item = (n) => ({ text: `HBV-2610-00${n} · 7일째`, path: `#/batches/id-${n}` });
const sectionsFor = (role, count = 0) => ROLE_SECTIONS[role].map((key) => section(key, count));

test("평일 판정은 한국 시간으로 한다: UTC 일 23시 = 한국 월 08시 (FR-001)", () => {
  assert.equal(isWeekdayKst(new Date("2026-11-01T23:00:00Z")), true); // 한국 11/2(월) 08:00
  assert.equal(isWeekdayKst(new Date("2026-10-31T23:00:00Z")), false); // 한국 11/1(일) 08:00
  assert.equal(isWeekdayKst(new Date("2026-10-30T23:00:00Z")), false); // 한국 10/31(토) 08:00
  assert.equal(isWeekdayKst(new Date("2026-10-30T14:59:00Z")), true); // 한국 10/30(금) 23:59
  assert.equal(kstDay(new Date("2026-11-01T23:00:00Z")), "2026-11-02");
  assert.equal(kstDay(new Date("2026-11-01T14:59:59Z")), "2026-11-01");
});

test("직무별 절: QA·QC·생산은 사용자 표의 항목만 갖고, 다른 직무 항목이 섞이지 않는다 (FR-003~005, SC-002)", () => {
  assert.deepEqual(ROLE_SECTIONS.qa_manager, ["qa_waiting_issues", "qa_submitted_reviews", "qa_done_actions", "qa_schedule", "counts"]);
  assert.deepEqual(ROLE_SECTIONS.qc_analyst, ["test_issues", "my_reviews", "my_test_actions", "counts"]);
  assert.deepEqual(ROLE_SECTIONS.production_operator, ["process_issues", "my_reviews", "my_process_actions", "my_turn", "counts"]);
  assert.equal(ROLE_SECTIONS.viewer, undefined); // 열람자는 받지 않는다 (FR-002)
  for (const key of Object.values(ROLE_SECTIONS).flat()) assert.ok(SECTION_LABELS[key], key);
  // 받은 자료에 다른 직무 절이 있어도 글에는 그 직무 절만
  const text = briefingText({ role: "production_operator", day: "2026-11-02", origin: ORIGIN, sections: [...sectionsFor("production_operator", 1), section("qa_waiting_issues", 9)] });
  assert.doesNotMatch(text, new RegExp(SECTION_LABELS.qa_waiting_issues));
  assert.match(text, new RegExp(SECTION_LABELS.my_turn));
});

test("항목: 개수, 앞 3건 링크, 많으면 \"외 N건\"과 목록 링크 (FR-003·006, 경계)", () => {
  const sections = [section("qa_waiting_issues", 7, [item(1), item(2), item(3), item(4)])];
  const text = briefingText({ role: "qa_manager", day: "2026-11-02", origin: ORIGIN, sections });
  assert.match(text, /평가서 검토·조치 승인을 기다리는 이슈 7건/);
  assert.match(text, /<https:\/\/pharmaflow\.example\/#\/batches\/id-1\|HBV-2610-001 · 7일째>/);
  assert.doesNotMatch(text, /id-4/); // 앞 3건만
  assert.match(text, /외 4건/);
});

test("읽지 못한 항목은 0이 아니라 \"읽지 못했습니다\", 다른 항목은 그대로 (FR-006 수용 기준 1)", () => {
  const sections = [section("qa_schedule", 0, [], "failed"), section("qa_waiting_issues", 2, [item(1)])];
  const text = briefingText({ role: "qa_manager", day: "2026-11-02", origin: ORIGIN, sections });
  assert.match(text, /작업 일정: 읽지 못했습니다\(앱에서 확인\)/);
  assert.match(text, /이슈 2건/);
  assert.doesNotMatch(text, /오늘 확인할 항목이 없습니다/);
});

test("모든 항목이 0건이면 보증이 아니라는 문구 하나 (FR-006 수용 기준 2)", () => {
  const text = briefingText({ role: "qc_analyst", day: "2026-11-02", origin: ORIGIN, sections: sectionsFor("qc_analyst", 0) });
  assert.match(text, /오늘 확인할 항목이 없습니다\. 이상이 없다는 보증은 아닙니다\./);
});

test("개수 한 줄(⑥): 직무별 개수를 한 줄로, 못 읽은 것은 \"읽지 못함\" (FR-003~005)", () => {
  const counts = { key: "counts", state: "ok", count: 0, top: [], parts: [{ key: "held_lots", count: 3 }, { key: "my_actions", count: null }] };
  const text = briefingText({ role: "qc_analyst", day: "2026-11-02", origin: ORIGIN, sections: [counts] });
  assert.match(text, /보류 로트 3 · 나에게 배정된 미완료 조치 읽지 못함/);
});

test("링크는 앱 안(#/)만: 밖 주소·빈 경로는 글자만 남긴다 (FR-010, spec 025와 같은 원칙)", () => {
  const sections = [section("test_issues", 2, [{ text: "밖", path: "https://evil.example" }, { text: "빈", path: null }])];
  const text = briefingText({ role: "qc_analyst", day: "2026-11-02", origin: ORIGIN, sections });
  assert.doesNotMatch(text, /evil/);
  assert.match(text, /– 밖/);
  assert.match(text, /– 빈/);
});

test("머리: 날짜·직무, 끝에 홈 링크를 직접 붙이지 않는다(슬랙 함수가 붙임), 다른 사람 이름·이메일 없음 (FR-010, 리뷰 1)", () => {
  const text = briefingText({ role: "qa_manager", day: "2026-11-02", origin: ORIGIN, sections: sectionsFor("qa_manager", 1) });
  assert.match(text, /^\*아침 브리핑 · 11\/2\(월\) · QA 관리자\*/);
  assert.doesNotMatch(text, /#\/home\//);
  assert.doesNotMatch(text, /@/);
});

test("슬랙 특수 문자(&·<·>)는 바꿔 써서 링크가 끊기지 않는다 (리뷰 2)", () => {
  const sections = [section("test_issues", 1, [{ text: "A&B <백신> 1", path: "#/issues/x" }])];
  const text = briefingText({ role: "qc_analyst", day: "2026-11-02", origin: ORIGIN, sections });
  assert.match(text, /<https:\/\/pharmaflow\.example\/#\/issues\/x\|A&amp;B &lt;백신&gt; 1>/);
});

test("AI 줄: 근거 표(spec 022 모양)를 만들고, 검증을 통과한 문장만 2개까지, 걸리면 하나도 안 붙인다 (FR-007)", () => {
  const sections = [section("qa_waiting_issues", 2), section("qa_schedule", 0, [], "failed")];
  const facts = briefingFacts(sections, "2026-11-01T23:00:00.000Z");
  assert.deepEqual(facts.rows.map((row) => [row.id, row.value, row.state]), [["qa_waiting_issues", "2건", "ok"], ["qa_schedule", "읽지 못함", "failed"]]);
  const good = { claims: [{ text: "검토를 기다리는 이슈 2건을 먼저 보세요.", refs: ["qa_waiting_issues"] }], unknowns: [] };
  assert.deepEqual(pickAiLines(good, facts), ["검토를 기다리는 이슈 2건을 먼저 보세요."]);
  const bad = { claims: [{ text: "이슈 5건을 보세요.", refs: ["qa_waiting_issues"] }, { text: "검토 대기 이슈 2건이 있습니다.", refs: ["qa_waiting_issues"] }], unknowns: [] };
  assert.deepEqual(pickAiLines(bad, facts), []); // 하나라도 걸리면 AI 줄 전부 뺀다
  assert.deepEqual(pickAiLines(null, facts), []);
  const text = briefingText({ role: "qa_manager", day: "2026-11-02", origin: ORIGIN, sections, aiLines: ["검토를 기다리는 이슈 2건을 먼저 보세요."] });
  assert.match(text, /먼저 볼 것 \(AI 참고 의견\): 검토를 기다리는 이슈 2건을 먼저 보세요\./);
});
