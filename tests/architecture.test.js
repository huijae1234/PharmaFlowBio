import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// engineering.md: 안쪽 규칙(domain)은 화면·저장·서버 함수를 알지 못한다. 어긋난 import는 여기서 잡는다
const FORBIDDEN = /from\s+["'][^"']*(\/ui\/|\/infrastructure\/|\/api\/|supabase)/;

test("domain 폴더는 ui·infrastructure·api·supabase를 가져오지 않는다", () => {
  const dir = new URL("../src/domain/", import.meta.url);
  const bad = readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => FORBIDDEN.test(readFileSync(new URL(name, dir), "utf8")));
  assert.deepEqual(bad, []);
});

test("화면 코드(src/)에 관리자 키 이름이 코드로 들어가지 않는다 (주석은 제외)", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) files.push(path);
    }
  };
  walk(new URL("../src/", import.meta.url));
  const bad = files.filter((file) =>
    readFileSync(file, "utf8").split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .some((line) => /service_role|sb_secret_|xox[bp]-/.test(line)));
  assert.deepEqual(bad.map(String), []);
});
