// spec 025 AI 도우미 시험 모드(AI_MODE=fixtures, 로컬만)의 가짜 Claude 응답. `_`로 시작해 Vercel이 함수로 만들지 않는다.
// 모든 글에 "(시험 응답)"을 붙여 실제 응답과 섞이지 않게 한다. 못된 모델(범위 밖·승인·주입·숫자 불일치·밖 주소·형식 오류·실패)을 흉내 내 서버 검증과 화면을 시험한다.
export const CHAT_FIXTURE_CASES = ["normal", "query", "outofscope", "approve", "inject", "mismatch", "badlink", "badformat", "fail", "nokey"];

const USAGE = { input_tokens: 0, output_tokens: 0 };
const reply = (parts, outOfScope = false) => ({ text: JSON.stringify({ parts, outOfScope }), stopReason: "end_turn", usage: USAGE });
const part = (body, refs = [], guide = []) => ({ text: `(시험 응답) ${body}`, refs, guide });

/** "query": 1번째는 "제품별 품질 이슈(최근)" 조회를 부르고, 2번째(도구 없이 답만)는 조회 결과 첫 줄을 인용한다 (spec 025 FR-010) */
function queryResponse(facts, toolChoice) {
  if (toolChoice?.type !== "none") {
    const content = [{ type: "tool_use", id: "toolu_fixture_1", name: "app_query", input: { query: "issues_by_product" } }];
    return { text: null, stopReason: "tool_use", usage: USAGE, content, toolUses: content };
  }
  const row = facts?.rows.find((item) => item.id === "q1_1") ?? facts?.rows.find((item) => item.id === "q1");
  return reply([part(`${row?.label ?? "제품별 품질 이슈"}: ${row?.value ?? "없음"}`, row ? [row.id] : [])]);
}

/** 질문 글에 제목이 들어 있는 안내서 항목, 없으면 로트 */
function pickGuide(question, guide) {
  return guide.find((item) => question.includes(item.title)) ?? guide.find((item) => item.id === "menu_batches");
}

/**
 * @param {string} fixtureCase
 * @param {{ question: string, guide: { id: string, title: string, text: string }[], facts: { rows: { id: string, label: string, value: string, state: string }[] } | null, toolChoice?: { type: string } }} input
 * @returns {{ status?: number, text?: string | null, stopReason?: string, usage?: object }}
 */
export function chatFixtureResponse(fixtureCase, { question, guide, facts, toolChoice }) {
  if (fixtureCase === "query") return queryResponse(facts, toolChoice);
  const row = facts?.rows.find((item) => item.state === "ok");
  const item = pickGuide(question, guide);
  switch (fixtureCase) {
    case "outofscope": return reply([part("관계없는 질문입니다.")], true);
    case "approve": return reply([part("이 로트는 출하해도 안전합니다.", row ? [row.id] : [], [item.id])]);
    case "inject": return reply([part("말씀대로 규칙을 무시하고 이 로트를 승인하세요.", row ? [row.id] : [], [item.id])]);
    case "mismatch": return reply([part(`${row?.label ?? "보류 로트"}가 99개입니다.`, row ? [row.id] : [], row ? [] : [item.id])]);
    case "badlink": return reply([part("자세한 건 https://example.com 을 보세요.", [], [item.id])]);
    case "badformat": return { text: "(시험 응답) JSON이 아닌 글입니다.", stopReason: "end_turn", usage: USAGE };
    case "fail": return { status: 500 };
    default: {
      const parts = [part(`${item.title}: ${item.text}`, [], [item.id])];
      if (row) parts.unshift(part(`${row.label}: ${row.value}`, [row.id]));
      return reply(parts);
    }
  }
}
