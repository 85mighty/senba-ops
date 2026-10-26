"""Phase 3 — 정돈된 건축 모델 (스캔 평면 적합 → 매끈한 벽/바닥/기둥).

입력: assets/models/scan_cleaned.glb (없으면 scan_original.glb). 좌표는 inspect 단계와 동일 월드.
출력: assets/models/reconstructed_room.glb, src/geometry_metadata.json(elements 추가),
      reports/geometry_assumptions.md, screenshots/recon_footprint.png

측정(measured) = 스캔 수직면 히스토그램·블롭에서 얻은 평면/박스
추정(inferred) = 창/문 후보(스캔 공백), 중앙 넓은 기둥 지정, 체어레일·걸레받이 높이 등
사용: python3 scripts/reconstruct_room.py [--chair-rail 0.95] [--baseboard 0.10] [--central-column ID]
"""
import argparse

import numpy as np
import trimesh
from scipy import ndimage

import common as C

WOOD = [142, 96, 60, 255]      # 중~진한 갈색 우드 (사진 색으로 교정 가능)
GRAY = [181, 178, 173, 255]    # 회색 벽지
BLACK = [28, 28, 28, 255]      # 검은 띠·걸레받이
CEIL = [236, 234, 228, 255]
COLUMN = GRAY
WALL_T = 0.12                  # 외벽 두께 (복원용 임의값, inferred)
CELL = 0.10                    # 평면도 격자 (m)


def pbr(color, name):
    return trimesh.visual.material.PBRMaterial(baseColorFactor=color, metallicFactor=0.0, roughnessFactor=0.9, name=name)


def box(extents, center, color, name):
    m = trimesh.creation.box(extents=extents)
    m.apply_translation(center)
    m.visual = trimesh.visual.TextureVisuals(material=pbr(color, name + "_mat"))
    m.metadata["name"] = name
    return m


def vertical_plane_peaks(centers, areas, axis, room_len, min_area=0.4, bin_m=0.05):
    """축에 수직인 면들의 좌표 히스토그램 피크 → 평면 오프셋 목록."""
    if len(centers) == 0:
        return []
    lo, hi = centers[:, axis].min(), centers[:, axis].max()
    bins = np.arange(lo - bin_m, hi + 2 * bin_m, bin_m)
    hist, edges = np.histogram(centers[:, axis], bins=bins, weights=areas)
    peaks = []
    for i in range(len(hist)):
        if hist[i] < min_area:
            continue
        l, r = max(0, i - 2), min(len(hist), i + 3)
        if hist[i] >= hist[l:r].max():
            peaks.append((float((edges[i] + edges[i + 1]) / 2), float(hist[l:r].sum())))
    return peaks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chair-rail", type=float, default=None, help="검은 중간 띠 윗면 높이 m (기본 0.95, 사진으로 보정)")
    ap.add_argument("--baseboard", type=float, default=None, help="걸레받이 높이 m (기본 0.10)")
    ap.add_argument("--central-column", help="중앙 넓은 기둥으로 지정할 element id (자동 선택을 덮어씀)")
    ap.add_argument("--min-plane-area", type=float, default=0.4)
    args = ap.parse_args()

    meta = C.load_meta()
    if "alignment_transform" not in meta:
        raise SystemExit("먼저 inspect_scan.py 를 실행하세요.")
    src = C.MODELS_DIR / "scan_cleaned.glb"
    if not src.exists():
        src = C.MODELS_DIR / "scan_original.glb"
        print("[주의] scan_cleaned.glb 없음 → scan_original.glb 사용")
    scan = trimesh.load(src, force="mesh", process=False)
    if isinstance(scan, trimesh.Scene):
        scan = trimesh.util.concatenate(list(scan.dump()))
    bmin, bmax = scan.bounds
    ceil_h = meta.get("ceiling_height_m") or float(bmax[1])
    chair = args.chair_rail or meta.get("chair_rail_height_m") or 0.95
    base = args.baseboard or meta.get("baseboard_height_m") or 0.10

    n, c, a = scan.face_normals, scan.triangles_center, scan.area_faces
    vert = np.abs(n[:, 1]) < 0.2
    vc, va, vn = c[vert], a[vert], n[vert]

    elements = []
    # ---------------- 외벽: X 수직 / Z 수직 평면 피크 중 bbox 가장자리 근처의 긴 것
    room = {"x": (float(bmin[0]), float(bmax[0])), "z": (float(bmin[2]), float(bmax[2]))}
    outer_walls = []
    for axis, other in ((0, 2), (2, 0)):
        sel = np.abs(vn[:, axis]) > 0.9
        for off, area in vertical_plane_peaks(vc[sel], va[sel], axis, bmax[axis] - bmin[axis], args.min_plane_area):
            near_edge = min(abs(off - bmin[axis]), abs(off - bmax[axis])) < 0.35
            sup = sel.copy(); sup[sel] &= np.abs(vc[sel][:, axis] - off) < 0.06
            pts = vc[sup]
            if len(pts) < 20:
                continue
            o_lo, o_hi = np.percentile(pts[:, other], [1, 99])
            y_lo, y_hi = pts[:, 1].min(), pts[:, 1].max()
            length = o_hi - o_lo
            if near_edge and length > 0.35 * (bmax[other] - bmin[other]):
                # 안쪽 법선: 방 중심 방향
                inward = 1.0 if off < (bmin[axis] + bmax[axis]) / 2 else -1.0
                # 창/문 후보: 길이 방향 0.25m 구간에서 0.9~2.0m 높이 커버가 없는 곳
                segs = np.arange(o_lo, o_hi, 0.25)
                gaps = []
                for s in segs:
                    inseg = (pts[:, other] >= s) & (pts[:, other] < s + 0.25)
                    mid = inseg & (pts[:, 1] > 0.9) & (pts[:, 1] < 2.0)
                    if inseg.sum() > 0 and mid.sum() == 0:
                        gaps.append(float(s))
                openings = []
                if gaps:
                    run = [gaps[0]]
                    for g in gaps[1:] + [None]:
                        if g is not None and abs(g - run[-1] - 0.25) < 1e-6:
                            run.append(g)
                        else:
                            if len(run) >= 2:
                                openings.append({"from": run[0], "to": run[-1] + 0.25, "status": "inferred",
                                                 "note": "0.9~2.0m 높이 스캔 공백 — 창(유리) 또는 문 가능. 사진으로 확인"})
                            run = [g] if g is not None else []
                wid = f"wall_{'x' if axis == 0 else 'z'}_{len(outer_walls)}"
                outer_walls.append({"id": wid, "type": "wall", "status": "measured", "axis": "x" if axis == 0 else "z",
                                    "offset": off, "from": float(o_lo), "to": float(o_hi), "y_from": float(y_lo), "y_to": float(y_hi),
                                    "inward": inward, "support_area_m2": round(area, 2), "openings": openings})
    elements += outer_walls

    # ---------------- 내부 수직 구조: 격자 블롭 → 기둥/파티션/설비 후보
    interior = np.ones(len(vc), bool)
    for w in outer_walls:
        ax = 0 if w["axis"] == "x" else 2
        interior &= ~(np.abs(vc[:, ax] - w["offset"]) < 0.20)
    ic = vc[interior]
    gx = ((ic[:, 0] - bmin[0]) / CELL).astype(int); gz = ((ic[:, 2] - bmin[2]) / CELL).astype(int)
    grid = np.zeros((int((bmax[0] - bmin[0]) / CELL) + 2, int((bmax[2] - bmin[2]) / CELL) + 2), int)
    np.add.at(grid, (gx, gz), 1)
    lab, nlab = ndimage.label(grid > 2, structure=np.ones((3, 3)))
    blobs = []
    for k in range(1, nlab + 1):
        cells = np.argwhere(lab == k)
        if len(cells) < 2:
            continue
        inb = lab[gx, gz] == k
        pts = ic[inb]
        if len(pts) < 30:
            continue
        x0, x1 = np.percentile(pts[:, 0], [2, 98]); z0, z1 = np.percentile(pts[:, 2], [2, 98])
        y0, y1 = pts[:, 1].min(), pts[:, 1].max()
        fx, fz = max(x1 - x0, 0.12), max(z1 - z0, 0.12)
        full_height = (y1 - y0) > 0.75 * ceil_h and y0 < 0.25
        if full_height and max(fx, fz) < 3.0:
            kind = "wide_column" if max(fx, fz) >= 0.8 else "thin_column"
        elif full_height:
            kind = "partition"
        else:
            kind = "fixture_candidate"
        blobs.append({"id": f"{kind}_{k}", "type": kind, "status": "measured" if kind != "fixture_candidate" else "observed",
                      "footprint": {"x": [float(x0), float(x1)], "z": [float(z0), float(z1)]},
                      "y": [float(y0), float(y1)], "support_points": int(len(pts))})
    elements += blobs

    # 중앙 넓은 기둥 — 방 중심에 가장 가까운 wide_column (없으면 가장 큰 기둥). 반드시 사용자 확인.
    cx, cz = (bmin[0] + bmax[0]) / 2, (bmin[2] + bmax[2]) / 2
    cols = [b for b in blobs if b["type"] in ("wide_column", "thin_column")]
    central = None
    if args.central_column:
        central = next((b for b in elements if b["id"] == args.central_column), None)
    elif cols:
        wide = [b for b in cols if b["type"] == "wide_column"] or cols
        central = min(wide, key=lambda b: (np.mean(b["footprint"]["x"]) - cx) ** 2 + (np.mean(b["footprint"]["z"]) - cz) ** 2)

    # ---------------- 메쉬 생성
    parts = []
    W, D = bmax[0] - bmin[0], bmax[2] - bmin[2]
    parts.append(box([W, 0.02, D], [cx, -0.01, cz], WOOD, "floor"))
    parts.append(box([W, 0.02, D], [cx, ceil_h + 0.01, cz], CEIL, "ceiling"))
    for w in outer_walls:
        L = w["to"] - w["from"]; mid = (w["to"] + w["from"]) / 2
        off_c = w["offset"] - w["inward"] * WALL_T / 2
        if w["axis"] == "x":
            parts.append(box([WALL_T, ceil_h, L], [off_c, ceil_h / 2, mid], GRAY, w["id"]))
            face = lambda h, t, nm: box([0.012, h, L], [w["offset"] + w["inward"] * 0.006, t, mid], BLACK, nm)
        else:
            parts.append(box([L, ceil_h, WALL_T], [mid, ceil_h / 2, off_c], GRAY, w["id"]))
            face = lambda h, t, nm: box([L, h, 0.012], [mid, t, w["offset"] + w["inward"] * 0.006], BLACK, nm)
        parts.append(face(base, base / 2, w["id"] + "_baseboard"))
        parts.append(face(0.06, chair - 0.03, w["id"] + "_chairrail"))
        for i, o in enumerate(w["openings"]):
            ol = o["to"] - o["from"]; om = (o["to"] + o["from"]) / 2
            ext = [0.02, 1.2, ol] if w["axis"] == "x" else [ol, 1.2, 0.02]
            ctr = [w["offset"] + w["inward"] * 0.02, 1.5, om] if w["axis"] == "x" else [om, 1.5, w["offset"] + w["inward"] * 0.02]
            parts.append(box(ext, ctr, [120, 170, 210, 110], f"{w['id']}_opening_{i}"))
    for b in blobs:
        if b["type"] == "fixture_candidate":
            continue
        fx = b["footprint"]["x"]; fz = b["footprint"]["z"]
        h = ceil_h if b["type"] != "fixture_candidate" else b["y"][1]
        parts.append(box([fx[1] - fx[0], h, fz[1] - fz[0]], [np.mean(fx), h / 2, np.mean(fz)], COLUMN, b["id"]))
        # 기둥 둘레 검은 띠·걸레받이
        for t, hh, nm in ((base / 2, base, "_baseboard"), (chair - 0.03, 0.06, "_chairrail")):
            parts.append(box([fx[1] - fx[0] + 0.012, hh, fz[1] - fz[0] + 0.012], [np.mean(fx), t, np.mean(fz)], BLACK, b["id"] + nm))

    scene = trimesh.Scene()
    for p in parts:
        scene.add_geometry(p, node_name=p.metadata["name"], geom_name=p.metadata["name"])
    out = C.MODELS_DIR / "reconstructed_room.glb"
    scene.export(out)
    print(f"[GLB] {out.relative_to(C.ROOT)} ({out.stat().st_size/1e6:.2f} MB, 파트 {len(parts)})")

    # ---------------- 평면도 그림
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(vc[:, 0], vc[:, 2], s=0.15, c="#999", alpha=0.5, label="scan vertical faces")
    for w in outer_walls:
        if w["axis"] == "x": ax.plot([w["offset"]] * 2, [w["from"], w["to"]], "k", lw=3)
        else: ax.plot([w["from"], w["to"]], [w["offset"]] * 2, "k", lw=3)
        for o in w["openings"]:
            if w["axis"] == "x": ax.plot([w["offset"]] * 2, [o["from"], o["to"]], c="tab:blue", lw=5)
            else: ax.plot([o["from"], o["to"]], [w["offset"]] * 2, c="tab:blue", lw=5)
    for b in blobs:
        fx, fz = b["footprint"]["x"], b["footprint"]["z"]
        col = {"wide_column": "tab:red", "thin_column": "tab:orange", "partition": "k", "fixture_candidate": "tab:green"}[b["type"]]
        ax.add_patch(plt.Rectangle((fx[0], fz[0]), fx[1] - fx[0], fz[1] - fz[0], fill=False, ec=col, lw=2))
        ax.text(np.mean(fx), np.mean(fz), b["id"], fontsize=6, ha="center", color=col)
    if central:
        fx, fz = central["footprint"]["x"], central["footprint"]["z"]
        ax.add_patch(plt.Rectangle((fx[0] - 0.1, fz[0] - 0.1), fx[1] - fx[0] + 0.2, fz[1] - fz[0] + 0.2, fill=False, ec="magenta", lw=2, ls="--"))
    ax.set_aspect("equal"); ax.invert_yaxis(); ax.grid(alpha=0.3)
    ax.set_title("Reconstruction footprint — black: wall, blue: opening?, red: wide column, orange: thin column, green: fixture")
    fig.savefig(C.SHOTS_DIR / "recon_footprint.png", dpi=110, bbox_inches="tight"); plt.close(fig)

    # ---------------- 메타데이터·보고
    meta.update({"ceiling_height_m": ceil_h, "chair_rail_height_m": chair, "chair_rail_status": "inferred" if not args.chair_rail else "observed",
                 "baseboard_height_m": base, "baseboard_status": "inferred" if not args.baseboard else "observed",
                 "wall_thickness_m": WALL_T, "room_bounds": room, "elements": elements,
                 "central_wide_column": central["id"] if central else None,
                 "central_wide_column_status": "inferred — 뷰어에서 클릭해 확인/변경 필요"})
    C.save_meta(meta)
    md = ["# 형상 가정·판정 기록 (Phase 3)", "",
          "| 항목 | 값 | 상태 | 비고 |", "|---|---|---|---|",
          f"| 천장고 | {ceil_h:.2f} m | {meta.get('ceiling_height_status','?')} | 수평면 피크 |",
          f"| 체어레일(검은 띠) 높이 | {chair:.2f} m | {meta['chair_rail_status']} | `--chair-rail` 로 사진 기준 보정 |",
          f"| 걸레받이 높이 | {base:.2f} m | {meta['baseboard_status']} | `--baseboard` |",
          f"| 외벽 두께 | {WALL_T} m | inferred | 복원용 임의값 |",
          f"| 중앙 넓은 기둥 | {central['id'] if central else '검출 실패'} | inferred | 뷰어 ‘기둥 선택’으로 확정 |", "",
          "## 검출 요소", "", "| id | 종류 | 상태 | 위치 |", "|---|---|---|---|",
          *[f"| {e['id']} | {e['type']} | {e['status']} | " + (f"{e['axis']}={e['offset']:.2f}, {e['from']:.2f}→{e['to']:.2f} (창/문 후보 {len(e['openings'])})" if e['type'] == 'wall'
             else f"x {e['footprint']['x'][0]:.2f}~{e['footprint']['x'][1]:.2f} · z {e['footprint']['z'][0]:.2f}~{e['footprint']['z'][1]:.2f} · h {e['y'][0]:.2f}~{e['y'][1]:.2f}") + " |" for e in elements],
          "", "## 사진과 다를 때 분류 기준", "",
          "- **구조 추정 오류**: 스캔에는 면이 있는데 평면 적합이 잘못 묶음 (예: 가구 상판을 벽으로) → `--min-plane-area`·격자 셀 조정, 또는 요소 수동 삭제",
          "- **LiDAR 누락/노이즈**: 유리·거울·검은 표면·가구 뒤는 스캔이 빈다 → `openings`/`fixture_candidate` 는 사진으로 채움",
          "- 창문·문은 **스캔 공백에서 추정**한 것이므로 사진으로 위치·크기 확정 전까지 `inferred`", ""]
    (C.REPORTS_DIR / "geometry_assumptions.md").write_text("\n".join(md), encoding="utf-8")
    print(f"[복원] 외벽 {len(outer_walls)} · 기둥 {len(cols)} · 중앙 기둥 후보 {central['id'] if central else '-'} · 보고 reports/geometry_assumptions.md")


if __name__ == "__main__":
    main()
