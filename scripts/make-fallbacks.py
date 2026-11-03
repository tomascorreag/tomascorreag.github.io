#!/usr/bin/env python3
"""
make-fallbacks.py: build the <img src> JPEG fallbacks from the lossless masters.

Masters live in assets-src/ (not deployed); fallbacks are written to the same
relative path under src/assets/ with a .jpg extension. The fallback is only
fetched by browsers that support neither AVIF nor WebP, so it's a lossy JPEG
at the master's resolution instead of a full-size PNG.

  - Opaque PNG master      -> JPEG
  - Transparent PNG master -> JPEG flattened onto the site background (--bg).
                              The WebP/AVIF siblings keep real transparency.
  - JPG/JPEG master        -> byte copy (re-encoding would only add loss)

Idempotent: skips outputs newer than their master unless --force.
Requires Pillow (pip install pillow).

Usage: python3 scripts/make-fallbacks.py [MASTERS_ROOT] [ASSETS_ROOT]
       defaults: assets-src  src/assets
"""
import argparse
import os
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("ERROR: Pillow not installed (python3 -m pip install pillow)")

# Same opt-outs as optimize-assets.sh: spritesheets are served as-is.
SKIP_PATTERNS = ("spritesheet", "maintitle_animated")
TIER_SUFFIXES = ("-480w", "-960w", "-1440w", "-1920w")


def parse_hex(color):
    color = color.lstrip("#")
    return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))


def has_transparency(im):
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        return im.convert("RGBA").getchannel("A").getextrema()[0] < 255
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("masters", nargs="?", default="assets-src")
    ap.add_argument("assets", nargs="?", default="src/assets")
    ap.add_argument("--bg", default=os.environ.get("FALLBACK_BG", "#0a0a0a"))
    ap.add_argument("--quality", type=int, default=int(os.environ.get("FALLBACK_Q", "85")))
    ap.add_argument("--force", action="store_true", default=os.environ.get("FORCE") == "1")
    ap.add_argument("--dry-run", action="store_true", default=os.environ.get("DRY_RUN") == "1")
    args = ap.parse_args()

    bg = parse_hex(args.bg)
    made = skipped = 0
    for dirpath, _, files in os.walk(args.masters):
        for name in sorted(files):
            stem, ext = os.path.splitext(name)
            ext = ext.lower()
            if ext not in (".png", ".jpg", ".jpeg"):
                continue
            src = os.path.join(dirpath, name)
            if stem.endswith(TIER_SUFFIXES) or any(p in src.lower() for p in SKIP_PATTERNS):
                continue

            rel_dir = os.path.relpath(dirpath, args.masters)
            out_ext = ext if ext in (".jpg", ".jpeg") else ".jpg"
            dst = os.path.normpath(os.path.join(args.assets, rel_dir, stem + out_ext))

            if not args.force and os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
                skipped += 1
                continue

            if ext in (".jpg", ".jpeg"):
                action = "copy"
            else:
                im = Image.open(src)
                im.load()
                action = "flatten" if has_transparency(im) else "jpeg"
            print(f"  FALLBACK  {src}  ->  {dst}  ({action})")
            if args.dry_run:
                continue

            os.makedirs(os.path.dirname(dst), exist_ok=True)
            tmp = dst + ".tmp"
            if action == "copy":
                shutil.copyfile(src, tmp)
            else:
                if action == "flatten":
                    canvas = Image.new("RGBA", im.size, bg + (255,))
                    canvas.alpha_composite(im.convert("RGBA"))
                    rgb = canvas.convert("RGB")
                else:
                    rgb = im.convert("RGB")
                save_kw = dict(format="JPEG", quality=args.quality, optimize=True,
                               progressive=True, subsampling="4:2:0")
                if im.info.get("icc_profile"):
                    save_kw["icc_profile"] = im.info["icc_profile"]
                rgb.save(tmp, **save_kw)
            os.replace(tmp, dst)
            made += 1

    print(f"Fallbacks: {made} written, {skipped} up-to-date")


if __name__ == "__main__":
    main()
