"""휴대기기용 GLB — 형상·UV 는 그대로, 큰 텍스처만 줄여 다시 담는다 (iPad/iPhone Safari 그래픽 메모리 한계 대응).
사용: python3 scripts/make_mobile_glb.py [최대변=4096]  →  assets/models/<이름>_mobile.glb
8192² 텍스처는 GPU 에서 약 358 MB, 4096² 는 약 90 MB."""
import io, json, struct, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "assets" / "models"
MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 4096

def read_glb(p):
    b = p.read_bytes(); assert b[:4] == b"glTF"
    jl = struct.unpack("<I", b[12:16])[0]; j = json.loads(b[20:20 + jl])
    o = 20 + jl; bl = struct.unpack("<I", b[o:o + 4])[0]; bin_ = b[o + 8:o + 8 + bl]
    return j, bin_

def write_glb(p, j, views):
    out = bytearray()
    for i, data in enumerate(views):
        while len(out) % 4: out.append(0)
        j["bufferViews"][i]["byteOffset"] = len(out); j["bufferViews"][i]["byteLength"] = len(data); out += data
    while len(out) % 4: out.append(0)
    j["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(j, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    p.write_bytes(b"glTF" + struct.pack("<II", 2, total) + struct.pack("<I", len(js)) + b"JSON" + js + struct.pack("<I", len(out)) + b"BIN\0" + bytes(out))

for name in ("scan_original", "scan_cleaned"):
    src = ROOT / f"{name}.glb"; dst = ROOT / f"{name}_mobile.glb"
    j, bin_ = read_glb(src)
    views = [bin_[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]] for v in j["bufferViews"]]
    for im in j.get("images", []):
        vi = im["bufferView"]; img = Image.open(io.BytesIO(views[vi])); w, h = img.size
        if max(w, h) <= MAX: continue
        s = MAX / max(w, h); small = img.convert("RGB").resize((round(w * s), round(h * s)), Image.LANCZOS)
        buf = io.BytesIO(); small.save(buf, "JPEG", quality=88, subsampling=0); views[vi] = buf.getvalue(); im["mimeType"] = "image/jpeg"
        print(f"{name}: {w}x{h} → {small.size[0]}x{small.size[1]}")
    write_glb(dst, j, views); print(f"  {dst.name}  {src.stat().st_size/1e6:.1f} MB → {dst.stat().st_size/1e6:.1f} MB")
