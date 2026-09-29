"""
Potong `.preview-shots/full.png` menjadi satu file per layar 360x600.

Sumber kebenaran geometri adalah `shot-geometry` (blok JSON) yang ditulis
oleh preview.html dari getBoundingClientRect(). Skrip ini membacanya dari
`--dump-dom` Chrome, sehingga tidak perlu lagi menebak tinggi baris: kalau
tata letak berubah, potongan tetap presisi.

Kalau berkas geometri tidak tersedia, skrip jatuh ke perkiraan lama
(langkah baris 640px) supaya tetap berguna saat dijalankan manual.

Jalankan setelah `bun run preview:shots`:
    python scripts/cropShots.py [path/ke/dom.html]
"""

import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow tidak terpasang. pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / ".preview-shots"
FULL = SHOTS / "full.png"
GEO_HTML = SHOTS / "geometry.html"

# Perkiraan cadangan (dipakai hanya bila geometri asli tak ada).
FALLBACK_STAGE_PAD = 20
FALLBACK_LABEL_H = 21
FALLBACK_BOX_W = 360
FALLBACK_BOX_H = 600
FALLBACK_COL_STRIDE = 380
FALLBACK_ROW_STRIDE = 641

SCALE = 2


def load_geometry() -> list[dict] | None:
    """Ambil daftar kotak dari blok JSON yang ditulis preview.html."""
    candidates = [GEO_HTML] if GEO_HTML.exists() else []
    for path in candidates:
        raw = path.read_text(encoding="utf-8", errors="replace")
        match = re.search(
            r'<script[^>]*id="shot-geometry"[^>]*>(.*?)</script>',
            raw,
            re.S,
        )
        if not match:
            continue
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(data, list) and data:
            return data
    return None


def crop_by_geometry(img: Image.Image, boxes: list[dict]) -> int:
    count = 0
    for box in boxes:
        x, y = box["x"] * SCALE, box["y"] * SCALE
        w, h = box["w"] * SCALE, box["h"] * SCALE
        if x + w > img.size[0] or y + h > img.size[1]:
            print(f"  ! lewati {box['name']} (di luar kanvas)")
            continue
        out = SHOTS / f"{box['name']}.png"
        img.crop((x, y, x + w, y + h)).save(out)
        print(f"  {out.name}  {box['w']}x{box['h']}")
        count += 1
    return count


def crop_fallback(img: Image.Image) -> int:
    print("  (geometri asli tak ada — memakai perkiraan langkah tetap)")
    names = [
        "dashboard", "dashboard-error", "kirim",
        "kirim-error", "kirim-sukses", "terima",
        "riwayat", "riwayat-kosong", "setelan",
        "setelan-bahaya", "welcome", "unlock",
        "setup-buat", "setup-impor",
    ]
    count = 0
    for index, name in enumerate(names):
        row, col = divmod(index, 3)
        x = (FALLBACK_STAGE_PAD + col * FALLBACK_COL_STRIDE) * SCALE
        y = (FALLBACK_STAGE_PAD + row * FALLBACK_ROW_STRIDE + FALLBACK_LABEL_H) * SCALE
        box = (x, y, x + FALLBACK_BOX_W * SCALE, y + FALLBACK_BOX_H * SCALE)
        if box[2] > img.size[0] or box[3] > img.size[1]:
            print(f"  ! lewati {name} (di luar kanvas)")
            continue
        out = SHOTS / f"{name}.png"
        img.crop(box).save(out)
        print(f"  {out.name}  {FALLBACK_BOX_W}x{FALLBACK_BOX_H}")
        count += 1
    return count


def main() -> None:
    if not FULL.exists():
        sys.exit(f"{FULL} tidak ada — jalankan dulu: bun run preview:shots")

    img = Image.open(FULL)
    print(f"full: {img.size[0]}x{img.size[1]}")

    boxes = load_geometry()
    count = crop_by_geometry(img, boxes) if boxes else crop_fallback(img)
    print(f"\n{count} layar dipotong ke {SHOTS}")


if __name__ == "__main__":
    main()
