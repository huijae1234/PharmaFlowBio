// IA QI_010000_PG 품질 이슈 목록. FR-001 (spec 002), 종류 거르기·표시는 spec 004 FR-005
// 목록 개편: 거르기는 칩 세 묶음, 목록 + 미리보기 (줄을 고르면 오른쪽에 단계·다음에 할 일)
import { h, badge, formatDateTime } from "../dom.js";
import { chipGroup, filterChips } from "../filter-chips.js";
import { masterDetail } from "../master-detail.js";
import { issuePreview } from "./issue-preview.js";
import { KIND_HELP, issueKindBadge, issueSummaryText } from "../issue-views.js";
import { issueSourceLabel, openRequestCount } from "../../domain/action-rules.js";
import { ISSUE_STATUS_LABELS } from "../../domain/judgement-rules.js";
import { listIssues } from "../../infrastructure/store-actions.js";

const KIND_LABELS = { spec: "규격 이탈", alert: "관리기준 이탈" };
const SOURCE_LABELS = { test: "시험", process: "공정" };

/** @param {{ query: Record<string, string> }} context */
export async function renderIssues({ query }) {
  const status = ISSUE_STATUS_LABELS[query.status] ? query.status : "";
  const source = SOURCE_LABELS[query.source] ? query.source : "";
  const kind = KIND_LABELS[query.kind] ? query.kind : "";
  const sort = query.sort === "old" ? "old" : "new";
  const issues = await listIssues({ status, source, kind, oldestFirst: sort === "old" }); // 서버에서 정렬 (최근 50건만 받아 뒤집으면 오래된 이슈가 빠진다)

  const go = (next) => {
    const params = new URLSearchParams(Object.entries({ status, source, kind, sort: sort === "old" ? "old" : "", ...next }).filter(([, value]) => value));
    const text = params.toString(); // URLSearchParams.size는 오래된 브라우저에 없다
    location.hash = text ? `#/issues?${text}` : "#/issues";
  };
  const chips = (label, labels, current, key) => filterChips({
    label: `${label}로 거르기`,
    value: current,
    options: [{ value: "", text: "전체" }, ...Object.entries(labels).map(([value, text]) => ({ value, text }))],
    onChange: (value) => go({ [key]: value }),
  });

  return h("div", { class: "stack" },
    h("div", { class: "page-header" }, h("h1", { class: "page-title" }, "품질 이슈")),
    h("div", { class: "toolbar toolbar--groups" },
      chipGroup("상태", chips("상태", ISSUE_STATUS_LABELS, status, "status")),
      chipGroup("종류", chips("종류", KIND_LABELS, kind, "kind")),
      chipGroup("발생 구분", chips("발생 구분", SOURCE_LABELS, source, "source")),
      chipGroup("정렬", filterChips({
        label: "정렬", value: sort === "old" ? "old" : "",
        options: [{ value: "", text: "최근 순" }, { value: "old", text: "오래된 순" }],
        onChange: (value) => go({ sort: value }),
      }))),
    // 처음 쓰는 사람을 위한 한 줄 범례
    h("p", { class: "legend-note muted" }, `${KIND_HELP.spec} · ${KIND_HELP.alert}`),
    masterDetail({
      items: issues,
      idOf: (issue) => issue.id,
      hrefOf: (issue) => `#/issues/${issue.id}`,
      row: (issue) => [
        h("span", { class: "md-main" },
          h("strong", { class: "mono md-title" }, issue.batch?.batch_number ?? ""),
          h("span", { class: "md-sub" }, `${issueSourceLabel(issue.source)} · ${issueSummaryText(issue)} · ${formatDateTime(issue.opened_at)}`)),
        h("span", { class: "md-side" },
          openRequestCount(issue.requests ?? []) ? h("span", { class: "md-flag" }, `조치 ${openRequestCount(issue.requests ?? [])}`) : null,
          issueKindBadge(issue), badge(issue.status, ISSUE_STATUS_LABELS[issue.status])),
      ],
      preview: issuePreview,
      empty: status || source || kind ? "이 조건의 품질 이슈가 없습니다." : "아직 품질 이슈가 없습니다.",
    }));
}
