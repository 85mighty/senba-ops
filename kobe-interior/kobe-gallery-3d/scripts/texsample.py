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


def sample_faces(mesh: trimesh.Trimesh, face_idx: np.ndarray, n_per_face: int = 6, seed: int = 0, shrink: float = 0.4, reject: float = 110.0):
    """선택 면마다 n 개 무작위 점 → (points[N,3], colors[N,3] uint8, face_of_point[N]). 텍스처 없으면 colors=None.
    Scaniverse 아틀라스는 삼각형이 몇 px 밖에 안 돼 가장자리 샘플이 패딩(형광색)을 찍는다 →
    바리센트릭을 무게중심 쪽으로 shrink 만큼 당기고, 면 무게중심 색과 reject 이상 차이 나는 샘플은 버린다."""
    rng = np.random.default_rng(seed)
    tri = mesh.triangles[face_idx]                                   # (F,3,3)
    F = len(face_idx)
    r1 = np.sqrt(rng.random((F, n_per_face))); r2 = rng.random((F, n_per_face))
    b0 = 1 - r1; b1 = r1 * (1 - r2); b2 = r1 * r2                   # 균일 바리센트릭
    b0 = (1 - shrink) * b0 + shrink / 3; b1 = (1 - shrink) * b1 + shrink / 3; b2 = (1 - shrink) * b2 + shrink / 3
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
    def lookup(q):
        px = np.clip((q[:, 0] % 1.0) * (W - 1), 0, W - 1).astype(int)
        py = np.clip(((1 - q[:, 1]) % 1.0) * (H - 1), 0, H - 1).astype(int)
        return img[py, px].astype(float)
    cols = lookup(puv)
    if reject > 0:
        # 아틀라스 쓰레기 색(순수 형광) 제거: 채도(max-min) 가 reject 를 넘는 샘플은 버린다.
        # 실내 재질(회색 벽·우드·타일)의 채도는 100 을 거의 넘지 않는다.
        chroma = cols.max(1) - cols.min(1)
        keep = chroma <= reject
        pts, cols, fop = pts[keep], cols[keep], fop[keep]
    return pts, cols.astype(np.uint8), fop


def luminance(colors: np.ndarray) -> np.ndarray:
    c = colors.astype(float)
    return 0.299 * c[:, 0] + 0.587 * c[:, 1] + 0.114 * c[:, 2]
