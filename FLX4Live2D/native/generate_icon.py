#!/usr/bin/env python3
"""Create original retro-DJ 2D artwork for the macOS FLX4 Live 2D icon."""
from pathlib import Path
from math import sin, cos, pi
from PIL import Image, ImageDraw, ImageFont, ImageFilter

N = 1024
root = Path(__file__).resolve().parent
art = Image.new("RGBA", (N, N), (0, 0, 0, 0))
draw = ImageDraw.Draw(art)
draw.rounded_rectangle((60, 60, 963, 963), radius=226, fill=(17, 22, 30, 255))
for n in range(31):
    alpha = int(54 * (1 - n / 32))
    x = 68 + n * 1.2
    draw.rounded_rectangle((x, x, 956 - (n * 1.2), 956 - (n * 1.2)),
                           radius=220 - n, outline=(87, 101, 121, alpha), width=2)
draw.rounded_rectangle((105, 158, 918, 854), radius=54,
                       fill=(27, 33, 43, 255), outline=(102, 115, 133, 255), width=6)
# Jogs
for cx in (324, 694):
    for rr, color, width in ((147, (6, 10, 16), 0), (137, (58, 70, 87), 4),
                             (122, (20, 27, 38), 0), (101, (111, 126, 144), 5),
                             (84, (33, 43, 56), 0), (60, (21, 30, 39), 0)):
        area = (cx - rr, 398 - rr, cx + rr, 398 + rr)
        if width: draw.ellipse(area, outline=color, width=width)
        else: draw.ellipse(area, fill=color)
    for k in range(42):
        theta = k * 2*pi/42
        c = (105, 122, 144, 230) if k%3 == 0 else (58, 73, 93, 210)
        r0, r1 = 113, 116
        draw.line((cx + r0*cos(theta),398+r0*sin(theta),
                   cx+r1*cos(theta),398+r1*sin(theta)), fill=c, width=2)
    draw.ellipse((cx-31,367,cx+31,429), fill=(35,48,63), outline=(117,140,158),width=2)
    draw.ellipse((cx-13,385,cx+13,411), fill=(20,26,35))
# Mixer and control readouts
draw.rounded_rectangle((461, 205, 558, 560), radius=18,fill=(14, 19, 28), outline=(76, 88, 107), width=3)
for y in (248, 300, 352):
    for x in (488, 530):
        draw.ellipse((x-11,y-11,x+11,y+11),fill=(43,53,67),outline=(137,151,171),width=2)
for x in (487, 532):
    draw.rounded_rectangle((x-4, 415, x+4, 541),radius=3,fill=(75,90,102))
    draw.rounded_rectangle((x-13, 482, x+13, 501),radius=4,fill=(216,220,227))
for k in range(5):
    col = (255,130,55) if k<3 else (55,212,239)
    draw.rounded_rectangle((479+k*12,192,485+k*12,198),radius=2,fill=col)
# Two pad arrays: orange on the left, cyan on the right
for deck, col in ((0,(255,144,61)), (1,(66,222,245))):
    start = 188 if deck==0 else 560
    for y in range(2):
        for x in range(4):
            px,py = start + x*74,638 + y*75
            box=(px,py,px+61,py+59)
            draw.rounded_rectangle((px-4,py-4,px+65,py+63),radius=9,
                                   fill=(int(col[0]*0.35),int(col[1]*0.35),int(col[2]*0.35),255))
            draw.rounded_rectangle(box,radius=6,fill=(26,34,47),outline=col,width=5)
            draw.rounded_rectangle((px+7,py+7,px+54,py+51),radius=4,
                                   fill=(int(col[0]*.25),int(col[1]*.25),int(col[2]*.25),255))
# Crossfader
draw.rounded_rectangle((435,785,583,794),radius=5,fill=(115,127,144))
draw.rounded_rectangle((495,775,525,805),radius=6,fill=(227,232,239))
# Highlight top glass.
draw.rounded_rectangle((128,176,898,195),radius=7,fill=(76,91,110,100))
draw.rounded_rectangle((127,847,903,866),radius=10,fill=(8,14,24,160))
preview = root / "FLX4Live2D.png"
art.save(preview)
iconset = root / "FLX4Live2D.iconset"
iconset.mkdir(exist_ok=True)
for base in (16,32,128,256,512):
    for scale in (1,2):
        pixels = base * scale
        name = f"icon_{base}x{base}{'@2x' if scale==2 else ''}.png"
        art.resize((pixels,pixels), Image.Resampling.LANCZOS).save(iconset / name)
print("Created",preview,iconset)
