// IA BT_010200_PG 배치 상세. FR-008 수용 기준 4·5, FR-009, FR-013 (spec 001)
// 홈 개편: 위쪽은 batch-header.js (로트번호·상태·출하 검토 버튼 → 지금 할 일 → 숫자 3칸) → 입력 버튼 → 탭
import { h, put, refreshPage } from "../dom.js";
import { testsTab, processTab, issuesTab, historyTab, samplesTab } from "./batch-tabs.js";
import { batchHeader } from "./batch-header.js";
import { openProcessModal, openHoldModal, openTestValueModal } from "./batch-modals.js";
import { releasePanel } from "./release-panel.js";
import { openReleaseModal } from "./release-modal.js";
import { openShipModal } from "./ship-modal.js";
import { openSafely } from "../modal.js";
import { batchStatusLabel, isBatchEditable, measuredSpecificationIds } from "../../domain/batch-rules.js";
import { can } from "../../domain/roles.js";
import { lotReadiness } from "../../domain/release-readiness-rules.js";
import { listBatchSamples } from "../../infrastructure/store-samples.js";
import { getBatch, listBatchHistory, listMeasurements, listProcessRecords, listProductMeasurements, listQualityIssues, listSpecifications } from "../../infrastructure/store.js";
import { listBatchRequests } from "../../infrastructure/store-actions.js";
import { listIssueReviews } from "../../infrastructure/store-reviews.js";
import { batchSummary } from "../../domain/step-rules.js";
import { getWorkOrderForBatch } from "../../infrastructure/store-work-orders.js";
import { listProcessSteps, listStepRuns } from "../../infrastructure/store-process-steps.js";
import { processStepsTab } from "./process-steps.js";
import { countLotAcks } from "../../infrastructure/store-notifications.js";
import { canShip } from "../../domain/shipment-rules.js";
import { resultSummaryText } from "../../domain/test-entry-rules.js";
import { aiPanel } from "../ai-panel.js"; // spec 022: 출하 검토 요약
import { lotFacts } from "../../domain/ai-facts-rules.js";
import { setScreenFacts } from "../assistant-context.js";

// 시험 결과가 기본 탭이라 첫 번째에 둔다
const TABS = [
  { key: "tests", label: "시험 결과" },
  { key: "process", label: "공정 조건" },
  { key: "issues", label: "품질 이슈" },
  { key: "history", label: "업무 이력" },
  { key: "samples", label: "검체" }, // spec 008 FR-006, IA BT_010209_TB
];

// 저장 직후 한 번만 보여 줄 결과 문구
let pendingNotice = "";

/** @param {{ profile: { role: string }, id: string, query: Record<string, string> }} context */
export async function renderBatchDetail({ profile, id, query }) {
  const batch = await getBatch(id);
  if (!batch) {
    return h("section", { class: "panel" },
      h("h1", { class: "page-title" }, "로트를 찾을 수 없습니다"),
      h("p", { class: "muted" }, "로트 목록에서 다시 골라 주세요."),
      h("a", { href: "#/batches" }, "로트 목록으로"));
  }
  const [measurements, issues, testSpecs, history, workOrder, steps, runs] = await Promise.all([
    listMeasurements(batch.id), listQualityIssues(batch.id), listSpecifications(batch.product_id, "test"), listBatchHistory(batch.id),
    getWorkOrderForBatch(batch.id), listProcessSteps(batch.product_id), listStepRuns(batch.id),
  ]);
  const lotAcks = await countLotAcks(batch.batch_number).catch(() => ({ total: 0, acked: 0 })); // 보조 정보: 못 읽으면 줄을 숨긴다
  // 출하 판단 근거 패널용 보조 자료: 못 읽어도 화면은 그대로 (공정 기록·검체 수는 "확인하지 못했습니다", 비교 없음으로)
  const [processRecords, transfers, productMeasurements] = await Promise.all([
    listProcessRecords(batch.id).catch(() => null),
    listBatchSamples(batch.id).catch(() => null),
    listProductMeasurements(batch.product_id).catch(() => []),
  ]);
  const issueIds = issues.map((issue) => issue.id);
  const [requests, reviews] = await Promise.all([listBatchRequests(issueIds), listIssueReviews(issueIds)]);
  const overview = batchSummary({ issues, reviews, requests, batch });
  // spec 011 FR-003·008: 작업지시 로트이고 제품에 단계가 있으면 공정 단계(board), 아니면 예전 공정 조건.
  // 출하 판단 근거(시험 결과·이슈·공정·검체·기준 버전)는 AI 도우미 서버와 같은 계산 (spec 025 9단계)
  const { board, todos, checklist } = lotReadiness({ batch, measurements, issues, testSpecs, workOrder, steps, runs, processRecords, transfers, requests, reviews });
  const openIssues = todos.length;
  setScreenFacts({ kind: "lot", batchId: batch.id }); // AI 도우미: 근거 표는 서버가 이 로트 id로 읽는다 (spec 025 9단계)
  const tab = TABS.some((item) => item.key === query.tab) ? query.tab : "tests";
  const notice = pendingNotice;
  pendingNotice = "";

  const { toolbar, releaseButton } = actions(profile, batch, measurements, query, { openIssues, testSpecs, usesSteps: Boolean(board), checklist });
  const tabBody = h("div", { id: "batch-tab-panel" }, h("p", { class: "muted" }, "불러오는 중…"));
  const view = h("div", { class: "stack" },
    batchHeader({ batch, todos, overview, history, workOrder, board, lotAcks, releaseButton }),
    notice ? h("p", { class: "status-text", role: "status" }, notice) : null,
    // 시험 항목이 있는 제품의 로트이고 생산 중이 아니면 보인다. 시험 중·보류는 "판단 전", 출하 가능·출하 완료·폐기는 "판단 뒤 기록"
    batch.status !== "in_production" && testSpecs.length
      ? releasePanel({ batch, items: checklist, testSpecs, productMeasurements, decided: !isBatchEditable(batch.status) })
      : null,
    // spec 022 FR-004: 아직 판단 전인 로트만 (출하 완료·폐기된 로트는 숨김)
    batch.status !== "in_production" && isBatchEditable(batch.status) && testSpecs.length
      ? aiPanel({ kind: "lot", title: "출하 검토 요약", button: "AI로 출하 검토 요약", build: () => lotFacts({ batch, statusLabel: batchStatusLabel(batch.status), checklist, issues, requests, reviews }) })
      : null,
    toolbar,
    h("nav", { class: "tabs", "aria-label": "로트 상세 탭" }, ...TABS.map((item) => h("a", {
      class: "tab",
      href: `#/batches/${batch.id}?tab=${item.key}`,
      "aria-current": item.key === tab ? "page" : null,
    }, tabLabel(item, issues, board)))),
    h("section", { class: "panel" }, tabBody));

  put(tabBody, await tabContent(tab, { batch, measurements, issues, profile, board }));
  return view;
}

// 품질 이슈 탭은 처리 중인 건수를 눌러 보이게, 없으면 전체 건수
function tabLabel(item, issues, board) {
  if (item.key === "issues") {
    const open = issues.filter((issue) => issue.status === "open").length;
    return [item.label, h("span", { class: open ? "tab-count tab-count--open" : "tab-count" }, String(open || issues.length))];
  }
  return item.key === "process" && board ? "공정 단계" : item.label;
}

// 버튼은 하나만 강조한다: 출하 검토를 할 수 있으면 그것, 아니면 이 사람이 가장 먼저 쓸 입력 버튼
function actions(profile, batch, measurements, query, { openIssues, testSpecs, usesSteps, checklist }) {
  // spec 017 FR-005: 출하 가능 로트에서 생산 담당자만 출하 완료를 기록한다
  if (canShip(batch.status, profile.role)) {
    return {
      toolbar: h("div", { class: "toolbar" }, h("button", {
        class: "button button--primary",
        type: "button",
        onclick: openSafely(() => openShipModal({ batch, onDone: (notice) => goToTab(batch, "history", notice) })),
      }, "출하 완료")),
      releaseButton: null,
    };
  }
  // Q11: 출하 판정이 끝난 배치는 읽기만 (spec 017 FR-006: 출하 완료도)
  if (!isBatchEditable(batch.status)) {
    return { toolbar: h("p", { class: "muted" }, "내부 출하 검토가 끝난 로트라 입력할 수 없습니다."), releaseButton: null };
  }
  const releaseReady = openIssues === 0 && batch.status === "in_testing";
  const mayRelease = can(profile.role, "decide_release"); // FR-009 수용 기준 5: QA 관리자에게만
  const entries = [];
  // 시험값 입력은 아직 안 넣은 항목을 표로 한꺼번에. 다 넣었으면 눌러 보지 않아도 알 수 있게 버튼을 잠그고 이유를 보인다
  const remainingTests = testSpecs.filter((spec) => !measuredSpecificationIds(measurements).has(spec.id)).length;
  const testButtonDisabled = can(profile.role, "record_test") && testSpecs.length > 0 && remainingTests === 0;
  if (can(profile.role, "record_test")) {
    entries.push([testButtonDisabled ? "시험값 입력 (모두 입력됨)" : "시험값 입력", () => openTestValueModal({ batch, measurements, onSaved: (results, specs) => showSaved(batch, results, specs) }), testButtonDisabled]);
  }
  if (can(profile.role, "record_process") && !usesSteps) { // spec 011 FR-008: 단계 로트는 공정 단계 탭에서
    entries.push(["공정 조건 입력", () => openProcessModal({ batch, onSaved: (result) => showProcessSaved(batch, result) })]);
  }
  if (can(profile.role, "hold_batch")) {
    entries.push(["로트 보류", () => openHoldModal({ batch, onSaved: () => goToTab(batch, query.tab ?? "tests", "로트를 보류했습니다.") })]);
  }
  const emphasizeInput = !mayRelease || !releaseReady;
  const buttons = entries.map(([label, open, disabled], index) => h("button", {
    // 로트 보류는 로트 전체를 멈추는 동작이라 오른쪽 끝에 따로 두고 붉은 테두리로 구분한다
    class: label === "로트 보류" ? "button button--danger-ghost toolbar-end" : emphasizeInput && index === 0 && !disabled ? "button button--primary" : "button",
    type: "button",
    disabled: disabled ? true : null,
    title: disabled ? "이 로트의 시험 항목을 모두 입력했습니다. 다시 재려면 품질 이슈에서 재시험 조치를 요청하세요." : null,
    onclick: openSafely(open),
  }, label));
  const releaseButton = mayRelease ? h("button", {
    class: releaseReady ? "button button--primary" : "button",
    type: "button",
    onclick: openSafely(() => openReleaseModal({
      batch, openIssueCount: openIssues, testSpecs, measurements, checklist,
      onDone: (notice) => goToTab(batch, "history", notice),
    })),
  }, "내부 출하 검토") : null;
  return { toolbar: buttons.length ? h("div", { class: "toolbar" }, ...buttons) : null, releaseButton };
}

// 저장 결과 문구: 규격 이탈만 보류, 관리기준 이탈은 이슈만 (spec 004 FR-005)
const SAVED_NOTICES = {
  out_of_spec: "규격 이탈입니다. 품질 이슈(규격 이탈)가 열리고 로트가 보류되었습니다.",
  out_of_alert: "관리기준 이탈입니다. 품질 이슈(관리기준 이탈)가 열렸습니다. 로트는 보류되지 않습니다.",
};
// spec 017: 여러 항목을 한 번에 저장한 뒤 덧붙이는 문구
const SAVED_TAILS = {
  held: "규격 이탈이 있어 품질 이슈가 열리고 로트가 보류되었습니다.",
  alert: "관리기준 이탈은 품질 이슈만 열리고 로트는 보류되지 않습니다.",
};

// FR-009 수용 기준 2·3: 저장 결과를 문구로 알리고 시험 결과 탭을 연다. spec 017 FR-004: 항목별 판정
function showSaved(batch, results, specs) {
  const held = results.some((result) => result.result === "out_of_spec");
  const issues = results.some((result) => result.quality_issue_id);
  const tail = held ? SAVED_TAILS.held : issues ? SAVED_TAILS.alert : "";
  goToTab(batch, "tests", `시험값 ${results.length}개를 저장했습니다: ${resultSummaryText(results, specs)}. ${tail}`.trim());
}

// FR-006 (spec 004): 보류로 바뀌었으면 규격 이탈, 안 바뀌었으면 관리기준 이탈. 이미 보류였으면 종류는 공정 기록 탭에서
function processNotice(before, result) {
  if (!result.quality_issue_id) return "공정 조건을 저장했습니다.";
  if (before === "on_hold") return "공정 이탈입니다. 품질 이슈가 열렸습니다. 이탈 종류는 공정 기록에서 확인해 주세요.";
  return result.batch_status === "on_hold" ? SAVED_NOTICES.out_of_spec : SAVED_NOTICES.out_of_alert;
}

function showProcessSaved(batch, result) {
  goToTab(batch, "process", processNotice(batch.status, result));
}

function goToTab(batch, tab, notice) {
  pendingNotice = notice;
  const target = `#/batches/${batch.id}?tab=${tab}`;
  if (location.hash === target) refreshPage();
  else location.hash = target;
}

async function tabContent(tab, { batch, measurements, issues, profile, board }) {
  if (tab === "samples") return samplesTab(batch, profile.role);
  if (tab === "process" && board) {
    return processStepsTab({ batch, board, measurements, issues, role: profile.role, onSaved: (notice) => goToTab(batch, "process", notice) });
  }
  if (tab === "process") return processTab(batch.id, measurements);
  if (tab === "issues") return issuesTab(issues);
  if (tab === "history") return historyTab(batch.id);
  return testsTab(measurements);
}
