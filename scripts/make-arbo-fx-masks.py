#!/usr/bin/env python3
"""
Builds the emission masks and noise tile for the ARBO splash banner's light
effects (see src/config/arboSplash.js, `fx` nodes).

The splash art has its glows painted in, so the effects need to know where the
emissive pixels are. Each mask is keyed from its own layer's pixels by hue,
saturation and value, then softened. Output is white RGBA where alpha is the
emission strength, the format CSS `mask-image` reads (alpha mode).

Masks keep the source layer's aspect ratio, so the overlay can use the same
rect as the layer with `mask-size: contain`, like the layer's own <img>.

Writes masters into assets-src/thumbnails/Games/ARBO/splash/fx/; run
scripts/optimize-assets.sh afterwards to encode them.

Usage: python3 scripts/make-arbo-fx-masks.py
Requires Pillow (no numpy).
"""

import random
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-src/thumbnails/Games/ARBO/splash"
OUT = SRC / "fx"


def ramp(lo, hi):
    """LUT: 0 below lo, 255 above hi, linear between (0–255 inputs)."""
    def f(v):
        if v <= lo:
            return 0
        if v >= hi:
            return 255
        return round((v - lo) / (hi - lo) * 255)
    return f


def hue_band(h_lo, h_hi, soft):
    """LUT on PIL's 0–255 hue: 255 inside [h_lo, h_hi], fading over `soft`."""
    def f(h):
        if h_lo <= h <= h_hi:
            return 255
        d = min(abs(h - h_lo), abs(h - h_hi))
        return max(0, round(255 * (1 - d / soft)))
    return f


def key(layer, hue, sat, val, scale, blur):
    """Mask = hue band × saturation ramp × value ramp × layer alpha."""
    im = Image.open(SRC / layer).convert("RGBA")
    alpha = im.getchannel("A")
    h, s, v = im.convert("RGB").convert("HSV").split()
    m = ImageChops.multiply(h.point(hue_band(*hue)), s.point(ramp(*sat)))
    m = ImageChops.multiply(m, v.point(ramp(*val)))
    m = ImageChops.multiply(m, alpha)
    w, hgt = im.size
    m = m.resize((round(w * scale), round(hgt * scale)), Image.LANCZOS)
    m = m.filter(ImageFilter.GaussianBlur(blur))
    white = Image.new("L", m.size, 255)
    return Image.merge("RGBA", (white, white, white, m))


def noise_tile(size=256, octaves=(4, 8, 16, 32), seed=7):
    """Seamless value-noise tile (white RGBA, alpha = noise).

    Each octave is a random grid tiled 3×3, upscaled bicubically, and the
    centre tile cropped: its neighbours are copies of itself, so the edges
    interpolate into each other and the tile wraps without seams.
    """
    rnd = random.Random(seed)
    acc = Image.new("L", (size, size), 0)
    weight = 0.0
    for i, cells in enumerate(octaves):
        amp = 0.5 ** i
        grid = Image.new("L", (cells, cells))
        grid.putdata([rnd.randrange(256) for _ in range(cells * cells)])
        big = Image.new("L", (cells * 3, cells * 3))
        for gx in range(3):
            for gy in range(3):
                big.paste(grid, (gx * cells, gy * cells))
        big = big.resize((size * 3, size * 3), Image.BICUBIC)
        tile = big.crop((size, size, size * 2, size * 2))
        acc = Image.blend(acc, tile, amp / (weight + amp))
        weight += amp
    # Stretch contrast, then a power curve (γ 1.8) that darkens the mid
    # tones, so the flicker shows distinct bright tongues over dark gaps
    # rather than an even haze.
    lo, hi = acc.getextrema()
    # Clamp first: the LUT is evaluated for all 0–255, including v < lo.
    acc = acc.point(lambda v: round((min(1, max(0, (v - lo) / max(1, hi - lo))) ** 1.8) * 255))
    white = Image.new("L", acc.size, 255)
    return Image.merge("RGBA", (white, white, white, acc))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Fire in the background plate: orange to yellow, saturated, bright.
    # PIL hue 0–255 ≈ 0–360°: 0–40 ≈ 0–56°.
    key("BG.jpg", hue=(4, 38, 10), sat=(90, 170), val=(150, 235),
        scale=0.5, blur=2).save(OUT / "Fire_BG.png", optimize=True)
    # Laser beam and impact flare on the midground: cyan/blue, bright. Low
    # saturation is allowed so the white-hot core of the beam is included.
    key("Ground_02.png", hue=(115, 160, 20), sat=(25, 90), val=(170, 245),
        scale=0.5, blur=1.5).save(OUT / "Laser_Ground02.png", optimize=True)
    noise_tile().save(OUT / "Noise.png", optimize=True)
    print("wrote", ", ".join(p.name for p in sorted(OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
