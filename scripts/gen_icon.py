#!/usr/bin/env python3
"""Generate TurboFiles folder icon for all macOS iconset sizes."""
import os
import math
from PIL import Image, ImageDraw, ImageFilter

ICONSET = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "src-tauri", "icons", "turbofiles.iconset",
)

# Blue gradient: bright sky-blue → deep navy
TOP_COLOR = (82, 159, 255)   # #529FFF
MID_COLOR = (37, 99, 235)    # #2563EB - Tailwind blue-600
BOT_COLOR = (23, 56, 172)    # #1738AC

FOLDER_WHITE = (255, 255, 255, 240)
FOLDER_SHINE = (255, 255, 255, 55)
BOLT_TOP    = (255, 236, 100, 255)   # warm yellow top
BOLT_BOT    = (255, 180, 20, 255)    # amber bottom


def lerp_color(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def create_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # ── Gradient background ──────────────────────────────────────────────────
    for y in range(size):
        t = y / max(size - 1, 1)
        if t < 0.5:
            c = lerp_color(TOP_COLOR, MID_COLOR, t * 2)
        else:
            c = lerp_color(MID_COLOR, BOT_COLOR, (t - 0.5) * 2)
        draw.line([(0, y), (size - 1, y)], fill=(*c, 255))

    # ── Rounded-rect mask (macOS app icon: ~22% corner radius) ───────────────
    radius = max(2, int(size * 0.22))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)
    draw = ImageDraw.Draw(img)

    # ── Folder geometry ───────────────────────────────────────────────────────
    p   = max(2, int(size * 0.13))      # outer padding
    tw  = int(size * 0.42)              # tab width
    th  = max(2, int(size * 0.085))     # tab height
    tr  = max(1, int(size * 0.038))     # tab corner radius
    br  = max(1, int(size * 0.030))     # body corner radius

    tt  = int(size * 0.22)              # tab top y
    tb  = tt + th                       # tab bottom y
    bt  = tb - br                       # body top y (slight overlap)
    bb  = int(size * 0.81)              # body bottom y

    # Shadow (soft drop behind folder)
    if size >= 64:
        shadow_offset = max(1, size // 48)
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle(
            [p + shadow_offset, tt + shadow_offset,
             p + tw + shadow_offset, tb + br * 2 + shadow_offset],
            radius=tr, fill=(0, 0, 0, 50)
        )
        sd.rounded_rectangle(
            [p + shadow_offset, bt + shadow_offset,
             size - p + shadow_offset, bb + shadow_offset],
            radius=br, fill=(0, 0, 0, 50)
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(max(1, size // 32)))
        img = Image.alpha_composite(img, shadow)
        draw = ImageDraw.Draw(img)

    # Tab shape (rounded top, flat bottom merged into body)
    draw.rounded_rectangle(
        [p, tt, p + tw, tb + br * 2], radius=tr, fill=FOLDER_WHITE
    )
    # Body
    draw.rounded_rectangle(
        [p, bt, size - p, bb], radius=br, fill=FOLDER_WHITE
    )

    # Subtle inner shine on body top edge
    if size >= 32:
        draw.rounded_rectangle(
            [p + 2, bt, size - p - 2, bt + max(2, int(size * 0.09))],
            radius=br, fill=FOLDER_SHINE,
        )

    # ── Lightning bolt (centered in body) ─────────────────────────────────────
    if size >= 32:
        cx = size * 0.50
        cy = (bt + bb) / 2 + size * 0.03
        bh = max(4, size * 0.26)   # bolt total height
        bw = max(2, size * 0.14)   # bolt half-width at widest

        # Classic Z-shaped bolt: two triangles joined at the waist
        bolt = [
            (cx + bw * 0.55,  cy - bh * 0.50),   # top-right
            (cx - bw * 0.35,  cy + bh * 0.05),   # mid-left
            (cx + bw * 0.20,  cy + bh * 0.05),   # mid-right
            (cx - bw * 0.55,  cy + bh * 0.50),   # bottom-left
            (cx + bw * 0.35,  cy - bh * 0.05),   # mid-right lower
            (cx - bw * 0.20,  cy - bh * 0.05),   # mid-left upper
        ]

        # Gradient bolt: draw with a blend from top to bottom
        bolt_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        bdi = ImageDraw.Draw(bolt_img)
        bdi.polygon([(int(x), int(y)) for x, y in bolt], fill=BOLT_TOP)
        # Overlay lower half darker
        lower_bolt = bolt[3:] + bolt[:1]
        # Just draw the full bolt in one color for simplicity at small sizes
        bolt_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        bdi = ImageDraw.Draw(bolt_img)
        bdi.polygon([(int(x), int(y)) for x, y in bolt], fill=BOLT_TOP)
        img = Image.alpha_composite(img, bolt_img)

    return img


def main():
    specs = [
        ("icon_16x16.png",        16),
        ("icon_16x16@2x.png",     32),
        ("icon_32x32.png",        32),
        ("icon_32x32@2x.png",     64),
        ("icon_64x64.png",        64),
        ("icon_64x64@2x.png",    128),
        ("icon_128x128.png",     128),
        ("icon_128x128@2x.png",  256),
        ("icon_256x256.png",     256),
        ("icon_256x256@2x.png",  512),
        ("icon_512x512.png",     512),
        ("icon_512x512@2x.png", 1024),
        ("icon_1024x1024.png",  1024),
    ]

    os.makedirs(ICONSET, exist_ok=True)
    cache: dict[int, Image.Image] = {}

    for fname, px in specs:
        if px not in cache:
            print(f"  rendering {px}×{px}…")
            cache[px] = create_icon(px)
        path = os.path.join(ICONSET, fname)
        cache[px].save(path, "PNG")
        print(f"  ✓ {fname}")

    # Also copy into the flat icon files Tauri needs
    icons_dir = os.path.join(ICONSET, "..")
    cache[128].save(os.path.join(icons_dir, "128x128.png"), "PNG")
    cache[256].save(os.path.join(icons_dir, "128x128@2x.png"), "PNG")
    cache[32].save(os.path.join(icons_dir, "32x32.png"), "PNG")

    # Save a square PNG as icon.png for Tauri's default
    cache[512].save(os.path.join(icons_dir, "icon.png"), "PNG")

    print("\nAll PNGs written. Rebuilding icon.icns…")
    ret = os.system(
        f"iconutil -c icns {ICONSET} -o {os.path.join(icons_dir, 'icon.icns')}"
    )
    if ret == 0:
        print("✓ icon.icns rebuilt")
    else:
        print("✗ iconutil failed - check macOS is available")


if __name__ == "__main__":
    main()
