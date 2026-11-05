import { h, put } from "./dom.js";
import { renderLayout } from "./layout.js";
import { renderLogin } from "./pages/login.js";
import { renderHomeQa, renderHomeQc, renderHomeProduction } from "./pages/homes.js";
import { renderUsers } from "./pages/users.js";
import { renderBatches } from "./pages/batches.js";
import { renderBatchDetail } from "./pages/batch-detail.js";
import { renderProducts, renderProductDetail } from "./pages/products.js";
import { renderIssues } from "./pages/issues.js";
import { renderIssueDetail } from "./pages/issue-detail.js";
import { renderApprovals } from "./pages/approvals.js";
import { renderHistory } from "./pages/history.js";
import { renderUsage } from "./pages/usage.js";
import { renderSamples } from "./pages/samples.js";
import { renderWorkOrders } from "./pages/work-orders.js";
import { parseRoute } from "./route.js";
import { canOpen, homePathFor } from "../domain/roles.js";
import { getSession, loadMyProfile, onAuthChange, signOut } from "../infrastructure/store.js";
import { logUsage } from "../infrastructure/store-products.js";
import { clearAiCache, setAiUser } from "../infrastructure/ai.js";
import { clearScreenFacts } from "./assistant-context.js";
import { pagePath } from "../domain/usage-rules.js";

// IA 화면 ID → 주소. 아직 없는 화면은 다음 단계에서 만든다 (plan 001 5·6단계, 기능 002·003)
const PAGES = {
  "#/home/qa": { title: "관리자 대시보드", render: renderHomeQa },
  "#/home/qc": { title: "품질시험 홈", render: renderHomeQc },
  "#/home/production": { title: "제조공정 홈", render: renderHomeProduction },
  "#/admin/users": { title: "사용자·역할", render: renderUsers },
  "#/admin/approvals": { title: "승인 대기", render: renderApprovals },
  "#/admin/history": { title: "전체 업무 이력", render: renderHistory },
  "#/admin/usage": { title: "사용 기록", render: renderUsage },
  "#/batches": { title: "로트 목록", render: renderBatches },
  "#/batches/:id": { title: "로트 상세", render: renderBatchDetail },
  "#/issues": { title: "품질 이슈 목록", render: renderIssues },
  "#/issues/:id": { title: "품질 이슈 상세", render: renderIssueDetail },
  "#/products": { title: "제품 목록", render: renderProducts },
  "#/products/:id": { title: "제품 상세", render: renderProductDetail },
  "#/samples": { title: "검체", render: renderSamples }, // spec 008
  "#/work-orders": { title: "작업지시", render: renderWorkOrders }, // spec 010 IA WO_010000_PG
};

// 이 주소 권한을 가진 역할 이름 (화면을 못 열 때 안내용)
const PAGE_OWNERS = {
  "#/home/qa": "QA 관리자",
  "#/home/qc": "QC 시험 담당자·QA 관리자",
  "#/home/production": "생산 담당자·QA 관리자",
  "#/admin/users": "QA 관리자",
  "#/admin/approvals": "QA 관리자",
  "#/admin/history": "QA 관리자",
  "#/admin/usage": "QA 관리자",
};

let session = null;
let loginFailed = false;
let renderCount = 0;
let lastLoggedPath = null; // spec 003 FR-008: 같은 화면을 다시 그릴 때(저장 뒤 새로 고침)는 남기지 않는다

/**
 * 로그인(GitHub·구글)에서 돌아온 주소(?code=, ?error=)를 깨끗이 한다. 실패였으면 표시 (FR-001 수용 기준 2)
 * supabase-js가 ?code=로 로그인을 마친 뒤(getSession 이후)에 불러야 한다. 먼저 지우면 로그인이 끝나지 않는다
 */
function clearAuthResult() {
  const params = new URLSearchParams(location.search);
  const hashFailed = location.hash.startsWith("#error");
  loginFailed = params.has("error") || hashFailed;
  // spec 003 FR-008: 구글에서 막 돌아와 로그인이 끝났으면 로그인 기록
  if (params.has("code") && session) logUsage(session.user.id, "login");
  if (params.has("code") || params.has("error") || hashFailed) {
    history.replaceState(null, "", `${location.pathname}${hashFailed ? "" : location.hash}`);
  }
}

function pageFor(path) {
  return PAGES[path] ?? null;
}

async function pageContent(current, profile) {
  const { path, id, query } = current;
  const page = pageFor(path);
  if (!page) return message("찾을 수 없는 화면", "주소가 맞는지 확인하거나 메뉴에서 화면을 골라 주세요.");
  // FR-004 수용 기준 4, FR-006: 권한 없는 화면은 안내만
  if (!canOpen(profile.role, path)) {
    return message(page.title, `이 화면은 ${PAGE_OWNERS[path]}만 볼 수 있습니다.`);
  }
  if (!page.render) return message(page.title, "이 화면은 다음 단계에서 만듭니다.");
  return page.render({ profile, id, query });
}

function message(title, text) {
  return h("section", { class: "panel" }, h("h1", { class: "page-title" }, title), h("p", { class: "muted" }, text));
}

// 빈 화면 대신 뼈대: 곧 나올 제목과 카드 자리가 먼저 보여서 덜 기다리는 느낌이다
function loadingView() {
  return h("div", { class: "skeleton", role: "status", "aria-label": "불러오는 중" },
    h("span", { class: "skel skel--title" }),
    h("span", { class: "skel skel--card" }),
    h("span", { class: "skel skel--card" }));
}

function errorView(error) {
  return h("section", { class: "panel" },
    h("p", { class: "error-text", role: "alert" }, error.message),
    h("button", { class: "button", type: "button", onclick: route }, "다시 시도"));
}

async function route() {
  const app = document.getElementById("app");
  const thisRender = ++renderCount;
  clearScreenFacts(); // AI 도우미가 이전 화면의 숫자를 섞지 않게 (spec 025)

  // FR-002: 로그인하지 않았으면 어느 주소로 오든 로그인 화면
  if (!session) {
    put(app, renderLogin({ failed: loginFailed }));
    document.title = "로그인 · PharmaFlow";
    return;
  }

  // FR-004 수용 기준 2: 다시 로그인하지 않아도 역할이 바뀌면 다음 화면부터 적용되도록 매번 읽는다
  let profile;
  try {
    profile = await loadMyProfile(session.user.id);
  } catch (error) {
    put(app, errorView(error));
    return;
  }
  if (thisRender !== renderCount) return; // 더 새로운 화면 이동이 이미 시작됐으면 이 응답으로 화면을 지우지 않는다
  profile ??= { id: session.user.id, display_name: session.user.email ?? "", role: "viewer" };
  setAiUser(`${profile.id}.${profile.role}`); // AI 요약 보관 결과를 사람과 역할별로 나눈다(계정·역할이 바뀌면 이전 결과를 쓰지 않는다)

  const current = parseRoute(location.hash);
  const { path } = current;
  if (!path || path === "#" || path === "#/" || path === "#/login") {
    location.replace(homePathFor(profile.role)); // FR-005 역할별 첫 화면
    return;
  }

  const main = h("div", null, loadingView());
  put(app, renderLayout({
    role: profile.role,
    userId: profile.id,
    userName: profile.display_name,
    currentPath: path.replace("/:id", ""),
    content: main,
    onSignOut: async () => {
      await logUsage(profile.id, "logout"); // 로그아웃 뒤에는 본인 기록을 쓸 수 없어 먼저 남긴다
      lastLoggedPath = null;
      clearAiCache();
      signOut();
    },
  }));
  document.title = `${pageFor(path)?.title ?? "찾을 수 없는 화면"} · PharmaFlow Bio`;
  const shownPath = pagePath(location.hash);
  if (shownPath !== lastLoggedPath) {
    lastLoggedPath = shownPath;
    logUsage(profile.id, "page_view", { path: shownPath }); // FR-008: 화면 이동 (기다리지 않는다)
  }

  try {
    const content = await pageContent(current, profile);
    if (thisRender === renderCount) put(main, content);
  } catch (error) {
    if (thisRender === renderCount) put(main, errorView(error));
  }
}

async function start() {
  try {
    session = await getSession();
  } catch (error) {
    put(document.getElementById("app"), errorView(error));
    return;
  } finally {
    clearAuthResult();
  }
  onAuthChange(async (event) => {
    if (event === "SIGNED_OUT") {
      session = null;
      history.replaceState(null, "", `${location.pathname}#/login`);
      route();
    } else if (event === "SIGNED_IN" && !session) {
      session = await getSession();
      route();
    }
  });
  window.addEventListener("hashchange", route);
  route();
}

start();
