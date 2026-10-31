// AI 도우미 앱 전체 조회 결과 → 근거 줄 (spec 025 v0.6 FR-010, Q104). 순수 함수.
// 조회마다 요약 줄 하나(전체 건수·조건) + 앞 10줄. 못 읽으면 "못 읽음"(0이 아니다), 읽기 상한을 넘으면 "일부만 읽었습니다".
// 사람 이름은 읽지도 쓰지도 않는다(FR-006). 링크는 앱 안 주소(#/...)만.
import { actionTypeLabel } from "./action-rules.js";
import { askRows } from "./ai-ask-rules.js";
import { batchStatusLabel } from "./batch-rules.js";
import { issueKindLabel } from "./judgement-rules.js";
import { SAMPLE_KIND_LABELS, SAMPLE_STATUS_LABELS, TEAM_LABELS } from "./sample-rules.js";
import { APP_QUERIES, queryScope } from "./app-query-rules.js";

export const QUERY_TOP = 10;
const DAY_MS = 86400000;
const KST_MS = 9 * 3600 * 1000;
const NONE = "0건 (조건에 맞는 기록이 없습니다)";
const PARTIAL = "일부만 읽었습니다";
const RELEASE_ORDER = ["releasable", "shipped", "discarded"];

const age = (iso, now) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));
const monthDay = (iso) => {
  const kst = new Date(Date.parse(iso) + KST_MS);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
};
const kindLabel = (issue) => (issue.source === "process" ? "공정 이탈" : issueKindLabel(issue.kind));
const lot = (batch) => `로트 ${batch?.batch_number ?? "(번호 없음)"}`;
const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko");

/** 이름별로 세고 종류별로 나눈다: [{ name, count, parts: Map(종류 → 수) }], 많은 순 */
function tally(items, nameOf, partOf) {
  const groups = new Map();
  for (const item of items) {
    const name = nameOf(item);
    const group = groups.get(name) ?? { name, count: 0, parts: new Map() };
    group.count += 1;
    const part = partOf(item);
    group.parts.set(part, (group.parts.get(part) ?? 0) + 1);
    groups.set(name, group);
  }
  return [...groups.values()].sort(byCount);
}
const partsText = (group, order) => [...group.parts].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([part, count]) => `${part} ${count}건`).join(" · ");

// 조회마다: 요약 글과 줄(label 뒤 value, 링크). 목록형은 summary 없이 건수로 요약한다
const BUILDERS = {
  issues_by_product(data) {
    const groups = tally(data.rows, (issue) => issue.batch?.product?.item_name ?? "(제품 없음)", kindLabel);
    return { summary: `새 품질 이슈 ${data.rows.length}건 · 제품 ${groups.length}개`, items: groups.map((group) => ({ value: `${group.name}: ${group.count}건 (${partsText(group, ["규격 이탈", "관리기준 이탈", "공정 이탈"])})`, href: null })) };
  },
  deviations_by_item(data) {
    const where = (row) => `${row.specification?.item_name ?? "(항목 없음)"}(${row.specification?.category === "process" ? "공정" : "시험"})`;
    const groups = tally(data.rows, where, (row) => (row.result === "out_of_spec" ? "규격 이탈" : "관리기준 이탈"));
    return { summary: `이탈 측정값 ${data.rows.length}건 · 항목 ${groups.length}개`, items: groups.map((group) => ({ value: `${group.name}: ${group.count}건 (${partsText(group, ["규격 이탈", "관리기준 이탈"])})`, href: null })) };
  },
  out_of_spec_lots(data) {
    const lots = new Map();
    for (const row of data.rows) {
      const entry = lots.get(row.batch?.id) ?? { batch: row.batch, count: 0, names: new Map() };
      entry.count += 1;
      const item = row.specification?.item_name ?? "(항목 없음)";
      entry.names.set(item, (entry.names.get(item) ?? 0) + 1);
      lots.set(row.batch?.id, entry);
    }
    const sorted = [...lots.values()].sort((a, b) => b.count - a.count || String(a.batch?.batch_number).localeCompare(String(b.batch?.batch_number)));
    return {
      summary: `로트 ${sorted.length}개 · 규격 이탈 측정값 ${data.rows.length}건`,
      items: sorted.map((entry) => ({ value: `${lot(entry.batch)} · ${entry.batch?.product?.item_name ?? ""} · ${[...entry.names].map(([name, count]) => `${name} ${count}건`).join(", ")}`, href: entry.batch?.id ? `#/batches/${entry.batch.id}` : null })),
    };
  },
  old_open_issues(data, { params, now }) {
    const rows = data.rows.filter((issue) => age(issue.opened_at, now) >= params.days).sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)));
    return { items: rows.map((issue) => ({ value: `${lot(issue.batch)} · ${kindLabel(issue)} · ${age(issue.opened_at, now)}일째 처리 중`, href: `#/issues/${issue.id}` })) };
  },
  pending_requests(data, { params, now }) {
    const rows = data.rows.filter((request) => age(request.requested_at, now) >= params.days).sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
    return { items: rows.map((request) => ({ value: `${lot(request.issue?.batch)} · ${actionTypeLabel(request.action_type)} · 승인 대기 ${age(request.requested_at, now)}일째`, href: `#/issues/${request.quality_issue_id}` })) };
  },
  lot_status_counts(data) {
    const groups = tally(data.rows, (batch) => batchStatusLabel(batch.status), () => "");
    return { summary: `로트 ${data.rows.length}개`, items: groups.map((group) => ({ value: `${group.name} ${group.count}개`, href: null })) };
  },
  release_decisions(data) {
    const latest = new Map();
    for (const row of [...data.rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) if (!latest.has(row.batch_id)) latest.set(row.batch_id, row);
    const rows = [...latest.values()].filter((row) => RELEASE_ORDER.includes(row.status));
    const counts = RELEASE_ORDER.map((status) => [status, rows.filter((row) => row.status === status).length]).filter(([, count]) => count);
    return {
      summary: `${rows.length}건${counts.length ? ` · ${counts.map(([status, count]) => `${batchStatusLabel(status)} ${count}건`).join(" · ")}` : ""}`,
      items: rows.map((row) => ({ value: `로트 ${row.batch_number} · ${batchStatusLabel(row.status)} · ${monthDay(row.created_at)}`, href: row.batch_id ? `#/batches/${row.batch_id}` : null })),
    };
  },
  running_steps(data, { now }) {
    return { items: data.rows.map((run) => ({ value: `${lot(run.batch)} · ${run.step_label ?? "단계"} · ${age(run.started_at, now)}일째 진행 중`, href: run.batch?.id ? `#/batches/${run.batch.id}?tab=process` : null })) };
  },
  samples_to_check(data, { now }) {
    return {
      items: data.rows.map((sample) => {
        const since = sample.status === "return_pending" ? sample.return_requested_at : sample.sent_at;
        return { value: `${lot(sample.batch)} · ${TEAM_LABELS[sample.from_team]} → ${TEAM_LABELS[sample.to_team]} ${SAMPLE_KIND_LABELS[sample.sample_kind] ?? ""} ${sample.quantity}${sample.unit ?? ""} · ${SAMPLE_STATUS_LABELS[sample.status] ?? sample.status} ${age(since, now)}일째`, href: "#/samples" };
      }),
    };
  },
};

// 업무 찾아보기 4종(spec 024)은 그 규칙을 그대로 쓴다
const ASK_FILTERS = {
  held_lots: (params) => ({ olderThanDays: params.days }),
  pending_reviews: (params) => ({ olderThanDays: params.days }),
  my_actions: (params) => (params.actionType ? { actionType: params.actionType } : {}),
  overdue_orders: (params) => ({ overdueDays: params.days }),
};
for (const [kind, filters] of Object.entries(ASK_FILTERS)) {
  BUILDERS[kind] = (data, { params, now }) => ({ items: askRows(kind, data, { filters: filters(params), now }).map((row) => ({ value: `${row.label} · ${row.detail}`, href: row.href })) });
}

function countText(total, truncated) {
  if (!total) return truncated ? PARTIAL : NONE;
  const head = truncated ? `${total}건 이상` : `${total}건`;
  return [head, total > QUERY_TOP ? `앞 ${QUERY_TOP}건만` : null, truncated ? PARTIAL : null].filter(Boolean).join(" · ");
}

/**
 * @param {string} kind 검사를 거친 조회 이름
 * @param {{ rows: object[], issues?: object[], truncated: boolean } | null} data 서버가 읽은 자료, 못 읽었으면 null
 * @param {{ params: object, now: Date, prefix: string }} options prefix: 근거 줄 id 앞부분(q1·q2)
 */
export function queryFacts(kind, data, { params, now, prefix }) {
  const label = queryScope(kind, params);
  if (!data) return [{ id: prefix, label, value: "읽지 못했습니다(알 수 없음)", state: "failed", href: null }];
  const { summary, items } = BUILDERS[kind](data, { params, now });
  const head = summary
    ? (data.truncated ? `${summary} · ${PARTIAL}` : summary)
    : countText(items.length, data.truncated);
  const top = items.slice(0, QUERY_TOP).map((item, index) => ({ id: `${prefix}_${index + 1}`, label: `${APP_QUERIES[kind].label} ${index + 1}`, value: item.value, state: "ok", href: item.href }));
  return [{ id: prefix, label, value: head, state: "ok", href: null }, ...top];
}
