// 기능 009: 슬랙 알림. 보내기는 api/notify.js가 하고, 여기서는 부르기와 기록 읽기만 (ADR 0003)
import { client, read, call } from "./store.js";

/**
 * FR-002: 저장에 성공한 뒤, 그리고 알림 함이 1분마다 확인할 때 부른다. 결과를 기다리지 않고 실패도 화면에 알리지 않는다 (FR-004).
 * 내가 일으킨 알림과 나에게 온 대기 알림을 보낸다 (Q51 해결, spec 009 v0.4)
 */
export async function flushNotifications() {
  try {
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch("/api/notify", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // 알림은 업무 저장과 따로다. 기록은 사용 기록 화면의 슬랙 알림 기록에 남는다
  }
}

/**
 * spec 018 FR-003: 보관 기한이 된 보존 검체 알림을 만든다(한 번만, DB가 막음). 알림 함이 확인할 때 부른다.
 * 알림은 업무 저장과 따로라 실패해도 화면에 알리지 않는다 (spec 009 FR-004와 같음)
 */
export async function checkDueRetention() {
  try {
    await client.rpc("notify_due_retention");
  } catch {
    // 다음 확인(1분 뒤) 때 다시 부른다
  }
}

/** FR-005: 최근 알림 (QA 관리자만 읽힘, RLS) */
export async function listNotifications(limit = 30) {
  return read(client.from("notification")
    .select("id, kind, batch_number, message, status, reason, created_at, sent_at, slack_acknowledged_at, recipient:recipient_id (display_name), creator:created_by (display_name)")
    .order("created_at", { ascending: false })
    .limit(limit));
}

const INBOX_FIELDS = "id, kind, message, link_path, created_at, read_at, slack_acknowledged_at, creator:created_by (display_name)";

/** FR-007: 나에게 온 최근 알림 (QA 관리자도 여기서는 자기 것만) @param {string} userId */
export async function listMyNotifications(userId, limit = 20) {
  return read(client.from("notification").select(INBOX_FIELDS)
    .eq("recipient_id", userId).order("created_at", { ascending: false }).limit(limit));
}

/** FR-007 수용 기준 1: 내 안 읽은 알림 수 @param {string} userId */
export async function countMyUnread(userId) {
  const { count, error } = await client.from("notification").select("id", { count: "exact", head: true })
    .eq("recipient_id", userId).is("read_at", null);
  if (error) throw new Error("알림을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.");
  return count ?? 0;
}

/** FR-007 수용 기준 3·4: 읽음 처리. ids가 없으면 모두 @param {string[] | null} ids */
export async function markNotificationsRead(ids) {
  return call("mark_notifications_read", { p_ids: ids });
}

/**
 * spec 009 v0.7 FR-009: 이 기록들에서 나온 알림의 받는 사람·결과·슬랙 확인 시각. 읽을 수 있는 줄만 온다(받는 사람·일으킨 사람·QA, RLS)
 * @param {string} targetTable
 * @param {string[]} ids
 * @param {string[]} [kinds] 이 종류만 (예: 작업지시는 발행 알림만)
 */
export async function listAcksFor(targetTable, ids, kinds) {
  if (!ids.length) return [];
  let query = client.from("notification")
    .select("target_id, kind, created_at, status, slack_acknowledged_at, recipient:recipient_id (display_name)")
    .eq("target_table", targetTable).in("target_id", ids);
  if (kinds?.length) query = query.in("kind", kinds);
  return read(query);
}

/** FR-009 수용 기준 4: 그 로트 알림 수와 슬랙 확인 수 (기록을 모르는 예전 알림도 센다) @param {string} batchNumber */
export async function countLotAcks(batchNumber) {
  const rows = await read(client.from("notification").select("slack_acknowledged_at").eq("batch_number", batchNumber));
  return { total: rows.length, acked: rows.filter((row) => row.slack_acknowledged_at).length };
}
