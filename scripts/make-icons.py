#!/usr/bin/env python3
"""Builds the PWA icons from scripts/app-icon-source.png (supplied artwork: rounded square on a black canvas).
Crops the square, fills the black corners with the panel colour so the icon is full-bleed (the OS applies its own mask),
and writes 192, 512, maskable 512 (logo at 80 % inside the safe zone) and apple-touch 180.
Run: python3 -I scripts/make-icons.py   (needs Pillow and numpy)."""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "icons")
PANEL = np.array([6, 14, 19], np.uint8)

a = np.asarray(Image.open(os.path.join(HERE, "app-icon-source.png")).convert("RGB"))
ys, xs = np.where(a.sum(2) > 12)
x0, y0 = xs.min(), ys.min()
sz = min(xs.max() - x0, ys.max() - y0) + 1
c = a[y0:y0 + sz, x0:x0 + sz].copy()
lit = c.sum(2) > 20
band = int(sz * 0.24)  # the rounded corners lie within this distance of the top and bottom edges
for y in list(range(band)) + list(range(sz - band, sz)):
    nz = np.where(lit[y])[0]
    if len(nz) == 0:
        c[y] = PANEL
        continue
    c[y, :nz[0] + 8] = PANEL
    c[y, nz[-1] - 7:] = PANEL
m = int(sz * 0.015)  # drop the antialiased outer rim
img = Image.fromarray(c).crop((m, m, sz - m, sz - m)).resize((1024, 1024), Image.LANCZOS)
for name, s in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
    img.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
S, pad = 512, 51
mk = Image.new("RGB", (S, S), tuple(int(v) for v in PANEL))
mk.paste(img.resize((S - 2 * pad, S - 2 * pad), Image.LANCZOS), (pad, pad))
mk.save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)
