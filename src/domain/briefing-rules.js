// 아침 브리핑 글 만들기 (spec 026 FR-001·003~007). 순수 함수: DB·슬랙·AI를 부르지 않는다.
// 항목(개수·앞 3건·경로)은 DB 함수가 사람마다 그 역할 범위로 계산해 넘긴다(2단계). 여기서는 직무별 절만 골라 슬랙 글로 쓴다.
// 이 글은 오늘 볼 곳을 알려 줄 뿐 지시·판정하지 않는다. 다른 사람 이름·연락처는 쓰지 않는다.
import { roleLabel } from "./roles.js";
import { SYSTEM_RULES, reviewAnswer } from "./ai-brief-rules.js";
import { factsToText } from "./ai-facts-rules.js";

const KST_MS = 9 * 3600 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const TOP = 3;
const MAX_AI_LINES = 2;

/** 직무별 절 (사용자 표 ①②③⑤⑥, spec FR-003~005). counts는 ⑥ 개수 한 줄 */
export const ROLE_SECTIONS = {
  qa_manager: ["qa_waiting_issues", "qa_submitted_reviews", "qa_done_actions", "qa_schedule", "counts"],
  qc_analyst: ["test_issues", "my_reviews", "my_test_actions", "counts"],
  production_operator: ["process_issues", "my_reviews", "my_process_actions", "my_turn", "counts"],
};

export const SECTION_LABELS = {
  qa_waiting_issues: "평가서 검토·조치 승인을 기다리는 이슈",
  qa_submitted_reviews: "검토할 제출된 평가서",
  qa_done_actions: "어제 완료된 조치",
  qa_schedule: "작업 일정",
  test_issues: "처리 중인 시험 이슈",
  process_issues: "처리 중인 공정 이슈",
  my_reviews: "내가 작성·수정할 평가서",
  my_test_actions: "내가 담당한 시험 이슈의 조치",
  my_process_actions: "내가 담당한 공정 이슈의 조치",
  my_turn: "내 차례 작업",
  counts: "오늘 숫자",
};

export const COUNT_LABELS = { held_lots: "보류 로트", pending_reviews: "평가 검토 대기", my_actions: "나에게 배정된 미완료 조치", overdue_orders: "계획 종료일이 지난 작업지시" };
const FAILED = "읽지 못했습니다(앱에서 확인)";

const kst = (now) => new Date(now.getTime() + KST_MS);

/** @param {Date} now */
export function isWeekdayKst(now) {
  const day = kst(now).getUTCDay();
  return day >= 1 && day <= 5;
}

/** @param {Date} now @returns {string} 한국 날짜 YYYY-MM-DD */
export const kstDay = (now) => kst(now).toISOString().slice(0, 10);

/** 슬랙 글에서 뜻이 있는 글자(&·<·>)를 바꾼다: 제품 이름 등에 섞여도 링크가 끊기지 않게 (1단계 리뷰 2) */
export const slackEscape = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (origin, path, text) => (typeof path === "string" && path.startsWith("#/") ? `<${origin}/${path}|${slackEscape(text)}>` : slackEscape(text));

function dayTitle(day) {
  const date = new Date(`${day}T00:00:00Z`);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${WEEKDAYS[date.getUTCDay()]})`;
}

function countsLine(section) {
  if (section.state === "failed") return `• ${SECTION_LABELS.counts}: ${FAILED}`;
  const parts = (section.parts ?? []).map((part) => `${COUNT_LABELS[part.key] ?? part.key} ${Number.isFinite(part.count) ? part.count : "읽지 못함"}`);
  return parts.length ? `• ${SECTION_LABELS.counts}: ${parts.join(" · ")}` : null;
}

function listLines(section, origin) {
  const label = SECTION_LABELS[section.key];
  if (section.state === "failed") return [`• ${label}: ${FAILED}`];
  const top = (section.top ?? []).slice(0, TOP);
  const more = section.count - top.length;
  return [
    `• ${label} ${section.count}건`,
    ...top.map((row) => `   – ${link(origin, row.path, row.text)}`),
    ...(more > 0 && top.length ? [`   외 ${more}건`] : []),
  ];
}

const isEmpty = (section) => section.state !== "failed" && (section.key === "counts"
  ? (section.parts ?? []).every((part) => part.count === 0)
  : section.count === 0);

/**
 * 슬랙 개인 메시지 글 (FR-003~007). 그 직무의 절만 쓰고, 받은 자료에 다른 직무 절이 있어도 버린다
 * @param {{ role: string, day: string, origin: string, sections: { key: string, state: string, count: number, top?: { text: string, path: string | null }[], parts?: { key: string, count: number | null }[] }[], aiLines?: string[] }} input
 */
export function briefingText({ role, day, origin, sections, aiLines = [] }) {
  const keys = ROLE_SECTIONS[role] ?? [];
  const mine = keys.map((key) => sections.find((section) => section.key === key)).filter(Boolean);
  const head = `*아침 브리핑 · ${dayTitle(day)} · ${roleLabel(role)}*`;
  const ai = aiLines.length ? [`먼저 볼 것 (AI 참고 의견): ${slackEscape(aiLines.join(" "))}`] : [];
  const body = mine.every(isEmpty)
    ? ["오늘 확인할 항목이 없습니다. 이상이 없다는 보증은 아닙니다."]
    : mine.flatMap((section) => (section.key === "counts" ? [countsLine(section)].filter(Boolean) : listLines(section, origin)));
  return [head, ...ai, ...body].join("\n"); // 홈 링크는 보낼 때 슬랙 함수(_slack.js slackText)가 붙인다 (1단계 리뷰 1)
}

/** AI 한두 줄의 근거 표 (spec 022 모양). 개수 한 줄(counts)은 넣지 않는다 */
export function briefingFacts(sections, asOf) {
  const rows = sections.filter((section) => section.key !== "counts" && SECTION_LABELS[section.key]).map((section) => ({
    id: section.key, label: SECTION_LABELS[section.key],
    value: section.state === "failed" ? "읽지 못함" : `${section.count}건`,
    state: section.state === "failed" ? "failed" : "ok",
  }));
  return { asOf, rows, limits: ["숫자는 보낸 시각 기준입니다.", "원인과 처리 결과는 이 숫자로 알 수 없습니다."] };
}

/** FR-007: spec 022 검증을 모든 문장이 통과할 때만 앞 2문장. 하나라도 걸리면 AI 줄은 붙이지 않는다(목록만) */
export function pickAiLines(answer, facts) {
  if (!answer?.claims?.length) return [];
  const review = reviewAnswer(answer, facts);
  return review.verified ? review.claims.slice(0, MAX_AI_LINES).map((claim) => claim.text) : [];
}

/** FR-007: AI 한두 줄 프롬프트. spec 022 공통 규칙(근거 줄만·숫자 대조·판정 금지)에 브리핑 규칙만 더한다 */
export function briefingPrompt(facts) {
  return {
    system: `${SYSTEM_RULES}
- 반드시 JSON 한 개만 출력하세요: {"claims": [{"text": "문장", "refs": ["id"]}], "unknowns": []}.
- claims는 오늘 아침 먼저 볼 것 2개 이내입니다. 한 문장에 하나씩, 근거 숫자를 그대로 쓰세요.`,
    user: `근거 표:
${factsToText(facts)}`,
  };
}
