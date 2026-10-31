// 업무 찾아보기(spec 024 FR-003): 질문 → 미리 정한 조회 종류·허용 필터 → 서버가 준비된 읽기로 조회. 임의 SQL·코드·URL 실행도, 수정·승인·전송도 없다.
// 질문에 적힌 사용자·역할은 권한이 아니다: 역할은 서버가 DB에서 읽었고, "내 업무"는 로그인한 사용자로 정한다. `_`로 시작해 함수로 열리지 않는다.
import { ASK_KINDS, askAllowed, askKindsFor, askResult, askRows, cleanQuestion, examplesFor, filterText, isAskKind, validateFilters } from "../src/domain/ai-ask-rules.js";
import { kstDate } from "../src/domain/ai-schedule-rules.js";

const out = (status, json) => ({ status, json });
const choices = (role) => askKindsFor(role).map((kind) => ({ kind, label: ASK_KINDS[kind].label }));
const hints = (role) => ({ examples: examplesFor(role).map(({ kind, filters, text }) => ({ kind, filters, text })) });

/**
 * @param {{ req: object, userId: string, role: string, body: { question?: unknown, pick?: { kind?: string, filters?: object } }, data: { askData: Function }, now: Date,
 *   interpret: (question: string) => Promise<{ parsed?: object, status?: number, reason?: string, refund?: boolean }> }} input
 * @returns {Promise<{ status: number, json: object, refund?: boolean }>}
 */
export async function answerAsk({ req, userId, role, body, data, now, interpret }) {
  let pick = null;
  let how = "pick";
  if (body.pick !== undefined) {
    const kind = body.pick?.kind;
    const filters = isAskKind(kind) ? validateFilters(kind, body.pick.filters ?? {}) : null;
    if (filters === null) return out(400, { ok: false, reason: "조회 조건이 올바르지 않습니다.", ...hints(role) });
    if (!askAllowed(role, kind)) return out(403, { ok: false, reason: "이 역할은 쓸 수 없는 조회입니다.", ...hints(role) });
    pick = { kind, filters };
  } else {
    const question = cleanQuestion(body.question);
    if (!question) return out(400, { ok: false, reason: "질문을 120자 안으로 적어 주세요.", ...hints(role) });
    how = "question";
    const result = await interpret(question);
    if (!result.parsed) return { ...out(result.status, { ok: false, reason: result.reason, ...hints(role) }), refund: result.refund };
    const { parsed } = result;
    if (parsed.type === "denied") return out(403, { ok: false, reason: `이 역할은 '${ASK_KINDS[parsed.kind].label}'을 조회할 수 없습니다. 아래 질문은 할 수 있습니다.`, ...hints(role) });
    if (parsed.type === "unsupported") return out(200, { ok: true, ask: true, unsupported: true, ...hints(role) });
    if (parsed.type === "clarify") return out(200, { ok: true, ask: true, clarify: parsed.options.map((kind) => ({ kind, label: ASK_KINDS[kind].label })), choices: choices(role) });
    pick = { kind: parsed.kind, filters: parsed.filters };
  }
  let raw;
  try {
    raw = await data.askData(req, pick.kind, { userId, today: kstDate(now) });
  } catch {
    return out(502, { ok: false, reason: "조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요." });
  }
  const result = askResult(pick.kind, askRows(pick.kind, raw, { filters: pick.filters, now }), { filters: pick.filters, truncated: raw.truncated, now });
  return out(200, { ok: true, ask: true, how, understood: { kind: pick.kind, label: ASK_KINDS[pick.kind].label, scope: filterText(pick.kind, pick.filters) }, result });
}
