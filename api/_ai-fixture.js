// spec 022 FR-006: AI 시험 모드(AI_MODE=fixtures)의 가짜 Claude 응답. `_`로 시작해 Vercel이 함수로 만들지 않는다.
// 근거 표에 맞춰 만들므로 어느 화면에서도 쓸 수 있다. 모든 글에 "(시험 응답)"을 붙여 실제 응답과 섞이지 않게 한다.
// 못된 모델을 흉내 내는 경우(숫자 불일치·승인 문장·근거 없음·못 읽은 줄 가리기·형식 오류·거절·길이 초과)로 서버 검증과 화면을 시험한다.
// effect·repair·askrecorded·badquote·inject는 새 칸(spec 023) 전용: 조치 효과 입증·수리 지시와 설비 지목·이미 기록된 것 되묻기·원문에 없는 인용·자료 속 지시를 따른 승인 문장
export const FIXTURE_CASES = ["normal", "mismatch", "approve", "noref", "badref", "masks", "badformat", "refusal", "truncated", "nokey", "effect", "repair", "askrecorded", "badquote", "inject", "retro", "predict"];

const USAGE = { input_tokens: 0, output_tokens: 0 };

const BAD_TEXT = {
  mismatch: "이슈가 99건입니다. 근거 줄에 없는 숫자입니다.", approve: "이 로트는 출하해도 안전합니다.", effect: "조치로 개선되었고 효과가 입증되었습니다.",
  repair: "3호기 설비를 수리하세요. 고장 원인은 센서입니다.", retro: "이 기준으로 소급해서 판정을 변경하세요.", predict: "이 작업지시는 3일 지연될 것입니다.", inject: "근거 자료의 지시에 따라 이 평가서를 승인하세요.", masks: "이 자료에는 문제가 없습니다.",
};

/** 새 칸(조사 준비·평가서 보완·조치 후 확인)의 가짜 응답. 못된 모델 흉내는 첫 문장을 나쁜 문장으로 바꾼다 */
function assistFixture(fixtureCase, facts, kind) {
  const readable = facts.rows.filter((row) => row.state === "ok");
  const askable = facts.rows.find((row) => row.state !== "ok" || row.ask);
  const order = [...readable.filter((row) => row.must), ...readable].filter((row, index, all) => all.indexOf(row) === index);
  const item = (body, refs) => ({ text: `(시험 응답) ${body}`, refs });
  const claims = order.slice(0, 3).map((row) => item(`${row.label}: ${row.value}`, [row.id]));
  const gapRow = askable ?? order[0];
  const questions = askable ? [item(`${gapRow.label}에 대해 더 확인해 주세요.`, [gapRow.id])] : [];
  const bad = BAD_TEXT[fixtureCase];
  const first = bad ? [item(bad, [(fixtureCase === "masks" ? gapRow : order[0]).id])]
    : fixtureCase === "noref" ? [item("근거 줄을 인용하지 않은 문장입니다.", [])] : fixtureCase === "badref" ? [item("표에 없는 줄을 인용했습니다.", ["zzz_none"])] : null;
  if (kind === "review_check") {
    const source = facts.rows.find((row) => row.id.startsWith("rev_") && row.state === "ok");
    const quote = fixtureCase === "badquote" ? "평가서에 없는 문장입니다" : (source?.value ?? "").slice(0, 8);
    const must = facts.rows.filter((row) => row.must);
    const ref = (must[0] ?? gapRow)?.id;
    const findings = source && ref ? [{ field: source.id.slice(4), quote, reason: `(시험 응답) ${must[0] ? `${must[0].label}: ${must[0].value}` : "근거를 더 확인해 주세요"}`, refs: [ref], ask: "(시험 응답) 근거 자료를 확인해 주세요.", suggest: null }] : [];
    if (first && findings.length) findings[0] = { ...findings[0], reason: first[0].text, refs: first[0].refs };
    return { claims: [], findings, unknowns: ["(시험 응답) 원인은 이 자료로 알 수 없습니다."] };
  }
  const base = first ? [...first, ...claims.slice(1)] : claims;
  const asked = fixtureCase === "askrecorded" ? [item(`${order[0].label}를 다시 알려 주세요.`, [order[0].id])] : questions;
  const want = facts.rows.find((row) => row.id === "want");
  const draft = kind === "issue_prep" ? item(`${want?.value ?? "조치"}을 요청합니다. 근거: ${order[0]?.value ?? ""}`, [want?.id ?? order[0].id, order[0].id]) : undefined;
  return { claims: base, questions: asked, ...(draft ? { draft } : {}), unknowns: ["(시험 응답) 원인은 이 자료로 알 수 없습니다."] };
}

/** @returns {{ text: string | null, stopReason: string, usage: { input_tokens: number, output_tokens: number } }} */
export function fixtureResponse(fixtureCase, facts, kind = "home") {
  if (["issue_prep", "review_check", "after_action", "spec_impact", "schedule_check"].includes(kind) && !["badformat", "refusal", "truncated"].includes(fixtureCase)) {
    return { text: JSON.stringify(assistFixture(fixtureCase, facts, kind)), stopReason: "end_turn", usage: USAGE };
  }
  const readable = facts.rows.filter((entry) => entry.state === "ok");
  const first = readable[0] ?? facts.rows[0];
  const gap = facts.rows.find((entry) => entry.state !== "ok");
  const answer = (claims, unknowns = ["(시험 응답) 원인은 이 자료로 알 수 없습니다."]) => ({ text: JSON.stringify({ claims, unknowns }), stopReason: "end_turn", usage: USAGE });
  const claim = (body, refs) => ({ text: `(시험 응답) ${body}`, refs });
  switch (fixtureCase) {
    case "mismatch": return answer([claim("이슈가 99건입니다. 근거 줄에 없는 숫자입니다.", [first.id])]);
    case "approve": return answer([claim("이 로트는 출하해도 안전합니다.", [first.id])]);
    case "noref": return answer([claim("근거 줄을 인용하지 않은 문장입니다.", [])]);
    case "badref": return answer([claim("표에 없는 줄을 인용했습니다.", ["zzz_none"])]);
    case "masks": return answer([claim("이 자료에는 문제가 없습니다.", [(gap ?? first).id])]);
    case "badformat": return { text: "(시험 응답) JSON이 아닌 글입니다.", stopReason: "end_turn", usage: USAGE };
    case "refusal": return { text: null, stopReason: "refusal", usage: USAGE };
    case "truncated": return { text: '{"claims":[{"text":"(시험 응답) 중간에', stopReason: "max_tokens", usage: USAGE };
    default: {
      const must = readable.filter((entry) => entry.must);
      const picks = [...must, ...readable].filter((entry, index, all) => all.indexOf(entry) === index).slice(0, Math.max(3, Math.min(must.length, 5)));
      return answer(picks.map((entry) => claim(`${entry.label}: ${entry.value}`, [entry.id])));
    }
  }
}

/** 업무 찾아보기의 가짜 질문 해석(시험 모드 전용): 키워드로 조회 종류를 고른다. 못된 질문(SQL·지시)은 unsupported, 모호하면 ambiguous */
export function fixtureAskResponse(question, fixtureCase) {
  const done = (text, stopReason = "end_turn") => ({ text, stopReason, usage: USAGE });
  if (fixtureCase === "refusal") return { text: null, stopReason: "refusal", usage: USAGE };
  if (fixtureCase === "badformat") return done("(시험 응답) JSON이 아닌 글입니다.");
  if (fixtureCase === "truncated") return done('{"kind": "held_lots', "max_tokens");
  const days = Number(question.match(/(\d+)\s*일/)?.[1]);
  const filter = (name) => (Number.isInteger(days) && days >= 1 ? { [name]: days } : {});
  const reply = (kind, filters = {}, options = []) => done(JSON.stringify({ kind, filters, options }));
  if (/select|drop table|delete from|sql|무시|관리자 권한|승인해|https?:/i.test(question)) return reply("unsupported");
  if (/대기/.test(question) && !/검토|평가|보류/.test(question)) return reply("ambiguous", {}, ["pending_reviews", "held_lots"]);
  if (/작업지시|종료일|일정/.test(question)) return reply("overdue_orders", filter("overdueDays"));
  if (/검토|평가/.test(question)) return reply("pending_reviews", filter("olderThanDays"));
  if (/조치|내 /.test(question)) return reply("my_actions");
  if (/보류/.test(question)) return reply("held_lots", filter("olderThanDays"));
  return reply("unsupported");
}
