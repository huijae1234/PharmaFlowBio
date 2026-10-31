// 로트 목록 오른쪽 미리보기: 상태·지금 할 일·공정 단계 흐름·"열기" (상세 화면과 같은 규칙, 읽기만)
import { h, badge } from "../dom.js";
import { todoBox } from "./batch-header.js";
import { stepper } from "./process-steps.js";
import { batchStatusLabel } from "../../domain/batch-rules.js";
import { lotTodos, todoTone } from "../../domain/lot-todo-rules.js";
import { stepBoard } from "../../domain/process-step-rules.js";
import { batchSummary } from "../../domain/step-rules.js";
import { listMeasurements, listQualityIssues } from "../../infrastructure/store.js";
import { listBatchRequests } from "../../infrastructure/store-actions.js";
import { listIssueReviews } from "../../infrastructure/store-reviews.js";
import { getWorkOrderForBatch } from "../../infrastructure/store-work-orders.js";
import { listProcessSteps, listStepRuns } from "../../infrastructure/store-process-steps.js";

/** @param {{ id: string, batch_number: string, status: string, product_id: string, product?: { item_name: string } | null }} batch */
export async function lotPreview(batch) {
  const [issues, measurements, workOrder, steps, runs] = await Promise.all([
    listQualityIssues(batch.id), listMeasurements(batch.id), getWorkOrderForBatch(batch.id), listProcessSteps(batch.product_id), listStepRuns(batch.id),
  ]);
  const issueIds = issues.map((issue) => issue.id);
  const [requests, reviews] = await Promise.all([listBatchRequests(issueIds), listIssueReviews(issueIds)]);
  const overview = batchSummary({ issues, reviews, requests, batch });
  const todos = lotTodos({ issues, reviews, requests, batch, measurements });
  const board = workOrder && steps.some((step) => !step.retired_at) ? stepBoard(steps, runs, batch.status) : null;

  return h("div", { class: "preview-body" },
    h("div", { class: "preview-head" },
      h("h2", { class: "preview-title mono" }, batch.batch_number),
      badge(batch.status, batchStatusLabel(batch.status))),
    h("p", { class: "muted" }, batch.product?.item_name ?? ""),
    todoBox(todoTone({ todos, batch }), todos, batch, overview),
    board ? h("div", { class: "preview-block" }, h("p", { class: "preview-label" }, "공정 단계"), stepper(board)) : null,
    h("a", { class: "button button--primary preview-open", href: `#/batches/${batch.id}` }, "로트 상세 열기 →"));
}
