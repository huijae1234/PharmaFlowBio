// AI 도우미 (spec 025 FR-003~007·010). 화면 오른쪽 아래 창에서 받은 질문 하나에, 앱 안내서와 그 화면이 코드로 센 근거 표, 필요하면 미리 정한 앱 전체 조회 결과만 근거로 답한다.
// 읽기 전용이다: DB에는 읽으러만 가고 쓰지 않는다. 키는 환경변수에서만 읽고 응답·오류에 넣지 않는다. 대화는 저장하지 않는다.
import { sendJson, verifyUser } from "./_public-data.js";
import { DEFAULT_MODEL, QUOTA, askClaude, counted, failureReason, fixtureModeOn, kstDay, lookupRole, readJson, reject } from "./_claude.js";
import { CHAT_FIXTURE_CASES, chatFixtureResponse } from "./_chat-fixture.js";
import { makeScreenReader } from "./_chat-screen.js";
import { runQueries, withQueryRows } from "./_chat-query.js";
import { readQuery as readAppQuery } from "./_app-query.js";
import { queryTool } from "../src/domain/app-query-rules.js";
import { CHAT_LIMITS, buildChatPrompt, canUseChat, parseChatAnswer, refundChatQuota, reviewChatAnswer, takeChatQuota, takeExtraCall, validateChatRequest } from "../src/domain/chat-rules.js";
import { guideFor } from "../src/domain/app-guide.js";

const BODY_LIMIT = 24576; // 근거 표 12KB + 앞 대화 5개(각 1,800자 안팎)의 여유
const CHAT_QUOTA = { day: "", perUser: new Map(), total: 0, inflight: new Set() }; // shortcut: 서버 메모리 (chat-rules.js takeChatQuota)
const HOME_TITLES = { qa_manager: "관리자 대시보드", qc_analyst: "품질시험 홈", production_operator: "제조공정 홈" };
const screenTitle = (kind, role) => (kind === "home" ? HOME_TITLES[role] : kind === "lot" ? "로트 상세" : "");

/** 로그인·본문·질문·역할을 차례로 확인한다. 통과하면 { userId, body, role }, 아니면 { status, reason } */
async function checkRequest(req, { verify, role }) {
  if (req.method !== "POST") return reject(405, "POST만 받습니다");
  const userId = await verify(req);
  if (!userId) return reject(401, "로그인 필요");
  let body;
  try {
    body = await readJson(req, BODY_LIMIT);
  } catch (error) {
    return error.tooLarge ? reject(413, "보내는 글이 너무 깁니다.") : reject(400, "요청을 읽지 못했습니다.");
  }
  const invalid = validateChatRequest(body);
  if (invalid) return reject(invalid.includes("너무 깁니다") ? 413 : 400, invalid);
  const userRole = await role(req, userId);
  if (!canUseChat(userRole)) return reject(403, "AI 도우미는 QA 관리자·QC 시험 담당자·생산 담당자만 쓸 수 있습니다."); // 못 읽은 역할도 막는다
  return { userId, body, role: userRole };
}

/** 키·동시 호출·하루 한도. 통과하면 { key, fixture, fixtureCase, charged } */
function reserve(userId, body, { env, state, shared, limits, now }) {
  const fixture = fixtureModeOn(env);
  const fixtureCase = fixture && CHAT_FIXTURE_CASES.includes(body.fixtureCase) ? body.fixtureCase : "normal";
  const key = fixture ? (fixtureCase === "nokey" ? "" : "fixture") : env.ANTHROPIC_API_KEY?.trim();
  if (!key) return reject(503, "AI 도우미를 쓸 수 없습니다(키 없음).");
  if (state.inflight.has(userId)) return reject(409, "이미 답을 만드는 중입니다.");
  if (!fixture) {
    const quota = takeChatQuota(state, shared, userId, kstDay(now()), limits);
    if (!quota.ok) return reject(429, quota.scope === "user" ? "오늘 AI 도우미 사용 한도에 도달했습니다." : "이 서버의 오늘 AI 호출 한도에 도달했습니다.");
  }
  return { key, fixture, fixtureCase, charged: !fixture };
}

const AUTO = { type: "auto" };
const NO_TOOL = { type: "none" }; // 2번째 호출은 답만 (tools는 그대로 둬야 생각 블록이 이어진다)
const sumUsage = (a, b) => ({ input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0), output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0) });

/** Claude(또는 시험 응답)를 한 번 부른다 */
function callModel({ key, fixture, fixtureCase }, { env, fetchImpl, limits }, { prompt, tools, toolChoice, question, guide, facts }) {
  if (fixture) return chatFixtureResponse(fixtureCase, { question, guide, facts, toolChoice });
  return askClaude({ key, model: env.AI_MODEL || DEFAULT_MODEL, fetchImpl, limits, prompt, tools, toolChoice });
}

/**
 * Claude를 부르고, 조회를 고르면(FR-010) 서버가 다시 검사·실행한 뒤 한 번 더 불러 답을 받는다. 답은 화면 근거 표 + 조회 결과 줄로 검증한다.
 * 성공이면 { review, queries, usage }, 아니면 { status, reason, refund }
 */
async function generate({ body, role, userId }, reserved, context) {
  const guide = guideFor(role);
  const question = body.question.trim();
  const prompt = buildChatPrompt({ question, history: body.history ?? [], guide, facts: context.facts, screenTitle: screenTitle(body.screen?.kind, role), role });
  const tools = [queryTool(role)];
  const ask = (messages, toolChoice, facts) => callModel(reserved, context, { prompt: { ...prompt, messages }, tools, toolChoice, question, guide, facts });
  let facts = context.facts;
  let queries = [];
  let result;
  try {
    result = await ask(prompt.messages, AUTO, facts);
    if (result.stopReason === "tool_use" && result.toolUses?.length) {
      // Q103: 서버 전체 한도는 실제 호출 수로 센다. 사람 한도는 질문 1번으로 이미 셌다
      if (reserved.charged && !takeExtraCall(context.shared, context.limits)) return reject(429, "이 서버의 오늘 AI 호출 한도에 도달했습니다.");
      const now = context.now();
      const ran = await runQueries(result.toolUses, { req: context.req, role, userId, now, readQuery: context.readQuery });
      facts = withQueryRows(facts, ran.rows, now.toISOString());
      queries = ran.queries;
      const usage = result.usage;
      result = await ask([...prompt.messages, { role: "assistant", content: result.content }, { role: "user", content: ran.results }], NO_TOOL, facts);
      result = { ...result, usage: sumUsage(usage, result.usage) };
    }
  } catch (error) {
    return { ...reject(502, error?.name === "TimeoutError" ? "AI 응답 시간 초과" : "AI에 연결하지 못했습니다."), refund: true };
  }
  const reason = failureReason(result);
  const answer = reason ? null : parseChatAnswer(result.text);
  if (!answer) return { ...reject(502, reason ?? "답을 읽지 못했습니다."), refund: Boolean(result.status) };
  return { review: reviewChatAnswer(answer, { facts, guide }), queries, usage: { input: counted(result.usage?.input_tokens), output: counted(result.usage?.output_tokens) } };
}

/** @param {{ verify?: typeof verifyUser, role?: typeof lookupRole, readScreen?: ReturnType<typeof makeScreenReader>, readQuery?: typeof readAppQuery, fetchImpl?: typeof fetch, env?: Record<string, string | undefined>, state?: typeof CHAT_QUOTA, shared?: typeof QUOTA, limits?: typeof CHAT_LIMITS, now?: () => Date }} [options] */
export function createChatHandler({ verify = verifyUser, role = lookupRole, readScreen = makeScreenReader(), readQuery = readAppQuery, fetchImpl = fetch, env = process.env, state = CHAT_QUOTA, shared = QUOTA, limits = CHAT_LIMITS, now = () => new Date() } = {}) {
  return async function handler(req, res) {
    const checked = await checkRequest(req, { verify, role });
    if (checked.status) return sendJson(res, checked.status, { ok: false, reason: checked.reason });
    const { userId, body } = checked;
    const reserved = reserve(userId, body, { env, state, shared, limits, now });
    if (reserved.status) return sendJson(res, reserved.status, { ok: false, reason: reserved.reason });

    const started = Date.now();
    state.inflight.add(userId);
    try {
      // 근거 표는 서버가 로그인한 사람의 토큰으로 읽는다: 홈은 "오늘 내 일"(8단계), 로트는 로트 id로(9단계). 화면이 보낸 표는 쓰지 않는다
      const facts = body.screen ? await readScreen(req, body.screen, now().toISOString()) : null;
      const done = await generate(checked, reserved, { env, fetchImpl, limits, facts, req, shared, now, readQuery });
      if (done.status) {
        if (reserved.charged && done.refund) refundChatQuota(state, shared, userId);
        return sendJson(res, done.status, { ok: false, reason: done.reason });
      }
      sendJson(res, 200, {
        ok: true, ...done.review, queries: done.queries, screen: body.screen?.kind ?? null, model: reserved.fixture ? "시험 응답" : env.AI_MODEL || DEFAULT_MODEL,
        usage: done.usage, at: now().toISOString(), ms: Date.now() - started, ...(reserved.fixture ? { fixture: true } : {}),
      });
    } finally {
      state.inflight.delete(userId);
    }
  };
}

export default createChatHandler();
