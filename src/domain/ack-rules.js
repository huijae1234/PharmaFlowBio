// 슬랙 확인을 그 일의 화면에 (spec 009 v0.7 FR-009). 줄 옆 글자와 바뀐 줄 고르기만 — 순수 함수

/** @typedef {{ target_id: string, kind?: string, created_at?: string, recipient?: { display_name: string } | null, status: string, slack_acknowledged_at: string | null }} AckNote */

const SAME_ROUND_MS = 5000; // 한 저장에서 받는 사람마다 만든 알림은 몇 ms 차이로 생긴다

const nameOf = (n) => n.recipient?.display_name ?? "";

/**
 * FR-009 수용 기준 1~3·7: 한 기록에 온 알림들(받는 사람마다 한 줄)을 줄 옆 글자로. 알림이 없으면 빈 글자
 * @param {AckNote[] | undefined} notes
 * @param {(iso: string) => string} format 화면의 시각 글자 함수
 */
export function ackText(notes, format) {
  if (!notes?.length) return "";
  const acked = notes.filter((n) => n.slack_acknowledged_at)
    .sort((a, b) => a.slack_acknowledged_at.localeCompare(b.slack_acknowledged_at));
  if (notes.length === 1) {
    const [only] = notes;
    if (only.slack_acknowledged_at) return `✓ ${nameOf(only)} 확인 · ${format(only.slack_acknowledged_at)}`;
    if (only.status === "sent_channel") return "채널로 보냄 · 슬랙 확인 없음";
    if (only.status === "failed") return "알림 · 보내지 못함";
    return `알림 · ${nameOf(only)} 확인 전`;
  }
  if (!acked.length) return `알림 · ${notes.length}명 확인 전`;
  const first = acked[0];
  return `✓ ${notes.length}명 중 ${acked.length}명 확인 (${nameOf(first)} ${format(first.slack_acknowledged_at)})`;
}

/** 기록 id → 그 기록의 알림들 @param {AckNote[]} rows @returns {Map<string, AckNote[]>} */
export function groupByTarget(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.target_id)) grouped.set(row.target_id, []);
    grouped.get(row.target_id).push(row);
  }
  return grouped;
}

/** 한 명이라도 슬랙에서 확인했나 @param {AckNote[] | undefined} notes */
export function isAcked(notes) {
  return Boolean(notes?.some((n) => n.slack_acknowledged_at));
}

/**
 * FR-009 수용 기준 2: 30초 확인 때 새로 확인된 기록 id (그 줄만 강조)
 * @param {Map<string, AckNote[]>} before
 * @param {Map<string, AckNote[]>} after
 */
export function newlyAcked(before, after) {
  return [...after.keys()].filter((id) => isAcked(after.get(id)) && !isAcked(before.get(id)));
}

/** FR-009 수용 기준 4: 로트 위쪽 집계 @param {number} total @param {number} acked */
export function lotAckText(total, acked) {
  return total ? `이 로트 알림 ${total}건 중 ${acked}건 확인` : "";
}

/**
 * 한 기록에 알림이 여러 번 갔으면(예: 승인 대기 → 배정) 가장 최근 것만: 같은 종류이고 5초 안에 만든 알림들
 * @param {AckNote[]} notes
 */
export function latestNotes(notes) {
  if (!notes.length) return [];
  const latest = notes.reduce((a, b) => ((b.created_at ?? "") > (a.created_at ?? "") ? b : a));
  const until = Date.parse(latest.created_at ?? "") - SAME_ROUND_MS;
  return notes.filter((n) => n.kind === latest.kind && Date.parse(n.created_at ?? "") >= until);
}
