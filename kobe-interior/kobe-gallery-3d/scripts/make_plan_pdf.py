"""현장 실측용 도면 PDF — 위에서 본 평면도(벽·기둥 번호 = 3D 뷰어 번호) + 실측 기록표 + 띠·판 단면도.
값은 3D 스캔 추정치(geometry_metadata.json). 빈칸에 현장 실측값을 적는다.
사용: python3 scripts/make_plan_pdf.py  →  ../도면/실측용_평면도.pdf (A3 가로)"""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle, FancyBboxPatch, Circle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "도면" / "실측용_평면도.pdf"
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei", "Noto Sans CJK KR", "AppleGothic", "sans-serif"]
A3 = (16.54, 11.69)
INK, MUTE, ACC, RED = "#222", "#888", "#2f6f5e", "#b33"


def load():
    m = json.loads((ROOT / "src" / "geometry_metadata.json").read_text(encoding="utf-8"))
    walls = [e for e in m["elements"] if e["type"] == "wall"]
    for i, w in enumerate(walls, 1): w["num"] = i
    cols = [e for e in m["elements"] if e["type"] in ("wide_column", "thin_column")]
    for i, c in enumerate(cols, 1): c["num"] = i
    return m, walls, cols


def wall_xy(w):
    if w["axis"] == "x": return [w["offset"]] * 2, [w["from"], w["to"]]
    return [w["from"], w["to"]], [w["offset"]] * 2


def page_plan(pdf, m, walls, cols, zoom=None):
    fig = plt.figure(figsize=A3); ax = fig.add_axes([0.03, 0.05, 0.66, 0.85])
    fixture, ext = set(m.get("fixture_walls", {})), {"wall_z_11"}
    svc = m.get("service_walls", {})
    # 1 m 격자
    for v in range(-5, 6): ax.axvline(v, color="#eee", lw=0.6, zorder=0); ax.axhline(v, color="#eee", lw=0.6, zorder=0)
    # 바닥 구역 표시
    for z in m.get("exterior_zones", []):
        ax.add_patch(Rectangle((z["x"][0], z["z"][0]), z["x"][1] - z["x"][0], min(z["z"][1], 4.9) - z["z"][0], color="#f2f2f2", zorder=0))
        ax.text((z["x"][0] + z["x"][1]) / 2, 4.3, "입구 밖\n(계단참)", ha="center", va="center", color=MUTE, fontsize=9)
    for w in walls:
        xs, zs = wall_xy(w); L = w["to"] - w["from"]
        grey = w["id"] in fixture or w["id"] in ext
        ax.plot(xs, zs, color="#bbb" if grey else INK, lw=2 if w.get("two_sided") else 4, solid_capstyle="butt", zorder=3)
        mx, mz = (xs[0] + xs[1]) / 2, (zs[0] + zs[1]) / 2; inw = w["inward"]
        g = 0.2 if zoom else 0.32
        if w["axis"] == "x": lx, lz, rot = mx + inw * g, mz, 90
        else: lx, lz, rot = mx, mz + inw * g, 0
        ax.add_patch(Circle((lx, lz), 0.11 if zoom else 0.17, fc="white", ec=ACC if not grey else "#bbb", lw=1.4, zorder=5))
        ax.text(lx, lz, str(w["num"]), ha="center", va="center", fontsize=10, weight="bold", color=ACC if not grey else "#999", zorder=6)
        note = " (싱크대 앞면)" if w["id"] in fixture else " (입구 밖)" if w["id"] in ext else f" ({svc[w['id']]})" if w["id"] in svc else ""
        if (L > 1.6 or (L > 0.6 and zoom)) and not grey:
            g2 = 0.45 if zoom else 0.62; ox, oz = (inw * g2, 0) if w["axis"] == "x" else (0, inw * g2)
            ax.text(mx + ox, mz + oz, f"약 {L:.2f} m{note}\n실측 ______", ha="center", va="center", rotation=rot, fontsize=9 if zoom else 7.5, color=MUTE, zorder=4)
    # 창
    for ov in m.get("window_overrides", []):
        for win in ov["windows"]:
            z = ov["offset"]; ax.plot([win["from"], win["to"]], [z, z], color="#6aa9d8", lw=7, solid_capstyle="butt", zorder=4)
            ax.text((win["from"] + win["to"]) / 2, z + 0.2, f"창 약 {win['to'] - win['from']:.2f} m  창턱 {win['y'][0]:.2f} m / 실측 ____", ha="center", fontsize=7.5, color="#3a7fb5", zorder=4)
    # 기둥
    for c in cols:
        fx, fz = c["footprint"]["x"], c["footprint"]["z"]; wdt, dep = fx[1] - fx[0], fz[1] - fz[0]
        ax.add_patch(Rectangle((fx[0], fz[0]), wdt, dep, fc="#555", ec=INK, zorder=4))
        ax.text(fx[1] + 0.08, fz[0] - 0.02, f"기둥 {c['num']}\n약 {wdt*100:.0f}×{dep*100:.0f} cm\n실측 ___×___", fontsize=7.5, va="top", color=INK, zorder=6,
                bbox=dict(fc="white", ec="none", alpha=0.8, pad=1))
    # 문·설비
    for d in m.get("door_openings", []):
        w = next(x for x in walls if x["id"] == d["wall"])
        if w["axis"] == "z": ax.plot([d["from"], d["to"]], [w["offset"]] * 2, color="white", lw=6, zorder=4); ax.plot([d["from"], d["to"]], [w["offset"]] * 2, color=RED, lw=1.5, ls="--", zorder=5)
        else: ax.plot([w["offset"]] * 2, [d["from"], d["to"]], color="white", lw=6, zorder=4); ax.plot([w["offset"]] * 2, [d["from"], d["to"]], color=RED, lw=1.5, ls="--", zorder=5)
    lm = m.get("landmarks", {})
    for k, t in [("toilet", "화장실"), ("kitchen", "주방"), ("entrance", "입구 (자동문)")]:
        if k in lm: ax.text(lm[k]["x"], lm[k]["z"] + 0.25, t, ha="center", va="center", fontsize=11 if zoom else 7.5, color=RED, alpha=0.8, zorder=2)
    ax.annotate("", xy=(-3.9, -5.35), xytext=(-3.9, -4.95), arrowprops=dict(arrowstyle="-|>", color=INK)); ax.text(-3.75, -5.25, "창 쪽", fontsize=9)
    ax.plot([2.0, 3.0], [5.2, 5.2], color=INK, lw=3); ax.text(2.5, 5.38, "1 m", ha="center", fontsize=9)
    if zoom: ax.set_xlim(*zoom[0]); ax.set_ylim(zoom[1][1], zoom[1][0])
    else:
        ax.set_xlim(-4.6, 4.2); ax.set_ylim(5.6, -5.5)
        ax.add_patch(Rectangle((-3.6, 1.55), 6.2, 3.45, fill=False, ec=ACC, ls=":", lw=1.2, zorder=1)); ax.text(2.65, 1.5, "→ 다음 장 확대", color=ACC, fontsize=9, ha="right", va="bottom")
    ax.set_aspect("equal"); ax.axis("off")
    for t in ax.texts: t.set_clip_on(True)   # 확대 장에서 그림 밖 글씨가 오른쪽 표로 넘치지 않게
    fig.text(0.03, 0.955, "고베 매장 — 실측용 평면도 (위에서 본 그림)" + ("  · 안쪽(주방·화장실·입구) 확대" if zoom else ""), fontsize=18, weight="bold")
    fig.text(0.03, 0.93, "벽·기둥 번호 = 3D 뷰어 번호.  '약 ○ m'는 3D 스캔 추정값 — 옆 빈칸에 실측값을 적으세요.  회색 = 꾸미지 않는 면,  빨간 점선 = 문", fontsize=10, color=MUTE)
    # 오른쪽: 공통 실측 + 메모
    x0 = 0.71
    fig.text(x0, 0.90, "공통 실측 (3~4곳 재서 적기)", fontsize=13, weight="bold")
    rows = [("바닥 → 검은 띠 위끝", "약 89 cm", "900 mm 이하인지"), ("바닥 → 검은 띠 아래끝", "약 81 cm", ""), ("검은 띠 높이", "약 8 cm", ""),
            ("검은 띠 튀어나온 두께", "12 mm 가정", "18 mm 이하인지"), ("걸레받이 높이", "약 10 cm", ""), ("걸레받이 튀어나온 두께", "?", "띠와 비슷한지"),
            ("천장 높이", "약 2.38 m", ""), ("벽지 물방울 테스트", "", "튕김 / 스며듦")]
    y = 0.87
    for name, est, hint in rows:
        fig.text(x0, y, name, fontsize=10); fig.text(x0 + 0.13, y, est, fontsize=9, color=MUTE)
        fig.text(x0 + 0.19, y, "① ____  ② ____  ③ ____", fontsize=10); y -= 0.018
        if hint: fig.text(x0 + 0.01, y + 0.004, f"↳ {hint}", fontsize=8, color=MUTE); y -= 0.012
        y -= 0.006
    fig.text(x0, y - 0.01, "콘센트·스위치 (벽 번호 / 바닥에서 높이 / 왼쪽 끝에서 거리)", fontsize=11, weight="bold"); y -= 0.035
    for _ in range(6): fig.add_artist(plt.Line2D([x0, 0.98], [y, y], color="#ccc", lw=0.8)); y -= 0.028
    fig.text(x0, y - 0.005, "메모", fontsize=11, weight="bold")
    fig.add_artist(FancyBboxPatch((x0, 0.05), 0.27, y - 0.065, boxstyle="round,pad=0.003", fc="none", ec="#bbb", lw=0.8, transform=fig.transFigure))
    pdf.savefig(fig); plt.close(fig)


def page_table(pdf, m, walls, cols):
    fig = plt.figure(figsize=A3)
    fig.text(0.04, 0.95, "벽·기둥 실측 기록표", fontsize=18, weight="bold")
    fig.text(0.04, 0.925, "길이 = 벽 끝에서 끝까지(모서리~모서리).  띠 위끝 높이는 벽마다 한 군데씩.  콘센트는 개수와 위치.", fontsize=10, color=MUTE)
    fixture, svc = set(m.get("fixture_walls", {})), m.get("service_walls", {})
    heads = ["번호", "위치 메모", "길이 (스캔)", "길이 실측", "띠 위끝 높이", "띠 두께", "걸레받이 두께", "콘센트·스위치", "메모"]
    xs = [0.04, 0.09, 0.22, 0.30, 0.39, 0.48, 0.56, 0.65, 0.78, 0.97]
    y = 0.885
    for i, h in enumerate(heads): fig.text(xs[i] + 0.004, y, h, fontsize=10, weight="bold")
    y -= 0.008; fig.add_artist(plt.Line2D([xs[0], xs[-1]], [y, y], color=INK, lw=1.2))
    for w in walls:
        if w["id"] == "wall_z_11": continue
        L = w["to"] - w["from"]; where = "싱크대 앞면" if w["id"] in fixture else svc.get(w["id"], "")
        if w["id"] == "wall_z_8": where = "창 쪽"
        cells = [f"벽 {w['num']}", where, f"{L:.2f} m" + (" ×2면" if w.get("two_sided") else ""), "", "", "", "", "", ""]
        y -= 0.034
        for i, t in enumerate(cells): fig.text(xs[i] + 0.004, y + 0.01, t, fontsize=10, color=INK if i != 2 else MUTE)
        fig.add_artist(plt.Line2D([xs[0], xs[-1]], [y, y], color="#ccc", lw=0.7))
    y -= 0.03
    for c in cols:
        fx, fz = c["footprint"]["x"], c["footprint"]["z"]
        cells = [f"기둥 {c['num']}", "가로 × 세로", f"{(fx[1]-fx[0])*100:.0f}×{(fz[1]-fz[0])*100:.0f} cm", "___ × ___", "", "", "", "", ""]
        y -= 0.034
        for i, t in enumerate(cells): fig.text(xs[i] + 0.004, y + 0.01, t, fontsize=10, color=INK if i != 2 else MUTE)
        fig.add_artist(plt.Line2D([xs[0], xs[-1]], [y, y], color="#ccc", lw=0.7))
    for x in xs: fig.add_artist(plt.Line2D([x, x], [y, 0.893], color="#ddd", lw=0.6))
    pdf.savefig(fig); plt.close(fig)


def page_section(pdf):
    fig = plt.figure(figsize=A3); ax = fig.add_axes([0.06, 0.08, 0.42, 0.82])
    fig.text(0.04, 0.95, "벽 단면 — 잴 곳 (방법 ③: 판을 바닥~검은 띠 위끝까지)", fontsize=18, weight="bold")
    # 단면: 가로 = 벽에서 앞으로(mm), 세로 = 높이(mm)
    ax.add_patch(Rectangle((-40, 0), 40, 1100, fc="#ddd", ec=INK)); ax.text(-20, 1050, "벽", ha="center", fontsize=11)
    ax.add_patch(Rectangle((-80, -40), 260, 40, fc="#c9a97a", ec=INK)); ax.text(150, -25, "바닥", fontsize=10)
    ax.add_patch(Rectangle((0, 0), 12, 100, fc="#6b4a2e", ec=INK)); ax.text(-130, 50, "걸레받이(나무) →", fontsize=10, ha="right", va="center")
    ax.add_patch(Rectangle((0, 810), 12, 80, fc="#222", ec=INK)); ax.text(-130, 850, "검은 띠 →", fontsize=10, ha="right", va="center")
    ax.add_patch(Rectangle((12, 3), 7, 887, fc="#a8774d", ec=INK, alpha=0.9)); ax.text(40, 450, "판 7 mm\n(エアサーモパネルlite)", fontsize=10)
    ax.add_patch(Rectangle((0, 890), 25, 12, fc="#7a5333", ec=INK)); ax.text(40, 905, "見切り材 25×12", fontsize=10)
    def dim(x, y0, y1, label):
        ax.annotate("", xy=(x, y0), xytext=(x, y1), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(x - 8, (y0 + y1) / 2, label, color=RED, fontsize=11, va="center", ha="right")
    dim(-300, 0, 890, "A 바닥→띠 위끝\n(약 890 ·\n900 이하?)"); dim(-60, 810, 890, "B"); dim(-60, 0, 100, "C")
    ax.annotate("", xy=(0, 780), xytext=(12, 780), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(40, 780, "D 띠 두께(튀어나옴)", color=RED, fontsize=11, va="center")
    ax.annotate("", xy=(0, 130), xytext=(12, 130), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(40, 130, "E 걸레받이 두께(튀어나옴)", color=RED, fontsize=11, va="center")
    ax.set_xlim(-420, 220); ax.set_ylim(-60, 1120); ax.axis("off")
    x0, y = 0.55, 0.85
    tips = [("A", "판 길이 900 mm 이하여야 1장으로 됩니다. 넘으면 판이 모자랍니다."),
            ("B", "띠 높이. 판이 덮으므로 참고용."),
            ("C", "걸레받이 높이. 판 뒤에 숨습니다."),
            ("D", "18 mm 이하면 見切り材(깊이 25)가 판(7)+틈을 덮습니다."),
            ("E", "D와 비슷하면 판이 똑바로 섭니다. 차이 = 판 가운데 각재 두께."),
            ("", ""),
            ("요령", "줄자는 숫자가 보이게 사진도 찍어 두기"), ("", "두께(D·E)는 작은 자를 벽에 수직으로 대고"),
            ("", "A는 바닥이 고르지 않을 수 있어 벽마다 재기"), ("", "콘센트는 판을 따내야 함 — 위치·높이 기록")]
    for k, t in tips:
        fig.text(x0, y, k, fontsize=13, weight="bold", color=RED); fig.text(x0 + 0.04, y, t, fontsize=12); y -= 0.045
    fig.text(x0, y - 0.02, "메모", fontsize=12, weight="bold")
    fig.add_artist(FancyBboxPatch((x0, 0.08), 0.40, y - 0.12, boxstyle="round,pad=0.003", fc="none", ec="#bbb", lw=0.8, transform=fig.transFigure))
    pdf.savefig(fig); plt.close(fig)


def main():
    m, walls, cols = load(); OUT.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(OUT) as pdf:
        page_plan(pdf, m, walls, cols); page_plan(pdf, m, walls, cols, zoom=((-3.7, 3.6), (1.45, 5.45))); page_table(pdf, m, walls, cols); page_section(pdf)
    print(f"[도면] {OUT}")


if __name__ == "__main__":
    main()
