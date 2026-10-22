#!/usr/bin/env python3
"""Renders the OUTBREAK app icon: a glossy blood-red core with rings spreading outward and a few drops thrown off (an outbreak spreading).
No text. Pure raster rendering (lighting, glow, grain), no vector art. Run: python3 -I scripts/make-icons.py   (needs Pillow and numpy)."""
import numpy as np
from PIL import Image

S = 2048
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
cx = cy = S / 2
LIGHT = np.array([-0.55, -0.70, 0.45], np.float32)
LIGHT /= np.linalg.norm(LIGHT)


def sphere(out: np.ndarray, x0: float, y0: float, r: float, base=(185, 16, 22)) -> None:
    """Lit glossy sphere: diffuse + soft rim + sharp specular highlight, antialiased edge."""
    dx, dy = (xx - x0) / r, (yy - y0) / r
    d2 = dx * dx + dy * dy
    m = np.clip((1 - np.sqrt(d2)) * r / 2.5 + 0.5, 0, 1)
    if not m.any():
        return
    nz = np.sqrt(np.clip(1 - d2, 0, 1))
    n = np.stack([dx, dy, nz], -1)
    diff = np.clip((n * LIGHT).sum(-1), 0, 1)
    refl = 2 * (n * LIGHT).sum(-1, keepdims=True) * n - LIGHT
    spec = np.clip(refl[..., 2], 0, 1) ** 40
    rim = (1 - nz) ** 2.5
    col = np.array(base, np.float32) * (0.22 + 0.95 * diff[..., None]) + rim[..., None] * np.array([120, 20, 20], np.float32)
    col += spec[..., None] * np.array([255, 225, 215], np.float32) * 0.95
    out[:] = out * (1 - m[..., None]) + col * m[..., None]


def render(k: float) -> Image.Image:
    rr = np.hypot(xx - cx, yy - cy)
    # background: near-black with a faint red atmosphere around the core
    bg = np.zeros((S, S, 3), np.float32) + np.array([8, 10, 14], np.float32)
    bg += np.exp(-(rr / (0.42 * S * k)) ** 2)[..., None] * np.array([70, 8, 8], np.float32)
    out = bg
    # rings spreading outward: soft light bands that fade with distance
    for radius, width, power in ((0.275, 0.014, 1.0), (0.365, 0.011, 0.62), (0.45, 0.008, 0.32)):
        r0, w = radius * S * k, width * S * k
        band = np.exp(-((rr - r0) / w) ** 2)
        glow = np.exp(-((rr - r0) / (w * 4.5)) ** 2) * 0.35
        out += (band + glow)[..., None] * np.array([235, 40, 36], np.float32) * power
    # drops thrown off between the rings
    rng = np.random.default_rng(11)
    # (a loose spray to the upper right, smaller the farther out: it reads as spreading rather than as orbits)
    for ang_deg, dist, size in ((-38, 0.322, 0.030), (-62, 0.350, 0.022), (-15, 0.385, 0.019), (-50, 0.418, 0.015), (-28, 0.445, 0.011), (-80, 0.395, 0.012)):
        a = np.deg2rad(ang_deg)
        sphere(out, cx + np.cos(a) * dist * S * k, cy + np.sin(a) * dist * S * k, size * S * k)
    # the core
    sphere(out, cx, cy, 0.185 * S * k)
    out += rng.normal(0, 2.2, out.shape).astype(np.float32)            # film grain
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"))


def save(im: Image.Image, size: int, path: str) -> None:
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)


any_icon = render(1.0)
maskable = render(0.80)
save(any_icon, 192, "public/icons/icon-192.png")
save(any_icon, 512, "public/icons/icon-512.png")
save(maskable, 512, "public/icons/icon-maskable-512.png")
save(any_icon, 180, "public/icons/apple-touch-icon.png")
print("icons written")
