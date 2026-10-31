// AI 칸의 기능 × 역할 × 대상 × 상태 권한표 (spec 023 v0.2 3절). 순수 함수: 화면(버튼을 보일지)과 서버(요청을 받을지)가 이 함수 하나를 쓴다.
// 서버는 DB에서 읽은 역할·이슈·평가·조치 기록으로 ctx를 만든다. 화면이 보낸 역할·작성자·담당자 값은 쓰지 않는다.
import { can } from "./roles.js";
import { isBatchEditable } from "./batch-rules.js";
import { canResubmit, canReview, canWriteReview } from "./review-rules.js";

export const POLICY_FEATURES = ["issue_prep", "review_check", "after_action", "spec_impact", "schedule_check", "ask"];
const STAFF = ["qa_manager", "qc_analyst", "production_operator"];

const deny = (reason) => ({ allowed: false, reason });
const allow = (mode) => ({ allowed: true, mode });

/** 열람자·역할 없음은 어떤 AI도 못 쓴다 (기존 업무 자료의 조회 권한은 그대로) */
export const isStaff = (role) => STAFF.includes(role);

function issuePrep({ profile, issue, batch, review, requests = [] }) {
  if (!issue) return deny("대상 이슈를 확인하지 못했습니다.");
  if (issue.status !== "open" || !isBatchEditable(batch?.status)) return deny("종결됐거나 수정할 수 없는 이슈에는 조사 준비를 쓸 수 없습니다.");
  if (!can(profile.role, "request_action")) return deny("조치 요청을 만들 수 없는 역할은 조사 준비를 쓸 수 없습니다.");
  if (profile.role === "qc_analyst" && issue.source !== "test") return deny("QC는 시험 이슈의 조사 준비만 쓸 수 있습니다.");
  if (profile.role === "production_operator" && issue.source !== "process") return deny("생산 담당자는 공정 이슈의 조사 준비만 쓸 수 있습니다.");
  const waitingForQa = review?.status === "submitted" || requests.some((request) => request.status === "pending_approval");
  if (profile.role === "qa_manager" && !waitingForQa) return deny("QA는 검토·승인을 기다리는 평가서나 조치 요청이 있는 이슈에서만 조사 지원을 쓸 수 있습니다.");
  return allow("investigate");
}

function reviewCheck({ profile, issue, batch, review, source }) {
  if (!issue) return deny("대상 이슈를 확인하지 못했습니다.");
  const state = { issue, review, batch, profile };
  if (source === "draft") return canWriteReview(state) || canResubmit(state) ? allow("author") : deny("지금 작성하거나 고칠 수 있는 평가서가 아니어서 작성 지원을 쓸 수 없습니다.");
  if (source === "saved") return canReview(state) ? allow("review") : deny("QA가 검토할 수 있는 제출된 평가서에서만 쓸 수 있습니다.");
  return deny("점검 대상 종류가 올바르지 않습니다.");
}

function afterAction({ profile, issue, request }) {
  if (!issue || !request || request.status !== "completed" || request.quality_issue_id !== issue.id) return deny("완료된 조치 요청이 없어 조치 이후 확인을 쓸 수 없습니다.");
  if (profile.role === "qa_manager") return allow("overview");
  const mine = request.assignee_id === profile.id;
  if (profile.role === "qc_analyst") return mine && issue.source === "test" ? allow("assigned") : deny("QC는 본인이 담당한 시험 이슈의 조치만 조치 이후 확인을 쓸 수 있습니다.");
  if (profile.role === "production_operator") return mine && issue.source === "process" ? allow("assigned") : deny("생산 담당자는 본인이 담당한 공정 이슈의 조치만 조치 이후 확인을 쓸 수 있습니다.");
  return deny("이 역할은 조치 이후 확인을 쓸 수 없습니다.");
}

const RULES = {
  issue_prep: issuePrep,
  review_check: reviewCheck,
  after_action: afterAction,
  spec_impact: ({ profile }) => (profile.role === "qa_manager" ? allow("qa") : deny("기준 변경 영향 설명은 QA 관리자만 쓸 수 있습니다.")),
  schedule_check: ({ profile }) => (["qa_manager", "production_operator"].includes(profile.role) ? allow(profile.role) : deny("일정 확인은 생산 담당자와 QA 관리자만 쓸 수 있습니다.")),
  ask: () => allow("ask"),
};

/**
 * @param {typeof POLICY_FEATURES[number]} feature
 * @param {{ profile: { id: string, role: string }, issue?: { id?: string, status: string, source: string }, batch?: { status: string } | null,
 *   review?: { status: string, requested_by: string } | null, requests?: { status: string }[],
 *   request?: { status: string, assignee_id: string | null, quality_issue_id: string }, source?: "draft" | "saved" }} ctx
 * @returns {{ allowed: true, mode: string } | { allowed: false, reason: string }}
 */
export function aiDecision(feature, ctx) {
  if (!ctx?.profile || !isStaff(ctx.profile.role)) return deny("열람자나 역할을 확인하지 못한 사용자는 AI를 쓸 수 없습니다.");
  const rule = RULES[feature];
  return rule ? rule(ctx) : deny("알 수 없는 AI 기능입니다.");
}
