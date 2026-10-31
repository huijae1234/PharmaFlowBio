// 역할별 첫 화면 (FR-005, spec 001). 홈 개편: 왼쪽 넓은 칸에 "지금 할 일" 하나, 오른쪽에 현황. 데이터 읽기는 예전과 같다 (spec 002 FR-010, FR-012, spec 005 FR-008)
import { h, badge, formatDateTime } from "../dom.js";
import { holdCard, homeLayout, kpiInline, lotList, recallCard, recentList, taskCard } from "../home-widgets.js";
import { deviationRankCard, statusDonut, weeklyIssueCard } from "../home-charts.js";
import { deviationRanking, weeklyIssueCounts } from "../../domain/home-chart-rules.js";
import { issueKpis, releaseWaiting, weekStart } from "../../domain/dashboard-rules.js";
import { approvalTasks, assignedTasks, orderTasks, oldestFirst, releaseTasks, returnedTasks, reviewTasks, stepTasks } from "../../domain/home-task-rules.js";
import { resultLabel } from "../../domain/judgement-rules.js";
import { ordersToStart } from "../../domain/work-order-rules.js";
import { countBatchesByStatus, listBatches, listRecentOutOfSpec } from "../../infrastructure/store.js";
import { listBatchRequests, listPendingRequests } from "../../infrastructure/store-actions.js";
import { DEVIATION_FETCH_LIMIT, countOutOfSpecSince, listDeviationMeasurements, listIssueTimes, listMyAssigned, listMyRejected } from "../../infrastructure/store-dashboard.js";
import { listIssueReviews, listMyReturnedReviews, listPendingReviews } from "../../infrastructure/store-reviews.js";
import { listWorkOrders } from "../../infrastructure/store-work-orders.js";
import { listRunningSteps } from "../../infrastructure/store-process-steps.js";
import { setScreenFacts } from "../assistant-context.js";


// 읽기 성공과 실패를 구분한다: 실패한 자료를 빈 목록(0건)으로 바꾸지 않는다 (AI 근거 표가 "못 읽음"으로 적는다)
// cap: 조회 상한. 상한만큼 받았으면 그 너머는 모르므로 truncated로 알린다 (AI 근거 표가 "읽음"으로 두지 않게)
const readOrFail = (promise, cap = Infinity) => promise.then((rows) => ({ ok: true, rows, truncated: rows.length >= cap }), () => ({ ok: false, rows: [], truncated: false }));

function myWork(profile) {
  return Promise.all([listMyAssigned(profile.id), listMyRejected(profile.id), listMyReturnedReviews(profile.id)]);
}

// 최근 이탈 한 줄: 판정 배지 · 로트번호 · 항목과 값 · 시각
function outLine(row) {
  return [
    badge(row.result, resultLabel(row.result)), " ",
    h("a", { class: "mono", href: `#/batches/${row.batch.id}` }, row.batch.batch_number),
    h("span", { class: "mini-text" }, `${row.specification.item_name} ${row.value}${row.specification.unit ?? ""}`),
    h("span", { class: "muted mini-when" }, formatDateTime(row.measured_at)),
  ];
}

// AI 도우미가 홈 3개에서 함께 볼 근거 표는 서버가 그 사람의 "오늘 내 일"(아침 브리핑과 같은 항목)을 읽어 만든다 (spec 025 v0.5 8단계 FR-004 수용 기준 6).
// 화면은 지금 홈이라는 것과 화면 이름만 알린다
const shareHome = (title) => setScreenFacts({ kind: "home", title });

// IA HM_010000_PG 관리자 대시보드: 승인(조치 요청·평가) → 보완 필요 → 내부 출하 검토 순으로 한 목록
export async function renderHomeQa({ profile }) {
  shareHome("관리자 대시보드");
  const [pending, reviews, [, rejected, returned], testing, held, issues, counts, weeklyOutOfSpec, deviationRead] = await Promise.all([
    listPendingRequests(),
    listPendingReviews(), // spec 005 FR-008
    myWork(profile),
    listBatches({ statuses: ["in_testing"] }),
    listBatches({ statuses: ["on_hold"] }),
    listIssueTimes(),
    countBatchesByStatus(),
    countOutOfSpecSince(weekStart(new Date()).toISOString()),
    readOrFail(listDeviationMeasurements(), DEVIATION_FETCH_LIMIT), // 도식용 보조 자료: 못 읽으면 순위 칸만 비어 보인다
  ]);
  // 보류 로트 담당 표시용: 보류 로트의 열린 이슈에 걸린 조치 요청·평가 (못 읽으면 담당 줄만 빠진다)
  const heldIds = new Set(held.map((batch) => batch.id));
  const holdIssueIds = issues.filter((issue) => issue.status === "open" && heldIds.has(issue.batch_id)).map((issue) => issue.id);
  const [holdRequests, holdReviews] = await Promise.all([listBatchRequests(holdIssueIds).catch(() => []), listIssueReviews(holdIssueIds).catch(() => [])]);
  const deviations = deviationRead.rows;
  const { openCount, averageDays } = issueKpis(issues);
  const tasks = [
    ...oldestFirst([...approvalTasks(pending), ...reviewTasks(reviews)]),
    ...returnedTasks(rejected, returned), // QA 관리자도 평가를 쓸 수 있어 자기 것이 되돌아오면 보인다 (spec 005 FR-008 수용 기준 2)
    ...releaseTasks(releaseWaiting(testing, issues)),
  ];
  return homeLayout({
    title: "관리자 대시보드",
    kpis: kpiInline([
      ["처리 중 품질 이슈", `${openCount}건`, "#/issues?status=open"],
      ["이번 주 규격 이탈", `${weeklyOutOfSpec}건`, "#/issues?kind=spec"],
      ["평균 처리", averageDays === null ? "-" : `${averageDays.toFixed(1)}일`],
    ]),
    left: [taskCard(tasks)], // "오늘 먼저 볼 것"(spec 026 아침 브리핑으로)과 업무 찾아보기(사용자 결정: 만들지 않음)는 홈에 두지 않는다
    right: [
      holdCard(held, issues, holdRequests, holdReviews), // 오래된 순(기본)·최신 순, 제품으로 거르기
      recallCard(),
    ],
    // 도식 한 줄 (이미 있는 자료로만): 로트 상태 도넛 · 주별 이슈 · 이탈이 많은 항목
    below: [statusDonut(counts), weeklyIssueCard(weeklyIssueCounts(issues)), deviationRankCard(deviationRanking(deviations))],
  });
}

// IA HM_020000_PG 품질시험 홈
export async function renderHomeQc({ profile }) {
  shareHome("품질시험 홈");
  const [[assigned, rejected, returned], waiting, recent] = await Promise.all([
    myWork(profile),
    listBatches({ statuses: ["in_production", "in_testing"] }),
    listRecentOutOfSpec("test"),
  ]);
  return homeLayout({
    title: "품질시험 홈",
    left: [taskCard([...assignedTasks(assigned), ...returnedTasks(rejected, returned)])],
    right: [
      lotList("시험값을 기다리는 로트", waiting, "아직 시험값을 기다리는 로트가 없습니다.", "#/batches?status=in_testing"),
      recentList("최근 이탈 (시험)", recent, "아직 시험 이탈이 없습니다.", outLine),
    ],
  });
}

// IA HM_030000_PG 제조공정 홈: 착수할 작업지시(spec 010 FR-006)와 진행 중 공정 단계(spec 011 FR-007)도 할 일에 들어간다
export async function renderHomeProduction({ profile }) {
  shareHome("제조공정 홈");
  const [[assigned, rejected, returned], producing, recent, orders, running] = await Promise.all([
    myWork(profile),
    listBatches({ statuses: ["in_production"] }),
    listRecentOutOfSpec("process"),
    listWorkOrders(),
    listRunningSteps(),
  ]);
  const tasks = [
    ...orderTasks(ordersToStart(orders)),
    ...stepTasks(running),
    ...assignedTasks(assigned),
    ...returnedTasks(rejected, returned),
  ];
  return homeLayout({
    title: "제조공정 홈",
    left: [taskCard(tasks)],
    right: [
      lotList("생산 중 로트", producing, "아직 생산 중 로트가 없습니다.", "#/batches?status=in_production"),
      recentList("최근 이탈 (공정)", recent, "아직 공정 이탈이 없습니다.", outLine),
    ],
  });
}
