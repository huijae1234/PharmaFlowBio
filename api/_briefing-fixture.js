// 아침 브리핑 시험 모드(BRIEFING_MODE=fixtures, 로컬만)의 가짜 사람 셋과 항목. `_`로 시작해 Vercel이 함수로 만들지 않는다.
// 모든 줄에 "(시험 자료)"를 붙여 실제 브리핑과 섞이지 않게 한다. 기록은 메모리에만 남는다.
const PEOPLE = [
  { id: "00000000-0000-4000-8000-0000000000a1", display_name: "시험 QA", email: "qa@fixture.local", role: "qa_manager" },
  { id: "00000000-0000-4000-8000-0000000000a2", display_name: "시험 QC", email: "qc@fixture.local", role: "qc_analyst" },
  { id: "00000000-0000-4000-8000-0000000000a3", display_name: "시험 생산", email: "prod@fixture.local", role: "production_operator" },
];
const row = (text, path) => ({ text: `${text} (시험 자료)`, path });
const list = (key, rows) => ({ key, state: "ok", count: rows.length, top: rows.slice(0, 3) });
const counts = (parts) => ({ key: "counts", state: "ok", count: 0, top: [], parts });

const ITEMS = {
  qa_manager: [
    list("qa_waiting_issues", [row("HBV-2610-001 · 7일째", "#/issues"), row("TDP-2610-001 · 3일째", "#/issues")]),
    list("qa_submitted_reviews", [row("HBV-2610-001 · 평가서 2일째", "#/issues")]),
    list("qa_done_actions", []),
    { key: "qa_schedule", state: "failed", count: 0, top: [] },
    counts([{ key: "held_lots", count: 3 }, { key: "pending_reviews", count: 1 }, { key: "my_actions", count: 0 }, { key: "overdue_orders", count: 1 }]),
  ],
  qc_analyst: [
    list("test_issues", [row("HBV-2610-002 · 2일째", "#/issues")]),
    list("my_reviews", []),
    list("my_test_actions", [row("HBV-2610-002 · 재시험", "#/issues")]),
    counts([{ key: "held_lots", count: 3 }, { key: "my_actions", count: 1 }]),
  ],
  production_operator: [
    list("process_issues", [row("TDP-2610-001 · 3일째", "#/issues")]),
    list("my_reviews", [row("TDP-2610-001 · 보완 요청", "#/issues")]),
    list("my_process_actions", []),
    list("my_turn", [row("WO-2610-004 · 착수 대기", "#/work-orders")]),
    counts([{ key: "held_lots", count: 3 }, { key: "my_actions", count: 0 }, { key: "overdue_orders", count: 1 }]),
  ],
};

export function fixtureData() {
  const sent = new Set();
  return {
    recipients: async () => PEOPLE,
    items: async (id) => { const role = PEOPLE.find((person) => person.id === id)?.role; return role ? { role, sections: ITEMS[role] } : null; },
    alreadySent: async (id, day) => sent.has(`${id}:${day}`),
    record: async (id, day) => { const key = `${id}:${day}`; const fresh = !sent.has(key); sent.add(key); return fresh; },
  };
}
