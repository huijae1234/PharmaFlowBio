"""spec.md / plan.md 구조와 추적성을 검사한다. (PharmaFlow 팀 스킬 pharmaflow-spec, 원본: 하네스 harness-spec-plan)

사용: py -X utf8 .claude/skills/pharmaflow-spec/scripts/check_spec_plan.py <기능 폴더>   (예: docs/specs/025-AI-도우미-챗봇)

검사 항목
- spec.md에 여섯 칸, plan.md에 다섯 칸 제목이 있는가
- spec의 FR·SC 번호가 중복 없이 정의되었는가
- spec 본문의 [확인 필요] 표시가 3개 이하인가 (6절 표는 제외)
- spec의 모든 FR·SC가 plan 4절(테스트 전략)에 나오는가
- plan에만 있는 FR·SC 번호가 없는가
- plan에 "latest"·"최신"·^범위 버전이 없는가
PharmaFlow에서 더한 것 (실패가 아니라 안내·경고)
- 이 spec 6절의 Q 번호가 다른 spec의 Q 번호와 겹치는가 (초기 spec은 Q1부터 따로 셌으므로 경고만)
- 다음에 쓸 Q 번호, spec 번호(012~016은 MES 예약), 마이그레이션 번호를 알려 준다

문제가 있으면 목록을 출력하고 종료 코드 1, 없으면 0.
"""
import re
import sys
from pathlib import Path

SPEC_SECTIONS = ["해결하려는 문제", "주요 사용자", "핵심 기능과 요구사항", "성공 기준", "제외 범위", "확인 필요 사항"]
PLAN_SECTIONS = ["기술과 버전", "구조와 파일", "단계별 접근", "테스트 전략", "제약과 주의점"]
ID_RE = re.compile(r"\b(FR|SC)-\d{3}\b")


def section(text, title):
    """'## N. title' 부터 다음 '## ' 전까지."""
    m = re.search(rf"^## \d+\. {re.escape(title)}.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1) if m else None


def main(folder):
    folder = Path(folder)
    spec_p, plan_p = folder / "spec.md", folder / "plan.md"
    problems = []
    if not spec_p.exists():
        print(f"spec.md 없음: {spec_p}")
        return 1
    spec = spec_p.read_text(encoding="utf-8")

    for t in SPEC_SECTIONS:
        if section(spec, t) is None:
            problems.append(f"spec: '{t}' 칸 없음")

    defined = re.findall(r"^#{2,4} ((?:FR|SC)-\d{3})|\*\*((?:SC)-\d{3})\*\*|^\| ((?:SC)-\d{3}) \|", spec, re.M)
    ids = [a or b or c for a, b, c in defined]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        problems.append(f"spec: 번호 중복 {sorted(dup)}")
    spec_ids = set(ids)
    if not any(i.startswith("FR") for i in spec_ids):
        problems.append("spec: FR 번호가 하나도 없음")

    body = spec.split("## 6. 확인 필요 사항")[0]
    marks = len(re.findall(r"\[확인 필요", body))
    if marks > 3:
        problems.append(f"spec: 본문 [확인 필요] 표시 {marks}개 (최대 3개, 나머지는 6절에 가정으로)")

    if plan_p.exists():
        plan = plan_p.read_text(encoding="utf-8")
        for t in PLAN_SECTIONS:
            if section(plan, t) is None:
                problems.append(f"plan: '{t}' 칸 없음")
        test = section(plan, "테스트 전략") or ""
        tested = set(ID_RE_full.group(0) for ID_RE_full in ID_RE.finditer(test))
        missing = sorted(spec_ids - tested)
        if missing:
            problems.append(f"plan 4절에 확인 방법이 없는 spec 번호: {missing}")
        unknown = sorted({m.group(0) for m in ID_RE.finditer(plan)} - spec_ids)
        if unknown:
            problems.append(f"plan에만 있는 번호 (spec에 없음): {unknown}")
        for bad in re.findall(r"(?i)\blatest\b|최신 버전|\^\d", plan):
            problems.append(f"plan: 정확하지 않은 버전 표기 '{bad}'")
    else:
        print("plan.md 없음: spec만 검사했습니다.")

    print(f"spec 번호 {len(spec_ids)}개: {', '.join(sorted(spec_ids))}")
    pharmaflow_notes(folder)
    if problems:
        print("문제:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("통과")
    return 0


RESERVED_SPECS = set(range(12, 17))  # Intent: 012~016은 MES 확장용으로 예약
Q_RE = re.compile(r"^\| (Q\d+) \|", re.M)


def pharmaflow_notes(folder):
    """번호 겹침 경고와 다음 번호 안내. 저장소 뿌리는 docs/specs의 두 단계 위."""
    specs_dir = folder.parent
    repo = specs_dir.parent.parent
    mine = set(Q_RE.findall((folder / "spec.md").read_text(encoding="utf-8")))
    others, all_q, numbers = {}, set(), []
    for d in specs_dir.iterdir():
        sp = d / "spec.md"
        if not sp.exists():
            continue
        head = d.name.split("-")[0]
        if head.isdigit():
            numbers.append(int(head))
        qs = set(Q_RE.findall(sp.read_text(encoding="utf-8")))
        all_q |= qs
        if d != folder:
            for q in qs:
                others.setdefault(q, []).append(d.name.split("-")[0])
    clash = sorted((q for q in mine if q in others), key=lambda q: int(q[1:]))
    if clash:
        print("경고: 다른 spec과 겹치는 Q 번호 " + ", ".join(f"{q}(spec {'·'.join(others[q])})" for q in clash))
    next_q = max((int(q[1:]) for q in all_q), default=0) + 1
    next_spec = max(numbers, default=0) + 1
    while next_spec in RESERVED_SPECS:
        next_spec += 1
    migs = sorted((repo / "supabase" / "migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"))
    next_mig = int(migs[-1].name[:4]) + 1 if migs else 1
    print(f"안내: 다음 Q 번호 Q{next_q}, 다음 spec 번호 {next_spec:03d}, 다음 마이그레이션 {next_mig:04d}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
