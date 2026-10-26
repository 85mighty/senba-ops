"""스캔 텍스처 샘플링 — 면 위 점들의 UV 를 보간해 텍스처 색을 읽는다. (평면도·벽 전개도·띠 높이 측정용)"""
import numpy as np
import trimesh


def texture_image(mesh: trimesh.Trimesh):
    vis = mesh.visual
    if getattr(vis, "kind", None) != "texture" or vis.material is None:
        return None
    img = getattr(vis.material, "image", None) or getattr(vis.material, "baseColorTexture", None)
    if img is None:
        return None
    return np.asarray(img.convert("RGB"))


def sample_faces(mesh: trimesh.Trimesh, face_idx: np.ndarray, n_per_face: int = 6, seed: int = 0):
    """선택 면마다 n 개 무작위 점 → (points[N,3], colors[N,3] uint8, face_of_point[N]). 텍스처 없으면 colors=None."""
    rng = np.random.default_rng(seed)
    tri = mesh.triangles[face_idx]                                   # (F,3,3)
    F = len(face_idx)
    r1 = np.sqrt(rng.random((F, n_per_face))); r2 = rng.random((F, n_per_face))
    b0 = 1 - r1; b1 = r1 * (1 - r2); b2 = r1 * r2                   # 균일 바리센트릭
    pts = b0[..., None] * tri[:, None, 0] + b1[..., None] * tri[:, None, 1] + b2[..., None] * tri[:, None, 2]
    pts = pts.reshape(-1, 3)
    fop = np.repeat(face_idx, n_per_face)
    img = texture_image(mesh)
    if img is None or getattr(mesh.visual, "uv", None) is None:
        return pts, None, fop
    uv = mesh.visual.uv[mesh.faces[face_idx]]                        # (F,3,2)
    puv = b0[..., None] * uv[:, None, 0] + b1[..., None] * uv[:, None, 1] + b2[..., None] * uv[:, None, 2]
    puv = puv.reshape(-1, 2)
    H, W = img.shape[:2]
    px = np.clip((puv[:, 0] % 1.0) * (W - 1), 0, W - 1).astype(int)
    py = np.clip(((1 - puv[:, 1]) % 1.0) * (H - 1), 0, H - 1).astype(int)
    return pts, img[py, px], fop


def luminance(colors: np.ndarray) -> np.ndarray:
    c = colors.astype(float)
    return 0.299 * c[:, 0] + 0.587 * c[:, 1] + 0.114 * c[:, 2]
