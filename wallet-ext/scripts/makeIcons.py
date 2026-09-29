"""
Generate NexChain Wallet extension icons (16/32/48/128 px).

The repo shipped 1x1 px placeholders; this script draws the real brand mark:
a rounded "N" diamond tile matching `.brand-mark` in src/style.css.

Run:  python scripts/makeIcons.py
"""

from PIL import Image, ImageDraw

BLUE = (37, 99, 168, 255)
BLUE_LIGHT = (58, 130, 203, 255)
WHITE = (255, 255, 255, 255)

OUT = {
    16: "public/assets/icon-16.png",
    32: "public/assets/icon-32.png",
    48: "public/assets/icon-48.png",
    128: "public/assets/icon-128.png",
}

# Oversample for smooth edges, then downscale.
CANVAS = 1024


def mark(size: int) -> Image.Image:
    s = CANVAS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = int(s * 0.055)
    radius = int(s * 0.235)
    d.rounded_rectangle(
        [pad, pad, s - pad, s - pad],
        radius=radius,
        fill=BLUE,
    )

    # Diagonal sheen, clipped to the tile by redrawing the shape as a mask.
    sheen = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon(
        [(0, int(s * 0.66)), (int(s * 0.62), 0), (s, 0), (s, int(s * 0.22)),
         (int(s * 0.34), s), (0, s)],
        fill=(255, 255, 255, 26),
    )
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [pad, pad, s - pad, s - pad], radius=radius, fill=255
    )
    img.paste(Image.alpha_composite(img, sheen), (0, 0), mask)

    # The "N" — a diamond outline with two vertical strokes, echoing the
    # `diamond` icon used in the popup header.
    cx, cy = s / 2, s / 2
    half = s * 0.235
    stroke = int(s * 0.072)

    d.polygon(
        [(cx, cy - half), (cx + half, cy), (cx, cy + half), (cx - half, cy)],
        outline=WHITE,
        width=stroke,
    )

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    for size, path in OUT.items():
        mark(size).save(path)
        print(f"wrote {path} ({size}x{size})")
