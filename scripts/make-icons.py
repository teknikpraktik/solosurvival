#!/usr/bin/env python3
"""Draws the OUTBREAK app icon (zombie skull with glowing red eyes inside spreading rings) and writes the PNG sizes in public/icons.
Run: python3 -I scripts/make-icons.py   (needs Pillow and numpy)"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2048  # master size
BG = (11, 15, 20)
RED = (225, 40, 40)
BONE = (190, 214, 150)       # sickly green bone
SHADE = (112, 140, 90)
DARK = (8, 10, 12)


def master(k: float) -> Image.Image:
    """k = skull size factor (maskable uses a smaller one to stay inside the central 80 % safe zone)."""
    base = Image.new("RGB", (S, S), BG)
    glow = Image.new("RGB", (S, S), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse((S * 0.18, S * 0.18, S * 0.82, S * 0.82), fill=(120, 14, 14))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.11))
    im = Image.fromarray(np.clip(np.asarray(base).astype(int) + np.asarray(glow).astype(int), 0, 255).astype("uint8"))
    d = ImageDraw.Draw(im)
    c = S / 2
    # Spreading rings: the outbreak
    for r, w, col in ((0.455, 0.020, RED), (0.385, 0.012, (140, 28, 28))):
        rr = r * S * k
        d.ellipse((c - rr, c - rr, c + rr, c + rr), outline=col, width=max(2, int(w * S)))
    # Skull
    u = S * k
    hw, hh = 0.285 * u, 0.26 * u             # cranium half-width / half-height
    cy = c - 0.045 * u
    d.ellipse((c - hw, cy - hh, c + hw, cy + hh), fill=BONE)
    jw = hw * 0.60
    jt, jb = cy + hh * 0.55, cy + hh * 1.30
    d.rounded_rectangle((c - jw, jt, c + jw, jb), radius=int(jw * 0.30), fill=BONE)
    for i in (-1, 0, 1):                       # teeth gaps, short so the jaw stays one solid shape
        x = c + i * jw * 0.5
        d.rectangle((x - jw * 0.05, jb - (jb - jt) * 0.55, x + jw * 0.05, jb + 2), fill=DARK)
    # Eye sockets with glowing red pupils (same look as the zombie markers in the game)
    er = hw * 0.31
    for sx in (-1, 1):
        ex, ey = c + sx * hw * 0.43, cy + hh * 0.08
        d.ellipse((ex - er, ey - er * 1.12, ex + er, ey + er * 1.12), fill=DARK)
        pr = er * 0.52
        d.ellipse((ex - pr, ey - pr, ex + pr, ey + pr), fill=RED)
        p2 = pr * 0.38
        d.ellipse((ex - p2, ey - p2, ex + p2, ey + p2), fill=(255, 200, 180))
    d.polygon([(c, cy + hh * 0.42), (c - hw * 0.09, cy + hh * 0.66), (c + hw * 0.09, cy + hh * 0.66)], fill=DARK)   # nose
    d.line([(c + hw * 0.12, cy - hh), (c + hw * 0.03, cy - hh * 0.70), (c + hw * 0.17, cy - hh * 0.48)], fill=SHADE, width=int(S * 0.011))  # crack
    return im


def save(im: Image.Image, size: int, path: str) -> None:
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)


any_icon = master(1.0)
maskable = master(0.80)
save(any_icon, 192, "public/icons/icon-192.png")
save(any_icon, 512, "public/icons/icon-512.png")
save(maskable, 512, "public/icons/icon-maskable-512.png")
save(any_icon, 180, "public/icons/apple-touch-icon.png")
print("icons written")
