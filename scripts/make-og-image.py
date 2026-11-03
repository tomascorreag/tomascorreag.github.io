#!/usr/bin/env python3
"""
make-og-image.py: render the social preview card (public/og-image.png).

1200x630 terminal card: the rabbit's idle frame above "> Tomás Correa" /
"Technical Artist█", with the site's CRT treatment (RGB split, 3-layer glow,
slight blur, scanlines, vignette). Values mirror src/config/crt.js and the
.crt-effects rules in src/style.css, scaled up where needed so the effect
survives the ~0.4x downscale of a LinkedIn/Slack card.

Everything sits inside the centred 630x630 square, because WhatsApp/iMessage
crop the card to a square.

Requires Pillow with FreeType (reads the site's woff2 font directly).
Usage: python3 scripts/make-og-image.py [OUT]   (default public/og-image.png)
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "src/assets/fonts/MartianMono-latin.woff2")
SPRITE = os.path.join(ROOT, "src/assets/spritesheets/RabbitAnimation_V1.png")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "public/og-image.png")

W, H = 1200, 630

# The terminal carries filter: brightness(2) on the site, which lifts both the
# background (#0a0a0a) and the text (#6cff6c). Bake that in.
BG = (20, 20, 20)
TEXT = (216, 255, 216)
TEXT_DIM = (170, 210, 170)          # --text-secondary: 75% of the primary
GLOW = (102, 255, 102)              # --glow-color rgba(51,255,51,.5) after brightness
GLOW_ALPHA = 0.5
RGB_OFFSET = 2                      # crt.js rgbOffset
RGB_ALPHA = 0.75                    # crt.js rgbIntensity
SCANLINE_PITCH, SCANLINE_SIZE, SCANLINE_ALPHA = 4, 2, 0.25   # crt.js
VIGNETTE_START, VIGNETTE_ALPHA = 0.40, 0.30                    # crt.js

RABBIT_FRAME = (512, 0, 544, 64)    # idle frame (animations.js frames.idle)
# The rabbit only fills ~15x18 px of its 32x64 frame; it's cropped to that
# and scaled 8x (site uses 4x on the full frame) so it reads at card size.
RABBIT_SCALE = 8


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_axes([weight])
    return f


def solid(color, alpha_mask, opacity=1.0):
    """RGBA layer of one colour, alpha from a mask scaled by opacity."""
    layer = Image.new("RGBA", alpha_mask.size, color + (0,))
    layer.putalpha(alpha_mask.point(lambda v: int(v * opacity)))
    return layer


def crt_glow(mask, glow_color, radii, alphas, rgb_offset, rgb_alpha):
    """Site text-shadow stack: glow layers, then the red/blue split. The core
    is composited on top by the caller."""
    out = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    for r, a in zip(radii, alphas):
        out.alpha_composite(solid(glow_color, mask.filter(ImageFilter.GaussianBlur(r)), a))
    if rgb_offset:
        out.alpha_composite(solid((255, 0, 0), ImageChops.offset(mask, -rgb_offset, 0), rgb_alpha))
        out.alpha_composite(solid((0, 0, 255), ImageChops.offset(mask, rgb_offset, 0), rgb_alpha))
    return out


def main():
    img = Image.new("RGBA", (W, H), BG + (255,))

    # ---- layout ----
    f_name = font(56, 700)
    f_title = font(34, 400)
    line1 = "> Tomás Correa"
    line2 = "Technical Artist"
    # The site's cursor is "█", which the latin font subset doesn't contain,
    # so it's drawn as a block one character wide.
    cursor_w = f_title.getlength("M")
    w1 = f_name.getlength(line1)
    w2 = f_title.getlength(line2) + cursor_w
    block_w = max(w1, w2)

    rabbit = Image.open(SPRITE).convert("RGBA").crop(RABBIT_FRAME)
    rabbit = rabbit.crop(rabbit.getchannel("A").getbbox())
    rabbit = rabbit.resize((rabbit.width * RABBIT_SCALE, rabbit.height * RABBIT_SCALE), Image.NEAREST)

    gap_rabbit, gap_lines = 36, 22
    asc1 = f_name.getbbox("Tg")
    asc2 = f_title.getbbox("Tg")
    h1, h2 = asc1[3] - asc1[1], asc2[3] - asc2[1]
    total_h = rabbit.height + gap_rabbit + h1 + gap_lines + h2
    top = (H - total_h) // 2
    left = int((W - block_w) // 2)

    # ---- text ----
    text_mask = Image.new("L", (W, H), 0)
    text_rgb = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dm, dc = ImageDraw.Draw(text_mask), ImageDraw.Draw(text_rgb)
    y1 = top + rabbit.height + gap_rabbit - asc1[1]
    y2 = top + rabbit.height + gap_rabbit + h1 + gap_lines - asc2[1]
    for d, fill1, fill2 in ((dm, 255, 255), (dc, TEXT + (255,), TEXT_DIM + (255,))):
        d.text((left, y1), line1, font=f_name, fill=fill1)
        d.text((left, y2), line2, font=f_title, fill=fill2)
        cx = left + f_title.getlength(line2) + 4
        cy = top + rabbit.height + gap_rabbit + h1 + gap_lines
        d.rectangle((cx, cy, cx + cursor_w - 6, cy + h2), fill=fill1)

    glow = crt_glow(text_mask, GLOW, radii=(5, 15, 30),
                    alphas=(GLOW_ALPHA, GLOW_ALPHA, GLOW_ALPHA),
                    rgb_offset=RGB_OFFSET, rgb_alpha=RGB_ALPHA)
    img.alpha_composite(glow)
    img.alpha_composite(text_rgb.filter(ImageFilter.GaussianBlur(0.6)))

    # ---- rabbit (sprite rule: dimmer RGB split, white glow, brightness 1.25) ----
    rx = (W - rabbit.width) // 2
    rabbit_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rabbit_layer.paste(rabbit, (rx, top), rabbit)
    rabbit_mask = rabbit_layer.getchannel("A")
    rglow = crt_glow(rabbit_mask, (255, 255, 255), radii=(5, 15, 30),
                     alphas=(0.5, 0.4, 0.25),
                     rgb_offset=RGB_OFFSET, rgb_alpha=RGB_ALPHA * 0.4)
    img.alpha_composite(rglow)
    bright = rabbit_layer.point(lambda v: min(255, int(v * 1.25)))
    bright.putalpha(rabbit_mask)
    img.alpha_composite(bright.filter(ImageFilter.GaussianBlur(0.5)))

    # ---- scanlines ----
    scan = Image.new("L", (W, H), 0)
    ds = ImageDraw.Draw(scan)
    a = int(255 * SCANLINE_ALPHA)
    for y in range(SCANLINE_PITCH - SCANLINE_SIZE, H, SCANLINE_PITCH):
        ds.rectangle((0, y, W, y + SCANLINE_SIZE - 1), fill=a)
    img.alpha_composite(solid((0, 0, 0), scan))

    # ---- vignette: transparent until 40% of the ellipse, then to 30% black ----
    vig = Image.new("L", (W, H), 0)
    px = vig.load()
    for y in range(H):
        ny = (y - H / 2) / (H / 2)
        for x in range(W):
            nx = (x - W / 2) / (W / 2)
            d = min(1.0, (nx * nx + ny * ny) ** 0.5 / 2 ** 0.5)
            t = max(0.0, (d - VIGNETTE_START) / (1 - VIGNETTE_START))
            px[x, y] = int(255 * VIGNETTE_ALPHA * t)
    img.alpha_composite(solid((0, 0, 0), vig))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.convert("RGB").save(OUT, optimize=True)
    print(f"wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB), text block {block_w:.0f}px wide")


if __name__ == "__main__":
    main()
