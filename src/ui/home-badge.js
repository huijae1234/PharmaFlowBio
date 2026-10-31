// 사이드바 "홈" 옆 건수: 홈이 "지금 할 일"을 그릴 때 그 건수를 여기에 알려 주면, 지금 떠 있는 배지가 같은 숫자를 보인다.
// 홈을 아직 열지 않았으면 비워 둔다 (승인 대기 배지처럼 숫자가 없으면 안 보인다)
let current = null;
let lastCount = null;

function paint() {
  if (current) current.textContent = lastCount ? String(lastCount) : "";
}

/** @param {number} count */
export function setHomeTaskCount(count) {
  lastCount = count;
  paint();
}

/** 사이드바가 새로 그려질 때 배지 칸을 등록한다 (마지막으로 읽은 건수를 바로 보인다) */
export function registerHomeBadge(element) {
  current = element;
  paint();
}
