"""인테리어 업체용 도면 PDF (A3 가로 4장, 평면 1:50) — 현황 실측 평면 · 계획 평면(E안) · 벽 마감 상세 · 공사 범위.
형상은 3D 스캔(geometry_metadata.json), 치수 숫자는 2026-11-07 현장 실측(measured_20261107)을 우선한다.
✓ = 실측, (스캔) = 스캔 추정 — 공사 전 현장 재확인. 한국어 + 일본어 병기.
사용: python3 scripts/make_contractor_pdf.py  →  ../도면/시공용_도면_E안.pdf"""
import json, math
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle, Polygon, FancyBboxPatch, Circle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "도면" / "시공용_도면_E안.pdf"
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei", "sans-serif"]
A3_MM = (420.1, 296.9); A3 = (A3_MM[0] / 25.4, A3_MM[1] / 25.4)
SCALE = 50                                   # 1:50 → 1 m = 20 mm
INK, MUTE, GREEN, RED, BLUE, GOLD = "#1a1a1a", "#777", "#2f6f5e", "#b33", "#2c6fb0", "#9a7a1a"
DATE = "2026-11-11"


def load():
    m = json.loads((ROOT / "src" / "geometry_metadata.json").read_text(encoding="utf-8"))
    walls = [e for e in m["elements"] if e["type"] == "wall"]
    for i, w in enumerate(walls, 1): w["num"] = i
    gone = set(m.get("removed_elements", []))
    cols = [e for e in m["elements"] if e["type"] in ("wide_column", "thin_column")]
    for i, c in enumerate(cols, 1): c["num"] = i
    cols = [c for c in cols if c["id"] not in gone]
    for c in cols:
        q = m.get("measured_columns", {}).get(c["id"])
        if q:
            fx, fz = c["footprint"]["x"], c["footprint"]["z"]; cx, cz = (fx[0] + fx[1]) / 2 + q["dx"], (fz[0] + fz[1]) / 2 + q["dz"]
            c["footprint"] = {"x": [cx - q["w"] / 2, cx + q["w"] / 2], "z": [cz - q["d"] / 2, cz + q["d"] / 2]}; c["measured"] = True
    return m, walls, cols


def plan_axes(fig, xlim, zlim, left_mm=14, top_mm=34):
    """1:50 평면 축 — 1 m = 20 mm. z 는 아래로 증가(창 = 위)"""
    w_mm = (xlim[1] - xlim[0]) * 1000 / SCALE; h_mm = (zlim[1] - zlim[0]) * 1000 / SCALE
    ax = fig.add_axes([left_mm / A3_MM[0], 1 - (top_mm + h_mm) / A3_MM[1], w_mm / A3_MM[0], h_mm / A3_MM[1]])
    ax.set_xlim(*xlim); ax.set_ylim(zlim[1], zlim[0]); ax.set_aspect("equal"); ax.axis("off")
    for t in ax.texts: t.set_clip_on(True)
    return ax


def dim(ax, p1, p2, off, text, color=INK, fs=7.5, side=1):
    """치수선: p1→p2 와 평행하게 off(m) 만큼 떨어져 그리고 가운데 글씨. 세로 치수는 글씨 회전"""
    (x1, z1), (x2, z2) = p1, p2; dx, dz = x2 - x1, z2 - z1; L = math.hypot(dx, dz) or 1
    nx, nz = -dz / L * off * side, dx / L * off * side
    a = (x1 + nx, z1 + nz); b = (x2 + nx, z2 + nz)
    ax.plot([a[0], b[0]], [a[1], b[1]], color=color, lw=0.7)
    for p, q in [((x1, z1), a), ((x2, z2), b)]: ax.plot([p[0], q[0]], [p[1], q[1]], color=color, lw=0.4)
    for p in (a, b):   # 45° 틱
        ax.plot([p[0] - 0.05, p[0] + 0.05], [p[1] + 0.05, p[1] - 0.05], color=color, lw=0.8)
    rot = 90 if abs(dx) < abs(dz) else 0
    tx, tz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    ax.text(tx + (-0.09 if rot else 0), tz + (0 if rot else -0.07), text, ha="center", va="center", rotation=rot, fontsize=fs, color=color,
            bbox=dict(fc="white", ec="none", pad=0.6, alpha=0.9))


def wall_rect(ax, w, T=0.1, fc="#333", ec=INK, lw=0.6, hatch=None, z=3):
    """벽을 두께 T 의 띠로 그림(안쪽 면 = offset, 바깥쪽으로 T)"""
    if w.get("two_sided"): o0, o1 = w["offset"] - T / 2, w["offset"] + T / 2
    else: o0, o1 = sorted([w["offset"], w["offset"] - w["inward"] * T])
    if w["axis"] == "x": r = Rectangle((o0, w["from"]), o1 - o0, w["to"] - w["from"])
    else: r = Rectangle((w["from"], o0), w["to"] - w["from"], o1 - o0)
    r.set(fc=fc, ec=ec, lw=lw, hatch=hatch, zorder=z); ax.add_patch(r); return r


def draw_base(ax, m, walls, cols, show_nums=True):
    fixture, ext = set(m.get("fixture_walls", {})), {"wall_z_11"}; gone = set(m.get("removed_elements", []))
    for w in walls:
        if w["id"] in fixture or w["id"] in gone: continue
        grey = w["id"] in ext
        wall_rect(ax, w, fc="#bbb" if grey else "#333", ec="#999" if grey else INK)
    # 창
    for ov in m.get("window_overrides", []):
        for win in ov["windows"]:
            z = ov["offset"]; ax.add_patch(Rectangle((win["from"], z - 0.1), win["to"] - win["from"], 0.1, fc="white", ec=INK, lw=0.6, zorder=4))
            for k in (0.03, 0.07): ax.plot([win["from"], win["to"]], [z - k, z - k], color=BLUE, lw=0.8, zorder=5)
    # 문(개구부): 벽을 비우고 열림 호
    for d in m.get("door_openings", []):
        if d.get("when"): continue
        w = next(x for x in walls if x["id"] == d["wall"]); T = 0.1
        if w["axis"] == "z":
            ax.add_patch(Rectangle((d["from"], w["offset"] - T / 2 - 0.01), d["to"] - d["from"], T + 0.02, fc="white", ec="none", zorder=4))
            ax.plot([d["from"], d["to"]], [w["offset"]] * 2, color=INK, lw=0.5, ls=(0, (2, 2)), zorder=5)
        else:
            ax.add_patch(Rectangle((w["offset"] - T / 2 - 0.01, d["from"]), T + 0.02, d["to"] - d["from"], fc="white", ec="none", zorder=4))
            ax.plot([w["offset"]] * 2, [d["from"], d["to"]], color=INK, lw=0.5, ls=(0, (2, 2)), zorder=5)
    # 문 열림 호
    from matplotlib.patches import Arc
    for d in m.get("door_openings", []):
        if d.get("when") or d["id"] != "toilet_door": continue
        w = next(x for x in walls if x["id"] == d["wall"]); hx = d["to"] if d.get("hinge") == "to" else d["from"]; wd = d["to"] - d["from"]; side = d.get("room_side", -1)
        th = (180 if hx == d["to"] else 0); ax.add_patch(Arc((hx, w["offset"]), 2 * wd, 2 * wd, angle=0, theta1=(0 if side > 0 else 270) if hx == d["from"] else (90 if side > 0 else 180), theta2=(90 if side > 0 else 360) if hx == d["from"] else (180 if side > 0 else 270), color=RED, lw=0.8, zorder=6))
        ax.plot([hx, hx], [w["offset"], w["offset"] + side * wd], color=RED, lw=1.0, zorder=6)
    # 입구 자동문
    e = next(x for x in m["elements"] if x["type"] == "door_panel"); fx, fz = e["footprint"]["x"], e["footprint"]["z"]
    ax.add_patch(Rectangle((fx[0], fz[0]), fx[1] - fx[0], fz[1] - fz[0], fc="white", ec=BLUE, lw=1.2, zorder=5))
    ax.text((fx[0] + fx[1]) / 2, fz[1] + 0.22, "자동문 / 自動ドア", ha="center", fontsize=7, color=BLUE, zorder=6)
    # 기둥
    for c in cols:
        fx, fz = c["footprint"]["x"], c["footprint"]["z"]
        ax.add_patch(Rectangle((fx[0], fz[0]), fx[1] - fx[0], fz[1] - fz[0], fc="#555", ec=INK, lw=0.6, zorder=5))
        if show_nums: ax.text(fx[1] + 0.07, fz[0] + 0.02, f"C{c['num']}", fontsize=7.5, weight="bold", va="top", color=INK, zorder=6)
    # 설비(참고): 싱크대·양변기 칸·세면대
    k = m["kitchen"]; s = k["sink"]
    ax.add_patch(Rectangle((s["x"][0], s["z"][0]), s["x"][1] - s["x"][0], s["z"][1] - s["z"][0], fc="#eee", ec=MUTE, lw=0.5, zorder=4)); ax.text((s["x"][0] + s["x"][1]) / 2, (s["z"][0] + s["z"][1]) / 2, "싱크대\nシンク", ha="center", va="center", fontsize=6, color=MUTE, zorder=6)
    st = m["toilet_stall"]; ax.add_patch(Rectangle((st["x"][0], st["z"][0]), st["x"][1] - st["x"][0], st["z"][1] - st["z"][0], fc="#f4efe6", ec=MUTE, lw=0.5, zorder=4)); ax.text((st["x"][0] + st["x"][1]) / 2, (st["z"][0] + st["z"][1]) / 2, "WC", ha="center", va="center", fontsize=7, color=MUTE, zorder=6)
    if show_nums:
        for w in walls:
            if w["id"] in fixture: continue
            xs, zs = ([w["offset"]] * 2, [w["from"], w["to"]]) if w["axis"] == "x" else ([w["from"], w["to"]], [w["offset"]] * 2)
            mx, mz = (xs[0] + xs[1]) / 2, (zs[0] + zs[1]) / 2; g = 0.22 * w["inward"]
            lx, lz = (mx + g, mz) if w["axis"] == "x" else (mx, mz + g)
            ax.text(lx, lz, f"W{w['num']}", ha="center", va="center", fontsize=6.5, color=GREEN, weight="bold", zorder=7, bbox=dict(fc="white", ec=GREEN, lw=0.5, pad=0.8, boxstyle="round,pad=0.25"))
    ax.annotate("", xy=(3.75, -5.45), xytext=(3.75, -5.0), arrowprops=dict(arrowstyle="-|>", color=INK, lw=0.8)); ax.text(3.9, -5.25, "창 쪽 / 窓側", fontsize=7, va="center")


def header(fig, title, sub, page):
    fig.text(0.033, 0.955, title, fontsize=17, weight="bold")
    fig.text(0.033, 0.928, sub, fontsize=9, color=MUTE)
    fig.text(0.97, 0.955, f"船場美術館 神戸店 (三宮)   {DATE}   {page}/4", fontsize=9, ha="right", color=MUTE)
    fig.text(0.97, 0.935, "✓ 실측 2026-11-07 / 実測   ·   (스캔) = 3D 스캔 추정 / スキャン推定 — 着工前に現場再確認", fontsize=8, ha="right", color=MUTE)
    fig.add_artist(plt.Line2D([0.033, 0.97], [0.92, 0.92], color=INK, lw=0.8))


def legend_box(fig, x, y, w, items, title):
    fig.text(x, y, title, fontsize=10, weight="bold"); yy = y - 0.026
    for sw, t in items:
        fig.add_artist(Rectangle((x, yy - 0.004), 0.016, 0.013, transform=fig.transFigure, **sw)); fig.text(x + 0.022, yy, t, fontsize=8.5, va="center"); yy -= 0.021
    return yy


def page_current(pdf, m, walls, cols):
    fig = plt.figure(figsize=A3); M = m["measured_20261107"]
    header(fig, "① 현황 평면도 (실측)  /  現況平面図（実測）", "축척 1:50 (A3 원본 인쇄 시).  치수 단위 m.  숫자가 그림보다 우선.  벽 번호 W, 기둥 번호 C 는 3D 뷰어와 같음.", 1)
    ax = plan_axes(fig, (-5.3, 4.6), (-6.3, 5.6)); draw_base(ax, m, walls, cols)
    W2, W1, WW, W11 = -3.954, 2.354, -4.804, 2.006
    # 방 전체
    dim(ax, (W2, WW), (W1, WW), -1.25, f"✓ 6.271 (W2 ↔ W1)")
    dim(ax, (W1, WW), (W1, W11), 0.9, f"✓ 6.840 (창 벽 W9 ↔ W11)", side=-1)
    # 창 벽 분할
    ws = m["window_overrides"][0]["windows"]; xs = [W2, ws[0]["from"], ws[0]["to"], ws[1]["from"], ws[1]["to"], W1]; labels = ["✓0.28", "✓2.66 (유리)", "✓0.295", "✓2.66 (유리)", "✓0.285"]
    for a, b, t in zip(xs[:-1], xs[1:], labels): dim(ax, (a, WW), (b, WW), -0.5, t, color=BLUE, fs=6.5)
    ax.text(-0.6, -4.45, "창턱 (스캔) 0.55 · 창 위 1.78 · 커튼박스 있음  /  窓台 0.55・窓上 1.78（スキャン）", fontsize=6.5, color=BLUE, ha="center")
    # 기둥 가로 줄 (z ≈ −1.1)
    c = {x["num"]: x for x in cols}; zc = -1.08
    pts = [(W2, "W2")] + [((c[i]["footprint"]["x"][0] + c[i]["footprint"]["x"][1]) / 2, f"C{i}") for i in (1, 2, 3)] + [(W1, "W1")]
    chain = ["✓1.500", "✓1.383", "✓1.389", "✓1.473"]
    for (a, _), (b, _), t in zip(pts[:-1], pts[1:], chain): dim(ax, (a, zc), (b, zc), 0.55, t, fs=6.5)
    dim(ax, (W2, zc), (pts[2][0], zc), 1.0, "✓3.055 (W2 → C2 중심)", fs=6.5); dim(ax, (pts[2][0], zc), (W1, zc), 1.0, "✓3.010 (C2 중심 → W1)", fs=6.5)
    for i in (1, 2, 3):
        fz = c[i]["footprint"]["z"]; cx = (c[i]["footprint"]["x"][0] + c[i]["footprint"]["x"][1]) / 2
        dim(ax, (cx, WW), (cx, fz[0]), 0.0, f"✓{M['columns_from_window_wall']['col' + str(i)]:.3f}", color=MUTE, fs=6, side=1)
        fx = c[i]["footprint"]["x"]; ax.text(fx[1] + 0.07, fz[1] + 0.02, f"가로 {(fx[1]-fx[0])*100:.0f} (역산)\n세로 {(fz[1]-fz[0])*100:.0f} (스캔)", fontsize=5.5, color=MUTE, va="top")
    # 입구·주방·화장실
    ent = next(x for x in m["elements"] if x["type"] == "door_panel"); ez = ent["footprint"]["z"][0]
    dim(ax, ((c[1]["footprint"]["x"][0] + c[1]["footprint"]["x"][1]) / 2, c[1]["footprint"]["z"][1]), ((c[1]["footprint"]["x"][0] + c[1]["footprint"]["x"][1]) / 2, ez), 0.0, "✓4.022 (C1 → 자동문)", color=MUTE, fs=6, side=-1)
    dim(ax, ((c[3]["footprint"]["x"][0] + c[3]["footprint"]["x"][1]) / 2, c[3]["footprint"]["z"][1]), ((c[3]["footprint"]["x"][0] + c[3]["footprint"]["x"][1]) / 2, W11), 0.0, "✓3.476 (C3 → W11)", color=MUTE, fs=6, side=1)
    dim(ax, (W2, 1.6), (-1.76, 1.6), -0.0, "✓2.158 (W2 ↔ W5)", fs=6.5)
    dim(ax, (-2.85, 2.72), (-1.76, 2.72), 0.0, "✓1.093 (W3 ↔ W5)", fs=5.5, color=MUTE)
    dim(ax, (-3.8, W11), (-3.8, ez), 0.0, "✓0.965 (W11→자동문)", fs=5.5, color=MUTE, side=-1)
    dim(ax, (-1.046, 3.4), (0.264, 3.4), 0.0, "✓1.209 (W7 ↔ W4)", fs=6.5)
    dim(ax, (0.264, 1.6), (W1, 1.6), 0.0, "✓2.087 (W4 ↔ W1)", fs=6.5)
    dim(ax, (0.264, 2.9), (1.128, 2.9), 0.0, "✓1.025 (W4 ↔ W6)", fs=6, color=MUTE)
    dim(ax, (1.128, 4.9), (2.145, 4.9), 0.0, "✓1.124 (W6 ↔ W17)", fs=6, color=MUTE)
    dim(ax, (1.7, 2.413), (1.7, 4.58), 0.0, "✓2.17 화장실 깊이", fs=6, color=MUTE, side=1)
    td = next(d for d in m["door_openings"] if d["id"] == "toilet_door"); dim(ax, (td["from"], 2.413), (td["to"], 2.413), -0.35, "✓0.645 문", fs=6, color=MUTE); dim(ax, (td["to"], 2.413), (W1, 2.413), -0.35, "✓0.42", fs=6, color=MUTE)
    sd = next(d for d in m["door_openings"] if d["id"] == "stall_door"); dim(ax, (1.128, 2.413), (1.128, sd["from"]), 0.0, "✓0.66", fs=6, color=MUTE, side=-1)
    ax.text(-2.3, 2.35, "입구 통로\n玄関通路", ha="center", va="center", fontsize=6, color=MUTE); ax.text(-0.4, 2.7, "주방\nキッチン", ha="center", va="center", fontsize=7, color=MUTE); ax.text(1.65, 3.4, "세면실\n洗面", ha="center", va="center", fontsize=7, color=MUTE)
    ax.text(-2.4, 4.3, "입구 밖(계단참)\n工事範囲外", ha="center", va="center", fontsize=7, color="#999")
    # 오른쪽: 높이·단면 실측표
    x0 = 0.70; fig.text(x0, 0.885, "높이 실측 / 高さ実測", fontsize=11, weight="bold")
    rows = [("천장고 / 天井高", "✓ 2.393 m"), ("검은 띠(체어레일) 높이 / 黒い帯", "✓ 7.4 cm · 벽에서 1.0 cm 돌출"), ("바닥→띠 위끝 / 床→帯上端", "(스캔) 약 0.89 m — 미실측"), ("바닥→띠 아래끝", "(스캔) 약 0.81 m — 미실측"),
            ("걸레받이(나무) / 幅木", "✓ 11.2 cm · 돌출 0.4~0.7 cm"), ("창턱 높이 / 窓台", "(스캔) 0.55 m"), ("바닥 / 床", "원목 마루 — 그대로 둠 / 既存のまま"), ("벽지 / 壁紙", "회색 비닐 벽지(추정) — 상태 확인 필요")]
    y = 0.86
    for a, b in rows: fig.text(x0, y, a, fontsize=8.5); fig.text(x0 + 0.13, y, b, fontsize=8.5, color=INK if "✓" in b else MUTE); y -= 0.022
    fig.text(x0, y - 0.015, "미실측·확인 필요 / 要現場確認", fontsize=11, weight="bold", color=RED); y -= 0.045
    for t in ["• 바닥→검은 띠 위끝 높이 (판 길이 900 결정)", "• 기둥 C1~C3 가로·세로 직접 측정 (가로는 역산값)", "• 창 폭 2.66 이 유리인지 틀 포함인지 (합계 6.18 vs 방 폭 6.271)",
              "• 자동문 폭, W11·W3 길이, 콘센트·스위치 위치", "• 벽지 종류(비닐/오염방지 코팅) — 페인트 밀착 확인", "• 벽 5·15 근처 1.77 m · 0.8 m 메모 구간"]:
        fig.text(x0, y, t, fontsize=8.5, color=RED); y -= 0.021
    fig.text(x0, y - 0.015, "범례 / 凡例", fontsize=11, weight="bold"); y -= 0.045
    for sw, t in [(dict(fc="#333"), "기존 벽 / 既存壁"), (dict(fc="#bbb"), "공사 범위 밖 / 範囲外"), (dict(fc="white", ec=BLUE), "창 / 窓"), (dict(fc="#555"), "기둥 C / 柱")]:
        fig.add_artist(Rectangle((x0, y - 0.005), 0.016, 0.013, transform=fig.transFigure, **sw)); fig.text(x0 + 0.022, y, t, fontsize=8.5, va="center"); y -= 0.021
    pdf.savefig(fig); plt.close(fig)


def page_plan(pdf, m, walls, cols):
    fig = plt.figure(figsize=A3)
    header(fig, "② 계획 평면도 — E안  /  計画平面図（E案）", "신설 벽·막음·개구부·바닥 마감·고정 가구 위치.  치수 단위 m.  소품(의자·세트)은 배치 참고.", 2)
    ax = plan_axes(fig, (-5.3, 4.6), (-6.3, 5.6)); draw_base(ax, m, walls, cols, show_nums=True)
    T = 0.1
    # 신설 벽: 주방 막음(N1), 리셉션 뒤 벽(N2)
    kc = next(c for c in m["closures"] if c["id"] == "kitchen")["wall"]; rc = next(c for c in m["closures"] if c["id"] == "reception")
    wall_rect(ax, kc, fc="white", ec=RED, lw=1.2, hatch="////", z=6)
    ax.text((kc["from"] + kc["to"]) / 2, kc["offset"] + 0.75, "N1 신설 벽\n新設壁", ha="center", fontsize=6.5, color=RED, zorder=7, weight="bold")
    dim(ax, (kc["from"], kc["offset"]), (kc["to"], kc["offset"]), 0.4, "1.12", color=RED, fs=6.5)
    rb = rc["walls"][0]; z0 = min(w["offset"] for w in rc["walls"]); z1 = max(w["offset"] for w in rc["walls"])
    ax.add_patch(Rectangle((rb["from"], z0), rb["to"] - rb["from"], z1 - z0, fc="white", ec=RED, lw=1.2, hatch="////", zorder=6))
    ax.text(rb["to"] + 0.12, z0 + 0.05, "N2 신설 벽 t0.10\n新設壁", fontsize=6.5, color=RED, zorder=7, weight="bold", va="center")
    dim(ax, (rb["from"], z0), (rb["to"], z0), -0.45, "2.30", color=RED, fs=6.5); dim(ax, (-3.954, -4.804), (-3.954, z0), 0.5, f"{z0 + 4.804:.2f} (창 벽 → N2 홀 면)", color=RED, fs=6, side=1)
    # 그 밖의 신설 벽(날개벽 ①②, 화장실 가림벽 ③): N3~N5
    extra = [c for c in m["closures"] if c["id"] not in ("kitchen", "reception") and not c.get("arch") and c.get("walls")]
    for k, c in enumerate([x for x in m["closures"] if x.get("arch")], 6):
        w = c["walls"][0]; a0 = min(x["offset"] for x in c["walls"]); a1 = max(x["offset"] for x in c["walls"])
        if w["axis"] == "z": ax.add_patch(Rectangle((w["from"], a0), w["to"] - w["from"], a1 - a0, fc="white", ec=GOLD, lw=1.2, ls=(0, (3, 2)), zorder=6)); ax.text((w["from"] + w["to"]) / 2, a0 - 0.14, f"N{k} 아치 {w['to'] - w['from']:.2f}", fontsize=6.5, color=GOLD, weight="bold", ha="center", zorder=7)
        else: ax.add_patch(Rectangle((a0, w["from"]), a1 - a0, w["to"] - w["from"], fc="white", ec=GOLD, lw=1.2, ls=(0, (3, 2)), zorder=6)); ax.text(a0 - 0.1, (w["from"] + w["to"]) / 2, f"N{k} 아치 {w['to'] - w['from']:.2f}", fontsize=6.5, color=GOLD, weight="bold", ha="right", va="center", zorder=7)
    for i, c in enumerate(extra, 3):
        ws = c["walls"]; a0 = min(w["offset"] for w in ws); a1 = max(w["offset"] for w in ws); f0, f1 = ws[0]["from"], ws[0]["to"]
        if ws[0]["axis"] == "x":
            ax.add_patch(Rectangle((a0, f0), a1 - a0, f1 - f0, fc="white", ec=RED, lw=1.2, hatch="////", zorder=6)); ax.text(a1 + 0.08, (f0 + f1) / 2, f"N{i}", fontsize=6.5, color=RED, weight="bold", va="center", zorder=7); dim(ax, (a1, f0), (a1, f1), 0.45, f"{f1 - f0:.2f}", color=RED, fs=6, side=-1)
        else:
            ax.add_patch(Rectangle((f0, a0), f1 - f0, a1 - a0, fc="white", ec=RED, lw=1.2, hatch="////", zorder=6)); ax.text((f0 + f1) / 2, a0 - 0.12, f"N{i}", fontsize=6.5, color=RED, weight="bold", ha="center", zorder=7); dim(ax, (f0, a1), (f1, a1), 0.3, f"{f1 - f0:.2f}", color=RED, fs=6)
        if c["id"] == "toilet_screen": dim(ax, (1.57, a1), (1.57, 2.363), 0.0, "0.80", color=RED, fs=6, side=1)
    # 개구부: 주방 옆 통로(커튼)
    ks = next(d for d in m["door_openings"] if d["id"] == "kitchen_side"); w4 = next(w for w in walls if w["id"] == ks["wall"])
    ax.add_patch(Rectangle((w4["offset"] - T - 0.01, ks["from"]), T + 0.02, ks["to"] - ks["from"], fc="white", ec="none", zorder=6))
    ax.plot([w4["offset"] - T / 2] * 2, [ks["from"], ks["to"]], color=RED, lw=1.2, ls=(0, (3, 2)), zorder=7)
    ax.text(w4["offset"] + 0.12, (ks["from"] + ks["to"]) / 2 + 0.3, f"O1 {ks['to'] - ks['from']:.2f}×H{ks['y1']:.2f}\n+커튼", fontsize=5.5, color=RED, va="center", zorder=7, weight="bold")
    # 바닥: 레드 카펫
    for r in rc["floor"]: ax.add_patch(Rectangle((r["x"][0], r["z"][0]), r["x"][1] - r["x"][0], r["z"][1] - r["z"][0], fc="#c9a3a8", ec=RED, lw=0.6, zorder=2))
    ax.text(-2.3, 2.45, "F1 레드 카펫\n約3.6 ㎡", ha="center", va="center", fontsize=6, color=RED, zorder=7, weight="bold")
    # 고정 가구: 레지, 사이드보드, 좌대, 러그
    def box(x, z, w, d, rot, label, fc="#e8dcc8", lw=0.8):
        cs, sn = math.cos(rot), math.sin(rot); pts = [(x + (dx * cs - dz * sn), z + (dx * sn + dz * cs)) for dx, dz in [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]]
        ax.add_patch(Polygon(pts, closed=True, fc=fc, ec=INK, lw=lw, zorder=6)); ax.text(x, z, label, ha="center", va="center", fontsize=5.5, zorder=7)
    box(-3.554, 0.535, 0.8, 0.45, 0, "레지 0.8×0.45"); box(-0.745, 1.526, 1.6, 0.45, 0, "사이드보드 1.6×0.45"); box(-3.72, -0.64, 0.4, 0.4, 0, "좌대")
    ax.add_patch(Rectangle((-0.745 - 0.75, 0.95 - 0.5), 1.5, 1.0, fc="none", ec=RED, lw=0.6, ls=":", zorder=6)); ax.text(-0.745, 0.6, "러그 1.5×1.0", ha="center", fontsize=5.5, color=RED, zorder=7)
    for x, rot in [(-1.33, math.pi - 0.35), (-0.15, math.pi + 0.35)]: box(x, 0.95, 0.5, 0.5, rot, "", fc="#d7e3d9", lw=0.5)
    # 벽 장식 표시
    ax.plot([-2.44, -2.16], [z1 + 0.03] * 2, color=GOLD, lw=3, zorder=7); ax.text(-2.3, z1 + 0.22, "S 글씨", ha="center", fontsize=5.5, color=GOLD, zorder=7, weight="bold")
    ax.plot([-3.825, -3.275], [z1 + 0.03] * 2, color=GOLD, lw=2, zorder=7); ax.text(-3.55, z1 + 0.22, "S 거울", ha="center", fontsize=5.5, color=GOLD, zorder=7, weight="bold")
    ax.plot([-3.65, -2.55], [z0 - 0.03] * 2, color=GOLD, lw=3, zorder=7); ax.text(-3.1, z0 - 0.17, "P2 액자", ha="center", fontsize=5.5, color=GOLD, zorder=7, weight="bold")
    ax.plot([-1.345, -0.145], [1.761 - 0.02] * 2, color=GOLD, lw=3, zorder=7); ax.text(-1.55, 1.75, "P1", ha="right", fontsize=5.5, color=GOLD, zorder=7, weight="bold", va="center")
    # 2인 세트 3팀(영역)
    sets = [(-2.60, -4.72, 0), (0.087, -4.72, 0), (2.237, -1.50, -math.pi / 2)]
    for x, z, rot in sets:
        w, d, back = 2.657, 1.935, -0.05; cs, sn = math.cos(rot), math.sin(rot)
        pts = [(x + (dx * cs - dz * sn), z + (dx * sn + dz * cs)) for dx, dz in [(-w / 2, back), (w / 2, back), (w / 2, back + d), (-w / 2, back + d)]]
        ax.add_patch(Polygon(pts, closed=True, fc="#dbe9f3", ec=BLUE, lw=0.6, ls="--", zorder=2))
    ax.text(-1.25, -2.55, "2인 체험 세트 ×3 (각 2.657 × 1.935) — 가구, 공사 아님 / 家具・工事対象外", ha="center", fontsize=6.5, color=BLUE, zorder=7)
    # 철거 계획 기둥(C1·C3): X 표시
    demo = m.get("demolition_candidates", {})
    for c in cols:
        if c["id"] in demo:
            fx, fz = c["footprint"]["x"], c["footprint"]["z"]; ax.plot([fx[0] - 0.08, fx[1] + 0.08], [fz[0] - 0.08, fz[1] + 0.08], color=RED, lw=1.4, zorder=8); ax.plot([fx[0] - 0.08, fx[1] + 0.08], [fz[1] + 0.08, fz[0] - 0.08], color=RED, lw=1.4, zorder=8)
            ax.text(fx[1] + 0.1, fz[1] + 0.3, f"C{c['num']} 철거 계획\n(구조 확인 필수)", fontsize=6, color=RED, zorder=8)
    # 기둥 거울 표시
    for c in cols:
        if c["num"] in (1, 2, 3) and c["id"] not in demo: fx, fz = c["footprint"]["x"], c["footprint"]["z"]; ax.add_patch(Rectangle((fx[0] - 0.03, fz[0] - 0.03), fx[1] - fx[0] + 0.06, fz[1] - fz[0] + 0.06, fc="none", ec=BLUE, lw=1.0, zorder=7))
    ax.text(0.2, -0.75, "M1: C1·C2·C3 띠 위~천장 4면 거울 / 柱4面ミラー", ha="left", fontsize=6.5, color=BLUE, zorder=7)
    ax.text(-2.9, -0.6, "통로 0.60", ha="center", fontsize=5.5, color=MUTE, zorder=7)
    # 오른쪽 범례·마감표
    x0 = 0.70; fig.text(x0, 0.885, "공사 항목 / 工事項目", fontsize=11, weight="bold"); y = 0.86
    items = [("N1", "주방 입구 막음 벽 1.12 × H2.39, t0.10 — LGS/목틀 + 석고보드, 양면 홀 마감"), ("N2", "레지 뒤 벽 2.30 × H2.39, t0.10 — 남면 크림슨 페인트(#8A1F2B), 북면 홀 마감"),
             ("N3·N4", "사진 코너 양쪽 날개벽 각 1.10 × H2.39, t0.10 — W15 북면·W4 북쪽 끝에서 홀 쪽으로, 홀 마감"), ("N5", "화장실 문 가림벽 1.13 × H2.39, t0.10 — 문 벽에서 0.80 평행, 동쪽 끝 W1 에 붙임"), ("N6", "세면실 아치 출입구 0.86 × 2.05(반원, 스프링 1.62) — N4~N5 사이, 상부 스팬드럴 + 금색 몰딩"), ("N7", "홀 입구 아치 0.90 × 2.07(반원, 스프링 1.62) — N2 동쪽 끝 ~ N3 사이, 상부 스팬드럴 + 금색 몰딩"), ("D", "C1·C3 철거 계획 — 구조 기둥 여부 확인 후 결정"), ("P3", "화장실 문 앞 포토 스폿 — 문 앞 0.8 m 공간 네 면 리프 모자이크 타일(베이지) + N5 안쪽 면 금테 타원 거울 64×92 + 스포트 1"), ("D2", "화장실 문 교체 — 경첩 동쪽(W1 쪽)·세면실 안쪽으로 여는 문"),
             ("O1", "W4 에 개구 0.53 × H1.98 (직원 통로) + 검은 봉·암막 커튼"), ("F1", "레드 카펫 약 3.6 ㎡ (입구 통로 + 레지 앞), 기존 마루 위"), ("P1", "사이드보드 코너(W15·N1 앞): 벽 거울 1.2×0.6 걸이, 사이드보드 1.6×0.45 반입"), ("P2", "N2 북면: 액자 1.1×0.85 걸이, 좌대"),
             ("M1", "기둥 C1·C2·C3 띠 위~천장 4면 거울 (비산방지 필름)"), ("S", "N2 남면: 船場美術館 세로 금박 절단문자 H1.1(통로 정중앙) + 원형 거울 φ0.55(레지 위)"), ("L", "트랙 스포트라이트 3 등 추가 (사이드보드 2 · P2 1)")]
    for k, t in items: fig.text(x0, y, k, fontsize=7.5, weight="bold", color=RED); fig.text(x0 + 0.034, y, t, fontsize=6.8, va="top", wrap=True); y -= 0.028
    y = legend_box(fig, x0, y - 0.01, 0.27, [(dict(fc="white", ec=RED, hatch="////"), "신설 벽 / 新設壁"), (dict(fc="#c9a3a8", ec=RED), "레드 카펫 / 赤カーペット"), (dict(fc="#dbe9f3", ec=BLUE, ls="--"), "체험 세트 영역(가구)"), (dict(fc="#e8dcc8", ec=INK), "고정 가구 위치(반입)")], "범례 / 凡例")
    fig.text(x0, y - 0.01, "※ 벽·바닥·천장 마감은 ③ 참조.  임대 원상복구 조건 확인 후 고정 방식 결정.", fontsize=7.5, color=MUTE, va="top", wrap=True)
    pdf.savefig(fig); plt.close(fig)


def page_finish(pdf, m):
    fig = plt.figure(figsize=A3)
    header(fig, "③ 벽 마감 상세  /  壁仕上げ詳細", "전 벽 공통 단면 (큰방 W1·W2·W9·W10·W15·W18·N1·N2 홀 면·기둥).  단위 mm.  높이 A 는 현장 실측 후 확정.", 3)
    ax = fig.add_axes([0.05, 0.08, 0.38, 0.80]); ax.axis("off"); ax.set_xlim(-520, 420); ax.set_ylim(-80, 2500); ax.set_aspect("auto")
    # 벽 단면: 가로 mm(벽에서 앞으로), 세로 mm
    ax.add_patch(Rectangle((-60, 0), 60, 2393, fc="#ddd", ec=INK)); ax.text(-30, 2440, "기존 벽(벽지)\n既存壁", ha="center", fontsize=8)
    ax.add_patch(Rectangle((-120, -60), 520, 60, fc="#c9a97a", ec=INK)); ax.text(300, -35, "바닥 — 기존 마루 그대로 / 床 既存", fontsize=8)
    ax.add_patch(Rectangle((0, 0), 6, 112, fc="#6b4a2e", ec=INK)); ax.add_patch(Rectangle((0, 816), 10, 74, fc="#111", ec=INK))
    ax.add_patch(Rectangle((10, 3), 7, 887, fc="#a8774d", ec=INK)); ax.add_patch(Rectangle((0, 890), 25, 12, fc="#7a5333", ec=INK))
    ax.add_patch(Rectangle((0, 902), 2, 2393 - 902, fc="#39433a", ec="none"))
    ax.add_patch(Rectangle((-60, 2393), 520, 40, fc="#eee", ec=INK)); ax.text(200, 2460, "천장 — 기존 그대로 / 天井 既存", fontsize=8)
    def d(x, y0, y1, label, c=RED):
        ax.annotate("", xy=(x, y0), xytext=(x, y1), arrowprops=dict(arrowstyle="<->", color=c, lw=0.9)); ax.text(x - 10, (y0 + y1) / 2, label, color=c, fontsize=8.5, va="center", ha="right")
    d(-180, 0, 890, "A ≈ 890 (스캔)\n→ 실측 확정\n판 900 이하 필수"); d(-330, 0, 2393, "✓ 천장고 2393"); d(-110, 816, 890, "✓ 띠 74"); d(-110, 0, 112, "✓ 걸레받이 112")
    ax.annotate("", xy=(0, 780), xytext=(10, 780), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(40, 780, "✓ 띠 돌출 10", color=RED, fontsize=8.5, va="center")
    ax.annotate("", xy=(0, 140), xytext=(6, 140), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(40, 140, "✓ 걸레받이 돌출 4~7 → 판 아래 스페이서 3~6", color=RED, fontsize=8.5, va="center")
    for y, t in [(1700, "① 상부 벽: 벽지 위 수성 페인트 2~3회\n   ダルグリーン(#39433A, STYLE 참고) / 上部 塗装"), (902 + 30, "③ 見切り材 25×12 (lite 전용) — 판 위끝 + 벽 틈 덮음"),
                 (450, "② 하부: エアサーモパネルlite Dタイプ 7×313(유효 304)×900\n   바닥~검은 띠 위끝까지 세로 붙임, 띠·걸레받이는 판 뒤 받침\n   下部 パネル貼り（帯・幅木を覆う）"), (60, "④ 바닥 틈 2~3: 見切り材 또는 코킹")]:
        ax.text(60, y, t, fontsize=8.5, va="center")
    # 오른쪽 사양표
    x0 = 0.48; fig.text(x0, 0.885, "마감 사양 / 仕上げ仕様", fontsize=11, weight="bold")
    spec = [("상부 벽 (띠 위~천장)", "수성 페인트 ダルグリーン #39433A · 비닐 벽지 위 밀착 프라이머 + 2~3회. 면적 약 45~50 ㎡ (창 제외)"),
            ("하부 벽 (바닥~띠 위끝)", "エアサーモパネルlite D (RESTA) 7×313×900, 유효폭 304 — 약 140장(여유 포함). 양면테이프/접착: 원상복구 조건 확인"),
            ("판 위끝·옆끝", "lite 見切り材 25×12×1200 — 위끝 약 39 m(33본) + 옆끝(기둥 모서리·창 옆) 약 17본 → 약 50본"),
            ("검은 띠·걸레받이", "철거 없음. 판 뒤에 숨김"),
            ("기둥 C1~C3", "띠 위(≈0.89)~천장 4면 거울, 모서리 맞댐, 비산방지 필름. 아래는 판"),
            ("N1·N2 신설 벽", "LGS 또는 목틀 + PB 12.5 양면, 천장까지. N2 남면 크림슨 #8A1F2B 무광 페인트(띠·걸레받이 없음), 북면·N1 양면은 홀과 동일(ダルグリーン + 판)"),
            ("O1 개구", "W4 끝 0.53×1.98 개구, 상부 검은 봉 + 암막 커튼(짙은 회색)"),
            ("바닥", "기존 원목 마루 유지. F1 구간만 레드 카펫(타일 카펫 50 cm 약 18장 또는 롤)"),
            ("천장·조명", "기존 유지. 트랙에 스포트 3 등 추가(전구색 2700~3000K, 24~36°)"),
            ("문·설비", "화장실 문·세면대·싱크대 기존 유지. 콘센트가 판에 걸리면 따내기(박스 이설은 電気工事士)")]
    y = 0.86
    for a, b in spec:
        fig.text(x0, y, a, fontsize=8.5, weight="bold", va="top"); fig.text(x0 + 0.115, y, b, fontsize=7.8, va="top", wrap=True)
        y -= 0.042 if len(b) > 70 else 0.034
        fig.add_artist(plt.Line2D([x0, 0.97], [y + 0.008, y + 0.008], color="#ddd", lw=0.6))
    fig.text(x0, y - 0.01, "색 견본: ダルグリーン은 STYLE 150 ml 견본 칠해 본 뒤 최종 결정. 판 색은 샘플로 확인 후 지정.", fontsize=7.5, color=MUTE, va="top", wrap=True)
    pdf.savefig(fig); plt.close(fig)


def page_scope(pdf, m):
    fig = plt.figure(figsize=A3)
    header(fig, "④ 공사 범위 · 견적 의뢰 항목  /  工事範囲・見積依頼項目", "DIY 가능 항목은 표시. 업체에는 ‘업체’ 항목 견적을 요청. 수량은 3D·실측 기준 개략 — 현장 실측 후 확정.", 4)
    cols_x = [0.035, 0.075, 0.33, 0.56, 0.70, 0.85]; heads = ["No", "항목 / 項目", "사양 / 仕様", "수량(개략)", "시공", "비고"]
    y = 0.885
    for x, h in zip(cols_x, heads): fig.text(x, y, h, fontsize=9.5, weight="bold")
    fig.add_artist(plt.Line2D([0.035, 0.97], [y - 0.008, y - 0.008], color=INK, lw=0.8)); y -= 0.03
    rows = [
        ("1", "N1 주방 입구 막음 벽", "1.12 × H2.39, t0.10, 양면 PB, 홀 마감", "1개소", "업체", "현 입구 소핏 아래"),
        ("2", "N2 레지 뒤 벽", "2.30 × H2.39, t0.10, 남면 크림슨 페인트 / 북면 홀 마감", "1개소", "업체", "홀 쪽 통로 0.60 확보"),
        ("2b", "N3·N4 사진 코너 날개벽", "각 1.10 × H2.39, t0.10, 양면 홀 마감", "2개소", "업체", "사이드보드 양옆"),
        ("2c", "N5 화장실 문 가림벽", "1.13 × H2.39, t0.10, 문에서 0.80, 동쪽 끝 W1 에 붙임", "1개소", "업체", "위치 현장 조정"),
        ("2d", "N6 아치 출입구", "폭 0.86, 스프링 1.62, 꼭대기 2.05 반원 — 상부 스팬드럴 + 금색 몰딩", "1개소", "업체", "N4~N5 사이"),
        ("2e", "N7 홀 입구 아치", "폭 0.90, 스프링 1.62, 꼭대기 2.07 반원 — 상부 스팬드럴 + 금색 몰딩", "1개소", "업체", "N2~N3 사이"),
        ("8b", "P3 화장실 앞 포토 스폿", "거울 벽(N5 안쪽 면 1.13×2.39 ≈ 2.7 ㎡)만 리프 모자이크 타일(0.2 m 반복, 베이지) + 금테 타원 거울 64×92. 문 쪽 벽(W10 홀 면)·양옆(W1·W4)은 무지 크림색 페인트 + 같은 크림 톤 체어레일 H0.92(45×18)·걸레받이 H0.10", "1식", "업체(타일)+DIY(페인트)", "참고 사진: 거울에 비친 문 쪽 벽"),
        ("8c", "D2 화장실 문 교체", "폭 0.645, 경첩 동쪽, 안여닫이(세면실 쪽), 월넛(적갈색) 2단 패널 문 + 새틴 니켈 레버, 도어클로저", "1개소", "업체", "기존 바깥여닫이 회색 철문 철거"),
        ("D", "C1·C3 철거", "얇은 기둥 2본 — 구조 기둥이면 불가. 구조 확인 선행", "2본", "업체(구조)", "계획 단계"),
        ("3", "O1 W4 개구 + 커튼", "0.53 × H1.98 개구, 보강, 검은 봉 + 암막 커튼", "1개소", "업체", "구조 확인"),
        ("4", "상부 벽 페인트", "ダルグリーン, 프라이머 + 2~3회", "약 45~50 ㎡", "업체 또는 DIY", "벽지 상태·밀착 테스트"),
        ("5", "하부 벽 판 + 見切り材", "エアサーモパネルlite 7 mm, 바닥~띠 위끝, 見切り材 25×12", "판 약 140장 · 見切り材 약 50본", "DIY 예정", "높이 A 실측 후 발주"),
        ("6", "기둥 4면 거울", "C1~C3 띠 위~천장, 비산방지 필름, 모서리 맞댐", "3기둥 × 4면 = 12면 (약 13 ㎡)", "업체(거울점)", "치수 현장 실측"),
        ("7", "레드 카펫", "입구 통로 1.09×1.31 + 레지 앞 2.19×0.99", "약 3.6 ㎡", "업체 또는 DIY", "타일 카펫 가능"),
        ("8", "간판 글씨·거울", "船場美術館 세로 금박 절단문자 H1.1 · 원형 거울 φ0.55", "1식", "업체(사인)", "N2 남면"),
        ("9", "조명 추가", "트랙 스포트 3등 (2700~3000K)", "3등", "업체(전기) / DIY", "기존 트랙 이용"),
        ("10", "레지 카운터", "0.8×0.45×H1.0 (제작 또는 기성)", "1대", "제작 또는 구입", "벽 2 에 붙임"),
        ("11", "콘센트·스위치", "판 시공 구간 따내기, 필요 시 박스 이설", "현장 확인", "업체(전기)", "電気工事士"),
        ("—", "기존 유지", "바닥 마루 · 천장 · 검은 띠 · 걸레받이 · 창 · 화장실 문 · 싱크대 · 자동문", "", "", "철거 없음"),
    ]
    for r in rows:
        for x, t in zip(cols_x, r): fig.text(x, y, t, fontsize=8, va="top", wrap=True)
        y -= 0.033; fig.add_artist(plt.Line2D([0.035, 0.97], [y + 0.008, y + 0.008], color="#ddd", lw=0.6))
    y -= 0.01; fig.text(0.035, y, "업체 확인 요청 / 業者への確認事項", fontsize=11, weight="bold", color=RED); y -= 0.028
    for t in ["• 임대 원상복구(原状回復) 조건에 맞는 고정 방식(신설 벽 바닥·천장 고정, 판 접착) 제안", "• N1·N2 가 천장 트랙·에어컨·스프링클러·배선과 간섭하는지", "• 벽지 위 페인트 가능 여부(비닐/오염방지 코팅), 필요 시 프라이머 종류",
              "• 기둥 거울 시공 방식(접착 + 비산방지 필름, 모서리 처리)과 안전 기준", "• 공사 기간 및 영업 중 시공 가능 여부", "• 견적은 항목별(1~11) 분리 — DIY 항목은 자재만 또는 제외"]:
        fig.text(0.04, y, t, fontsize=8.5, color=RED); y -= 0.021
    fig.text(0.035, 0.05, "첨부: 3D 뷰어(E안) https://85mighty.github.io/senba-ops/kobe-interior/kobe-gallery-3d/app/  ·  현장 사진 11장  ·  실측 손글씨 평면도(11/07)", fontsize=8, color=MUTE)
    pdf.savefig(fig); plt.close(fig)


def main():
    m, walls, cols = load(); OUT.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(OUT) as pdf:
        page_current(pdf, m, walls, cols); page_plan(pdf, m, walls, cols); page_finish(pdf, m); page_scope(pdf, m)
    print(f"[도면] {OUT}")


if __name__ == "__main__":
    main()
