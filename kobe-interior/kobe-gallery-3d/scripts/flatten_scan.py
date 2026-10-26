"""Phase 2b — 스캔 평탄화. 정리된 스캔의 정점을 복원된 평면(바닥·천장·벽·기둥 면)에 스냅해
벽/바닥/기둥을 매끈하게 만든다. 텍스처·UV 는 그대로 (실제 모습 유지). 평면에서 먼 점(설비·가구)은 손대지 않는다.

사용: python3 scripts/flatten_scan.py [--tol 0.07] [--smooth 2]
입력: assets/models/scan_cleaned.glb (clean_scan.py 결과) + src/geometry_metadata.json (reconstruct_room.py 결과)
출력: assets/models/scan_cleaned.glb 를 평탄화본으로 교체, 원본 정리본은 scan_cleaned_raw.glb 로 보관
"""
import argparse, shutil
import numpy as np
import trimesh
import common as C


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tol", type=float, default=0.07, help="평면에서 이 거리(m) 안의 정점만 스냅")
    ap.add_argument("--smooth", type=int, default=2, help="스냅 후 비스냅 정점 라플라시안 완화 반복 횟수 (0=안 함)")
    args = ap.parse_args()
    meta = C.load_meta()
    if "elements" not in meta:
        raise SystemExit("먼저 reconstruct_room.py 를 실행하세요 (벽/기둥 평면 필요).")
    src = C.MODELS_DIR / "scan_cleaned.glb"; raw = C.MODELS_DIR / "scan_cleaned_raw.glb"
    if not raw.exists():
        shutil.copy(src, raw)
    mesh = trimesh.load(raw, force="mesh", process=False)
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(list(mesh.dump()))
    V = mesh.vertices.copy(); n_v = len(V)
    ceil_h = meta["ceiling_height_m"]
    vn = mesh.vertex_normals

    # 평면 목록: (axis, offset, 범위 조건 함수, 법선 요구)
    snapped = np.zeros(n_v, bool); counts = {}
    def snap(mask, axis, value, name):
        m = mask & ~snapped
        V[m, axis] = value; snapped[m] = True; counts[name] = counts.get(name, 0) + int(m.sum())

    # 바닥 / 천장 (법선이 수직에 가까운 정점만)
    snap((np.abs(V[:, 1]) < args.tol) & (np.abs(vn[:, 1]) > 0.6), 1, 0.0, "floor")
    snap((np.abs(V[:, 1] - ceil_h) < args.tol + 0.03) & (np.abs(vn[:, 1]) > 0.6), 1, ceil_h, "ceiling")
    # 벽
    for e in meta["elements"]:
        if e["type"] == "wall":
            ax = 0 if e["axis"] == "x" else 2; other = 2 - ax
            m = (np.abs(V[:, ax] - e["offset"]) < args.tol) & (V[:, other] > e["from"] - 0.1) & (V[:, other] < e["to"] + 0.1) \
                & (V[:, 1] > -0.05) & (V[:, 1] < ceil_h + 0.05) & (np.abs(vn[:, ax]) > 0.5)
            snap(m, ax, e["offset"], "wall")
        elif e["type"] in ("wide_column", "thin_column", "enclosure", "door_panel"):
            fx, fz = e["footprint"]["x"], e["footprint"]["z"]
            for ax, (lo, hi), (olo, ohi) in ((0, fx, fz), (2, fz, fx)):
                other = 2 - ax
                for val in (lo, hi):
                    m = (np.abs(V[:, ax] - val) < args.tol) & (V[:, other] > olo - 0.08) & (V[:, other] < ohi + 0.08) & (np.abs(vn[:, ax]) > 0.5)
                    snap(m, ax, val, e["type"])
    mesh.vertices = V
    # 스냅되지 않은 정점(설비·창틀 주변·찢어진 가장자리)은 이웃 평균으로 살짝 완화 — 스냅 정점은 고정
    if args.smooth > 0:
        adj = mesh.vertex_neighbors
        free = np.where(~snapped)[0]
        for _ in range(args.smooth):
            Vn = mesh.vertices.copy()
            for i in free:
                nb = adj[i]
                if len(nb) >= 3:
                    Vn[i] = 0.5 * mesh.vertices[i] + 0.5 * mesh.vertices[nb].mean(0)
            mesh.vertices = Vn
    C.export_glb(mesh, "scan_cleaned.glb")
    meta["flatten"] = {"tol": args.tol, "smooth": args.smooth, "snapped": counts, "vertices": n_v, "snapped_ratio": round(float(snapped.mean()), 3)}
    C.save_meta(meta)
    print(f"[평탄화] 정점 {n_v:,} 중 {snapped.sum():,} 스냅 ({snapped.mean()*100:.0f}%) · {counts}")


if __name__ == "__main__":
    main()
