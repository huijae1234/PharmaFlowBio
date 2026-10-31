// AI 도우미가 고른 앱 전체 조회를 실행한다 (spec 025 v0.6 FR-010 11단계). `_`로 시작해 함수로 열리지 않는다.
// AI가 보낸 조회 이름·조건은 믿지 않고 서버가 DB에서 읽은 역할로 다시 검사한다. 모든 도구 호출에 결과를 하나씩 돌려준다(API 규칙).
import { checkQueryInput, queryScope, APP_QUERIES } from "../src/domain/app-query-rules.js";
import { queryFacts } from "../src/domain/app-query-facts.js";
import { factsToText } from "../src/domain/ai-facts-rules.js";

export const MAX_QUERIES = 2; // Q102
const OVER_LIMIT = `조회는 한 질문에 ${MAX_QUERIES}개까지라 실행하지 않았습니다.`;

const errorResult = (id, reason) => ({ type: "tool_result", tool_use_id: id, content: reason, is_error: true });

/**
 * @param {{ id: string, input: unknown }[]} toolUses Claude가 부른 도구
 * @param {{ req: object, role: string, userId: string, now: Date, readQuery: Function }} context
 * @returns {Promise<{ results: object[], rows: object[], queries: { label: string, scope: string }[] }>}
 */
export async function runQueries(toolUses, { req, role, userId, now, readQuery }) {
  const results = [];
  const rows = [];
  const queries = [];
  for (const [index, use] of toolUses.entries()) {
    if (index >= MAX_QUERIES) {
      results.push(errorResult(use.id, OVER_LIMIT));
      continue;
    }
    const checked = checkQueryInput(role, use.input);
    if (!checked.ok) {
      results.push(errorResult(use.id, checked.reason));
      continue;
    }
    const data = await readQuery(req, checked.kind, checked.params, { userId, now });
    const found = queryFacts(checked.kind, data, { params: checked.params, now, prefix: `q${queries.length + 1}` });
    rows.push(...found);
    queries.push({ label: APP_QUERIES[checked.kind].label, scope: queryScope(checked.kind, checked.params) });
    results.push({ type: "tool_result", tool_use_id: use.id, content: factsToText({ asOf: now.toISOString(), rows: found, limits: [] }) });
  }
  return { results, rows, queries };
}

/** 화면 근거 표 + 조회 결과 줄 = 답을 검증할 근거 표 */
export function withQueryRows(facts, rows, asOf) {
  if (!rows.length) return facts;
  return { asOf: facts?.asOf ?? asOf, rows: [...(facts?.rows ?? []), ...rows], limits: facts?.limits ?? [] };
}
