#!/usr/bin/env python3
"""
make-motl-fonts.py: Spectral subsets for the Memory of the Land banner
(src/components/LandingBanner.js).

The banner mocks the MapColombia landing page, whose display type is Spectral.
It only ever shows a handful of fixed strings, so each weight is cut down to
just their glyphs (~4 KB each instead of ~23 KB). Spectral is OFL with no
Reserved Font Name, so subsetting is allowed; the licence ships alongside.

The mono lines use the site's own Martian Mono instead of IBM Plex Mono: at
banner size they render ~5 px tall, where the two are indistinguishable.

Keep TEXT in sync with the strings in LandingBanner.js. A glyph missing here
falls back to Georgia for that one letter.

Requires fonttools + brotli. Usage:
  python3 scripts/make-motl-fonts.py <dir with spectral-latin-*.woff2>
  (e.g. MapColombia/frontend/node_modules/@fontsource/spectral/files)
"""
import os
import sys

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src/assets/fonts")

TEXT = {
    # h1 + both archive titles
    "spectral-latin-600-normal.woff2": (
        "The Memory of the Land", "Scars of Violence", "Ashes of Death",
    ),
    # masthead sub + both archive descriptions
    "spectral-latin-400-italic.woff2": (
        "Two cartographic archives: human and ecological violence.",
        "The armed conflict, case by case",
        "Where and when the trees came down",
    ),
}
NAMES = {
    "spectral-latin-600-normal.woff2": "Spectral-600-motl.woff2",
    "spectral-latin-400-italic.woff2": "Spectral-400i-motl.woff2",
}


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    for name, strings in TEXT.items():
        text = "".join(sorted(set("".join(strings))))
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["kern", "liga"]
        opts.name_IDs = ["*"]  # keep copyright/licence name records
        font = subset.load_font(os.path.join(src, name), opts)
        s = subset.Subsetter(opts)
        s.populate(text=text)
        s.subset(font)
        dst = os.path.join(OUT, NAMES[name])
        subset.save_font(font, dst, opts)
        print(f"{NAMES[name]}: {os.path.getsize(dst)} bytes, {len(text)} chars")


if __name__ == "__main__":
    main()
