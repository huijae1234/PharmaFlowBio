// Claude를 부르는 서버 함수들(api/ai.js 브리핑, api/chat.js AI 도우미)이 함께 쓰는 부분. `_`로 시작해 Vercel이 함수로 만들지 않는다.
// spec 022 FR-001에서 만든 코드를 spec 025 1단계에서 동작 변화 없이 옮겼다. 키는 환경변수에서만 읽고 응답 본문·키는 밖으로 내보내지 않는다.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../src/config.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
// 2026-10-21 버전도 있지만 우리 요청은 그 버전에서 바뀐 항목(샘플링 값, 문서 블록)을 쓰지 않아 오래 써 온 버전을 유지한다
const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-haiku-5-5"; // 모델 ID·요금($0.10/$0.50 per MTok, 프롬프트 10만 토큰 이하)을 공식 문서로 확인함
const BODY_LIMIT = 49152; // 가장 큰 근거 표 한도(평가서 점검 28KB)의 여유. 이보다 큰 본문은 읽다가 멈춘다
export const QUOTA = { day: "", perUser: new Map(), total: 0, inflight: new Set() }; // shortcut: 서버 메모리, 서버가 여러 개면 부정확 (ai-brief-rules.js takeQuota). 서버 전체 하루 한도(total)는 브리핑과 AI 도우미가 함께 쓴다 (spec 025 Q91)

export const fixtureModeOn = (env) => env.AI_MODE === "fixtures" && !env.VERCEL; // spec 019와 같이 Vercel에서는 꺼진다
export const kstDay = (date) => new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export async function readJson(req, limit = BODY_LIMIT) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === "string" ? JSON.parse(req.body) : req.body; // Vercel이 풀어 준 본문
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("too large"), { tooLarge: true });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** 로그인한 사람의 역할을 DB에서 읽는다 (그 사람의 토큰으로, RLS가 본인 줄만 보여 준다). 못 읽으면 null → 막는다 */
export async function lookupRole(req, userId, { supabaseUrl = SUPABASE_URL, anonKey = SUPABASE_PUBLISHABLE_KEY, fetchImpl = fetch } = {}) {
  try {
    const url = new URL("/rest/v1/profile", supabaseUrl);
    url.search = new URLSearchParams({ id: `eq.${userId}`, select: "role" }).toString();
    const response = await fetchImpl(url, { headers: { apikey: anonKey, Authorization: req.headers.authorization }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const rows = JSON.parse(await response.text());
    return Array.isArray(rows) ? rows[0]?.role ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Claude 호출. 상태 코드만 돌려주고 응답 본문은 밖으로 내보내지 않는다.
 * tools를 주면 tool_choice와 함께 보내고(AI 도우미 조회, spec 025 FR-010), 응답 블록 전체(content)와 도구 호출(toolUses)도 돌려준다
 */
export async function askClaude({ key, model, prompt, limits, fetchImpl, tools, toolChoice }) {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    // Haiku 5.5는 생각이 기본으로 켜져 있고 max_tokens를 생각이 먼저 쓴다 → effort를 낮추고 생각 몫까지 넉넉히 준다 (공식 문서)
    body: JSON.stringify({
      model, max_tokens: limits.maxTokens, output_config: { effort: "low" }, system: prompt.system,
      messages: prompt.messages ?? [{ role: "user", content: prompt.user }], // AI 도우미는 앞 대화를 담은 messages를 보낸다 (spec 025)
      ...(tools ? { tools, tool_choice: toolChoice } : {}),
    }),
    signal: AbortSignal.timeout(limits.timeoutMs),
  });
  if (!response.ok) return { status: response.status };
  const data = JSON.parse(await response.text());
  const content = Array.isArray(data.content) ? data.content : [];
  return {
    text: content.find((block) => block.type === "text")?.text ?? null, // 위치가 아니라 type으로 읽는다(생각 블록이 앞에 올 수 있다)
    stopReason: data.stop_reason ?? null,
    usage: data.usage ?? null,
    content, // 2번째 호출에 생각 블록까지 그대로 돌려줘야 한다 (공식 문서: 도구 쓰기와 생각)
    toolUses: content.filter((block) => block.type === "tool_use"),
  };
}

export const counted = (value) => (Number.isFinite(value) ? value : null);
export const reject = (status, reason) => ({ status, reason });

export function failureReason(result) {
  if (result.status === 429 || result.status === 529) return "AI가 지금 바쁩니다. 잠시 뒤 다시 시도해 주세요.";
  if (result.status) return "AI에 연결하지 못했습니다.";
  if (result.stopReason === "refusal") return "AI가 이 요청을 처리하지 않았습니다.";
  if (result.stopReason === "max_tokens") return "AI 응답이 길어 중간에 끊겼습니다.";
  return result.text === null ? "AI 응답을 받지 못했습니다." : null;
}
