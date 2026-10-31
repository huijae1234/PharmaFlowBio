// AI 도우미가 함께 볼 "지금 화면" 한 칸 (spec 025 FR-004). 화면은 종류·이름·로트 id만 알리고, 근거 표는 서버가 읽는다(홈 v0.5 8단계, 로트 9단계).
// 화면을 옮길 때마다 비운다(app.js): 다른 화면의 숫자와 섞이지 않게.
import { CHAT_SCREEN_KINDS } from "../domain/chat-rules.js";

const TITLES = { home: "홈", lot: "로트 상세" };
let current = null;

/** @param {{ kind: string, title?: string, batchId?: string }} screen 근거 표를 쓰지 않는 종류는 무시한다 */
export function setScreenFacts({ kind, title, batchId = null }) {
  if (CHAT_SCREEN_KINDS.includes(kind)) current = { kind, title: title ?? TITLES[kind], batchId };
}

/** @returns {{ kind: string, title: string, batchId: string | null } | null} */
export const screenFacts = () => current;

export function clearScreenFacts() {
  current = null;
}
