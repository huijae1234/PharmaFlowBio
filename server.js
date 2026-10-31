// 로컬 서버 (ADR 0001): 정적 파일과 api/ 함수를 Vercel과 같은 주소로 돌린다. 외부 라이브러리 없음.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// 비밀 값·저장소 파일은 내보내지 않는다 (plan 001 §5 보안)
const BLOCKED_TOP = new Set(["api", "supabase", "tests", "docs", "fixtures", "node_modules", "server.js", "package.json", "vercel.json"]); // fixtures: spec 019

/**
 * 내보내도 되는 파일이면 실제 경로, 아니면 null(404).
 * @param {string} urlPath
 * @returns {string | null}
 */
export function resolveStaticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // 깨진 주소(%E0 등)로 서버가 꺼지지 않게
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const parts = relative.split(/[/\\]/);
  if (parts.some((part) => part.startsWith(".")) || BLOCKED_TOP.has(parts[0])) return null;
  const filePath = join(ROOT, relative || "index.html");
  return filePath.startsWith(ROOT) ? filePath : null;
}

async function serveStatic(urlPath, res) {
  const filePath = resolveStaticPath(urlPath);
  if (!filePath) return sendText(res, 404, "찾을 수 없습니다.");
  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, "index.html") : filePath;
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    sendText(res, 404, "찾을 수 없습니다.");
  }
}

/**
 * 함수로 부를 수 있는 이름인가. `_`로 시작하는 공통 파일(api/_public-data.js)은 Vercel처럼 함수로 열지 않는다 (plan 003 §2)
 * @param {string} name
 */
export function isApiName(name) {
  return /^[a-z0-9-]+$/.test(name);
}

async function serveApi(name, req, res) {
  const filePath = join(ROOT, "api", `${name}.js`);
  const exists = isApiName(name) && (await stat(filePath).catch(() => null))?.isFile();
  if (!exists) return sendText(res, 404, "찾을 수 없습니다.");
  try {
    const module = await import(pathToFileURL(filePath).href);
    await module.default(req, res);
  } catch (error) {
    console.error(`api/${name} 오류:`, error.message);
    if (!res.headersSent) sendText(res, 500, "서버 오류가 났습니다.");
  }
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function startServer() {
  createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const apiMatch = url.pathname.match(/^\/api\/([^/]+)$/);
    if (apiMatch) return serveApi(apiMatch[1], req, res);
    return serveStatic(url.pathname, res);
  }).listen(PORT, () => console.log(`PharmaFlow 로컬 서버: http://localhost:${PORT}`));
}

// 시험에서 resolveStaticPath만 불러올 때는 서버를 켜지 않는다
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();
