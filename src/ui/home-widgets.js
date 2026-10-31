// 홈 조각 (홈 개편): 지금 할 일 카드, 지표 한 줄, 로트 상태 막대, 짧은 목록, 회수 공지 3건.
// 계산은 domain/home-task-rules.js, 모양은 styles/home.css
import { h, badge, formatDateTime, put, refreshPage } from "./dom.js";
import { publicPanel } from "./public-panel.js";
import { batchStatusLabel } from "../domain/batch-rules.js";
import { ageInfo, countByKind, holdOwner, holdSummary } from "../domain/home-task-rules.js";
import { setHomeTaskCount } from "./home-badge.js";
import { filterByProduct, holdProducts, sortHolds } from "../domain/hold-sort-rules.js";
import { publicCacheKey, recentRecalls } from "../domain/public-data-rules.js";
import { callPublicData } from "../infrastructure/public-data.js";

const VISIBLE_TASKS = 6;

function card(title, ...children) {
  return h("section", { class: "panel card" }, h("h2", { class: "card-title" }, title), ...children);
}

// 기다린 날수를 보이는 종류: 시각이 "기다리기 시작한 때"인 것만 (출하 검토 대기는 로트 등록일이라 뺀다)
const WAITING_KINDS = new Set(["조치 요청 승인", "영향 평가 검토", "조치 결과 입력", "보완 필요", "공정 단계 진행 중"]);

function taskRow(task) {
  const who = [task.who, task.at ? formatDateTime(task.at) : ""].filter(Boolean).join(" · ");
  const age = WAITING_KINDS.has(task.kind) ? ageInfo(task.at) : null;
  return h("li", { class: "task-row" },
    h("span", { class: `task-kind task-kind--${task.tone}` }, task.kind),
    h("div", { class: "task-main" },
      task.ref ? (task.refHref ? h("a", { class: "mono task-ref", href: task.refHref }, task.ref) : h("span", { class: "mono task-ref" }, task.ref)) : null,
      h("span", { class: "task-text" }, task.text),
      who ? h("span", { class: "muted task-who" }, who) : null,
      age ? h("span", { class: age.late ? "age age--late" : "age" }, age.late ? `지연 ${age.text}` : age.text) : null),
    h("a", { class: "button task-cta", href: task.href }, task.cta));
}

/** "지금 할 일": 종류가 달라도 한 목록. 많으면 앞의 6건만 보이고 나머지는 접어 둔다 */
export function taskCard(tasks, emptyText = "지금 처리할 일이 없습니다.") {
  setHomeTaskCount(tasks.length); // 사이드바 "홈" 옆 건수
  const head = h("div", { class: "card-head" },
    h("h2", { class: "card-title" }, "지금 할 일"),
    h("span", { class: tasks.length ? "count-pill count-pill--on" : "count-pill" }, `${tasks.length}건`));
  if (!tasks.length) return h("section", { class: "panel card" }, head, h("p", { class: "empty-state" }, "✓ ", emptyText));
  const rest = tasks.slice(VISIBLE_TASKS);
  return h("section", { class: "panel card card--tasks" }, head,
    h("ul", { class: "chip-row", "aria-label": "종류별 건수" },
      ...countByKind(tasks).map(([kind, count]) => h("li", { class: "chip" }, `${kind} ${count}`))),
    h("ul", { class: "task-list" }, ...tasks.slice(0, VISIBLE_TASKS).map(taskRow)),
    rest.length ? h("details", { class: "more" }, h("summary", null, `나머지 ${rest.length}건 보기`), h("ul", { class: "task-list" }, ...rest.map(taskRow))) : null);
}

/** 제목 옆 지표 한 줄: [[이름, 값], …] */
export function kpiInline(items) {
  // 세 번째 값이 있으면 숫자를 눌러 그 목록으로 간다 (숫자를 보면 바로 목록을 보고 싶다)
  return h("ul", { class: "kpi-inline", "aria-label": "품질 지표" }, ...items.map(([label, value, href]) => {
    // "7건"·"2.0일"은 숫자는 크게, 단위는 작게 (참고 이미지: 10.8k, 30s). 숫자 뒤가 글자가 아니면 통째로 보인다
    const match = /^([\d.,]+)\s*(\D+)$/.exec(String(value));
    const body = [
      h("span", { class: "kpi-label" }, label),
      h("strong", { class: "kpi-value" }, match ? [match[1], h("small", { class: "kpi-unit" }, match[2])] : value),
    ];
    return h("li", null, href ? h("a", { class: "kpi-link", href }, ...body) : body);
  }));
}

/** 로트 짧은 목록: 최대 5건, 더 있으면 "전체 보기" */
export function lotList(title, batches, emptyText, moreHref, extra) {
  const shown = batches.slice(0, 5);
  return card(`${title} ${batches.length}`,
    batches.length
      ? h("ul", { class: "mini-list" }, ...shown.map((batch) => h("li", null,
          h("a", { class: "mono", href: `#/batches/${batch.id}` }, batch.batch_number),
          h("span", { class: "mini-text" }, batch.product?.item_name ?? ""),
          badge(batch.status, batchStatusLabel(batch.status)),
          // 왜 이 줄이 여기 있는지 한 줄 (예: 이슈 2건 · 5일째, 보류 사유)
          extra?.(batch) ? h("span", { class: "mini-extra" }, extra(batch)) : null)))
      : h("p", { class: "empty-state" }, emptyText),
    batches.length > shown.length && moreHref ? h("a", { class: "more-link", href: moreHref }, `전체 ${batches.length}건 보기`) : null);
}

/** 최근 이탈 짧은 목록 (품질시험·제조공정 홈) */
export function recentList(title, rows, emptyText, line) {
  return card(title, rows.length ? h("ul", { class: "mini-list" }, ...rows.slice(0, 5).map((row) => h("li", null, line(row)))) : h("p", { class: "empty-state" }, emptyText));
}

/** 최근 회수 공지 (spec 003 FR-003). 20건을 받아 최근순으로 두고 칸 안에서 스크롤한다. 아래에 공식 조회 사이트 링크 */
export function recallCard() {
  const recall = card("최근 회수 공지", publicPanel({
    label: "회수 공지",
    cacheKey: publicCacheKey("recall", { recent: 20 }),
    load: () => callPublicData("recall", { recent: 20 }),
    render: (result) => {
      const rows = recentRecalls(result.items);
      if (!rows.length) return h("p", { class: "empty-state" }, "최근 회수·판매중지 공지가 없습니다.");
      // 칸 높이는 고정하고 안에서 스크롤: 최근 공지를 더 볼 수 있다 (자료는 최근 20건을 이미 받아 둔다)
      return h("div", { class: "recall-scroll", tabindex: "0", role: "region", "aria-label": "최근 회수 공지 목록" },
        h("ul", { class: "mini-list mini-list--stack" }, ...rows.map((row) => h("li", null,
          h("span", { class: "mono muted" }, row.commandDate), " ", h("strong", null, row.product),
          h("span", { class: "muted" }, ` · ${row.company}`),
          h("span", { class: "line-clamp muted" }, row.reason)))));
    },
  }), h("a", { class: "more-link recall-link", href: "https://nedrug.mfds.go.kr/PPMAB00", target: "_blank", rel: "noopener noreferrer" }, "의약품안전나라 회수·폐기 조회 (새 창)"));
  recall.classList.add("card--recall"); // 그래프가 먼저 보이게 홈 맨 뒤 칸으로 (styles/charts.css)
  return recall;
}

/** 홈 맨 아래: MSDS는 공단 사이트로 (spec 007 FR-007) */
export function msdsFooter() {
  return h("p", { class: "home-footer" }, "원료·시약 안전정보: ",
    h("a", { href: "https://msds.kosha.or.kr/MSDSInfo/", target: "_blank", rel: "noopener noreferrer" }, "한국산업안전보건공단 MSDS 조회 (새 창)"));
}

function formatClock(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 제목 줄 + 두 칸 배치: 왼쪽 넓은 칸이 할 일, 오른쪽은 현황 */
export function homeLayout({ title, kpis, left, right, below = [] }) {
  return h("div", { class: "home" },
    h("div", { class: "home-head" },
      h("h1", { class: "page-title" }, title),
      h("div", { class: "home-tools" },
        kpis ?? null,
        // 업무 화면은 "지금 기준"이 중요하다: 언제 읽은 화면인지 보이고, 한 번에 다시 읽는다
        h("button", { class: "button button--ghost", type: "button", onclick: refreshPage, title: "다시 불러오기" }, `↻ ${formatClock(new Date())} 기준`))),
    h("div", { class: "home-grid" }, h("div", { class: "home-main" }, ...left), h("div", { class: "home-side" }, ...right)),
    below.length ? h("div", { class: "home-row" }, ...below) : null, // 도식 한 줄: 도넛·주별 추이·이탈 순위
    msdsFooter());
}

/**
 * 보류 로트 (UI 개편): 기본은 오래된 것이 위. 정렬(오래된 순 / 최신 순)과 제품으로 거른다.
 * "오래됨"은 가장 오래된 열린 이슈가 열린 때 (이슈가 없으면 로트 등록 때). 5건까지 보이고 나머지는 접어 둔다
 * @param {object[]} batches 보류 상태 로트
 * @param {object[]} issues listIssueTimes 결과 (batch_id, status, opened_at)
 */
export function holdCard(batches, issues, requests = [], reviews = []) {
  let order = "oldest";
  let product = "";
  const title = h("h2", { class: "card-title" });
  const body = h("div", null);
  const sortSelect = h("select", { class: "select select--sm", "aria-label": "보류 로트 정렬", onchange: () => { order = sortSelect.value; draw(); } },
    h("option", { value: "oldest" }, "오래된 순"), h("option", { value: "newest" }, "최신 순"));
  const products = holdProducts(batches);
  const productSelect = products.length > 1
    ? h("select", { class: "select select--sm", "aria-label": "제품으로 거르기", onchange: () => { product = productSelect.value; draw(); } },
        h("option", { value: "" }, "전체 제품"), ...products.map((name) => h("option", { value: name }, name)))
    : null;

  const row = (batch) => h("li", null,
    h("a", { class: "mono", href: `#/batches/${batch.id}` }, batch.batch_number),
    h("span", { class: "mini-text" }, batch.product?.item_name ?? ""),
    badge(batch.status, batchStatusLabel(batch.status)),
    holdSummary(batch, issues) ? h("span", { class: "mini-extra" }, holdSummary(batch, issues)) : null,
    holdOwner(batch, issues, requests, reviews) ? h("span", { class: "mini-extra mini-owner" }, `담당 · ${holdOwner(batch, issues, requests, reviews)}`) : null);

  function draw() {
    const shown = sortHolds(filterByProduct(batches, product), issues, order);
    title.textContent = `보류 로트 ${shown.length}`;
    put(body, // put은 null을 건너뛴다 (replaceChildren은 "null" 글자를 찍는다)
      shown.length ? h("ul", { class: "mini-list" }, ...shown.slice(0, 5).map(row)) : h("p", { class: "empty-state" }, batches.length ? "이 제품의 보류 로트가 없습니다." : "아직 보류 로트가 없습니다."),
      shown.length > 5 ? h("details", { class: "more" }, h("summary", null, `나머지 ${shown.length - 5}건 보기`), h("ul", { class: "mini-list" }, ...shown.slice(5).map(row))) : null);
  }
  draw();
  return h("section", { class: "panel card" },
    h("div", { class: "card-head card-head--wrap" }, title, batches.length > 1 ? h("div", { class: "card-tools" }, productSelect, sortSelect) : null),
    body);
}
