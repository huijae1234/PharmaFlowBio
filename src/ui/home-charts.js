// 홈 도식 (UI 개편): 로트 상태 도넛, 주별 품질 이슈, 이탈이 많은 항목. 모두 이미 있는 자료로만 그리고 새 자료를 만들지 않는다.
// 색만으로 읽지 않게 범례의 글자·숫자와 화면 읽기 프로그램용 설명을 붙인다. 계산은 domain/home-task-rules.js(상태)·home-chart-rules.js
import { h } from "./dom.js";
import { svg } from "./svg.js";
import { batchStatusLabel } from "../domain/batch-rules.js";
import { statusSegments } from "../domain/home-task-rules.js";

function card(title, ...children) {
  return h("section", { class: "panel card" }, h("h2", { class: "card-title" }, title), ...children);
}

/** 로트 상태 도넛: 가운데는 전체 로트 수. 범례를 누르면 그 상태의 로트 목록으로 간다 */
export function statusDonut(counts) {
  const segments = statusSegments(counts);
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  const text = segments.map((segment) => `${batchStatusLabel(segment.status)} ${segment.count}`).join(", ");
  let offset = 25; // 12시 방향에서 시작
  const arcs = segments.filter((segment) => segment.count).map((segment) => {
    const arc = svg("circle", {
      class: `donut-seg donut-seg--${segment.status}`, cx: 18, cy: 18, r: 15.9155, fill: "none", "stroke-width": 4,
      "stroke-dasharray": `${segment.percent} ${100 - segment.percent}`, "stroke-dashoffset": offset,
    });
    offset -= segment.percent;
    return arc;
  });
  return card("로트 상태",
    h("div", { class: "donut-wrap" },
      h("div", { class: "donut", role: "img", "aria-label": `전체 ${total}개: ${text}` },
        svg("svg", { viewBox: "0 0 36 36", "aria-hidden": "true" },
          svg("circle", { class: "donut-track", cx: 18, cy: 18, r: 15.9155, fill: "none", "stroke-width": 4 }), ...arcs),
        h("div", { class: "donut-center" }, h("strong", { class: "donut-total" }, String(total)), h("span", { class: "muted" }, "전체 로트"))),
      h("ul", { class: "legend legend--stack" }, ...segments.map((segment) => h("li", null,
        h("a", { href: `#/batches?status=${segment.status}` },
          h("span", { class: `swatch status-seg--${segment.status}`, "aria-hidden": "true" }),
          h("span", null, batchStatusLabel(segment.status)), " ", h("strong", { class: "mono" }, String(segment.count))))))));
}

/** 주별 품질 이슈: 새로 열린 것과 종결된 것 (최근 6주). 막대 위 숫자로도 읽힌다 */
export function weeklyIssueCard(weeks) {
  const max = Math.max(1, ...weeks.flatMap((week) => [week.opened, week.closed]));
  const barHeight = (count) => (count / max) * 60;
  const description = weeks.map((week) => `${week.label}주 열림 ${week.opened}, 종결 ${week.closed}`).join("; ");
  const groups = weeks.map((week, index) => {
    const x = 6 + index * 38;
    return svg("g", null,
      svg("rect", { class: "wk-open", x, y: 70 - barHeight(week.opened), width: 12, height: week.opened ? Math.max(barHeight(week.opened), 2) : 0, rx: 3 }),
      svg("rect", { class: "wk-close", x: x + 14, y: 70 - barHeight(week.closed), width: 12, height: week.closed ? Math.max(barHeight(week.closed), 2) : 0, rx: 3 }),
      week.opened ? svg("text", { x: x + 6, y: 66 - barHeight(week.opened), "text-anchor": "middle", class: "wk-num" }, week.opened) : null,
      week.closed ? svg("text", { x: x + 20, y: 66 - barHeight(week.closed), "text-anchor": "middle", class: "wk-num" }, week.closed) : null,
      svg("text", { x: x + 13, y: 84, "text-anchor": "middle", class: "wk-label" }, week.label));
  });
  return card("주별 품질 이슈",
    // 누르면 품질 이슈 목록으로 (도넛 범례가 로트 목록으로 가는 것과 같은 방식)
    h("a", { class: "wk-chart wk-link", href: "#/issues", title: "품질 이슈 목록으로", "aria-label": `품질 이슈 목록으로. ${description}` },
      svg("svg", { viewBox: "0 0 234 90", preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true" }, ...groups)),
    h("ul", { class: "legend legend--inline" },
      h("li", null, h("span", { class: "swatch swatch--open", "aria-hidden": "true" }), "새로 열림"),
      h("li", null, h("span", { class: "swatch swatch--close", "aria-hidden": "true" }), "종결"),
      h("li", { class: "muted" }, "주 시작: 월요일")));
}

/** 이탈이 많은 항목 순위 (규격 이탈 + 관리기준 이탈 기록 수) */
export function deviationRankCard(ranking) {
  const max = Math.max(1, ...ranking.map((row) => row.total));
  return card("이탈이 많은 항목",
    ranking.length
      ? h("ul", { class: "rank-list" }, ...ranking.map((row) => h("li", null,
          h("span", { class: "rank-name" }, row.item),
          h("span", { class: "rank-bar", role: "img", "aria-label": `규격 이탈 ${row.spec}, 관리기준 이탈 ${row.alert}` },
            row.spec ? h("span", { class: "rank-seg rank-seg--spec", style: `width:${(row.spec / max) * 100}%` }) : null,
            row.alert ? h("span", { class: "rank-seg rank-seg--alert", style: `width:${(row.alert / max) * 100}%` }) : null),
          h("strong", { class: "rank-num mono" }, String(row.total)))))
      : h("p", { class: "empty-state" }, "이탈 기록이 아직 없습니다."),
    ranking.length
      ? h("ul", { class: "legend legend--inline" },
          h("li", null, h("span", { class: "swatch swatch--spec", "aria-hidden": "true" }), "규격 이탈"),
          h("li", null, h("span", { class: "swatch swatch--alert", "aria-hidden": "true" }), "관리기준 이탈"))
      : null);
}
