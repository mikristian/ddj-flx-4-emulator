#!/usr/bin/env python3
"""Make an editable, still-photographic FLX4 face with five fixed fader handles erased.

The user's physical controller photo remains untouched. Instead, recover the
dark housing and rails behind its motionless photographed fader caps. The web UI
places exactly one *live* CSS thumb on each restored rail.

No external model, network download or new third-party dependency is needed.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / "ui" / "flx4-top-crop.png"
dest = ROOT / "ui" / "flx4-top-faders-clean.png"
image = Image.open(source).convert("RGB")
original = image.copy()

# Top-down photographed fader caps, source pixel coordinates at 1630x922.
# Inner painted zones leave the neighboring printed tick marks untouched.
AREAS = [
    # Left / right channel fader, black handles at the center of each lane
    (708, 674, 788, 724),
    (843, 674, 923, 724),
    # Left / right deck pitch/tempo fader, large handles around the 0 position
    (454, 696, 521, 771),
    (1519, 696, 1588, 771),
    # Original middle-position crossfader; the interactive thumb overlays it
    (798, 819, 835, 900),
]


def erase_handle(bounds: tuple[int, int, int, int], sample_x: int) -> None:
    x0, y0, x1, y1 = bounds
    # Copy intact textured chassis pixels from an adjacent horizontal strip
    # at the same y. Unlike vertical inpainting/interpolation, this cannot
    # reconstruct a blurred ghost of the original knob or its shadow.
    for y in range(y0, y1):
        feather_y = min(1.0, (y - y0 + 1) / 4, (y1 - y) / 4)
        for x in range(x0, x1):
            feather_x = min(1.0, (x - x0 + 1) / 4, (x1 - x) / 4)
            feather = max(0.0, min(1.0, feather_x * feather_y))
            sx = min(original.width - 1, sample_x + (x - x0) % 20)
            color = original.getpixel((sx, y))
            old = original.getpixel((x, y))
            image.putpixel((x, y), tuple(round(color[i] * feather + old[i] * (1 - feather)) for i in range(3)))


for region, sample_x in zip(AREAS, (799, 929, 530, 1593, 862)):
    erase_handle(region, sample_x)

# Reconstruct dark fader tracks where a photographed handle previously
# obscured the slot. The tick labels and original fascia are kept intact.
painter = ImageDraw.Draw(image, "RGBA")
for x, y0, y1 in ((747, 628, 778), (882, 628, 778), (487, 627, 842), (1554, 627, 842)):
    # Draw only inside the former handle footprints, to avoid redrawing
    # unchanged sections or cutting the hardware's markings.
    matching = next(area for area in AREAS[:4] if area[0] < x < area[2])
    section_top, section_bottom = matching[1] + 1, matching[3] - 1
    painter.rectangle((x - 4, section_top, x + 4, section_bottom), fill=(8, 10, 12, 248))
    painter.line((x - 4, section_top, x - 4, section_bottom), fill=(74, 76, 79, 164), width=1)
    painter.line((x + 4, section_top, x + 4, section_bottom), fill=(76, 77, 80, 124), width=1)

# The outer tempo controls retain their photographed printed ticks. Redraw
# the short segments obscured by the now-removed static plastic fader caps.
for center in (487, 1554):
    for y in (701, 718, 735, 752, 768):
        painter.line((center - 29, y, center - 13, y), fill=(202, 206, 205, 170), width=2)
        painter.line((center + 13, y, center + 29, y), fill=(202, 206, 205, 170), width=2)

# Channel fader tick engravings sit either side of the central vertical slot.
for center in (747, 882):
    for y in (682, 696, 710):
        painter.line((center - 38, y, center - 13, y), fill=(203, 204, 205, 173), width=2)
        painter.line((center + 13, y, center + 38, y), fill=(203, 204, 205, 173), width=2)

# The crossfader needs the horizontal slot visible beneath a single cap.
painter.rectangle((798, 851, 835, 864), fill=(7, 9, 11, 233))
painter.line((798, 852, 835, 852), fill=(76, 80, 85, 97), width=1)
image.convert("RGB").save(dest, optimize=True)
print(f"Created cleaned 2D photo: {dest} ({dest.stat().st_size} bytes), original preserved.")
