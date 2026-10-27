"""Phase 3 — 정돈된 건축 모델 (v2: L자 평면 대응).

방법
 1. 바닥 점유 격자(바닥면 삼각형, 0.1 m) → 실제 바닥 윤곽 (직사각형 가정 없음)
 2. 벽: 중간 높이(0.25~천장-0.12 m) 수직면을 축별 (오프셋 0.05 m × 길이 0.2 m) 면적 히스토그램으로 모아
    연속 구간 = 벽 선분. 비최대 억제로 중복 제거. 바닥이 있는 쪽이 안쪽(양쪽 모두 바닥이면 양면 벽).
 3. 기둥: 벽에서 떨어진 수직면 블롭(격자 0.1 m) 중 바닥~천장 높이인 것. 최대 변 ≥ 0.6 m → wide_column.
 4. 텍스처: 벽마다 전개도(길이×높이, 2 cm) 저장. 어두운 행 → 걸레받이·검은 띠 높이 **측정**.
    밝은 영역(0.9~2.0 m) → 창 후보. 벽 선분 사이 0.6~1.3 m 틈 → 문 후보.
출력: reconstructed_room.glb, geometry_metadata.json(elements·landmarks), reports/geometry_assumptions.md,
      screenshots/recon_footprint.png, screenshots/walls/<id>.png
사용: python3 scripts/reconstruct_room.py [--chair-rail H] [--baseboard H] [--central-column ID]
        [--landmark entrance=x,z] [--landmark kitchen=x,z] ...
"""
import argparse
import json
from pathlib import Path

import numpy as np
import trimesh
from scipy import ndimage

import common as C
import texsample as T
import bake_textures as B

WOOD = [142, 96, 60, 255]; GRAY = [181, 178, 173, 255]; BLACK = [28, 28, 28, 255]; CEIL = [236, 234, 228, 255]
TILE = [225, 228, 226, 255]; WALL_T = 0.10; CELL = 0.10


def pbr(color, name):
    return trimesh.visual.material.PBRMaterial(baseColorFactor=color, metallicFactor=0.0, roughnessFactor=0.9, name=name)


def box(extents, center, color, name):
    m = trimesh.creation.box(extents=extents); m.apply_translation(center)
    m.visual = trimesh.visual.TextureVisuals(material=pbr(color, name + "_mat")); m.metadata["name"] = name; return m


def grid_mesh(occ, origin, cell, y, color, name):
    """점유 격자(occ[i,j] → x=origin[0]+i*cell, z=origin[1]+j*cell) 를 하나의 평판 메쉬로."""
    cells = np.argwhere(occ)
    if len(cells) == 0:
        return None
    verts, faces = [], []
    for k, (i, j) in enumerate(cells):
        x0, z0 = origin[0] + i * cell, origin[1] + j * cell
        verts += [[x0, y, z0], [x0 + cell, y, z0], [x0 + cell, y, z0 + cell], [x0, y, z0 + cell]]
        b = 4 * k; faces += [[b, b + 2, b + 1], [b, b + 3, b + 2]]
    m = trimesh.Trimesh(np.array(verts), np.array(faces), process=False)
    m.merge_vertices()
    m.visual = trimesh.visual.TextureVisuals(material=pbr(color, name + "_mat")); m.metadata["name"] = name
    return m


def detect_segments(centers, areas, axis, min_area_cell=0.06, min_len=0.5):
    """축(axis)에 수직인 면들 → (offset, from, to, area) 선분 목록."""
    other = 2 - axis
    if len(centers) < 10:
        return []
    ob = 0.05; ab = 0.2
    o0, a0 = centers[:, axis].min() - ob, centers[:, other].min() - ab
    oi = ((centers[:, axis] - o0) / ob).astype(int); ai = ((centers[:, other] - a0) / ab).astype(int)
    H = np.zeros((oi.max() + 3, ai.max() + 3)); np.add.at(H, (oi, ai), areas)
    tot = H.sum(1); segs = []
    for o in range(1, len(tot) - 1):
        if tot[o] < 0.25 or tot[o] < tot[max(0, o - 2):o + 3].max():
            continue
        row = H[o - 1:o + 2].sum(0)
        on = row > min_area_cell
        # 1셀(0.2 m) 틈은 이어붙임
        on2 = on.copy()
        for k in range(1, len(on) - 1):
            if not on[k] and on[k - 1] and on[k + 1]:
                on2[k] = True
        k = 0
        while k < len(on2):
            if on2[k]:
                j = k
                while j < len(on2) and on2[j]:
                    j += 1
                fr, to = a0 + k * ab, a0 + j * ab
                if to - fr >= min_len:
                    inrun = (np.abs(oi - o) <= 1) & (centers[:, other] >= fr) & (centers[:, other] < to)
                    off = float(np.average(centers[inrun, axis], weights=areas[inrun])) if inrun.any() else o0 + (o + 0.5) * ob
                    # 끝점은 실제 점 범위로 다듬기
                    pts = centers[inrun, other]
                    segs.append({"axis": "x" if axis == 0 else "z", "offset": off, "from": float(np.percentile(pts, 0.5)) if len(pts) else fr,
                                 "to": float(np.percentile(pts, 99.5)) if len(pts) else to, "area": float(row[k:j].sum())})
                k = j
            else:
                k += 1
    # 비최대 억제
    segs.sort(key=lambda s: -s["area"]); keep = []
    for s in segs:
        dup = False
        for t in keep:
            if abs(s["offset"] - t["offset"]) < 0.15:
                ov = min(s["to"], t["to"]) - max(s["from"], t["from"])
                if ov > 0.5 * min(s["to"] - s["from"], t["to"] - t["from"]):
                    dup = True; break
        if not dup:
            keep.append(s)
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chair-rail", type=float); ap.add_argument("--baseboard", type=float)
    ap.add_argument("--central-column"); ap.add_argument("--landmark", action="append", default=[], help="name=x,z")
    ap.add_argument("--no-bake", action="store_true", help="스캔 텍스처 베이크 생략 (회색 박스만)")
    ap.add_argument("--no-window", action="append", default=None, help="이 벽에는 창이 없음(사진 확인) — 창 후보 제거·벽 메움. 반복 가능. 메타데이터에 기억됨")
    args = ap.parse_args()

    meta = C.load_meta()
    if "alignment_transform" not in meta:
        raise SystemExit("먼저 inspect_scan.py 를 실행하세요.")
    src = C.MODELS_DIR / "scan_cleaned.glb"
    if not src.exists():
        src = C.MODELS_DIR / "scan_original.glb"
    scan = trimesh.load(src, force="mesh", process=False)
    if isinstance(scan, trimesh.Scene):
        scan = trimesh.util.concatenate(list(scan.dump()))
    # 텍스처는 재인코딩 전 원본(scan_cleaned_raw.glb)의 것을 쓴다 — 평탄화본과 위상이 같으므로 UV 는 그대로 유효
    raw_p = C.MODELS_DIR / "scan_cleaned_raw.glb"
    if raw_p.exists() and src.name == "scan_cleaned.glb":
        raw = trimesh.load(raw_p, force="mesh", process=False)
        if isinstance(raw, trimesh.Scene):
            raw = trimesh.util.concatenate(list(raw.dump()))
        if len(raw.faces) == len(scan.faces) and getattr(raw.visual, "kind", None) == "texture":
            scan.visual.material = raw.visual.material
    ceil_h = meta.get("ceiling_height_m") or float(scan.bounds[1][1])
    n, c, a = scan.face_normals, scan.triangles_center, scan.area_faces
    bmin, bmax = scan.bounds

    # ---------------- 1. 바닥 점유 격자
    floor_f = (n[:, 1] > 0.9) & (c[:, 1] > -0.08) & (c[:, 1] < 0.12)
    origin = (float(bmin[0]) - CELL, float(bmin[2]) - CELL)
    gshape = (int((bmax[0] - bmin[0]) / CELL) + 3, int((bmax[2] - bmin[2]) / CELL) + 3)
    def to_grid(p):
        return ((p[:, 0] - origin[0]) / CELL).astype(int), ((p[:, 2] - origin[1]) / CELL).astype(int)
    occ = np.zeros(gshape); gx, gz = to_grid(c[floor_f]); np.add.at(occ, (gx, gz), a[floor_f])
    floor_occ = occ > 0.002
    floor_occ = ndimage.binary_closing(floor_occ, structure=np.ones((3, 3)), iterations=2)
    floor_occ = ndimage.binary_fill_holes(floor_occ)
    lab, nl = ndimage.label(floor_occ)
    sizes = ndimage.sum(floor_occ, lab, range(1, nl + 1))
    floor_occ = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s * CELL * CELL >= 1.0])
    floor_area = float(floor_occ.sum() * CELL * CELL)

    # ---------------- 2. 벽 선분
    vert = np.abs(n[:, 1]) < 0.25
    mid = vert & (c[:, 1] > 0.25) & (c[:, 1] < ceil_h - 0.12)
    segs = []
    for axis in (0, 2):
        sel = mid & (np.abs(n[:, axis]) > 0.9)
        segs += detect_segments(c[sel], a[sel], axis)

    def floor_side(s, side, d=0.35):
        """선분에서 side 방향으로 d 만큼 떨어진 선 위 바닥 셀 비율."""
        t = np.linspace(s["from"] + 0.1, s["to"] - 0.1, max(3, int((s["to"] - s["from"]) / 0.2)))
        if s["axis"] == "x":
            p = np.stack([np.full_like(t, s["offset"] + side * d), np.zeros_like(t), t], 1)
        else:
            p = np.stack([t, np.zeros_like(t), np.full_like(t, s["offset"] + side * d)], 1)
        gx, gz = to_grid(p); ok = (gx >= 0) & (gz >= 0) & (gx < gshape[0]) & (gz < gshape[1])
        return float(floor_occ[gx[ok], gz[ok]].mean()) if ok.any() else 0.0
    for s in segs:
        s["floor_pos"], s["floor_neg"] = floor_side(s, +1), floor_side(s, -1)

    # ---------------- 2b. 바닥 점유를 벽 경계까지 채움 (스캔이 비어 있는 바닥/천장 보완)
    scanned_floor = floor_occ.copy()
    barrier = np.zeros(gshape, bool)
    for s_ in segs:
        if s_["to"] - s_["from"] < 0.8: continue
        ax = 0 if s_["axis"] == "x" else 2
        t = np.arange(s_["from"] - 0.15, s_["to"] + 0.15, CELL / 2)
        p = np.stack([np.full_like(t, s_["offset"]), np.zeros_like(t), t], 1) if ax == 0 else np.stack([t, np.zeros_like(t), np.full_like(t, s_["offset"])], 1)
        gx_, gz_ = to_grid(p); ok = (gx_ >= 0) & (gz_ >= 0) & (gx_ < gshape[0]) & (gz_ < gshape[1]); barrier[gx_[ok], gz_[ok]] = True
    barrier = ndimage.binary_dilation(barrier, iterations=1)
    # 측지 팽창: 스캔된 바닥에서 벽(barrier)을 넘지 않고 최대 FILL_M 만큼만 번짐 → 벽 앞 미스캔 띠만 채우고 바깥으로는 안 나감
    FILL_M = 1.0
    fill = scanned_floor.copy()
    for _ in range(int(FILL_M / CELL)):
        fill = ndimage.binary_dilation(fill, structure=np.ones((3, 3))) & ~barrier | scanned_floor
    floor_occ = floor_occ | fill
    floor_occ = ndimage.binary_closing(floor_occ, structure=np.ones((3, 3)), iterations=1)
    floor_area_filled = float(floor_occ.sum() * CELL * CELL)
    print(f"[바닥 채움] 스캔 {floor_area:.1f} m² → 벽 경계까지 {floor_area_filled:.1f} m²")

    # ---------------- 3. 기둥 블롭 (벽 선분에서 0.15 m 이상 떨어진 수직면)
    mc = c[mid]
    near_wall = np.zeros(len(mc), bool)
    for s in segs:
        if s["to"] - s["from"] < 1.0:
            continue
        ax = 0 if s["axis"] == "x" else 2; other = 2 - ax
        near_wall |= (np.abs(mc[:, ax] - s["offset"]) < 0.15) & (mc[:, other] > s["from"] - 0.2) & (mc[:, other] < s["to"] + 0.2)
    ic = mc[~near_wall]
    g = np.zeros(gshape, int); gx, gz = to_grid(ic); np.add.at(g, (gx, gz), 1)
    lab, nl = ndimage.label(g >= 3, structure=np.ones((3, 3)))
    allv = c[vert]; agx, agz = to_grid(allv)
    blobs = []; extra_walls = []
    for k in range(1, nl + 1):
        cells = np.argwhere(lab == k)
        inb = lab[gx, gz] == k; pts = ic[inb]
        if len(pts) < 25:
            continue
        x0, x1 = np.percentile(pts[:, 0], [2, 98]); z0, z1 = np.percentile(pts[:, 2], [2, 98])
        # 높이는 블롭 셀 안의 모든 수직면 점으로
        inall = lab[np.clip(agx, 0, gshape[0] - 1), np.clip(agz, 0, gshape[1] - 1)] == k
        ys = allv[inall, 1]; y0, y1 = (float(ys.min()), float(ys.max())) if len(ys) else (0.0, 0.0)
        rx, rz = x1 - x0, z1 - z0
        fx, fz = max(rx, 0.15), max(rz, 0.15)
        cx_, cz_ = (x0 + x1) / 2, (z0 + z1) / 2
        gi, gj = int((cx_ - origin[0]) / CELL), int((cz_ - origin[1]) / CELL)
        on_floor = 0 <= gi < gshape[0] and 0 <= gj < gshape[1] and bool(ndimage.binary_dilation(floor_occ, iterations=1)[gi, gj])
        if not on_floor or min(rx, rz) < 0.12 or max(rx, rz) >= 2.0:
            continue                                   # 바닥 밖 파편 / 벽 조각 / 너무 큼 → 기둥 아님
        # 길고 얇은 블롭(≥1.2 m × ≤0.3 m) = 벽 선분 (알코브 앞면·뒷방 벽 등)
        if max(rx, rz) >= 1.2 and min(rx, rz) <= 0.4:
            if rx >= rz:
                extra_walls.append({"axis": "z", "offset": float(cz_), "from": float(x0), "to": float(x1), "area": 0.0, "from_blob": True})
            else:
                extra_walls.append({"axis": "x", "offset": float(cx_), "from": float(z0), "to": float(z1), "area": 0.0, "from_blob": True})
            continue
        # 블롭 안쪽(테두리 1셀 제외)에 스캔된 바닥이 있으면 기둥이 아니라 작은 실(세면실 등)
        i0, i1 = int((x0 - origin[0]) / CELL) + 1, int((x1 - origin[0]) / CELL); j0, j1 = int((z0 - origin[1]) / CELL) + 1, int((z1 - origin[1]) / CELL)
        inner = floor_occ[max(i0, 0):max(i1, i0), max(j0, 0):max(j1, j0)]
        inner_floor = float(inner.mean()) if inner.size else 0.0
        # 높이 연속성: 0.3~천장-0.3 을 0.2 m 구간으로 나눠 수직면이 있는 비율
        hb = np.arange(0.3, ceil_h - 0.3, 0.2); cov = np.mean([((ys >= h) & (ys < h + 0.2)).any() for h in hb]) if len(ys) else 0
        rec = {"footprint": {"x": [float(x0), float(x1)], "z": [float(z0), float(z1)]}, "y": [y0, y1], "support_points": int(len(pts)), "height_coverage": round(float(cov), 2), "inner_floor": round(inner_floor, 2)}
        if cov >= 0.8 and min(rx, rz) <= 0.2 and max(rx, rz) >= 0.6:
            kind, st = "door_panel", "observed"        # 얇고 넓은 판 = 문짝/파티션 (자동문 등)
        elif cov >= 0.8 and y0 < 0.3 and min(rx, rz) >= 0.5 and inner_floor > 0.25:
            kind, st = "enclosure", "measured"         # 속이 빈 큰 블롭 = 작은 실(세면실 등) 벽
        elif cov >= 0.8 and y0 < 0.3:
            kind, st = ("wide_column" if max(fx, fz) >= 0.6 else "thin_column"), "measured"
        else:
            kind, st = "fixture_candidate", "observed"  # 알코브 소핏·카운터·설비: 기둥 아님
        blobs.append({"id": f"{kind}_{k}", "type": kind, "status": st, **rec})
    # 기둥 박스와 겹치는 짧은 선분 제거
    def in_blob(s):
        for b in blobs:
            fx, fz = b["footprint"]["x"], b["footprint"]["z"]
            if s["axis"] == "x" and fx[0] - 0.15 < s["offset"] < fx[1] + 0.15 and s["from"] > fz[0] - 0.3 and s["to"] < fz[1] + 0.3: return True
            if s["axis"] == "z" and fz[0] - 0.15 < s["offset"] < fz[1] + 0.15 and s["from"] > fx[0] - 0.3 and s["to"] < fx[1] + 0.3: return True
        return False
    segs = [s for s in segs if not in_blob(s)]
    for ew in extra_walls:
        ew["floor_pos"], ew["floor_neg"] = floor_side(ew, +1), floor_side(ew, -1)
        if not any(e["axis"] == ew["axis"] and abs(e["offset"] - ew["offset"]) < 0.2 and min(e["to"], ew["to"]) - max(e["from"], ew["from"]) > 0.3 for e in segs):
            segs.append(ew)

    # ---------------- 4. 텍스처 전개도 → 띠 높이·창 후보
    wall_dir = C.SHOTS_DIR / "walls"; wall_dir.mkdir(exist_ok=True)
    dark_rows_acc = np.zeros(int(ceil_h / 0.02) + 1); dark_rows_n = np.zeros_like(dark_rows_acc)
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    walls = []
    for i, s in enumerate(segs):
        ax = 0 if s["axis"] == "x" else 2; other = 2 - ax
        sel = vert & (np.abs(c[:, ax] - s["offset"]) < 0.08) & (c[:, other] >= s["from"]) & (c[:, other] <= s["to"])
        idx = np.where(sel)[0]
        wid = f"wall_{s['axis']}_{i}"
        s.update({"id": wid, "type": "wall", "status": "measured" if not s.get("from_blob") else "observed", "length": s["to"] - s["from"]})
        # 안쪽: 바닥이 더 많은 쪽. 양쪽 모두 바닥이면 양면.
        if s["floor_pos"] > 0.5 and s["floor_neg"] > 0.5:
            s["inward"], s["two_sided"] = 1.0, True
        else:
            s["inward"], s["two_sided"] = (1.0 if s["floor_pos"] >= s["floor_neg"] else -1.0), False
        s["openings"] = []
        if len(idx) < 10:
            walls.append(s); continue
        pts, cols, _ = T.sample_faces(scan, idx, n_per_face=10)
        L = s["to"] - s["from"]; res = 0.02
        W, Hh = int(L / res) + 1, int(ceil_h / res) + 1
        img = np.zeros((Hh, W, 3), np.uint8); cnt = np.zeros((Hh, W), int)
        u = ((pts[:, other] - s["from"]) / res).astype(int); v = (pts[:, 1] / res).astype(int)
        ok = (u >= 0) & (u < W) & (v >= 0) & (v < Hh)
        if cols is not None:
            img[v[ok], u[ok]] = cols[ok]; cnt[v[ok], u[ok]] = 1
            lum = T.luminance(cols[ok]); vv, uu = v[ok], u[ok]
            # 어두운 행 비율
            dark = lum < 75
            for row in range(Hh):
                m = vv == row
                if m.sum() >= 20:
                    dark_rows_acc[row] += dark[m].mean() * m.sum(); dark_rows_n[row] += m.sum()
            # 창 후보: 0.25 m 구간별 0.9~2.0 m 영역 밝은 비율
            seg_w = 0.25; nseg = max(1, int(L / seg_w))
            bright_seg = []
            for k in range(nseg):
                m = (pts[ok][:, other] >= s["from"] + k * seg_w) & (pts[ok][:, other] < s["from"] + (k + 1) * seg_w) & (pts[ok][:, 1] > 0.95) & (pts[ok][:, 1] < 2.0)
                bright_seg.append(float((lum[m] > 165).mean()) if m.sum() > 15 else -1.0)
            run = []
            for k, b in enumerate(bright_seg + [-1.0]):
                if b > 0.55 and L >= 2.5:
                    run.append(k)
                else:
                    if len(run) >= 2:
                        s["openings"].append({"kind": "window", "from": s["from"] + run[0] * seg_w, "to": s["from"] + (run[-1] + 1) * seg_w,
                                              "y": [0.95, 2.0], "status": "observed", "note": "텍스처 밝은 영역(유리/창) — 사진으로 확인"})
                    run = []
        # 형상 공백 기반 창 검출 (유리 = LiDAR 누락): 0.25 m 구간별 1.05~1.85 m 띠에서 빈 셀 비율
        if L >= 1.5:
            r0, r1 = int(1.05 / res), int(1.85 / res); seg_w = 0.25; nseg = max(1, int(L / seg_w)); cw = int(seg_w / res)
            empty = []
            for k in range(nseg):
                blk = cnt[r0:r1, k * cw:(k + 1) * cw]
                below = cnt[int(0.3 / res):int(0.85 / res), k * cw:(k + 1) * cw]
                empty.append(blk.size > 0 and blk.mean() < 0.22 and below.mean() > 0.08)   # 위는 비고 아래 허리벽은 있음
            run = []
            for k, e in enumerate(empty + [False]):
                if e: run.append(k)
                else:
                    if len(run) >= 2:
                        f_, t_ = s["from"] + run[0] * seg_w, s["from"] + (run[-1] + 1) * seg_w
                        # 창 상하단: 공백 열들의 빈 행 범위
                        col = cnt[:, int(run[0] * cw):int((run[-1] + 1) * cw)].mean(1); rows = np.where(col < 0.06)[0]
                        rows = rows[(rows * res > 0.6) & (rows * res < ceil_h - 0.2)]
                        y0_, y1_ = (float(rows.min() * res), float(rows.max() * res + res)) if len(rows) else (1.0, 1.9)
                        if not any(o["kind"] == "window" and min(o["to"], t_) - max(o["from"], f_) > 0.2 for o in s["openings"]):
                            s["openings"].append({"kind": "window", "from": f_, "to": t_, "y": [y0_, y1_], "status": "measured(gap)", "note": "전개도 형상 공백(유리) — 창. 상하단은 공백 행 범위"})
                    run = []
        fig, axp = plt.subplots(figsize=(max(4, L * 1.2), ceil_h * 1.2))
        axp.imshow(img, origin="lower", extent=[s["from"], s["to"], 0, ceil_h], aspect="equal")
        for o in s["openings"]:
            axp.add_patch(plt.Rectangle((o["from"], o["y"][0]), o["to"] - o["from"], o["y"][1] - o["y"][0], fill=False, ec="cyan", lw=2))
        axp.set_title(f"{wid}  {s['axis']}={s['offset']:.2f}  L={L:.2f} m  inward={s['inward']:+.0f}{' two-sided' if s['two_sided'] else ''}")
        axp.set_xlabel("along [m]"); axp.set_ylabel("y [m]")
        fig.savefig(wall_dir / f"{wid}.png", dpi=100, bbox_inches="tight"); plt.close(fig)
        walls.append(s)
    # 띠·걸레받이 높이 (어두운 행 비율 프로파일)
    prof = np.where(dark_rows_n > 0, dark_rows_acc / np.maximum(dark_rows_n, 1), 0)
    ys = np.arange(len(prof)) * 0.02
    def band(lo, hi, floor_band=False):
        m = (ys >= lo) & (ys <= hi)
        if not m.any() or prof[m].max() < 0.35: return None
        pk = int(np.where(m)[0][np.argmax(prof[m])]); half = 0.5 * prof[pk]
        i0 = pk
        while i0 - 1 >= 0 and prof[i0 - 1] > half: i0 -= 1
        i1 = pk
        while i1 + 1 < len(prof) and prof[i1 + 1] > half: i1 += 1
        return float(ys[i0]) if not floor_band else 0.0, float(ys[i1] + 0.02)
    bb = band(0.0, 0.3, floor_band=True); cr = band(0.5, 1.4)
    base = args.baseboard or (bb[1] if bb else meta.get("baseboard_height_m") or 0.10)
    # 띠: 샘플링 번짐으로 반치폭이 과대해질 수 있어 두께는 0.08 m 로 상한, 중심은 유지
    if cr:
        cc = (cr[0] + cr[1]) / 2; chair_thick = min(cr[1] - cr[0], 0.08); chair_top = cc + chair_thick / 2
    else:
        chair_thick, chair_top = 0.06, meta.get("chair_rail_height_m") or 0.95
    chair = args.chair_rail or chair_top
    fig, axp = plt.subplots(figsize=(7, 3)); axp.plot(ys, prof); axp.axhline(0.45, color="r", ls="--")
    axp.set_xlabel("y [m]"); axp.set_ylabel("dark fraction"); axp.set_title(f"baseboard {bb}  chair-rail {cr}")
    fig.savefig(C.SHOTS_DIR / "wall_dark_profile.png", dpi=110, bbox_inches="tight"); plt.close(fig)

    # 문 후보: 같은 축·오프셋 벽 사이 0.6~1.3 m 틈
    doors = []
    for i, w1 in enumerate(walls):
        for w2 in walls[i + 1:]:
            if w1["axis"] != w2["axis"] or abs(w1["offset"] - w2["offset"]) > 0.15: continue
            gap_lo, gap_hi = (w1["to"], w2["from"]) if w1["to"] < w2["from"] else (w2["to"], w1["from"])
            if 0.6 <= gap_hi - gap_lo <= 2.2:
                ax = 0 if w1["axis"] == "x" else 2; other = 2 - ax
                ing = vert & (np.abs(c[:, ax] - w1["offset"]) < 0.1) & (c[:, other] > gap_lo) & (c[:, other] < gap_hi)
                low = float(a[ing & (c[:, 1] > 0.2) & (c[:, 1] < 0.85)].sum())
                if low > 0.15 * (gap_hi - gap_lo):   # 틈 아래에 허리벽이 있다 → 창
                    d = {"kind": "window", "from": float(gap_lo), "to": float(gap_hi), "y": [0.95, 2.0], "status": "inferred", "note": "벽 선분 틈 + 하부 허리벽 있음 → 창(유리는 LiDAR 누락)"}
                    w1["openings"].append(d)
                    # 벽 자체도 틈을 메워 연속되게 (허리벽 복원)
                    w1["bridge"] = w1.get("bridge", []) + [(float(gap_lo), float(gap_hi))]
                else:
                    d = {"kind": "door", "from": float(gap_lo), "to": float(gap_hi), "y": [0.0, 2.0], "status": "inferred", "note": "벽 선분 사이 틈 — 문/통로 후보"}
                    w1["openings"].append(d); doors.append((w1, d))

    # 벽 끝을 직교 벽까지 연장 (모서리 틈 제거): 끝에서 0.45 m 안에 직교 벽 평면이 있으면 그 오프셋(+두께)까지
    for w in walls:
        ax = "x" if w["axis"] == "x" else "z"
        for end in ("from", "to"):
            best = None
            for o in walls:
                if o["axis"] == w["axis"]: continue
                # o 의 구간이 w 의 오프셋을 포함해야 실제로 만나는 벽
                if not (o["from"] - 0.3 <= w["offset"] <= o["to"] + 0.3): continue
                d = (o["offset"] - w[end]) if end == "to" else (w[end] - o["offset"])
                if -0.12 <= d <= 0.45 and (best is None or d < best[0]): best = (d, o)
            if best:
                o = best[1]
                # 직교 벽의 바깥면(안쪽 반대 방향으로 두께만큼)까지 → 모서리에서 박스가 겹친다
                target = o["offset"] + (-o["inward"] * WALL_T if not o["two_sided"] else 0)
                if end == "to" and target > w["to"]: w["to"] = float(target)
                if end == "from" and target < w["from"]: w["from"] = float(target)
        w["length"] = w["to"] - w["from"]

    # 사진으로 확인한 창(window_overrides) — 같은 축·오프셋(±0.15 m)의 벽에서 검출 창을 대체
    for ov in meta.get("window_overrides", []):
        for w in walls:
            if w["axis"] == ov["axis"] and abs(w["offset"] - ov["offset"]) < 0.15:
                w["openings"] = [o for o in w["openings"] if o["kind"] != "window"] + [dict(o) for o in ov["windows"]]
                w["bridge"] = []

    # 창 없는 벽 (사용자 확인) — 메타데이터에 기억
    no_win = set(args.no_window if args.no_window is not None else meta.get("no_window_walls", []))
    for w in walls:
        if w["id"] in no_win:
            gaps = [(o["from"], o["to"]) for o in w["openings"] if o["kind"] == "window" and o.get("status") == "inferred"]
            w["openings"] = [o for o in w["openings"] if o["kind"] != "window"]
            w["bridge"] = []; w["solid_bridge"] = gaps        # 틈을 전체 높이 벽으로
            w["no_window"] = True
    meta["no_window_walls"] = sorted(no_win)

    # 중앙 넓은 기둥
    fcx = origin[0] + np.argwhere(floor_occ)[:, 0].mean() * CELL; fcz = origin[1] + np.argwhere(floor_occ)[:, 1].mean() * CELL
    cols = [b for b in blobs if b["type"] in ("wide_column", "thin_column")]
    central = None
    if args.central_column:
        central = next((b for b in blobs if b["id"] == args.central_column), None)
    elif cols:
        wide = [b for b in cols if b["type"] == "wide_column"] or cols
        central = min(wide, key=lambda b: (np.mean(b["footprint"]["x"]) - fcx) ** 2 + (np.mean(b["footprint"]["z"]) - fcz) ** 2)

    # 랜드마크 (기본: 추정, --landmark 로 덮어씀)
    landmarks = dict(meta.get("landmarks", {}))
    for lm in args.landmark:
        k, v = lm.split("="); x, z = map(float, v.split(",")); landmarks[k] = {"x": x, "z": z, "status": "user"}
    if doors and "entrance" not in landmarks:
        # 방 중심에서 가장 먼 문 후보 = 입구 추정
        w, d = max(doors, key=lambda wd: ((wd[0]["offset"] if wd[0]["axis"] == "x" else (wd[1]["from"] + wd[1]["to"]) / 2) - fcx) ** 2 + (((wd[1]["from"] + wd[1]["to"]) / 2 if wd[0]["axis"] == "x" else wd[0]["offset"]) - fcz) ** 2)
        t = (d["from"] + d["to"]) / 2
        landmarks["entrance"] = {"x": w["offset"] if w["axis"] == "x" else t, "z": t if w["axis"] == "x" else w["offset"], "status": "inferred"}

    # ---------------- 메쉬
    parts = []
    fm = grid_mesh(floor_occ, origin, CELL, -0.005, WOOD, "floor"); parts.append(fm)
    cm = grid_mesh(floor_occ, origin, CELL, ceil_h + 0.005, CEIL, "ceiling"); parts.append(cm)
    for w in walls:
        L = w["length"]; mid_t = (w["to"] + w["from"]) / 2
        off_c = w["offset"] - w["inward"] * WALL_T / 2 if not w["two_sided"] else w["offset"]
        if w["axis"] == "x":
            parts.append(box([WALL_T, ceil_h, L], [off_c, ceil_h / 2, mid_t], GRAY, w["id"]))
        else:
            parts.append(box([L, ceil_h, WALL_T], [mid_t, ceil_h / 2, off_c], GRAY, w["id"]))
        sides = [w["inward"], -w["inward"]] if w["two_sided"] else [w["inward"]]
        for sd in sides:
            o = w["offset"] + sd * (0.006 if not w["two_sided"] else WALL_T / 2 + 0.006)
            def face(h, t, nm):
                return box([0.012, h, L], [o, t, mid_t], BLACK, nm) if w["axis"] == "x" else box([L, h, 0.012], [mid_t, t, o], BLACK, nm)
            parts.append(face(base, base / 2, f"{w['id']}_baseboard{'' if sd == w['inward'] else '_b'}"))
            parts.append(face(chair_thick, chair - chair_thick / 2, f"{w['id']}_chairrail{'' if sd == w['inward'] else '_b'}"))
        for i, op in enumerate(w["openings"]):
            if op["kind"] != "window": continue
            ol = op["to"] - op["from"]; om = (op["to"] + op["from"]) / 2; oh = op["y"][1] - op["y"][0]; oy = (op["y"][1] + op["y"][0]) / 2
            ext = [0.03, oh, ol] if w["axis"] == "x" else [ol, oh, 0.03]
            ctr = [w["offset"] + w["inward"] * 0.02, oy, om] if w["axis"] == "x" else [om, oy, w["offset"] + w["inward"] * 0.02]
            parts.append(box(ext, ctr, [190, 215, 235, 140], f"{w['id']}_window_{i}"))
    for w in walls:
        for (g0, g1) in w.get("solid_bridge", []):
            gl, gm = g1 - g0, (g0 + g1) / 2; off_c = w["offset"] - w["inward"] * WALL_T / 2
            ext = [WALL_T, ceil_h, gl] if w["axis"] == "x" else [gl, ceil_h, WALL_T]; ctr = [off_c, ceil_h / 2, gm] if w["axis"] == "x" else [gm, ceil_h / 2, off_c]
            parts.append(box(ext, ctr, GRAY, f"{w['id']}_fill"))
        for (g0, g1) in w.get("bridge", []):
            gl, gm = g1 - g0, (g0 + g1) / 2; off_c = w["offset"] - w["inward"] * WALL_T / 2
            ext = [WALL_T, 0.95, gl] if w["axis"] == "x" else [gl, 0.95, WALL_T]
            ctr = [off_c, 0.475, gm] if w["axis"] == "x" else [gm, 0.475, off_c]
            parts.append(box(ext, ctr, GRAY, f"{w['id']}_sill"))
            ext2 = [WALL_T, ceil_h - 2.0, gl] if w["axis"] == "x" else [gl, ceil_h - 2.0, WALL_T]
            ctr2 = [off_c, (ceil_h + 2.0) / 2, gm] if w["axis"] == "x" else [gm, (ceil_h + 2.0) / 2, off_c]
            parts.append(box(ext2, ctr2, GRAY, f"{w['id']}_lintel"))
    for b in blobs:
        fx, fz = b["footprint"]["x"], b["footprint"]["z"]
        if b["type"] == "door_panel":
            parts.append(box([fx[1] - fx[0], 2.0, fz[1] - fz[0]], [np.mean(fx), 1.0, np.mean(fz)], [70, 50, 40, 170], b["id"]))
            continue
        if b["type"] == "fixture_candidate":
            parts.append(box([fx[1] - fx[0], b["y"][1] - max(b["y"][0], 0), fz[1] - fz[0]], [np.mean(fx), (b["y"][1] + max(b["y"][0], 0)) / 2, np.mean(fz)], [200, 190, 170, 120], b["id"]))
            continue
        if b["type"] == "enclosure":
            t = WALL_T
            for ext, ctr, nm in (([t, ceil_h, fz[1] - fz[0]], [fx[0] + t / 2, ceil_h / 2, np.mean(fz)], "_w0"), ([t, ceil_h, fz[1] - fz[0]], [fx[1] - t / 2, ceil_h / 2, np.mean(fz)], "_w1"),
                                 ([fx[1] - fx[0], ceil_h, t], [np.mean(fx), ceil_h / 2, fz[0] + t / 2], "_w2"), ([fx[1] - fx[0], ceil_h, t], [np.mean(fx), ceil_h / 2, fz[1] - t / 2], "_w3")):
                parts.append(box(ext, ctr, GRAY, b["id"] + nm))
            continue
        parts.append(box([fx[1] - fx[0], ceil_h, fz[1] - fz[0]], [np.mean(fx), ceil_h / 2, np.mean(fz)], GRAY, b["id"]))
        for t, hh, nm in ((base / 2, base, "_baseboard"), (chair - chair_thick / 2, chair_thick, "_chairrail")):
            parts.append(box([fx[1] - fx[0] + 0.012, hh, fz[1] - fz[0] + 0.012], [np.mean(fx), t, np.mean(fz)], BLACK, b["id"] + nm))
    # ---------------- 스캔 텍스처 베이크 (벽면·기둥면·바닥·천장) → 실제 모습
    if not args.no_bake:
        tex_parts = []
        for w in walls:
            ax = 0 if w["axis"] == "x" else 2
            sides = [w["inward"], -w["inward"]] if w["two_sided"] else [w["inward"]]
            for sd in sides:
                q = B.bake_vertical(scan, ax, w["offset"], w["from"], w["to"], sd, ceil_h, f"{w['id']}_tex{'' if sd == w['inward'] else '_b'}", w["openings"])
                if q is not None: tex_parts.append(q)
        for b in blobs:
            if b["type"] not in ("wide_column", "thin_column", "enclosure"):
                continue
            fx, fz = b["footprint"]["x"], b["footprint"]["z"]
            for ax, (lo, hi), (olo, ohi) in ((0, fx, fz), (2, fz, fx)):
                for val, sd in ((lo, -1), (hi, 1)):
                    q = B.bake_vertical(scan, ax, val, olo, ohi, sd, ceil_h, f"{b['id']}_tex_{ax}{'p' if sd > 0 else 'n'}")
                    if q is not None: tex_parts.append(q)
        fq = B.bake_horizontal(scan, 0.0, +1, floor_occ, origin, CELL, "floor_tex")
        cq = B.bake_horizontal(scan, ceil_h, -1, floor_occ, origin, CELL, "ceiling_tex")
        tex_parts += [q for q in (fq, cq) if q is not None]
        parts += tex_parts
        print(f"[텍스처] 베이크 {len(tex_parts)} 면")
    scene = trimesh.Scene()
    for p in parts:
        if p is not None:
            scene.add_geometry(p, node_name=p.metadata["name"], geom_name=p.metadata["name"])
    out = C.MODELS_DIR / "reconstructed_room.glb"; scene.export(out)
    print(f"[GLB] {out.relative_to(C.ROOT)} ({out.stat().st_size/1e6:.2f} MB, 파트 {len(parts)})")

    # ---------------- 평면도
    fig, axp = plt.subplots(figsize=(9, 9))
    fx_, fz_ = np.argwhere(floor_occ).T
    axp.scatter(origin[0] + fx_ * CELL + CELL / 2, origin[1] + fz_ * CELL + CELL / 2, s=4, c="#e8d3b0", marker="s", label="floor")
    axp.scatter(mc[:, 0], mc[:, 2], s=0.15, c="#888", alpha=0.5)
    for w in walls:
        if w["axis"] == "x": axp.plot([w["offset"]] * 2, [w["from"], w["to"]], "k", lw=3)
        else: axp.plot([w["from"], w["to"]], [w["offset"]] * 2, "k", lw=3)
        for o in w["openings"]:
            col = "tab:blue" if o["kind"] == "window" else "tab:green"
            if w["axis"] == "x": axp.plot([w["offset"]] * 2, [o["from"], o["to"]], c=col, lw=6, alpha=0.8)
            else: axp.plot([o["from"], o["to"]], [w["offset"]] * 2, c=col, lw=6, alpha=0.8)
    for b in blobs:
        fx, fz = b["footprint"]["x"], b["footprint"]["z"]; col = {"wide_column": "tab:red", "thin_column": "tab:orange", "enclosure": "tab:purple", "fixture_candidate": "tab:green", "door_panel": "tab:brown"}[b["type"]]
        axp.add_patch(plt.Rectangle((fx[0], fz[0]), fx[1] - fx[0], fz[1] - fz[0], fill=True, fc=col, alpha=0.6, ec=col))
        axp.text(np.mean(fx), np.mean(fz) - 0.25, b["id"], fontsize=7, ha="center", color=col)
    if central:
        fx, fz = central["footprint"]["x"], central["footprint"]["z"]
        axp.add_patch(plt.Rectangle((fx[0] - 0.12, fz[0] - 0.12), fx[1] - fx[0] + 0.24, fz[1] - fz[0] + 0.24, fill=False, ec="magenta", lw=2, ls="--"))
    for k, v in landmarks.items():
        axp.plot(v["x"], v["z"], "m*", ms=12); axp.text(v["x"] + 0.1, v["z"], f"{k} ({v['status']})", color="m", fontsize=8)
    axp.set_aspect("equal"); axp.invert_yaxis(); axp.grid(alpha=0.3); axp.set_xlabel("x [m]"); axp.set_ylabel("z [m]")
    axp.set_title("Reconstruction — black: wall, blue: window(texture), green: door(gap), red: wide column, orange: thin column, purple: enclosure, green: fixture")
    fig.savefig(C.SHOTS_DIR / "recon_footprint.png", dpi=110, bbox_inches="tight"); plt.close(fig)

    # ---------------- 메타·보고
    elements = walls + blobs
    meta.update({"ceiling_height_m": ceil_h, "chair_rail_height_m": round(chair, 3), "chair_rail_thickness_m": round(chair_thick, 3),
                 "chair_rail_status": "observed" if args.chair_rail else ("measured(texture)" if cr else "inferred"),
                 "baseboard_height_m": round(base, 3), "baseboard_status": "observed" if args.baseboard else ("measured(texture)" if bb else "inferred"),
                 "wall_thickness_m": WALL_T, "floor_area_m2": round(floor_area, 2), "elements": elements, "landmarks": landmarks,
                 "central_wide_column": central["id"] if central else None,
                 "central_wide_column_status": "inferred — 뷰어에서 클릭해 확인/변경 필요"})
    C.save_meta(meta)
    md = ["# 형상 가정·판정 기록 (Phase 3)", "", "| 항목 | 값 | 상태 | 비고 |", "|---|---|---|---|",
          f"| 천장고 | {ceil_h:.2f} m | {meta.get('ceiling_height_status','?')} | 수평면 피크 |",
          f"| 바닥 면적(스캔 점유) | {floor_area:.1f} m² | measured | 0.1 m 격자 |",
          f"| 걸레받이 높이 | {base:.2f} m | {meta['baseboard_status']} | 텍스처 어두운 행 {bb} |",
          f"| 검은 띠 | 윗면 {chair:.2f} m · 두께 {chair_thick:.2f} m | {meta['chair_rail_status']} | 텍스처 어두운 행 {cr} |",
          f"| 중앙 넓은 기둥 | {central['id'] if central else '검출 실패'} | inferred | 뷰어 ‘기둥 선택’으로 확정 |", "",
          "## 벽 선분", "", "| id | 축=오프셋 | 구간 | 길이 | 안쪽 | 개구부 |", "|---|---|---|---|---|---|",
          *[f"| {w['id']} | {w['axis']}={w['offset']:.2f} | {w['from']:.2f}→{w['to']:.2f} | {w['length']:.2f} | {'양면' if w['two_sided'] else ('+' if w['inward']>0 else '−')} | "
            + ", ".join(f"{o['kind']} {o['from']:.2f}~{o['to']:.2f}" for o in w['openings']) + " |" for w in walls],
          "", "## 기둥", "", "| id | 종류 | 평면 | 높이 |", "|---|---|---|---|",
          *[f"| {b['id']} | {b['type']} | x {b['footprint']['x'][0]:.2f}~{b['footprint']['x'][1]:.2f} ({b['footprint']['x'][1]-b['footprint']['x'][0]:.2f}) · z {b['footprint']['z'][0]:.2f}~{b['footprint']['z'][1]:.2f} ({b['footprint']['z'][1]-b['footprint']['z'][0]:.2f}) | {b['y'][0]:.2f}~{b['y'][1]:.2f} |" for b in blobs],
          "", "## 랜드마크", "", *[f"- {k}: ({v['x']:.2f}, {v['z']:.2f}) [{v['status']}]" for k, v in landmarks.items()], "",
          "## 사진과 다를 때", "", "- 구조 추정 오류: 벽 선분이 가구/설비를 벽으로 묶음 → `screenshots/walls/<id>.png` 전개도로 확인 후 제외",
          "- LiDAR 누락: 유리·거울은 텍스처는 있어도 형상이 빌 수 있음 → 창은 `observed`, 문은 `inferred`", ""]
    (C.REPORTS_DIR / "geometry_assumptions.md").write_text("\n".join(md), encoding="utf-8")
    print(f"[복원] 벽 {len(walls)} · 기둥 {len(blobs)} ({[b['id'] for b in blobs]}) · 띠 {chair:.2f}/{chair_thick:.2f} · 걸레받이 {base:.2f} · 중앙 {central['id'] if central else '-'} · 랜드마크 {list(landmarks)}")


if __name__ == "__main__":
    main()
