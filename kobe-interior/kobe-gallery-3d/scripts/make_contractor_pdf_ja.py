"""施工業者向け図面（日本語・E案）— A3 横 5 枚, 平面 1:50.
① 現況平面図（実測）  ② 計画平面図（新設壁・開口・レジ・床仕上げ, 壁と壁の距離を全て記入）
③ 部分拡大図 1:25（レセプション・写真コーナー・トイレ前・レジ）  ④ 新設壁・開口部 詳細（立面・一覧表）  ⑤ 壁仕上げ断面  ⑥ 工事項目一覧
形状は 3D スキャン(geometry_metadata.json), 寸法は 2026-11-07 / 11-10 の現場実測を優先。 ✓ = 実測, (ス) = スキャン推定。
インテリア小物（家具・額・鏡・ラグ・体験セット）は載せない。レジカウンターのみ記載。
使い方: python3 scripts/make_contractor_pdf_ja.py  →  ../도면/施工図_E案_日本語.pdf"""
import json, math
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle, Polygon, Arc, Circle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "도면" / "施工図_E案_日本語.pdf"
plt.rcParams["font.family"] = ["IPAPGothic", "WenQuanYi Zen Hei", "DejaVu Sans"]
A3_MM = (420.1, 296.9); A3 = (A3_MM[0] / 25.4, A3_MM[1] / 25.4)
SCALE = 50
INK, MUTE, GREEN, RED, BLUE, GOLD, CREAM = "#1a1a1a", "#777", "#2f6f5e", "#b33", "#2c6fb0", "#9a7a1a", "#b08a3a"
DATE = "2026-11-17"
PAGES = 6


# ---------------------------------------------------------------- データ
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


def geo(m, walls, cols):
    """図面に使う座標をまとめる(全て m, 3D ビューア座標: x 東+, z 南+, 窓壁 z=-4.804)"""
    W = {w["id"]: w for w in walls}; C = {c["num"]: c for c in cols}
    cl = {c["id"]: c for c in m["closures"]}
    rec = cl["reception"]["walls"]; ha = cl["hall_arch"]["walls"]; ww = cl["photo_wing_w"]["walls"]; we = cl["photo_wing_e"]["walls"]; ts = cl["toilet_screen"]["walls"]; ta = cl["toilet_arch"]["walls"]; kc = cl["kitchen"]["wall"]
    g = dict(
        W2=W["wall_x_1"]["offset"], W1=W["wall_x_0"]["offset"], W9=W["wall_z_8"]["offset"], W11=W["wall_z_10"]["offset"], W3=W["wall_x_2"]["offset"], W5=W["wall_x_4"]["offset"], W4=W["wall_x_3"]["offset"],
        W10=W["wall_z_9"]["offset"], W10_face=W["wall_z_9"]["offset"] - 0.05, W15=W["wall_z_14"]["offset"],
        N2=dict(x0=rec[0]["from"], x1=rec[0]["to"], zN=min(w["offset"] for w in rec), zS=max(w["offset"] for w in rec)),
        N7=dict(x0=min(w["offset"] for w in ha), x1=max(w["offset"] for w in ha), z0=ha[0]["from"], z1=ha[0]["to"], spring=cl["hall_arch"]["arch"]["spring"]),
        N3=dict(x0=min(w["offset"] for w in ww), x1=max(w["offset"] for w in ww), z0=ww[0]["from"], z1=ww[0]["to"]),
        N4=dict(x0=min(w["offset"] for w in we), x1=max(w["offset"] for w in we), z0=we[0]["from"], z1=we[0]["to"]),
        N5=dict(z0=min(w["offset"] for w in ts), z1=max(w["offset"] for w in ts), x0=ts[0]["from"], x1=ts[0]["to"]),
        N6=dict(z0=min(w["offset"] for w in ta), z1=max(w["offset"] for w in ta), x0=ta[0]["from"], x1=ta[0]["to"], spring=cl["toilet_arch"]["arch"]["spring"]),
        N1=dict(z=kc["offset"], x0=kc["from"], x1=kc["to"]),
        tile=cl["washroom_tile"]["region"], carpets=cl["reception"]["floor"],
        door=next(d for d in m["door_openings"] if d["id"] == "toilet_door"), o1=next(d for d in m["door_openings"] if d["id"] == "kitchen_side"),
        reg=dict(cx=-3.132, cz=1.45, w=0.455, d=1.10),            # レジ 1.10(南北) × 0.455(東西), 客側 = 東
        C=C, ceil=m["measured_20261107"]["ceiling_height"],
    )
    r = g["reg"]; r.update(x0=r["cx"] - r["w"] / 2, x1=r["cx"] + r["w"] / 2, z0=r["cz"] - r["d"] / 2, z1=r["cz"] + r["d"] / 2)
    return g


# ---------------------------------------------------------------- 作図部品
def plan_axes(fig, xlim, zlim, left_mm=14, top_mm=34, scale=SCALE):
    w_mm = (xlim[1] - xlim[0]) * 1000 / scale; h_mm = (zlim[1] - zlim[0]) * 1000 / scale
    ax = fig.add_axes([left_mm / A3_MM[0], 1 - (top_mm + h_mm) / A3_MM[1], w_mm / A3_MM[0], h_mm / A3_MM[1]])
    ax.set_xlim(*xlim); ax.set_ylim(zlim[1], zlim[0]); ax.set_aspect("equal"); ax.axis("off"); return ax


def dim(ax, p1, p2, off, text, color=INK, fs=7, side=1, tick=0.05):
    (x1, z1), (x2, z2) = p1, p2; dx, dz = x2 - x1, z2 - z1; L = math.hypot(dx, dz) or 1
    nx, nz = -dz / L * off * side, dx / L * off * side; a = (x1 + nx, z1 + nz); b = (x2 + nx, z2 + nz)
    ax.plot([a[0], b[0]], [a[1], b[1]], color=color, lw=0.7, zorder=9)
    for p, q in [((x1, z1), a), ((x2, z2), b)]: ax.plot([p[0], q[0]], [p[1], q[1]], color=color, lw=0.4, zorder=9)
    for p in (a, b): ax.plot([p[0] - tick, p[0] + tick], [p[1] + tick, p[1] - tick], color=color, lw=0.8, zorder=9)
    rot = 90 if abs(dx) < abs(dz) else 0; tx, tz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    ax.text(tx + (-0.09 if rot else 0), tz + (0 if rot else -0.07), text, ha="center", va="center", rotation=rot, fontsize=fs, color=color, zorder=10, bbox=dict(fc="white", ec="none", pad=0.5, alpha=0.92))


def wall_rect(ax, w, T=0.1, fc="#333", ec=INK, lw=0.6, hatch=None, z=3):
    if w.get("two_sided"): o0, o1 = w["offset"] - T / 2, w["offset"] + T / 2
    else: o0, o1 = sorted([w["offset"], w["offset"] - w["inward"] * T])
    r = Rectangle((o0, w["from"]), o1 - o0, w["to"] - w["from"]) if w["axis"] == "x" else Rectangle((w["from"], o0), w["to"] - w["from"], o1 - o0)
    r.set(fc=fc, ec=ec, lw=lw, hatch=hatch, zorder=z); ax.add_patch(r); return r


def new_wall(ax, x0, x1, z0, z1, label=None, lx=None, lz=None, ha="center", va="center"):
    ax.add_patch(Rectangle((x0, z0), x1 - x0, z1 - z0, fc="white", ec=RED, lw=1.2, hatch="////", zorder=6))
    if label: ax.text(lx if lx is not None else (x0 + x1) / 2, lz if lz is not None else (z0 + z1) / 2, label, fontsize=6.5, color=RED, weight="bold", ha=ha, va=va, zorder=8)


def arch_wall(ax, x0, x1, z0, z1, label, lx, lz, ha="center", va="center"):
    ax.add_patch(Rectangle((x0, z0), x1 - x0, z1 - z0, fc="#fff6dd", ec=GOLD, lw=1.2, ls=(0, (3, 2)), zorder=6))
    ax.text(lx, lz, label, fontsize=6.5, color=GOLD, weight="bold", ha=ha, va=va, zorder=8)


def draw_base(ax, m, walls, cols, g, show_nums=True, demolish=False):
    fixture, ext = set(m.get("fixture_walls", {})), {"wall_z_11"}; gone = set(m.get("removed_elements", []))
    for w in walls:
        if w["id"] in fixture or w["id"] in gone: continue
        grey = w["id"] in ext; wall_rect(ax, w, fc="#bbb" if grey else "#333", ec="#999" if grey else INK)
    for ov in m.get("window_overrides", []):
        for win in ov["windows"]:
            z = ov["offset"]; ax.add_patch(Rectangle((win["from"], z - 0.1), win["to"] - win["from"], 0.1, fc="white", ec=INK, lw=0.6, zorder=4))
            for k in (0.03, 0.07): ax.plot([win["from"], win["to"]], [z - k, z - k], color=BLUE, lw=0.8, zorder=5)
    for d in m.get("door_openings", []):
        if d.get("when"): continue
        w = next(x for x in walls if x["id"] == d["wall"]); T = 0.1
        if w["axis"] == "z":
            ax.add_patch(Rectangle((d["from"], w["offset"] - T / 2 - 0.01), d["to"] - d["from"], T + 0.02, fc="white", ec="none", zorder=4)); ax.plot([d["from"], d["to"]], [w["offset"]] * 2, color=INK, lw=0.5, ls=(0, (2, 2)), zorder=5)
        else:
            ax.add_patch(Rectangle((w["offset"] - T / 2 - 0.01, d["from"]), T + 0.02, d["to"] - d["from"], fc="white", ec="none", zorder=4)); ax.plot([w["offset"]] * 2, [d["from"], d["to"]], color=INK, lw=0.5, ls=(0, (2, 2)), zorder=5)
    e = next(x for x in m["elements"] if x["type"] == "door_panel"); fx, fz = e["footprint"]["x"], e["footprint"]["z"]
    ax.add_patch(Rectangle((fx[0], fz[0]), fx[1] - fx[0], fz[1] - fz[0], fc="white", ec=BLUE, lw=1.2, zorder=5)); ax.text((fx[0] + fx[1]) / 2, fz[1] + 0.22, "自動ドア（既存）", ha="center", fontsize=7, color=BLUE, zorder=6)
    demo = m.get("demolition_candidates", {})
    for c in cols:
        fx, fz = c["footprint"]["x"], c["footprint"]["z"]
        ax.add_patch(Rectangle((fx[0], fz[0]), fx[1] - fx[0], fz[1] - fz[0], fc="#555", ec=INK, lw=0.6, zorder=5))
        if show_nums: ax.text(fx[1] + 0.07, fz[0] + 0.02, f"C{c['num']}", fontsize=7.5, weight="bold", va="top", color=INK, zorder=6)
        if demolish and c["id"] in demo:
            ax.plot([fx[0] - 0.08, fx[1] + 0.08], [fz[0] - 0.08, fz[1] + 0.08], color=RED, lw=1.4, zorder=8); ax.plot([fx[0] - 0.08, fx[1] + 0.08], [fz[1] + 0.08, fz[0] - 0.08], color=RED, lw=1.4, zorder=8)
            ax.text(fx[1] + 0.1, fz[1] + 0.28, f"C{c['num']} 撤去計画\n（構造確認必須）", fontsize=6, color=RED, zorder=8)
    k = m["kitchen"]; s = k["sink"]
    ax.add_patch(Rectangle((s["x"][0], s["z"][0]), s["x"][1] - s["x"][0], s["z"][1] - s["z"][0], fc="#eee", ec=MUTE, lw=0.5, zorder=4)); ax.text((s["x"][0] + s["x"][1]) / 2, (s["z"][0] + s["z"][1]) / 2, "シンク（既存）", ha="center", va="center", fontsize=6, color=MUTE, zorder=6)
    st = m["toilet_stall"]; ax.add_patch(Rectangle((st["x"][0], st["z"][0]), st["x"][1] - st["x"][0], st["z"][1] - st["z"][0], fc="#f4efe6", ec=MUTE, lw=0.5, zorder=4)); ax.text((st["x"][0] + st["x"][1]) / 2, (st["z"][0] + st["z"][1]) / 2, "WC", ha="center", va="center", fontsize=7, color=MUTE, zorder=6)
    if show_nums:
        for w in walls:
            if w["id"] in fixture or w["id"] in gone: continue
            xs, zs = ([w["offset"]] * 2, [w["from"], w["to"]]) if w["axis"] == "x" else ([w["from"], w["to"]], [w["offset"]] * 2)
            mx, mz = (xs[0] + xs[1]) / 2, (zs[0] + zs[1]) / 2; gg = 0.22 * w["inward"]; lx, lz = (mx + gg, mz) if w["axis"] == "x" else (mx, mz + gg)
            ax.text(lx, lz, f"W{w['num']}", ha="center", va="center", fontsize=6.5, color=GREEN, weight="bold", zorder=7, bbox=dict(fc="white", ec=GREEN, lw=0.5, pad=0.8, boxstyle="round,pad=0.25"))
    ax.annotate("", xy=(3.75, -5.45), xytext=(3.75, -5.0), arrowprops=dict(arrowstyle="-|>", color=INK, lw=0.8)); ax.text(3.9, -5.25, "窓側（北）", fontsize=7, va="center")
    ax.text(-2.3, 2.35, "玄関通路", ha="center", va="center", fontsize=6, color=MUTE, zorder=6); ax.text(-0.4, 2.7, "キッチン", ha="center", va="center", fontsize=7, color=MUTE, zorder=6); ax.text(1.65, 3.4, "洗面室", ha="center", va="center", fontsize=7, color=MUTE, zorder=6)
    ax.text(-2.4, 4.3, "玄関の外（踊り場）\n工事範囲外", ha="center", va="center", fontsize=7, color="#999")


def header(fig, title, sub, page):
    fig.text(0.033, 0.955, title, fontsize=17, weight="bold"); fig.text(0.033, 0.928, sub, fontsize=9, color=MUTE)
    fig.text(0.97, 0.955, f"船場美術館 神戸店（三宮）  E案  {DATE}   {page}/{PAGES}", fontsize=9, ha="right", color=MUTE)
    fig.text(0.97, 0.935, "✓ = 現場実測 (2026-11-07 / 11-10)   (ス) = 3D スキャン推定 — 着工前に現場で再確認のこと   単位 m（断面図は mm）", fontsize=8, ha="right", color=MUTE)
    fig.add_artist(plt.Line2D([0.033, 0.97], [0.92, 0.92], color=INK, lw=0.8))


def legend(fig, x, y, items, title):
    fig.text(x, y, title, fontsize=10, weight="bold"); yy = y - 0.026
    for sw, t in items:
        fig.add_artist(Rectangle((x, yy - 0.004), 0.016, 0.013, transform=fig.transFigure, **sw)); fig.text(x + 0.022, yy, t, fontsize=8.5, va="center"); yy -= 0.021
    return yy


# ---------------------------------------------------------------- ① 現況
def page_current(pdf, m, walls, cols, g):
    fig = plt.figure(figsize=A3); M = m["measured_20261107"]
    header(fig, "① 現況平面図（実測）", "縮尺 1:50（A3 原寸印刷時）。寸法は図より数値を優先。壁番号 W・柱番号 C は 3D ビューアと共通。", 1)
    ax = plan_axes(fig, (-5.3, 4.6), (-6.3, 5.6)); draw_base(ax, m, walls, cols, g)
    W2, W1, WW, W11 = g["W2"], g["W1"], g["W9"], g["W11"]
    dim(ax, (W2, WW), (W1, WW), -1.25, "✓ 6.271 (W2 ↔ W1 内法)"); dim(ax, (W1, WW), (W1, W11), 0.9, "✓ 6.840 (窓壁 W9 ↔ W11)", side=-1)
    ws = m["window_overrides"][0]["windows"]; xs = [W2, ws[0]["from"], ws[0]["to"], ws[1]["from"], ws[1]["to"], W1]
    for a, b, t in zip(xs[:-1], xs[1:], ["✓0.28", "✓2.66 (ガラス)", "✓0.295", "✓2.66 (ガラス)", "✓0.285"]): dim(ax, (a, WW), (b, WW), -0.5, t, color=BLUE, fs=6.5)
    ax.text(-0.6, -4.45, "窓台 0.55・窓上端 1.78（ス）, カーテンボックス有り。 窓幅 2.66 がガラスか枠込みか要確認（合計 6.18 < 室幅 6.271）", fontsize=6.5, color=BLUE, ha="center")
    c = g["C"]; zc = -1.08
    pts = [(W2, "W2")] + [((c[i]["footprint"]["x"][0] + c[i]["footprint"]["x"][1]) / 2, f"C{i}") for i in (1, 2, 3)] + [(W1, "W1")]
    for (a, _), (b, _), t in zip(pts[:-1], pts[1:], ["✓1.500", "✓1.383", "✓1.389", "✓1.473"]): dim(ax, (a, zc), (b, zc), 0.55, t, fs=6.5)
    dim(ax, (W2, zc), (pts[2][0], zc), 1.0, "✓3.055 (W2 → C2 中心)", fs=6.5); dim(ax, (pts[2][0], zc), (W1, zc), 1.0, "✓3.010 (C2 中心 → W1)", fs=6.5)
    for i in (1, 2, 3):
        fz = c[i]["footprint"]["z"]; fx = c[i]["footprint"]["x"]; cx = (fx[0] + fx[1]) / 2
        dim(ax, (cx, WW), (cx, fz[0]), 0.0, f"✓{M['columns_from_window_wall']['col' + str(i)]:.3f}", color=MUTE, fs=6, side=1)
        ax.text(fx[1] + 0.07, fz[1] + 0.02, f"幅 {(fx[1]-fx[0])*100:.0f}（逆算）\n奥行 {(fz[1]-fz[0])*100:.0f}（ス）", fontsize=5.5, color=MUTE, va="top")
    ent = next(x for x in m["elements"] if x["type"] == "door_panel"); ez = ent["footprint"]["z"][0]
    cx1 = (c[1]["footprint"]["x"][0] + c[1]["footprint"]["x"][1]) / 2; cx3 = (c[3]["footprint"]["x"][0] + c[3]["footprint"]["x"][1]) / 2
    dim(ax, (cx1, c[1]["footprint"]["z"][1]), (cx1, ez), 0.0, "✓4.022 (C1 → 自動ドア)", color=MUTE, fs=6, side=-1)
    dim(ax, (cx3, c[3]["footprint"]["z"][1]), (cx3, W11), 0.0, "✓3.476 (C3 → W11)", color=MUTE, fs=6, side=1)
    dim(ax, (W2, 1.6), (g["W5"], 1.6), 0.0, "✓2.158 (W2 ↔ W5)", fs=6.5); dim(ax, (g["W3"], 2.72), (g["W5"], 2.72), 0.0, "✓1.093 (W3 ↔ W5 通路)", fs=5.5, color=MUTE)
    dim(ax, (-3.8, W11), (-3.8, ez), 0.0, "✓0.965 (W11 → 自動ドア)", fs=5.5, color=MUTE, side=-1)
    dim(ax, (-1.046, 3.4), (g["W4"], 3.4), 0.0, "✓1.209 (W7 ↔ W4)", fs=6.5); dim(ax, (g["W4"], 1.6), (W1, 1.6), 0.0, "✓2.087 (W4 ↔ W1)", fs=6.5)
    dim(ax, (g["W4"], 2.9), (1.128, 2.9), 0.0, "✓1.025 (W4 ↔ W6)", fs=6, color=MUTE); dim(ax, (1.128, 4.9), (2.145, 4.9), 0.0, "✓1.124 (W6 ↔ W17)", fs=6, color=MUTE)
    dim(ax, (1.7, g["W10"]), (1.7, 4.58), 0.0, "✓2.17 洗面室 奥行", fs=6, color=MUTE, side=1)
    td = g["door"]; dim(ax, (td["from"], g["W10"]), (td["to"], g["W10"]), -0.35, "✓0.645 ドア", fs=6, color=MUTE); dim(ax, (td["to"], g["W10"]), (W1, g["W10"]), -0.35, "✓0.42", fs=6, color=MUTE)
    sd = next(d for d in m["door_openings"] if d["id"] == "stall_door"); dim(ax, (1.128, g["W10"]), (1.128, sd["from"]), 0.0, "✓0.66", fs=6, color=MUTE, side=-1)
    # 11/10 実測（レセプション側）
    dim(ax, (W2, W11), (g["W3"], W11), 0.45, "✓1.05 (W2 ↔ W3 線, 11/10)", fs=6, color=MUTE)
    x0 = 0.70; fig.text(x0, 0.885, "高さ実測", fontsize=11, weight="bold")
    rows = [("天井高", "✓ 2.393 m"), ("黒い帯（チェアレール）", "✓ 高さ 7.4 cm・壁から 1.0 cm 出"), ("床 → 帯上端", "(ス) 約 0.89 m — 未実測"), ("床 → 帯下端", "(ス) 約 0.81 m — 未実測"),
            ("幅木（木）", "✓ 11.2 cm・出 0.4〜0.7 cm"), ("窓台高さ", "(ス) 0.55 m"), ("床", "無垢風フローリング — 既存のまま"), ("壁紙", "グレー ビニールクロス（推定）— 状態確認要")]
    y = 0.86
    for a, b in rows: fig.text(x0, y, a, fontsize=8.5); fig.text(x0 + 0.12, y, b, fontsize=8.5, color=INK if "✓" in b else MUTE); y -= 0.022
    fig.text(x0, y - 0.015, "未実測・要現場確認", fontsize=11, weight="bold", color=RED); y -= 0.045
    for t in ["• 床 → 黒い帯上端の高さ（パネル長 900 の可否）", "• 柱 C1〜C3 の幅・奥行（幅は逆算値）", "• 窓幅 2.66 がガラスか枠込みか", "• 自動ドア幅, W11・W3 の長さ, コンセント・スイッチ位置",
              "• 壁紙の種類（ビニール／防汚コート）— 塗装の密着確認", "• C1・C3 が構造柱かどうか（撤去計画）"]:
        fig.text(x0, y, t, fontsize=8.5, color=RED); y -= 0.021
    legend(fig, x0, y - 0.015, [(dict(fc="#333"), "既存壁"), (dict(fc="#bbb"), "工事範囲外"), (dict(fc="white", ec=BLUE), "窓"), (dict(fc="#555"), "柱 C")], "凡例")
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ② 計画平面
def draw_plan_items(ax, m, cols, g, detail):
    """新設壁・開口・床仕上げ・レジ（②全体図と③拡大図で共通）。detail=True で拡大図用の細かい表記"""
    W2, W1, W9, W11, W10f, W4, W5, W15 = g["W2"], g["W1"], g["W9"], g["W11"], g["W10_face"], g["W4"], g["W5"], g["W15"]
    N1, N2, N3, N4, N5, N6, N7 = g["N1"], g["N2"], g["N3"], g["N4"], g["N5"], g["N6"], g["N7"]; C = g["C"]; fs = 7 if detail else 6
    for r in g["carpets"]: ax.add_patch(Rectangle((r["x"][0], r["z"][0]), r["x"][1] - r["x"][0], r["z"][1] - r["z"][0], fc="#c9a3a8", ec=RED, lw=0.6, zorder=2))
    ax.text(-2.3, 2.5, "F1 赤カーペット\n約 2.7 ㎡", ha="center", va="center", fontsize=fs, color=RED, zorder=7, weight="bold")
    t = g["tile"]; ax.add_patch(Rectangle((t["x"][0], t["z"][0]), t["x"][1] - t["x"][0], t["z"][1] - t["z"][0], fc="#f3ead8", ec=CREAM, lw=0.6, ls=":", zorder=2))
    ax.text((t["x"][0] + t["x"][1]) / 2 + 0.25, (t["z"][0] + t["z"][1]) / 2 - 0.12, "P3 フォトスポット" + ("\n南面タイル, 他 3 面クリーム塗装" if detail else ""), ha="center", va="center", fontsize=fs - 0.5, color=CREAM, zorder=7, weight="bold")
    ax.plot([N5["x0"], N5["x1"]], [N5["z1"] + 0.015] * 2, color=CREAM, lw=2.5, zorder=8); ax.plot([N6["x0"], N6["x1"]], [N6["z1"] + 0.015] * 2, color=CREAM, lw=2.5, zorder=8)
    new_wall(ax, N1["x0"], N1["x1"], N1["z"] - 0.1, N1["z"], "N1", lz=N1["z"] + 0.5)
    new_wall(ax, N2["x0"], N2["x1"], N2["zN"], N2["zS"], "N2 (t 0.10)", lx=N2["x0"] + 0.9, lz=N2["zS"] + 0.17)
    new_wall(ax, N3["x0"], N3["x1"], N3["z0"], N3["z1"], "N3", lx=N3["x0"] - 0.1, ha="right"); new_wall(ax, N4["x0"], N4["x1"], N4["z0"], N4["z1"], "N4", lx=N4["x1"] + 0.1, ha="left")
    new_wall(ax, N5["x0"], N5["x1"], N5["z0"], N5["z1"], "N5", lz=N5["z0"] - 0.14)
    arch_wall(ax, N6["x0"], N6["x1"], N6["z0"], N6["z1"], "N6 アーチ", (N6["x0"] + N6["x1"]) / 2, N6["z0"] - 0.14)
    arch_wall(ax, N7["x0"], N7["x1"], N7["z0"], N7["z1"], "N7\nアーチ", N7["x0"] - 0.08, N7["z1"] - 0.02, ha="right", va="bottom")
    o = g["o1"]; ax.add_patch(Rectangle((W4 - 0.11, o["from"]), 0.12, o["to"] - o["from"], fc="white", ec="none", zorder=6)); ax.plot([W4 - 0.05] * 2, [o["from"], o["to"]], color=RED, lw=1.2, ls=(0, (3, 2)), zorder=7)
    ax.text(W4 + 0.12, (o["from"] + o["to"]) / 2, f"O1 開口 {o['to'] - o['from']:.2f}×H{o['y1']:.2f}" + ("\n＋黒丸棒・遮光カーテン" if detail else ""), fontsize=fs - 0.5, color=RED, va="center", zorder=7, weight="bold")
    d = g["door"]; wd = d["to"] - d["from"]; ax.add_patch(Arc((d["to"], g["W10"]), 2 * wd, 2 * wd, angle=0, theta1=90, theta2=180, color=RED, lw=0.8, zorder=6)); ax.plot([d["to"], d["to"]], [g["W10"], g["W10"] + wd], color=RED, lw=1.0, zorder=6)
    if detail: ax.text(d["from"] - 0.05, g["W10"] + 1.15, "D2 ドア交換\nヒンジ東・内開き", fontsize=fs - 0.5, color=RED, ha="right", va="center", zorder=7, weight="bold")
    r = g["reg"]; ax.add_patch(Rectangle((r["x0"], r["z0"]), r["w"], r["d"], fc="#e8dcc8", ec=INK, lw=0.9, zorder=6)); ax.text(r["cx"], r["cz"], "レジ\n1.10×0.455\nH1.00" if detail else "レジ", ha="center", va="center", fontsize=fs - 0.5, zorder=7)
    if detail:
        ax.annotate("", xy=(r["x1"] + 0.3, r["cz"]), xytext=(r["x1"] + 0.05, r["cz"]), arrowprops=dict(arrowstyle="-|>", color=INK, lw=0.6), zorder=8); ax.text(r["x1"] + 0.33, r["cz"], "客側", fontsize=fs - 0.5, va="center", zorder=8)
        ax.text((W2 + r["x0"]) / 2, r["cz"], "スタッフ", fontsize=fs - 1, ha="center", va="center", color=MUTE, zorder=8, rotation=90)
    demo = m.get("demolition_candidates", {})
    for c in cols:
        if c["num"] in (1, 2, 3) and c["id"] not in demo: fx, fz = c["footprint"]["x"], c["footprint"]["z"]; ax.add_patch(Rectangle((fx[0] - 0.03, fz[0] - 0.03), fx[1] - fx[0] + 0.06, fz[1] - fz[0] + 0.06, fc="none", ec=BLUE, lw=1.0, zorder=7))


def page_plan(pdf, m, walls, cols, g):
    fig = plt.figure(figsize=A3)
    header(fig, "② 計画平面図（E案）— 新設壁・開口・レジ・床仕上げ", "新設壁 N1〜N7（厚 0.10）, 開口 O1, ドア D2, タイル P3, カーペット F1, レジカウンター。家具・小物は図示しない。細部寸法は ③ 拡大図。", 2)
    ax = plan_axes(fig, (-5.3, 4.6), (-6.3, 5.6)); draw_base(ax, m, walls, cols, g, demolish=True); draw_plan_items(ax, m, cols, g, detail=False)
    W2, W1, W9, W11, W10f, W4 = g["W2"], g["W1"], g["W9"], g["W11"], g["W10_face"], g["W4"]; N1, N2, N3, N4, N5, N6, N7 = g["N1"], g["N2"], g["N3"], g["N4"], g["N5"], g["N6"], g["N7"]; C = g["C"]
    dim(ax, (W2, W9), (W2, N2["zN"]), 0.5, f"{N2['zN'] - W9:.2f} (窓壁 W9 → N2 北面)  ✓実測 4.776 − 0.16", color=RED, fs=6.5, side=1)
    dim(ax, (W2, N2["zS"]), (W2, W11), 0.5, f"{W11 - N2['zS']:.2f} (N2 南面 → W11)  ✓実測 2.07", color=RED, fs=6, side=1)
    dim(ax, (N2["x0"], N2["zN"]), (N2["x1"], N2["zN"]), -0.42, f"N2 {N2['x1'] - N2['x0']:.2f} (W2 → N7 東面)  ✓実測 2.16＋0.10", color=RED, fs=6.5)
    dim(ax, (N2["x1"], N2["zN"]), (W1, N2["zN"]), -0.42, f"{W1 - N2['x1']:.2f} (N7 東面 → W1)  ✓実測 4.10", color=MUTE, fs=6)
    c2 = C[2]["footprint"]; dim(ax, (-1.2, c2["z"][1]), (-1.2, N2["zN"]), 0.0, f"{N2['zN'] - c2['z'][1]:.2f} (C2 → N2 通路)", color=MUTE, fs=5.5, side=-1)
    dim(ax, (N3["x1"] + 1.0, N2["zN"]), (N3["x1"] + 1.0, N3["z1"]), 0.0, f"{N3['z1'] - N2['zN']:.2f} (N2 北面 → W15 面)  ✓実測 1.85", color=MUTE, fs=5.5, side=-1)
    dim(ax, (N3["x1"], 0.95), (N4["x0"], 0.95), 0.0, f"{N4['x0'] - N3['x1']:.2f} (N3 ↔ N4 内法)", color=RED, fs=6)
    dim(ax, (N4["x1"], N5["z1"] + 0.5), (W1, N5["z1"] + 0.5), 0.0, f"{W1 - N4['x1']:.2f} (N4 ↔ W1)", color=MUTE, fs=5.5)
    dim(ax, (2.0, N5["z1"]), (2.0, W10f), 0.0, f"{W10f - N5['z1']:.2f}", color=RED, fs=6, side=1)
    ax.text(C[2]["footprint"]["x"][1] + 0.15, C[2]["footprint"]["z"][0] + 0.3, "M1 柱 4 面ミラー\n（帯上〜天井）", fontsize=6, color=BLUE, zorder=7)
    ax.add_patch(Rectangle((-4.2, -1.95), 6.9, 5.35, fc="none", ec=BLUE, lw=0.8, ls=(0, (4, 3)), zorder=9)); ax.text(2.75, -2.0, "③ 拡大図 範囲 1:25", fontsize=6.5, color=BLUE, ha="right", va="bottom", zorder=9)
    x0 = 0.70; fig.text(x0, 0.885, "工事項目（位置は図, 詳細は ③④⑤）", fontsize=11, weight="bold"); y = 0.86
    o = g["o1"]; d = g["door"]; wd = d["to"] - d["from"]
    items = [("N1", f"キッチン入口 塞ぎ壁 {N1['x1'] - N1['x0']:.2f} × H{g['ceil']:.2f}, t0.10 — 現入口の垂れ壁下, 両面ホール仕上げ"),
             ("N2", f"レジ背面壁 {N2['x1'] - N2['x0']:.2f} × H{g['ceil']:.2f}, t0.10 — 窓壁から北面まで {N2['zN'] - W9:.2f}（11/17: N7 を 0.86 にするため実測 4.776 より 0.16 北へ）, W2 から N7 東面まで。南面クリムゾン塗装 #8A1F2B, 北面ホール仕上げ"),
             ("N3・N4", f"写真コーナー袖壁 N3 {N3['z1'] - N3['z0']:.2f}・N4 {N4['z1'] - N4['z0']:.2f} × H{g['ceil']:.2f}, t0.10 — N3 は W5, N4 は W4 の延長線上。W15／N1 面からホール側へ。両面ホール仕上げ（N3 は N7 を 0.86 にするため 0.11 短縮）"),
             ("N5", f"トイレ前 目隠し壁 {N5['x1'] - N5['x0']:.2f} × H{g['ceil']:.2f}, t0.10 — W10 面から 0.80 平行, 東端 W1 突付け。南面(フォトスポット側)タイル"),
             ("N6", f"洗面室入口アーチ 有効 {N6['x1'] - N6['x0']:.2f}, スプリング {N6['spring']:.2f}, 頂部 {N6['spring'] + (N6['x1'] - N6['x0']) / 2:.2f} — N4〜N5 間, 上部スパンドレルのみ壁, 金色モール両面"),
             ("N7", f"ホール入口アーチ 有効 {N7['z1'] - N7['z0']:.2f}, スプリング {N7['spring']:.2f}, 頂部 {N7['spring'] + (N7['z1'] - N7['z0']) / 2:.2f} — N2 南面〜N3 北端, 上部スパンドレルのみ壁, 金色モール両面"),
             ("O1", f"W4 に開口 {o['to'] - o['from']:.2f} × H{o['y1']:.2f}（スタッフ通路）＋黒丸棒・遮光カーテン"),
             ("D2", f"トイレドア交換 W{wd:.3f} × H{d['y1']:.2f} — ヒンジ東(W1 側)・洗面室側への内開き, ウォールナット 2 段パネル戸＋サテンニッケルレバー, ドアクローザー"),
             ("P3", "トイレ前フォトスポット — N5 南面＋N6 南面(アーチ除く) リーフモザイクタイル(ベージュ, 約 3.1 ㎡)。W10 北面・W1・W4 面は無地クリーム塗装＋チェアレール H0.92・幅木 H0.10"),
             ("F1", "赤カーペット 約 2.7 ㎡（玄関通路 1.09×1.06 ＋ レジ前 1.14×1.10）, 既存床の上"),
             ("M1", "柱 C2（C1・C3 撤去しない場合は 3 本）帯上〜天井 4 面ミラー, 飛散防止フィルム"),
             ("D", "C1・C3 撤去計画 — 構造柱かどうか確認後に決定"),
             ("レジ", "レジカウンター 1.10×0.455×H1.00 ＋ 折りたたみ補助天板 0.45（北端）— W2 と平行に縦置き, 客側面は W2 から 1.05, 南端 W11 付け, N2 との間 0.99"),
             ("S", "N2 南面: 船場美術館 縦書き金色切文字 H1.1（通路正面中央）＋丸鏡 φ0.55 — サイン業者, 別途")]
    for k, t in items: fig.text(x0, y, k, fontsize=7.5, weight="bold", color=RED); fig.text(x0 + 0.034, y, t, fontsize=6.6, va="top", wrap=True); y -= 0.0305
    y = legend(fig, x0, y - 0.005, [(dict(fc="white", ec=RED, hatch="////"), "新設壁 N（t 0.10）"), (dict(fc="#fff6dd", ec=GOLD, ls="--"), "アーチ（上部のみ壁）"), (dict(fc="#c9a3a8", ec=RED), "赤カーペット F1"), (dict(fc="#f3ead8", ec=CREAM, ls=":"), "フォトスポット P3（タイル面は太線）"), (dict(fc="#e8dcc8", ec=INK), "レジカウンター（搬入）")], "凡例")
    fig.text(x0, y - 0.005, f"※ 寸法は全て内法 m。N2 は 11/17 に N7 アーチを 0.86 にするため実測線より 0.11 北へ — 現場では N7 有効 0.86（N2 南面 〜 N3 北端）を優先し, 窓壁から約 {N2['zN'] - W9:.2f} で墨出し。", fontsize=7, color=MUTE, va="top", wrap=True)
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ③ 部分拡大図 1:25
def page_zoom(pdf, m, walls, cols, g):
    fig = plt.figure(figsize=A3)
    header(fig, "③ 部分拡大図 1:25 — レセプション・写真コーナー・トイレ前・レジ", "②の点線範囲。壁と壁の距離（内法）, 新設壁の長さ・位置, レジ位置, 開口寸法。単位 m。", 3)
    ax = plan_axes(fig, (-4.2, 2.7), (-1.95, 3.4), left_mm=20, top_mm=36, scale=25); draw_base(ax, m, walls, cols, g, demolish=True); draw_plan_items(ax, m, cols, g, detail=True)
    for tx in ax.texts: tx.set_clip_on(True)
    W2, W1, W9, W11, W10f, W4, W5, W3 = g["W2"], g["W1"], g["W9"], g["W11"], g["W10_face"], g["W4"], g["W5"], g["W3"]
    N1, N2, N3, N4, N5, N6, N7 = g["N1"], g["N2"], g["N3"], g["N4"], g["N5"], g["N6"], g["N7"]; C = g["C"]; r = g["reg"]; d = g["door"]; o = g["o1"]; wd = d["to"] - d["from"]; t = g["tile"]
    F = 6.5
    # N2 とレセプション
    dim(ax, (N2["x0"], N2["zN"]), (N2["x1"], N2["zN"]), -0.3, f"N2 {N2['x1'] - N2['x0']:.2f}（W2 → N7 東面）", color=RED, fs=F)
    dim(ax, (W2, N2["zN"]), (W2, N2["zS"]), -0.25, "0.10", color=RED, fs=5.5, side=-1, tick=0.03)
    dim(ax, (W2, N2["zS"]), (W2, W11), 0.42, f"{W11 - N2['zS']:.2f}（N2 南面 → W11）✓実測 2.07", color=RED, fs=F, side=-1)
    dim(ax, (W2, W11 + 0.3), (W3, W11 + 0.3), 0.0, f"{W3 - W2:.2f}（W2 → W3 面）✓実測 1.05", color=MUTE, fs=5.5)
    dim(ax, (W2, -0.7), (N7["x0"], -0.7), 0.0, f"{N7['x0'] - W2:.2f}（W2 → N7 西面）✓実測 2.16", color=MUTE, fs=5.5)
    dim(ax, (N2["x1"], N2["zN"] - 0.7), (N4["x0"], N2["zN"] - 0.7), 0.0, f"{N4['x0'] - N2['x1']:.2f}（N7 東面 → N4 西面）", color=MUTE, fs=5.5)
    # N7 アーチ・N3・写真コーナー
    dim(ax, (N7["x1"], N7["z0"]), (N7["x1"], N7["z1"]), 0.35, f"N7 有効 {N7['z1'] - N7['z0']:.2f}", color=GOLD, fs=F, side=-1)
    dim(ax, (N3["x1"], N3["z0"]), (N3["x1"], N3["z1"]), 0.35, f"N3 {N3['z1'] - N3['z0']:.2f}", color=RED, fs=F, side=-1)
    dim(ax, (N3["x1"], N2["zN"]), (N3["x1"], N3["z1"]), 0.75, f"{N3['z1'] - N2['zN']:.2f}（N2 北面 → W15 面）✓実測 1.85", color=MUTE, fs=5.5, side=-1)
    dim(ax, (N3["x1"], 1.0), (N4["x0"], 1.0), 0.0, f"{N4['x0'] - N3['x1']:.2f}（N3 ↔ N4 内法）✓実測 2.03 壁心", color=RED, fs=F)
    dim(ax, (N4["x0"], N4["z0"]), (N4["x0"], N4["z1"]), 0.35, f"N4 {N4['z1'] - N4['z0']:.2f}", color=RED, fs=F, side=1)
    dim(ax, (N3["x0"], N3["z0"]), (N3["x1"], N3["z0"]), -0.2, "0.10", color=RED, fs=5.5, tick=0.03); dim(ax, (N4["x0"], N4["z0"]), (N4["x1"], N4["z0"]), -0.2, "0.10", color=RED, fs=5.5, tick=0.03)
    ax.text(N3["x0"] - 0.08, N3["z1"] - 0.02, "N3 = W5 の延長線上", fontsize=5.5, color=MUTE, ha="right", va="bottom"); ax.text(N4["x1"] + 0.08, N4["z1"] - 0.02, "N4 = W4 の延長線上", fontsize=5.5, color=MUTE, ha="left", va="bottom")
    c2 = C[2]["footprint"]; zz = c2["z"][1] + 0.25
    dim(ax, (N3["x1"], zz), (c2["x"][0], zz), 0.0, f"{c2['x'][0] - N3['x1']:.2f}（N3 ↔ C2）", color=MUTE, fs=5.5); dim(ax, (c2["x"][1], zz), (N4["x0"], zz), 0.0, f"{N4['x0'] - c2['x'][1]:.2f}（C2 ↔ N4）", color=MUTE, fs=5.5)
    dim(ax, (c2["x"][1] + 0.1, c2["z"][1]), (c2["x"][1] + 0.1, N4["z0"]), 0.0, f"{N4['z0'] - c2['z'][1]:.2f}（C2 → N4 北端）", color=MUTE, fs=5.5, side=-1)
    dim(ax, (N1["x0"], N1["z"]), (N1["x1"], N1["z"]), 0.3, f"N1 {N1['x1'] - N1['x0']:.2f}", color=RED, fs=F)
    # トイレ前
    dim(ax, (N5["x0"], N5["z0"]), (N5["x1"], N5["z0"]), -0.3, f"N5 {N5['x1'] - N5['x0']:.2f}（東端 W1 突付け）", color=RED, fs=F)
    dim(ax, (N6["x0"], N6["z0"]), (N6["x1"], N6["z0"]), -0.3, f"N6 有効 {N6['x1'] - N6['x0']:.2f}", color=GOLD, fs=F)
    dim(ax, (N5["x1"] - 0.05, N5["z0"]), (N5["x1"] - 0.05, N5["z1"]), 0.0, "0.10", color=RED, fs=5.5, side=-1, tick=0.03)
    dim(ax, (2.15, N5["z1"]), (2.15, W10f), 0.0, f"{W10f - N5['z1']:.2f}（N5 南面 ↔ W10 面）✓実測 0.80", color=RED, fs=F, side=-1)
    dim(ax, (N4["x1"], t["z"][1] - 0.1), (W1, t["z"][1] - 0.1), 0.0, f"{W1 - N4['x1']:.2f}（N4 東面 ↔ W1）", color=MUTE, fs=5.5)
    dim(ax, (N4["x1"], W10f + 0.0), (d["from"], W10f), 0.28, f"{d['from'] - N4['x1']:.2f}", color=MUTE, fs=5.5); dim(ax, (d["from"], W10f), (d["to"], W10f), 0.28, f"D2 {wd:.3f}", color=RED, fs=5.5); dim(ax, (d["to"], W10f), (W1, W10f), 0.28, f"{W1 - d['to']:.2f} ✓0.42", color=MUTE, fs=5.5)
    # O1
    dim(ax, (W4 + 0.6, N1["z"]), (W4 + 0.6, o["from"]), 0.0, f"{o['from'] - N1['z']:.2f}", color=MUTE, fs=5.5, side=-1); dim(ax, (W4 + 0.6, o["from"]), (W4 + 0.6, o["to"]), 0.0, f"O1 {o['to'] - o['from']:.2f}", color=RED, fs=5.5, side=-1)
    # レジ
    dim(ax, (W2, r["z0"] - 0.15), (r["x0"], r["z0"] - 0.15), 0.0, f"{r['x0'] - W2:.2f}", color=INK, fs=5.5); dim(ax, (r["x0"], r["z0"] - 0.15), (r["x1"], r["z0"] - 0.15), 0.0, f"{r['w']:.3f}", color=INK, fs=5.5)
    dim(ax, (W2, r["z0"] - 0.4), (r["x1"], r["z0"] - 0.4), 0.0, f"{r['x1'] - W2:.2f}（W2 → レジ客側面）✓実測 1.05", color=INK, fs=5.5)
    dim(ax, (r["x1"] + 0.15, N2["zS"]), (r["x1"] + 0.15, r["z0"]), 0.0, f"{r['z0'] - N2['zS']:.2f}（N2 南面 → レジ北端）", color=INK, fs=5.5, side=-1)
    dim(ax, (r["x1"] + 0.15, r["z0"]), (r["x1"] + 0.15, r["z1"]), 0.0, f"レジ {r['d']:.2f}", color=INK, fs=5.5, side=-1)
    dim(ax, (r["x1"], N2["zS"] + 0.35), (N7["x0"], N2["zS"] + 0.35), 0.0, f"{N7['x0'] - r['x1']:.2f}（レジ ↔ N7 西面）", color=MUTE, fs=5.5)
    ax.text(r["cx"], r["z1"] + 0.06, "南端を W11 に付ける", fontsize=5.5, color=MUTE, ha="center", va="top")
    # カーペット
    cp = g["carpets"]; a = cp[1]; b = cp[0]
    dim(ax, (a["x"][0], a["z"][1] - 0.12), (a["x"][1], a["z"][1] - 0.12), 0.0, f"F1 {a['x'][1] - a['x'][0]:.2f}", color=RED, fs=5.5); dim(ax, (a["x"][1] - 0.12, a["z"][0]), (a["x"][1] - 0.12, a["z"][1]), 0.0, f"{a['z'][1] - a['z'][0]:.2f}", color=RED, fs=5.5, side=-1)
    dim(ax, (b["x"][1] - 0.12, b["z"][0]), (b["x"][1] - 0.12, b["z"][1]), 0.0, f"{b['z'][1] - b['z'][0]:.2f}", color=RED, fs=5.5, side=-1); dim(ax, (b["x"][0], b["z"][1] - 0.12), (b["x"][1], b["z"][1] - 0.12), 0.0, f"{b['x'][1] - b['x'][0]:.2f}", color=RED, fs=5.5)
    # 下: 凡例・注記
    legend(fig, 0.74, 0.30, [(dict(fc="white", ec=RED, hatch="////"), "新設壁 N（t 0.10）"), (dict(fc="#fff6dd", ec=GOLD, ls="--"), "アーチ（上部のみ壁）"), (dict(fc="#c9a3a8", ec=RED), "赤カーペット F1"), (dict(fc="#f3ead8", ec=CREAM, ls=":"), "フォトスポット P3"), (dict(fc="#e8dcc8", ec=INK), "レジカウンター")], "凡例")
    for i, tx in enumerate(["• 赤字 = 新設, 金 = アーチ, 黒 = レジ, 灰 = 参考距離", f"• N2 の墨出しは窓壁 W9 から約 {N2['zN'] - W9:.2f}（北面）。N7 有効 0.86 を優先。", "• N3・N4 は既存壁 W5・W4 の面を延長して墨出し。", "• N5 は W10 面から 0.80 を基準, 東端を W1 に突付け。", "• N7 は 11/17 に 0.86 へ拡幅（N2 北へ 0.11, N3 を 0.11 短縮）。"]):
        fig.text(0.74, 0.17 - i * 0.02, tx, fontsize=7.5, color=MUTE)
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ④ 新設壁・開口 詳細
def page_detail(pdf, m, g):
    fig = plt.figure(figsize=A3)
    header(fig, "④ 新設壁・開口部 詳細（立面・一覧）", "立面は壁面側から見た図, 単位 mm。天井高 ✓2393。新設壁は LGS または木下地＋石膏ボード 12.5 両面, 天井まで。", 4)
    H = g["ceil"] * 1000
    def elev(rect, w_mm, title, note=""):
        ax = fig.add_axes(rect); ax.set_xlim(-250, w_mm + 250); ax.set_ylim(-200, H + 420); ax.set_aspect("equal"); ax.axis("off")
        ax.add_patch(Rectangle((-250, -200), w_mm + 500, 200, fc="#c9a97a", ec=INK, lw=0.5)); ax.add_patch(Rectangle((-250, H), w_mm + 500, 60, fc="#eee", ec=INK, lw=0.5))
        ax.text(w_mm / 2, H + 300, title, ha="center", fontsize=9, weight="bold"); ax.text(w_mm / 2, H + 150, note, ha="center", fontsize=6.5, color=MUTE); return ax
    def vdim(ax, x, y0, y1, label, c=RED, ha="right"):
        ax.annotate("", xy=(x, y0), xytext=(x, y1), arrowprops=dict(arrowstyle="<->", color=c, lw=0.8)); ax.text(x - 30 if ha == "right" else x + 30, (y0 + y1) / 2, label, color=c, fontsize=7, va="center", ha=ha)
    def hdim(ax, x0, x1, y, label, c=RED):
        ax.annotate("", xy=(x0, y), xytext=(x1, y), arrowprops=dict(arrowstyle="<->", color=c, lw=0.8)); ax.text((x0 + x1) / 2, y + 40, label, color=c, fontsize=7, ha="center")
    def arch_elev(rect, W, spring, title, note):
        w_mm = W * 1000; r = w_mm / 2; sp = spring * 1000; ax = elev(rect, w_mm, title, note)
        ax.add_patch(Rectangle((0, 0), w_mm, H, fc="#e3e8e3", ec=INK, lw=0.6))
        verts = [(0, 0), (0, sp)] + [(r + r * math.cos(a), sp + r * math.sin(a)) for a in [math.pi - i * math.pi / 36 for i in range(37)]] + [(w_mm, 0)]
        ax.add_patch(Polygon(verts, closed=True, fc="white", ec=INK, lw=0.8, zorder=3))
        ax.add_patch(Arc((r, sp), 2 * r + 70, 2 * r + 70, theta1=0, theta2=180, color=GOLD, lw=3, zorder=4))
        hdim(ax, 0, w_mm, -120, f"有効 {round(w_mm / 5) * 5:.0f}"); vdim(ax, -90, 0, sp, f"スプリング {sp:.0f}"); vdim(ax, w_mm + 90, 0, sp + r, f"頂部 {sp + r:.0f}", ha="left"); vdim(ax, w_mm + 200, 0, H, f"天井 {H:.0f}", c=INK, ha="left")
        ax.text(r, sp + r + 110, f"半円 R{r:.0f}", ha="center", fontsize=7, color=GOLD); ax.text(r, (H + sp + r) / 2 + 60, "スパンドレル\n(壁 t100)", ha="center", fontsize=6.5)
        ax.text(r, -290, "金色モール φ60 両面＋開口内側に細モール", ha="center", fontsize=6, color=GOLD); return ax
    N6, N7, N5, o, d, t = g["N6"], g["N7"], g["N5"], g["o1"], g["door"], g["tile"]
    arch_elev([0.03, 0.50, 0.22, 0.40], N7["z1"] - N7["z0"], N7["spring"], "N7 ホール入口アーチ（レセプション側から）", "N2 南面 〜 N3 北端。有効 0.86 = N6 と同じ（11/17 拡幅）")
    arch_elev([0.27, 0.50, 0.24, 0.40], N6["x1"] - N6["x0"], N6["spring"], "N6 洗面室入口アーチ（ホール側から）", "N4 東面 〜 N5 西端。フォトスポット側はタイル仕上げ")
    # N5 + ミラー（フォトスポット側立面）
    w5 = (N5["x1"] - N5["x0"]) * 1000; ax = elev([0.53, 0.50, 0.22, 0.40], w5, "N5 目隠し壁 南面（フォトスポット側）", "全面リーフモザイクタイル, 中央に金縁楕円ミラー 640×920（下端 FL+950）")
    ax.add_patch(Rectangle((0, 0), w5, H, fc="#f1e6d2", ec=INK, lw=0.6));
    for yy in range(0, int(H), 200): ax.plot([0, w5], [yy, yy], color="#d8c9ad", lw=0.3)
    for xx in range(0, int(w5), 200): ax.plot([xx, xx], [0, H], color="#d8c9ad", lw=0.3)
    mx = (1.79 - N5["x0"]) * 1000; from matplotlib.patches import Ellipse; ax.add_patch(Ellipse((w5 - mx, 950 + 460), 640, 920, fc="#cfd3d6", ec=GOLD, lw=3, zorder=4))
    hdim(ax, 0, w5, -120, f"{w5:.0f}"); vdim(ax, -90, 0, 950, "950"); vdim(ax, w5 + 90, 0, H, f"{H:.0f}", c=INK, ha="left"); hdim(ax, w5 - mx - 320, w5 - mx + 320, H + 20, "640", c=GOLD)
    ax.text(w5 - mx, 950 + 460, "ミラー\n640×920", ha="center", va="center", fontsize=6.5, color=INK, zorder=5)
    # D2 ドア + クリーム壁（W10 北面, フォトスポット側）
    wv = (t["x"][1] - t["x"][0]) * 1000; ax = elev([0.77, 0.50, 0.21, 0.40], wv, "W10 北面（フォトスポット側）D2 ドア", "無地クリーム塗装, チェアレール H920 (45×18), 幅木 H100, ウォールナット 2 段パネル戸")
    ax.add_patch(Rectangle((0, 0), wv, H, fc="#efe6d4", ec=INK, lw=0.6)); ax.add_patch(Rectangle((0, 920), wv, 45, fc="#f6efe2", ec=INK, lw=0.4)); ax.add_patch(Rectangle((0, 0), wv, 100, fc="#f6efe2", ec=INK, lw=0.4))
    dx0 = (t["x"][1] - d["to"]) * 1000; dw = (d["to"] - d["from"]) * 1000   # 北面から見ると東が左
    ax.add_patch(Rectangle((dx0, 0), dw, d["y1"] * 1000, fc="#5a2d1f", ec=INK, lw=0.8, zorder=4))
    for y0, y1 in [(180, 780), (950, d["y1"] * 1000 - 100)]: ax.add_patch(Rectangle((dx0 + 100, y0), dw - 200, y1 - y0, fc="#663626", ec="#2a1510", lw=0.8, zorder=5))
    ax.add_patch(Circle((dx0 + dw - 90, 980), 18, fc="#c8c8c8", ec=INK, lw=0.4, zorder=6)); ax.plot([dx0 + dw - 90, dx0 + dw - 90 - 110], [980, 980], color="#c8c8c8", lw=3, zorder=6)
    hdim(ax, dx0, dx0 + dw, -120, f"D2 {dw:.0f}"); hdim(ax, 0, dx0, -120, f"{dx0:.0f}（W1 まで）"); vdim(ax, wv + 90, 0, d["y1"] * 1000, f"{d['y1'] * 1000:.0f}", ha="left"); vdim(ax, -90, 0, 920, "920")
    ax.text(dx0 + dw / 2, d["y1"] * 1000 + 120, "ヒンジ東側・洗面室側へ内開き 80°", ha="center", fontsize=6, color=RED)
    # O1 開口
    wo = 1.4 * 1000; ax = elev([0.03, 0.06, 0.18, 0.40], wo, "O1 W4 開口（ホール側から）", "W4 北端〜N1 の間, 上に黒丸棒 φ25・遮光カーテン(濃グレー)")
    ax.add_patch(Rectangle((0, 0), wo, H, fc="#e3e8e3", ec=INK, lw=0.6)); ox0 = (o["from"] - 1.761) * 1000 + 0; ow = (o["to"] - o["from"]) * 1000
    ax.add_patch(Rectangle((ox0, 0), ow, o["y1"] * 1000, fc="white", ec=INK, lw=0.8, zorder=4)); ax.plot([ox0 - 80, ox0 + ow + 80], [o["y1"] * 1000 + 60] * 2, color=INK, lw=3, zorder=5)
    for k in range(7): ax.plot([ox0 + 20 + k * ow / 7] * 2, [60, o["y1"] * 1000 + 40], color="#777", lw=1.2, zorder=5)
    hdim(ax, ox0, ox0 + ow, -120, f"{ow:.0f}"); hdim(ax, 0, ox0, -120, f"{ox0:.0f}（N1 から）"); vdim(ax, wo + 90, 0, o["y1"] * 1000, f"{o['y1'] * 1000:.0f}", ha="left")
    # 一覧表
    x0, y = 0.25, 0.44; fig.text(x0, y, "新設壁・開口 一覧（座標は 3D ビューア基準: x 東＋, z 南＋, 窓壁 W9 の面 z = −4.804, W2 の面 x = −3.954）", fontsize=9.5, weight="bold"); y -= 0.028
    heads = ["記号", "内容", "長さ×高さ", "位置（既存壁からの距離）", "x 範囲 / z 範囲 [m]"]; cx = [x0, x0 + 0.04, x0 + 0.17, x0 + 0.265, x0 + 0.585]
    for x, h in zip(cx, heads): fig.text(x, y, h, fontsize=8, weight="bold")
    fig.add_artist(plt.Line2D([x0, 0.97], [y - 0.006, y - 0.006], color=INK, lw=0.7)); y -= 0.024
    N1, N2, N3, N4, r = g["N1"], g["N2"], g["N3"], g["N4"], g["reg"]; W2, W1, W9, W11, W10f, W4 = g["W2"], g["W1"], g["W9"], g["W11"], g["W10_face"], g["W4"]
    rows = [("N1", "キッチン入口 塞ぎ壁", f"{N1['x1'] - N1['x0']:.2f} × {g['ceil']:.2f}", "W7 側 〜 W4 面, 現入口の垂れ壁直下（W15 と同じ面）", f"x {N1['x0']:.2f}〜{N1['x1']:.2f} / z {N1['z'] - 0.1:.2f}〜{N1['z']:.2f}"),
            ("N2", "レジ背面壁", f"{N2['x1'] - N2['x0']:.2f} × {g['ceil']:.2f}", f"北面 = 窓壁 W9 から {N2['zN'] - W9:.2f}（実測線 4.776 より 0.16 北）, 南面 = W11 から {W11 - N2['zS']:.2f}（実測 2.07）, 西端 W2 付け", f"x {N2['x0']:.2f}〜{N2['x1']:.2f} / z {N2['zN']:.2f}〜{N2['zS']:.2f}"),
            ("N3", "写真コーナー 西袖壁", f"{N3['z1'] - N3['z0']:.2f} × {g['ceil']:.2f}", f"W5 の延長線上（西面 x = W5 面）, W15 面から北へ {N3['z1'] - N3['z0']:.2f}", f"x {N3['x0']:.2f}〜{N3['x1']:.2f} / z {N3['z0']:.2f}〜{N3['z1']:.2f}"),
            ("N4", "写真コーナー 東袖壁", f"{N4['z1'] - N4['z0']:.2f} × {g['ceil']:.2f}", f"W4 の延長線上（西面 x = W4 面）, N1 面から北へ {N4['z1'] - N4['z0']:.2f}。N3 との内法 {N4['x0'] - N3['x1']:.2f}", f"x {N4['x0']:.2f}〜{N4['x1']:.2f} / z {N4['z0']:.2f}〜{N4['z1']:.2f}"),
            ("N5", "トイレ前 目隠し壁", f"{g['N5']['x1'] - g['N5']['x0']:.2f} × {g['ceil']:.2f}", f"南面 = W10 面から {W10f - g['N5']['z1']:.2f}（実測 0.80）, 東端 W1 付け, 西端 = N6 アーチ東端", f"x {g['N5']['x0']:.2f}〜{g['N5']['x1']:.2f} / z {g['N5']['z0']:.2f}〜{g['N5']['z1']:.2f}"),
            ("N6", "洗面室入口アーチ", f"有効 {g['N6']['x1'] - g['N6']['x0']:.2f}, 頂部 {g['N6']['spring'] + (g['N6']['x1'] - g['N6']['x0']) / 2:.2f}", f"N4 東面 〜 N5 西端, N5 と同一線上（南面 W10 から {W10f - g['N6']['z1']:.2f}）", f"x {g['N6']['x0']:.2f}〜{g['N6']['x1']:.2f} / z {g['N6']['z0']:.2f}〜{g['N6']['z1']:.2f}"),
            ("N7", "ホール入口アーチ", f"有効 {g['N7']['z1'] - g['N7']['z0']:.2f}, 頂部 {g['N7']['spring'] + (g['N7']['z1'] - g['N7']['z0']) / 2:.2f}", "N2 南面 〜 N3 北端, N3 と同一線上（W5 延長）", f"x {g['N7']['x0']:.2f}〜{g['N7']['x1']:.2f} / z {g['N7']['z0']:.2f}〜{g['N7']['z1']:.2f}"),
            ("O1", "W4 開口＋カーテン", f"{g['o1']['to'] - g['o1']['from']:.2f} × {g['o1']['y1']:.2f}", f"W4 の N1 面から南へ {g['o1']['from'] - N1['z']:.2f} 〜 {g['o1']['to'] - N1['z']:.2f}", f"x = W4 ({W4:.2f}) / z {g['o1']['from']:.2f}〜{g['o1']['to']:.2f}"),
            ("D2", "トイレドア交換", f"{g['door']['to'] - g['door']['from']:.3f} × {g['door']['y1']:.2f}", f"W10 既存開口, 東枠は W1 から {W1 - g['door']['to']:.2f}（実測 0.42）, ヒンジ東・内開き", f"x {g['door']['from']:.3f}〜{g['door']['to']:.3f} / z = W10"),
            ("レジ", "レジカウンター 1.10×0.455×H1.00", "搬入", f"W2 と平行に縦置き。西面 W2 から {r['x0'] - W2:.2f}（スタッフ側）, 客側(東)面 {r['x1'] - W2:.2f},\n南端 W11 付け, 北端は N2 南面から {r['z0'] - N2['zS']:.2f}", f"x {r['x0']:.3f}〜{r['x1']:.3f} / z {r['z0']:.2f}〜{r['z1']:.2f}"),
            ("F1", "赤カーペット", "約 2.7 ㎡", "レジ客側面 〜 N7/W5 線, N2 南面から 0.88 以南 〜 自動ドア内側 3.06", "x −2.90〜−1.76 / z 0.90〜3.06（通路部 x −2.85〜）"),
            ("P3", "フォトスポット タイル", "約 3.1 ㎡", "N5 南面 全面 ＋ N6 南面（アーチ除く）。他 3 面は無地クリーム塗装", f"区画 x {t['x'][0]:.2f}〜{t['x'][1]:.2f} / z {t['z'][0]:.2f}〜{t['z'][1]:.2f}")]
    for rr in rows:
        for x, tx in zip(cx, rr): fig.text(x, y, tx, fontsize=6.6, va="top")
        y -= 0.029 + (0.012 if any("\n" in c for c in rr) else 0); fig.add_artist(plt.Line2D([x0, 0.97], [y + 0.007, y + 0.007], color="#ddd", lw=0.5))
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ④ 壁仕上げ断面
def page_finish(pdf, m):
    fig = plt.figure(figsize=A3)
    header(fig, "⑤ 壁仕上げ断面（ホール共通）", "大部屋の壁 W1・W2・W9・W10・W15・N1〜N5 ホール面・柱に共通。単位 mm。高さ A は現場実測後に確定。", 5)
    ax = fig.add_axes([0.05, 0.08, 0.38, 0.80]); ax.axis("off"); ax.set_xlim(-520, 420); ax.set_ylim(-80, 2500); ax.set_aspect("auto")
    ax.add_patch(Rectangle((-60, 0), 60, 2393, fc="#ddd", ec=INK)); ax.text(-30, 2440, "既存壁（クロス）", ha="center", fontsize=8)
    ax.add_patch(Rectangle((-120, -60), 520, 60, fc="#c9a97a", ec=INK)); ax.text(300, -35, "床 — 既存フローリングのまま", fontsize=8)
    ax.add_patch(Rectangle((0, 0), 6, 112, fc="#6b4a2e", ec=INK)); ax.add_patch(Rectangle((0, 816), 10, 74, fc="#111", ec=INK))
    ax.add_patch(Rectangle((10, 3), 7, 887, fc="#a8774d", ec=INK)); ax.add_patch(Rectangle((0, 890), 25, 12, fc="#7a5333", ec=INK))
    ax.add_patch(Rectangle((0, 902), 2, 2393 - 902, fc="#39433a", ec="none"))
    ax.add_patch(Rectangle((-60, 2393), 520, 40, fc="#eee", ec=INK)); ax.text(200, 2460, "天井 — 既存のまま", fontsize=8)
    def d(x, y0, y1, label, c=RED):
        ax.annotate("", xy=(x, y0), xytext=(x, y1), arrowprops=dict(arrowstyle="<->", color=c, lw=0.9)); ax.text(x - 10, (y0 + y1) / 2, label, color=c, fontsize=8.5, va="center", ha="right")
    d(-180, 0, 890, "A ≈ 890（ス）\n→ 実測で確定\nパネル 900 以下"); d(-330, 0, 2393, "✓ 天井高 2393"); d(-110, 816, 890, "✓ 帯 74"); d(-110, 0, 112, "✓ 幅木 112")
    ax.annotate("", xy=(0, 780), xytext=(10, 780), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(40, 780, "✓ 帯の出 10", color=RED, fontsize=8.5, va="center")
    ax.annotate("", xy=(0, 140), xytext=(6, 140), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(40, 140, "✓ 幅木の出 4〜7 → パネル下にスペーサー 3〜6", color=RED, fontsize=8.5, va="center")
    for y, tx in [(1700, "① 上部壁: 既存クロスの上に水性塗装 2〜3 回\n   ダルグリーン（#39433A）— 密着プライマー要"), (902 + 30, "③ 見切り材 25×12 — パネル上端と壁の隙間を覆う"),
                  (450, "② 下部: エアサーモパネル lite D タイプ 7×313(有効 304)×900\n   床〜黒い帯の上端まで縦貼り。帯・幅木は撤去せずパネル裏に残す"), (60, "④ 床との隙間 2〜3: 見切り材またはコーキング")]:
        ax.text(60, y, tx, fontsize=8.5, va="center")
    x0 = 0.48; fig.text(x0, 0.885, "仕上げ仕様", fontsize=11, weight="bold")
    spec = [("上部壁（帯上〜天井）", "水性塗装 ダルグリーン #39433A。ビニールクロス用密着プライマー＋2〜3 回。面積 約 45〜50 ㎡（窓除く）"),
            ("下部壁（床〜帯上端）", "エアサーモパネル lite D（RESTA）7×313×900, 有効幅 304 — 約 140 枚（予備含む）。両面テープ／接着は原状回復条件を確認"),
            ("パネル上端・側端", "lite 用見切り材 25×12×1200 — 上端 約 39 m（33 本）＋側端（柱角・窓際）約 17 本 → 約 50 本"),
            ("黒い帯・幅木", "撤去なし。パネル裏に隠す"),
            ("柱 C2（C1・C3 残す場合も）", "帯上（≈0.89）〜天井 4 面ミラー, 角は突付け, 飛散防止フィルム。下部はパネル"),
            ("新設壁 N1〜N5", "LGS または木下地＋PB 12.5 両面, 天井まで。N2 南面はクリムゾン #8A1F2B 艶消し塗装（帯・幅木なし）。その他ホール面は共通仕上げ（ダルグリーン＋パネル）"),
            ("アーチ N6・N7", "上部スパンドレルのみ壁（t100）。半円 R = 有効幅/2, スプリング 1.62。金色モール φ60 を両面に, 開口内側に細モール"),
            ("フォトスポット P3", "N5 南面・N6 南面: リーフモザイクタイル（ベージュ, シート 200 角相当）約 3.1 ㎡。W10 北面・W1・W4 面: 無地クリーム塗装, チェアレール 45×18 を H920 に, 幅木 H100（同色）"),
            ("O1 開口", "W4 端 0.53×1.98 開口, 補強, 上部に黒丸棒＋遮光カーテン（濃グレー）"),
            ("床", "既存フローリング維持。F1 区間のみ赤カーペット（タイルカーペット 50 cm 約 18 枚またはロール）"),
            ("天井・照明", "既存維持。ダクトレールにスポット 3 灯追加（電球色 2700〜3000K, 24〜36°）"),
            ("ドア・設備", "D2 トイレドアのみ交換。洗面台・シンクは既存維持。パネルにかかるコンセントは切欠き（ボックス移設は電気工事士）")]
    y = 0.86
    for a, b in spec:
        fig.text(x0, y, a, fontsize=8.5, weight="bold", va="top"); fig.text(x0 + 0.13, y, b, fontsize=7.6, va="top", wrap=True)
        y -= 0.044 if len(b) > 60 else 0.034; fig.add_artist(plt.Line2D([x0, 0.97], [y + 0.008, y + 0.008], color="#ddd", lw=0.6))
    fig.text(x0, y - 0.01, "色見本: ダルグリーンは試し塗り後に最終決定。パネル色はサンプル確認後に指定。", fontsize=7.5, color=MUTE, va="top", wrap=True)
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ⑤ 工事項目
def page_scope(pdf, m, g):
    fig = plt.figure(figsize=A3)
    header(fig, "⑥ 工事範囲・見積依頼項目", "項目別に見積をお願いします。DIY 予定の項目は材料のみ／除外可。数量は 3D・実測による概算 — 現場実測後に確定。", 6)
    cols_x = [0.035, 0.065, 0.27, 0.60, 0.72, 0.84]; heads = ["No", "項目", "仕様", "数量（概算）", "施工", "備考"]; y = 0.885
    for x, h in zip(cols_x, heads): fig.text(x, y, h, fontsize=9.5, weight="bold")
    fig.add_artist(plt.Line2D([0.035, 0.97], [y - 0.008, y - 0.008], color=INK, lw=0.8)); y -= 0.03
    N7w = g["N7"]["z1"] - g["N7"]["z0"]; N6w = g["N6"]["x1"] - g["N6"]["x0"]
    rows = [("1", "N1 キッチン入口 塞ぎ壁", "1.12 × H2.39, t0.10, 両面 PB, ホール仕上げ", "1 箇所", "業者", "現入口の垂れ壁下"),
            ("2", "N2 レジ背面壁", "2.29 × H2.39, t0.10, 南面クリムゾン塗装／北面ホール仕上げ", "1 箇所", "業者", "窓壁→北面 4.72（実測 477.6）, W11 まで 2.07"),
            ("3", "N3・N4 写真コーナー袖壁", "N3 0.99・N4 1.10 × H2.39, t0.10, 両面ホール仕上げ", "2 箇所", "業者", "W5・W4 の延長線上"),
            ("4", "N5 トイレ前 目隠し壁", "1.13 × H2.39, t0.10, W10 から 0.80, 東端 W1 付け", "1 箇所", "業者", "南面タイル（No.9）"),
            ("5", f"N6 洗面室入口アーチ", f"有効 {N6w:.2f}, スプリング 1.62, 頂部 {1.62 + N6w / 2:.2f} 半円 — スパンドレル＋金色モール両面", "1 箇所", "業者", "N4〜N5 間"),
            ("6", f"N7 ホール入口アーチ", f"有効 {N7w:.2f}, スプリング 1.62, 頂部 {1.62 + N7w / 2:.2f} 半円 — スパンドレル＋金色モール両面", "1 箇所", "業者", "N2〜N3 間。N6 と同じ 0.86（11/17 拡幅）"),
            ("7", "O1 W4 開口＋カーテン", "0.53 × H1.98 開口, 補強, 黒丸棒＋遮光カーテン", "1 箇所", "業者", "構造確認"),
            ("8", "D2 トイレドア交換", "W0.645 × H1.92, ヒンジ東・内開き\nウォールナット 2 段パネル戸＋サテンニッケルレバー, ドアクローザー", "1 箇所", "業者", "既存の外開き鉄扉撤去"),
            ("9", "P3 フォトスポット タイル・塗装", "N5 南面＋N6 南面 リーフモザイクタイル（ベージュ）約 3.1 ㎡\nW10 北面・W1・W4 面 クリーム塗装＋チェアレール H0.92・幅木 H0.10", "1 式", "業者（タイル）＋DIY（塗装）", "ミラー 640×920 取付含む"),
            ("10", "C1・C3 撤去", "細柱 2 本 — 構造柱なら不可。構造確認を先行", "2 本", "業者（構造）", "計画段階"),
            ("11", "上部壁 塗装", "ダルグリーン, プライマー＋2〜3 回", "約 45〜50 ㎡", "業者または DIY", "クロス状態・密着テスト"),
            ("12", "下部壁 パネル＋見切り材", "エアサーモパネル lite 7 mm, 床〜帯上端, 見切り材 25×12", "パネル 約 140 枚・見切り 約 50 本", "DIY 予定", "高さ A 実測後に発注"),
            ("13", "柱 4 面ミラー", "C2（＋C1・C3）帯上〜天井, 飛散防止フィルム, 角突付け", "1〜3 柱 × 4 面", "業者（ガラス店）", "寸法は現場実測"),
            ("14", "赤カーペット F1", "玄関通路 1.09×1.06 ＋ レジ前 1.14×1.10", "約 2.7 ㎡", "業者または DIY", "タイルカーペット可"),
            ("15", "サイン・鏡", "船場美術館 縦書き金色切文字 H1.1・丸鏡 φ0.55", "1 式", "サイン業者", "N2 南面。別途"),
            ("16", "照明追加", "ダクトレール スポット 3 灯（2700〜3000K）", "3 灯", "業者（電気）／DIY", "既存レール利用"),
            ("17", "レジカウンター", "1.10×0.455×H1.00 ＋ 北端に折りたたみ補助天板 0.45（製作または既製）", "1 台", "製作または購入", "W2 と平行縦置き\n客側面 W2 から 1.05, 南端 W11 付け"),
            ("18", "コンセント・スイッチ", "パネル施工区間の切欠き, 必要ならボックス移設", "現場確認", "業者（電気）", "電気工事士"),
            ("—", "既存維持", "床・天井・黒い帯・幅木・窓・シンク・洗面台・自動ドア", "", "", "撤去なし")]
    for r in rows:
        for x, tx in zip(cols_x, r): fig.text(x, y, tx, fontsize=7.6, va="top")
        y -= 0.029 + (0.012 if any("\n" in c for c in r) else 0); fig.add_artist(plt.Line2D([0.035, 0.97], [y + 0.008, y + 0.008], color="#ddd", lw=0.6))
    y -= 0.008; fig.text(0.035, y, "業者への確認事項", fontsize=11, weight="bold", color=RED); y -= 0.027
    for tx in ["• 賃貸の原状回復条件に合う固定方法（新設壁の床・天井固定, パネル接着）の提案", "• N1・N2・N5 が天井ダクトレール・エアコン・スプリンクラー・配線と干渉しないか", "• クロスの上への塗装可否（ビニール／防汚コート）, 必要なプライマー",
               "• 柱ミラーの施工方法（接着＋飛散防止フィルム, 角の納まり）と安全基準", "• N7 アーチ 有効 0.86（エアコン交換・荷物搬入を考慮）— N2 南面〜N3 北端の内法を現場で確保", "• 工期, 営業しながらの施工可否", "• 見積は項目別（1〜18）に分離"]:
        fig.text(0.04, y, tx, fontsize=8.3, color=RED); y -= 0.02
    fig.text(0.035, 0.04, "添付: 3D ビューア（E案） https://85mighty.github.io/senba-ops/kobe-interior/kobe-gallery-3d/app/  ・ 現場写真 11 枚 ・ 実測手書き平面図（11/07, 11/10）", fontsize=8, color=MUTE)
    pdf.savefig(fig); plt.close(fig)


def main():
    m, walls, cols = load(); g = geo(m, walls, cols); OUT.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(OUT) as pdf:
        page_current(pdf, m, walls, cols, g); page_plan(pdf, m, walls, cols, g); page_zoom(pdf, m, walls, cols, g); page_detail(pdf, m, g); page_finish(pdf, m); page_scope(pdf, m, g)
    print(f"[図面] {OUT}")


if __name__ == "__main__":
    main()
