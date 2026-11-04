#!/usr/bin/env bash
# optimize-assets.sh
#
# Generates web-optimized variants for images and videos.
# Idempotent: skips any output that is newer than its source.
#
# Image masters (lossless png/jpg) live in assets-src/, which Vite never
# deploys. Every image output is written to the same relative path under
# src/assets/. Masters are never modified.
#
# What it does, in order, per asset:
#   1. Images (masters in MASTERS_DIR):
#      a. Generates full-size .webp / .avif (capped at MAX_IMG_DIM).
#      b. Generates responsive width tiers (foo-480w.webp, foo-960w.avif, ...)
#         for masters wider than each tier. variantsFor() in content.js picks
#         these up and builds srcset strings from them.
#      c. Generates the <img src> JPEG fallback via scripts/make-fallbacks.py
#         (transparent masters are flattened onto the site background; their
#         WebP keeps transparency). Only browsers without WebP/AVIF fetch it.
#   2. Videos (mp4/mov/m4v/webm):
#      a. Detects bloated "master" files (bitrate or resolution over caps) and
#         re-encodes them in place AFTER deriving the webm from the master —
#         never encode webm from an already-compressed file when a better
#         source exists (generational loss makes outputs LARGER, not smaller).
#      b. Ensures a webm (VP9) + mp4 (H.264) pair exists, capped to 1920x1080.
#      c. Inversion guard: a derived webm that comes out LARGER than its mp4 is
#         deleted (serving order prefers webm, so a fat webm is actively
#         harmful). A `<name>.webm.skip` marker prevents re-encoding it on
#         every subsequent run. Delete the marker to retry (e.g. after
#         replacing the mp4 with a better master).
#   3. Manifest: writes src/config/asset-dims.json mapping every thumbnail
#      (relative to src/assets/thumbnails/) to its pixel dimensions. Used by
#      utils/media.js for width/height attributes (CLS) and srcset descriptors.
#
# Spritesheets are excluded from resizing AND variant generation (see
# SKIP_PATTERNS): their width IS the animation data, and they're consumed via
# resolveThumbnail() as background-images where <picture> variants can't apply.
#
# Requirements:
#   - ffmpeg + ffprobe on PATH (macOS: `brew install ffmpeg`)
#     Videos need libx264, libvpx-vp9, libopus; images only use it to scale.
#   - cwebp + avifenc for image encodes (macOS: `brew install webp libavif`)
#   - python3 with Pillow, for image fallbacks (`python3 -m pip install pillow`)
#
# Usage:
#   bash scripts/optimize-assets.sh                # defaults to src/assets
#   bash scripts/optimize-assets.sh path/to/dir    # other output root
#
# Adding an image: put the lossless master in assets-src/thumbnails/..., run
# this script, and reference it from content.js with a .jpg extension
# (the fallback name; .jpeg masters keep .jpeg).
#
# Env vars (all optional):
#   MASTERS_DIR=assets-src Where image masters live (mirrors src/assets)
#   GEN_FALLBACKS=0        Skip MP4 fallbacks for videos (smaller repo)
#   GEN_POSTERS=0          Skip <name>-poster.jpg first-frame video posters
#   GEN_IMG_FALLBACKS=0    Skip JPEG <img> fallbacks for images
#   GEN_AVIF=0             Skip AVIF for images (slow encode — see note)
#   GEN_TIERS=0            Skip responsive width tiers
#   GEN_MANIFEST=0         Skip writing asset-dims.json
#   DRY_RUN=1              Print what would run, do nothing
#   FORCE=1                Re-encode even if output is newer than input
#
# Quality / size knobs (override via env):
#   WEBP_Q=82              WebP quality 0-100
#   AVIF_Q=60              AVIF colour quality 0-100 (avifenc -q)
#   AVIF_QA=90             AVIF alpha quality 0-100 (avifenc --qalpha)
#   VP9_CRF=32             WebM/VP9 CRF — lower = better, 30-35 typical
#   MP4_CRF=23             H.264 CRF — 18-24 typical
#   MAX_IMG_DIM=1920       Longest side of full-size image outputs
#   TIER_WIDTHS="480 960 1440"  Responsive tier widths (srcset)
#   VID_MAX_W=1920         Video width cap
#   VID_MAX_H=1080         Video height cap
#   MP4_MAX_KBPS=8000      Source mp4 above this bitrate = master needing re-encode
#
# AVIF inversion guard: an AVIF tier that comes out larger than its WebP
# sibling is deleted and gets a `<name>-<w>w.avif.skip` marker (AVIF browsers
# then pick the next AVIF candidate). The whole AVIF set is deleted, with a
# `<name>.avif.skip` marker, if the full-size AVIF is the larger one, or if
# no AVIF tiers would be left while WebP tiers exist — an AVIF srcset with
# only the full-size file would make phones download it instead of a small
# WebP tier. Delete a marker to retry.

set -euo pipefail

ASSETS_DIR="${1:-src/assets}"
MASTERS_DIR="${MASTERS_DIR:-assets-src}"
GEN_FALLBACKS="${GEN_FALLBACKS:-1}"
GEN_POSTERS="${GEN_POSTERS:-1}"
GEN_IMG_FALLBACKS="${GEN_IMG_FALLBACKS:-1}"
GEN_AVIF="${GEN_AVIF:-1}"
GEN_TIERS="${GEN_TIERS:-1}"
GEN_MANIFEST="${GEN_MANIFEST:-1}"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"

WEBP_Q="${WEBP_Q:-82}"
AVIF_Q="${AVIF_Q:-60}"     # avifenc colour quality 0-100
AVIF_QA="${AVIF_QA:-90}"   # avifenc alpha-plane quality (transparent masters)
VP9_CRF="${VP9_CRF:-32}"
MP4_CRF="${MP4_CRF:-23}"
MAX_IMG_DIM="${MAX_IMG_DIM:-1920}"
TIER_WIDTHS="${TIER_WIDTHS:-480 960 1440}"
VID_MAX_W="${VID_MAX_W:-1920}"
VID_MAX_H="${VID_MAX_H:-1080}"
# Threshold is deliberately generous: a dense 1080p clip can legitimately
# need ~8-9 Mbps at CRF 23, and re-encoding an already-encoded file is pure
# generation loss. This should only catch raw export masters (tens of Mbps).
MP4_MAX_KBPS="${MP4_MAX_KBPS:-10000}"

# Path fragments that opt a file out of resizing and variant generation.
# Spritesheets: width = animation frames; resizing destroys them, and they're
# used as background-image so <picture> variants are dead weight.
SKIP_PATTERNS=("spritesheet" "spriteSheet" "MainTitle_animated")

# ---- sanity checks ----

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ERROR: ffmpeg not found on PATH." >&2
  echo "  Windows:  winget install ffmpeg     (or: scoop install ffmpeg)" >&2
  echo "  macOS:    brew install ffmpeg" >&2
  echo "  Linux:    apt install ffmpeg" >&2
  exit 1
fi

HAVE_FFPROBE=0
if command -v ffprobe >/dev/null 2>&1; then
  HAVE_FFPROBE=1
fi

if [[ -d "$MASTERS_DIR" ]]; then
  for tool in cwebp avifenc; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "ERROR: $tool not found (macOS: brew install webp libavif)." >&2
      exit 1
    fi
  done
fi

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "ERROR: asset directory not found: $ASSETS_DIR" >&2
  exit 1
fi

if [[ "$GEN_IMG_FALLBACKS" == "1" ]] && ! python3 -c 'import PIL' >/dev/null 2>&1; then
  echo "ERROR: python3 with Pillow is required for image fallbacks." >&2
  echo "  python3 -m pip install pillow      (or set GEN_IMG_FALLBACKS=0)" >&2
  exit 1
fi

# ---- counters ----

IMG_CONVERTED=0
VID_CONVERTED=0
SKIPPED=0
FAILED=0

# ---- helpers ----

# needs_update SRC DST -> returns 0 if DST must be (re)built
needs_update() {
  local src="$1" dst="$2"
  [[ "$FORCE" == "1" ]] && return 0
  [[ ! -f "$dst" ]] && return 0
  # -nt: src newer than dst
  [[ "$src" -nt "$dst" ]] && return 0
  return 1
}

# Whether a path matches any SKIP_PATTERNS fragment (case-insensitive).
is_skipped_path() {
  local path_lc pattern
  path_lc="$(lower "$1")"
  for pattern in "${SKIP_PATTERNS[@]}"; do
    [[ "$path_lc" == *"$(lower "$pattern")"* ]] && return 0
  done
  return 1
}

run_ff() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] ffmpeg $*"
    return 0
  fi
  # -nostdin: prevents ffmpeg from reading stdin, which in a shell loop would
  # otherwise steal bytes from the `find | read` pipeline and corrupt filenames.
  if ffmpeg -nostdin -y -loglevel error -hide_banner "$@"; then
    return 0
  else
    return 1
  fi
}

# Run ffmpeg for an image encode. Tries a clean pass first; if it fails,
# retries once with error tolerance + metadata stripping to handle PNGs with
# malformed EXIF (common from Blender/older exporters). Only the retry drops
# metadata — clean files keep their EXIF/ICC intact.
# Args: <src> <dst> <encoder-specific out args...>
run_img_ff() {
  local src="$1" dst="$2"; shift 2
  if run_ff -i "$src" "$@" "$dst"; then
    return 0
  fi
  echo "    clean pass failed — retrying with -err_detect ignore_err + metadata strip" >&2
  # -err_detect ignore_err + -max_error_rate 1.0: tolerate malformed metadata.
  # -map_metadata -1: drop all metadata on output (avoids the bad EXIF trailing along).
  if run_ff -err_detect ignore_err -max_error_rate 1.0 -i "$src" \
      -map_metadata -1 "$@" "$dst"; then
    echo "    (recovered — metadata stripped on this file only)" >&2
    return 0
  fi
  echo "    FAILED: $src -> $dst" >&2
  # Remove the partial/zero-byte output ffmpeg left behind — otherwise the next
  # run's needs_update sees it as up-to-date and the failure becomes permanent
  # (and the broken variant would be served in preference to the source).
  rm -f "$dst"
  FAILED=$((FAILED + 1))
  return 1
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# ffprobe 9+ also prints each stream inside a "stream_groups" section, so the
# same line can appear twice (and with blank lines between). Keep the first
# non-empty line.
first_line() { awk 'NF { print; exit }'; }

# Read "WIDTHxHEIGHT" of the first video stream. Empty string on failure.
# Some AVIFs (alpha as an auxiliary item) print an extra empty field, e.g.
# "1542x1133x", so keep only the first two fields.
get_dims() {
  local src="$1"
  [[ "$HAVE_FFPROBE" != "1" ]] && { printf ''; return; }
  { ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 "$src" 2>/dev/null || true; } | first_line \
    | awk -F'x' 'NF >= 2 && $1 != "" && $2 != "" { print $1 "x" $2 }'
}

# Container-level bitrate in kbps (integer). Empty string on failure.
get_kbps() {
  local src="$1" bps
  [[ "$HAVE_FFPROBE" != "1" ]] && { printf ''; return; }
  bps="$({ ffprobe -v error -show_entries format=bit_rate -of csv=p=0 "$src" 2>/dev/null || true; } | first_line)"
  [[ -z "$bps" || "$bps" == "N/A" ]] && { printf ''; return; }
  printf '%s' $((bps / 1000))
}

# Read the source stream's pix_fmt via ffprobe. Empty string on failure.
get_pix_fmt() {
  local src="$1"
  [[ "$HAVE_FFPROBE" != "1" ]] && { printf ''; return; }
  { ffprobe -v error -select_streams v:0 \
    -show_entries stream=pix_fmt -of csv=p=0 "$src" 2>/dev/null || true; } | first_line
}

# Whether a pix_fmt string carries an alpha plane. Heuristic: contains 'a',
# or is pal8 (palettized, may have tRNS).
pix_fmt_has_alpha() {
  case "$1" in
    *a*|pal8) return 0 ;;
    *) return 1 ;;
  esac
}

# Classify whether source image uses transparency.
# Echoes one of: "transparent" | "opaque" | "unknown"
#   transparent = has alpha channel AND at least one non-fully-opaque pixel
#   opaque      = no alpha channel, OR alpha channel is all-fully-opaque
#   unknown     = detection failed (e.g. ffprobe missing, decode error)
#
# Why it matters: opaque masters are encoded from RGB (no wasted alpha plane).
classify_transparency() {
  local src="$1"
  if [[ "$HAVE_FFPROBE" != "1" ]]; then
    printf 'unknown'
    return
  fi
  local pix_fmt
  pix_fmt="$(get_pix_fmt "$src")"
  if ! pix_fmt_has_alpha "$pix_fmt"; then
    printf 'opaque'
    return
  fi
  # Alpha channel present — sample it. alphaextract gives the alpha plane,
  # format=gray normalizes to 8-bit so YMIN is always 0..255, signalstats
  # reports per-frame min/max via metadata filter.
  local ymin
  # -err_detect ignore_err: some PNGs carry malformed EXIF that aborts a
  # strict decode — tolerate it here, classification only needs the pixels.
  ymin="$(ffmpeg -nostdin -hide_banner -loglevel info \
          -err_detect ignore_err -max_error_rate 1.0 -i "$src" \
          -vf "alphaextract,format=gray,signalstats,metadata=mode=print" \
          -f null - 2>&1 | grep 'signalstats.YMIN=' | head -1 \
          | sed 's/.*YMIN=//' || true)"
  if [[ -z "$ymin" ]]; then
    printf 'unknown'
    return
  fi
  # YMIN==255 means every pixel is fully opaque despite having an alpha plane.
  if [[ "$ymin" -lt 255 ]]; then
    printf 'transparent'
  else
    printf 'opaque'
  fi
}

# ---- converters ----

# Scale filter for an image output. WIDTH empty = full size, capped so the
# longest side is at most MAX_IMG_DIM (only ever shrinks; 16-bit masters are
# brought down to 8-bit by the encoders' pix_fmt). Always returns a filter, so
# callers never expand an empty array (bash 3.2 + set -u errors on that).
img_scale_filter() {
  local width="${1:-}"
  if [[ -n "$width" ]]; then
    printf 'scale=%s:-2:flags=lanczos' "$width"
  else
    printf "scale='min(iw,%s)':'min(ih,%s)':force_original_aspect_ratio=decrease:flags=lanczos" \
      "$MAX_IMG_DIM" "$MAX_IMG_DIM"
  fi
}

# Image encodes: ffmpeg only scales (to a temp 8-bit PNG); the reference
# encoders do the compression. cwebp (libwebp) and avifenc (libavif) keep
# alpha, and don't depend on how ffmpeg was built (Homebrew's ffmpeg ships
# without libwebp/libaom).
#
# Pixel format comes from the caller's `img_pix_fmt` (rgb24 or rgba), set
# once per master in convert_image (bash locals are visible to callees).

# encode_image KIND SRC DST [WIDTH] — KIND webp|avif; WIDTH empty = full size (capped)
encode_image() {
  local kind="$1" src="$2" dst="$3" width="${4:-}"
  local fmt="${img_pix_fmt:-rgba}"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] ffmpeg $(img_scale_filter "$width") -> $fmt png -> $kind $dst"
    return 0
  fi
  local tmp="${dst}.tmp.png" ok=0
  if run_img_ff "$src" "$tmp" -vf "$(img_scale_filter "$width")" -pix_fmt "$fmt"; then
    if [[ "$kind" == "webp" ]]; then
      cwebp -quiet -q "$WEBP_Q" -m 6 "$tmp" -o "$dst" && ok=1
    else
      avifenc -q "$AVIF_Q" --qalpha "$AVIF_QA" -s 4 "$tmp" "$dst" >/dev/null && ok=1
    fi
  fi
  rm -f "$tmp"
  [[ "$ok" == "1" ]] && return 0
  echo "    FAILED: $src -> $dst ($kind)" >&2
  rm -f "$dst"
  FAILED=$((FAILED + 1))
  return 1
}

encode_webp() { encode_image webp "$@"; }
encode_avif() { encode_image avif "$@"; }

# check_avif_inversion BASE — see "AVIF inversion guard" in the header.
avif_larger_than_webp() {
  local a="$1" w="${1%.avif}.webp"
  [[ -f "$a" && -f "$w" ]] && (( $(file_size "$a") > $(file_size "$w") ))
}

check_avif_inversion() {
  local base="$1" a drop_all=0 keep_tiers=0 webp_tiers=0
  local inverted=()
  avif_larger_than_webp "$base.avif" && drop_all=1
  for a in "$base"-*w.avif; do
    [[ -f "$a" ]] || continue
    if avif_larger_than_webp "$a"; then
      inverted+=("$a")
    else
      keep_tiers=$((keep_tiers + 1))
    fi
  done
  for a in "$base"-*w.webp; do
    [[ -f "$a" ]] && webp_tiers=$((webp_tiers + 1))
  done
  (( keep_tiers == 0 && webp_tiers > 0 && ${#inverted[@]} > 0 )) && drop_all=1

  if [[ "$drop_all" == "1" ]]; then
    echo "  IMG  ${base#"$ASSETS_DIR"/}  (AVIF larger than WebP — deleting all AVIFs, marker: ${base##*/}.avif.skip)"
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "    [dry-run] rm $base.avif $base-*w.avif && touch $base.avif.skip"
    else
      rm -f "$base.avif" "$base"-*w.avif
      touch "$base.avif.skip"
    fi
    return 0
  fi
  # ${arr[@]+...}: bash 3.2 + set -u errors on expanding an empty array.
  for a in ${inverted[@]+"${inverted[@]}"}; do
    echo "  IMG  ${a#"$ASSETS_DIR"/}  (larger than its WebP — deleting, marker: ${a##*/}.skip)"
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "    [dry-run] rm $a && touch $a.skip"
    else
      rm -f "$a"
      touch "$a.skip"
    fi
  done
}

# convert_image MASTER — MASTER is a file under MASTERS_DIR; outputs go to
# the same relative path under ASSETS_DIR. The master is only read.
convert_image() {
  local src="$1"
  local rel="${src#"$MASTERS_DIR"/}"
  local base="$ASSETS_DIR/${rel%.*}"
  local webp="${base}.webp"
  local avif="${base}.avif"

  # Spritesheets etc.: generate nothing.
  if is_skipped_path "$src"; then
    return 0
  fi

  [[ "$DRY_RUN" == "1" ]] || mkdir -p "$(dirname "$base")"

  # Classify once (ffmpeg decode is expensive). Opaque masters encode from
  # RGB; transparent (or undetectable) ones keep their alpha plane.
  local alpha_class img_pix_fmt=rgba
  alpha_class="$(classify_transparency "$src")"
  [[ "$alpha_class" == "opaque" ]] && img_pix_fmt=rgb24

  # Tier decisions use the width of the full-size output (master capped at
  # MAX_IMG_DIM, aspect preserved).
  local dims src_w src_h
  dims="$(get_dims "$src")"
  src_w="${dims%x*}"; src_h="${dims#*x}"
  if [[ -n "$dims" && "$dims" == *x* ]] && (( src_w > MAX_IMG_DIM || src_h > MAX_IMG_DIM )); then
    if (( src_w >= src_h )); then
      src_w="$MAX_IMG_DIM"
    else
      src_w=$(( src_w * MAX_IMG_DIM / src_h ))
    fi
  fi

  if needs_update "$src" "$webp"; then
    echo "  IMG  $src  ->  ${webp#"$ASSETS_DIR"/}"
    if encode_webp "$src" "$webp"; then
      IMG_CONVERTED=$((IMG_CONVERTED + 1))
    fi
  else
    SKIPPED=$((SKIPPED + 1))
  fi

  # AVIF (avifenc keeps alpha, so transparent masters get one too).
  local do_avif=0
  if [[ "$GEN_AVIF" == "1" ]]; then
    if [[ -f "${base}.avif.skip" ]]; then
      SKIPPED=$((SKIPPED + 1))
    else
      do_avif=1
      if needs_update "$src" "$avif"; then
        echo "  IMG  $src  ->  ${avif##*/}"
        if encode_avif "$src" "$avif"; then
          IMG_CONVERTED=$((IMG_CONVERTED + 1))
        fi
      else
        SKIPPED=$((SKIPPED + 1))
      fi
    fi
  fi

  # Responsive width tiers: foo-480w.webp, foo-480w.avif, ... only for tiers
  # meaningfully narrower than the source (no point emitting a 960w tier of a
  # 1000px image). These feed srcset width descriptors in utils/media.js —
  # think mipmaps: the browser picks the smallest level that covers the
  # on-screen size at the device's pixel ratio.
  if [[ "$GEN_TIERS" == "1" && -n "$dims" && "$dims" == *x* ]]; then
    local tier
    for tier in $TIER_WIDTHS; do
      # Require some real distance from the source width (1.25x) so we don't
      # generate near-duplicates of the full-size variant.
      if (( src_w > tier * 5 / 4 )); then
        local tier_webp="${base}-${tier}w.webp"
        if needs_update "$src" "$tier_webp"; then
          echo "  IMG  $src  ->  ${tier_webp##*/}"
          if encode_webp "$src" "$tier_webp" "$tier"; then
            IMG_CONVERTED=$((IMG_CONVERTED + 1))
          fi
        else
          SKIPPED=$((SKIPPED + 1))
        fi
        local tier_avif="${base}-${tier}w.avif"
        if [[ "$do_avif" == "1" && -f "${tier_avif}.skip" ]]; then
          SKIPPED=$((SKIPPED + 1))
        elif [[ "$do_avif" == "1" ]]; then
          if needs_update "$src" "$tier_avif"; then
            echo "  IMG  $src  ->  ${tier_avif##*/}"
            if encode_avif "$src" "$tier_avif" "$tier"; then
              IMG_CONVERTED=$((IMG_CONVERTED + 1))
            fi
          else
            SKIPPED=$((SKIPPED + 1))
          fi
        fi
      fi
    done
  fi

  [[ "$do_avif" == "1" ]] && check_avif_inversion "$base"
  return 0
}

# Shared scale filter for all video encodes: fit inside VID_MAX_W x VID_MAX_H,
# only ever shrinking (min() keeps the box within the source), even dimensions
# for yuv420p chroma subsampling.
VID_SCALE="scale=w='min(iw,${VID_MAX_W})':h='min(ih,${VID_MAX_H})':force_original_aspect_ratio=decrease:force_divisible_by=2"

encode_webm() {
  local src="$1" dst="$2"
  # Two-pass would be better for size at fixed quality, but CRF mode is
  # "good enough" and 2x faster. -row-mt enables multithreaded encoding.
  # -deadline good balances speed/quality (vs. "best" which is much slower).
  run_ff -i "$src" \
    -vf "$VID_SCALE" \
    -c:v libvpx-vp9 -crf "$VP9_CRF" -b:v 0 \
    -row-mt 1 -deadline good -cpu-used 2 \
    -c:a libopus -b:a 96k \
    "$dst"
}

encode_mp4() {
  local src="$1" dst="$2"
  # yuv420p + faststart = widest compatibility (iOS Safari, old Androids,
  # streaming-friendly moov atom at the front of the file).
  run_ff -i "$src" \
    -vf "$VID_SCALE" \
    -c:v libx264 -crf "$MP4_CRF" -preset medium \
    -pix_fmt yuv420p -movflags +faststart \
    -c:a aac -b:a 128k \
    "$dst"
}

# BSD stat (macOS) uses -f %z; GNU stat (Linux, git-bash) uses -c %s.
file_size() { stat -f %z "$1" 2>/dev/null || stat -c %s "$1" 2>/dev/null || echo 0; }

convert_video() {
  local src="$1"
  local ext
  ext="$(lower "${src##*.}")"
  local base="${src%.*}"
  local webm="${base}.webm"
  local mp4="${base}.mp4"

  # ── Bloated-master handling ───────────────────────────────────────────
  # A "master" is a source file (either container) whose bitrate or
  # resolution is way past web-appropriate (e.g. a raw render export).
  # Order matters: derive the COMPLEMENT from the master FIRST (best source
  # = best encode), then re-encode the master itself in place. Both outputs
  # come from the original pixels; nothing is encoded from an
  # already-compressed file.
  local kbps vdims vw vh oversized=0
  kbps="$(get_kbps "$src")"
  vdims="$(get_dims "$src")"
  vw="${vdims%x*}"; vh="${vdims#*x}"
  [[ -n "$vdims" && "$vdims" == *x* ]] && (( vw > VID_MAX_W || vh > VID_MAX_H )) && oversized=1
  if [[ -n "$kbps" ]] && (( kbps > MP4_MAX_KBPS )) || [[ "$oversized" == "1" ]]; then
    echo "  VID  $src  (master: ${vdims:-?} @ ${kbps:-?}kbps — re-encoding pair from it)"
    # 1. The complement, straight from the master.
    if [[ "$ext" == "webm" ]]; then
      if [[ "$GEN_FALLBACKS" == "1" ]]; then
        echo "  VID  $src  ->  ${mp4##*/} (from master)"
        if encode_mp4 "$src" "$mp4"; then
          VID_CONVERTED=$((VID_CONVERTED + 1))
        else
          echo "    FAILED: $src -> $mp4" >&2
          rm -f "$mp4"
          FAILED=$((FAILED + 1))
        fi
      fi
    elif [[ ! -f "${webm}.skip" ]]; then
      echo "  VID  $src  ->  ${webm##*/} (from master)"
      if encode_webm "$src" "$webm"; then
        VID_CONVERTED=$((VID_CONVERTED + 1))
      else
        echo "    FAILED: $src -> $webm" >&2
        rm -f "$webm"
        FAILED=$((FAILED + 1))
      fi
    fi
    # 2. Re-encode the master in place (atomic temp+mv).
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "    [dry-run] re-encode master in place: $src"
    else
      local mtmp="${base}.master.tmp.${ext}"
      echo "  VID  $src  (master re-encode in place)"
      local ok=0
      if [[ "$ext" == "webm" ]]; then
        encode_webm "$src" "$mtmp" && ok=1
      else
        encode_mp4 "$src" "$mtmp" && ok=1
      fi
      if [[ "$ok" == "1" ]]; then
        mv "$mtmp" "$src"
        # The master is now the newest file of the pair, which would make
        # the next run treat the derived complement as the "source". Touch
        # the complement so mtime ordering reflects reality.
        if [[ "$ext" == "webm" ]]; then
          [[ -f "$mp4" ]] && touch "$mp4"
        else
          [[ -f "$webm" ]] && touch "$webm"
        fi
        VID_CONVERTED=$((VID_CONVERTED + 1))
      else
        rm -f "$mtmp"
        echo "    FAILED master re-encode: $src" >&2
        FAILED=$((FAILED + 1))
      fi
    fi
    check_webm_inversion "$base"
    ensure_poster "$base"
    return 0
  fi

  # ── Normal flow: ensure the complement of the pair exists ─────────────

  # Primary: ensure a WebM exists (VP9). Skip if source already is webm.
  if [[ "$ext" != "webm" && ! -f "${webm}.skip" ]]; then
    if needs_update "$src" "$webm"; then
      echo "  VID  $src  ->  ${webm##*/}"
      if encode_webm "$src" "$webm"; then
        VID_CONVERTED=$((VID_CONVERTED + 1))
      else
        echo "    FAILED: $src -> $webm" >&2
        rm -f "$webm"   # don't leave a partial output masking the failure
        FAILED=$((FAILED + 1))
      fi
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  fi

  # Fallback: ensure an MP4 (H.264) exists alongside.
  if [[ "$GEN_FALLBACKS" == "1" && "$ext" != "mp4" ]]; then
    if needs_update "$src" "$mp4"; then
      echo "  VID  $src  ->  ${mp4##*/}"
      if encode_mp4 "$src" "$mp4"; then
        VID_CONVERTED=$((VID_CONVERTED + 1))
      else
        echo "    FAILED: $src -> $mp4" >&2
        rm -f "$mp4"    # don't leave a partial output masking the failure
        FAILED=$((FAILED + 1))
      fi
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  fi

  check_webm_inversion "$base"
  ensure_poster "$base"
}

# ensure_poster BASE — <name>-poster.jpg: the video's first frame, ≤960px
# wide. content.js variantsFor() picks it up as the <video poster>. First
# frame (not a "best" frame) so the swap to playback doesn't jump.
ensure_poster() {
  local base="$1" poster="$1-poster.jpg" src=""
  [[ "$GEN_POSTERS" == "1" ]] || return 0
  local f
  for f in "$base.mp4" "$base.webm" "$base.mov" "$base.m4v"; do
    [[ -f "$f" ]] && { src="$f"; break; }
  done
  [[ -n "$src" ]] || return 0
  needs_update "$src" "$poster" || { SKIPPED=$((SKIPPED + 1)); return 0; }
  echo "  VID  $src  ->  ${poster##*/}"
  if run_ff -i "$src" -frames:v 1 -vf "scale='min(iw,960)':-2:flags=lanczos" -q:v 4 "$poster"; then
    VID_CONVERTED=$((VID_CONVERTED + 1))
  else
    echo "    FAILED: poster for $src" >&2
    rm -f "$poster"
    FAILED=$((FAILED + 1))
  fi
}

# If a webm ended up larger than its mp4 sibling, delete it and leave a
# marker so it isn't expensively re-encoded (and re-deleted) every run.
# Why this happens: VP9 encoding from an already-compressed H.264 file spends
# bits reproducing H.264's artifacts — generational loss can make the "better"
# codec's output bigger (and the reverse for an mp4 derived from a lean webm
# master). Serving order prefers webm, so keeping a fat one would make every
# visitor download MORE bytes than the mp4 they'd otherwise get. This also
# fires when the webm is the pair's SOURCE: the mp4 was derived from it, the
# original stays in git history, and serving the smaller file wins.
check_webm_inversion() {
  local base="$1"
  local webm="$base.webm" mp4="$base.mp4"
  [[ -f "$webm" && -f "$mp4" ]] || return 0
  local webm_size mp4_size
  webm_size="$(file_size "$webm")"
  mp4_size="$(file_size "$mp4")"
  if (( webm_size > mp4_size )); then
    local role="derived"
    [[ "$webm" -ot "$mp4" ]] && role="source — original recoverable from git"
    echo "  VID  $webm  (webm ${webm_size}B > mp4 ${mp4_size}B [$role] — deleting, marker: ${webm##*/}.skip)"
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "    [dry-run] rm $webm && touch ${webm}.skip"
    else
      rm -f "$webm"
      touch "${webm}.skip"
    fi
  fi
}

# ---- main walk ----

echo "Image masters: $MASTERS_DIR    outputs + videos: $ASSETS_DIR"
echo "  video_fallbacks=$GEN_FALLBACKS  img_fallbacks=$GEN_IMG_FALLBACKS  avif=$GEN_AVIF  tiers=$GEN_TIERS  dry_run=$DRY_RUN  force=$FORCE"
echo

# For a video pair (foo.mp4 + foo.webm), return 0 if $1 is the "source" —
# the file that should be used as input. The source is the older of the two
# (assumption: we generated the newer one on a previous run). If only one
# exists, it's the source.
is_video_source() {
  local file="$1"
  local base="${file%.*}"
  local mp4="$base.mp4" webm="$base.webm"
  # If the complement doesn't exist, this file is the only source.
  [[ ! -f "$mp4" || ! -f "$webm" ]] && return 0
  # Both exist: the older one is the original source.
  if [[ "$mp4" -ot "$webm" ]]; then
    [[ "$file" == "$mp4" ]] && return 0 || return 1
  else
    [[ "$file" == "$webm" ]] && return 0 || return 1
  fi
}

# Tier outputs look like image sources to the walk (foo-480w.webp is webp →
# skipped anyway; but guard against future tier formats matching the source
# extensions).
is_tier_file() {
  case "$1" in
    *-480w.*|*-960w.*|*-1440w.*|*-1920w.*) return 0 ;;
    *) return 1 ;;
  esac
}

# -print0 / read -d '' handles spaces and weird filenames safely.

# Images: masters only. Everything image-shaped under ASSETS_DIR is an output
# (or a spritesheet served as-is) and is never fed back in.
if [[ -d "$MASTERS_DIR" ]]; then
  while IFS= read -r -d '' file; do
    is_tier_file "$file" && continue
    case "$(lower "${file##*.}")" in
      png|jpg|jpeg) convert_image "$file" ;;
    esac
  done < <(find "$MASTERS_DIR" -type f -print0)

  if [[ "$GEN_IMG_FALLBACKS" == "1" ]]; then
    echo
    if ! python3 "$(dirname "$0")/make-fallbacks.py" "$MASTERS_DIR" "$ASSETS_DIR"; then
      echo "    FAILED: image fallbacks" >&2
      FAILED=$((FAILED + 1))
    fi
  fi
else
  echo "  (no masters dir at $MASTERS_DIR — skipping images)"
fi

# Videos: still live in ASSETS_DIR. mp4/mov/m4v are always candidates. webm
# may be either a user-supplied original or something we generated; resolve
# via mtime.
while IFS= read -r -d '' file; do
  case "$(lower "${file##*.}")" in
    mp4|mov|m4v|webm)
      if is_video_source "$file"; then
        convert_video "$file"
      fi
      ;;
  esac
done < <(find "$ASSETS_DIR" -type f -print0)

# ---- dimension manifest ----
# Maps every thumbnail (path relative to src/assets/thumbnails/, forward
# slashes) to [width, height]. utils/media.js uses it to set width/height
# attributes (prevents layout shift — the browser can reserve space before
# the image decodes) and to label srcset entries with real pixel widths.
# Tier files are excluded: their widths are known by construction.
THUMBS_DIR="$ASSETS_DIR/thumbnails"
MANIFEST="src/config/asset-dims.json"
if [[ "$GEN_MANIFEST" == "1" && -d "$THUMBS_DIR" && "$HAVE_FFPROBE" == "1" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] would write $MANIFEST"
  else
    echo
    echo "Writing $MANIFEST"
    {
      echo "{"
      first=1
      while IFS= read -r -d '' f; do
        is_tier_file "$f" && continue
        ext="$(lower "${f##*.}")"
        case "$ext" in
          png|jpg|jpeg|webp|avif|mp4|webm) ;;
          *) continue ;;
        esac
        dims="$(get_dims "$f")"
        [[ -z "$dims" || "$dims" != *x* ]] && continue
        rel="${f#"$THUMBS_DIR"/}"
        rel="${rel//\\//}"
        [[ "$first" == "1" ]] || echo ","
        first=0
        printf '  "%s": [%s, %s]' "$rel" "${dims%x*}" "${dims#*x}"
      done < <(find "$THUMBS_DIR" -type f -print0 | sort -z)
      echo
      echo "}"
    } > "$MANIFEST.tmp"
    mv -f "$MANIFEST.tmp" "$MANIFEST"
  fi
fi

echo
echo "Done."
echo "  images converted: $IMG_CONVERTED"
echo "  videos converted: $VID_CONVERTED"
echo "  up-to-date:       $SKIPPED"
echo "  failed:           $FAILED"

[[ "$FAILED" -gt 0 ]] && exit 1 || exit 0
