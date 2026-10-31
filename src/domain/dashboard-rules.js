// 관리자 대시보드 KPI·출하 판정 대기, 전체 업무 이력 기간 (spec 002 FR-010, FR-013). 현재 시각은 인자로 받는다

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Q22 임시 처리: "이번 주"는 월요일 0시(브라우저 시간)부터
 * @param {Date} now
 */
export function weekStart(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/**
 * FR-010 수용 기준 3: 열린 이슈 수, 평균 처리 일수 = 닫힌 이슈의 (닫은 시각 − 연 시각) 평균, 소수 첫째 자리. 닫힌 이슈가 없으면 null
 * @param {{ status: string, opened_at: string, closed_at: string | null }[]} issues
 */
export function issueKpis(issues) {
  const openCount = issues.filter((issue) => issue.status === "open").length;
  const closed = issues.filter((issue) => issue.status === "closed" && issue.closed_at);
  if (!closed.length) return { openCount, averageDays: null };
  const totalDays = closed.reduce((sum, issue) => sum + (Date.parse(issue.closed_at) - Date.parse(issue.opened_at)) / DAY_MS, 0);
  return { openCount, averageDays: Math.round((totalDays / closed.length) * 10) / 10 };
}

/**
 * FR-010 수용 기준 2: 시험 중이고 열린 이슈가 없는 배치
 * @template {{ id: string, status: string }} T
 * @param {T[]} batches
 * @param {{ batch_id: string, status: string }[]} issues
 * @returns {T[]}
 */
export function releaseWaiting(batches, issues) {
  const withOpenIssue = new Set(issues.filter((issue) => issue.status === "open").map((issue) => issue.batch_id));
  return batches.filter((batch) => batch.status === "in_testing" && !withOpenIssue.has(batch.id));
}

function parseDay(text) {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * FR-013 수용 기준 2: 기간 거르기. 시작일 0시 이상, 끝일 다음 날 0시 미만 (ISO 문자열). 비운 쪽은 null
 * @param {string} fromText "2026-10-22" 또는 ""
 * @param {string} toText
 */
export function dayRange(fromText, toText) {
  const from = fromText ? parseDay(fromText) : null;
  const to = toText ? parseDay(toText) : null;
  if ((fromText && !from) || (toText && !to)) {
    return { ok: false, error: "날짜 형식이 맞지 않습니다. 2026-10-22처럼 골라 주세요." };
  }
  if (from && to && from > to) return { ok: false, error: "기간 시작일이 끝일보다 늦습니다. 날짜를 다시 골라 주세요." };
  if (to) to.setDate(to.getDate() + 1);
  return { ok: true, from: from ? from.toISOString() : null, to: to ? to.toISOString() : null };
}
