// 화면 그리기 도우미. 사람이 넣은 글자는 textContent로만 들어가므로 HTML로 해석되지 않는다 (plan 001 §5 보안).

/**
 * @param {string} tag
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...(Node | string | number | null | undefined | false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    setAttribute(element, name, value);
  }
  put(element, ...children);
  return element;
}

/**
 * 자식을 모두 바꾼다. null·undefined·false는 건너뛴다 ("null" 글자가 찍히지 않게).
 * @param {Element} container
 * @param {...(Node | string | number | null | undefined | false)} children
 */
export function put(container, ...children) {
  const nodes = children.flat().filter((child) => child !== null && child !== undefined && child !== false);
  container.replaceChildren(...nodes.map((child) => (child instanceof Node ? child : String(child))));
}

function setAttribute(element, name, value) {
  if (value === null || value === undefined || value === false) return;
  if (name.startsWith("on") && typeof value === "function") {
    element.addEventListener(name.slice(2).toLowerCase(), value);
    return;
  }
  element.setAttribute(name, value === true ? "" : String(value));
}

const BADGE_TONES = {
  in_production: "info",
  in_testing: "info",
  on_hold: "warning",
  releasable: "success",
  discarded: "neutral",
  shipped: "success", // spec 017: 출하 완료 (글자로 출하 가능과 구분)
  pass: "success",
  out_of_alert: "warning", // spec 004 FR-003: 관리기준 이탈은 경고, 규격 이탈은 위험 (글자도 함께)
  out_of_spec: "danger",
  spec: "danger", // 품질 이슈 종류 (spec 004 FR-005)
  alert: "warning",
  open: "warning",
  closed: "neutral",
  normal: "success",
  abnormal: "danger",
  gmp_soon: "warning", // spec 021: GMP 유효기간 임박·지남 (글자도 함께)
  gmp_expired: "danger",
  recalled_lot: "danger", // spec 021 FR-009: 승인 로트가 회수됨
  recall_info: "info", // 회수 공지 참고·대조 못 함
  company_info: "info", // spec 021 FR-010: 업체명 확인 필요
  company_same: "success", // 업체명 대조 결과 (글자와 기호도 함께)
  company_similar: "warning",
  company_different: "warning",
  company_none: "neutral",
  ai_note: "info", // spec 022: "AI 참고 의견" 배지
  fact_ok: "success", // 근거 줄 상태: 읽음 / 자료 없음 / 못 읽음 (글자도 함께)
  fact_none: "warning",
  fact_failed: "danger",
  schedule_danger: "danger", // spec 021 FR-011: 계획된 생산과 GMP 유효기간
  schedule_warning: "warning",
  schedule_ok: "success",
  trend_info: "info", // FR-012: 승인 공백·승인 로트 임박
  pending_approval: "warning",
  approved: "info",
  rejected: "danger",
  completed: "success",
  review_submitted: "warning", // 품질 영향 평가 상태 (spec 005)
  review_approved: "success",
  review_rejected: "danger",
  review_revision_requested: "warning",
  sample_pending: "warning", // 검체 상태 (spec 008)
  sample_held: "info",
  sample_return_pending: "warning",
  sample_returned: "success",
  sample_consumed: "neutral",
  sample_disposed: "neutral", // spec 018 FR-004
  retention_due: "danger", // spec 018 FR-002 "기한 지남"
  fixture: "warning", // spec 019 FR-003 "시험 자료"
  work_order_draft: "neutral", // 작업지시 상태 (spec 010). 글자와 함께 보인다
  work_order_released: "warning",
  work_order_in_progress: "info",
  work_order_completed: "success",
  work_order_cancelled: "neutral",
  step_waiting: "neutral", // 공정 단계 상태 (spec 011). 글자와 함께 보인다
  step_in_progress: "info",
  step_completed: "success",
};

/** datetime-local 칸이 쓰는 지금 시각 "2026-10-28T14:05" (이 기기 시간대) */
export function localMinuteNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** 화면을 다시 그리게 한다 (저장 뒤 같은 주소일 때) */
export function refreshPage() {
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** "10/22 14:05" 형식 (화면 표시용) @param {string} iso */
export function formatDateTime(iso) {
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 페이지 제목 + 내용 묶음 */
export function section(title, ...children) {
  return h("section", { class: "panel" }, h("h2", { class: "section-title" }, title), ...children);
}

/**
 * 상태 배지: 글자 + 색 (디자인 기본선 5)
 * @param {string} status
 * @param {string} label
 */
export function badge(status, label) {
  const tone = BADGE_TONES[status] ?? "neutral";
  return h("span", { class: `badge badge--${tone}` }, label);
}
