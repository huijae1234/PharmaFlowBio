// Claude 브리핑 (spec 022·023·024). 홈·로트·규제 칸은 화면이 코드로 센 "근거 표"를 받고, 이슈·기준·일정 칸은 서버가 저장된 사실을 직접 읽어 근거 표를 만든다 (api/_ai-resolve.js).
// 키(ANTHROPIC_API_KEY)는 환경변수에서만 읽고 응답·오류·로그에 넣지 않는다. 판정·승인은 하지 않는다.
// 모델·요금·제한은 Anthropic 공식 문서(platform.claude.com/docs, 2026-10-29 확인)를 따른다. docs/specs/022 spec 7절.
import { sendJson, verifyUser } from "./_public-data.js";
import { AI_KINDS, AI_LIMITS, buildPrompt, canUseAi, parseAiAnswer, refundQuota, reviewAnswer, takeQuota } from "../src/domain/ai-brief-rules.js";
import { requestFacts, validateFacts } from "../src/domain/ai-facts-rules.js";
import { ASSIST_KINDS, ASSIST_LIMITS, buildAssistPrompt, canUseAssist, parseAssistAnswer, reviewAssistAnswer } from "../src/domain/ai-assist-rules.js";
import { buildAskPrompt, cleanQuestion, parseAskAnswer } from "../src/domain/ai-ask-rules.js";
import { isStaff } from "../src/domain/ai-policy-rules.js";
import { defaultData } from "./_ai-data.js";
import { resolveAssist } from "./_ai-resolve.js";
import { answerAsk } from "./_ai-ask.js";
import { FIXTURE_CASES, fixtureAskResponse, fixtureResponse } from "./_ai-fixture.js";
import { DEFAULT_MODEL, QUOTA, askClaude, counted, failureReason, fixtureModeOn, kstDay, lookupRole, readJson, reject } from "./_claude.js"; // 공통 호출 (spec 025에서 옮김)

export { lookupRole }; // 시험이 api/ai.js에서 가져다 쓴다

/** 화면에 돌려주는 근거 표: 서버가 만든 줄(링크는 화면 안 주소만) */
const publicFacts = (facts) => ({
  asOf: facts.asOf, limits: facts.limits,
  rows: facts.rows.map((row) => ({ ...requestFacts({ asOf: facts.asOf, rows: [row], limits: [] }).rows[0], href: typeof row.href === "string" && row.href.startsWith("#/") ? row.href : null })),
});

/**
 * 로그인·본문·역할을 차례로 확인한다. 이슈·기준·일정 칸은 서버가 저장된 사실을 읽어 근거 표를 만들고(권한표 포함), 나머지는 화면의 근거 표를 검사한다.
 * 통과하면 { userId, role, body, shown }, 아니면 { status, reason }
 */
async function checkRequest(req, { verify, role, limits, data, now, state }) {
  if (req.method !== "POST") return reject(405, "POST만 받습니다");
  const userId = await verify(req);
  if (!userId) return reject(401, "로그인 필요");
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return error.tooLarge ? reject(413, "보내는 글이 너무 깁니다.") : reject(400, "요청을 읽지 못했습니다.");
  }
  const kind = body?.kind;
  const assist = ASSIST_KINDS.includes(kind);
  if (kind === "ask") {
    const own = await role(req, userId);
    if (!isStaff(own)) return reject(403, "열람자는 업무 찾아보기를 쓸 수 없습니다.");
    if (state.inflight.has(userId)) return reject(409, "이미 조회하는 중입니다.");
    if (body.pick === undefined && !cleanQuestion(body.question)) return reject(400, "질문을 120자 안으로 적어 주세요."); // 한도를 쓰기 전에 거른다
    return { userId, role: own, body };
  }
  if (!assist && !AI_KINDS.includes(kind)) return reject(400, "요청 모양이 맞지 않습니다.");
  if (!assist) {
    const invalid = validateFacts(body.facts, { maxRows: limits.maxRows, maxBytes: limits.maxFactsBytes });
    if (invalid) return reject(invalid.includes("너무 깁니다") ? 413 : 400, invalid);
  }
  const own = await role(req, userId); // 못 읽은 역할도 막는다(닫힌 쪽으로)
  if (!(assist ? canUseAssist : canUseAi)(own, kind)) return reject(403, "이 AI 요약은 해당 역할만 쓸 수 있습니다.");
  if (!assist) return { userId, role: own, body };
  if (state.inflight.has(userId)) return reject(409, "이미 AI 요약을 만드는 중입니다."); // 저장소를 읽기 전에 막는다(요청이 겹쳐 읽기만 쌓이지 않게)
  const resolved = await resolveAssist(kind, req, { userId, role: own, body, data, now: now() });
  if (resolved.status) return reject(resolved.status, resolved.reason);
  const invalid = validateFacts(requestFacts(resolved.facts), ASSIST_LIMITS[kind]);
  if (invalid) return reject(invalid.includes("너무 깁니다") ? 413 : 400, invalid);
  return { userId, role: own, body: { ...body, facts: resolved.facts }, shown: publicFacts(resolved.facts) };
}

/** 키·동시 호출·하루 한도를 확인한다. 통과하면 { key, fixture, charged }, 아니면 { status, reason } */
function reserve(userId, body, { env, state, limits, now }) {
  const fixture = fixtureModeOn(env);
  const fixtureCase = FIXTURE_CASES.includes(body.fixtureCase) ? body.fixtureCase : "normal";
  const key = fixture ? (fixtureCase === "nokey" ? "" : "fixture") : env.ANTHROPIC_API_KEY?.trim();
  if (!key) return reject(503, "AI 요약을 쓸 수 없습니다(키 없음)");
  if (state.inflight.has(userId)) return reject(409, "이미 AI 요약을 만드는 중입니다."); // 중복 클릭·재시도로 비용이 겹치지 않게
  if (!fixture) {
    const quota = takeQuota(state, userId, kstDay(now()), limits);
    if (!quota.ok) return reject(429, quota.scope === "user" ? "오늘 AI 사용 한도에 도달했습니다." : "이 서버의 오늘 AI 호출 한도에 도달했습니다."); // 서버 메모리 기준이라 "팀 전체"라고 쓰지 않는다
  }
  return { key, fixture, fixtureCase, charged: !fixture };
}

/**
 * Claude(또는 시험 응답)를 불러 읽고 검증한다. 성공이면 { review, usage }, 아니면 { status, reason, refund }.
 * refund: Claude에 닿지 못한 호출(연결·시간 초과·HTTP 오류)만 한도에서 돌려준다. 응답을 받은 뒤의 실패(거절·잘림·형식 오류)는 토큰이 청구됐을 수 있어 돌려주지 않는다
 * (shortcut: 시간 초과는 서버가 이미 처리했을 수 있으나 알 수 없어 돌려준다)
 */
async function generate(body, { key, fixture, fixtureCase }, { env, fetchImpl, limits }) {
  let result;
  const assist = ASSIST_KINDS.includes(body.kind);
  try {
    result = fixture ? fixtureResponse(fixtureCase, body.facts, body.kind) : await askClaude({
      key, model: env.AI_MODEL || DEFAULT_MODEL, prompt: assist ? buildAssistPrompt(body.kind, body.facts) : buildPrompt(body.kind, body.facts),
      limits: assist ? { ...limits, maxTokens: ASSIST_LIMITS[body.kind].maxTokens } : limits, fetchImpl });
  } catch (error) {
    return { ...reject(502, error?.name === "TimeoutError" ? "AI 응답 시간 초과" : "AI에 연결하지 못했습니다."), refund: true }; // 오류 문구는 밖으로 내보내지 않는다
  }
  const reason = failureReason(result);
  const answer = reason ? null : assist ? parseAssistAnswer(body.kind, result.text) : parseAiAnswer(result.text);
  if (!answer) return { ...reject(502, reason ?? "AI 응답을 읽지 못했습니다."), refund: Boolean(result.status) };
  return { review: assist ? reviewAssistAnswer(body.kind, answer, body.facts) : reviewAnswer(answer, body.facts), usage: { input: counted(result.usage?.input_tokens), output: counted(result.usage?.output_tokens) } };
}

/** 업무 찾아보기에서 질문을 해석시킨다 (Claude는 해석만 한다: 조회 종류와 허용 필터). 닿지 못한 호출만 환불 표시 */
async function interpretQuestion(question, role, { reserved, env, fetchImpl, limits }) {
  let result;
  try {
    result = reserved.fixture ? fixtureAskResponse(question, reserved.fixtureCase) : await askClaude({
      key: reserved.key, model: env.AI_MODEL || DEFAULT_MODEL, prompt: buildAskPrompt(question), limits: { ...limits, maxTokens: 1500 }, fetchImpl }); // 생각이 먼저 토큰을 쓰므로 짧은 JSON에도 넉넉히
  } catch (error) {
    return { ...reject(502, error?.name === "TimeoutError" ? "AI 응답 시간 초과" : "AI에 연결하지 못했습니다."), refund: true };
  }
  const reason = failureReason(result);
  let parsed = null;
  try {
    parsed = reason ? null : parseAskAnswer(result.text, role);
  } catch {
    parsed = null; // 모양이 이상한 해석은 읽지 못한 것으로 (서버가 죽지 않게)
  }
  return parsed ? { parsed } : { ...reject(502, reason ?? "질문을 이해하지 못했습니다. 아래 예시를 눌러 보세요."), refund: Boolean(result.status) };
}

/** @param {{ verify?: typeof verifyUser, role?: typeof lookupRole, data?: typeof defaultData, fetchImpl?: typeof fetch, env?: Record<string, string | undefined>, state?: typeof QUOTA, limits?: typeof AI_LIMITS, now?: () => Date }} [options] */
export function createAiHandler({ verify = verifyUser, role = lookupRole, data = defaultData, fetchImpl = fetch, env = process.env, state = QUOTA, limits = AI_LIMITS, now = () => new Date() } = {}) {
  state.inflight ??= new Set();
  return async function handler(req, res) {
    const checked = await checkRequest(req, { verify, role, limits, data, now, state });
    if (checked.status) return sendJson(res, checked.status, { ok: false, reason: checked.reason });
    const { userId, body, shown } = checked;
    const asking = body.kind === "ask";
    const freeText = asking && body.pick === undefined; // 예시·고른 조건은 AI를 부르지 않고 바로 조회한다
    const reserved = !asking || freeText ? reserve(userId, body, { env, state, limits, now }) : { fixture: true, charged: false };
    if (reserved.status) return sendJson(res, reserved.status, { ok: false, reason: reserved.reason, ...(shown ? { facts: shown } : {}) });
    if (asking && !freeText && state.inflight.has(userId)) return sendJson(res, 409, { ok: false, reason: "이미 조회하는 중입니다." });

    const started = Date.now();
    state.inflight.add(userId);
    try {
      if (asking) {
        const answer = await answerAsk({ req, userId, role: checked.role, body, data, now: now(), interpret: (question) => interpretQuestion(question, checked.role, { reserved, env, fetchImpl, limits }) });
        if (reserved.charged && answer.refund) refundQuota(state, userId);
        return sendJson(res, answer.status, answer.json);
      }
      const done = await generate(body, reserved, { env, fetchImpl, limits });
      if (done.status) {
        if (reserved.charged && done.refund) refundQuota(state, userId);
        return sendJson(res, done.status, { ok: false, reason: done.reason, ...(shown ? { facts: shown } : {}) });
      }
      sendJson(res, 200, {
        ok: true, ...done.review, ...(shown ? { facts: shown } : {}), asOf: body.facts.asOf, model: reserved.fixture ? "시험 응답" : env.AI_MODEL || DEFAULT_MODEL, usage: done.usage,
        ...(reserved.fixture ? { fixture: true } : {}), ms: Date.now() - started,
      });
    } finally {
      state.inflight.delete(userId);
    }
  };
}

export default createAiHandler();
