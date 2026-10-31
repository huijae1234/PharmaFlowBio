import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveStaticPath, isApiName } from "../server.js";

test("비밀 값·저장소 파일은 내보내지 않는다 (plan 001 §5 보안)", () => {
  for (const path of ["/.env", "/.env.example", "/.git/config", "/docs/PRD.md", "/supabase/x.sql",
    "/tests/roles.test.js", "/server.js", "/package.json", "/api/permit.js", "/styles/.hidden",
    "/fixtures/measurements.json", "/fixtures/broken/public/error-code.json"]) { // fixtures: spec 019 FR-001
    assert.equal(resolveStaticPath(path), null, path);
  }
});

test("../ 로 프로젝트 폴더 밖 파일을 열 수 없다", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const path of ["/../secret.txt", "/..%2f..%2fwindows/win.ini", "/%2e%2e/%2e%2e/x"]) {
    const resolved = resolveStaticPath(path);
    assert.ok(resolved === null || resolved.startsWith(root), `${path} → ${resolved}`);
  }
});

test("깨진 주소는 404로 처리하고 서버를 멈추지 않는다", () => {
  assert.equal(resolveStaticPath("/%E0"), null);
  assert.equal(resolveStaticPath("/%"), null);
});

test("화면 파일은 내보낸다", () => {
  assert.match(resolveStaticPath("/"), /index\.html$/);
  assert.match(resolveStaticPath("/styles/app.css"), /styles[/\\]app\.css$/);
  assert.match(resolveStaticPath("/src/ui/app.js"), /src[/\\]ui[/\\]app\.js$/);
});

test("api 이름: 공통 파일(_로 시작)과 이상한 이름은 함수로 부르지 않는다 (plan 003 §2)", () => {
  assert.equal(isApiName("permit"), true);
  assert.equal(isApiName("recall"), true);
  for (const name of ["_public-data", "../server", "Permit", "permit.js", ""]) assert.equal(isApiName(name), false, name);
});
