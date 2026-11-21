"""헤링본 LVT(フロアタイル) 바닥 텍스처 — 이어 붙는(타일링) 한 장. 판 90 × 450 mm(1:5), 45° 헤링본, 오크 톤 6색 + 결.
한 장 = SIZE_M (√2 × 2n × w = √2 × 10 × 0.09 ≈ 1.273 m) — editor.js 의 'tex:herringbone' repeat 과 같게.
사용: python3 scripts/make_herringbone_texture.py → assets/textures/floor_herringbone.jpg"""
import math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "textures" / "floor_herringbone.jpg"
W_PLANK, N = 0.09, 5                       # 판 폭 m, 길이 = N × 폭
PERIOD = 2 * N * W_PLANK                   # 회전 좌표계 주기(u, v)
SIZE_M = math.sqrt(2) * PERIOD             # 정사각 한 장(월드) — 타일링 주기
PX = 1024
TONES = np.array([[196, 150, 100], [176, 128, 82], [206, 164, 116], [164, 118, 76], [188, 142, 94], [150, 106, 68]], dtype=np.float32)   # 미디엄 오크(LVT 인쇄 톤)
GAP = 0.08                                  # 판 테두리(줄눈·모따기) 비율(폭 기준)


def hash2(i, j):
    h = (i * 73856093) ^ (j * 19349663); h = (h ^ (h >> 13)) * 1274126177; return (h & 0xFFFFFFFF) / 0xFFFFFFFF


def main():
    ys, xs = np.mgrid[0:PX, 0:PX]
    x = (xs + 0.5) / PX * SIZE_M; y = (ys + 0.5) / PX * SIZE_M
    u = (x + y) / math.sqrt(2) / W_PLANK; v = (y - x) / math.sqrt(2) / W_PLANK     # 45° 회전, 판 폭 단위
    i = np.floor(u).astype(np.int64); j = np.floor(v).astype(np.int64)
    d = np.mod(i - j, 2 * N); horiz = d < N
    off_h = d; off_v = d - N
    i0 = i - off_h; j0 = j - (N - 1 - off_v)              # 판 id(가로 판: (i0, j) / 세로 판: (i, j0))
    pid_i = np.where(horiz, i0, i); pid_j = np.where(horiz, j, j0)
    # 주기성: id 를 2N 로 접어 같은 색이 되게
    pi = np.mod(pid_i, 2 * N); pj = np.mod(pid_j, 2 * N)
    hv = np.vectorize(hash2)(pi, pj)
    tone = TONES[(hv * len(TONES)).astype(int) % len(TONES)]
    # 판 안 좌표
    lu = np.where(horiz, u - i0, v - j0); lv = np.where(horiz, v - j, u - i)         # lu ∈ [0,N), lv ∈ [0,1)
    edge = (lv < GAP) | (lv > 1 - GAP) | (lu < GAP) | (lu > N - GAP)
    # 결: 판 길이 방향으로 가는 줄 + 완만한 명암
    grain = 0.5 + 0.5 * np.sin(lv * 37.0 + hv * 50 + np.sin(lu * 2.3 + hv * 9) * 1.5)
    shade = 1.0 + (grain - 0.5) * 0.10 + (np.sin(lu * 0.9 + hv * 7) * 0.03)
    rgb = tone * shade[..., None]
    rgb = np.where(edge[..., None], rgb * 0.78, rgb)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(OUT, quality=88)
    print(f"[texture] {OUT}  SIZE_M={SIZE_M:.4f}")


if __name__ == "__main__":
    main()
