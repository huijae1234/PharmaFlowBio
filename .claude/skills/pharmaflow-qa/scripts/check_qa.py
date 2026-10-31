r"""qa.md 표를 검사한다. (PharmaFlow 팀 스킬 pharmaflow-qa)

사용: py -X utf8 .claude/skills/pharmaflow-qa/scripts/check_qa.py <기능 폴더>   (예: docs/specs/026-아침-브리핑-슬랙)

문제(종료 코드 1)
- C·H 줄의 칸 수가 그 표의 머리 줄과 같은가 (기본 틀은 9칸. 글 안에 "|"를 그대로 쓰면 칸이 늘어 표가 깨진다 → "\|"로)
  (2026-10-29 표를 고치는 스크립트가 "기대 결과" 칸을 지운 일이 있었다 — qa 025 실패와 조치 7)
- 증거 칸이 있는 표에서, "통과"로 적은 줄에 증거가 비어 있지 않은가 (증거 없이 통과로 적지 않는다)
- 같은 폴더 spec.md의 SC 번호가 모두 qa.md에 나오는가 (삭제된 SC는 뺀다)
경고(실패는 아님)
- 머리말 "요약: C a/b"의 b가 C 줄 수와 다른가, a가 통과 줄 수와 다른가
"""
import re
import sys
from pathlib import Path


def cells(line):
    """표 한 줄을 칸으로. 글 안의 \\| 는 칸 구분이 아니다."""
    parts = line.replace("\\|", "¦").strip().split("|")
    return [p.strip() for p in parts[1:-1]]


def passed(result):
    final = result.split("→")[-1].strip()
    return final.startswith("통과")


def main(folder):
    folder = Path(folder)
    qa_p, spec_p = folder / "qa.md", folder / "spec.md"
    if not qa_p.exists():
        print(f"qa.md 없음: {qa_p}")
        return 1
    qa = qa_p.read_text(encoding="utf-8")
    problems, warnings = [], []
    c_rows, h_rows = [], []
    lines = qa.splitlines()
    header = None
    for i, line in enumerate(lines):
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[-| :]+\|$", lines[i + 1].strip()):
            header = cells(line)
            continue
        m = re.match(r"^\| ([CH])-\d+ \|", line)
        if not m or header is None:
            continue
        row = cells(line)
        (c_rows if m.group(1) == "C" else h_rows).append((row, header))
        if len(row) != len(header):
            problems.append(f"{row[0]}: 칸 {len(row)}개 (표 머리는 {len(header)}칸) — 글 안의 |를 \\|로")
            continue
        if "결과" in header and "증거" in header and passed(row[header.index("결과")]) and not row[header.index("증거")]:
            problems.append(f"{row[0]}: 통과인데 증거 칸이 비었음")
    if spec_p.exists():
        spec = spec_p.read_text(encoding="utf-8")
        alive = {sc for sc in re.findall(r"\*\*(SC-\d{3})\*\*", spec)}
        alive |= {sc for sc in re.findall(r"^\| (SC-\d{3}) \|", spec, re.M)}
        deleted = {sc for sc in alive if re.search(rf"{sc}\*?\*?:? ?\(삭제", spec)}
        missing = sorted(sc for sc in alive - deleted if sc not in qa)
        if missing:
            problems.append(f"qa.md에 없는 SC: {missing}")
    m = re.search(r"요약: C (\d+)/(\d+)", qa)
    if m:
        done, total = int(m.group(1)), int(m.group(2))
        real_done = sum(1 for r, h in c_rows if "결과" in h and len(r) == len(h) and passed(r[h.index("결과")]))
        if total != len(c_rows):
            warnings.append(f"요약의 C 전체 {total} ≠ C 줄 {len(c_rows)}")
        if done != real_done:
            warnings.append(f"요약의 C 통과 {done} ≠ 결과 칸이 통과인 줄 {real_done} (부분·재확인 표기 때문일 수 있음)")
    print(f"C {len(c_rows)}줄, H {len(h_rows)}줄")
    for w in warnings:
        print(f"경고: {w}")
    if problems:
        print("문제:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("통과")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
