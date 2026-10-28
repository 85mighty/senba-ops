"""실제 바닥 사진(assets/photos/12_floor_closeup.jpg)으로 이어 붙여도 이음새가 안 보이는 원목 마루 텍스처를 만든다.
사진 아래쪽(원근이 덜한 부분)을 판 줄 단위 띠로 잘라 → 조명 얼룩(큰 밝기 변화)을 빼고 → 판 길이로 잘라 엇갈려 깔고
판 사이·끝 이음 줄을 그린다. 가로 = 판 길이 방향. 한 장 = SIZE_M × SIZE_M 실제 크기.
사용: python3 scripts/make_floor_texture.py  →  assets/textures/floor_wood_real.jpg"""
import random
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "photos" / "12_floor_closeup.jpg"
OUT = ROOT / "assets" / "textures" / "floor_wood_real.jpg"
PX, SIZE_M, ROWS = 2048, 2.16, 12            # 판 폭 18 cm × 12줄
PLANK_LEN_M = (0.9, 1.35)                     # 판 길이(사진 기준 약 1.2 m)
TONE = 0.74                                   # 3D 조명 아래에서 사진과 비슷한 밝기가 되도록 맞춘 값
TILT_DEG = 4.5                                # 사진 속 판 줄 기울기(줄 무늬가 가장 또렷해지는 각도로 측정)


def flatten(a, sigma=55):
    """큰 밝기 얼룩(조명·반사)만 걷어 낸다: 흐린 사본으로 나눈 뒤 전체 평균색을 곱함"""
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)); blur = np.asarray(img.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32) + 1
    return a / blur * a.reshape(-1, 3).mean(0)


def main():
    rnd = random.Random(7)
    # 사진은 판 줄이 약 4.5° 기울어 있다 → 바로 세운 뒤 검은 모서리 없는 가운데만 쓴다
    img = Image.open(SRC).convert("RGB").rotate(TILT_DEG, resample=Image.BICUBIC)
    src = np.asarray(img, dtype=np.float32)[300:980, 120:1200]
    h, w, _ = src.shape
    row_h = PX / ROWS; strip_src = 60                      # 판 한 줄(약 100~130 px)보다 얇게 잘라 판 경계가 덜 섞이게
    strips = []
    for y in range(0, h - strip_src, strip_src // 2):
        st = flatten(src[y:y + strip_src])
        im = Image.fromarray(np.clip(st, 0, 255).astype(np.uint8)).resize((int(w * 1.6), int(round(row_h))), Image.LANCZOS)   # 세로로 늘리고 가로는 결 방향이라 덜 늘림
        strips.append(np.asarray(im, dtype=np.float32))
    mean = np.mean([s.reshape(-1, 3).mean(0) for s in strips], axis=0) * TONE   # 실내 조명을 받으면 밝아 보여서 사진보다 조금 어둡게
    out = np.zeros((PX, PX, 3), np.float32)
    px_per_m = PX / SIZE_M
    for r in range(ROWS):
        y0, y1 = int(round(r * row_h)), int(round((r + 1) * row_h)); hh = y1 - y0
        x = rnd.uniform(0, PX)                               # 줄마다 이음 위치를 엇갈림
        remain = PX
        while remain > 0:
            L = int(rnd.uniform(*PLANK_LEN_M) * px_per_m)
            if remain - L < 0.4 * px_per_m: L = remain                      # 마지막 판이 너무 짧지 않게 남은 길이를 다 채움
            s = strips[rnd.randrange(len(strips))]; sx = rnd.randrange(0, max(1, s.shape[1] - L))
            piece = s[:hh, sx:sx + L].copy()
            while piece.shape[1] < L: piece = np.concatenate([piece, piece[:, :L - piece.shape[1]]], axis=1)
            if rnd.random() < 0.5: piece = piece[:, ::-1]
            piece = piece / piece.reshape(-1, 3).mean(0) * mean * rnd.uniform(0.9, 1.08)  # 판마다 색조 약간 다르게
            piece[:, :3] *= 0.62; piece[:, -2:] *= 0.75                                         # 끝 이음 줄
            cols = (int(x) + np.arange(L)) % PX; out[y0:y1, cols] = piece[:, :L]
            x += L; remain -= L
        out[y0:y0 + 2] *= 0.6                                                                    # 판 사이 줄
    out = np.clip(out, 0, 255).astype(np.uint8)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(OUT, quality=88, subsampling=0)
    print(f"[바닥] {OUT.relative_to(ROOT)} {PX}px = {SIZE_M} m, 판 {ROWS}줄, 원본 띠 {len(strips)}개, 평균색 {mean.round(0)}")


if __name__ == "__main__":
    main()
