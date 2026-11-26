"""施工業者向け図面（日本語・F案）— A3 横 8 枚, 平面 1:50.
E案の図面（make_contractor_pdf_ja.py）の構成を使い, F案の仕上げ（セージ塗装・腰壁パネル・廻り縁・白天井・ブラケット照明）を加える。
① 現況平面図  ② 計画平面図（F案: 照明・スピーカー位置入り）  ③ 部分拡大図  ④ 新設壁・開口部 詳細
⑤ 壁仕上げ断面（F案）  ⑥⑦ 腰壁パネル 割付図（壁ごとの立面, 額縁モールの位置）  ⑧ 工事範囲・見積依頼項目（F案）
腰壁・廻り縁の割付は 3D ビューアが実際に描いている値（scripts/data/f_wainscot_layout.json）をそのまま使う。
  更新: 3D で F案を開いて window.__editor.wsLayout / crownLayout を書き出す（README 参照）
使い方: python3 scripts/make_contractor_pdf_ja_f.py  →  ../도면/施工図_F案_日本語.pdf"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_contractor_pdf_ja as E   # noqa: E402
from make_contractor_pdf_ja import A3, A3_MM, INK, MUTE, RED, BLUE, GOLD, plan_axes, draw_base, draw_plan_items, dim, legend, plt, Rectangle, PdfPages   # noqa: E402

ROOT = E.ROOT
OUT = ROOT.parent / "도면" / "施工図_F案_日本語.pdf"
LAYOUT = json.loads((ROOT / "scripts" / "data" / "f_wainscot_layout.json").read_text(encoding="utf-8"))
DATE = "2026-11-26"
PAGES = 8
SAGE, HONEY, HONEY_L, WHITE = "#6b8272", "#a8672f", "#d9a36a", "#ffffff"
VIEWER = "https://85mighty.github.io/senba-ops/kobe-interior/kobe-gallery-3d/app/ja-f.html"

# F案 3D の小物から: 壁付け照明（ブラケット）7 灯・スピーカー 4 台
SCONCES = [("L1", -1.52, 1.756, 1.50, "写真コーナー ミラー左（W15）"), ("L2", 0.075, 1.756, 1.50, "写真コーナー ミラー右（W15）"),
           ("L3", -0.82, -4.80, 1.70, "窓壁 W9 の窓間の柱"), ("L4", -3.95, -3.35, 1.70, "西壁 W2"), ("L5", -3.95, -1.64, 1.70, "西壁 W2"),
           ("L6", 2.35, -2.94, 1.70, "東壁 W1"), ("L7", 2.35, -0.34, 1.70, "東壁 W1")]


def header(fig, title, sub, page):
    fig.text(0.033, 0.955, title, fontsize=17, weight="bold"); fig.text(0.033, 0.928, sub, fontsize=9, color=MUTE)
    fig.text(0.97, 0.955, f"船場美術館 神戸店（三宮）  F案  {DATE}   {page}/{PAGES}", fontsize=9, ha="right", color=MUTE)
    fig.text(0.97, 0.935, "✓ = 現場実測 (2026-11-07 / 11-10)   (ス) = 3D スキャン推定 — 着工前に現場で再確認のこと   単位 m（断面図・割付図は mm）", fontsize=8, ha="right", color=MUTE)
    fig.add_artist(plt.Line2D([0.033, 0.97], [0.92, 0.92], color=INK, lw=0.8))


E.header = header   # ①③④ は E案と同じ図 — ヘッダーだけ F案に


def wall_names(m, walls, cols):
    n = {w["id"]: f"W{w['num']}" for w in walls}
    n.update({"wall_rec_back_out": "N2 北面（ホール側）", "wall_rec_back_in": "N2 南面（レジ側）", "wall_wing_w_in": "N3 東面（写真コーナー側）", "wall_wing_w_out": "N3 西面（レジ側）",
              "wall_wing_e_in": "N4 西面（写真コーナー側）", "wall_wing_e_out": "N4 東面（トイレ前）", "wall_tscreen_s": "N5 南面（フォトスポット）", "wall_tscreen_n": "N5 北面（ホール側）", "wall_kitchen_close": "N1"})
    for c in cols: n[c["id"]] = f"柱 C{c['num']}"
    extra = {"wall_x_0": "W1 東壁", "wall_x_1": "W2 西壁", "wall_z_8": "W9 窓壁", "wall_z_10": "W11 レジ奥の壁", "wall_x_2": "W3", "wall_x_4": "W5", "wall_z_9": "W10", "wall_z_14": "W15 写真コーナー正面"}
    n.update(extra); return n


# ---------------------------------------------------------------- ② 計画平面（F案）
def draw_sconces(ax, fs):
    for name, x, z, h, _ in SCONCES:
        ax.add_patch(plt.Circle((x, z), 0.09, fc="#ffd75e", ec="#8a6a10", lw=0.8, zorder=9)); ax.text(x + (0.13 if x < 2 else -0.13), z + 0.02, name, fontsize=fs, color="#6a5008", weight="bold", ha="left" if x < 2 else "right", va="center", zorder=10)


def page_plan(pdf, m, walls, cols, g):
    fig = plt.figure(figsize=A3)
    header(fig, "② 計画平面図（F案）— 新設壁・開口・レジ・照明・スピーカー", "E案の平面（新設壁 N1〜N7・開口・レジ）は同じ。F案は仕上げが違う（⑤〜⑦）。ブラケット照明 L1〜L7・スピーカー SP1〜SP4 の位置を追加。家具・小物は図示しない。", 2)
    ax = plan_axes(fig, (-5.3, 4.6), (-6.3, 5.6)); draw_base(ax, m, walls, cols, g, demolish=True); draw_plan_items(ax, m, cols, g, detail=False); draw_sconces(ax, 6.5)
    W2, W9, W11, W1 = g["W2"], g["W9"], g["W11"], g["W1"]; N2, N3, N4, N5 = g["N2"], g["N3"], g["N4"], g["N5"]
    dim(ax, (W2, W9), (W2, N2["zN"]), 0.5, f"{N2['zN'] - W9:.2f} (窓壁 W9 → N2 北面)", color=RED, fs=6.5, side=1)
    dim(ax, (W2, N2["zS"]), (W2, W11), 0.5, f"{W11 - N2['zS']:.2f} (N2 南面 → W11)", color=RED, fs=6, side=1)
    dim(ax, (N2["x0"], N2["zN"]), (N2["x1"], N2["zN"]), -0.42, f"N2 {N2['x1'] - N2['x0']:.2f}", color=RED, fs=6.5)
    dim(ax, (N3["x1"], 0.95), (N4["x0"], 0.95), 0.0, f"{N4['x0'] - N3['x1']:.2f} (N3 ↔ N4 内法)", color=RED, fs=6)
    # 照明・スピーカーの位置寸法（壁からの距離）
    for name, x, z, h, _ in SCONCES[3:]:
        wall_x = W2 if x < 0 else W1; ax.text(x + (0.3 if x < 0 else -0.3), z - 0.16, f"窓壁から {z - W9:.2f}", fontsize=5.3, color="#6a5008", ha="left" if x < 0 else "right", zorder=10)
    ax.text(-0.82, -4.55, f"W2 から {-0.82 - W2:.2f}", fontsize=5.3, color="#6a5008", ha="center", zorder=10)
    x0 = 0.70; fig.text(x0, 0.885, "F案で加わる項目（位置は図）", fontsize=11, weight="bold"); y = 0.86
    items = [("L1〜L7", "壁付けブラケット照明 7 灯（真鍮＋ガラス玉＋白シェード）。L1・L2 = 写真コーナー ミラー両脇（W15, シェード中心 H1.50）, L3 = 窓壁 W9 の窓間の柱, L4・L5 = 西壁 W2, L6・L7 = 東壁 W1（いずれも H1.70）。"
                        "**壁内配線（埋込ボックス）— 露出の配線カバー・モールは使わない**。スイッチは入口付近にまとめて 1〜2 回路"),
             ("SP1〜SP4", "コーナー壁付けスピーカー 4 台（中心 H2.12, 下向き 12°）。SP1 西壁 W2（窓壁から 0.50 — 天井コーナーの既存突起物を避ける）, SP2 北東角, SP3 南東角（W1 × N5 北面）, SP4 レジ奥 W11 北面（東端から 0.19）。配線は天井裏"),
             ("上部壁", f"セージグリーン {SAGE.upper()} 塗装（帯上〜天井）— 詳細 ⑤"),
             ("腰壁", f"腰壁パネル H950 単色塗装 {HONEY.upper()}（はちみつ色）＋額縁モール — 黒い帯・幅木を覆う。窓壁 W9 は額縁なし。割付 ⑥⑦"),
             ("天井", "天井 白塗装（#FFFFFF）＋ 天井まわりの廻り縁（白, H130・出 70, 4 段）— 天井に届く壁・柱すべて。N2〜N7 は上が欄間のため廻り縁なし"),
             ("壁の端", "新設壁の見える小口（N2 東端・N4 北端）は壁と同じ色で巻く（腰壁高さまで腰壁色, その上はセージ）"),
             ("アーチ", "N6・N7 の金色モールは壁面から 30 出し, 腰壁パネルはモールの手前 70 で止める（パネルがモールを覆わない）")]
    for k, t in items:
        fig.text(x0, y, k, fontsize=7.5, weight="bold", color=RED); fig.text(x0 + 0.045, y, t.replace("**", ""), fontsize=6.6, va="top", wrap=True); y -= 0.058 if len(t) > 110 else 0.04
    y = legend(fig, x0, y - 0.005, [(dict(fc="#ffd75e", ec="#8a6a10"), "ブラケット照明 L"), (dict(fc="#222", ec="#000"), "スピーカー SP"), (dict(fc="white", ec=RED, hatch="////"), "新設壁 N（t 0.10）"), (dict(fc="#fff6dd", ec=GOLD, ls="--"), "アーチ（上部のみ壁）"), (dict(fc="#e8dcc8", ec=INK), "レジカウンター")], "凡例")
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ⑤ 壁仕上げ断面（F案）
def page_finish(pdf, m):
    fig = plt.figure(figsize=A3)
    header(fig, "⑤ 壁仕上げ断面（F案・ホール共通）", "腰壁パネル・額縁モール・廻り縁の断面。寸法は 3D の F案と同じ値。単位 mm。腰壁高さ 950 は黒い帯（上端 ≈890）を覆う高さ。", 5)
    ax = fig.add_axes([0.04, 0.07, 0.42, 0.82]); ax.axis("off"); ax.set_xlim(-560, 560); ax.set_ylim(-80, 2520)
    C = 2393
    ax.add_patch(Rectangle((-60, 0), 60, C, fc="#ddd", ec=INK)); ax.text(-30, C + 60, "既存壁", ha="center", fontsize=8)
    ax.add_patch(Rectangle((-120, -60), 640, 60, fc="#c9a97a", ec=INK)); ax.text(300, -35, "床 — 既存のまま", fontsize=8)
    ax.add_patch(Rectangle((-60, C), 640, 40, fc=WHITE, ec=INK)); ax.text(250, C + 70, "天井 — 白塗装 #FFFFFF", fontsize=8)
    ax.add_patch(Rectangle((0, 0), 6, 112, fc="#6b4a2e", ec=INK)); ax.add_patch(Rectangle((0, 816), 10, 74, fc="#111", ec=INK))   # 既存 幅木・黒い帯（パネル裏に残す）
    ax.add_patch(Rectangle((0, 950), 3, C - 950 - 130, fc=SAGE, ec="none"))
    # 腰壁: 胴縁 12 → 背板 16 → 幅木 2 段 → 笠木 3 段 → 額縁モール（35 幅, 8＋7 出）
    ax.add_patch(Rectangle((0, 3), 12, 950 - 3 - 40, fc="#e6d6bd", ec=INK, lw=0.5, hatch="..."))
    ax.add_patch(Rectangle((12, 3), 16, 950 - 3 - 40, fc=HONEY_L, ec=INK, lw=0.6))
    for (y0, y1, dep) in [(3, 85, 30), (85, 110, 40), (950 - 75, 950 - 50, 26), (950 - 50, 950 - 25, 38), (950 - 25, 950, 50)]:
        ax.add_patch(Rectangle((12, y0), dep, y1 - y0, fc=HONEY, ec=INK, lw=0.6))
    for yb in (190, 795 - 35):
        ax.add_patch(Rectangle((28, yb), 8, 35, fc=HONEY, ec=INK, lw=0.5)); ax.add_patch(Rectangle((36, yb + 10), 7, 15, fc=HONEY_L, ec=INK, lw=0.5))
    # 廻り縁 4 段（H130, 出 70）
    for (y0, y1, dep) in [(C - 130, C - 105, 12), (C - 105, C - 75, 30), (C - 75, C - 40, 50), (C - 40, C, 70)]:
        ax.add_patch(Rectangle((0, y0), dep, y1 - y0, fc=WHITE, ec=INK, lw=0.7))

    def d(x, y0, y1, label, c=RED, ha="right"):
        ax.annotate("", xy=(x, y0), xytext=(x, y1), arrowprops=dict(arrowstyle="<->", color=c, lw=0.9)); ax.text(x - 10 if ha == "right" else x + 10, (y0 + y1) / 2, label, color=c, fontsize=8, va="center", ha=ha)
    d(-330, 0, 950, "腰壁 H950"); d(-480, 0, C, "✓ 天井高 2393"); d(-110, 0, 110, "幅木 110"); d(-110, 875, 950, "笠木 75"); d(-185, 190, 795, "額縁 H605\n(190〜795)"); d(-110, C - 130, C, "廻り縁 130")
    ax.annotate("", xy=(0, C - 160), xytext=(70, C - 160), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(80, C - 160, "出 70", color=RED, fontsize=8, va="center")
    ax.annotate("", xy=(0, 600), xytext=(28, 600), arrowprops=dict(arrowstyle="<->", color=RED)); ax.text(70, 640, "胴縁 12＋背板 16 = 28\n（黒い帯の出 10・幅木の出 4〜7 を吸収）", color=RED, fontsize=7.5, va="center")
    for y, tx in [(1650, "① 上部壁: クロスの上に水性塗装 2〜3 回\n   セージグリーン #6B8272（密着プライマー要）"), (2150, "⑥ 廻り縁: 石膏または MDF 既製品 H130×出70 程度,\n   白塗装。天井に届く壁・柱の全周"),
                  (920, "③ 笠木 3 段（出 26/38/50）— 腰壁色"), (500, "② 腰壁: 胴縁＋MDF/合板 背板, 単色塗装 #A8672F\n   既存の黒い帯・幅木は撤去せず裏に残す（業者判断で撤去可）"),
                  (205, "④ 額縁モール 35 幅（2 段）— 腰壁色。位置は ⑥⑦"), (55, "⑤ 幅木 2 段（出 30/40）— 腰壁色")]:
        ax.text(150, y, tx, fontsize=8, va="center")
    x0 = 0.50; fig.text(x0, 0.885, "仕上げ仕様（F案）", fontsize=11, weight="bold")
    ws_len = sum(b - a for l in LAYOUT["layout"] if not l["isCol"] for a, b, *_ in l["pieces"]); ws_col = sum(b - a for l in LAYOUT["layout"] if l["isCol"] for a, b, *_ in l["pieces"])
    n_fr = sum(len(l["frames"]) for l in LAYOUT["layout"]); cr_len = sum(b - a for r in LAYOUT["crownLayout"] for a, b in r["pieces"])
    spec = [("上部壁（腰壁上〜天井）", f"水性塗装 セージグリーン {SAGE.upper()}（艶消し）。ビニールクロス用密着プライマー＋2〜3 回。面積 約 40〜45 ㎡（窓除く）"),
            ("腰壁パネル（床〜H950）", f"胴縁 12＋背板 16（MDF・合板）, 単色塗装 {HONEY.upper()}（木目なし）。幅木 2 段・笠木 3 段・額縁モール 35 幅。延長 約 {ws_len:.0f} m（壁）＋柱 約 {ws_col:.1f} m"),
            ("額縁モール", f"壁ごとに幅を計算して等分割（両端の余白 140・額縁の間 160・目標幅 720）。隣の壁・角・開口に掛からない。合計 {n_fr} 枠 — ⑥⑦ 割付図。窓壁 W9 は額縁なし（パネルのみ）"),
            ("黒い帯・幅木", "撤去せず腰壁パネルの裏に隠す（胴縁で逃がす）。撤去する場合は業者判断"),
            ("天井・廻り縁", f"天井 白塗装 #FFFFFF。廻り縁 白 H130・出 70（4 段）を天井に届く壁・柱の上端全周に — 延長 約 {cr_len:.0f} m（3D 計測, 柱含む）。N2〜N7（上 0.24 欄間）は除く"),
            ("新設壁 N1〜N7", "E案と同じ（LGS または木下地＋PB 12.5 両面, N2〜N5・アーチ上端 2.15, 上 0.24 横桟欄間）。ホール面はセージ＋腰壁。N2 南面はダマスク柄クロス（赤）。見える小口は壁と同色で巻く"),
            ("アーチ N6・N7", "金色モール φ60 を両面に（壁面から 30 出し）, 開口内側も金色。腰壁パネルはモールの手前 70 で止める"),
            ("柱 C2", "帯上〜天井 4 面ミラー（飛散防止フィルム）, 下部は腰壁パネル"),
            ("ブラケット照明", "7 灯（L1〜L7, ②）— 壁内配線・埋込ボックス。露出配線なし"),
            ("床", "既存フローリング維持。F1 区間のみ赤カーペット")]
    y = 0.86
    for a, b in spec:
        fig.text(x0, y, a, fontsize=8.5, weight="bold", va="top"); fig.text(x0 + 0.12, y, b, fontsize=7.5, va="top", wrap=True)
        y -= 0.05 if len(b) > 75 else 0.036; fig.add_artist(plt.Line2D([x0, 0.97], [y + 0.008, y + 0.008], color="#ddd", lw=0.6))
    # 色見本
    yy = y - 0.02; fig.text(x0, yy, "色見本（最終は試し塗りで決定）", fontsize=9, weight="bold"); yy -= 0.035
    for i, (c, t) in enumerate([(SAGE, f"上部壁 セージ {SAGE.upper()}"), (HONEY, f"腰壁 はちみつ色 {HONEY.upper()}"), (WHITE, "天井・廻り縁 白"), ("#c9a24a", "アーチ モール 金"), ("#8d1c2c", "N2 南面 ダマスク（赤）")]):
        fig.add_artist(Rectangle((x0 + i * 0.094, yy - 0.01), 0.03, 0.03, transform=fig.transFigure, fc=c, ec=INK, lw=0.6)); fig.text(x0 + i * 0.094 + 0.034, yy + 0.005, t, fontsize=6.8, va="center", wrap=True)
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ⑥⑦ 腰壁パネル 割付図
def elevations(m, walls, cols):
    names = wall_names(m, walls, cols); out = []
    for l in LAYOUT["layout"]:
        if l["isCol"] and not l["frames"]: continue
        if not l["pieces"]: continue
        flip = (l["axis"] == "x" and l["side"] == 1) or (l["axis"] == "z" and l["side"] == -1)   # 部屋側から見た左右
        face = {("x", 1): "東向き面", ("x", -1): "西向き面", ("z", 1): "南向き面", ("z", -1): "北向き面"}[(l["axis"], l["side"])]
        nm = names.get(l["sid"], l["sid"]); out.append(dict(l, flip=flip, name=nm if nm.startswith("N") else f"{nm}（{face}）"))
    return out


def draw_elev(fig, e, x_mm, y_mm, scale):
    """左上 (x_mm, y_mm) から立面を描く。戻り値: 使った幅 mm"""
    a0 = min(p[0] for p in e["pieces"]); a1 = max(p[1] for p in e["pieces"]); L = a1 - a0; H = 0.95
    w_mm = L * 1000 / scale; h_mm = H * 1000 / scale
    ax = fig.add_axes([x_mm / A3_MM[0], 1 - (y_mm + 8 + h_mm) / A3_MM[1], w_mm / A3_MM[0], h_mm / A3_MM[1]]); ax.set_xlim(0, L); ax.set_ylim(0, H); ax.axis("off")
    tx = (lambda t: a1 - t) if e["flip"] else (lambda t: t - a0)
    fig.text(x_mm / A3_MM[0], 1 - (y_mm + 4) / A3_MM[1], e["name"] + f"  全長 {L * 1000:.0f}", fontsize=7.2, weight="bold", va="center")
    for (a, b, c, d) in e["pieces"]:
        l, r = sorted([tx(a), tx(b)]); ax.add_patch(Rectangle((l, c), r - l, d - c, fc=HONEY_L, ec=INK, lw=0.5))
        ax.add_patch(Rectangle((l, c), r - l, 0.11 - c, fc=HONEY, ec="none")); ax.add_patch(Rectangle((l, d - 0.075), r - l, 0.075, fc=HONEY, ec="none"))
    yb, yt = e.get("yb", 0.19), e.get("yt", 0.795)
    for (l0, r0) in e["frames"]:
        l, r = sorted([tx(l0), tx(r0)]); ax.add_patch(Rectangle((l, yb), r - l, yt - yb, fc="none", ec="#5a3410", lw=1.0))
        ax.text((l + r) / 2, (yb + yt) / 2, f"{(r - l) * 1000:.0f}", ha="center", va="center", fontsize=5.8, color="#5a3410")
    # 横方向の寸法（端 → 額縁 → 間 → 額縁 … → 端）
    xs = sorted({round(v, 3) for (l0, r0) in e["frames"] for v in sorted([tx(l0), tx(r0)])} | {round(tx(a), 3) for a, b, *_ in e["pieces"]} | {round(tx(b), 3) for a, b, *_ in e["pieces"]})
    for p, q in zip(xs, xs[1:]):
        if q - p < 0.02: continue
        ax.annotate("", xy=(p, -0.06), xytext=(q, -0.06), arrowprops=dict(arrowstyle="<->", lw=0.4, color=MUTE), annotation_clip=False)
        ax.text((p + q) / 2, -0.15, f"{(q - p) * 1000:.0f}", ha="center", va="top", fontsize=4.8, color=MUTE, clip_on=False)
    if e.get("noFrame"): ax.text(L / 2, 1.02, "額縁なし（パネルのみ）— 窓の下は窓台まで", ha="center", va="bottom", fontsize=7, color=MUTE, clip_on=False)
    return w_mm


def page_layout(pdf, m, walls, cols, part, elevs, pageno, scale=40):
    fig = plt.figure(figsize=A3)
    header(fig, f"{'⑥⑦'[pageno - 6]} 腰壁パネル 割付図 {part}（立面 1:{scale}, 部屋側から見る）", "3D の F案と同じ割付。開口・直交壁の部分はパネルを切る。", pageno)
    fig.text(0.033, 0.905, "はちみつ色 = 腰壁（濃い帯 = 幅木 110・笠木 75）　茶枠 = 額縁モール（数字 = 額縁の外寸幅 mm）　下の寸法 = 端・額縁・間の長さ mm　高さ: 額縁 H190〜795, 腰壁 H950", fontsize=8.5, color=INK)
    x, y, row_h = 14, 42, 0
    for e in elevs:
        a0 = min(p[0] for p in e["pieces"]); a1 = max(p[1] for p in e["pieces"]); w = (a1 - a0) * 1000 / scale
        if x + w > A3_MM[0] - 10: x = 14; y += row_h; row_h = 0
        draw_elev(fig, e, x, y, scale); x += max(w, len(e['name']) * 2.6 + 18) + 16; row_h = max(row_h, 8 + 950 / scale + 16)
    pdf.savefig(fig); plt.close(fig)


# ---------------------------------------------------------------- ⑧ 工事範囲（F案）
def page_scope(pdf, m, g):
    fig = plt.figure(figsize=A3)
    header(fig, "⑧ 工事範囲・見積依頼項目（F案）", "項目別に見積をお願いします。施主支給（本体・小物）は取付のみ。数量は 3D・実測による概算 — 現場実測後に確定。", 8)
    cols_x = [0.035, 0.063, 0.25, 0.60, 0.72, 0.84]; heads = ["No", "項目", "仕様", "数量（概算）", "施工", "備考"]; y = 0.885
    for x, h in zip(cols_x, heads): fig.text(x, y, h, fontsize=9.5, weight="bold")
    fig.add_artist(plt.Line2D([0.035, 0.97], [y - 0.008, y - 0.008], color=INK, lw=0.8)); y -= 0.03
    N7w = g["N7"]["z1"] - g["N7"]["z0"]; N6w = g["N6"]["x1"] - g["N6"]["x0"]
    ws_len = sum(b - a for l in LAYOUT["layout"] if not l["isCol"] for a, b, *_ in l["pieces"]); n_fr = sum(len(l["frames"]) for l in LAYOUT["layout"]); cr_len = sum(b - a for r in LAYOUT["crownLayout"] for a, b in r["pieces"])
    rows = [("1", "N1 キッチン入口 塞ぎ壁", "1.12 × H2.39, t0.10, 両面 PB, ホール仕上げ", "1 箇所", "業者", "現入口の垂れ壁下"),
            ("2", "N2 レジ背面壁", "2.29 × H2.15（上 0.24 欄間）, t0.10, 南面ダマスク柄クロス／北面ホール仕上げ", "1 箇所", "業者", "窓壁→北面 4.61, W11 まで 2.10"),
            ("3", "N3・N4 写真コーナー袖壁", "N3 0.99・N4 1.10 × H2.15（上 0.24 欄間）, t0.10", "2 箇所", "業者", "見える小口は壁と同色で巻く"),
            ("4", "N5 トイレ前 目隠し壁", "1.13 × H2.15（上 0.24 欄間）, t0.10, W10 から 0.80", "1 箇所", "業者", ""),
            ("5", "N6・N7 アーチ", f"有効 {N6w:.2f}・{N7w:.2f}, スプリング 1.62 — スパンドレル＋金色モール両面（壁面から 30 出し）", "2 箇所", "業者", "腰壁はモール手前 70 で止める"),
            ("6", "D2 トイレドア交換", "W0.645 × H1.92, ヒンジ東・内開き, ウォールナット 2 段パネル戸", "1 箇所", "業者", "既存鉄扉撤去"),
            ("7", "上部壁 塗装", f"セージグリーン {SAGE.upper()}, プライマー＋2〜3 回", "約 40〜45 ㎡", "業者または DIY", "クロス密着テスト"),
            ("8", "腰壁パネル", f"H950, 胴縁＋背板＋幅木 2 段＋笠木 3 段, 単色塗装 {HONEY.upper()}", f"約 {ws_len:.0f} m（壁）＋柱", "業者", "黒い帯・幅木は裏に残す"),
            ("9", "額縁モール", "35 幅 2 段, 腰壁色 — 割付は ⑥⑦", f"{n_fr} 枠", "業者", "窓壁 W9 は額縁なし"),
            ("10", "天井 塗装＋廻り縁", "天井 白 #FFFFFF, 廻り縁 白 H130×出 70（石膏／MDF 既製品）", f"天井 約 45 ㎡・廻り縁 約 {cr_len:.0f} m", "業者", "N2〜N7 上は欄間のため除く"),
            ("11", "柱 4 面ミラー", "C2（＋C1・C3）帯上〜天井, 飛散防止フィルム", "1〜3 柱 × 4 面", "業者（ガラス店）", "寸法は現場実測"),
            ("12", "ブラケット照明 L1〜L7", "真鍮＋ガラス玉＋白シェード（施主支給）。壁内配線・埋込ボックス, 露出配線なし。L1・L2 H1.50, 他 H1.70", "7 灯", "業者（電気）", "回路・スイッチ位置を提案"),
            ("13", "スピーカー SP1〜SP4", "コーナー壁付け, 中心 H2.12（本体施主支給）, 配線は天井裏", "4 台", "業者（電気・弱電）", "アンプ位置"),
            ("14", "照明追加（スポット）", "ダクトレール スポット 3 灯（2700〜3000K）", "3 灯", "業者／DIY", "既存レール利用"),
            ("15", "赤カーペット F1", "玄関通路 1.09×1.06 ＋ レジ前 1.14×1.10", "約 2.7 ㎡", "業者または DIY", ""),
            ("16", "N2 南面 ダマスク柄クロス", "赤・トーンオントーン, 柄リピート約 0.64", "約 5 ㎡", "業者", "サイン・丸鏡は別途"),
            ("17", "レジカウンター", "1.10×0.455×H1.00 ＋ 折りたたみ補助天板 0.8", "1 台", "製作または購入", ""),
            ("18", "C1・C3 撤去", "構造柱なら不可。構造確認を先行", "2 本", "業者（構造）", "計画段階"),
            ("19", "コンセント・スイッチ", "腰壁区間の切欠き・ボックス延長", "現場確認", "業者（電気）", ""),
            ("—", "既存維持", "床・窓・シンク・洗面台・自動ドア", "", "", "")]
    for r in rows:
        for x, tx in zip(cols_x, r): fig.text(x, y, tx, fontsize=7.4, va="top", wrap=True)
        y -= 0.029 + (0.01 if len(r[2]) > 62 else 0); fig.add_artist(plt.Line2D([0.035, 0.97], [y + 0.008, y + 0.008], color="#ddd", lw=0.6))
    y -= 0.008; fig.text(0.035, y, "業者への確認事項", fontsize=11, weight="bold", color=RED); y -= 0.027
    for tx in ["• 黒い帯・幅木を残して腰壁を被せる納まり（胴縁 12）か, 撤去して直貼りか — 原状回復条件と合わせて提案", "• 廻り縁の材料（石膏・MDF・ウレタン）と天井の不陸への対応", "• ブラケット 7 灯の壁内配線ルート（既存壁・新設壁）と回路数",
               "• クロスの上への塗装可否（セージ・天井白）と必要なプライマー", "• N7 アーチ 有効 0.86 の確保", "• 工期, 営業しながらの施工可否", "• 見積は項目別（1〜19）に分離"]:
        fig.text(0.04, y, tx, fontsize=8.2, color=RED); y -= 0.02
    fig.text(0.035, 0.04, f"添付: 3D ビューア（F案・日本語） {VIEWER}  ・ 現場写真 ・ 実測手書き平面図（11/07, 11/10）", fontsize=8, color=MUTE)
    pdf.savefig(fig); plt.close(fig)


def main():
    E.PAGES = PAGES
    m, walls, cols = E.load(); g = E.geo(m, walls, cols); OUT.parent.mkdir(parents=True, exist_ok=True)
    el = elevations(m, walls, cols)
    big = [e for e in el if not e["isCol"] and (max(p[1] for p in e["pieces"]) - min(p[0] for p in e["pieces"])) > 4]
    small = [e for e in el if e not in big]
    with PdfPages(OUT) as pdf:
        E.page_current(pdf, m, walls, cols, g); page_plan(pdf, m, walls, cols, g); E.page_zoom(pdf, m, walls, cols, g); E.page_detail(pdf, m, g)
        page_finish(pdf, m); page_layout(pdf, m, walls, cols, "1（長い壁）", big, 6, scale=30); page_layout(pdf, m, walls, cols, "2（新設壁・短い壁・柱）", small, 7, scale=25); page_scope(pdf, m, g)
    print(f"[図面] {OUT}")


if __name__ == "__main__":
    main()
