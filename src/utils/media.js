import { variantsFor, resolveThumbnail } from '../config/content.js';
import { getSaveData } from '../config/device.js';

/* ────────────────────────────────────────────────────────────────────────
 * Offscreen media manager
 *
 * One IntersectionObserver shared by every autoplaying <video> and every
 * spritesheet animation the site creates. Why: an autoplaying loop keeps a
 * full decode pipeline alive (CPU/GPU + battery) whether or not anyone can
 * see it — like ticking a particle system that's behind the camera. The
 * manager pauses media that leaves the viewport (or the tab) and resumes it
 * on re-entry.
 *
 * Chrome supports IntersectionObserver v2 (trackVisibility), which also
 * reports false when an element is covered or at opacity:0 — exactly what
 * happens to mosaic videos behind an open detail view. Other browsers fall
 * back to plain intersection (no regression vs. the old always-playing
 * behavior), plus the explicit pauseManagedVideos() hooks below.
 *
 * Play/pause ownership rules:
 *   - The manager only resumes videos IT paused (pausedByManager), never a
 *     video the user paused via controls (userPaused). A 'pause' event the
 *     manager didn't trigger marks userPaused; any 'play' clears both flags.
 * ──────────────────────────────────────────────────────────────────────── */

// element → handler state. WeakMap so removed elements don't leak state.
const managedHandlers = new WeakMap();
// Strong-ref registry for "pause everything" sweeps; pruned of disconnected
// elements on every registration so it can't grow across detail open/close.
const managedElements = new Set();

let mediaObserver = null;
let visibilityHooked = false;

function ensureObserver() {
  if (mediaObserver) return mediaObserver;

  const onEntries = (entries) => {
    for (const entry of entries) {
      const h = managedHandlers.get(entry.target);
      if (!h) continue;
      // isVisible is IO-v2 (Chrome only): false when covered/opacity:0.
      // Elsewhere it's undefined → use plain intersection.
      h.lastVisible = entry.isVisible ?? entry.isIntersecting;
      if (h.lastVisible) h.onEnter(); else h.onExit();
    }
  };

  try {
    // trackVisibility requires delay ≥ 100; throws on Chrome if omitted.
    mediaObserver = new IntersectionObserver(onEntries, {
      threshold: 0.05, trackVisibility: true, delay: 200,
    });
  } catch {
    mediaObserver = new IntersectionObserver(onEntries, { threshold: 0.05 });
  }

  if (!visibilityHooked) {
    visibilityHooked = true;
    document.addEventListener('visibilitychange', () => {
      for (const el of managedElements) {
        const h = managedHandlers.get(el);
        if (!h) continue;
        if (document.hidden) h.onExit();
        else if (h.lastVisible) h.onEnter();
      }
    });
  }
  return mediaObserver;
}

function registerManagedElement(el, handler) {
  // Prune disconnected elements (e.g. media from a closed detail view).
  for (const old of managedElements) {
    if (!old.isConnected) {
      mediaObserver?.unobserve(old);
      managedElements.delete(old);
    }
  }
  managedHandlers.set(el, handler);
  managedElements.add(el);
  ensureObserver().observe(el);
}

function registerManagedVideo(video, wantsAutoplay) {
  const h = {
    lastVisible: true,
    userPaused: false,
    pausedByManager: false,
    suppressPauseEvent: false,
    onEnter() {
      if (h.userPaused) return;
      if ((wantsAutoplay || h.pausedByManager) && video.paused) {
        h.pausedByManager = false;
        video.play().catch(() => { /* autoplay policy — user can tap */ });
      }
    },
    onExit() {
      if (!video.paused) {
        h.suppressPauseEvent = true;
        h.pausedByManager = true;
        video.pause();
      }
    },
  };
  // A pause the manager didn't cause = the user's choice; respect it.
  video.addEventListener('pause', () => {
    if (h.suppressPauseEvent) { h.suppressPauseEvent = false; return; }
    h.userPaused = true;
    h.pausedByManager = false;
  });
  video.addEventListener('play', () => {
    h.userPaused = false;
    h.pausedByManager = false;
    // Autoplay can kick in after the manager already judged the video
    // offscreen (race with data loading) — re-pause immediately.
    if (!h.lastVisible || document.hidden) h.onExit();
  });
  registerManagedElement(video, h);
}

function registerManagedAnimation(el, animation) {
  registerManagedElement(el, {
    lastVisible: true,
    onEnter() { if (animation.playState === 'paused') animation.play(); },
    onExit() { if (animation.playState === 'running') animation.pause(); },
  });
}

/**
 * Pauses every manager-registered video (optionally filtered). Use when a
 * layer visually covers media that still intersects the viewport in browsers
 * without IO-v2 — e.g. opening a detail view over the mosaic.
 * `filter(video)` → return false to leave that video playing.
 */
export function pauseManagedVideos(filter = () => true) {
  for (const el of managedElements) {
    if (el.tagName !== 'VIDEO' || !filter(el)) continue;
    managedHandlers.get(el)?.onExit();
  }
}

/**
 * Resumes videos previously paused by the manager (not by the user) that are
 * still in view. Counterpart of pauseManagedVideos(); same optional filter.
 */
export function resumeManagedVideos(filter = () => true) {
  for (const el of managedElements) {
    if (el.tagName !== 'VIDEO' || !filter(el)) continue;
    const h = managedHandlers.get(el);
    if (h?.pausedByManager && h.lastVisible && !document.hidden) h.onEnter();
  }
}

/**
 * Builds a <picture> (images) or <video> (videos) element with the full
 * fallback chain wired up — browsers pick the best format they can decode.
 *
 * Why <picture>: the modern sources (AVIF, WebP) are listed first as <source>
 * elements; the universal <img src="...png"> lives inside as the last resort.
 * Browsers that can't decode any <source> fall back to <img>, and every CSS
 * selector written against `img` keeps matching (the <img> is still in the DOM).
 *
 * Responsive selection: when the optimizer emitted width tiers, each <source>
 * carries a srcset with `w` descriptors and a `sizes` hint (opts.sizes,
 * default '100vw'). Pass a tighter sizes value wherever the rendered slot is
 * known — e.g. a 2-column mosaic card — and the browser downloads the
 * smallest tier that covers it at the device's pixel ratio.
 *
 * Layout stability: width/height attributes come from the dimension manifest
 * so the browser knows the aspect ratio before any bytes arrive and reserves
 * the space (no layout shift when lazy images decode mid-scroll).
 *
 * Data saver: when navigator.connection.saveData is on, videos don't
 * autoplay or preload — a tap starts them. Respecting an explicit user
 * signal beats any heuristic.
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
    sizes = '100vw',
    fetchPriority = null,
    video: videoOpts = {},
  } = opts;

  const variants = variantsFor(relativePath);
  if (!variants) return null;
  const dims = variants.dims;

  if (variants.kind === 'image') {
    const picture = document.createElement('picture');
    for (const src of variants.sources) {
      const source = document.createElement('source');
      source.type = src.type;
      source.srcset = src.srcset;
      source.sizes = sizes;
      picture.appendChild(source);
    }
    const img = document.createElement('img');
    img.src = variants.fallback.url;
    img.alt = alt;
    if (dims) {
      img.width = dims.width;
      img.height = dims.height;
    }
    if (className) img.className = className;
    if (lazy) {
      img.loading = 'lazy';
      img.decoding = 'async';
    }
    if (fetchPriority) img.fetchPriority = fetchPriority;
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

  const saveData = getSaveData();
  const effectiveAutoplay = autoplay && !saveData;

  const video = document.createElement('video');
  if (className) video.className = className;
  if (dims) {
    video.width = dims.width;
    video.height = dims.height;
  }
  // Muted must be set before autoplay to satisfy browser autoplay policies.
  video.muted = muted;
  video.autoplay = effectiveAutoplay;
  video.loop = loop;
  video.playsInline = playsInline;
  video.preload = saveData ? 'none' : preload;
  for (const src of variants.sources) {
    const source = document.createElement('source');
    source.type = src.type;
    source.src = src.url;
    video.appendChild(source);
  }
  if (saveData && autoplay) {
    // Tap-to-play stand-in for the suppressed autoplay.
    video.style.cursor = 'pointer';
    video.addEventListener('click', () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
  }
  if (autoplay) registerManagedVideo(video, effectiveAutoplay);
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
 * The animation steps background-position, which is paint-side work (the
 * browser re-rasterizes each frame) — fine for one visible banner, wasteful
 * for one scrolled past. The offscreen manager pauses it out of view.
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
  const anim = sprite.animate(
    [{ backgroundPosition: `${fromPct}% 0` }, { backgroundPosition: `${toPct}% 0` }],
    { duration: (count / fps) * 1000, iterations: Infinity, easing: `steps(${count})` }
  );
  registerManagedAnimation(container, anim);

  return container;
}
