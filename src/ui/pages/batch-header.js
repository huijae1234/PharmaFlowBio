// IA BT_010200_PG 로트 상세 위쪽 (UI 개편): 로트번호·상태·출하 검토 버튼 → 이 로트에서 지금 할 일 한 상자.
// 같은 말을 되풀이하던 숫자 3칸은 뺐다 (이슈·평가·조치 상태는 할 일 상자의 "→ 다음 단계"와 품질 이슈 탭에 있음).
// 최근 업무 이력은 접어 둔다 (업무 이력 탭에 그대로 있음)
import { h, badge, formatDateTime } from "../dom.js";
import { issueKindBadge } from "../issue-views.js";
import { batchStatusLabel } from "../../domain/batch-rules.js";
import { todoTone } from "../../domain/lot-todo-rules.js";
import { roleLabel } from "../../domain/roles.js";
import { shipmentText } from "../../domain/shipment-rules.js";
import { currentStepText } from "../../domain/process-step-rules.js";
import { periodText, quantityText } from "../../domain/work-order-rules.js";
import { lotAckText } from "../../domain/ack-rules.js";

const IDLE_TEXT = {
  in_production: "생산 중입니다. 시험값이 들어오면 이슈와 다음 할 일이 여기에 나옵니다.",
  in_testing: "시험이 진행 중입니다.",
  on_hold: "보류 중입니다.",
  releasable: "내부 출하 검토가 끝났습니다 (출하 가능).",
  discarded: "폐기된 로트입니다.",
};

/** 이 로트에서 지금 할 일 상자. 처리 중 이슈마다 한 줄, 없으면 출하 검토 가능 또는 안내 */
export function todoBox(tone, todos, batch, overview) {
  if (tone === "open") {
    return h("div", { class: "todo-box todo-box--open" },
      h("p", { class: "todo-title" }, `이 로트에서 지금 할 일 ${todos.length}건`),
      h("ul", { class: "todo-list" }, ...todos.map((todo) => h("li", { class: "todo-item" },
        issueKindBadge({ kind: todo.kind }),
        h("span", null, todo.detail),
        h("strong", { class: "todo-next" }, `→ ${todo.next}`),
        h("span", { class: "muted" }, todo.owner ? `담당 ${todo.owner}` : ""),
        h("a", { class: "button task-cta", href: `#/issues/${todo.issueId}` }, "이슈 열기")))));
  }
  if (tone === "ready") {
    return h("div", { class: "todo-box todo-box--ready" },
      h("p", { class: "todo-title" }, "다음에 할 일"),
      h("p", { class: "todo-line" }, h("strong", { class: "todo-next" }, `${overview.next ?? "내부 출하 검토"}`), h("span", { class: "muted" }, ` · 담당 ${overview.owner || "QA 관리자"}`)));
  }
  return h("div", { class: "todo-box todo-box--idle" }, h("p", { class: "todo-line muted" }, IDLE_TEXT[batch.status] ?? ""));
}

/**
 * @param {{ batch: object, todos: object[], overview: object, history: object[], workOrder: object | null, board: object[] | null, lotAcks: { total: number, acked: number }, releaseButton: Node | null }} input
 */
export function batchHeader({ batch, todos, overview, history, workOrder, board, lotAcks, releaseButton }) {
  const metas = [
    workOrder ? h("li", null, "작업지시 ", h("a", { class: "mono", href: `#/work-orders?q=${encodeURIComponent(workOrder.order_number)}` }, workOrder.order_number), ` · 계획 ${quantityText(workOrder)} · ${periodText(workOrder)}`) : null,
    board ? h("li", null, currentStepText(board)) : null, // spec 011 FR-007
    lotAcks.total ? h("li", null, lotAckText(lotAcks.total, lotAcks.acked)) : null, // spec 009 v0.7 FR-009
    batch.hold_reason ? h("li", null, `보류 사유: ${batch.hold_reason}`) : null,
    batch.release_reason ? h("li", null, `${batch.status === "discarded" ? "폐기" : "출하 검토"} 사유: ${batch.release_reason}`) : null, // 0033 적용 뒤에만 값이 있다
    shipmentText(batch, formatDateTime) ? h("li", null, shipmentText(batch, formatDateTime)) : null, // spec 017 FR-005: 출하 완료 기록
    batch.ship_note ? h("li", null, `출하 메모: ${batch.ship_note}`) : null,
  ].filter(Boolean);

  return h("header", { class: "panel lot-head" },
    h("div", { class: "lot-head-top" },
      h("div", { class: "lot-title" },
        h("h1", { class: "page-title mono" }, batch.batch_number),
        badge(batch.status, batchStatusLabel(batch.status)),
        h("span", { class: "lot-product" }, batch.product?.item_name ?? "")),
      releaseButton),
    metas.length ? h("ul", { class: "lot-meta" }, ...metas) : null,
    todoBox(todoTone({ todos, batch }), todos, batch, overview),
    history.length
      ? h("details", { class: "more" }, h("summary", null, "최근 업무 이력 3건"),
          h("ol", { class: "recent-history" }, ...history.slice(0, 3).map((item) => h("li", null,
            h("span", { class: "muted" }, formatDateTime(item.created_at)), ` · ${item.action} · ${item.actor_name} (${roleLabel(item.actor_role)})`))))
      : null);
}
