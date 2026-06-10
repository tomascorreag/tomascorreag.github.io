import { variantsFor, resolveThumbnail } from '../config/content.js';

/**
 * Builds a <picture> (images) or <video> (videos) element with the full
 * fallback chain wired up — browsers pick the best format they can decode.
 *
 * Why <picture>: the modern sources (AVIF, WebP) are listed first as <source>
 * elements; the universal <img src="...png"> lives inside as the last resort.
 * Browsers that can't decode any <source> fall back to <img>, and every CSS
 * selector written against `img` keeps matching (the <img> is still in the DOM).
 *
 * Why no src on <video>: when multiple <source> children are present, the
 * browser walks them in order and picks the first it can play. Setting
 * `src` too would short-circuit that selection.
 *
 * Returns null when the path isn't in the asset glob (mirrors the
 * `if (url)` guards that existed before this helper was introduced).
 */
export function createMediaElement(relativePath, opts = {}) {
  const {
    alt = '',
    className = '',
    lazy = true,
    video: videoOpts = {},
  } = opts;

  const variants = variantsFor(relativePath);
  if (!variants) return null;

  if (variants.kind === 'image') {
    const picture = document.createElement('picture');
    for (const src of variants.sources) {
      const source = document.createElement('source');
      source.type = src.type;
      source.srcset = src.url;
      picture.appendChild(source);
    }
    const img = document.createElement('img');
    img.src = variants.fallback.url;
    img.alt = alt;
    if (className) img.className = className;
    if (lazy) {
      img.loading = 'lazy';
      img.decoding = 'async';
    }
    picture.appendChild(img);
    return picture;
  }

  // variants.kind === 'video'
  const {
    autoplay = true,
    loop = true,
    muted = true,
    playsInline = true,
    preload = 'metadata',
  } = videoOpts;

  const video = document.createElement('video');
  if (className) video.className = className;
  // Muted must be set before autoplay to satisfy browser autoplay policies.
  video.muted = muted;
  video.autoplay = autoplay;
  video.loop = loop;
  video.playsInline = playsInline;
  video.preload = preload;
  for (const src of variants.sources) {
    const source = document.createElement('source');
    source.type = src.type;
    source.src = src.url;
    video.appendChild(source);
  }
  return video;
}

/**
 * Builds a looping CSS-sprite thumbnail from a horizontal spritesheet.
 *
 * Renders a solid-colour box (matching the banner aspect ratio via `className`)
 * with the title sprite centered on top. A single inner <div> shows one frame at
 * a time: the sheet is `frames`× wider than the frame, and the Web Animations API
 * steps `background-position` across the chosen sub-range so no CSS keyframes are
 * needed — one code path works on desktop and mobile, card and detail.
 *
 * Frame `i` (0-based) of a horizontal strip sits at
 * `background-position-x = i/(frames-1) * 100%` when `background-size` width is
 * `frames*100%`. We animate from `first` to `first+count` under `steps(count)`,
 * so the displayed frames are exactly `first … first+count-1`, then it loops.
 *
 * Returns null when the sheet path can't be resolved (mirrors createMediaElement).
 */
export function createSpritesheetElement(config, opts = {}) {
  const {
    file, frames, first, count, fps, background, frameAspect = '4 / 1',
    // Pixel-perfect mode: when `scale` + native frame dims are given, the sprite
    // is sized to an exact integer multiple of the native frame, so every source
    // pixel maps to a uniform scale×scale block (no fractional scaling artifacts).
    scale, frameWidth, frameHeight,
  } = config;
  const { className = '', alt = '', responsive = false } = opts;

  const url = resolveThumbnail(file);
  if (!url) return null;

  // Pixel-perfect = fixed integer-scaled box (small thumbnail). `responsive`
  // callers (e.g. the full-width detail banner) opt out and fill their container.
  const pixelPerfect = !responsive && scale && frameWidth && frameHeight;

  const container = document.createElement('div');
  if (className) container.className = className;
  container.style.backgroundColor = background;
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.overflow = 'hidden';
  container.setAttribute('role', 'img');
  if (alt) container.setAttribute('aria-label', alt);

  if (pixelPerfect) {
    // Sprite is sized to an exact integer multiple of the native frame and
    // centered (via the flex centering above) inside a 2:1 banner box that
    // matches the other thumbnails. Pick the box edge the sprite sits flush
    // against from its native aspect: a wide frame (≥2:1, e.g. the 4:1 title)
    // fills the box width with solid-colour breathing room above/below; a
    // square/tall frame (e.g. the 1:1 run cycle) fills the box height with
    // pillarbox room left/right. The centering offset stays integer either
    // way, so pixel-perfectness is preserved.
    let w, h;
    if (frameWidth >= 2 * frameHeight) {
      w = frameWidth * scale;
      h = w / 2;
    } else {
      h = frameHeight * scale;
      w = h * 2;
    }
    container.style.flex = '0 0 auto';
    container.style.width = `${w}px`;
    container.style.height = `${h}px`;
    container.style.aspectRatio = 'auto';
  }

  const sprite = document.createElement('div');
  if (pixelPerfect) {
    sprite.style.width = `${frameWidth * scale}px`;
    sprite.style.height = `${frameHeight * scale}px`;
  } else {
    sprite.style.width = '100%';
    sprite.style.aspectRatio = frameAspect;
  }
  sprite.style.backgroundImage = `url("${url}")`;
  sprite.style.backgroundRepeat = 'no-repeat';
  sprite.style.backgroundSize = `${frames * 100}% 100%`;
  sprite.style.imageRendering = 'pixelated';
  container.appendChild(sprite);

  const fromPct = (first / (frames - 1)) * 100;
  const toPct = ((first + count) / (frames - 1)) * 100;
  sprite.animate(
    [{ backgroundPosition: `${fromPct}% 0` }, { backgroundPosition: `${toPct}% 0` }],
    { duration: (count / fps) * 1000, iterations: Infinity, easing: `steps(${count})` }
  );

  return container;
}
