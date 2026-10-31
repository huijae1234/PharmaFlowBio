// 홈 도식용 계산 (UI 개편): 주별 품질 이슈 발생·종결, 이탈이 많은 시험 항목. 이미 읽은 자료로만 계산하고 새 자료를 만들지 않는다
import { weekStart } from "./dashboard-rules.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 최근 weeks주(월요일 시작)의 새로 열린 이슈 수와 종결된 이슈 수. 오래된 주부터
 * @param {{ opened_at: string, closed_at: string | null }[]} issues
 * @param {Date} [now]
 * @param {number} [weeks]
 * @returns {{ label: string, start: Date, opened: number, closed: number }[]}
 */
export function weeklyIssueCounts(issues, now = new Date(), weeks = 6) {
  const thisWeek = weekStart(now).getTime();
  return Array.from({ length: weeks }, (_, index) => {
    const start = new Date(thisWeek - (weeks - 1 - index) * WEEK_MS);
    const from = start.getTime();
    const inWeek = (iso) => {
      const time = Date.parse(iso ?? "");
      return Number.isFinite(time) && time >= from && time < from + WEEK_MS;
    };
    return {
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      start,
      opened: issues.filter((issue) => inWeek(issue.opened_at)).length,
      closed: issues.filter((issue) => inWeek(issue.closed_at)).length,
    };
  });
}

/**
 * 이탈 기록이 많은 시험·공정 항목 순위 (규격 이탈과 관리기준 이탈을 나눠 센다)
 * @param {{ result: string, specification: { item_name: string } | null }[]} rows 이탈 측정값 (out_of_spec, out_of_alert)
 * @param {number} [limit]
 * @returns {{ item: string, spec: number, alert: number, total: number }[]} 많은 순, 같으면 이름순
 */
export function deviationRanking(rows, limit = 5) {
  const counts = new Map();
  for (const row of rows) {
    const item = row.specification?.item_name;
    if (!item || (row.result !== "out_of_spec" && row.result !== "out_of_alert")) continue;
    const entry = counts.get(item) ?? { item, spec: 0, alert: 0, total: 0 };
    if (row.result === "out_of_spec") entry.spec += 1;
    else entry.alert += 1;
    entry.total += 1;
    counts.set(item, entry);
  }
  return [...counts.values()].sort((a, b) => b.total - a.total || a.item.localeCompare(b.item, "ko")).slice(0, limit);
}
