"""스캔 텍스처 베이크 — 복원 평면(벽면·기둥면·바닥·천장)마다 스캔 색을 래스터화해 PNG 텍스처를 만들고
그 면 위에 텍스처 사각형 메쉬를 얹는다. 구멍은 이웃 색으로 메우고(창 영역은 밝은 유리색), 결과는 ③/④ 에서 실제 모습처럼 보인다."""
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage

import texsample as T

RES = 0.015   # m/px (벽·기둥)
RES_F = 0.02  # m/px (바닥·천장)
GLASS = np.array([205, 218, 232], float)


def inpaint(sum_rgb, cnt, iters=14, fallback=None):
    known = cnt > 0
    img = np.zeros_like(sum_rgb); img[known] = sum_rgb[known] / cnt[known][:, None]
    for _ in range(iters):
        if known.all():
            break
        s = np.stack([ndimage.uniform_filter(img[..., c] * known, size=3) for c in range(3)], -1)
        w = ndimage.uniform_filter(known.astype(float), size=3)
        fill = (~known) & (w > 1e-3)   # 부동소수 잔차(1e-17)로 나누면 픽셀이 포화됨
        img[fill] = s[fill] / w[fill][:, None]; known |= fill
    if not known.all():
        med = np.median(img[known], axis=0) if known.any() else (fallback if fallback is not None else np.array([180, 178, 173.0]))
        img[~known] = med if fallback is None else fallback
    img = np.stack([ndimage.median_filter(img[..., c], size=3) for c in range(3)], -1)   # 고립된 점 제거
    img = np.stack([ndimage.gaussian_filter(img[..., c], 0.6) for c in range(3)], -1)
    return np.clip(img, 0, 255).astype(np.uint8)


def tex_material(img, name, alpha=False):
    pil = Image.fromarray(img, "RGBA" if alpha else "RGB")
    return trimesh.visual.material.PBRMaterial(baseColorTexture=pil, metallicFactor=0.0, roughnessFactor=0.9, name=name,
                                               alphaMode="BLEND" if alpha else None, doubleSided=True)


def quad(p0, p1, p2, p3, mat, name):
    """p0→p1 = u 방향, p0→p3 = v 방향. 양면."""
    m = trimesh.Trimesh(vertices=[p0, p1, p2, p3], faces=[[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], process=False)
    m.visual = trimesh.visual.TextureVisuals(uv=np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float), material=mat)
    m.metadata["name"] = name
    return m


def bake_vertical(scan, axis, offset, t0, t1, side, ceil_h, name, openings=(), tol=0.10, n_per_face=16):
    """axis 에 수직인 평면(offset), side(+1/-1) 쪽을 보는 면의 텍스처. 반환: 텍스처 사각형 메쉬 또는 None."""
    n, c = scan.face_normals, scan.triangles_center
    other = 2 - axis
    sel = (np.abs(c[:, axis] - offset) < tol) & (c[:, other] >= t0 - 0.05) & (c[:, other] <= t1 + 0.05) \
        & (c[:, 1] > -0.05) & (c[:, 1] < ceil_h + 0.05) & (n[:, axis] * side > 0.3)
    idx = np.where(sel)[0]
    L = t1 - t0
    W, H = max(2, int(L / RES) + 1), max(2, int(ceil_h / RES) + 1)
    if len(idx) < 5:
        return None
    pts, cols, _ = T.sample_faces(scan, idx, n_per_face=n_per_face)
    if cols is None:
        return None
    u = ((pts[:, other] - t0) / RES).astype(int); v = (pts[:, 1] / RES).astype(int)
    ok = (u >= 0) & (u < W) & (v >= 0) & (v < H)
    S = np.zeros((H, W, 3)); N = np.zeros((H, W))
    np.add.at(S, (v[ok], u[ok]), cols[ok].astype(float)); np.add.at(N, (v[ok], u[ok]), 1)
    # 창 영역은 유리색을 약하게 깔아 큰 구멍이 회색으로 메워지지 않게
    for o in openings:
        if o.get("kind") != "window":
            continue
        u0, u1 = int((o["from"] - t0) / RES), int((o["to"] - t0) / RES); v0, v1 = int(o["y"][0] / RES), int(o["y"][1] / RES)
        sl = (slice(max(v0, 0), min(v1, H)), slice(max(u0, 0), min(u1, W)))
        empty = N[sl] == 0
        S[sl][empty] = GLASS * 0.5; N[sl][empty] = 0.5
    img = np.flipud(inpaint(S, N))      # row 0 = 천장 쪽 (trimesh uv v=1 이 위)
    mat = tex_material(img, name + "_mat")
    off = offset + side * 0.001
    if axis == 0:
        p0, p1, p2, p3 = [off, 0, t0], [off, 0, t1], [off, ceil_h, t1], [off, ceil_h, t0]
    else:
        p0, p1, p2, p3 = [t0, 0, off], [t1, 0, off], [t1, ceil_h, off], [t0, ceil_h, off]
    return quad(p0, p1, p2, p3, mat, name)


def bake_horizontal(scan, y_plane, up, occ, origin, cell, name, tol=0.09, n_per_face=10):
    """바닥(up=+1) 또는 천장(up=-1) 텍스처. occ 격자(바닥 점유)로 알파를 만든다."""
    n, c = scan.face_normals, scan.triangles_center
    sel = (np.abs(c[:, 1] - y_plane) < tol) & (n[:, 1] * up > 0.6)
    idx = np.where(sel)[0]
    if len(idx) < 5:
        return None
    pts, cols, _ = T.sample_faces(scan, idx, n_per_face=n_per_face)
    if cols is None:
        return None
    gx_n, gz_n = occ.shape
    x0, z0 = origin; x1, z1 = x0 + gx_n * cell, z0 + gz_n * cell
    W, H = int((x1 - x0) / RES_F) + 1, int((z1 - z0) / RES_F) + 1
    u = ((pts[:, 0] - x0) / RES_F).astype(int); v = ((pts[:, 2] - z0) / RES_F).astype(int)
    ok = (u >= 0) & (u < W) & (v >= 0) & (v < H)
    S = np.zeros((H, W, 3)); N = np.zeros((H, W))
    np.add.at(S, (v[ok], u[ok]), cols[ok].astype(float)); np.add.at(N, (v[ok], u[ok]), 1)
    rgb = inpaint(S, N, iters=20)
    # 알파 = 바닥 점유 (격자 → 픽셀 업샘플)
    gi = np.clip((np.arange(W) * RES_F / cell).astype(int), 0, gx_n - 1); gj = np.clip((np.arange(H) * RES_F / cell).astype(int), 0, gz_n - 1)
    alpha = (occ[gi[None, :], gj[:, None]] > 0).astype(np.uint8) * 255
    alpha = ndimage.binary_dilation(alpha > 0, iterations=1).astype(np.uint8) * 255
    img = np.dstack([rgb, alpha])
    # 이미지 행 v ↔ z. trimesh uv v=1 이 이미지 위(row 0) → row 0 이 z0 이 되도록 뒤집지 않고 uv 를 맞춘다
    mat = tex_material(np.flipud(img), name + "_mat", alpha=True)
    y = y_plane + up * 0.003
    return quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], mat, name)
