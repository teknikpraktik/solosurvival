"""Bygger OUTBREAKs app-ikoner och den transparenta logotypen från assets/brand/logo-source.webp (röda ringar på svart).
Kör: python3 -I scripts/build-icons.py   (kräver Pillow och numpy)
- public/icons/icon-192.png, icon-512.png: hela ikonen, ringarna ≈ 84 % av bredden på svart.
- public/icons/icon-maskable-512.png: ringarna inom maskable-säkerhetszonen (≈ 70 % av bredden).
- public/icons/apple-touch-icon.png (180 px): iOS rundar hörnen själv; ingen transparens (iOS gör den svart ändå).
- public/img/logo-rings.png: samma ringar med det svarta borttaget (alfa ur ljusstyrkan), för startsidan ovanpå bakgrundsbilden.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src = Image.open(ROOT / "assets/brand/logo-source.webp").convert("RGB")
a = np.asarray(src).astype(np.float32)

# The rings' bounding box: pixels clearly brighter than the black background.
mask = a.max(axis=2) > 40
ys, xs = np.nonzero(mask)
cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
r = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 + 2
print(f"rings: centre ({cx:.0f}, {cy:.0f}), radius {r:.0f} px in a {src.width}x{src.height} source", file=sys.stderr)
rings = src.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r)))


def icon(size: int, share: float, bg=(0, 0, 0)) -> Image.Image:
    out = Image.new("RGB", (size, size), bg)
    d = round(size * share)
    out.paste(rings.resize((d, d), Image.LANCZOS), ((size - d) // 2, (size - d) // 2))
    return out


icons = ROOT / "public/icons"
icon(192, 0.84).save(icons / "icon-192.png", optimize=True)
icon(512, 0.84).save(icons / "icon-512.png", optimize=True)
icon(512, 0.70).save(icons / "icon-maskable-512.png", optimize=True)
icon(180, 0.80).save(icons / "apple-touch-icon.png", optimize=True)

# Transparent logo: the source is red over black, so alpha = brightness (unpremultiplied back to full colour); the edges stay smooth.
big = np.asarray(rings.resize((512, 512), Image.LANCZOS)).astype(np.float32)
alpha = np.clip(big.max(axis=2) / 185.0, 0, 1)
rgb = np.where(alpha[..., None] > 0.01, np.clip(big / np.maximum(alpha[..., None], 1e-3), 0, 255), 0)
rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(ROOT / "public/img/logo-rings.png", optimize=True)
for p in ["public/icons/icon-192.png", "public/icons/icon-512.png", "public/icons/icon-maskable-512.png", "public/icons/apple-touch-icon.png", "public/img/logo-rings.png"]:
    print(p, (ROOT / p).stat().st_size, "B", file=sys.stderr)
