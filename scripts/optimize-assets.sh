#!/usr/bin/env bash
# optimize-assets.sh
#
# Walks src/assets/ and generates web-optimized variants for images and videos.
# Idempotent: skips any output that is newer than its source.
#
# What it does, in order, per asset:
#   1. Images (png/jpg/jpeg):
#      a. Strips unused alpha channels (in place, lossless intent).
#      b. Downscales sources whose longest side exceeds MAX_IMG_DIM (in place —
#         originals live in git history; the site never displays beyond ~1920px).
#      c. Generates full-size .webp / .avif siblings.
#      d. Generates responsive width tiers (foo-480w.webp, foo-960w.avif, ...)
#         for sources wider than each tier. variantsFor() in content.js picks
#         these up and builds srcset strings from them.
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
#   - ffmpeg + ffprobe on PATH (Windows: `winget install ffmpeg`)
#     Must include libvpx-vp9, libaom-av1, libx264. Standard builds ship these.
#
# Usage:
#   bash scripts/optimize-assets.sh                # defaults to src/assets
#   bash scripts/optimize-assets.sh path/to/dir    # other root
#
# Env vars (all optional):
#   GEN_FALLBACKS=0        Skip MP4 fallbacks for videos (smaller repo)
#   GEN_AVIF=0             Skip AVIF for images (slow encode — see note)
#   GEN_TIERS=0            Skip responsive width tiers
#   RESIZE_SOURCES=0       Don't downscale oversized sources in place
#   STRIP_UNUSED_ALPHA=0   Don't modify PNGs whose alpha channel is fully opaque
#   GEN_MANIFEST=0         Skip writing asset-dims.json
#   DRY_RUN=1              Print what would run, do nothing
#   FORCE=1                Re-encode even if output is newer than input
#
# Quality / size knobs (override via env):
#   WEBP_Q=82              WebP quality 0-100
#   AVIF_CRF=30            AVIF CRF — lower = better, 28-34 is web-appropriate
#   VP9_CRF=32             WebM/VP9 CRF — lower = better, 30-35 typical
#   MP4_CRF=23             H.264 CRF — 18-24 typical
#   MAX_IMG_DIM=1920       Longest image side kept when resizing sources
#   TIER_WIDTHS="480 960"  Responsive tier widths (srcset)
#   VID_MAX_W=1920         Video width cap
#   VID_MAX_H=1080         Video height cap
#   MP4_MAX_KBPS=8000      Source mp4 above this bitrate = master needing re-encode
#
# Note on AVIF + alpha: this ffmpeg's libaom-av1 rejects yuva420p (verified:
# "Incompatible pixel format ... auto-selecting yuv420p"), silently flattening
# transparency. Transparent sources therefore skip AVIF; their WebP (which
# handles alpha correctly) is the best served format. Proper fix would be
# avifenc (libavif), not installed.

set -euo pipefail

ASSETS_DIR="${1:-src/assets}"
GEN_FALLBACKS="${GEN_FALLBACKS:-1}"
GEN_AVIF="${GEN_AVIF:-1}"
GEN_TIERS="${GEN_TIERS:-1}"
RESIZE_SOURCES="${RESIZE_SOURCES:-1}"
STRIP_UNUSED_ALPHA="${STRIP_UNUSED_ALPHA:-1}"
GEN_MANIFEST="${GEN_MANIFEST:-1}"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"

WEBP_Q="${WEBP_Q:-82}"
AVIF_CRF="${AVIF_CRF:-30}"
VP9_CRF="${VP9_CRF:-32}"
MP4_CRF="${MP4_CRF:-23}"
MAX_IMG_DIM="${MAX_IMG_DIM:-1920}"
TIER_WIDTHS="${TIER_WIDTHS:-480 960}"
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

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "ERROR: asset directory not found: $ASSETS_DIR" >&2
  exit 1
fi

# ---- counters ----

IMG_CONVERTED=0
VID_CONVERTED=0
RESIZED=0
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

# Read "WIDTHxHEIGHT" of the first video stream. Empty string on failure.
get_dims() {
  local src="$1"
  [[ "$HAVE_FFPROBE" != "1" ]] && { printf ''; return; }
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 "$src" 2>/dev/null || true
}

# Container-level bitrate in kbps (integer). Empty string on failure.
get_kbps() {
  local src="$1" bps
  [[ "$HAVE_FFPROBE" != "1" ]] && { printf ''; return; }
  bps="$(ffprobe -v error -show_entries format=bit_rate -of csv=p=0 "$src" 2>/dev/null || true)"
  [[ -z "$bps" || "$bps" == "N/A" ]] && { printf ''; return; }
  printf '%s' $((bps / 1000))
}

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

# Downscale an image source in place so its longest side is MAX_IMG_DIM.
# Also normalizes web-pointless 16-bit channels down to 8-bit (the fallback
# <img> never benefits from 16-bit and it doubles every PNG's size).
# Atomic via temp+mv. Caller must verify it's actually oversized first.
resize_image_in_place() {
  local src="$1" has_alpha="$2"
  local ext tmp out_fmt
  ext="$(lower "${src##*.}")"
  tmp="${src}.resize.tmp.${ext}"
  if [[ "$has_alpha" == "transparent" ]]; then
    out_fmt="rgba"
  else
    out_fmt="rgb24"
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] resize in place: $src (cap ${MAX_IMG_DIM}px, $out_fmt)"
    return 0
  fi
  # min(iw,CAP)/min(ih,CAP) box + force_original_aspect_ratio=decrease can
  # only shrink: the box never exceeds the source in either axis, so smaller
  # images pass through untouched (but we never get here for those anyway).
  local args=(-i "$src"
    -vf "scale='min(iw,${MAX_IMG_DIM})':'min(ih,${MAX_IMG_DIM})':force_original_aspect_ratio=decrease:flags=lanczos"
    -pix_fmt "$out_fmt")
  # JPEG re-encode quality: 2 ≈ libjpeg q92, visually lossless for our use.
  [[ "$ext" == "jpg" || "$ext" == "jpeg" ]] && args+=(-q:v 2)
  if run_ff "${args[@]}" "$tmp"; then
    mv "$tmp" "$src"
    return 0
  else
    rm -f "$tmp"
    return 1
  fi
}

# ---- converters ----

# encode_webp SRC DST [WIDTH] — WIDTH empty = keep source size
encode_webp() {
  local src="$1" dst="$2" width="${3:-}"
  local args=()
  [[ -n "$width" ]] && args+=(-vf "scale=${width}:-2:flags=lanczos")
  run_img_ff "$src" "$dst" "${args[@]}" -quality "$WEBP_Q" -compression_level 6
}

# encode_avif SRC DST [WIDTH]
encode_avif() {
  local src="$1" dst="$2" width="${3:-}"
  local args=()
  [[ -n "$width" ]] && args+=(-vf "scale=${width}:-2:flags=lanczos")
  # libaom-av1 with -still-picture for AVIF stills.
  # cpu-used 6 is a reasonable speed/quality tradeoff (0=slowest/best, 8=fastest).
  run_img_ff "$src" "$dst" "${args[@]}" \
    -c:v libaom-av1 -crf "$AVIF_CRF" -b:v 0 \
    -still-picture 1 -cpu-used 6 \
    -pix_fmt yuv420p
}

convert_image() {
  local src="$1"
  local base="${src%.*}"
  local webp="${base}.webp"
  local avif="${base}.avif"

  # Don't recompress something that is already webp/avif back into itself.
  local ext
  ext="$(lower "${src##*.}")"

  # Spritesheets etc.: leave the source alone, generate nothing.
  if is_skipped_path "$src"; then
    return 0
  fi

  # Classify once (ffmpeg decode is expensive, and we need the answer several
  # times: alpha-strip, resize pix_fmt, and the AVIF-skip decision).
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

  # Downscale oversized sources in place. The site never displays an image
  # beyond ~1920px; a 4096px source quadruples decode time and fallback bytes
  # for zero visible gain. Originals are recoverable from git history.
  # Also re-encodes 16-bit-per-channel sources down to 8-bit even when the
  # dimensions are fine — the web stack renders 8-bit, so the extra depth
  # doubles the fallback's size for literally invisible gain.
  # Naturally idempotent: once within the cap and 8-bit, both checks skip.
  local dims src_w src_h deep_color=0
  dims="$(get_dims "$src")"
  src_w="${dims%x*}"; src_h="${dims#*x}"
  case "$(get_pix_fmt "$src")" in
    *48*|*64*|*16*) deep_color=1 ;;
  esac
  if [[ "$RESIZE_SOURCES" == "1" && -n "$dims" && "$dims" == *x* ]]; then
    if (( src_w > MAX_IMG_DIM || src_h > MAX_IMG_DIM )) || [[ "$deep_color" == "1" ]]; then
      echo "  SIZE  $src  (${dims} $([[ "$deep_color" == "1" ]] && echo '16-bit ')-> cap ${MAX_IMG_DIM}px, 8-bit)"
      if resize_image_in_place "$src" "$alpha_class"; then
        RESIZED=$((RESIZED + 1))
        # Re-read dims for the tier decisions below.
        dims="$(get_dims "$src")"
        src_w="${dims%x*}"; src_h="${dims#*x}"
      else
        echo "    FAILED to resize: $src" >&2
        FAILED=$((FAILED + 1))
      fi
    fi
  fi

  if [[ "$ext" != "webp" ]]; then
    if needs_update "$src" "$webp"; then
      echo "  IMG  $src  ->  ${webp##*/}"
      if encode_webp "$src" "$webp"; then
        IMG_CONVERTED=$((IMG_CONVERTED + 1))
      fi
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  fi

  local do_avif=0
  if [[ "$GEN_AVIF" == "1" && "$ext" != "avif" ]]; then
    # Skip AVIF when the source has real transparency. ffmpeg+libaom silently
    # drops alpha and emits a single-stream yuv420p AVIF, producing a black
    # background where transparency should be. WebP handles alpha correctly
    # and is served before the fallback, so skipping is functionally fine.
    # Unknown alpha class (detection failed) also skips — safer than risking
    # a black-bg output. Proper fix would be avifenc (libavif).
    if [[ "$alpha_class" == "transparent" ]]; then
      echo "  IMG  $src  ->  (skipped AVIF: source has transparency)"
      SKIPPED=$((SKIPPED + 1))
    elif [[ "$alpha_class" == "unknown" ]]; then
      echo "  IMG  $src  ->  (skipped AVIF: alpha detection failed)"
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
        if [[ "$do_avif" == "1" ]]; then
          local tier_avif="${base}-${tier}w.avif"
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

file_size() { stat -c %s "$1" 2>/dev/null || echo 0; }

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

echo "Scanning: $ASSETS_DIR"
echo "  fallbacks=$GEN_FALLBACKS  avif=$GEN_AVIF  tiers=$GEN_TIERS  resize=$RESIZE_SOURCES  strip_alpha=$STRIP_UNUSED_ALPHA  dry_run=$DRY_RUN  force=$FORCE"
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
    *-480w.*|*-960w.*|*-1920w.*) return 0 ;;
    *) return 1 ;;
  esac
}

# -print0 / read -d '' handles spaces and weird filenames safely.
while IFS= read -r -d '' file; do
  is_tier_file "$file" && continue
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
    *) ;;  # ignore: fonts, splats, already-derived webp/avif, .skip markers, etc.
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
echo "  sources resized:  $RESIZED"
echo "  videos converted: $VID_CONVERTED"
echo "  up-to-date:       $SKIPPED"
echo "  failed:           $FAILED"

[[ "$FAILED" -gt 0 ]] && exit 1 || exit 0
