#!/usr/bin/env python3
"""
make-icons.py: PNG versions of public/favicon.svg ("TC", terminal green on
the site background) for clients that don't use SVG icons.

  public/apple-touch-icon.png  180x180  (iOS home screen; iOS rounds corners)
  public/favicon-32.png         32x32   (PNG favicon fallback)

Uses the site font (Martian Mono, bold) instead of the SVG's system
monospace stack, with a soft glow at the larger size.
Requires Pillow with FreeType. Usage: python3 scripts/make-icons.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "src/assets/fonts/MartianMono-latin.woff2")
BG = (10, 10, 10)          # --terminal-bg
GREEN = (108, 255, 108)    # --terminal-green


def render(size, glow):
    f = ImageFont.truetype(FONT, int(size * 0.42))
    f.set_variation_by_axes([700])
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    l, t, r, b = d.textbbox((0, 0), "TC", font=f)
    d.text(((size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t), "TC", font=f, fill=255)

    img = Image.new("RGBA", (size, size), BG + (255,))
    if glow:
        halo = Image.new("RGBA", (size, size), GREEN + (0,))
        halo.putalpha(mask.filter(ImageFilter.GaussianBlur(size * 0.04)).point(lambda v: v // 2))
        img.alpha_composite(halo)
    core = Image.new("RGBA", (size, size), GREEN + (0,))
    core.putalpha(mask)
    img.alpha_composite(core)
    return img.convert("RGB")


def main():
    for name, size, glow in (("apple-touch-icon.png", 180, True), ("favicon-32.png", 32, False)):
        out = os.path.join(ROOT, "public", name)
        render(size, glow).save(out, optimize=True)
        print(f"wrote {out} ({os.path.getsize(out)} B)")


if __name__ == "__main__":
    main()
