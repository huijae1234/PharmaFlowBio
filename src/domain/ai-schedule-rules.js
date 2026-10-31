// 생산 일정에 영향을 주는 미완료 업무 확인 (spec 024 FR-002). 순수 함수.
// 코드가 날짜(계획일)·보류·미완료 업무를 센다. 소요시간·설비·인력 자료가 없어 완료일·지연일 예측과 일정 배정은 하지 않는다.
// 공개 규제 정보(GMP 등)는 여기서 다시 계산하지 않는다: 제품 상세 "규제" 탭의 기존 확인 목록으로 가는 링크만 둔다(같은 경고 카드를 만들지 않음).
import { cleanText, fact } from "./ai-facts-rules.js";
import { WORK_ORDER_STATUS_LABELS } from "./work-order-rules.js";

export const SCHEDULE_LIMITS = { orderCap: 500, rows: 8, soonDays: 7 };
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE = ["draft", "released", "in_progress"];

/** 한국 시간 기준 날짜(YYYY-MM-DD). 계획일은 날짜라 시각이 아니라 날짜끼리 비교한다 */
export const kstDate = (now) => new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const dayNumber = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** 날짜 상태: 종료일이 오늘보다 앞이면 지남, 시작일이 오늘 이전인데 아직 착수 전이면 착수 지연, 7일 안에 시작하면 임박 */
export function dateState(order, today) {
  const end = dayNumber(order.planned_end) - dayNumber(today);
  const start = dayNumber(order.planned_start) - dayNumber(today);
  if (end < 0) return { code: "overdue", days: -end };
  if (order.status !== "in_progress" && start < 0) return { code: "start_passed", days: -start };
  if (order.status !== "in_progress" && start <= SCHEDULE_LIMITS.soonDays) return { code: "starts_soon", days: start };
  return { code: end === 0 ? "due_today" : "on_plan", days: end };
}

/** 이슈 하나가 막고 있는 다음 행동과 맡을 역할. 평가→조치 순으로 가장 먼저 막힌 곳 */
export function nextStep(issue, review, requests) {
  if (!review) return { text: "품질 영향 평가서 작성", role: "작성자(QC·생산·QA)", roles: ["qc_analyst", "production_operator", "qa_manager"] };
  if (review.status === "submitted") return { text: "품질 영향 평가 검토", role: "QA", roles: ["qa_manager"] };
  if (review.status === "rejected" || review.status === "revision_requested") return { text: "평가서 보완·다시 제출", role: "평가서를 쓴 사람", roles: ["qc_analyst", "production_operator", "qa_manager"] };
  const mine = requests.filter((request) => request.quality_issue_id === issue.id);
  if (mine.some((request) => request.status === "pending_approval")) return { text: "조치 요청 승인", role: "QA", roles: ["qa_manager"] };
  if (mine.some((request) => request.status === "approved")) return { text: "조치 결과 입력", role: "배정된 담당자", roles: ["qc_analyst", "production_operator", "qa_manager"] };
  if (mine.some((request) => request.status === "rejected")) return { text: "조치 요청 다시 제출", role: "요청한 사람", roles: ["qc_analyst", "production_operator", "qa_manager"] };
  return { text: "이슈 종결", role: "담당자·QA", roles: ["qa_manager", "qc_analyst", "production_operator"] };
}

const dateText = (state) => ({
  overdue: `계획 종료일이 ${state.days}일 지났습니다`,
  start_passed: `계획 시작일이 ${state.days}일 지났는데 아직 착수 전입니다`,
  starts_soon: state.days === 0 ? "오늘이 계획 시작일입니다" : `계획 시작일이 ${state.days}일 뒤입니다`,
  due_today: "오늘이 계획 종료일입니다",
  on_plan: "계획 기간 안입니다",
}[state.code]);

/** 작업지시 하나의 신호: 날짜 상태 · 착수 전 준비 · 로트 보류 · 열린 이슈의 다음 행동 */
function inspect(order, { today, issues, reviews, requests, steps, role }) {
  const state = dateState(order, today);
  const lotIssues = order.batch_id ? issues.filter((issue) => issue.batch_id === order.batch_id) : [];
  const stages = lotIssues.map((issue) => ({ issue, step: nextStep(issue, reviews.find((entry) => entry.quality_issue_id === issue.id) ?? null, requests) }));
  const prep = order.status === "draft" ? { text: "작업지시 발행", role: "QA", roles: ["qa_manager"] } : order.status === "released" ? { text: "작업지시 착수(로트 만들기)", role: "생산 담당자", roles: ["production_operator", "qa_manager"] } : null;
  const hold = order.batch?.status === "on_hold";
  const running = steps.find((step) => step.batch_id === order.batch_id);
  const delayed = ["overdue", "start_passed"].includes(state.code) || (state.code === "starts_soon" && prep);
  const flagged = delayed || hold || stages.length > 0;
  const actions = [...(prep && state.code !== "on_plan" ? [prep] : []), ...stages.map((entry) => entry.step)];
  return { order, state, stages, hold, running, flagged, actions, mine: actions.some((action) => action.roles.includes(role)) };
}

const severity = (info) => (info.state.code === "overdue" ? 3 : info.state.code === "start_passed" ? 2 : info.hold ? 2 : 1);

/**
 * @param {{ orders: object[], issues: object[], reviews: object[], requests: object[], steps: object[], today: string, role: string,
 *   read: { orders: { ok: boolean, truncated?: boolean }, tasks: { ok: boolean } } }} input
 */
export function scheduleCheck({ orders, issues, reviews, requests, steps, today, role, read }) {
  if (!read.orders.ok) return { status: "failed", reason: "작업지시를 읽지 못했습니다" };
  if (read.orders.truncated) return { status: "failed", reason: `조회 상한(${SCHEDULE_LIMITS.orderCap}건)에 닿아 일부만 읽었습니다` };
  const active = orders.filter((order) => ACTIVE.includes(order.status));
  if (!active.length) return { status: "no_orders", today, tasksOk: read.tasks.ok };
  const infos = active.map((order) => inspect(order, { today, issues, reviews, requests, steps, role }));
  const flagged = infos.filter((info) => info.flagged).sort((a, b) => Number(b.mine) - Number(a.mine) || severity(b) - severity(a) || a.order.planned_end.localeCompare(b.order.planned_end));
  return { status: flagged.length ? "flagged" : "clear", today, role, checked: active.length, flagged, tasksOk: read.tasks.ok };
}

export const canSummarizeSchedule = (result) => result.status === "flagged";

/** 코드가 쓰는 한 줄 */
export function scheduleHeadline(result) {
  if (result.status === "failed") return `${result.reason}. 일정 확인을 하지 않았고, 문제가 없다는 뜻이 아닙니다.`;
  if (result.status === "no_orders") return "진행 전·진행 중인 작업지시가 없어 확인할 것이 없습니다.";
  const gap = result.tasksOk ? "" : " 이슈·평가·조치 상태를 읽지 못해 보류 이유는 확인하지 못했습니다(알 수 없음).";
  if (result.status === "clear") return `작업지시 ${result.checked}건에서 계획일·보류·미완료 업무로 일정에 영향을 줄 신호를 찾지 못했습니다.${gap} 일정이 문제없다는 뜻은 아닙니다.`;
  return `작업지시 ${result.checked}건 중 ${result.flagged.length}건에서 일정에 영향을 줄 수 있는 신호가 있습니다.${gap}`;
}

const orderLink = (info) => (info.stages[0] ? `#/issues/${info.stages[0].issue.id}` : info.order.batch ? `#/batches/${info.order.batch.id}` : `#/work-orders?q=${encodeURIComponent(info.order.order_number)}`);

/** 근거 표: 날짜 계산·보류·미완료 업무는 모두 코드가 센 값. 예측은 넣지 않는다 */
export function scheduleFacts(result, now = new Date()) {
  const rows = result.flagged.slice(0, SCHEDULE_LIMITS.rows).map((info, index) => {
    const { order } = info;
    const parts = [
      `${cleanText(order.product?.item_name, 60) || "제품 미상"} · ${WORK_ORDER_STATUS_LABELS[order.status] ?? order.status} · 계획 ${order.planned_start}~${order.planned_end}`,
      dateText(info.state),
      order.batch ? `로트 ${order.batch.batch_number}${info.hold ? "(보류)" : ""}` : "로트 없음(착수 전)",
      info.running ? `진행 공정 ${cleanText(info.running.step_label, 40)}` : null,
      info.stages.length ? `열린 이슈 ${info.stages.length}건` : null,
      ...info.actions.slice(0, 3).map((action) => `다음 행동: ${action.text}(${action.role})`),
    ].filter(Boolean);
    return fact(`wo_${index + 1}`, `${info.mine ? "[내 차례] " : ""}작업지시 ${order.order_number}`, parts.join(" · "), { href: orderLink(info), must: info.state.code === "overdue" });
  });
  return {
    asOf: now.toISOString(),
    rows: [
      fact("today", "기준 날짜(한국 시간)", result.today),
      fact("checked", "확인한 작업지시(초안·발행·진행 중)", `${result.checked}건`),
      fact("flagged", "일정에 영향을 줄 수 있는 신호가 있는 작업지시", `${result.flagged.length}건 (아래 ${rows.length}건을 보냄)`),
      ...(result.tasksOk ? [] : [fact("tasks", "이슈·평가·조치 상태", "읽지 못했습니다(보류 이유를 알 수 없음)", { state: "failed", must: true })]),
      ...rows,
    ],
    limits: [
      "소요시간·설비·인력 자료가 없어 완료일·지연일 예측과 일정 배정은 하지 않습니다. 계획일은 사람이 정한 값입니다.",
      "공개 규제 정보(GMP 유효기간 등)는 여기서 다시 계산하지 않습니다. 제품 상세의 '규제' 탭 확인 목록을 보세요.",
      "계획일·담당자 변경과 알림은 자동으로 하지 않습니다.",
      "역할이 맞는 다음 행동은 [내 차례]로 먼저 보입니다. 기존 권한·상태 규칙이 그대로 적용됩니다.",
    ],
  };
}

