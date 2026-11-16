"""Bygger zombiernas kartmarkörer (ansikten) ur referensbilderna i assets/zombies/source/.
Kör: python3 -I scripts/build-zombie-faces.py   (kräver Pillow)

Varje ansikte: kvadratisk beskärning från panna till haka -> mörkröd radiell bakgrund bakom (källorna är frilagda) -> lite kontrast,
ljushet och skärpa så att ögon och ansiktsform håller på 40 CSS-pixlar -> cirkulär mask -> 128 x 128 WebP i public/img/zombies/.
128 px räcker för en 40 px markör på en skärm med tre gånger så hög upplösning, och de närmaste zombierna ritas 15 % större.
Ringen, skuggan och hotnivåerna ritas av CSS (src/app/globals.css, .zmark .zface), inte i bilden, så att de kan ändras utan nya bilder.
Ordningen här är den ordning spelet delar ut ansiktena i (src/app/_client/zombieFaces.ts): män och kvinnor varvas.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/zombies/source"
OUT = ROOT / "public/img/zombies"
SIZE = 128

# (fil, källa, beskärning (x0, y0, x1, y1) i källan: ögonen i övre mitten, panna till haka, extra ljushet för mörka källor)
FACES = [
    ("zombie-1.webp", "four-portraits.webp", (215, 40, 545, 370), 1.0),     # ung man, sönderriven kind
    ("zombie-2.webp", "woman-portrait.webp", (360, 140, 1000, 780), 1.0),   # kvinna, långt hår, sönderriven kind
    ("zombie-3.webp", "four-portraits.webp", (788, 60, 1188, 460), 1.0),    # kraftig flintskallig man, sår i pannan
    ("zombie-4.webp", "four-portraits.webp", (169, 650, 569, 1050), 1.05),  # kvinna, uppsatt hår
    ("zombie-5.webp", "marker-ref-1.webp", (400, 250, 920, 770), 1.05),     # man (ur markörreferens 1, utan dess ring)
    ("zombie-6.webp", "four-portraits.webp", (845, 650, 1185, 990), 1.0),   # äldre kvinna, grått hår
    ("zombie-7.webp", "marker-ref-2.webp", (455, 330, 925, 800), 1.3),      # man i skugga (ur markörreferens 2, utan dess ring)
]


def background(size: int) -> Image.Image:
    """Mörk, svagt rödglödande bakgrund (som i markörreferenserna): ansiktet syns mot den, och den syns mot den mörka kartan."""
    bg = Image.new("RGB", (size, size), (10, 3, 4))
    glow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow).ellipse((size * 0.12, size * 0.08, size * 0.88, size * 0.84), fill=255)
    bg.paste(Image.new("RGB", (size, size), (62, 12, 12)), (0, 0), glow.filter(ImageFilter.GaussianBlur(size * 0.14)))
    return bg


def face(source: str, box: tuple[int, int, int, int], lift: float) -> Image.Image:
    big = SIZE * 2
    im = Image.open(SRC / source).convert("RGBA").crop(box).resize((big, big), Image.LANCZOS)
    # Källornas alfa är ~252 i hela ansiktet (en WebP-artefakt): ansiktet är ogenomskinligt, bara kanten är mjuk.
    im.putalpha(im.getchannel("A").point(lambda v: 255 if v > 240 else v))
    base = background(big).convert("RGBA")
    base.alpha_composite(im)
    rgb = ImageEnhance.Contrast(base.convert("RGB")).enhance(1.18)
    rgb = ImageEnhance.Brightness(rgb).enhance(1.22 * lift)
    rgb = rgb.resize((SIZE, SIZE), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2))
    mask = Image.new("L", (SIZE * 4, SIZE * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, SIZE * 4 - 1, SIZE * 4 - 1), fill=255)
    out = rgb.convert("RGBA")
    out.putalpha(mask.resize((SIZE, SIZE), Image.LANCZOS))
    return out


OUT.mkdir(parents=True, exist_ok=True)
for name, source, box, lift in FACES:
    face(source, box, lift).save(OUT / name, "WEBP", quality=82, method=6)
    print(f"{name}: {(OUT / name).stat().st_size} bytes")
