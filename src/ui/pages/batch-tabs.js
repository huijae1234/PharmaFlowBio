// 배치 상세의 탭 4개: IA BT_010201_TB 공정 조건, BT_010202_TB 시험 결과, BT_010203_TB 품질 이슈, BT_010204_TB 업무 이력
import { h, badge, formatDateTime } from "../dom.js";
import { appliedRange, issueKindBadge, measurementLine } from "../issue-views.js";
import { resultLabel, ISSUE_STATUS_LABELS } from "../../domain/judgement-rules.js";
import { roleLabel } from "../../domain/roles.js";
import { issueSourceLabel } from "../../domain/action-rules.js";
import { listBatchHistory, listProcessRecords } from "../../infrastructure/store.js";
import { listBatchSamples } from "../../infrastructure/store-samples.js";
import { afterSave, sampleTable } from "./samples.js";
import { openSendModal } from "./sample-modals.js";
import { retainedQuantity, routesFor } from "../../domain/sample-rules.js";

const EQUIPMENT_LABELS = { normal: "정상", abnormal: "이상" };

function table(headers, rows) {
  return h("div", { class: "table-wrap" },
    h("table", { class: "table" },
      h("thead", null, h("tr", null, ...headers.map((title) => h("th", { scope: "col" }, title)))),
      h("tbody", null, ...rows)));
}

// FR-009: 시험 항목·측정값·판정 (재시험 결과 포함). 기준은 판정에 쓴 그때 규격·관리기준·버전 (spec 004 FR-003·004)
export function testsTab(measurements) {
  const rows = measurements.filter((m) => m.specification.category === "test");
  if (!rows.length) return h("p", { class: "muted" }, "아직 시험값이 없습니다.");
  return table(["시험 항목", "측정값", "기준", "판정", "입력", "시각"], rows.map((m) => h("tr", null,
    h("td", null, m.specification.item_name, m.action_request_id ? h("span", { class: "muted" }, " (재시험)") : null),
    h("td", { class: "mono" }, `${m.value}${m.specification.unit ?? ""}`),
    h("td", { class: "muted cell-wrap" }, appliedRange(m)),
    h("td", null, badge(m.result, resultLabel(m.result))),
    h("td", null, m.measurer?.display_name ?? ""),
    h("td", { class: "muted" }, formatDateTime(m.measured_at)))));
}

// FR-011 표시: 공정 기록마다 생산량·설비 상태·공정 조건 판정 (입력은 6단계)
export async function processTab(batchId, measurements) {
  const records = await listProcessRecords(batchId);
  if (!records.length) return h("p", { class: "muted" }, "아직 공정 조건 기록이 없습니다.");
  return h("div", { class: "stack" }, ...records.map((record) => {
    const items = measurements.filter((m) => m.process_record_id === record.id);
    return h("article", { class: "record" },
      h("p", { class: "record-head" },
        h("span", { class: "muted" }, `${formatDateTime(record.recorded_at)} · ${record.recorder?.display_name ?? ""}`), " ",
        "설비 상태 ", badge(record.equipment_status, EQUIPMENT_LABELS[record.equipment_status]),
        record.production_quantity === null ? null : ` · 생산량 ${record.production_quantity}`),
      items.length
        ? h("ul", { class: "plain-list" }, ...items.map((m) => h("li", null, measurementLine(m))))
        : null);
  }));
}

// 이 배치의 품질 이슈. 행에서 품질 이슈 상세로 간다 (IA QI_010100_PG)
// 홈 개편: 처리 중과 종결을 섞지 않는다. 처리 중이 위에 크게, 종결은 접어 둔다
function issueRows(list) {
  return table(["발생 구분", "종류", "상태", "연 시각"], list.map((issue) => h("tr", null,
    h("td", null, h("a", { href: `#/issues/${issue.id}` }, issueSourceLabel(issue.source))),
    h("td", null, issueKindBadge(issue)),
    h("td", null, badge(issue.status, ISSUE_STATUS_LABELS[issue.status])),
    h("td", { class: "muted" }, formatDateTime(issue.opened_at)))));
}

export function issuesTab(issues) {
  if (!issues.length) return h("p", { class: "empty-state" }, "아직 품질 이슈가 없습니다.");
  const open = issues.filter((issue) => issue.status === "open");
  const closed = issues.filter((issue) => issue.status !== "open");
  return h("div", { class: "stack" },
    open.length
      ? h("div", null, h("h3", { class: "group-title" }, `처리 중 ${open.length}건`), issueRows(open))
      : h("p", { class: "empty-state" }, "✓ 처리 중인 품질 이슈가 없습니다."),
    closed.length
      ? h("details", { class: "more" }, h("summary", null, `종결된 이슈 ${closed.length}건 보기`), issueRows(closed))
      : null);
}

// FR-013: 업무 이력 (최근순, 누가·언제·무엇을)
export async function historyTab(batchId) {
  const history = await listBatchHistory(batchId);
  if (!history.length) return h("p", { class: "muted" }, "아직 업무 이력이 없습니다.");
  return h("ol", { class: "plain-list history" }, ...history.map((item) => h("li", null,
    h("span", { class: "muted" }, formatDateTime(item.created_at)), " · ",
    h("strong", null, item.action), " · ",
    `${item.actor_name} (${roleLabel(item.actor_role)})`)));
}

// spec 008 FR-006: 이 로트의 검체 기록과 QA가 보관 중인 보존 검체 수 (IA BT_010209_TB)
export async function samplesTab(batch, role) {
  const transfers = await listBatchSamples(batch.id);
  const unit = transfers.find((t) => t.sample_kind === "retention")?.unit ?? "바이알";
  return h("div", { class: "stack" },
    h("div", { class: "page-header" },
      h("p", { class: "batch-meta" }, `QA 보관 중 보존 검체 ${retainedQuantity(transfers)} ${unit}`),
      routesFor(role).length
        ? h("button", { class: "button", type: "button", onclick: () => openSendModal({
            role, batches: [batch], transfers, fixedBatchId: batch.id, onSaved: afterSave,
          }) }, "검체 전달 등록")
        : null),
    sampleTable(role, transfers, "이 로트의 검체 기록이 없습니다.", { hideBatch: true }));
}
