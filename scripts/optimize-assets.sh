#!/usr/bin/env bash
# optimize-assets.sh
#
# Walks src/assets/ and generates web-optimized variants for images and videos.
# Idempotent: skips any output that is newer than its source.
#
# Output layout (siblings next to each source file):
#   foo.png  -> foo.webp  foo.avif
#   bar.mp4  -> bar.webm  (and keeps bar.mp4 as fallback)
#   baz.webm -> baz.mp4   (fallback generated)
#
# Requirements:
#   - ffmpeg on PATH (Windows: `winget install ffmpeg` or scoop/choco)
#     Must include libvpx-vp9, libaom-av1, libx264. Standard builds ship these.
#
# Usage:
#   bash scripts/optimize-assets.sh                # defaults to src/assets
#   bash scripts/optimize-assets.sh path/to/dir    # other root
#
# Env vars (all optional):
#   GEN_FALLBACKS=0        Skip MP4 fallbacks for videos (smaller repo)
#   GEN_AVIF=0             Skip AVIF for images (slow encode — see note)
#   STRIP_UNUSED_ALPHA=0   Don't modify PNGs whose alpha channel is fully opaque
#                          (default: 1 = strip. This MODIFIES SOURCE FILES in
#                          place, preserving bit depth. Idempotent: once stripped,
#                          re-runs are a no-op.)
#   DRY_RUN=1              Print what would run, do nothing
#   FORCE=1                Re-encode even if output is newer than input
#
# Quality knobs (override via env):
#   WEBP_Q=82              WebP quality 0-100
#   AVIF_CRF=30            AVIF CRF — lower = better, 28-34 is web-appropriate
#   VP9_CRF=32             WebM/VP9 CRF — lower = better, 30-35 typical
#   MP4_CRF=23             H.264 CRF — 18-24 typical
#
# Note on AVIF: ffmpeg + libaom is slow (seconds to tens of seconds per image).
# If you have many images and want speed, install `avifenc` (libavif) separately
# and swap the convert_avif function. WebP alone covers ~98% of browsers.

set -euo pipefail

ASSETS_DIR="${1:-src/assets}"
GEN_FALLBACKS="${GEN_FALLBACKS:-1}"
GEN_AVIF="${GEN_AVIF:-1}"
STRIP_UNUSED_ALPHA="${STRIP_UNUSED_ALPHA:-1}"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"

WEBP_Q="${WEBP_Q:-82}"
AVIF_CRF="${AVIF_CRF:-30}"
VP9_CRF="${VP9_CRF:-32}"
MP4_CRF="${MP4_CRF:-23}"

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

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "ERROR: asset directory not found: $ASSETS_DIR" >&2
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
  FAILED=$((FAILED + 1))
  return 1
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Read the source stream's pix_fmt via ffprobe. Empty string on failure.
get_pix_fmt() {
  local src="$1"
  [[ "$HAVE_FFPROBE" != "1" ]] && { printf ''; return; }
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=pix_fmt -of csv=p=0 "$src" 2>/dev/null || true
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
# Why it matters:
#   - AVIF via ffmpeg+libaom silently drops alpha → must skip AVIF for transparent.
#   - A PNG with an unused alpha plane wastes bytes → we can strip it losslessly.
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
  ymin="$(ffmpeg -nostdin -hide_banner -loglevel info -i "$src" \
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

# Strip the alpha channel from a PNG in place, preserving bit depth.
# 8-bit rgba → rgb24, 16-bit rgba64* → rgb48be. Atomic via temp+mv.
# Caller should only invoke when alpha is known-unused (classify=opaque but
# source pix_fmt carries alpha).
strip_alpha_png() {
  local src="$1"
  local pix_fmt out_fmt
  pix_fmt="$(get_pix_fmt "$src")"
  # 16-bit RGBA formats in ffmpeg are named rgba64be/rgba64le. Any '64' in the
  # pix_fmt reliably signals 16-bit-per-channel for the formats we handle here.
  case "$pix_fmt" in
    *64*) out_fmt="rgb48be" ;;
    *)    out_fmt="rgb24" ;;
  esac
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] strip alpha: $src ($pix_fmt -> $out_fmt)"
    return 0
  fi
  local tmp="${src}.stripalpha.tmp.png"
  if ffmpeg -nostdin -y -loglevel error -hide_banner \
      -i "$src" -pix_fmt "$out_fmt" "$tmp"; then
    mv "$tmp" "$src"
    return 0
  else
    rm -f "$tmp"
    return 1
  fi
}

# ---- converters ----

convert_image() {
  local src="$1"
  local base="${src%.*}"
  local webp="${base}.webp"
  local avif="${base}.avif"

  # Don't recompress something that is already webp/avif back into itself.
  local ext
  ext="$(lower "${src##*.}")"

  # Classify once (ffmpeg decode is expensive, and we need the answer twice:
  # for the alpha-strip decision and the AVIF-skip decision).
  local alpha_class="opaque"
  if [[ "$ext" == "png" || "$ext" == "jpg" || "$ext" == "jpeg" ]]; then
    alpha_class="$(classify_transparency "$src")"
  fi

  # Strip fully-opaque alpha channels on PNG sources. Saves ~5-15% on disk
  # and removes the AVIF-skip penalty for PNGs that only had alpha out of
  # habit. Gated by STRIP_UNUSED_ALPHA (default on). Modifies source in place.
  if [[ "$STRIP_UNUSED_ALPHA" == "1" && "$ext" == "png" && "$alpha_class" == "opaque" ]]; then
    local src_pix_fmt
    src_pix_fmt="$(get_pix_fmt "$src")"
    if pix_fmt_has_alpha "$src_pix_fmt"; then
      echo "  ALPHA  $src  (unused alpha — stripping)"
      if ! strip_alpha_png "$src"; then
        echo "    FAILED to strip alpha: $src" >&2
        FAILED=$((FAILED + 1))
      fi
    fi
  fi

  if [[ "$ext" != "webp" ]]; then
    if needs_update "$src" "$webp"; then
      echo "  IMG  $src  ->  ${webp##*/}"
      if run_img_ff "$src" "$webp" -quality "$WEBP_Q" -compression_level 6; then
        IMG_CONVERTED=$((IMG_CONVERTED + 1))
      fi
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  fi

  if [[ "$GEN_AVIF" == "1" && "$ext" != "avif" ]]; then
    # Skip AVIF when the source has real transparency. ffmpeg+libaom silently
    # drops alpha and emits a single-stream yuv420p AVIF, producing a black
    # background where transparency should be. WebP handles alpha correctly
    # and is the <picture> fallback, so skipping is functionally fine.
    # Unknown alpha class (detection failed) also skips — safer than risking
    # a black-bg output. Proper fix would be avifenc (libavif).
    if [[ "$alpha_class" == "transparent" ]]; then
      echo "  IMG  $src  ->  (skipped AVIF: source has transparency)"
      SKIPPED=$((SKIPPED + 1))
    elif [[ "$alpha_class" == "unknown" ]]; then
      echo "  IMG  $src  ->  (skipped AVIF: alpha detection failed)"
      SKIPPED=$((SKIPPED + 1))
    elif needs_update "$src" "$avif"; then
      echo "  IMG  $src  ->  ${avif##*/}"
      # libaom-av1 with -still-picture for AVIF stills.
      # cpu-used 6 is a reasonable speed/quality tradeoff (0=slowest/best, 8=fastest).
      if run_img_ff "$src" "$avif" \
        -c:v libaom-av1 -crf "$AVIF_CRF" -b:v 0 \
        -still-picture 1 -cpu-used 6 \
        -pix_fmt yuv420p; then
        IMG_CONVERTED=$((IMG_CONVERTED + 1))
      fi
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  fi
}

convert_video() {
  local src="$1"
  local ext
  ext="$(lower "${src##*.}")"
  local base="${src%.*}"
  local webm="${base}.webm"
  local mp4="${base}.mp4"

  # Primary: ensure a WebM exists (VP9). Skip if source already is webm.
  if [[ "$ext" != "webm" ]]; then
    if needs_update "$src" "$webm"; then
      echo "  VID  $src  ->  ${webm##*/}"
      # Two-pass would be better for size at fixed quality, but CRF mode is
      # "good enough" and 2x faster. -row-mt enables multithreaded encoding.
      # -deadline good balances speed/quality (vs. "best" which is much slower).
      if run_ff -i "$src" \
        -c:v libvpx-vp9 -crf "$VP9_CRF" -b:v 0 \
        -row-mt 1 -deadline good -cpu-used 2 \
        -c:a libopus -b:a 96k \
        "$webm"; then
        VID_CONVERTED=$((VID_CONVERTED + 1))
      else
        echo "    FAILED: $src -> $webm" >&2
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
      # yuv420p + faststart = widest compatibility (iOS Safari, old Androids,
      # streaming-friendly moov atom at the front of the file).
      if run_ff -i "$src" \
        -c:v libx264 -crf "$MP4_CRF" -preset medium \
        -pix_fmt yuv420p -movflags +faststart \
        -c:a aac -b:a 128k \
        "$mp4"; then
        VID_CONVERTED=$((VID_CONVERTED + 1))
      else
        echo "    FAILED: $src -> $mp4" >&2
        FAILED=$((FAILED + 1))
      fi
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  fi
}

# ---- main walk ----

echo "Scanning: $ASSETS_DIR"
echo "  fallbacks=$GEN_FALLBACKS  avif=$GEN_AVIF  strip_alpha=$STRIP_UNUSED_ALPHA  dry_run=$DRY_RUN  force=$FORCE"
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

# -print0 / read -d '' handles spaces and weird filenames safely.
while IFS= read -r -d '' file; do
  ext="$(lower "${file##*.}")"
  case "$ext" in
    # Image sources: only raster originals. webp/avif are outputs, never
    # inputs — feeding them back in would re-encode lossy->lossy on every run.
    png|jpg|jpeg)
      convert_image "$file"
      ;;
    # Video sources: mp4/mov/m4v are always candidates. webm may be either
    # a user-supplied original or something we generated; resolve via mtime.
    mp4|mov|m4v|webm)
      if is_video_source "$file"; then
        convert_video "$file"
      fi
      ;;
    *) ;;  # ignore: fonts, splats, already-derived webp/avif, etc.
  esac
done < <(find "$ASSETS_DIR" -type f -print0)

echo
echo "Done."
echo "  images converted: $IMG_CONVERTED"
echo "  videos converted: $VID_CONVERTED"
echo "  up-to-date:       $SKIPPED"
echo "  failed:           $FAILED"

[[ "$FAILED" -gt 0 ]] && exit 1 || exit 0
