#!/usr/bin/env python3
"""Builds the OUTBREAK app icon as a rendered (raster) emblem: a graded close-up photograph of a zombie face inside a lit,
bevelled red ring with rim glow. Source photo: "Zombie Halloween Mask" by Sharpshotefx (CC BY 4.0, Wikimedia Commons).
Run: python3 -I scripts/make-icons.py <path-to-mask-photo.jpg>   (needs Pillow and numpy). Writes the PNG sizes in public/icons."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2048
SRC = sys.argv[1]
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
cx = cy = S / 2
rr = np.hypot(xx - cx, yy - cy)
ang = np.arctan2(yy - cy, xx - cx)


def photo_disc(radius: float) -> np.ndarray:
    """Face photo graded cold and contrasty, with a red rim light, vignette and film grain; RGB float 0..255 for the whole canvas."""
    im = Image.open(SRC).convert("RGB").crop((520, 440, 1480, 1400)).resize((S, S), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=6, percent=140, threshold=2))
    a = np.asarray(im).astype(np.float32) / 255.0
    g = a.mean(2, keepdims=True)
    a = a * 0.82 + g * 0.18                                   # slightly desaturated
    a = np.clip((a - 0.5) * 1.3 + 0.5 + 0.03, 0, 1) ** 0.92   # contrast, a little brighter
    a[..., 0] *= 0.95; a[..., 2] *= 1.04                       # cold cast
    r = np.clip(rr / radius, 0, 1.2)
    vign = 1 - 0.62 * np.clip((r - 0.50) / 0.50, 0, 1) ** 1.8
    a *= vign[..., None]
    rim = np.clip((r - 0.78) / 0.22, 0, 1) ** 2.4             # red rim light toward the edge
    a[..., 0] += rim * 0.40; a[..., 1] += rim * 0.03; a[..., 2] += rim * 0.02
    rng = np.random.default_rng(7)
    a += rng.normal(0, 0.012, a.shape).astype(np.float32)
    return np.clip(a, 0, 1) * 255


def emblem(k: float) -> Image.Image:
    """k scales the whole emblem (maskable uses a smaller one to stay in the safe zone)."""
    R_photo = 0.355 * S * k
    R_in, R_out = 0.372 * S * k, 0.452 * S * k              # ring inner/outer radius
    bg = np.zeros((S, S, 3), np.float32) + np.array([9, 12, 16], np.float32)
    glow = np.exp(-((rr - 0.43 * S * k) / (0.10 * S * k)) ** 2)[..., None] * np.array([150, 18, 18], np.float32)
    bg = bg + glow * 0.65
    out = bg
    # photo disc
    ph = photo_disc(R_photo)
    m = np.clip((R_photo - rr) / 3.0 + 0.5, 0, 1)[..., None]
    out = out * (1 - m) + ph * m
    # metallic red ring: light from the upper left, bevel across the ring width
    t = np.clip((rr - R_in) / (R_out - R_in), 0, 1)
    ring_m = np.clip(np.minimum(rr - R_in, R_out - rr) / 3.0 + 0.5, 0, 1)[..., None]
    light = np.cos(ang - np.deg2rad(-135))                     # facing the light
    bevel = np.sin(t * np.pi)                                  # 0 at the edges, 1 in the middle
    base = np.array([150, 20, 24], np.float32)
    shade = (0.55 + 0.45 * light)[..., None] * (0.45 + 0.75 * bevel)[..., None]
    spec = (np.clip(light, 0, 1) ** 6 * bevel ** 2)[..., None] * np.array([230, 150, 140], np.float32) * 0.8
    ring = base * shade + spec
    # fine dark groove between photo and ring, and a thin bright outer edge
    groove = np.clip(1 - np.abs(rr - R_in) / (0.006 * S * k), 0, 1)[..., None]
    ring = ring * (1 - 0.7 * groove)
    edge = np.clip(1 - np.abs(rr - R_out) / (0.0035 * S * k), 0, 1)[..., None]
    ring = ring + edge * np.array([120, 40, 40], np.float32) * (0.4 + 0.6 * np.clip(light, 0, 1)[..., None])
    out = out * (1 - ring_m) + ring * ring_m
    # soft drop shadow under the emblem
    img = Image.fromarray(np.clip(out, 0, 255).astype("uint8"))
    return img


def save(im: Image.Image, size: int, path: str) -> None:
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)


any_icon = emblem(1.0)
maskable = emblem(0.82)
save(any_icon, 192, "public/icons/icon-192.png")
save(any_icon, 512, "public/icons/icon-512.png")
save(maskable, 512, "public/icons/icon-maskable-512.png")
save(any_icon, 180, "public/icons/apple-touch-icon.png")
print("icons written")
