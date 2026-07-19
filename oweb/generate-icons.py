#!/usr/bin/env python3
"""Generate OWeb Browser PNG icons (Windows-friendly, no rsvg required)."""
from __future__ import annotations

import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Install Pillow: pip install pillow", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1] / "packages" / "browseros" / "resources" / "oweb" / "icons"
ACCENT = (34, 211, 238)
NAVY = (11, 27, 51)
WHITE = (255, 255, 255)
NODE = (16, 35, 63)


def draw_mark(size: int, with_tile: bool = True) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if with_tile:
        r = max(2, size // 5)
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=NAVY)
    cx, cy = size / 2, size / 2
    ring = size * 0.33
    dot_r = max(1, size * 0.065)
    for deg in [45, 90, 135, 180, 225, 270, 315]:
        rad = math.radians(deg)
        x = cx + ring * math.sin(rad)
        y = cy - ring * math.cos(rad)
        d.ellipse(
            (x - dot_r, y - dot_r, x + dot_r, y + dot_r),
            fill=WHITE if with_tile else NODE,
        )
    pill_w = max(2, size * 0.097)
    d.line((cx, cy - ring * 0.6, cx, cy - ring), fill=ACCENT, width=int(pill_w))
    return img


def main() -> int:
    ROOT.mkdir(parents=True, exist_ok=True)
    for s in [16, 22, 24, 32, 48, 64, 128, 192, 256, 1024]:
        draw_mark(s, with_tile=(s >= 48)).save(ROOT / f"product_logo_{s}.png")
        print(f"  product_logo_{s}.png")
    draw_mark(192, True).save(ROOT / "product_logo.png")
    print(f"Icons written to {ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
