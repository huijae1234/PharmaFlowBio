// AI 도우미 앱 전체 조회 (spec 025 v0.6 FR-010). 순수 함수: 화면·저장·네트워크를 부르지 않는다.
// AI는 아래 13가지 조회 가운데 이름과 정해진 조건(기간·조치 종류)만 고른다. 조회 글·주소·SQL은 만들 수 없고,
// 서버는 실행 전에 이 검사를 다시 거친다(역할은 서버가 DB에서 읽은 것). 결과를 근거 줄로 바꾸는 일은 app-query-facts.js.
import { actionTypeLabel } from "./action-rules.js";

const ALL = ["qa_manager", "qc_analyst", "production_operator"];
const QA = ["qa_manager"];
const QA_PRODUCTION = ["qa_manager", "production_operator"];
const ACTION_TYPES = ["retest", "equipment_check", "material_check", "batch_discard"];

// Q101: 기간은 기본 30일, 7~180일 안에서. 일수 조건은 조회마다 기본값이 다르다
const PERIOD = { kind: "period", fallback: 30, min: 7, max: 180 };
const waited = (fallback) => ({ kind: "waited", fallback, min: 0, max: 365 });

/** 조회 13가지 (spec 025 FR-010 표와 같은 순서). days: 기간·일수 조건, actionType: 조치 종류 조건 */
export const APP_QUERIES = {
  issues_by_product: { label: "제품별 품질 이슈", group: "문제 빈도", roles: ALL, days: PERIOD, about: "기간 안에 열린 품질 이슈 수를 제품별·종류별로, 많은 순" },
  deviations_by_item: { label: "항목별 이탈", group: "문제 빈도", roles: ALL, days: PERIOD, about: "기간 안의 이탈 측정값 수를 시험 항목·공정 조건별로, 많은 순" },
  out_of_spec_lots: { label: "규격 이탈 로트", group: "문제 빈도", roles: ALL, days: PERIOD, about: "기간 안에 규격 이탈이 난 로트와 항목" },
  old_open_issues: { label: "오래 열린 이슈", group: "처리 지연", roles: ALL, days: waited(7), about: "days일 넘게 처리 중인 품질 이슈, 오래된 순" },
  pending_reviews: { label: "평가 검토 대기", group: "처리 지연", roles: QA, days: waited(0), about: "제출됐는데 검토되지 않은 품질 영향 평가(days일 넘게 기다린 것)" },
  pending_requests: { label: "조치 요청 승인 대기", group: "처리 지연", roles: QA, days: waited(0), about: "승인되지 않은 조치 요청, 오래된 순(days일 넘게 기다린 것)" },
  my_actions: { label: "나에게 배정된 미완료 조치", group: "처리 지연", roles: ALL, actionType: true, about: "질문한 사람에게 배정됐고 결과 입력 전인 조치" },
  lot_status_counts: { label: "상태별 로트 수", group: "로트·출하", roles: ALL, about: "생산 중·시험 중·보류·출하 가능·출하 완료·폐기 로트 수" },
  held_lots: { label: "보류 로트", group: "로트·출하", roles: ALL, days: waited(0), about: "보류 로트와 사유(days일 넘게 열린 이슈가 있는 것)" },
  release_decisions: { label: "출하 검토 결과", group: "로트·출하", roles: ALL, days: PERIOD, about: "기간 안에 출하 가능·폐기·출하 완료가 된 로트" },
  overdue_orders: { label: "계획 종료일 지난 작업지시", group: "작업지시·검체", roles: QA_PRODUCTION, days: waited(1), about: "계획 종료일이 days일 이상 지났는데 끝나지 않은 작업지시" },
  running_steps: { label: "진행 중 공정 단계", group: "작업지시·검체", roles: QA_PRODUCTION, about: "지금 진행 중인 공정 단계와 로트" },
  samples_to_check: { label: "확인할 검체", group: "작업지시·검체", roles: ALL, about: "인수 대기·반납 대기 검체" },
};

const known = (kind) => typeof kind === "string" && Object.hasOwn(APP_QUERIES, kind); // "__proto__" 같은 이름은 조회가 아니다

/** @param {string} role @returns {string[]} 그 역할이 쓸 수 있는 조회 이름 */
export const queriesFor = (role) => Object.keys(APP_QUERIES).filter((kind) => APP_QUERIES[kind].roles.includes(role));

function daysParam(rule, value) {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : rule.fallback;
  return Math.min(rule.max, Math.max(rule.min, number));
}

/**
 * AI가 고른 조회를 다시 검사한다. 모르는 칸은 버리고, 범위 밖 기간은 가까운 끝으로 (Q101)
 * @param {string} role 서버가 DB에서 읽은 역할
 * @param {{ query?: unknown, days?: unknown, action_type?: unknown } | null} input
 * @returns {{ ok: true, kind: string, params: { days?: number, actionType?: string } } | { ok: false, reason: string }}
 */
export function checkQueryInput(role, input) {
  const kind = input?.query;
  if (!known(kind)) return { ok: false, reason: "조회 목록에 없는 조회입니다. 조회 목록 밖의 기록은 찾을 수 없습니다." };
  const query = APP_QUERIES[kind];
  if (!query.roles.includes(role)) {
    const who = query.roles.length === 1 ? "QA 관리자" : "QA 관리자·생산 담당자";
    return { ok: false, reason: `${query.label}는 ${who}가 보는 기록이라 이 역할로는 조회하지 않습니다.` };
  }
  const params = {};
  if (query.days) params.days = daysParam(query.days, input.days);
  if (query.actionType && ACTION_TYPES.includes(input.action_type)) params.actionType = input.action_type;
  return { ok: true, kind, params };
}

/** 답 아래 "조회:" 줄과 근거 줄 이름에 쓰는 조회 이름·조건 */
export function queryScope(kind, params) {
  const query = APP_QUERIES[kind];
  if (!query.days && !params.actionType) return query.label;
  if (params.actionType) return `${query.label} · 조치 종류 ${actionTypeLabel(params.actionType)}`;
  if (!query.days) return query.label;
  if (query.days.kind === "period") return `${query.label} · 최근 ${params.days}일`;
  if (kind === "overdue_orders") return `${query.label} · ${params.days}일 이상 지남`;
  if (kind === "old_open_issues") return `${query.label} · ${params.days}일 넘게 처리 중`;
  return params.days ? `${query.label} · ${params.days}일 넘게 기다림` : query.label;
}

/**
 * Claude에 줄 도구 하나. 그 역할이 쓸 수 있는 조회만 고를 수 있다
 * @param {string} role
 */
export function queryTool(role) {
  const kinds = queriesFor(role);
  return {
    name: "app_query",
    description: [
      "PharmaFlow 앱 전체 기록에서 미리 정한 조회를 실행합니다. 지금 화면의 근거 표나 안내서로 답할 수 없는 질문에만 쓰세요. 한 질문에 2개까지.",
      ...kinds.map((kind) => `- ${kind}: ${APP_QUERIES[kind].label} — ${APP_QUERIES[kind].about}`),
      "days: 기간(일) 또는 기다린 일수. 질문에 기간이 없으면 비워 두세요(\"최근\"은 30일). action_type: my_actions의 조치 종류.",
    ].join("\n"),
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", enum: kinds },
        days: { type: "integer", minimum: 0, maximum: 365 },
        action_type: { type: "string", enum: ACTION_TYPES },
      },
      required: ["query"],
    },
  };
}
