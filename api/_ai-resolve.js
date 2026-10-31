// 이슈·기준·일정 칸(spec 023·024)의 요청을 서버가 스스로 풀어 쓴다: 대상 ID와 로그인한 사용자로 저장된 사실을 읽고, 권한표(ai-policy-rules.js)로 허용을 정한 뒤 근거 표를 만든다.
// 화면이 보내는 것은 대상 ID와 사용자가 직접 고른·쓴 값(조치 종류, 작성 중인 평가서 글)뿐이다. 근거 표·역할·작성자·담당자는 받지 않는다.
import { UUID } from "./_ai-data.js";
import { aiDecision } from "../src/domain/ai-policy-rules.js";
import { actionTypesFor } from "../src/domain/action-rules.js";
import { issueFacts, splitMeasurements } from "../src/domain/ai-issue-facts-rules.js";
import { cleanReviewValues, reviewFacts } from "../src/domain/ai-review-check-rules.js";
import { canSummarize, compareAfterAction, followupFacts, followupHeadline } from "../src/domain/ai-followup-rules.js";
import { canExplain, specImpact, specImpactFacts, specImpactHeadline } from "../src/domain/ai-spec-impact-rules.js";
import { canSummarizeSchedule, kstDate, scheduleCheck, scheduleFacts, scheduleHeadline } from "../src/domain/ai-schedule-rules.js";
import { REVIEW_FIELDS } from "../src/domain/review-rules.js";

const fail = (status, reason) => ({ status, reason });
const UNREADABLE = fail(502, "대상 자료를 확인하지 못했습니다.");
const NOT_FOUND = fail(404, "대상을 찾을 수 없거나 볼 수 없습니다.");

/** 이슈 한 건 + 호출한 사람. 서버가 읽은 기록으로만 만든다 (화면이 보낸 역할·작성자는 쓰지 않는다) */
async function loadIssue(req, data, userId, role, target) {
  if (typeof target?.issueId !== "string" || !UUID.test(target.issueId)) return fail(400, "대상 이슈가 올바르지 않습니다.");
  let bundle;
  try {
    bundle = await data.issueBundle(req, target.issueId);
  } catch {
    return UNREADABLE;
  }
  if (!bundle) return NOT_FOUND;
  return { bundle, profile: { id: userId, role } };
}

const stateOf = ({ bundle, profile }, extra = {}) => ({ profile, issue: bundle.issue, batch: bundle.batch, review: bundle.review, requests: bundle.requests, ...extra });
const denied = (decision) => (decision.allowed ? null : fail(403, decision.reason));

async function issuePrep(req, ctx) {
  const loaded = await loadIssue(req, ctx.data, ctx.userId, ctx.role, ctx.body.target);
  if (loaded.status) return loaded;
  const refused = denied(aiDecision("issue_prep", stateOf(loaded)));
  if (refused) return refused;
  const { bundle } = loaded;
  const actionType = ctx.body.input?.actionType;
  if (!actionTypesFor(bundle.issue.source).includes(actionType)) return fail(400, "조치 종류가 올바르지 않습니다.");
  const parts = splitMeasurements(bundle.issue, bundle.measurements);
  return { facts: issueFacts({ issue: bundle.issue, ...parts, review: bundle.review, requests: bundle.requests, stepLabel: bundle.stepLabel, actionType, now: ctx.now }) };
}

async function reviewCheck(req, ctx) {
  const source = ctx.body.input?.source;
  const loaded = await loadIssue(req, ctx.data, ctx.userId, ctx.role, ctx.body.target);
  if (loaded.status) return loaded;
  const refused = denied(aiDecision("review_check", stateOf(loaded, { source })));
  if (refused) return refused;
  const { bundle } = loaded;
  // 작성 중인 글은 저장된 사실과 분리한 사용자 초안이다(그 글만 화면이 보낸다). 저장된 평가서는 서버가 읽은 것만 쓴다
  const values = source === "draft" ? cleanReviewValues(ctx.body.input?.values) : Object.fromEntries(REVIEW_FIELDS.map((spec) => [spec.key, bundle.review?.[spec.key] ?? ""]));
  if (!values) return fail(400, "작성 중인 글의 모양이 맞지 않습니다.");
  const parts = splitMeasurements(bundle.issue, bundle.measurements);
  return { facts: reviewFacts({ issue: bundle.issue, values, source, ...parts, requests: bundle.requests, now: ctx.now }) };
}

async function afterAction(req, ctx) {
  const requestId = ctx.body.target?.requestId;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return fail(400, "대상 조치 요청이 올바르지 않습니다.");
  const loaded = await loadIssue(req, ctx.data, ctx.userId, ctx.role, ctx.body.target);
  if (loaded.status) return loaded;
  const request = loaded.bundle.requests.find((entry) => entry.id === requestId);
  if (!request) return NOT_FOUND;
  const refused = denied(aiDecision("after_action", stateOf(loaded, { request })));
  if (refused) return refused;
  const { bundle } = loaded;
  const { baseline, read } = await ctx.data.followup(req, bundle.issue.id, bundle.measurements);
  const result = compareAfterAction({ baseline, action: { id: request.id, type: request.action_type, completedAt: request.completed_at, hasNote: Boolean(request.result_note) }, read, now: ctx.now });
  if (!canSummarize(result)) return fail(409, `비교가 끝나지 않아 AI 정리를 쓸 수 없습니다. ${followupHeadline(result).text}`);
  return { facts: followupFacts(result, ctx.now) };
}

async function specImpactRequest(req, ctx) {
  const refused = denied(aiDecision("spec_impact", { profile: { id: ctx.userId, role: ctx.role } }));
  if (refused) return refused;
  const specId = ctx.body.target?.specId;
  if (typeof specId !== "string" || !UUID.test(specId)) return fail(400, "대상 기준이 올바르지 않습니다.");
  let bundle;
  try {
    bundle = await ctx.data.specBundle(req, specId);
  } catch {
    return UNREADABLE;
  }
  if (!bundle) return NOT_FOUND;
  const result = specImpact({ spec: bundle.spec, measurements: bundle.measurements, read: bundle.read });
  if (!canExplain(result)) return fail(409, `비교가 끝나지 않아 AI 설명을 쓸 수 없습니다. ${specImpactHeadline(result)}`);
  return { facts: specImpactFacts(result, ctx.now) };
}

async function scheduleRequest(req, ctx) {
  const refused = denied(aiDecision("schedule_check", { profile: { id: ctx.userId, role: ctx.role } }));
  if (refused) return refused;
  let bundle;
  try {
    bundle = await ctx.data.scheduleBundle(req);
  } catch {
    return UNREADABLE;
  }
  const result = scheduleCheck({ ...bundle, today: kstDate(ctx.now), role: ctx.role });
  if (!canSummarizeSchedule(result)) return fail(409, `확인할 신호가 없어 AI 정리를 쓰지 않습니다. ${scheduleHeadline(result)}`);
  return { facts: scheduleFacts(result, ctx.now) };
}

const RESOLVERS = { issue_prep: issuePrep, review_check: reviewCheck, after_action: afterAction, spec_impact: specImpactRequest, schedule_check: scheduleRequest };

/**
 * @param {string} kind
 * @param {object} req
 * @param {{ userId: string, role: string, body: object, data: ReturnType<typeof import("./_ai-data.js").makeData>, now: Date }} ctx
 * @returns {Promise<{ facts: object } | { status: number, reason: string }>}
 */
export const resolveAssist = (kind, req, ctx) => RESOLVERS[kind](req, ctx);
