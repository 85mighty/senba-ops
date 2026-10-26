"""공통 유틸 — 입력 탐색, 로드, 단위/축 판정, 바닥 정렬, 메타데이터 I/O.

모든 파이프라인(inspect → clean → reconstruct)이 같은 월드 좌표를 쓰도록
정렬 변환(4x4)은 src/geometry_metadata.json 에 한 번 기록하고 재사용한다.
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_DIR = ROOT / "assets" / "original"
MODELS_DIR = ROOT / "assets" / "models"
REPORTS_DIR = ROOT / "reports"
SHOTS_DIR = ROOT / "screenshots"
META_PATH = ROOT / "src" / "geometry_metadata.json"

for d in (ORIGINAL_DIR, MODELS_DIR, REPORTS_DIR, SHOTS_DIR):
    d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------- 입력 탐색
def find_input(explicit: str | None = None) -> Path:
    """우선순위: 명시 경로 > assets/original 의 Scaniverse ZIP > OBJ > GLB."""
    if explicit:
        p = Path(explicit).expanduser()
        if not p.exists():
            sys.exit(f"[오류] 입력 파일 없음: {p}")
        return p
    cands = []
    for pat in ("*caniverse*.zip", "*.zip", "*.obj", "*.glb", "*.gltf", "*.ply"):
        cands += sorted(ORIGINAL_DIR.glob(pat))
    if not cands:
        sys.exit(
            "[입력 없음] assets/original/ 에 Scaniverse ZIP(또는 OBJ/GLB)을 넣어주세요.\n"
            "  예) cp ~/Downloads/'Scaniverse 2026-10-26 113837(1).zip' assets/original/\n"
            "  또는 --input <경로> 로 직접 지정"
        )
    return cands[0]


def extract_zip(zp: Path) -> Path:
    """ZIP을 assets/original/<이름>/ 에 풀고 OBJ 경로를 돌려준다. 원본 ZIP은 그대로 둔다."""
    out = ORIGINAL_DIR / zp.stem.replace(" ", "_")
    with zipfile.ZipFile(zp) as z:
        names = z.namelist()
        objs = [n for n in names if n.lower().endswith(".obj")]
        if not objs:
            sys.exit(f"[오류] ZIP 안에 OBJ가 없음: {names}")
        if not out.exists():
            z.extractall(out)
        print(f"[ZIP] {zp.name} → {out.relative_to(ROOT)}  (내부: {', '.join(Path(n).name for n in names)})")
    return out / objs[0]


def load_mesh(path: Path) -> trimesh.Trimesh:
    """텍스처(TextureVisuals)를 유지한 단일 Trimesh 로 로드. MTL/JPG 누락은 경고."""
    if path.suffix.lower() == ".zip":
        path = extract_zip(path)
    if path.suffix.lower() == ".obj":
        mtl = path.with_suffix(".mtl")
        if not mtl.exists():
            print(f"[경고] MTL 없음: {mtl.name} — 텍스처 없이 로드됨")
        else:
            for line in mtl.read_text(errors="ignore").splitlines():
                if line.strip().lower().startswith("map_kd"):
                    tex = path.parent / line.split(maxsplit=1)[1].strip()
                    if not tex.exists():
                        print(f"[경고] 텍스처 파일 없음: {tex.name}")
    loaded = trimesh.load(path, force="mesh", process=False)
    if isinstance(loaded, trimesh.Scene):
        loaded = trimesh.util.concatenate(list(loaded.dump()))
    if not isinstance(loaded, trimesh.Trimesh):
        sys.exit(f"[오류] 메쉬로 읽을 수 없음: {path}")
    return loaded


# ---------------------------------------------------------------- 단위/축
def guess_unit(extent: np.ndarray) -> tuple[str, float]:
    """bbox 최대 변 길이로 단위 추정. (단위명, m 로 바꾸는 배율)"""
    e = float(extent.max())
    if 1.5 <= e <= 60:
        return "m", 1.0
    if 150 <= e <= 6000:
        return "cm", 0.01
    if 1500 <= e <= 60000:
        return "mm", 0.001
    return f"unknown(max extent={e:.3g})", 1.0


def dominant_up_axis(mesh: trimesh.Trimesh) -> tuple[int, float]:
    """면적 가중으로 축 정렬된 수평면이 가장 많은 축 = 위 방향 후보. (축 index, 해당 면적)"""
    n = mesh.face_normals
    a = mesh.area_faces
    best, best_area = 1, -1.0
    for ax in range(3):
        area = float(a[np.abs(n[:, ax]) > 0.95].sum())
        if area > best_area:
            best, best_area = ax, area
    return best, best_area


def floor_ceiling_levels(mesh: trimesh.Trimesh, up: int, scale: float) -> dict:
    """위 축 좌표 히스토그램(2cm)에서 수평면 면적 피크 → 바닥(아래)·천장(위) 높이."""
    n = mesh.face_normals
    a = mesh.area_faces
    c = mesh.triangles_center[:, up] * scale
    horiz = np.abs(n[:, up]) > 0.95
    if horiz.sum() == 0:
        return {"floor": float(mesh.bounds[0][up] * scale), "ceiling": None, "note": "수평면 없음"}
    bins = np.arange(c[horiz].min() - 0.02, c[horiz].max() + 0.04, 0.02)
    hist, edges = np.histogram(c[horiz], bins=bins, weights=a[horiz])
    centers = (edges[:-1] + edges[1:]) / 2
    order = np.argsort(hist)[::-1]
    floor = float(centers[order[0]])
    ceiling = None
    for i in order[1:]:
        if abs(centers[i] - floor) > 1.5 and hist[i] > 0.05 * hist[order[0]]:
            ceiling = float(centers[i])
            break
    if ceiling is not None and ceiling < floor:
        floor, ceiling = ceiling, floor
    return {"floor": floor, "ceiling": ceiling, "hist_peak_area": float(hist[order[0]])}


def wall_yaw(mesh: trimesh.Trimesh, up: int) -> float:
    """수직면 법선의 방위각을 90° 주기로 모아 지배 방향을 찾는다 → 벽을 축에 맞추는 회전각(rad)."""
    n = mesh.face_normals
    a = mesh.area_faces
    vert = np.abs(n[:, up]) < 0.2
    if vert.sum() < 10:
        return 0.0
    other = [i for i in range(3) if i != up]
    ang = np.arctan2(n[vert, other[1]], n[vert, other[0]])
    ang90 = np.mod(ang, np.pi / 2)
    hist, edges = np.histogram(ang90, bins=180, range=(0, np.pi / 2), weights=a[vert])
    k = int(np.argmax(hist))
    peak = (edges[k] + edges[k + 1]) / 2
    # Y축 회전 θ 는 (x,z) 평면 방위각을 φ → φ−θ 로 바꾼다. 지배 법선 φ≡peak (mod 90°) 를
    # 가장 가까운 축(0° 또는 90°)으로 보내는 θ = peak 또는 peak−90°
    yaw = peak if peak < np.pi / 4 else (peak - np.pi / 2)
    return float(yaw)


def alignment_transform(mesh: trimesh.Trimesh) -> tuple[np.ndarray, dict]:
    """원본 좌표 → 뷰어 월드 좌표(glTF: +Y 위, 바닥 y=0, 벽은 X/Z 축 정렬) 4x4 변환과 진단 정보."""
    unit, scale = guess_unit(mesh.extents)
    up, up_area = dominant_up_axis(mesh)
    levels = floor_ceiling_levels(mesh, up, scale)
    yaw = wall_yaw(mesh, up)

    T = np.eye(4)
    T[:3, :3] *= scale
    # 위 축을 +Y 로
    perm = np.eye(4)
    if up == 0:   # X up → Y
        perm[:3, :3] = np.array([[0, 1, 0], [1, 0, 0], [0, 0, -1]], float)
    elif up == 2: # Z up → Y
        perm[:3, :3] = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
    T = perm @ T
    # 벽 정렬 (Y 축 회전)
    R = trimesh.transformations.rotation_matrix(yaw, [0, 1, 0])
    T = R @ T
    # 바닥 → y=0, 바닥 중심 → 원점
    v = trimesh.transform_points(mesh.vertices, T)
    floor_y = levels["floor"]  # scale 적용된 up 좌표 = 변환 후 y (perm 은 부호 유지)
    cx, cz = (v[:, 0].min() + v[:, 0].max()) / 2, (v[:, 2].min() + v[:, 2].max()) / 2
    S = trimesh.transformations.translation_matrix([-cx, -floor_y, -cz])
    T = S @ T

    info = {
        "unit_guess": unit, "scale_to_m": scale, "up_axis_original": "xyz"[up],
        "horizontal_face_area_m2": up_area * scale * scale,
        "floor_level_original_scaled": levels["floor"],
        "ceiling_height_m": (levels["ceiling"] - levels["floor"]) if levels.get("ceiling") is not None else None,
        "wall_yaw_deg": float(np.degrees(yaw)),
        "levels": levels,
    }
    return T, info


# ---------------------------------------------------------------- 메타데이터
def load_meta() -> dict:
    if META_PATH.exists():
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    return {"version": 1, "status_legend": {
        "measured": "스캔 평면 적합으로 얻은 값",
        "observed": "사진으로 확인했으나 치수는 추정",
        "inferred": "스캔·사진 모두 불명확 — 현장 실측 필요"}}


def save_meta(meta: dict) -> None:
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[메타] {META_PATH.relative_to(ROOT)} 저장")


def export_glb(mesh: trimesh.Trimesh, name: str) -> Path:
    out = MODELS_DIR / name
    mesh.export(out)
    print(f"[GLB] {out.relative_to(ROOT)}  ({out.stat().st_size/1e6:.1f} MB, 삼각형 {len(mesh.faces):,})")
    return out
