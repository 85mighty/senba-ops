"""Phase 1 — 원본 검증·좌표 정렬.

사용: python3 scripts/inspect_scan.py [--input 경로] [--no-align]
출력: reports/scan_analysis.md, screenshots/diag_*.png,
      assets/models/scan_original.glb (형상 무수정, 정렬 변환만 적용, 텍스처 유지),
      src/geometry_metadata.json (bounds·단위·바닥/천장·정렬 변환)
"""
import argparse
import datetime as dt

import numpy as np
import trimesh

import common as C


def diag_images(mesh: trimesh.Trimesh, info: dict) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    v = mesh.vertices
    files = []
    # 1) 평면도(위에서) — 높이로 색
    fig, ax = plt.subplots(figsize=(8, 8))
    idx = np.random.default_rng(0).choice(len(v), min(len(v), 150_000), replace=False)
    sc = ax.scatter(v[idx, 0], v[idx, 2], c=v[idx, 1], s=0.3, cmap="viridis")
    ax.set_aspect("equal"); ax.invert_yaxis(); ax.set_title("Top view (color = height m)")
    ax.set_xlabel("x [m]"); ax.set_ylabel("z [m]"); fig.colorbar(sc, ax=ax, shrink=0.7)
    f = C.SHOTS_DIR / "diag_top_height.png"; fig.savefig(f, dpi=110); plt.close(fig); files.append(f.name)
    # 2) 높이 히스토그램 — 바닥/천장 피크
    fig, ax = plt.subplots(figsize=(8, 3.5))
    ax.hist(v[:, 1], bins=200, color="#555")
    ax.axvline(0, color="tab:green", label="floor (y=0)")
    if info.get("ceiling_height_m"):
        ax.axvline(info["ceiling_height_m"], color="tab:red", label=f"ceiling ≈ {info['ceiling_height_m']:.2f} m")
    ax.legend(); ax.set_xlabel("y [m]"); ax.set_title("Vertex height histogram")
    f = C.SHOTS_DIR / "diag_height_hist.png"; fig.savefig(f, dpi=110, bbox_inches="tight"); plt.close(fig); files.append(f.name)
    # 3) 벽 후보 — 수직면 삼각형 중심의 평면 분포 (기둥·벽 위치 확인용)
    n = mesh.face_normals; c = mesh.triangles_center
    vert = np.abs(n[:, 1]) < 0.2
    fig, ax = plt.subplots(figsize=(8, 8))
    ax.scatter(c[vert, 0], c[vert, 2], s=0.2, c="k", alpha=0.4)
    ax.set_aspect("equal"); ax.invert_yaxis(); ax.set_title("Vertical faces footprint (walls / columns)")
    ax.set_xlabel("x [m]"); ax.set_ylabel("z [m]"); ax.grid(alpha=0.3)
    f = C.SHOTS_DIR / "diag_vertical_footprint.png"; fig.savefig(f, dpi=110); plt.close(fig); files.append(f.name)
    # 4) 측면 (x-y, z-y)
    fig, axs = plt.subplots(1, 2, figsize=(12, 4))
    axs[0].scatter(v[idx, 0], v[idx, 1], s=0.2, c="k", alpha=0.3); axs[0].set_title("Side view X-Y"); axs[0].set_aspect("equal")
    axs[1].scatter(v[idx, 2], v[idx, 1], s=0.2, c="k", alpha=0.3); axs[1].set_title("Side view Z-Y"); axs[1].set_aspect("equal")
    f = C.SHOTS_DIR / "diag_side_views.png"; fig.savefig(f, dpi=110, bbox_inches="tight"); plt.close(fig); files.append(f.name)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="Scaniverse ZIP / OBJ / GLB 경로 (기본: assets/original 자동 탐색)")
    ap.add_argument("--no-align", action="store_true", help="정렬 변환 없이 원좌표 그대로")
    args = ap.parse_args()

    src = C.find_input(args.input)
    print(f"[입력] {src}")
    raw = C.load_mesh(src)
    has_tex = raw.visual.kind == "texture"
    raw_bounds = raw.bounds.copy()
    raw_extent = raw.extents.copy()
    print(f"[원본] 정점 {len(raw.vertices):,} · 삼각형 {len(raw.faces):,} · 텍스처 {'있음' if has_tex else '없음'} · extents {np.round(raw_extent, 3)}")

    T, info = C.alignment_transform(raw)
    if args.no_align:
        T = np.eye(4)
    mesh = raw.copy()
    mesh.apply_transform(T)
    # 컴포넌트 통계 (삭제는 하지 않음 — Phase 2 의 몫)
    labels = trimesh.graph.connected_component_labels(mesh.face_adjacency, node_count=len(mesh.faces))
    _, comp_counts = np.unique(labels, return_counts=True)
    comps = comp_counts
    comp_faces = sorted((int(x) for x in comp_counts), reverse=True)
    # 뒤집힌/겹친 면 진단
    dup = int(len(mesh.faces) - len(np.unique(np.sort(mesh.faces, axis=1), axis=0)))

    C.export_glb(mesh, "scan_original.glb")
    files = diag_images(mesh, info)

    b = mesh.bounds
    meta = C.load_meta()
    meta.update({
        "source_file": str(src.relative_to(C.ROOT)) if src.is_relative_to(C.ROOT) else str(src),
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "alignment_transform": T.tolist(),
        "unit_guess": info["unit_guess"], "scale_to_m": info["scale_to_m"],
        "up_axis_original": info["up_axis_original"], "wall_yaw_deg": info["wall_yaw_deg"],
        "bounds_world_m": {"min": b[0].tolist(), "max": b[1].tolist()},
        "ceiling_height_m": info["ceiling_height_m"],
        "ceiling_height_status": "measured" if info["ceiling_height_m"] else "inferred",
        "counts": {"vertices": len(mesh.vertices), "faces": len(mesh.faces), "components": len(comps)},
    })
    C.save_meta(meta)

    lines = [
        "# 스캔 분석 보고 (Phase 1)", "",
        f"- 생성: {meta['generated']}", f"- 입력: `{meta['source_file']}`",
        f"- 텍스처: {'있음 (TextureVisuals 유지)' if has_tex else '**없음** — MTL/JPG 확인 필요'}", "",
        "## 원본 수치", "",
        "| 항목 | 값 |", "|---|---|",
        f"| 정점 | {len(raw.vertices):,} |", f"| 삼각형 | {len(raw.faces):,} |",
        f"| 원본 bounds min | {np.round(raw_bounds[0], 3).tolist()} |", f"| 원본 bounds max | {np.round(raw_bounds[1], 3).tolist()} |",
        f"| 원본 extents | {np.round(raw_extent, 3).tolist()} |",
        f"| 단위 추정 | **{info['unit_guess']}** (×{info['scale_to_m']} → m) |",
        f"| 원본 위 축 | {info['up_axis_original']} |",
        f"| 벽 정렬 회전 | {info['wall_yaw_deg']:.2f}° (Y축) |",
        f"| 연결 컴포넌트 | {len(comps):,} (최대 5개 삼각형 수: {comp_faces[:5]}) |",
        f"| 중복 면 | {dup:,} |", "",
        "## 정렬 후 월드 좌표 (뷰어 기준: +Y 위, 바닥 y=0)", "",
        "| 항목 | 값 |", "|---|---|",
        f"| 가로(X) | {mesh.extents[0]:.2f} m |", f"| 세로(Z) | {mesh.extents[2]:.2f} m |",
        f"| 높이(Y, 메쉬 전체) | {mesh.extents[1]:.2f} m |",
        f"| 천장고(수평면 피크 기준) | {('%.2f m' % info['ceiling_height_m']) if info['ceiling_height_m'] else '**검출 실패** — 천장 스캔 누락 가능, 현장 실측'} |",
        f"| 수평면 총면적 | {info['horizontal_face_area_m2']:.1f} m² (바닥+천장+가구 상판) |", "",
        "> ⚠️ 여기 치수는 LiDAR 스캔 기반 **참고치**다. 공사 전 현장 실측 필수. "
        "천장고는 수평면 피크로 잡은 값이므로 천장이 일부만 스캔됐으면 틀릴 수 있다.", "",
        "## 진단 이미지 (`screenshots/`)", "",
        *[f"- `{f}`" for f in files], "",
        "## 다음 단계 체크", "",
        "- [ ] `diag_vertical_footprint.png` 에서 외벽 윤곽·중앙 넓은 기둥·얇은 기둥 위치가 사진과 맞는지 확인",
        "- [ ] 바닥 히스토그램 피크가 하나로 또렷한지 (두 개면 층·단 차이 또는 뒤집힘 의심)",
        "- [ ] 뷰어 `① 원본 스캔` 모드에서 입구/창가/주방 북마크 시점과 사진 대조",
        "- [ ] 사진과 다른 곳은 `reports/geometry_assumptions.md` 에 ‘구조 추정 오류 vs LiDAR 누락’ 으로 분류",
    ]
    (C.REPORTS_DIR / "scan_analysis.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"[보고] reports/scan_analysis.md")


if __name__ == "__main__":
    main()
