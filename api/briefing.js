// 아침 브리핑 발송 (spec 026 FR-001·002·007~010). Vercel Cron이 평일 한국 08시대에 부른다(vercel.json crons).
// 순서: 비밀 값 확인 → 평일 확인 → 받는 사람마다(한 사람 실패가 다음을 막지 않게) 이미 보냈으면 건너뜀 → 항목 → 글 → AI 한두 줄(검증 통과 때만)
// → 슬랙 개인 메시지(공용 채널 대체 없음) → 알림 함에 한 줄. 기록에는 개수만 남기고 브리핑 내용·이메일·키는 남기지 않는다.
import { sendJson } from "./_public-data.js";
import { deliver } from "./_slack.js";
import { askClaude, DEFAULT_MODEL } from "./_claude.js";
import { serviceData } from "./_briefing-data.js";
import { fixtureData } from "./_briefing-fixture.js";
import { briefingFacts, briefingPrompt, briefingText, isWeekdayKst, kstDay, pickAiLines } from "../src/domain/briefing-rules.js";
import { parseAiAnswer } from "../src/domain/ai-brief-rules.js";
import { homePathFor } from "../src/domain/roles.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AI_LIMITS = { maxTokens: 1500, timeoutMs: 20000 };

function appOrigin(req, env) {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, "");
  const host = req.headers?.host ?? "localhost";
  const proto = req.headers?.["x-forwarded-proto"] ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** FR-007: 검증을 통과한 AI 한두 줄. 키가 없거나, 볼 숫자가 없거나, 실패·검증 걸림이면 [] (목록만 간다) */
async function aiLines(sections, { env, fetchImpl, now }) {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const facts = briefingFacts(sections, now.toISOString());
  if (!key || !facts.rows.some((row) => row.state === "ok" && row.value !== "0건")) return [];
  try {
    const result = await askClaude({ key, model: env.AI_MODEL || DEFAULT_MODEL, prompt: briefingPrompt(facts), limits: AI_LIMITS, fetchImpl });
    return result.text ? pickAiLines(parseAiAnswer(result.text), facts) : [];
  } catch {
    return [];
  }
}

/** 한 사람 보내기: 결과 "sent" | "failed" | "skipped" | 미리 보기 글 */
async function briefOne(person, ctx) {
  const { data, day, dry } = ctx;
  if (!dry && await data.alreadySent(person.id, day)) return { result: "skipped" };
  const items = await data.items(person.id);
  if (!items) return { result: "skipped" }; // 그사이 역할이 바뀐 사람
  const lines = await aiLines(items.sections, ctx);
  const text = briefingText({ role: items.role, day, origin: ctx.origin, sections: items.sections, aiLines: lines });
  if (dry) return { result: "preview", preview: { role: items.role, text } };
  const note = { recipient_name: person.display_name, recipient_email: person.email, body: text, path: homePathFor(items.role) };
  const delivered = await ctx.deliverImpl(note, { token: ctx.env.SLACK_BOT_TOKEN, channel: undefined, origin: ctx.origin, fetchImpl: ctx.fetchImpl });
  const status = delivered.status === "sent" ? "sent" : "failed";
  await data.record(person.id, day, status);
  return { result: status };
}

function pickData({ data, env, fetchImpl }) {
  if (data) return data;
  if (env.BRIEFING_MODE === "fixtures" && !env.VERCEL) return fixtureData(); // spec 019와 같이 Vercel에서는 꺼진다
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key ? serviceData({ key, fetchImpl }) : null;
}

/** @param {{ data?: object, deliverImpl?: typeof deliver, fetchImpl?: typeof fetch, env?: Record<string, string | undefined>, now?: () => Date, log?: (line: string) => void }} [options] */
export function createBriefingHandler({ data, deliverImpl = deliver, fetchImpl = fetch, env = process.env, now = () => new Date(), log = console.log } = {}) {
  return async function handler(req, res) {
    const secret = env.CRON_SECRET?.trim();
    if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return sendJson(res, 401, { ok: false, reason: "권한 없음" });
    const query = new URL(req.url, "http://local").searchParams;
    const dry = query.get("dry") === "1";
    const only = query.get("only");
    if (only !== null && !UUID.test(only)) return sendJson(res, 400, { ok: false, reason: "받는 사람 id가 맞지 않습니다." });
    const at = now();
    if (!dry && !only && !isWeekdayKst(at)) return sendJson(res, 200, { ok: true, skipped: "weekend" });
    const source = pickData({ data, env, fetchImpl });
    if (!source) return sendJson(res, 503, { ok: false, reason: "관리자 키가 없어 브리핑을 만들 수 없습니다." });

    const day = kstDay(at);
    const ctx = { data: source, day, dry, env, fetchImpl, deliverImpl, now: at, origin: appOrigin(req, env) };
    let people;
    try {
      people = (await source.recipients()).filter((person) => !only || person.id === only);
    } catch {
      log(`아침 브리핑 ${day} · 받는 사람을 읽지 못함`);
      return sendJson(res, 502, { ok: false, reason: "받는 사람을 읽지 못했습니다." }); // DB가 안 될 때 함수가 그냥 죽지 않고 이유를 남긴다
    }
    const tally = { sent: 0, failed: 0, skipped: 0 };
    const previews = [];
    for (const person of people) { // shortcut: 한 사람씩 차례로 보낸다. 직원이 수십 명이 되면 함수 실행 시간 한도를 넘을 수 있다
      try {
        const done = await briefOne(person, ctx);
        if (done.preview) previews.push(done.preview);
        else tally[done.result] += 1;
      } catch {
        tally.failed += 1;
        if (!dry) await source.record(person.id, day, "failed").catch(() => {}); // 알림 함에 "보내지 못했습니다" 안내
      }
    }
    if (dry) return sendJson(res, 200, { ok: true, day, previews });
    log(`아침 브리핑 ${day} · 보냄 ${tally.sent} · 못 보냄 ${tally.failed} · 건너뜀 ${tally.skipped}`);
    return sendJson(res, 200, { ok: true, day, sent: tally.sent, failed: tally.failed, skippedPeople: tally.skipped });
  };
}

export default createBriefingHandler();
