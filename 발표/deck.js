// 발표 뷰어: 화면에 맞춰 1280×720 무대를 확대·축소하고, ←/→·스페이스·Home·End·F·N 키로 움직인다.
// 내용은 index.html에만 있다. 이 파일은 내용을 바꾸지 않는다.
(() => {
  const slides = [...document.querySelectorAll(".slide")];
  const stage = document.querySelector(".stage");
  const hud = document.querySelector(".hud-pos");
  const panel = document.querySelector(".notes-panel");
  let cur = 0;

  const fit = () => {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    stage.style.transform = `scale(${s})`;
    // 무대 안의 iframe(ERD 그림)도 같은 비율로 맞춘다
    // data-crop="x,y,폭": 그림의 이 부분만 칸 너비에 맞춰 보인다(없으면 전체)
    document.querySelectorAll("iframe.embed").forEach((f) => {
      const w = f.parentElement;
      const [x, y, cw] = (w.dataset.crop || "0,0,1280").split(",").map(Number);
      const k = w.clientWidth / cw;
      f.style.transform = `scale(${k}) translate(${-x}px, ${-y}px)`;
    });
  };

  const notes = (el) => {
    const n = el.querySelector("aside.notes");
    return n ? n.innerHTML : "<p>메모 없음</p>";
  };

  const show = (i) => {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => s.classList.toggle("on", k === cur));
    const el = slides[cur];
    hud.textContent = `${cur + 1} / ${slides.length} · ${el.dataset.time ? el.dataset.time + "초" : "부록(시간 밖)"}`;
    panel.innerHTML = notes(el);
    history.replaceState(null, "", "#" + (el.id || cur + 1));
    fit();
  };

  addEventListener("resize", fit);
  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); show(cur + 1); }
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { e.preventDefault(); show(cur - 1); }
    else if (k === "Home") show(0);
    else if (k === "End") show(slides.length - 1);
    else if (k === "n" || k === "N" || k === "ㅜ") panel.classList.toggle("on");
    else if (k === "f" || k === "F" || k === "ㄹ") {
      // 전체 화면은 사용자가 키를 눌렀을 때만 켠다. ESC로 나온다.
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
  });
  // 화면 좌우 가장자리 클릭으로도 이동
  stage.addEventListener("click", (e) => {
    if (e.target.closest("a,iframe,button")) return;
    const r = stage.getBoundingClientRect();
    show(e.clientX - r.left > r.width / 2 ? cur + 1 : cur - 1);
  });

  const start = slides.findIndex((s) => "#" + s.id === location.hash);
  show(start >= 0 ? start : 0);
})();
