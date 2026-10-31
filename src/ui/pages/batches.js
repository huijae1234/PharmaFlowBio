// IA BT_010000_PG 배치 목록, BT_010100_MD 배치 등록. FR-008 (spec 001)
// 목록 개편: 상태 칩(건수 포함) + 목록·미리보기. 줄을 고르면 오른쪽에 그 로트의 지금 할 일이 뜬다
import { h, badge } from "../dom.js";
import { openModal, openSafely, field } from "../modal.js";
import { filterChips } from "../filter-chips.js";
import { masterDetail } from "../master-detail.js";
import { lotPreview } from "./lot-preview.js";
import { hashWith, NO_SEARCH_RESULT, searchBox } from "../search-box.js";
import { batchStatusLabel } from "../../domain/batch-rules.js";
import { matchesSearch, normalizeSearch } from "../../domain/search-rules.js";
import { can } from "../../domain/roles.js";
import { productOptions } from "../../domain/lot-group-rules.js";
import { createBatch, listBatches, listProducts } from "../../infrastructure/store.js";
import { listIssueTimes } from "../../infrastructure/store-dashboard.js";

const STATUSES = ["in_production", "in_testing", "on_hold", "releasable", "shipped", "discarded"]; // spec 017 FR-006: 출하 완료

/** @param {{ profile: { role: string }, query: Record<string, string> }} context */
export async function renderBatches({ profile, query }) {
  const status = STATUSES.includes(query.status) ? query.status : "";
  const term = normalizeSearch(query.q);
  const [all, issues] = await Promise.all([
    listBatches({ limit: 200, oldestFirst: query.sort === "old" }),
    listIssueTimes().catch(() => []), // 보조 정보: 못 읽으면 처리 중 이슈 칩만 빠진다
  ]);
  // UI 개편: 제품으로도 거른다 (로트번호 앞 글자는 제품과 1:1이 아니라서 실제 제품 기준). 상태 칩의 건수는 고른 제품 안에서 센다
  const products = productOptions(all);
  const group = products.some((item) => item.id === query.group) ? query.group : "";
  const inGroup = group ? all.filter((batch) => batch.product_id === group) : all;
  const counts = {};
  for (const batch of inGroup) counts[batch.status] = (counts[batch.status] ?? 0) + 1;
  // spec 007 FR-008: 로트번호·제품 이름으로 검색, 상태 거르기와 함께
  // 정렬: 기본은 최근 등록순. "오래된 순"을 고르면 거꾸로 (오래 걸린 로트부터 볼 때)
  const sort = query.sort === "old" ? "old" : "new";
  const filtered = inGroup
    .filter((batch) => !status || batch.status === status)
    .filter((batch) => matchesSearch([batch.batch_number, batch.product?.item_name], term));
  const batches = filtered; // 정렬은 서버가 했다
  const openByBatch = new Map();
  for (const issue of issues.filter((item) => item.status === "open")) openByBatch.set(issue.batch_id, (openByBatch.get(issue.batch_id) ?? 0) + 1);
  const total = inGroup.length;
  const go = (next) => { location.hash = hashWith("#/batches", { status, group, q: term, sort: sort === "old" ? "old" : "", ...next }); };
  const sortSelect = h("select", { class: "select", "aria-label": "정렬", onchange: () => go({ sort: sortSelect.value }) },
    h("option", { value: "", selected: sort === "new" }, "최근 등록 순"),
    h("option", { value: "old", selected: sort === "old" }, "오래된 순"));
  const groupSelect = h("select", { class: "select select--product", "aria-label": "제품으로 거르기", onchange: () => go({ group: groupSelect.value }) },
    h("option", { value: "" }, `전체 제품 (${all.length})`),
    ...products.map((item) => h("option", { value: item.id, selected: item.id === group }, `${item.name} (${item.count})`)));

  return h("div", { class: "stack" },
    h("div", { class: "page-header" },
      h("h1", { class: "page-title" }, "로트"),
      can(profile.role, "create_batch")
        ? h("button", { class: "button button--primary", type: "button", onclick: openSafely(openCreateBatch) }, "로트 등록")
        : null),
    // spec 010 FR-007: 생산 담당자는 로트를 직접 등록하지 않고 작업지시를 착수해 만든다
    !can(profile.role, "create_batch") && can(profile.role, "start_work_order")
      ? h("p", { class: "muted" }, "작업지시에서 착수하면 로트가 생깁니다. ", h("a", { href: "#/work-orders" }, "작업지시 목록으로"))
      : null,
    h("div", { class: "toolbar toolbar--spread" },
      filterChips({
        label: "로트 상태로 거르기",
        value: status,
        options: [{ value: "", text: "전체", count: total }, ...STATUSES.map((value) => ({ value, text: batchStatusLabel(value), count: counts[value] ?? 0 }))],
        onChange: (next) => go({ status: next }),
      }),
      h("div", { class: "toolbar" },
        groupSelect, sortSelect,
        searchBox({ label: "로트 검색", placeholder: "로트번호·제품 이름", value: term, onSearch: (next) => go({ q: next }) }))),
    masterDetail({
      items: batches,
      idOf: (batch) => batch.id,
      hrefOf: (batch) => `#/batches/${batch.id}`,
      row: (batch) => [
        h("span", { class: "md-main" },
          h("strong", { class: "mono md-title" }, batch.batch_number),
          h("span", { class: "md-sub" }, batch.product?.item_name ?? "")),
        h("span", { class: "md-side" },
          openByBatch.get(batch.id) ? h("span", { class: "md-flag" }, `이슈 ${openByBatch.get(batch.id)}`) : null,
          badge(batch.status, batchStatusLabel(batch.status))),
      ],
      preview: lotPreview,
      empty: term ? NO_SEARCH_RESULT : status || group ? "이 조건의 로트가 없습니다." : "아직 로트가 없습니다.",
    }));
}

async function openCreateBatch() {
  const products = await listProducts();
  const number = h("input", { class: "input mono", name: "batch_number", maxlength: "40", autocomplete: "off", required: true });
  const product = h("select", { class: "select", name: "product", required: true },
    h("option", { value: "" }, "제품을 고르세요"),
    ...products.map((item) => h("option", { value: item.id }, item.item_name)));

  openModal({
    title: "로트 등록",
    fields: [field("로트번호", number, "예: IFV-2610-005"), field("제품", product)],
    submitLabel: "등록",
    onSubmit: async () => {
      if (!number.value.trim()) throw new Error("로트번호를 입력해 주세요.");
      if (!product.value) throw new Error("제품을 골라 주세요.");
      const created = await createBatch(number.value, product.value);
      location.hash = `#/batches/${created.id}`;
    },
  });
}
