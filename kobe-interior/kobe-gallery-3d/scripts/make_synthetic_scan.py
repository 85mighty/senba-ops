"""테스트 픽스처 — 실제 Scaniverse 파일이 없을 때 파이프라인을 검증하기 위한 가짜 스캔 생성.

실제 매장 형상이 아니다. 8.7×10×3.1 m 방, 중앙 넓은 가벽 1개, 얇은 기둥 3개, 창 공백, 주방 카운터,
떠 있는 노이즈 조각, 임의 회전·오프셋을 넣어 OBJ+MTL+JPG 를 Scaniverse 형식 ZIP 으로 만든다.
사용: python3 scripts/make_synthetic_scan.py <출력 디렉터리>
"""
import sys
import zipfile
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/synthetic_scan"); out_dir.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(1)
W, D, H = 8.7, 10.0, 3.1
parts = []

def quad(p0, p1, p2, p3):
    return trimesh.Trimesh(vertices=[p0, p1, p2, p3], faces=[[0, 1, 2], [0, 2, 3]], process=False)

def wall_with_gaps(x0, z0, x1, z1, gaps=()):
    """바닥~천장 벽. gaps: (t0,t1) 길이 비율 구간은 0.9~2.1m 높이를 비움(창)."""
    segs = []
    L = np.hypot(x1 - x0, z1 - z0); n = int(L / 0.25)
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        a = np.array([x0 + (x1 - x0) * t0, 0, z0 + (z1 - z0) * t0]); b = np.array([x0 + (x1 - x0) * t1, 0, z0 + (z1 - z0) * t1])
        in_gap = any(g0 <= (t0 + t1) / 2 <= g1 for g0, g1 in gaps)
        bands = [(0, 0.9), (2.1, H)] if in_gap else [(0, H)]
        for y0, y1 in bands:
            segs.append(quad(a + [0, y0, 0], b + [0, y0, 0], b + [0, y1, 0], a + [0, y1, 0]))
    return trimesh.util.concatenate(segs)

parts.append(quad([0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]))                       # 바닥
parts.append(quad([0, H, 0], [0, H, D * 0.7], [W, H, D * 0.7], [W, H, 0]))           # 천장 70%만 스캔
parts.append(wall_with_gaps(0, 0, W, 0, gaps=[(0.3, 0.75)]))                           # 앞 벽: 긴 창
parts.append(wall_with_gaps(W, 0, W, D))
parts.append(wall_with_gaps(W, D, 0, D, gaps=[(0.1, 0.2)]))                            # 뒷 벽: 문
parts.append(wall_with_gaps(0, D, 0, 0))
def column(cx, cz, sx, sz, h=H):
    return trimesh.creation.box([sx, h, sz]).apply_translation([cx, h / 2, cz])
parts.append(column(4.3, 5.0, 1.6, 0.4))          # 중앙 넓은 가벽
for cx, cz in ((2.0, 2.5), (6.7, 2.5), (2.0, 7.5)):
    parts.append(column(cx, cz, 0.3, 0.3))        # 얇은 기둥
parts.append(column(7.9, 8.8, 1.6, 0.6, h=0.9))   # 주방 카운터
mesh = trimesh.util.concatenate(parts)
mesh = trimesh.Trimesh(*trimesh.remesh.subdivide_to_size(mesh.vertices, mesh.faces, max_edge=0.25), process=False)
# 표면 노이즈 + 떠 있는 조각
mesh.vertices += rng.normal(0, 0.004, mesh.vertices.shape)
noise = []
for _ in range(60):
    s = rng.uniform(0.03, 0.15)
    frag = trimesh.creation.icosphere(subdivisions=1, radius=s)
    frag.apply_translation([rng.uniform(0.5, W - 0.5), rng.uniform(0.3, H - 0.3), rng.uniform(0.5, D - 0.5)])
    noise.append(frag)
# 벽에 붙은 작은 조각 (유지돼야 함)
stuck = trimesh.creation.box([0.2, 0.2, 0.05]).apply_translation([3.0, 1.5, 0.03])
mesh = trimesh.util.concatenate([mesh] + noise + [stuck])
# UV + 텍스처 (좌표 기반)
uv = np.stack([mesh.vertices[:, 0] / W, mesh.vertices[:, 2] / D], 1) % 1.0
img = np.zeros((512, 512, 3), np.uint8); img[:] = (181, 178, 173)
img[::16, :, :] = (120, 80, 50); img[:, ::16, :] = (120, 80, 50)
tex = Image.fromarray(img)
mat = trimesh.visual.material.SimpleMaterial(image=tex)
mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat)
# 임의 자세: Scaniverse 처럼 Y-up 이지만 원점 이동 + 7° 요
T = trimesh.transformations.rotation_matrix(np.radians(7), [0, 1, 0]) @ trimesh.transformations.translation_matrix([-3.1, 1.2, 2.4])
mesh.apply_transform(T)

stem = "Scaniverse_2026_10_26_113837"
obj = out_dir / f"{stem}.obj"
mesh.export(obj, include_texture=True)
# trimesh 가 쓴 mtl/png 이름을 Scaniverse 식(.mtl/.jpg)으로 정리
for p in out_dir.glob("*.png"):
    Image.open(p).convert("RGB").save(out_dir / f"{stem}.jpg", quality=90); p.unlink()
mtl = out_dir / "material.mtl"
if mtl.exists():
    txt = mtl.read_text().replace("material_0.png", f"{stem}.jpg").replace("material0.png", f"{stem}.jpg")
    import re
    txt = re.sub(r"map_Kd .*", f"map_Kd {stem}.jpg", txt)
    (out_dir / f"{stem}.mtl").write_text(txt); mtl.unlink()
    o = obj.read_text().replace("mtllib material.mtl", f"mtllib {stem}.mtl"); obj.write_text(o)
zp = out_dir / "Scaniverse 2026-10-26 113837(1).zip"
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for ext in (".obj", ".mtl", ".jpg"):
        z.write(out_dir / f"{stem}{ext}", f"Scaniverse 2026-10-26 113837/{stem}{ext}")
print("made", zp, "faces", len(mesh.faces))
