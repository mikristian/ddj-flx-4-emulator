"""Extract flat, photo-matched circular DDJ-FLX4 jog faces.

Run from the project root with ../.venv/bin/python tools/generate_control_assets.py.
The output artwork stays in the UI folder and requires no web dependencies.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ui" / "flx4-top-crop.png"
SIZE = 450
RADIUS = SIZE // 2


def generate():
    with Image.open(SOURCE) as source:
        source = source.convert("RGBA")
        if source.size not in ((1630, 921), (1630, 922)):
            raise ValueError(f"Unexpected FLX4 photo dimensions: {source.size}")
        for name, (cx, cy) in {
            "jog-left.png": (277, 384),
            "jog-right.png": (1349, 384),
        }.items():
            face = source.crop((cx - RADIUS, cy - RADIUS, cx + RADIUS, cy + RADIUS))
            alpha = Image.new("L", (SIZE, SIZE), 0)
            draw = ImageDraw.Draw(alpha)
            draw.ellipse((2, 2, SIZE - 3, SIZE - 3), fill=255)
            alpha = alpha.filter(ImageFilter.GaussianBlur(1.6))
            face.putalpha(alpha)
            dest = ROOT / "ui" / name
            face.save(dest, optimize=True)
            print(f"{dest.name}: {face.size}, {dest.stat().st_size:,} bytes")


if __name__ == "__main__":
    generate()
