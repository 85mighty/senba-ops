"""다마스크(양탄자) 벽지 텍스처 — 붉은 바탕에 한 톤 밝은/어두운 잎·리본·아칸서스 무늬. 이음새 없이 반복된다.
참고: 경성미술관 벽(톤온톤 다마스크, 코랄레드). 한 장 = 0.64 m (실제 벽지 한 롤 폭 약 0.53~0.9 m 중 흔한 반복 단위)
사용: python3 scripts/make_damask_texture.py → assets/textures/wall_damask_red.jpg"""
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "textures" / "wall_damask_red.jpg"
SIZE_M = 0.64
PX = 1024
BASE = np.array([141, 28, 44], dtype=np.float32)       # 크림슨 바탕 (#8d1c2c) — 기존 #8a1f2b 에 가깝게
LIGHT = np.array([172, 52, 64], dtype=np.float32)      # 무늬(밝은 톤)
DARK = np.array([112, 18, 34], dtype=np.float32)       # 그림자 톤


def motif(w, h):
    """한 칸(w×h)의 다마스크 모티프(0~1). 세로 중심축 좌우 대칭: 큰 아칸서스 잎 3쌍 + 가운데 꽃(펼친 장미창) + 위아래 리본 매듭 + 바깥으로 휘는 덩굴."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    x = (xs / w - 0.5) * 2; y = (ys / h - 0.5) * 2
    ax = np.abs(x); m = np.zeros((h, w), dtype=np.float32)
    def add(mask): nonlocal m; m = np.maximum(m, mask.astype(np.float32))
    # 가운데 꽃: 안쪽 원 + 12장 꽃잎 + 바깥 고리
    r = np.hypot(x * 1.0, y * 0.78); th = np.arctan2(y * 0.78, x)
    add((r < 0.075)); add((r < 0.26 + 0.05 * np.cos(12 * th)) & (r > 0.12)); add((np.abs(r - 0.32) < 0.014))
    # 큰 잎(아칸서스): 위·아래 각 3쌍, 바깥으로 갈수록 크고 비스듬히 누운 타원 + 잎맥 홈
    for sgn in (1, -1):
        for k, (cy, cx, a, b, ang) in enumerate([(0.42, 0.20, 0.23, 0.075, 0.9), (0.62, 0.36, 0.26, 0.085, 0.55), (0.80, 0.18, 0.20, 0.07, 1.25)]):
            yy = (y - sgn * cy); xx = (ax - cx)
            u = xx * math.cos(ang * sgn) + yy * math.sin(ang * sgn) * sgn; v = -xx * math.sin(ang * sgn) * sgn + yy * math.cos(ang * sgn)
            leaf = (u / a) ** 2 + (v / b) ** 2 < 1
            vein = leaf & (np.abs(v) < 0.008)
            add(leaf & ~vein)
        # 줄기: 중심축을 따라 위·아래로 이어지는 가는 선 + 리본 매듭
        add((ax < 0.016) & (y * sgn > 0.30) & (y * sgn < 0.98))
        add((np.hypot(ax, y * sgn - 0.93) < 0.06))
    # 바깥으로 휘는 덩굴 곡선(칸을 이웃 칸과 이어 주는 S자)
    for sgn in (1, -1):
        for off in (0.0,):
            add((np.abs(ax - (0.74 + 0.16 * np.sin((y + off) * math.pi * 1.0 * sgn))) < 0.022) & (np.abs(y) < 0.98))
    return m


def main():
    # 격자: 가로 2칸 × 세로 2칸, 세로 한 줄 걸러 반 칸 어긋나게(half-drop) → 다마스크 특유의 지그재그 배열
    cell = PX // 2
    m1 = motif(cell, cell)
    canvas = np.zeros((PX, PX), dtype=np.float32)
    for i in range(2):
        for j in range(2):
            oy = (j * cell + (cell // 2 if i % 2 else 0)) % PX
            ox = i * cell
            for dy in (0, -PX):
                y0 = oy + dy
                ys0, ys1 = max(0, y0), min(PX, y0 + cell)
                if ys1 <= ys0: continue
                canvas[ys0:ys1, ox:ox + cell] = np.maximum(canvas[ys0:ys1, ox:ox + cell], m1[ys0 - y0:ys1 - y0, :])
    img = Image.fromarray((canvas * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))
    mk = np.asarray(img, dtype=np.float32) / 255.0
    # 입체감: 마스크를 왼쪽 위에서 비춘 것처럼 엠보스(밝은 가장자리 + 어두운 그림자)
    gy, gx = np.gradient(np.asarray(img.filter(ImageFilter.GaussianBlur(2.2)), dtype=np.float32) / 255.0)
    shade = np.clip(-(gx + gy) * 14.0, -1, 1)
    rgb = BASE[None, None, :] * (1 - mk[..., None]) + LIGHT[None, None, :] * mk[..., None]
    rgb = rgb + np.where(shade[..., None] > 0, (LIGHT - BASE) * shade[..., None] * 0.9, (BASE - DARK) * shade[..., None] * 0.9)
    # 미세한 직물 결(가로세로 잔줄)
    rng = np.random.default_rng(7)
    weave = (np.sin(np.arange(PX)[None, :] * 2 * math.pi / 8) * 0.5 + np.sin(np.arange(PX)[:, None] * 2 * math.pi / 8) * 0.5) * 2.2
    rgb = rgb + weave[..., None] + rng.normal(0, 1.2, (PX, PX, 1))
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").save(OUT, quality=90)
    print(f"[texture] {OUT}  SIZE_M={SIZE_M}")


if __name__ == "__main__":
    main()
