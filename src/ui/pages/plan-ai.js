// 기준 변경 영향 설명(spec 024 FR-001)과 생산 일정 미완료 업무 확인(FR-002) 칸. 권한표(ai-policy-rules.js)가 허용한 역할에게만, 기본으로 접어 둔다.
// 둘 다 서버가 저장된 사실을 읽어 코드가 센 값만 근거로 쓰고, AI는 문장·질문만 정리한다. 기준 수정·소급 판정·일정 예측·변경·알림은 없다.
import { h } from "../dom.js";
import { assistPanel } from "../ai-assist-panel.js";
import { scheduleView, specImpactView } from "../ai-assist-views.js";
import { aiDecision } from "../../domain/ai-policy-rules.js";

/** QA의 제품 상세(기준 관리)에서 항목 하나를 골라 "현재 기준으로 비교한 참고 결과"를 설명받는다 */
export function specImpactPanel({ profile, specs }) {
  if (!specs.length || !aiDecision("spec_impact", { profile }).allowed) return null;
  const select = h("select", { class: "select", name: "ai_spec", "aria-label": "기준 변경 영향을 설명할 항목" },
    h("option", { value: "" }, "항목을 고르세요"), ...specs.map((spec) => h("option", { value: spec.id }, `${spec.item_name} (현재 v${spec.version})`)));
  const panel = assistPanel({
    kind: "spec_impact", title: "AI로 기준 변경 영향 설명", button: "AI로 영향 설명", fold: true,
    hint: "측정 당시 저장된 기준·버전과 현재 기준을 코드가 비교한 참고 결과를 설명합니다. 원래 판정·로트 상태·승인 이력은 바뀌지 않고, 기준 수정·소급 판정·출하 승인은 하지 않습니다.",
    controls: [h("label", { class: "field" }, h("span", { class: "field-label" }, "항목"), select)],
    precheck: () => (select.value ? null : "항목을 먼저 골라 주세요."),
    request: () => ({ target: { specId: select.value } }), view: specImpactView,
  });
  select.addEventListener("change", () => panel.querySelector(".ai-precheck")?.remove());
  return panel;
}

const SCHEDULE_HINTS = {
  production_operator: "내 차례(생산 담당자)가 먼저 보입니다. 날짜·보류·미완료 업무는 코드가 세고, AI는 확인 순서·담당 역할·근거를 정리합니다.",
  qa_manager: "전체 작업지시를 봅니다. 날짜·보류·미완료 업무는 코드가 세고, AI는 확인 순서·담당 역할·근거를 정리합니다.",
};

/** 작업지시 화면: 계획일·보류·열린 이슈·평가·조치 상태에서 일정에 영향을 줄 수 있는 미완료 업무. 완료일·지연일 예측과 일정 배정은 하지 않는다 */
export function schedulePanel({ profile }) {
  if (!aiDecision("schedule_check", { profile }).allowed) return null;
  return assistPanel({
    kind: "schedule_check", title: "AI로 일정에 영향을 주는 미완료 업무 확인", button: "AI로 확인", fold: true,
    hint: `${SCHEDULE_HINTS[profile.role]} 계획일·담당자 변경과 알림은 하지 않습니다.`,
    request: () => ({}), view: scheduleView,
  });
}
