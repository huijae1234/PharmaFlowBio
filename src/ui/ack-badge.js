// spec 009 v0.7 FR-009: 슬랙 확인을 그 기록 줄 옆에. 화면을 열어 둔 동안 30초마다 확인하고 새로 확인된 줄만 바꿔 강조한다.
// 화면 전체를 다시 그리지 않는다 (입력 중인 창이 닫히지 않게)
import { h, formatDateTime } from "./dom.js";
import { ackText, groupByTarget, isAcked, latestNotes, newlyAcked } from "../domain/ack-rules.js";

const INTERVAL_MS = 30000; // Q75

/** 줄 옆 자리. 처음엔 비어 있고 watchAcks가 채운다 @param {string} targetId */
export function ackSlot(targetId) {
  return h("span", { class: "ack-slot", "data-ack-target": targetId, "aria-live": "polite" });
}

function latestByTarget(rows) {
  const grouped = groupByTarget(rows);
  for (const [id, notes] of grouped) grouped.set(id, latestNotes(notes));
  return grouped;
}

function paint(root, grouped) {
  for (const slot of root.querySelectorAll("[data-ack-target]")) {
    const notes = grouped.get(slot.dataset.ackTarget);
    slot.textContent = ackText(notes, formatDateTime);
    slot.classList.toggle("ack-slot--done", isAcked(notes));
  }
}

function flash(root, id) {
  const slot = [...root.querySelectorAll("[data-ack-target]")].find((node) => node.dataset.ackTarget === id);
  const row = slot?.closest("tr, li, .record") ?? slot;
  if (!row) return;
  row.classList.remove("ack-flash");
  void row.offsetWidth; // 같은 줄이 다시 확인돼도 강조가 다시 시작되게
  row.classList.add("ack-flash");
}

/**
 * @param {HTMLElement} root 줄 옆 자리(ackSlot)가 들어 있는 화면
 * @param {() => Promise<object[]>} load 이 화면 기록들의 알림 읽기
 */
export function watchAcks(root, load) {
  const path = location.hash;
  let current = new Map();
  let timer = null;
  async function tick(first) {
    if (!first && document.hidden) return;
    let rows;
    try {
      rows = await load();
    } catch {
      return; // 확인 표시는 보조 정보다. 못 읽으면 지금 표시를 그대로 두고 다음 확인 때 다시 읽는다
    }
    if (location.hash !== path || !root.isConnected) {
      clearInterval(timer);
      return;
    }
    const next = latestByTarget(rows);
    const fresh = first ? [] : newlyAcked(current, next);
    current = next;
    paint(root, next);
    fresh.forEach((id) => flash(root, id));
  }
  timer = setInterval(() => tick(false), INTERVAL_MS);
  tick(true);
}
