#!/usr/bin/env python3
"""Locally generate a distinct macOS icon for the true flat FLX4 editor."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

here = Path(__file__).resolve().parent
photo = Image.open(here.parent / "ui" / "flx4-top-crop.png").convert("RGBA")
size = 1024
base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
art = Image.new("RGBA", (size, size), (17, 22, 29, 255))
draw = ImageDraw.Draw(art)
draw.rounded_rectangle((34, 34, 990, 990), radius=218, fill=(14, 19, 27), outline=(94, 110, 124), width=9)
for y in range(120, 930, 12):
    draw.line((96, y, 928, y), fill=(69, 94, 109, 26), width=2)

picture = photo.resize((866, 489), Image.Resampling.LANCZOS)
shadow_layer = Image.new("RGBA", (size, size))
shadow_draw = ImageDraw.Draw(shadow_layer)
shadow_draw.rounded_rectangle((64, 290, 960, 837), radius=38, fill=(0, 0, 0, 235))
shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(28))
art.alpha_composite(shadow_layer)
art.alpha_composite(picture, (79, 314))

try:
    font_path = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
    head = ImageFont.truetype(font_path, 110)
    sub = ImageFont.truetype(font_path, 40)
except OSError:
    head = ImageFont.load_default()
    sub = head
draw = ImageDraw.Draw(art)
draw.text((108, 115), "FLX4", font=head, fill=(234, 240, 246))
draw.rounded_rectangle((665, 131, 890, 222), radius=15, fill=(224, 124, 28))
draw.text((684, 155), "FLAT 2D", font=sub, fill=(15, 20, 24))
draw.text((205, 856), "PERFORMANCE CONTROLLER", font=sub, fill=(154, 185, 201))

mask = Image.new("L", (size, size))
ImageDraw.Draw(mask).rounded_rectangle((34, 34, 990, 990), radius=218, fill=255)
art.putalpha(mask)
base.alpha_composite(art)

out = here / "FLX4Flat2D.iconset"
out.mkdir(parents=True, exist_ok=True)
for px in (16, 32, 128, 256, 512):
    for factor in (1, 2):
        side = px * factor
        name = f"icon_{px}x{px}{'@2x' if factor == 2 else ''}.png"
        base.resize((side, side), Image.Resampling.LANCZOS).save(out / name)
base.save(here / "FLX4Flat2D-preview.png")
print(f"Saved distinct flat-controller icon: {out}")
