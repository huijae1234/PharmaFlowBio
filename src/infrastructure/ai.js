// 화면 → api/ai 호출 (spec 022 FR-001). 키는 서버에만 있고 여기서는 로그인 토큰만 붙인다.
// 실패는 던지지 않고 { ok:false }로 돌려줘 그 칸만 안내하게 한다 (AI가 실패해도 업무 화면은 그대로).
// 같은 근거 표의 결과는 이 기기에만 잠시 보관한다 (FR-003 수용 기준 5, 6시간 지나면 다시 쓰지 않는다)
import { client } from "./store.js";
import { logUsage } from "./store-products.js";
import { requestFacts } from "../domain/ai-facts-rules.js";
import { isFresh, isUsableAiResult } from "../domain/ai-brief-rules.js";

// 이 종류들은 근거 표를 화면이 보내지 않는다: 서버가 대상 ID와 로그인한 사용자로 저장된 사실을 직접 읽어 만든다 (spec 023 v0.2·024)
const SERVER_BUILT = new Set(["issue_prep", "review_check", "after_action", "spec_impact", "schedule_check", "ask"]);

/**
 * @param {"home" | "lot" | "regulatory" | "issue_prep" | "review_check" | "after_action" | "spec_impact" | "schedule_check" | "ask"} kind
 * @param {{ asOf: string, rows: object[], limits: string[] } | null} facts 홈·로트·규제 칸만 보낸다(화면 주소 href는 빼고). 나머지 칸은 null
 * @param {string | null} [fixtureCase] 로컬 시험 모드에서만 서버가 읽는다
 * @param {{ target?: object, input?: object, question?: string, pick?: object }} [request] 서버가 읽을 대상 ID와 사용자가 직접 고르거나 쓴 값
 */
export async function callAi(kind, facts, fixtureCase = null, request = {}) {
  const { data } = await client.auth.getSession().catch(() => ({ data: {} }));
  const session = data?.session;
  const result = await requestAi(kind, facts, fixtureCase, session?.access_token, request);
  logUsage(session?.user?.id ?? null, "public_api_call", { apiName: "ai", success: result.ok, durationMs: result.ms }); // 내용은 남기지 않는다 (spec Q6)
  return result;
}

async function requestAi(kind, facts, fixtureCase, token, request) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if (!token) return { ok: false, reason: "로그인 필요", ms: elapsed() };
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...(SERVER_BUILT.has(kind) ? request : { facts: requestFacts(facts) }), ...(fixtureCase ? { fixtureCase } : {}) }),
    });
    const body = await response.json().catch(() => ({ ok: false, reason: "응답을 읽지 못함" }));
    return { ...body, ok: response.ok && body.ok === true, ms: elapsed() };
  } catch {
    return { ok: false, reason: "연결 실패", ms: elapsed() };
  }
}

/**
 * AI 도우미 질문 하나 (spec 025). 실패는 던지지 않고 { ok:false, reason }으로 돌려준다. 질문 내용은 사용 기록에 남기지 않는다
 * @param {{ question: string, history: { q: string, a: string }[], screen: { kind: string, batchId?: string | null } | null, fixtureCase?: string | null }} input
 */
export async function callChat({ question, history, screen, fixtureCase = null }) {
  const started = performance.now();
  const { data } = await client.auth.getSession().catch(() => ({ data: {} }));
  const session = data?.session;
  const ms = () => Math.round(performance.now() - started);
  let result;
  if (!session?.access_token) result = { ok: false, reason: "로그인이 필요합니다." };
  else {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, screen: screen ? { kind: screen.kind, ...(screen.batchId ? { batchId: screen.batchId } : {}) } : null, ...(fixtureCase ? { fixtureCase } : {}) }), // 근거 표는 서버가 읽는다 (spec 025 8·9단계)
      });
      const body = await response.json().catch(() => ({ ok: false, reason: "답을 읽지 못했습니다." }));
      result = { ...body, ok: response.ok && body.ok === true };
    } catch {
      result = { ok: false, reason: "연결하지 못했습니다." };
    }
  }
  logUsage(session?.user?.id ?? null, "public_api_call", { apiName: "chat", success: result.ok, durationMs: ms() });
  return result;
}

const PREFIX = "pharmaflow.ai.";
let cacheUser = null; // 보관 결과는 사람별로 나눈다: 같은 브라우저를 다른 사람이 쓸 때 이전 사람의 요약이 보이지 않게 (app.js가 로그인한 사람을 알려 준다)
export const setAiUser = (userId) => { cacheUser = userId ?? null; };
const cacheKey = (key) => `${PREFIX}${cacheUser}.${key}`;

/** @returns {{ result: object, savedAt: string } | null} 6시간이 지났거나 읽을 수 없거나 그릴 수 없는 모양이면 null */
export function readAiCache(key, now = new Date()) {
  if (!cacheUser) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey(key)) ?? "null");
    return saved && isFresh(saved.savedAt, now) && isUsableAiResult(saved.result) ? saved : null;
  } catch {
    return null; // 저장소가 막힌 브라우저
  }
}

export function saveAiCache(key, result, savedAt = new Date()) {
  if (!cacheUser) return;
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify({ result, savedAt: savedAt.toISOString() }));
  } catch {
    // 못 저장해도 화면은 그대로
  }
}

/** 이슈마다 마지막으로 만든 결과의 근거 열쇠: 근거가 바뀌어 이전 결과가 오래됐는지 알리는 데 쓴다 (spec 023) */
export function noteAiScope(scope, key, at = new Date()) {
  if (!cacheUser) return;
  try {
    localStorage.setItem(`${PREFIX}${cacheUser}.last.${scope}`, JSON.stringify({ key, savedAt: at.toISOString() }));
  } catch {
    // 못 저장해도 화면은 그대로
  }
}

/** @returns {{ key: string, savedAt: string } | null} */
export function readAiScope(scope) {
  if (!cacheUser) return null;
  try {
    return JSON.parse(localStorage.getItem(`${PREFIX}${cacheUser}.last.${scope}`) ?? "null");
  } catch {
    return null;
  }
}

/** 로그아웃할 때: 이 기기에 보관한 AI 요약을 모두 지운다 */
export function clearAiCache() {
  try {
    for (const name of Object.keys(localStorage)) if (name.startsWith(PREFIX)) localStorage.removeItem(name);
  } catch {
    // 저장소가 막힌 브라우저
  }
}
