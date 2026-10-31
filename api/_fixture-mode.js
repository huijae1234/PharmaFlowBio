// spec 019 FR-002: 공공데이터 시험 모드. 로컬에서 PUBLIC_DATA_MODE=fixtures로 켜면 실제 사이트 대신 fixtures/ 파일을 돌려준다.
// `_`로 시작해 Vercel이 함수로 만들지 않는다. 배포(VERCEL 값이 있음)에서는 늘 꺼진다 (spec Q3)
import { readFile } from "node:fs/promises";

const ROOT = new URL("../fixtures/", import.meta.url);

// spec Q4: 검색어로 응답을 고른다. 없는 검색어는 정상 자료
const BY_KEYWORD = {
  없음: (kind) => `public/${kind}-empty.json`,
  실패: () => "broken/public/error-code.json",
  XML: () => "broken/public/xml-error.xml",
  깨짐: () => "broken/public/broken.json",
  중복: () => "broken/public/permit-duplicate.json",
  빈칸: () => "broken/public/permit-missing-fields.json",
  // spec 021: GMP 업체명 검색어로 고르는 자료. 다른 종류면 정상 자료
  임박: (kind) => (kind === "gmp" ? "public/gmp-soon.json" : `public/${kind}-normal.json`),
  만료: (kind) => (kind === "gmp" ? "public/gmp-expired.json" : `public/${kind}-normal.json`),
  다른회사: (kind) => (kind === "gmp" ? "public/gmp-other.json" : `public/${kind}-normal.json`),
  비백신: (kind) => (kind === "gmp" ? "public/gmp-no-vaccine.json" : `public/${kind}-normal.json`),
};

/** @param {Record<string, string | undefined>} [env] */
export function fixtureModeOn(env = process.env) {
  return env.PUBLIC_DATA_MODE === "fixtures" && !env.VERCEL;
}

/**
 * fetch 대신 쓰는 가짜 호출. 주소로 허가정보·회수·GMP·국가출하승인을 가리고 검색어(item_name·Prduct·BSSH_NM)로 파일을 고른다
 * @param {URL} url
 */
export async function fixtureFetch(url) {
  const kind = url.pathname.includes("Rtrvl") ? "recall" : url.pathname.includes("Gmp") ? "gmp" : url.pathname.includes("Shipmnt") ? "shipment" : "permit";
  const keyword = (url.searchParams.get("item_name") ?? url.searchParams.get("Prduct") ?? url.searchParams.get("BSSH_NM") ?? "").trim();
  if (keyword === "시간초과") {
    const error = new Error("시험 자료: 시간 초과");
    error.name = "TimeoutError";
    throw error;
  }
  let file = BY_KEYWORD[keyword]?.(kind) ?? `public/${kind}-normal.json`;
  // spec 021: 국가출하승인은 건수를 먼저 보고 끝 쪽을 받는다. 시험 자료는 8줄이라 끝 쪽이 1쪽이고, 다른 쪽은 비워 같은 줄이 겹치지 않게 한다
  if (kind === "shipment" && url.searchParams.get("pageNo") !== "1") file = "public/shipment-empty.json";
  const text = await readFile(new URL(file, ROOT), "utf8"); // 못 읽으면 던져서 "연결 실패"가 된다
  return { ok: true, status: 200, text: async () => text };
}
