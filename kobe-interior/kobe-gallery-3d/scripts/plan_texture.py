"""컬러 평면도 — 바닥면(높이 0 부근) 텍스처 색을 위에서 본 이미지로 래스터화. 주방 타일/화장실/우드 바닥 구분용.
사용: python3 scripts/plan_texture.py  → screenshots/plan_texture.png (0.03 m/px, 축 눈금 m)"""
import numpy as np, trimesh
import common as C, texsample as T

mesh = trimesh.load(C.MODELS_DIR / "scan_original.glb", force="mesh", process=False)
if isinstance(mesh, trimesh.Scene): mesh = trimesh.util.concatenate(list(mesh.dump()))
n = mesh.face_normals; c = mesh.triangles_center
for name, sel, fname in (("floor", (n[:, 1] > 0.9) & (c[:, 1] > -0.08) & (c[:, 1] < 0.12), "plan_texture.png"),
                         ("ceiling", (n[:, 1] < -0.9) & (c[:, 1] > 2.0), "plan_ceiling_texture.png"),
                         ("walls_low", (np.abs(n[:, 1]) < 0.3) & (c[:, 1] > 0.2) & (c[:, 1] < 2.2), "plan_walls_texture.png")):
    idx = np.where(sel)[0]
    if len(idx) == 0: continue
    pts, cols, _ = T.sample_faces(mesh, idx, n_per_face=12)
    res = 0.03; b = mesh.bounds
    W = int((b[1][0] - b[0][0]) / res) + 2; H = int((b[1][2] - b[0][2]) / res) + 2
    img = np.zeros((H, W, 3), np.uint8); img[:] = 40
    gx = ((pts[:, 0] - b[0][0]) / res).astype(int); gz = ((pts[:, 2] - b[0][2]) / res).astype(int)
    if cols is None: cols = np.full((len(pts), 3), 200, np.uint8)
    img[gz, gx] = cols
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(9, 9 * H / W))
    ax.imshow(img, extent=[b[0][0], b[1][0], b[1][2], b[0][2]]); ax.set_xlabel("x [m]"); ax.set_ylabel("z [m]")
    ax.set_xticks(np.arange(np.floor(b[0][0]), b[1][0] + 1, 1)); ax.set_yticks(np.arange(np.floor(b[0][2]), b[1][2] + 1, 1)); ax.grid(alpha=0.35, color="cyan")
    ax.set_title(f"{name} texture, top view"); fig.savefig(C.SHOTS_DIR / fname, dpi=120, bbox_inches="tight"); plt.close(fig)
    print("saved", fname, "samples", len(pts))
