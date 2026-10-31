// AI 도우미가 답할 수 있는 앱 안내서 (spec 025 FR-003). IA 메뉴구조도·역할별로 쓸 수 있는 화면·용어 정의와 GLOSSARY에서 옮긴 짧은 글이다.
// 도우미는 이 글과 지금 화면의 근거 표 밖의 것을 답하지 않는다. 메뉴·권한·용어가 바뀌면 같은 작업에서 여기도 고친다 (spec 025 Q92).
// 주소는 앱 안(#/...)만 둔다. 화면 안의 버튼(공정 조건 입력 등)은 그 버튼이 있는 화면 주소를 단다.
import { roleLabel } from "./roles.js";
import { CLEARANCE_ITEMS } from "./process-step-rules.js";
import { REVIEW_FIELDS } from "./review-rules.js";

const QA = "qa_manager";
const QC = "qc_analyst";
const PROD = "production_operator";
const STAFF = [QA, QC, PROD];

const entry = (id, title, text, href, roles = STAFF) => ({ id, title, text, href, roles });
// 화면 코드의 말을 그대로 쓴다 (spec 025 v0.5 FR-003 수용 기준 5: 지어내지 않는다)
const clearanceText = CLEARANCE_ITEMS.map((item, index) => `${index + 1}) ${item.label}`).join(" ");
const reviewFieldsText = REVIEW_FIELDS.map((field) => `${field.label}${field.required ? "" : "(선택)"}`).join("·");

/** @type {{ id: string, title: string, text: string, href: string | null, roles: string[] }[]} */
export const APP_GUIDE = [
  // 옆 메뉴 (IA 메뉴구조도, roles.js menuFor)
  entry("home_qa", "관리자 대시보드", "QA 관리자의 첫 화면. 지금 할 일, 처리 중 품질 이슈, 보류 로트, 회수 공지, AI 오늘 먼저 볼 것이 있다.", "#/home/qa", [QA]),
  entry("home_qc", "품질시험 홈", "QC 시험 담당자의 첫 화면. 시험 대기 로트와 나에게 배정된 조치가 있다.", "#/home/qc", [QC]),
  entry("home_production", "제조공정 홈", "생산 담당자의 첫 화면. 착수할 작업지시와 나에게 배정된 조치가 있다.", "#/home/production", [PROD]),
  entry("menu_batches", "로트", "로트 목록. 상태(생산 중·시험 중·보류·출하 가능·출하 완료·폐기)와 제품으로 거를 수 있다. 보류 로트도 여기서 상태를 골라 본다.", "#/batches"),
  entry("menu_work_orders", "작업지시", "작업지시 목록. 생산 담당자·QA 관리자가 작성하고, QA 관리자가 발행하면 생산 담당자가 착수한다.", "#/work-orders"),
  entry("menu_issues", "품질 이슈", "품질 이슈 목록. 처리 중·종결과 종류(규격 이탈·관리기준 이탈·공정 이탈)로 거른다. 이슈 상세에서 조치 요청과 품질 영향 평가를 다룬다.", "#/issues"),
  entry("menu_products", "제품", "제품 목록. 제품 상세에 기준, 허가정보·회수 이력, 공개 규제 현황(국가출하승인·GMP) 탭이 있다.", "#/products"),
  entry("menu_samples", "검체", "검체 목록. 팀 사이에 검체를 전달·인수·반납하고, 확인할 검체를 본다.", "#/samples"),
  entry("admin_approvals", "승인 대기", "QA 관리자가 조치 요청과 품질 영향 평가를 승인·반려하는 곳.", "#/admin/approvals", [QA]),
  entry("admin_history", "전체 업무 이력", "모든 로트의 업무 이력을 모아 본다. 로트 상세의 업무 이력 탭과 다르다.", "#/admin/history", [QA]),
  entry("admin_usage", "사용 기록", "누가 언제 어느 화면을 썼는지 본다.", "#/admin/usage", [QA]),
  entry("admin_users", "사용자·역할", "처음 로그인한 사람(열람자)에게 역할을 준다.", "#/admin/users", [QA]),
  // 할 일 (IA 역할별로 쓸 수 있는 화면)
  entry("task_process_conditions", "공정 조건 입력", "공정 단계를 쓰지 않는 로트는 로트 상세의 공정 조건 입력 버튼으로 적는다. 칸: 공정 기준 항목의 값(빈칸은 건너뜀, 숫자가 아닌 칸이 있으면 아무것도 저장하지 않음), 생산량, 설비 상태(정상·이상). 기준을 벗어나거나 설비 상태가 이상이면 공정 품질 이슈가 하나 열린다. 공정 단계가 있는 로트는 단계 완료 때 적는다.", "#/batches", [PROD, QA]),
  entry("task_step_start", "공정 단계 착수", "작업지시로 만든 로트는 로트 상세의 공정 단계에서 한 단계씩 진행한다. 앞 단계를 완료한 뒤 다음 단계의 착수를 누르고, 라인 클리어런스 4가지를 모두 확인해야 착수된다. 로트가 보류 중이거나 생산 중이 아니면 진행할 수 없다.", "#/batches", [PROD, QA]),
  entry("task_step_complete", "공정 단계 완료", "진행 중인 단계의 완료를 누르고 그 단계에 이어진 공정 기준 값, 설비 상태(정상·이상), 생산량(선택)을 적는다. 이어진 공정 기준이 없으면 설비 상태만 확인한다. 기준을 벗어나거나 설비 상태가 이상이면 공정 품질 이슈가 열린다.", "#/batches", [PROD, QA]),
  entry("task_test_values", "시험값 입력", "로트 상세에서 시험값 입력 버튼을 누르고 항목마다 값을 적는다(빈칸은 건너뛰고 넣은 값은 한 번에 저장). 그때 기준과 비교해 정상·관리기준 이탈·규격 이탈로 판정된다. 규격 이탈이면 품질 이슈가 열리고 로트가 자동 보류된다. 관리기준 이탈은 이슈만 열린다.", "#/batches", [QC, QA]),
  entry("task_retest", "재시험", "재시험 조치가 승인되어 나에게 배정되면, 품질 이슈 상세의 조치 결과에서 다시 잰 값과 결과 메모를 적는다. 저장하면 조치 요청이 완료된다.", "#/issues", [QC, QA]),
  entry("task_hold", "로트 보류", "로트 상세에서 로트 보류 버튼을 누르고 보류 사유를 적는다. 규격 이탈은 자동으로 보류된다. 보류 중인 로트는 공정 단계를 진행할 수 없다.", "#/batches", [PROD, QA]),
  entry("task_release", "내부 출하 검토", "로트 상세에서 출하 가능 또는 폐기를 고른다. 처리 중인 품질 이슈가 있거나 시험이 끝나지 않았으면 출하할 수 없다.", "#/batches", [QA]),
  entry("task_ship", "출하 완료 기록", "출하 가능 로트의 로트 상세에서 출하 완료를 누르고 출하 일시와 메모(선택)를 적는다. 기록한 뒤에는 되돌릴 수 없고 로트는 읽기만 된다. 회사 내부 출하 기록이며 국가출하승인이 아니다. QA 관리자에게 알림이 간다.", "#/batches", [PROD]),
  entry("task_work_order", "작업지시 작성", "작업지시 목록에서 작성한다. 칸: 제품, 계획 수량, 단위, 계획 시작일, 계획 종료일(시작일과 같거나 뒤), 메모(선택). 발행은 QA 관리자가 한다.", "#/work-orders", [PROD, QA]),
  entry("task_work_order_start", "작업 착수", "발행된 작업지시의 착수를 누르고 로트번호(예: IFV-2610-005)를 적으면 그 번호로 생산 중 로트가 생긴다. 그다음 로트 상세의 공정 단계를 진행한다.", "#/work-orders", [PROD, QA]),
  entry("task_action_result", "조치 결과 입력", "조치 요청이 승인되어 나에게 배정되면, 품질 이슈 상세의 조치 결과에서 무엇을 했고 결과가 어땠는지 적는다(재시험이면 다시 잰 값도). 저장하면 조치 요청이 완료된다.", "#/issues"),
  entry("task_action_request", "조치 요청 등록", "품질 이슈 상세에서 조치 요청을 등록한다. QA 관리자가 승인하면 배정된 사람이 조치 결과를 입력한다.", "#/issues"),
  entry("task_review_write", "품질 영향 평가 작성", `품질 이슈 상세의 품질 이탈 및 예외처리 검토에서 작성한다. 칸: ${reviewFieldsText}. 근거에는 문서 번호나 자료 설명을 적고 파일 첨부는 없다. 이슈마다 하나이고 임시 저장은 없다. QA 관리자가 보완 요청·반려하면 작성자가 고쳐 다시 제출한다.`, "#/issues"),
  entry("task_review_check", "평가 검토와 조치 승인", "승인 대기에서 품질 영향 평가를 승인·반려·보완 요청하고, 조치 요청을 승인·반려한다. 평가 승인은 출하 승인이 아니다.", "#/admin/approvals", [QA]),
  entry("task_sample_send", "검체 전달", "검체 목록에서 전달 등록을 누른다. 칸: 로트, 보내는 길, 수량, 단위, 보관 위치(예: 보존검체실 냉장고 R-02 3단), 메모(선택). 받는 팀이 인수를 확인한다.", "#/samples", [PROD, QA]),
  entry("task_sample_routes", "검체 보내는 길", "생산 → QC는 시험 검체, 생산 → QA는 보존 검체, QA → QC는 보존 검체다. 다른 길은 없다.", "#/samples"),
  entry("task_sample_receive", "검체 인수·반납·소진", "받는 팀은 검체 실물을 받았을 때 인수 확인을 누른다. 다 쓰지 않은 검체는 받은 팀이 반납 수량을 적어 반납하고, 보낸 팀이 반납 확인을 누른다. QC가 받은 시험 검체는 소진 처리할 수 있다. QA 보존 검체는 인수 확인한 날부터 2년이 보관 기한이고, 지나면 알림이 오고 폐기를 기록한다.", "#/samples"),
  entry("task_regulatory", "공개 규제 현황 보기", "제품 상세의 공개 규제 현황 탭. 식약처 공개 자료를 그대로 보여 줄 뿐 승인·적합 여부를 정하지 않는다.", "#/products"),
  entry("task_inbox", "알림 함", "모든 화면 위쪽의 알림 버튼. 나에게 온 최근 알림 20건을 보고 누르면 그 화면으로 간다.", null),
  // 용어 (IA 용어 정의, GLOSSARY)
  entry("term_lot", "로트", "한 번에 만든 제품 묶음. 화면에서는 로트, 표·주소는 batch라고 쓴다.", null),
  entry("term_deviation", "규격 이탈과 관리기준 이탈", "규격 이탈은 시험 규격을 벗어난 것으로 로트가 자동 보류된다. 관리기준 이탈은 규격 안이지만 사내 관리기준을 벗어난 것으로, 품질 이슈가 열리지만 자동 보류는 아니다.", null),
  entry("term_issue_status", "처리 중·종결", "품질 이슈의 상태. 승인된 품질 영향 평가가 있고 끝나지 않은 조치가 없어야 종결할 수 있다. 처리 중인 이슈가 있으면 출하할 수 없다.", null),
  entry("term_impact_review", "품질 영향 평가", "이슈가 품질에 미치는 영향을 적는 평가서. 작성한 뒤 QA 관리자가 검토한다.", null),
  entry("term_line_clearance", "라인 클리어런스", `공정 단계를 착수하기 전에 확인하는 4가지: ${clearanceText}`, null, [PROD, QA]),
  entry("term_equipment_abnormal", "설비 이상을 적으면", "공정 조건이나 단계 완료에서 설비 상태를 이상으로 고르면 기준 이탈과 같이 공정 품질 이슈가 열린다. 그다음 품질 이슈 상세에서 조치 요청(설비 점검 등)과 품질 영향 평가를 진행한다.", "#/issues", [PROD, QA]),
];

const whoDoes = (roles) => roles.map(roleLabel).join("·");

/**
 * 그 역할에게 보일 안내서. 할 수 없는 일도 "누가 하는지" 안내하려고 남기되 allowed를 거짓으로 둔다. 열람자는 도우미를 못 쓰므로 빈 목록
 * @param {string | null | undefined} role
 */
export function guideFor(role) {
  if (!STAFF.includes(role)) return [];
  return APP_GUIDE.map((item) => ({ ...item, allowed: item.roles.includes(role), who: whoDoes(item.roles) }));
}

/** 프롬프트에 넣는 안내서 글. 줄마다 [id]로 시작한다 */
export function guideText(entries) {
  return entries.map((item) => `[${item.id}] ${item.title}: ${item.text}${item.allowed ? "" : ` (이 사용자는 못 함 · ${item.who}가 함)`}`).join("\n");
}
