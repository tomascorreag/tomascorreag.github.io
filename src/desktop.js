/**
 * Terminal System
 *
 * A modular terminal emulator that can:
 * - Type text with natural randomness
 * - Handle multiple lines
 * - Submit lines (like pressing Enter)
 * - Queue and execute commands sequentially
 */

// Desktop-scene styles ride this chunk (same pattern as mobile.css in
// mobile.js): index.html only blocks on the small shared base.css, and the
// ~70KB desktop sheet downloads in parallel with this module — never on
// mobile, where this chunk is never imported.
import './article.css'; // shared markdown styles (also used by deck + mobile)
import './style.css';
import { Rabbit } from './components/Rabbit.js';
import { ParticleMorph, prewarmSampleCache } from './components/ParticleMorph.js';
import { createParallaxBanner } from './components/ParallaxBanner.js';
import { TYPING_CONFIG, RABBIT_CONFIG, TIMING, MOSAIC_CONFIG, injectCSSVariables } from './config/animations.js';
import { injectCRTVariables, startGlowNoise } from './config/crt.js';
import { PARTICLE_CONFIG } from './config/particles.js';
import { deviceTier, getSaveData, prefersReducedMotion } from './config/device.js';
import { CATEGORIES, GAMES, GENERAL_CONTENT, resolveSplat, variantsFor } from './config/content.js';
import { ICONS as CONTACT_ICONS } from './config/icons.js';
import { createMediaElement, createSpritesheetElement, pauseManagedVideos, resumeManagedVideos, deferManagedVideo, releaseMedia } from './utils/media.js';
import { parseMarkdown, applyInline } from './utils/markdown.js';
import { attachVideoControls } from './components/VideoControls.js';
import { createCrtScrollbar } from './components/CrtScrollbar.js';
import { parseRoute, findItemIndex, createUrlSync } from './utils/route.js';
import { observeScrollReveal } from './utils/scrollReveal.js';

/**
 * Returns particle config with device-tier overrides merged in,
 * or null if particles are disabled for this tier.
 */
function getParticleConfig() {
  // Reduced motion takes the no-particle path (instant swaps).
  if (prefersReducedMotion()) return null;
  const tierOverrides = PARTICLE_CONFIG.tiers?.[deviceTier];
  // If the tier explicitly disables particles, return null
  if (tierOverrides && tierOverrides.enabled === false) return null;
  // Always return a plain mutable copy — never hand out the frozen object
  // directly, so callers get a consistent type regardless of tier.
  return { ...PARTICLE_CONFIG, ...(tierOverrides || {}) };
}
import rabbitSpritesheetUrl from './assets/spritesheets/RabbitAnimation_V1.png';

// --- Splat viewer dynamic import cache ---
// Three.js + Spark are ~600KB — we don't want them in the initial bundle.
// Dynamic import() creates a separate Vite chunk loaded only on first splat click.
// Cache the module promise so subsequent opens are instant (like an asset bundle
// that stays in memory after the first load).
let splatViewerModule = null;

// Monotonically increasing ID — each openDetail() call gets a unique session.
// Prevents stale async splat mounts from overwriting newer viewers.
// Like a generation counter in an ECS — stale references self-invalidate.
let detailSessionId = 0;

/**
 * Lazily imports the SplatViewer module. Returns cached promise on repeat calls.
 * @returns {Promise<{SplatViewer: typeof import('./components/SplatViewer.js').SplatViewer}>}
 */
function getSplatViewerModule() {
  if (!splatViewerModule) {
    splatViewerModule = import('./components/SplatViewer.js');
  }
  return splatViewerModule;
}

/**
 * Creates and mounts a splat viewer inside a detail-active mosaic item.
 *
 * @param {HTMLElement} itemEl - The .mosaic-item.detail-active element
 * @param {Object} itemData - Content data with splat.file and optional splat.camera
 * @returns {Promise<import('./components/SplatViewer.js').SplatViewer>}
 */
async function mountSplatViewer(itemEl, itemData) {
  const { SplatViewer } = await getSplatViewerModule();

  // Create container div for the WebGL canvas
  const container = document.createElement('div');
  container.className = 'splat-viewer-container';
  itemEl.appendChild(container);

  // Resolve the .spz URL through Vite's asset pipeline
  const splatUrl = resolveSplat(itemData.splat.file);
  if (!splatUrl) {
    // File not found in glob — show error state immediately, skip mount.
    // Without this guard, SplatMesh would fetch('') — a request to the page root.
    container.classList.add('error');
    return null;
  }

  const viewer = new SplatViewer();
  viewer.mount(container, splatUrl, {
    cameraPosition: itemData.splat.camera,
    onLoad: () => {
      container.classList.add('loaded');
    },
    onError: (err) => {
      console.error('Splat load failed:', err);
      container.classList.add('error');
    },
  });

  return viewer;
}

/**
 * Destroys a splat viewer and removes its container from the DOM.
 * @param {import('./components/SplatViewer.js').SplatViewer|null} viewer
 */
function destroySplatViewer(viewer) {
  if (!viewer) return;
  // Grab container ref BEFORE destroy nulls out renderer.domElement
  const container = viewer.renderer?.domElement?.parentElement;
  viewer.destroy();
  if (container) container.remove();
}

/**
 * Mounts the custom control bar (play/pause/seek/mute) over a detail-active
 * video, for items flagged `hasAudio`. The bar is a child of itemEl, so it
 * rides along when fullscreen resizes the item.
 *
 * @param {HTMLElement} itemEl - The .mosaic-item.detail-active element
 * @param {Object} itemData - Content data (checked for hasAudio)
 * @returns {{ destroy(): void }|null}
 */
function mountDetailVideoControls(itemEl, itemData) {
  if (!itemData?.hasAudio) return null;
  const video = itemEl.querySelector(':scope > video');
  if (!video) return null;
  return attachVideoControls(video, itemEl, { reveal: 'hover' });
}

// Inject CSS variables from centralized config
injectCSSVariables();
injectCRTVariables();

// Get CRT container for spawning elements inside it
const crtScreen = document.getElementById('crt-screen');

// True when the full set of decorative animations should run: not low tier
// and no OS reduced-motion request.
function fullMotion() {
  return deviceTier !== 'low' && !prefersReducedMotion();
}

// Alias for cleaner code
const config = TYPING_CONFIG;

// Skip-typing: click anywhere to rush through all typing animations.
// When true, sleep() resolves instantly so all text dumps at once.
let skipTyping = false;

function enableSkipOnClick() {
  const handler = () => { skipTyping = true; };
  document.addEventListener('click', handler, { once: true });
  // Return cleanup fn in case typing finishes before click
  return () => document.removeEventListener('click', handler);
}

function enableSkipMorphOnClick(morph) {
  const handler = () => morph.skip();
  document.addEventListener('click', handler, { once: true });
  return () => document.removeEventListener('click', handler);
}

// ============================================
// Terminal Class
// ============================================

/**
 * Terminal manages the DOM and provides methods for typing/output
 *
 * Class in JS is similar to C# classes - bundles data and methods.
 * 'this' refers to the instance (like 'this' in Unity MonoBehaviour)
 */
class Terminal {
  constructor(containerElement) {
    this.container = containerElement;
    this.currentLine = null;
    this.cursor = this.createCursor();

    // Build DOM structure:
    // .terminal-wrapper
    //   .terminal-history (submitted lines, grows upward)
    //   .terminal-active (current line, stays centered)
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'terminal-wrapper';

    this.history = document.createElement('div');
    this.history.className = 'terminal-history';

    this.activeContainer = document.createElement('div');
    this.activeContainer.className = 'terminal-active';

    // Order matters: with column-reverse, first child appears at bottom
    this.wrapper.appendChild(this.activeContainer);
    this.wrapper.appendChild(this.history);
    this.container.appendChild(this.wrapper);

    // Start with a fresh line
    this.newLine();
  }

  /**
   * Creates the blinking cursor element
   */
  createCursor() {
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    cursor.textContent = '█';
    return cursor;
  }

  /**
   * Exponentially ramps cursor brightness over duration (ms)
   * @param {number} duration
   * @param {number} maxBrightness - e.g. 4 = 400%
   */
  rampCursorBrightness(duration = 2500, maxBrightness = 4) {
    return new Promise(resolve => {
      const start = performance.now();

      const animate = (now) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);

        // Exponential curve
        // t^3 gives slow start, fast end
        const eased = Math.pow(t, 3);

        const brightness = 1 + (maxBrightness - 1) * eased;

        this.cursor.style.setProperty(
          '--cursor-brightness',
          brightness
        );

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }


  /**
   * Creates the prompt element (the ">" symbol)
   */
  createPrompt() {
    const prompt = document.createElement('span');
    prompt.className = 'prompt';
    prompt.textContent = '>';
    return prompt;
  }

  /**
   * Creates a new line in the active container
   */
  newLine() {
    const line = document.createElement('div');
    line.className = 'terminal-line';

    // Add prompt, then cursor
    line.appendChild(this.createPrompt());
    line.appendChild(this.cursor);

    // Clear active container and add new line
    this.activeContainer.innerHTML = '';
    this.activeContainer.appendChild(line);

    this.currentLine = line;
  }

  /**
   * Adds a character to the current line (before cursor)
   *
   * insertBefore(newNode, referenceNode) - inserts newNode before referenceNode
   * document.createTextNode() - creates a plain text node (not an element)
   */
  addChar(char) {
    const textNode = document.createTextNode(char);
    this.currentLine.insertBefore(textNode, this.cursor);
  }

  /**
   * Submits current line and starts a new one
   */
  submitLine() {
    // Replace prompt with space to maintain alignment
    const oldPrompt = this.currentLine.querySelector('.prompt');
    if (oldPrompt) {
      oldPrompt.textContent = ' ';
    }

    // Remove cursor from current line before moving to history
    this.cursor.remove();

    // Move line to history (append so newest appears at bottom, closest to active)
    this.history.appendChild(this.currentLine);

    // Create new active line
    this.newLine();
  }

  /**
   * Types a string with natural timing
   */
  async type(text) {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      // Pause before space
      if (char === ' ') {
        await sleep(getRandomDelay(config.spacePause, config.variance));
      }

      // Type character
      this.addChar(char);

      // Base delay
      await sleep(getRandomDelay(config.baseSpeed, config.variance));

      // Pause after word (before space)
      if (nextChar === ' ') {
        await sleep(getRandomDelay(config.spacePause * 0.5, config.variance));
      }
    }
  }

  /**
   * Types text then submits the line (like typing + Enter)
   */
  async typeLine(text) {
    await this.type(text);
    await sleep(getRandomDelay(config.linePause, config.variance));
    this.submitLine();
    await sleep(getRandomDelay(config.linePause, config.variance));
  }

  async delayedHideCursor(delay)
  {
    await sleep(delay)
    this.hideCursor();
  }

  /**
   * Execute a sequence of commands
   *
   * commands is an array of objects: { text: string, submit: boolean }
   */
  async run(commands) {
    for (const cmd of commands) {
      if (cmd.submit) {
        await this.typeLine(cmd.text);
      } else {
        await this.type(cmd.text);
      }
    }
  }

  /**
   * Gets cursor position for spawning elements relative to cursor
   * @returns {{ x: number, y: number }}
   */
  getCursorPosition() {
    const rect = this.cursor.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.bottom,
    };
  }

  /**
   * Gets the cursor's full bounding rect (position + size).
   * Used by ParticleMorph as the source rectangle for particle scatter.
   * @returns {{ x: number, y: number, w: number, h: number }}
   */
  getCursorRect() {
    const rect = this.cursor.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    };
  }

  /**
   * Hides the terminal cursor (e.g., after spawning a sprite)
   */
  hideCursor() {
    this.cursor.style.display = 'none';
  }

  /**
   * Shows the terminal cursor
   * @param {boolean} locked - If true, stops blinking and keeps cursor visible
   */
  showCursor(locked = false) {
    this.cursor.style.display = '';

    if (locked) {
      // Stop blink animation and force full opacity
      this.cursor.style.animation = 'none';
      this.cursor.style.opacity = '1';
    } else {
      // Restore blink animation
      this.cursor.style.animation = '';
      this.cursor.style.opacity = '';
    }
  }

  /**
   * Cleans up terminal DOM elements
   */
  destroy() {
    if (this.wrapper) {
      this.wrapper.remove();
    }
  }
}

// ============================================
// Utility Functions
// ============================================

function getRandomDelay(base, varianceAmount) {
  const randomFactor = 1 + (Math.random() - 0.5) * 2 * varianceAmount;
  return Math.floor(base * randomFactor);
}

function sleep(ms) {
  // Reduced motion = permanent skip: text appears at once, no typing cadence.
  if (skipTyping || prefersReducedMotion()) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Preloads an image to ensure it's cached before use
 * Like preloading assets in Unity's Addressables
 */
function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Silently preloads all thumbnail assets across every category.
 *
 * Fire-and-forget: call this without await so it runs in the background
 * while the intro sequence plays. The browser caches fetched resources,
 * so when renderMosaic() later creates <img>/<video> elements with the
 * same URLs, they load instantly from cache.
 *
 * Think of it like Unity's async Addressables preload — you kick it off
 * early, and by the time the player reaches the content, it's already in memory.
 *
 * Uses requestIdleCallback (with setTimeout fallback) + small stagger
 * so we never compete with critical resources like the rabbit spritesheet.
 */
function preloadThumbnails() {
  // saveData is the user saying "don't burn my data" — skip speculative work
  // entirely. Otherwise warm only the (small, tiered) images. Videos are never
  // prefetched: byte sizes aren't known at runtime, several are 6-8 MB, and
  // the network-type signal is missing on Safari/Firefox. The grid's
  // <video preload="metadata"> streams them when a category actually opens.
  if (getSaveData()) return;

  // Pick the preferred variant so preload matches what the browser will
  // actually render. variantsFor lists modern formats first (avif) with the
  // original as fallback — source[0] is ~universal on modern devices.
  const images = Object.values(CATEGORIES).flat()
    .map((item) => variantsFor(item.src))
    .filter((variants) => variants?.kind === 'image');
  if (images.length === 0) return;

  const startPreload = () => {
    images.forEach((variants, i) => {
      // Stagger each fetch by 200ms to avoid a bandwidth stampede
      setTimeout(() => {
        // Image srcsets carry several width tiers — warm the ~960w one
        // (what a mosaic card actually renders) rather than the full-size
        // candidate. Format: "url1 480w, url2 960w, url3 1920w".
        const srcset = variants.sources[0]?.srcset || variants.fallback.url;
        const candidates = srcset.split(',').map((c) => {
          const [url, desc] = c.trim().split(/\s+/);
          return { url, w: parseInt(desc, 10) || Infinity };
        });
        const pick = candidates.find((c) => c.w >= 960) || candidates[candidates.length - 1];
        // Creating an Image() triggers a standard fetch; the browser then
        // serves it from cache on the next request.
        const img = new Image();
        img.src = pick.url;
      }, i * 200);
    });
  };

  // requestIdleCallback = "run this when the browser is idle"
  // Perfect for non-critical background work. Falls back to setTimeout
  // for browsers that don't support it (Safari < 16.4).
  if ('requestIdleCallback' in window) {
    requestIdleCallback(startPreload);
  } else {
    setTimeout(startPreload, 100);
  }
}

// ============================================
// Mosaic Grid
// ============================================

/**
 * Renders thumbnail items for a category into the mosaic grid.
 *
 * On first call, just populates and fades in.
 * On subsequent calls (category switch), fades out first, swaps content, fades back in.
 * The fade uses CSS opacity transition (300ms) — we await it with transitionend events.
 *
 * @param {string} category - Key from CATEGORIES ('General', '3D Tech', '3D Art')
 */
const mosaicEl = document.getElementById('mosaic');
let mosaicHasContent = false;
let staggerTimeouts = [];

// Bumped by every view render. An overlapping nav click starts a newer render;
// the older one checks this after each await and bails.
let renderGen = 0;

/**
 * Fades the mosaic out and resolves when ITS opacity transition ends. Child
 * transitions (hover, filters) bubble transitionend too, so filter by target
 * and property. The timeout covers display:none / no-transition cases.
 */
function fadeOutMosaic() {
  mosaicEl.classList.remove('visible');
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(fallback);
      mosaicEl.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (e) => {
      if (e.target === mosaicEl && e.propertyName === 'opacity') done();
    };
    const fallback = setTimeout(done, MOSAIC_CONFIG.fadeDuration + 50);
    mosaicEl.addEventListener('transitionend', onEnd);
  });
}

/** Empties the mosaic, unloading its videos first so they stop downloading. */
function clearMosaic() {
  releaseMedia(mosaicEl);
  mosaicEl.innerHTML = '';
}

/* ── Mosaic geometry ────────────────────────────────────────────────────────
 * The mosaic used to be a `repeat(auto-fill, minmax(120px, 1fr))` grid with
 * 120px rows. That meant the browser picked the column count from the viewport
 * width, so the same `cols: 4` item was half-width on a 1920px display and
 * full-width on a 1280px one, and dense packing reshuffled everything between
 * machines. Cells also never scaled — only their count changed.
 *
 * Now the column count is FROZEN (MOSAIC_COLS) and the cell size is derived
 * from the available box, contain-fit style: cell = min(width fit, height fit).
 * The layout is therefore identical everywhere and simply renders smaller.
 *
 * Contain-fit means the mosaic usually can't fill its 55%×90% box (that box's
 * aspect ratio changes with the display; the mosaic's doesn't). Rather than
 * letterbox inside the border, we publish the mosaic's REAL box as CSS custom
 * properties and let .mosaic-frame / .crt-scrollbar / .detail-nav read them —
 * so the frame hugs the grid instead of floating around it. */

const MOSAIC_COLS = 8;
// Gap as a fraction of cell edge. 0.1 = the original 12px gap / 120px cell, so
// the spacing shrinks with the cells instead of looking doubled when small.
const MOSAIC_GAP_RATIO = 0.1;
// Same condition as the stacked block in style.css. There the box spans the
// full width, so the fitted grid is centred (JS overrides --mosaic-right)
// rather than right-anchored against the terminal.
const mosaicPortrait = window.matchMedia('(max-aspect-ratio: 4/3), (max-width: 62.5em)');

const MOSAIC_BOX_VARS = ['--mosaic-top', '--mosaic-bottom', '--mosaic-right', '--mosaic-width'];
// The vars live on <html> (see the :root block in style.css): #mosaic sits
// OUTSIDE #crt-screen, so anything set on #crt-screen never reaches it.
const mosaicGeomHost = document.documentElement;

// Row count of the current category. Depends only on the item list and the
// (fixed) column count — NOT on the cell size — so it survives resizes and is
// measured once per render instead of on every layout pass.
let mosaicRows = 0;

/** Drops the JS overrides so the stylesheet's available box applies again. */
function clearMosaicGeometry() {
  MOSAIC_BOX_VARS.forEach(v => mosaicGeomHost.style.removeProperty(v));
  mosaicGeomHost.style.removeProperty('--mosaic-cell');
}

/** Root font size in px, for converting the stylesheet's rem constants. */
function remPx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * Counts the grid's used row tracks. The resolved value of grid-template-rows
 * lists implicit tracks too, which is the only way to learn how dense auto-flow
 * actually packed the items — the browser does the Tetris, we just read it.
 * Must be called with the thumbnail grid laid out.
 */
function measureMosaicRows() {
  const tracks = getComputedStyle(mosaicEl).gridTemplateRows;
  if (!tracks || tracks === 'none') return 0;
  return tracks.trim().split(/\s+/).length;
}

/** True only for the thumbnail grid — the text modes want the full box. */
function isThumbnailMosaic() {
  return !mosaicEl.hidden
    && !mosaicEl.classList.contains('general-mode')
    && !mosaicEl.classList.contains('games-mode')
    && !mosaicEl.classList.contains('article-mode');
}

/**
 * Fits the frozen-layout mosaic into its available box and publishes the
 * resulting geometry. Two forced reflows (clear → measure → write); callers
 * should debounce, which is why the resize path goes through rAF.
 */
function layoutMosaic() {
  if (!isThumbnailMosaic() || mosaicRows <= 0) {
    clearMosaicGeometry();
    return;
  }

  // Detail view: the image + doc get the whole available box, not the box
  // fitted to the row count. --mosaic-cell stays so the hidden grid underneath
  // keeps its rows (and closeDetail's reverse FLIP refits before measuring).
  if (mosaicEl.classList.contains('detail-box')) {
    MOSAIC_BOX_VARS.forEach(v => mosaicGeomHost.style.removeProperty(v));
    return;
  }

  // Clearing first makes the element lay out at its AVAILABLE size, so we can
  // read the box straight off the DOM instead of duplicating the 2%/5%/55%
  // constants here. Whatever the stylesheet says is what we fit into.
  clearMosaicGeometry();
  const avail = mosaicEl.getBoundingClientRect();
  const screen = crtScreen.getBoundingClientRect();
  if (avail.width <= 0 || avail.height <= 0) return;
  // Read, not mirrored: it's calc(33px - 1.5rem + 12px), so it moves with the
  // root font size.
  const padTop = parseFloat(getComputedStyle(mosaicEl).paddingTop) || 0;

  // Solve for cell edge on each axis, given gap = cell * ratio:
  //   width:  cols*c + (cols-1)*ratio*c = availW
  //   height: padTop + rows*c + (rows-1)*ratio*c = availH
  const cols = MOSAIC_COLS;
  const rows = mosaicRows;
  const cellByWidth = avail.width / (cols + (cols - 1) * MOSAIC_GAP_RATIO);
  const cellByHeight =
    (avail.height - padTop) / (rows + (rows - 1) * MOSAIC_GAP_RATIO);
  const cell = Math.max(1, Math.min(cellByWidth, cellByHeight));

  const gap = cell * MOSAIC_GAP_RATIO;
  const width = cols * cell + (cols - 1) * gap;
  const height = padTop + rows * cell + (rows - 1) * gap;

  // Vertically centred in whatever slack the available box has. Landscape:
  // right-anchored (the terminal owns the left side). Portrait: the box is
  // the full width, so centre horizontally too.
  const top = avail.top - screen.top + Math.max(0, (avail.height - height) / 2);

  mosaicGeomHost.style.setProperty('--mosaic-cell', `${cell}px`);
  mosaicGeomHost.style.setProperty('--mosaic-width', `${width}px`);
  mosaicGeomHost.style.setProperty('--mosaic-top', `${top}px`);
  mosaicGeomHost.style.setProperty('--mosaic-bottom', `${Math.max(0, screen.height - top - height)}px`);
  if (mosaicPortrait.matches) {
    const right = screen.right - avail.right + Math.max(0, (avail.width - width) / 2);
    mosaicGeomHost.style.setProperty('--mosaic-right', `${right}px`);
  }
}

// Resize/orientation: coalesce to one layout pass per frame. Window resize
// fires far faster than we need to recompute a static grid.
let mosaicLayoutFrame = 0;
function scheduleMosaicLayout() {
  if (mosaicLayoutFrame) return;
  mosaicLayoutFrame = requestAnimationFrame(() => {
    mosaicLayoutFrame = 0;
    layoutMosaic();
    relayoutDetail();
  });
}

// html.is-resizing kills the frame/detail geometry transitions while the
// window is being dragged, so the frame doesn't trail the grid and the detail
// image snaps to its new rect instead of replaying the fullscreen tween.
let resizeSettleTimer = 0;
function onWindowResize() {
  document.documentElement.classList.add('is-resizing');
  clearTimeout(resizeSettleTimer);
  resizeSettleTimer = setTimeout(() => document.documentElement.classList.remove('is-resizing'), 200);
  scheduleMosaicLayout();
}
window.addEventListener('resize', onWindowResize);
mosaicPortrait.addEventListener('change', scheduleMosaicLayout);

// Custom CRT scrollbar — mounted only in the scrolling views (article + games).
// One instance at a time; mountScrollbar() tears down any previous one first.
let crtScrollbar = null;
function mountScrollbar() {
  crtScrollbar?.destroy();
  crtScrollbar = createCrtScrollbar(mosaicEl, crtScreen);
}
function unmountScrollbar() {
  crtScrollbar?.destroy();
  crtScrollbar = null;
}

// ---- Detail view state ----
// Tracks which mosaic item is currently expanded (null = grid mode).
// Like a "selected" reference in a UI controller — only one at a time.
let activeDetail = null;
let detailFullscreen = false;

// ---- Article page state ----
// Tracks which article page is displayed (null = no article open).
// returnTo stores the category/label to re-render on close.
let activeArticle = null;  // { data, returnTo, observer }


// ---- Keyboard navigation state ----
// Two focus "zones" — nav menu and mosaic grid — with arrow keys moving
// within and between them. Like a console game's UI selector system:
// a cursor moves independently, Enter confirms the selection.
let navReady = false;              // true after intro finishes & nav/mosaic visible
let focusZone = null;              // 'nav' | 'mosaic' | null
let navFocusIndex = -1;
let mosaicFocusIndex = -1;
let detailOpenedByKeyboard = false; // last detail opened via Enter/Space → restore focus on close
let currentCategoryItems = [];     // content data array for current mosaic

/**
 * Staggers a per-item fade-in across mosaic items along the top-left →
 * bottom-right diagonal. Items start at opacity:0 with a tiny offset,
 * then each gets a transition-delay proportional to its grid position so
 * the reveal "sweeps" across the grid rather than popping all at once.
 *
 * Cleans up inline styles after the animation so leftover transition-delay
 * doesn't affect later hover or fade-out transitions.
 */
function applyDiagonalReveal(containerEl) {
  const itemEls = [...containerEl.querySelectorAll('.mosaic-item.reveal')];
  if (itemEls.length === 0) return;

  const rects = itemEls.map(el => el.getBoundingClientRect());
  const minX = Math.min(...rects.map(r => r.left));
  const minY = Math.min(...rects.map(r => r.top));
  const maxDiag = Math.max(...rects.map(r => (r.left - minX) + (r.top - minY))) || 1;

  itemEls.forEach((el, i) => {
    const r = rects[i];
    const diag = (r.left - minX) + (r.top - minY);
    const delay = Math.round((diag / maxDiag) * MOSAIC_CONFIG.revealStagger);
    el.style.transitionDelay = `${delay}ms`;
  });

  // Double-rAF: first frame commits the "from" state, second frame flips to "to"
  // so the browser interpolates between them. Without this, setting both in the
  // same frame = no transition, element jumps straight to final state.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      itemEls.forEach(el => el.classList.add('revealed'));
    });
  });

  // Cleanup after the last item finishes (stagger + transition + buffer).
  const cleanupDelay = MOSAIC_CONFIG.revealStagger + MOSAIC_CONFIG.revealTransition + 60;
  setTimeout(() => {
    itemEls.forEach(el => {
      el.classList.remove('reveal', 'revealed');
      el.style.transitionDelay = '';
    });
  }, cleanupDelay);
}

async function renderMosaic(category) {
  const items = CATEGORIES[category];
  if (!items) return;
  const gen = ++renderGen;

  // Leaving any scrolling view — the thumbnail grid / General don't use it.
  unmountScrollbar();

  // Close any open detail before switching categories
  if (activeDetail) closeDetail(true);

  // Store items array for keyboard detail navigation
  currentCategoryItems = items;

  // If mosaic already has content, fade out first.
  if (mosaicHasContent) {
    await fadeOutMosaic();
    if (gen !== renderGen) return;
    // A cell can still be opened (e.g. by keyboard) during the fade; close
    // it before the grid it lives in is cleared.
    if (activeDetail) closeDetail(true);
  }

  // Clear and rebuild
  clearMosaic();

  // General section renders text content instead of a thumbnail grid.
  // We reuse the same container but swap the layout mode via a CSS class.
  const isGeneral = category === 'General';
  mosaicEl.classList.remove('games-mode');
  mosaicEl.classList.toggle('general-mode', isGeneral);

  if (isGeneral) {
    renderGeneralContent();
  } else {
    const willReveal = fullMotion();
    for (const [index, item] of items.entries()) {
      const div = document.createElement('div');
      div.className = 'mosaic-item' + (willReveal ? ' reveal' : '');
      // Index into `items`: DOM position diverges from it when an item with
      // a missing thumbnail is skipped below.
      div.dataset.index = index;
      div.dataset.cols = item.cols;
      div.dataset.rows = item.rows;

      // sizes hint — now exact rather than a guess, because the column count
      // is fixed. Cell width tops out at 55vw / (8 + 7*0.1) = 55/8.7 ≈ 6.3vw
      // (less when the height fit wins), so a card is at most cols × 6.3vw.
      // Overstating this makes the browser pick a needlessly large srcset tier.
      const media = createMediaElement(item.src, {
        alt: item.alt,
        sizes: `${Math.min((item.cols || 1) * 6.3, 55).toFixed(1)}vw`,
      });
      if (!media) continue; // skip items with unresolved thumbnails
      // Videos wait for their tile's reveal (timed below, once the diagonal
      // delays are known); placeholder delay until then.
      if (willReveal && media.tagName === 'VIDEO') deferManagedVideo(media, 60000);

      div.appendChild(media);

      // Focus/name/activation target. A stretched overlay <button> rather than
      // making the cell itself a <button>: the open cell becomes the detail
      // view and gets the splat canvas + video control bar (buttons, range
      // input) appended, which is invalid inside a <button>. See .mosaic-hit.
      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'mosaic-hit';
      hit.setAttribute('aria-label', item.title || item.alt || `${category} ${index + 1}`);
      div.appendChild(hit);

      mosaicEl.appendChild(div);

      // Click → open the FLIP detail view. Mosaic items render their `page`
      // markdown inside the detail panel (buildDetailInfo), so they must NOT
      // route to openArticlePage — that's the Games full-page article view
      // (banner + crossfade), which skips the thumbnail FLIP entirely.
      div.addEventListener('click', (e) => {
        if (activeDetail) return;
        clearFocus();
        // detail === 0: activated by Enter/Space on .mosaic-hit (or .click()),
        // so closing the detail should hand focus back to this cell.
        detailOpenedByKeyboard = e.detail === 0;
        openDetail(div, item);
      });

      // Hover prefetch for splat items — start downloading the .spz file
      // while the user hovers, before they click. Browser caches the fetch,
      // so when SplatViewer later requests the same URL, it's already loaded.
      // One-shot: once: true removes the listener after first hover.
      if (item.type === 'splat' && item.splat?.file) {
        div.addEventListener('mouseenter', () => {
          const url = resolveSplat(item.splat.file);
          if (!url) return;
          // Low-priority fetch caches the .spz for when the user clicks.
          // Using fetch() instead of <link rel=prefetch> to avoid
          // accumulating orphaned DOM elements in <head>.
          fetch(url, { priority: 'low' }).catch(() => {});
        }, { once: true });
      }
    }
  }

  mosaicHasContent = true;

  // Fit the frozen grid to the box before anything is visible. Order matters:
  // measure the packed row count first (needs the items in the DOM), then size
  // the cells, then applyDiagonalReveal() below reads the FINAL positions for
  // its stagger delays. Doing it after the fade-in would show a resize pop.
  mosaicRows = isGeneral ? 0 : measureMosaicRows();
  layoutMosaic();

  // Fade in after a brief frame delay (lets browser paint the new items)
  await new Promise(r => setTimeout(r, MOSAIC_CONFIG.renderDelay));
  if (gen !== renderGen) return;
  mosaicEl.classList.add('visible');

  // Per-item diagonal reveal — thumbs cascade in top-left → bottom-right.
  // Items were born with .reveal (opacity 0 + offset); this computes their
  // positional delays and triggers the transition to .revealed. Skipped for
  // General (has its own stagger-reveal), low tier (perf) and reduced motion —
  // those items were built without .reveal, so this is a no-op for them.
  if (!isGeneral) {
    applyDiagonalReveal(mosaicEl);
    // Each video starts as its own tile begins to fade in, so they play while
    // appearing but start one by one instead of all at once (+32 ms: the
    // reveal flips on after a double rAF).
    for (const video of mosaicEl.querySelectorAll('.mosaic-item.reveal video')) {
      const delay = parseFloat(video.closest('.mosaic-item').style.transitionDelay) || 0;
      deferManagedVideo(video, delay + 32);
    }
  }

  // Trigger staggered reveal for General section on mid/high tier.
  // Each element cascades in 210ms after the previous, starting as the
  // parent fade begins — the multiplied opacities create a natural reveal.
  staggerTimeouts.forEach(clearTimeout);
  staggerTimeouts = [];
  // Targets only exist when renderGeneralContent marked them (fullMotion).
  if (isGeneral) {
    const targets = [...mosaicEl.querySelectorAll('.stagger-reveal')];
    staggerTimeouts = targets.map((el, i) =>
      setTimeout(() => el.classList.add('visible'), i * 200)
    );
  }
}

async function renderGames() {
  const gen = ++renderGen;
  if (activeDetail) closeDetail(true);
  currentCategoryItems = [];

  if (mosaicHasContent) {
    await fadeOutMosaic();
    if (gen !== renderGen) return;
    // A cell can still be opened (e.g. by keyboard) during the fade; close
    // it before the grid it lives in is cleared.
    if (activeDetail) closeDetail(true);
  }

  clearMosaic();
  mosaicEl.classList.remove('general-mode');
  mosaicEl.classList.add('games-mode');
  // Text mode — release the thumbnail grid's contain-fit box so the panel
  // (and the frame around it) expands back to the full available area.
  mosaicRows = 0;
  layoutMosaic();

  for (const game of GAMES) {
    const card = document.createElement('div');
    card.className = 'game-card';

    if (game.type === 'spritesheet') {
      const banner = createSpritesheetElement(game.spritesheet, { className: 'game-banner', alt: game.title });
      if (banner) card.appendChild(banner);
    } else if (game.type === 'parallax') {
      // Card slot is a fixed 256px column (style.css .game-card > :first-child).
      // Lite: at that size particles, light effects and the shine barely show.
      card.appendChild(createParallaxBanner(game.parallax, { className: 'game-banner', alt: game.title, sizes: '256px', lite: true }));
    } else if (game.src) {
      const banner = createMediaElement(game.src, { alt: game.title, className: 'game-banner', sizes: '55vw' });
      if (banner) card.appendChild(banner);
    }

    const info = document.createElement('div');
    info.className = 'game-info';

    const h2 = document.createElement('h2');
    h2.textContent = game.title;
    info.appendChild(h2);

    const cardText = game.description;
    if (cardText) {
      const p = document.createElement('p');
      p.innerHTML = applyInline(cardText);
      info.appendChild(p);
    }

    if (game.links?.length) {
      const linksEl = document.createElement('div');
      linksEl.className = 'game-links';
      for (const link of game.links) {
        const a = document.createElement('a');
        a.href = link.url;
        a.title = link.label;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'game-link';
        // innerHTML is safe here only because CONTACT_ICONS values are
        // literal string constants (see security contract in config/icons.js).
        const icon = CONTACT_ICONS[link.icon] ?? CONTACT_ICONS.website;
        a.innerHTML = icon;
        linksEl.appendChild(a);
      }
      info.appendChild(linksEl);
    }

    card.appendChild(info);

    if (game.page) {
      card.classList.add('has-page');
      card.addEventListener('click', (e) => {
        if (e.target.closest('.game-link')) return;
        openArticlePage(game, 'Games');
      });
    }

    mosaicEl.appendChild(card);
  }

  mosaicHasContent = true;
  await new Promise(r => setTimeout(r, MOSAIC_CONFIG.renderDelay));
  if (gen !== renderGen) return;
  mosaicEl.classList.add('visible');
  mountScrollbar();
}

// ========================================================================
//  Article Page — scrollable rich-content view (blog-post style)
// ========================================================================

/**
 * Opens an article page for an item with a `page` field.
 * Fades out the current mosaic/games content and fades in a scrollable
 * article document. Same crossfade pattern as category switching.
 *
 * @param {Object} itemData - Content item with a `page` array
 * @param {string} returnTo - Category label to re-render on close ('Games', '3D Tech', etc.)
 */
async function openArticlePage(itemData, returnTo) {
  if (activeArticle) return;
  const gen = ++renderGen;
  if (activeDetail) closeDetail(true);

  activeArticle = { data: itemData, returnTo, observer: null };
  syncUrl();
  currentCategoryItems = [];

  if (mosaicHasContent) {
    await fadeOutMosaic();
    if (gen !== renderGen) return;
    // A cell can still be opened (e.g. by keyboard) during the fade; close
    // it before the grid it lives in is cleared.
    if (activeDetail) closeDetail(true);
  }

  clearMosaic();
  mosaicEl.classList.remove('general-mode', 'games-mode');
  mosaicEl.classList.add('article-mode');
  mosaicEl.scrollTop = 0;
  // Text mode — see the games-mode note above.
  mosaicRows = 0;
  layoutMosaic();

  buildArticleNav();

  const article = buildArticleContent(itemData);
  mosaicEl.appendChild(article);

  // Scroll-triggered reveal for content blocks (replays both directions).
  activeArticle.observer = observeScrollReveal(article, mosaicEl);

  mosaicHasContent = true;
  await new Promise(r => setTimeout(r, MOSAIC_CONFIG.renderDelay));
  if (gen !== renderGen) return;
  mosaicEl.classList.add('visible');
  mountScrollbar();
}

/**
 * Builds the article page DOM tree. Pure construction — no side effects.
 * Returns a wrapper element containing header (banner + title) and body (content blocks).
 */
function buildArticleContent(itemData) {
  const wrapper = document.createElement('div');
  wrapper.className = 'article-page';

  // ---- Header: banner image + title + description ----
  const header = document.createElement('div');
  header.className = 'article-header';

  if (itemData.type === 'spritesheet' || itemData.type === 'parallax' || itemData.src) {
    const bannerMedia = itemData.type === 'spritesheet'
      ? createSpritesheetElement(itemData.spritesheet, { className: 'article-banner', alt: itemData.title || '', responsive: true })
      : itemData.type === 'parallax'
        ? createParallaxBanner(itemData.parallax, { className: 'article-banner', alt: itemData.title || '', sizes: '55vw', lazy: false })
        : createMediaElement(itemData.src, {
        alt: itemData.title || '',
        className: 'article-banner',
        lazy: false,
        sizes: '55vw',
      });
    if (bannerMedia) {
      const bannerWrap = document.createElement('div');
      bannerWrap.className = 'article-banner-wrap';
      // The wrap dims its contents (brightness filter to offset CRT glow on
      // photos). The sprite title is already authored at the right brightness,
      // so clear it for sprite banners to avoid a muted look.
      if (itemData.type === 'spritesheet') bannerWrap.style.filter = 'none';
      bannerWrap.appendChild(bannerMedia);
      header.appendChild(bannerWrap);
    }
  }

  if (itemData.title || itemData.links?.length) {
    const titleRow = document.createElement('div');
    titleRow.className = 'article-title-row';

    if (itemData.title) {
      const title = document.createElement('h1');
      title.className = 'article-title';
      title.textContent = itemData.title;
      titleRow.appendChild(title);
    }

    if (itemData.links?.length) {
      const linksEl = document.createElement('div');
      linksEl.className = 'article-header-links';
      for (const link of itemData.links) {
        const a = document.createElement('a');
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'article-link';
        const icon = CONTACT_ICONS[link.icon] ?? CONTACT_ICONS.website;
        a.innerHTML = `${icon}<span>${link.label}</span>`;
        linksEl.appendChild(a);
      }
      titleRow.appendChild(linksEl);
    }

    header.appendChild(titleRow);
  }

  if (itemData.description) {
    const desc = document.createElement('p');
    desc.className = 'article-description';
    desc.innerHTML = applyInline(itemData.description);
    header.appendChild(desc);
  }

  wrapper.appendChild(header);

  // ---- Body: content blocks (parsed from markdown) ----
  if (itemData.page) {
    const body = document.createElement('div');
    body.className = 'article-body';
    const fragment = parseMarkdown(itemData.page, {
      // Article figures render inside the ~55vw column (floats are narrower,
      // but sizes only needs an upper bound to beat the 100vw default).
      createMediaElement: (src, o) => createMediaElement(src, { sizes: '55vw', ...o }),
      iconMap: CONTACT_ICONS,
    });
    body.appendChild(fragment);
    wrapper.appendChild(body);
  }

  return wrapper;
}


/**
 * Builds the article nav bar — back button only, no prev/next arrows.
 * Appended to crtScreen (same as detail nav). The mosaic grid in article-mode
 * disables pointer-events so clicks pass through to this nav underneath.
 */
function buildArticleNav() {
  const existing = crtScreen.querySelector('.detail-nav');
  if (existing) existing.remove();

  const nav = document.createElement('div');
  // masthead: the article-mode content scrolls in its own container, so lift the
  // nav above the grid (like landscape 3D-art detail) to mask content scrolling
  // up beneath the back button.
  nav.className = 'detail-nav crt-effects masthead';

  const backBtn = document.createElement('button');
  backBtn.textContent = '< back';
  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeArticlePage();
  });

  nav.appendChild(backBtn);
  crtScreen.appendChild(nav);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nav.classList.add('visible');
    });
  });
}

/**
 * Closes the article page, returning to the view the user came from.
 * Mirrors the open transition in reverse.
 */
async function closeArticlePage() {
  if (!activeArticle) return;

  const { returnTo, observer } = activeArticle;
  if (observer) observer.disconnect();

  // Drop the custom scrollbar as the article fades (re-mounted by the target
  // view if it scrolls — e.g. returning to Games).
  unmountScrollbar();

  // Remove nav bar
  crtScreen.querySelector('.detail-nav')?.remove();

  // Fade out article
  const gen = ++renderGen;
  await fadeOutMosaic();
  // A nav click during the fade already tore the article down and owns the view.
  if (gen !== renderGen) return;

  clearMosaic();
  mosaicEl.classList.remove('article-mode');
  activeArticle = null;
  syncUrl();

  // Re-render the previous view
  if (returnTo === 'Games') {
    await renderGames();
  } else {
    await renderMosaic(returnTo);
  }
}

/**
 * Builds the General section — a text-based CV/bio instead of thumbnails.
 *
 * Think of it like a UI panel in a game engine: structured data (GENERAL_CONTENT)
 * gets turned into DOM elements, styled via CSS. No images, just typography.
 */
function renderGeneralContent() {
  const gc = GENERAL_CONTENT;

  const wrapper = document.createElement('div');
  wrapper.className = 'general-content';

  // --- Header block: name + titles (individual elements for stagger) ---
  const header = document.createElement('header');
  header.className = 'general-header';

  const gcName = document.createElement('h1');
  gcName.className = 'general-name';
  gcName.textContent = gc.name;

  const gcTitle = document.createElement('p');
  gcTitle.className = 'general-title';
  gcTitle.textContent = gc.title;

  const gcSubtitle = document.createElement('p');
  gcSubtitle.className = 'general-subtitle';
  gcSubtitle.textContent = gc.subtitle;

  header.appendChild(gcName);
  header.appendChild(gcTitle);
  header.appendChild(gcSubtitle);
  wrapper.appendChild(header);

  // --- Summary ---
  const summary = document.createElement('p');
  summary.className = 'general-summary';
  summary.textContent = gc.summary;
  wrapper.appendChild(summary);

  // --- Divider ---
  const divider1 = createDivider();
  wrapper.appendChild(divider1);

  // --- Skills list ---
  const skillsSection = document.createElement('div');
  skillsSection.className = 'general-skills';
  for (const skill of gc.skills) {
    const row = document.createElement('div');
    row.className = 'general-skill-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'general-skill-label';
    labelSpan.textContent = skill.label;
    const detailSpan = document.createElement('span');
    detailSpan.className = 'general-skill-detail';
    detailSpan.textContent = skill.detail;
    row.appendChild(labelSpan);
    row.appendChild(detailSpan);
    skillsSection.appendChild(row);

    if (skill.thumbnails?.length) {
      const thumbsRow = document.createElement('div');
      thumbsRow.className = 'general-skill-thumbs';

      for (const ref of skill.thumbnails) {
        const item = CATEGORIES[ref.category]?.[ref.itemIndex];
        if (!item) continue;

        const media = createMediaElement(item.src, { alt: item.alt ?? '', sizes: '15vw' });
        if (!media) continue;

        const thumb = document.createElement('div');
        thumb.className = 'general-skill-thumb';
        thumb.appendChild(media);
        thumbsRow.appendChild(thumb);

        thumb.addEventListener('click', () => {
          switchToAndOpenDetail(ref.category, ref.itemIndex);
        });
      }

      skillsSection.appendChild(thumbsRow);
    }
  }
  wrapper.appendChild(skillsSection);

  // --- Divider ---
  const divider2 = createDivider();
  wrapper.appendChild(divider2);

  // --- Tools ---
  const toolsRow = document.createElement('div');
  toolsRow.className = 'general-tools';
  for (const t of gc.tools) {
    const span = document.createElement('span');
    span.className = 'general-tool';
    span.textContent = t;
    toolsRow.appendChild(span);
  }
  wrapper.appendChild(toolsRow);

  // --- Contact icons ---
  let divider3 = null;
  let contactRow = null;
  if (gc.contacts?.length) {
    divider3 = createDivider();
    wrapper.appendChild(divider3);

    contactRow = document.createElement('div');
    contactRow.className = 'general-contacts';
    for (const c of gc.contacts) {
      // Two kinds: link contacts (open a URL) and copy contacts (show text on hover)
      if (c.copyText) {
        const item = document.createElement('div');
        item.className = 'general-contact-item';
        item.setAttribute('aria-label', c.label);

        const icon = document.createElement('div');
        icon.className = 'general-contact-icon';
        if (CONTACT_ICONS[c.platform]) {
          // innerHTML safe only because CONTACT_ICONS values are literal
          // constants; see security contract in config/icons.js.
          icon.innerHTML = CONTACT_ICONS[c.platform];
        } else {
          icon.textContent = c.label;
        }

        const typeout = document.createElement('span');
        typeout.className = 'general-contact-typeout';

        item.appendChild(icon);
        item.appendChild(typeout);
        contactRow.appendChild(item);

        // Typing animation on hover — like a terminal echoing back info.
        // We store the timeout/interval IDs on the element so we can clean
        // them up on mouseleave (same pattern as cancelling a coroutine).
        let typeInterval = null;
        let charIndex = 0;
        let copiedTimeout = null;
        let isHovering = false;

        const startTypeout = () => {
          if (typeInterval) { clearInterval(typeInterval); typeInterval = null; }
          charIndex = 0;
          typeout.textContent = '\u00A0'; // non-breaking space — preserved by browser, creates gap before text
          typeout.classList.add('typing');
          typeInterval = setInterval(() => {
            if (charIndex < c.copyText.length) {
              typeout.textContent += c.copyText[charIndex];
              charIndex++;
            } else {
              clearInterval(typeInterval);
              typeInterval = null;
            }
          }, 40);
        };

        item.addEventListener('mouseenter', () => {
          isHovering = true;
          if (typeout.classList.contains('copied')) return; // let "Copied!" finish showing
          startTypeout();
        });

        item.addEventListener('mouseleave', () => {
          isHovering = false;
          if (typeInterval) { clearInterval(typeInterval); typeInterval = null; }
          if (typeout.classList.contains('copied')) return; // don't wipe "Copied!" early
          typeout.classList.remove('typing');
          typeout.textContent = '';
        });

        item.addEventListener('click', () => {
          // clipboard is undefined on insecure origins (e.g. LAN dev over http).
          navigator.clipboard?.writeText(c.copyText).catch(() => {});
          if (typeInterval) { clearInterval(typeInterval); typeInterval = null; }
          if (copiedTimeout) { clearTimeout(copiedTimeout); }
          typeout.classList.remove('typing');
          typeout.classList.add('copied');
          typeout.textContent = '\u00A0Copied!';
          copiedTimeout = setTimeout(() => {
            typeout.classList.remove('copied');
            typeout.textContent = '';
            copiedTimeout = null;
            if (isHovering) startTypeout(); // resume typeout if still hovering
          }, 1000);
        });

      } else {
        if (!/^https?:\/\//i.test(c.url)) {
          console.warn(`Skipping non-http contact URL: ${c.url}`);
          continue;
        }
        const a = document.createElement('a');
        a.href = c.url;
        a.className = 'general-contact-link';
        a.setAttribute('aria-label', c.label);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        if (CONTACT_ICONS[c.platform]) {
          // innerHTML safe only because CONTACT_ICONS values are literal
          // constants; see security contract in config/icons.js.
          a.innerHTML = CONTACT_ICONS[c.platform];
        } else {
          a.textContent = c.label;
        }
        contactRow.appendChild(a);
      }
    }
    wrapper.appendChild(contactRow);
  }

  // Stagger reveal on mid/high tier without reduced motion — mark each
  // top-level block. JS triggers .visible on each after the mosaic fades in.
  if (fullMotion()) {
    const staggerTargets = [gcName, gcTitle, gcSubtitle, summary, divider1, skillsSection, divider2, toolsRow];
    if (divider3) staggerTargets.push(divider3);
    if (contactRow) staggerTargets.push(contactRow);
    for (const el of staggerTargets) el.classList.add('stagger-reveal');
  }

  mosaicEl.appendChild(wrapper);
}

/** Creates a styled horizontal divider for the General section. */
function createDivider() {
  const hr = document.createElement('div');
  hr.className = 'general-divider';
  return hr;
}

/**
 * Returns the natural aspect ratio of the media element inside a mosaic item.
 *
 * Like reading an image's native resolution in an asset pipeline —
 * we need the true dimensions, not the displayed size, to compute layout.
 *
 * @param {HTMLElement} itemEl - The .mosaic-item div
 * @returns {number} width / height (>1 = landscape, ≤1 = portrait)
 */
function getMediaAspectRatio(itemEl) {
  const media = itemEl.querySelector('img, video');
  if (!media) return 1;
  if (media.tagName === 'VIDEO') return media.videoWidth / media.videoHeight || 1;
  if (!media.complete || media.naturalWidth === 0) return 1;
  return media.naturalWidth / media.naturalHeight;
}

/**
 * Computes where the detail image + info panel should go, based on aspect ratio.
 *
 * This is the core of the new approach: instead of letting CSS layout
 * determine the target rect (which fights with FLIP), we calculate it
 * mathematically — like computing a camera's viewport rect in a game engine.
 *
 * @param {HTMLElement} itemEl - The .mosaic-item div (for AR)
 * @param {DOMRect} containerRect - The mosaic container's bounding rect
 * @returns {{ targetRect: {x,y,w,h}, infoSide: 'below'|'left'|'right' }}
 */
// Height reserved for the detail nav bar (back + prev/next arrows), from the
// grid's top: .detail-nav's 12px offset + its 2.5rem height + 18px clearance.
function detailNavHeight() {
  return 12 + 2.5 * remPx() + 18;
}

// `prev` pins the portrait side (and, on a resize relayout, the aspect ratio
// chosen at open); without it the side comes from the thumbnail's grid rect.
function computeDetailLayout(itemEl, containerRect, itemData = {}, prev = null) {
  const ar = prev?.ar ?? getMediaAspectRatio(itemEl);
  const navH = detailNavHeight();
  const cw = containerRect.width;
  const ch = containerRect.height - navH; // available height below nav bar

  let x, y, w, h, infoSide;
  y = navH;

  const forced = itemData.detailLayout;

  if (forced === 'info-left' || forced === 'info-right') {
    // Portrait sizing — image on one side, info on the other
    h = ch * 0.85;
    w = h * ar;
    if (w > cw * 0.5) { w = cw * 0.5; h = w / ar; }
    if (forced === 'info-left') { x = cw - w; infoSide = 'left'; }
    else                        { x = 0;      infoSide = 'right'; }
  } else if (forced === 'info-below' || forced === 'below-split') {
    // Landscape sizing — image on top, info below (or split below)
    w = cw;
    h = w / ar;
    if (h > ch * 0.6) { h = ch * 0.6; w = h * ar; }
    x = (cw - w) / 2;
    infoSide = forced === 'below-split' ? 'below-split' : 'below';
  } else if (ar > 1) {
    // ---- Auto landscape: image at top (below nav), info below ----
    w = cw;
    h = w / ar;
    // Cap height at 60% of available space so info panel has room
    if (h > ch * 0.6) {
      h = ch * 0.6;
      w = h * ar;
    }
    // Center horizontally if width was capped
    x = (cw - w) / 2;
    infoSide = 'below';
  } else {
    // ---- Auto portrait: image on one side, info beside it ----
    h = ch * 0.85;
    w = h * ar;
    // Cap width at 50% so info panel gets the other half
    if (w > cw * 0.5) {
      w = cw * 0.5;
      h = w / ar;
    }

    // Determine side: which edge of the mosaic is the thumbnail closer to?
    let leftHalf;
    if (prev) {
      leftHalf = prev.infoSide === 'right';
    } else {
      const thumbRect = itemEl.getBoundingClientRect();
      leftHalf = thumbRect.left + thumbRect.width / 2 <= containerRect.left + cw / 2;
    }

    if (leftHalf) {
      // Thumbnail is on the left side → image stays left, info on right
      x = 0;
      infoSide = 'right';
    } else {
      // Thumbnail is on the right side → image on right, info on left
      x = cw - w;
      infoSide = 'left';
    }
  }

  return { targetRect: { x, y, w, h }, infoSide, ar };
}

// ============================================
// Detail View Enhancements
// ============================================

/**
 * Computes the largest AR-preserved rect that fits the full container.
 * Used for fullscreen mode — fills wall-to-wall, centered.
 *
 * @param {number} ar - Aspect ratio (width / height)
 * @param {DOMRect} containerRect - The mosaic container's bounding rect
 * @returns {{ x, y, w, h }}
 */
function computeFullscreenRect(ar, containerRect, topMargin = 0) {
  const cw = containerRect.width, ch = containerRect.height - topMargin;
  let w, h;
  if (cw / ch > ar) { h = ch; w = h * ar; } else { w = cw; h = w / ar; }
  return { x: (cw - w) / 2, y: topMargin + (ch - h) / 2, w, h };
}

/** Writes a {x,y,w,h} rect as inline left/top/width/height px. */
function setRect(el, r) {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/**
 * Fullscreen target for an image of aspect `ar`, below the back button nav
 * bar — its actual bottom is measured so the image never slides under it.
 */
function detailFullscreenRect(ar, containerRect) {
  const nav = crtScreen.querySelector('.detail-nav');
  const topMargin = nav
    ? Math.max(0, nav.getBoundingClientRect().bottom - containerRect.top) + 8
    : 0;
  return computeFullscreenRect(ar, containerRect, topMargin);
}

/**
 * Expands the detail image to fill the container (AR-preserved).
 * Fades out the info panel and hides the prev/next arrows.
 */
function enterDetailFullscreen() {
  if (!activeDetail || detailFullscreen) return;
  const { el: itemEl } = activeDetail;
  const layout = itemEl._detailLayout;
  if (!layout) return;

  const { targetRect } = layout;
  const fsRect = detailFullscreenRect(targetRect.w / targetRect.h, mosaicEl.getBoundingClientRect());

  // Reset any scroll so the image expands from its unscrolled position (the
  // info is about to fade out, so the page collapses to a single screen anyway).
  mosaicEl.scrollTop = 0;

  itemEl.classList.add('detail-transitioning');
  void itemEl.offsetWidth; // force reflow so browser commits "from" state before animating
  setRect(itemEl, fsRect);

  const info = mosaicEl.querySelector('.detail-info');
  if (info) { info.classList.remove('visible'); info.style.pointerEvents = 'none'; }

  const arrows = crtScreen.querySelector('.detail-nav-arrows');
  if (arrows) arrows.classList.add('hidden');

  // Backdrop behind itemEl — clicking outside the image exits fullscreen
  const backdrop = document.createElement('div');
  backdrop.className = 'gallery-fs-backdrop';
  backdrop.addEventListener('click', exitDetailFullscreen);
  mosaicEl.appendChild(backdrop);
  activeDetail._mainFsBackdrop = backdrop;

  detailFullscreen = true;
}

/**
 * Returns from fullscreen back to the normal detail layout.
 */
/**
 * Enters fullscreen for a gallery companion image (e.g. the side panel image
 * in a 'below-split' layout). Creates a temporary overlay div that FLIP-animates
 * from the image's current position to fill the container, then fades out the
 * info panel — mirroring the main-thumb fullscreen experience.
 */
/**
 * Source (`from`) and fullscreen (`to`) rects for a gallery image, in the
 * scroll container's content space. Re-run on resize, since both move.
 */
function galleryFullscreenRects(imgEl) {
  const containerRect = mosaicEl.getBoundingClientRect();
  const imgRect = imgEl.getBoundingClientRect();

  // mosaicEl (.detail-scroll) is the scroll container in BOTH portrait and
  // landscape. getBoundingClientRect is viewport-relative, but the overlay +
  // backdrop are absolutely positioned inside the SCROLLED content — so convert
  // to content space by adding the scroll offset. (The gallery side-image never
  // exposed this: it always sits at scroll 0.)
  const scrollLeft = mosaicEl.scrollLeft;
  const scrollTop = mosaicEl.scrollTop;

  const from = {
    x: imgRect.left - containerRect.left + scrollLeft,
    y: imgRect.top - containerRect.top + scrollTop,
    w: imgRect.width,
    h: imgRect.height,
  };
  const to = detailFullscreenRect(from.w / from.h, containerRect);
  // computeFullscreenRect returns viewport-relative (visual) coords; shift into
  // content space too so the zoomed image lands centered in the CURRENT view.
  to.x += scrollLeft;
  to.y += scrollTop;
  return { from, to };
}

function enterGalleryImageFullscreen(imgEl) {
  if (!activeDetail || detailFullscreen) return;

  const { from, to } = galleryFullscreenRects(imgEl);

  // Lock scrolling while zoomed so the content (and the content-space overlay)
  // can't drift out from under the backdrop. Restored on exit.
  mosaicEl.style.overflow = 'hidden';

  // Backdrop covers the full scrollable content (not just the viewport) so it
  // masks everything regardless of the current scroll position.
  const backdrop = document.createElement('div');
  backdrop.className = 'gallery-fs-backdrop';
  backdrop.style.bottom = 'auto';
  backdrop.style.height = `${mosaicEl.scrollHeight}px`;
  backdrop.addEventListener('click', exitDetailFullscreen);
  mosaicEl.appendChild(backdrop);

  const overlay = document.createElement('div');
  overlay.className = 'gallery-fs-overlay';
  setRect(overlay, from);

  const overlayImg = document.createElement('img');
  // currentSrc = the variant the browser actually picked (avif/webp) for a
  // <picture>; falls back to .src for a bare <img>. Avoids refetching the png.
  overlayImg.src = imgEl.currentSrc || imgEl.src;
  overlayImg.decoding = 'async';
  overlay.appendChild(overlayImg);
  mosaicEl.appendChild(overlay);

  // FLIP: commit "from" state then animate to "to"
  void overlay.offsetWidth;
  setRect(overlay, to);

  // Fade out main detail image alongside the info panel
  const { el: itemEl } = activeDetail;
  itemEl.style.opacity = '0';

  const info = mosaicEl.querySelector('.detail-info');
  if (info) { info.classList.remove('visible'); info.style.pointerEvents = 'none'; }

  const arrows = crtScreen.querySelector('.detail-nav-arrows');
  if (arrows) arrows.classList.add('hidden');

  activeDetail._galleryOverlay = overlay;
  activeDetail._galleryBackdrop = backdrop;
  activeDetail._galleryFromRect = from;
  activeDetail._galleryImg = imgEl;
  detailFullscreen = true;
}

function exitDetailFullscreen() {
  if (!activeDetail || !detailFullscreen) return;

  // Gallery image fullscreen — animate overlay back, restore main image + info
  if (activeDetail._galleryOverlay) {
    const overlay = activeDetail._galleryOverlay;
    const backdrop = activeDetail._galleryBackdrop;
    const fromRect = activeDetail._galleryFromRect;
    activeDetail._galleryOverlay = null;
    activeDetail._galleryBackdrop = null;
    activeDetail._galleryFromRect = null;
    detailFullscreen = false;

    // Remove backdrop immediately — no animation needed
    backdrop?.remove();

    // Restore scrolling locked in enterGalleryImageFullscreen.
    mosaicEl.style.overflow = '';

    // Block re-click during exit animation
    overlay.style.pointerEvents = 'none';

    // Reverse FLIP: animate overlay back to where the side image was
    overlay.style.left = `${fromRect.x}px`;
    overlay.style.top = `${fromRect.y}px`;
    overlay.style.width = `${fromRect.w}px`;
    overlay.style.height = `${fromRect.h}px`;

    // Restore main detail image opacity (fades in while overlay retreats)
    if (activeDetail) activeDetail.el.style.opacity = '';

    // After animation: remove overlay, restore info + arrows. Runs once
    // (transitionend and the timeout both call it), and leaves info/arrows
    // alone if fullscreen was re-entered in the meantime.
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      overlay.remove();
      if (detailFullscreen) return;
      const info = mosaicEl.querySelector('.detail-info');
      if (info) { info.classList.add('visible'); info.style.pointerEvents = ''; }
      const arrows = crtScreen.querySelector('.detail-nav-arrows');
      if (arrows) arrows.classList.remove('hidden');
    };
    overlay.addEventListener('transitionend', (e) => { if (e.target === overlay) cleanup(); });
    setTimeout(cleanup, 350);
    return;
  }

  const { el: itemEl } = activeDetail;
  const layout = itemEl._detailLayout;
  if (!layout) return;

  activeDetail._mainFsBackdrop?.remove();
  activeDetail._mainFsBackdrop = null;

  const { targetRect } = layout;
  itemEl.style.left = `${targetRect.x}px`;
  itemEl.style.top = `${targetRect.y}px`;
  itemEl.style.width = `${targetRect.w}px`;
  itemEl.style.height = `${targetRect.h}px`;

  const info = mosaicEl.querySelector('.detail-info');
  if (info) { info.classList.add('visible'); info.style.pointerEvents = ''; }

  const arrows = crtScreen.querySelector('.detail-nav-arrows');
  if (arrows) arrows.classList.remove('hidden');

  detailFullscreen = false;

  // Remove transition class once the CSS animation completes (fallback: 350ms).
  // Once only, own transitions only, and not if fullscreen was re-entered
  // (that re-adds the class for its own animation).
  let cleanedUp = false;
  const onEnd = (e) => { if (e.target === itemEl) cleanup(); };
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    itemEl.removeEventListener('transitionend', onEnd);
    const mainFsReentered = detailFullscreen && activeDetail?.el === itemEl && !activeDetail._galleryOverlay;
    if (!mainFsReentered) itemEl.classList.remove('detail-transitioning');
  };
  itemEl.addEventListener('transitionend', onEnd);
  setTimeout(cleanup, 350);
}

/**
 * Attaches the fullscreen click handler to the media element inside itemEl.
 * Stores handler + element refs on activeDetail for later cleanup.
 */
function attachMediaClickHandler(itemEl) {
  const media = itemEl.querySelector('img, video');
  if (!media) return;
  // Toggle, not just enter: during fullscreen the item is raised above the
  // backdrop (z-index, see .detail-transitioning in style.css) so the video
  // controls stay clickable — which means the media itself now receives
  // clicks that used to land on the backdrop. Exiting here preserves the
  // "click anywhere to leave fullscreen" behavior.
  const handler = () => { detailFullscreen ? exitDetailFullscreen() : enterDetailFullscreen(); };
  media.addEventListener('click', handler);
  if (activeDetail) {
    activeDetail._mediaEl = media;
    activeDetail._mediaHandler = handler;
  }
}

/** Removes the fullscreen click handler registered by attachMediaClickHandler. */
function detachMediaClickHandler() {
  if (activeDetail?._mediaEl && activeDetail?._mediaHandler) {
    activeDetail._mediaEl.removeEventListener('click', activeDetail._mediaHandler);
  }
}

/**
 * Opens the detail view for a clicked mosaic item using FLIP animation.
 *
 * New approach: instead of switching CSS layout and measuring the result,
 * we compute the target rect in JS and position with absolute + inline styles.
 * The grid stays intact (siblings hidden). No display switching = no mismatch.
 *
 * Uses uniform scale (based on width ratio) so the image never distorts.
 * Like a DOTween sequence that interpolates position + scale together.
 *
 * @param {HTMLElement} itemEl - The .mosaic-item div that was clicked
 * @param {Object} itemData - The content data (src, title, description, etc.)
 */
function openDetail(itemEl, itemData) {
  const sessionId = ++detailSessionId;
  activeDetail = { el: itemEl, data: itemData, viewer: null, videoControls: null, sessionId, placeholder: null };
  syncUrl();

  const containerRect = mosaicEl.getBoundingClientRect();

  // ---- FIRST: snapshot the item's grid position relative to mosaic ----
  const itemRect = itemEl.getBoundingClientRect();
  const firstRect = {
    x: itemRect.left - containerRect.left,
    y: itemRect.top - containerRect.top,
    w: itemRect.width,
    h: itemRect.height,
  };

  // The detail view uses the full available box, not the box fitted to the
  // thumbnail rows. Measure it with a probe toggle; the grid itself only grows
  // once the FLIP lands (expandDetailBox), because growing it now would reflow
  // the fading siblings mid-fade. Until then the item sits offset inside the
  // fitted grid at the same on-screen spot.
  mosaicEl.classList.add('detail-box');
  const boxRect = mosaicEl.getBoundingClientRect();
  mosaicEl.classList.remove('detail-box');
  const offX = boxRect.left - containerRect.left;
  const offY = boxRect.top - containerRect.top;

  // ---- Compute target rect (no CSS layout switching needed) ----
  // Portrait side = which half of the fitted grid the thumbnail is in; decided
  // here because computeDetailLayout only sees the (wider) box.
  const leftHalf = itemRect.left + itemRect.width / 2 <= containerRect.left + containerRect.width / 2;
  const layout = computeDetailLayout(itemEl, boxRect, itemData, { infoSide: leftHalf ? 'right' : 'left' });
  const { targetRect } = layout;
  const shiftedRect = { ...targetRect, x: targetRect.x + offX, y: targetRect.y + offY };

  // Store layout on the element for closeDetail / navigateDetail / resize
  itemEl._detailLayout = layout;

  // Let clicks pass through grid to nav bar underneath
  mosaicEl.classList.add('detail-mode');

  // Insert a placeholder before itemEl to hold its grid slot while it's
  // position:absolute. Without this, the grid reflows the moment itemEl
  // leaves flow and every subsequent sibling jumps to fill the gap.
  const placeholder = document.createElement('div');
  placeholder.className = 'mosaic-item mosaic-placeholder';
  placeholder.dataset.cols = itemEl.dataset.cols;
  placeholder.dataset.rows = itemEl.dataset.rows;
  mosaicEl.insertBefore(placeholder, itemEl);
  activeDetail.placeholder = placeholder;

  // Fade out siblings (placeholder included — it fades to transparent)
  const allItems = mosaicEl.querySelectorAll('.mosaic-item');
  allItems.forEach(el => {
    if (el !== itemEl) el.classList.add('fading-out');
  });
  // .fading-out is opacity:0 — the videos underneath still intersect the
  // viewport, so the offscreen manager (sans IO-v2) won't catch them.
  // Pause them explicitly; closeDetail/navigateDetail resume.
  pauseManagedVideos(v => !itemEl.contains(v));

  // Position the item absolutely at the target rect
  itemEl.classList.add('detail-active');
  setRect(itemEl, shiftedRect);

  // ---- FLIP: animate from grid rect → target rect ----
  // Uniform scale based on width — avoids distortion
  const s = firstRect.w / targetRect.w;
  const dx = firstRect.x - shiftedRect.x;
  const dy = firstRect.y - shiftedRect.y;

  const anim = itemEl.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], {
    // WAAPI ignores the CSS reduced-motion block; 0 still fires onfinish.
    duration: prefersReducedMotion() ? 0 : 400,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'none',
  });

  // Build nav bar immediately so it's visible during the FLIP animation
  buildDetailNav(itemData, layout);

  anim.onfinish = () => {
    if (activeDetail?.sessionId === sessionId) expandDetailBox();
    buildDetailInfo(itemData, layout);
    // Attach click-to-fullscreen on the media element
    if (activeDetail?.sessionId === sessionId) {
      attachMediaClickHandler(itemEl);
      activeDetail.videoControls = mountDetailVideoControls(itemEl, itemData);
    }

    // If this is a splat item, mount the 3D viewer on top of the thumbnail
    if (itemData.type === 'splat' && itemData.splat?.file) {
      mountSplatViewer(itemEl, itemData).then((viewer) => {
        // Session ID check: if the user closed/reopened detail while the async
        // import was in flight, this mount belongs to a stale session.
        // Without this, rapid open/close/reopen leaks WebGL contexts.
        if (activeDetail?.sessionId === sessionId) {
          activeDetail.viewer = viewer;
        } else {
          destroySplatViewer(viewer);
        }
      });
    }
  };
}

/**
 * Creates the detail navigation bar (back + prev/next arrows) at the top
 * of the mosaic container. Appended as a sibling of mosaic items.
 *
 * @param {Object} itemData - Current item data (unused for now, but available)
 * @param {Object} layout - From computeDetailLayout
 */
function buildDetailNav(itemData, layout) {
  // Remove any existing nav bar (safety)
  const existing = crtScreen.querySelector('.detail-nav');
  if (existing) existing.remove();

  const nav = document.createElement('div');
  nav.className = 'detail-nav crt-effects';

  // Back button (left side)
  const backBtn = document.createElement('button');
  backBtn.textContent = '< back';
  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (detailFullscreen) exitDetailFullscreen();
    // detail === 0: Enter/Space on the focused button — return focus to the cell.
    else if (e.detail === 0) closeDetailFromKeyboard(true);
    else closeDetail();
  });

  // Prev/next arrows (right side)
  const arrows = document.createElement('div');
  arrows.className = 'detail-nav-arrows';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'detail-nav-prev';
  prevBtn.textContent = '<';
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateDetail(-1);
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'detail-nav-next';
  nextBtn.textContent = '>';
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateDetail(1);
  });

  arrows.appendChild(prevBtn);
  arrows.appendChild(nextBtn);

  nav.appendChild(backBtn);
  nav.appendChild(arrows);
  crtScreen.appendChild(nav);

  // Set disabled state based on current position
  updateDetailNavButtons();

  // Fade in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nav.classList.add('visible');
    });
  });
}

/**
 * Updates the disabled state of prev/next buttons based on current index.
 */
function updateDetailNavButtons() {
  const nav = crtScreen.querySelector('.detail-nav');
  if (!nav) return;

  // Same list navigateDetail walks: placeholder excluded.
  const mosaicItems = [...mosaicEl.querySelectorAll('.mosaic-item:not(.mosaic-placeholder)')];
  const currentIdx = activeDetail ? mosaicItems.indexOf(activeDetail.el) : -1;

  const prevBtn = nav.querySelector('.detail-nav-prev');
  const nextBtn = nav.querySelector('.detail-nav-next');

  if (prevBtn) prevBtn.disabled = currentIdx <= 0;
  if (nextBtn) nextBtn.disabled = currentIdx < 0 || currentIdx >= mosaicItems.length - 1;
}

/**
 * Creates and injects the detail info panel (title + description).
 * Positioned based on the layout computed by computeDetailLayout.
 *
 * Landscape: below the image, full container width.
 * Portrait: beside the image, filling the remaining horizontal space.
 *
 * @param {Object} itemData - Content data (title, description, etc.)
 * @param {Object} layout - From computeDetailLayout ({targetRect, infoSide})
 */
/**
 * Renders an item's text body into a detail-info container.
 * `description` is the lead paragraph (same text shown on cards/mobile); when a
 * `page` exists it follows as full Markdown via parseMarkdown. So `page` should
 * NOT repeat the description — the renderer prepends it here.
 *
 * @param {HTMLElement} container - Where the body is appended (info or text column)
 * @param {Object} itemData - Content data (page, description, ...)
 */
function appendDetailBody(container, itemData) {
  if (itemData.page) {
    const body = document.createElement('div');
    body.className = 'detail-info-body';
    // Lead paragraph from `description`, so the doc opens with the same intro
    // shown elsewhere without it being hand-copied into the `page` markdown.
    if (itemData.description) {
      const lead = document.createElement('p');
      lead.className = 'article-description';
      lead.innerHTML = applyInline(itemData.description);
      body.appendChild(lead);
    }
    const fragment = parseMarkdown(itemData.page, {
      // Article figures render inside the ~55vw column (floats are narrower,
      // but sizes only needs an upper bound to beat the 100vw default).
      createMediaElement: (src, o) => createMediaElement(src, { sizes: '55vw', ...o }),
      iconMap: CONTACT_ICONS,
    });
    body.appendChild(fragment);
    // The detail panel has no scroll-reveal observer (unlike the article page)
    // and fades in as a whole, so reveal markdown blocks immediately —
    // otherwise .article-reveal keeps them at opacity: 0.
    body.querySelectorAll('.article-reveal').forEach(el => el.classList.add('revealed'));
    // Make embedded images zoomable, mirroring the main thumbnail + gallery
    // side-image fullscreen behaviour. Bind on the whole <figure> (not the bare
    // <img>) so floated images with wrapping text + caption are a reliable hit
    // target. Video figures have no <img> and are skipped.
    body.querySelectorAll('.article-figure').forEach((fig) => {
      const img = fig.querySelector('img');
      if (!img) return;
      fig.classList.add('zoomable');
      fig.addEventListener('click', () => enterGalleryImageFullscreen(img));
    });
    container.appendChild(body);
  } else if (itemData.description) {
    const p = document.createElement('p');
    p.innerHTML = applyInline(itemData.description);
    container.appendChild(p);
  }
}

const DETAIL_PAD_X = 16; // portrait doc horizontal padding (px)
const DETAIL_PAD_Y = 24; // portrait doc top padding (px)
const DETAIL_GAP = 24;   // horizontal gap between image and wrapped text (px)

/**
 * Writes the layout-dependent geometry of a detail-info panel. Split out of
 * buildDetailInfo so a resize can re-run it on the live panel.
 */
function positionDetailInfo(info, { targetRect, infoSide }, containerWidth) {
  if (infoSide === 'below' || infoSide === 'below-split') {
    // Landscape: pin the doc directly under the image at its natural height.
    info.style.top = `${targetRect.y + targetRect.h}px`;
    return;
  }
  info.style.top = `${targetRect.y}px`;
  info.style.width = `${containerWidth}px`;
  const spacer = info.querySelector('.detail-info-float');
  if (!spacer) return;
  // From the doc's content-top (targetRect.y + PAD_Y) down to the image's
  // bottom (targetRect.y + targetRect.h): the wrapped text clears at image bottom.
  spacer.style.height = `${targetRect.h - DETAIL_PAD_Y}px`;
  // Width spans image width + gap; negative margin pulls the float's outer
  // edge out of the doc padding to sit flush with the image's outer edge.
  spacer.style.width = `${targetRect.w + DETAIL_GAP}px`;
}

function buildDetailInfo(itemData, layout) {
  const { infoSide } = layout;

  const info = document.createElement('div');
  const isBelow = infoSide === 'below' || infoSide === 'below-split';
  info.className = `detail-info ${isBelow ? 'landscape' : 'portrait'}${infoSide === 'below-split' ? ' below-split' : ''}`;

  if (infoSide === 'below-split') {
    // Split layout: text on left, first gallery image filling the right column
    const textCol = document.createElement('div');
    textCol.className = 'detail-info-text';
    if (itemData.title) {
      const h2 = document.createElement('h2');
      h2.textContent = itemData.title;
      textCol.appendChild(h2);
    }
    appendDetailBody(textCol, itemData);
    info.appendChild(textCol);
  } else {
    if (itemData.title) {
      const h2 = document.createElement('h2');
      h2.textContent = itemData.title;
      info.appendChild(h2);
    }
    appendDetailBody(info, itemData);
  }

  if (!isBelow) {
    // Portrait: image on one side, doc spanning the FULL width beneath it.
    // A transparent floated spacer (first child) shadows the image's footprint
    // so the text wraps beside the image, then widens to full width once it
    // clears the image's bottom — true float-wrap. The image itself stays an
    // absolutely-positioned sibling; both scroll together via .detail-scroll.
    info.style.left = '0px';
    info.style.padding = `${DETAIL_PAD_Y}px ${DETAIL_PAD_X}px`;

    const spacer = document.createElement('div');
    spacer.className = 'detail-info-float';
    if (infoSide === 'right') {
      spacer.style.float = 'left';   // image on the left (x = 0)
      spacer.style.marginLeft = `${-DETAIL_PAD_X}px`;
    } else {
      spacer.style.float = 'right';  // image on the right (x = cw - w)
      spacer.style.marginRight = `${-DETAIL_PAD_X}px`;
    }
    info.insertBefore(spacer, info.firstChild);
  }
  // Both layouts scroll image + doc as one unit via .mosaic-grid.detail-scroll.
  mosaicEl.classList.add('detail-scroll');
  positionDetailInfo(info, layout, mosaicEl.getBoundingClientRect().width);

  mosaicEl.appendChild(info);
  // Start at the top whenever a doc is (re)built (open / navigate).
  mosaicEl.scrollTop = 0;

  // In landscape scroll mode the doc scrolls up under the nav bar — turn the nav
  // into an opaque masthead (above the grid) so it masks the passing content.
  const navBar = crtScreen.querySelector('.detail-nav');
  if (navBar) navBar.classList.toggle('masthead', mosaicEl.classList.contains('detail-scroll'));

  // Fade in after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      info.classList.add('visible');
    });
  });
}

/**
 * Grows the grid from the row-fitted box to the full available box (see
 * openDetail) and re-places the open detail in it. No-op once expanded.
 */
function expandDetailBox() {
  if (mosaicEl.classList.contains('detail-box')) return;
  mosaicEl.classList.add('detail-box');
  layoutMosaic(); // releases the frame to the same box
  relayoutDetail();
}

/**
 * Re-fits the open detail view to the current container: image, doc panel,
 * fullscreen image, gallery overlay. Rects are written directly; during a
 * window resize html.is-resizing suppresses their transitions, so nothing
 * replays its open/fullscreen tween.
 */
function relayoutDetail() {
  if (!activeDetail) return;
  const { el: itemEl, data } = activeDetail;
  const layout = itemEl._detailLayout;
  if (!layout) return;
  if (!mosaicEl.classList.contains('detail-box')) {
    // Resized mid-FLIP: grow the grid now instead of when the FLIP lands.
    mosaicEl.classList.add('detail-box');
    layoutMosaic();
  }

  const containerRect = mosaicEl.getBoundingClientRect();
  // In place: openDetail's onfinish closure holds this same object.
  Object.assign(layout, computeDetailLayout(itemEl, containerRect, data, layout));
  const { targetRect } = layout;

  const info = mosaicEl.querySelector('.detail-info');
  if (info) positionDetailInfo(info, layout, containerRect.width);

  if (detailFullscreen && !activeDetail._galleryOverlay) {
    setRect(itemEl, detailFullscreenRect(targetRect.w / targetRect.h, containerRect));
    return;
  }
  setRect(itemEl, targetRect);

  if (activeDetail._galleryOverlay) {
    // Collapse the backdrop first: it is part of scrollHeight itself, so a
    // narrower window (shorter doc) would otherwise never shrink it.
    const backdrop = activeDetail._galleryBackdrop;
    backdrop.style.height = '0px';
    const { from, to } = galleryFullscreenRects(activeDetail._galleryImg);
    activeDetail._galleryFromRect = from;
    setRect(activeDetail._galleryOverlay, to);
    backdrop.style.height = `${mosaicEl.scrollHeight}px`;
  }
}

/**
 * Closes the detail view, restoring the mosaic grid with reverse FLIP.
 *
 * Reverse: animate from absolute position → grid position, then
 * remove inline styles so the item returns to normal grid flow.
 *
 * @param {boolean} instant - If true, skip animations (used on category switch)
 */
function closeDetail(instant = false) {
  if (!activeDetail) return;

  const { el: itemEl, viewer, placeholder } = activeDetail;

  // Clean up fullscreen state if active — reset inline position back to
  // targetRect so the reverse FLIP starts from the correct position.
  if (detailFullscreen) {
    detachMediaClickHandler();
    if (activeDetail._galleryOverlay) {
      activeDetail._galleryOverlay.remove();
      activeDetail._galleryBackdrop?.remove();
      activeDetail._galleryOverlay = null;
      activeDetail._galleryBackdrop = null;
      activeDetail._galleryFromRect = null;
      itemEl.style.opacity = '';
    } else {
      activeDetail._mainFsBackdrop?.remove();
      activeDetail._mainFsBackdrop = null;
      const layout = itemEl._detailLayout;
      if (layout) {
        const { targetRect } = layout;
        itemEl.style.left = `${targetRect.x}px`;
        itemEl.style.top = `${targetRect.y}px`;
        itemEl.style.width = `${targetRect.w}px`;
        itemEl.style.height = `${targetRect.h}px`;
      }
      itemEl.classList.remove('detail-transitioning');
    }
    detailFullscreen = false;
  } else {
    detachMediaClickHandler();
  }

  // Destroy splat viewer before reversing the FLIP animation.
  // Must happen first so the WebGL canvas is removed before the
  // element transitions back to grid size (avoids flash of squished canvas).
  destroySplatViewer(viewer);

  // Same timing for the video controls — the bar must not flash inside the
  // thumbnail while the item shrinks back into the grid (and destroy re-mutes).
  activeDetail.videoControls?.destroy();

  activeDetail = null;
  syncUrl();
  // Closing mid-navigateDetail: that call bails after its await (session
  // check), so undo its fade here or the tile stays at opacity 0.
  itemEl.classList.remove('detail-fading');
  isNavigating = false;

  // Remove detail info + nav bar, restore grid pointer events
  const info = mosaicEl.querySelector('.detail-info');
  if (info) info.remove();
  const nav = crtScreen.querySelector('.detail-nav');
  if (nav) nav.remove();
  // Drop scroll mode + reset position so the reverse FLIP snapshots the image at
  // its unscrolled spot, not wherever the user had scrolled to.
  mosaicEl.classList.remove('detail-mode', 'detail-scroll');
  mosaicEl.scrollTop = 0;

  // Mosaic videos paused on openDetail come back with the grid. Animated
  // close: restart them one by one as the siblings fade back in (from 150 ms,
  // below) rather than all at once at the start of the close.
  if (!instant) {
    let i = 0;
    for (const video of mosaicEl.querySelectorAll('.mosaic-item video')) {
      if (!itemEl.contains(video)) deferManagedVideo(video, 150 + 60 * i++);
    }
  }
  resumeManagedVideos();

  // Cancel any in-progress animation
  itemEl.getAnimations().forEach(a => a.cancel());

  // Clean up stored layout
  delete itemEl._detailLayout;

  if (instant) {
    placeholder?.remove();
    itemEl.classList.remove('detail-active');
    itemEl.style.left = '';
    itemEl.style.top = '';
    itemEl.style.width = '';
    itemEl.style.height = '';
    mosaicEl.querySelectorAll('.mosaic-item').forEach(el => el.classList.remove('fading-out'));
    mosaicEl.classList.remove('detail-box');
    layoutMosaic();
    return;
  }

  // ---- Reverse FLIP: absolute position → grid position ----
  // FIRST: snapshot current position. Viewport space, because the container
  // itself shrinks back to the row-fitted box below.
  const itemRect = itemEl.getBoundingClientRect();
  mosaicEl.classList.remove('detail-box');
  layoutMosaic();

  // Remove placeholder + detail-active simultaneously so the grid sees the same
  // number of items as before (placeholder gone, itemEl back in flow).
  placeholder?.remove();
  itemEl.classList.remove('detail-active');
  itemEl.style.left = '';
  itemEl.style.top = '';
  itemEl.style.width = '';
  itemEl.style.height = '';

  const allItems = mosaicEl.querySelectorAll('.mosaic-item');

  // LAST: measure grid position
  const gridRect = itemEl.getBoundingClientRect();

  // Uniform scale for reverse animation
  const s = itemRect.width / gridRect.width;
  const dx = itemRect.left - gridRect.left;
  const dy = itemRect.top - gridRect.top;

  itemEl.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], {
    duration: prefersReducedMotion() ? 0 : 400,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'none',
  });

  // Fade siblings back in with a delay so they appear as the FLIP lands,
  // not the moment it starts. 150ms delay + 300ms CSS transition = visible at ~450ms,
  // just after the 400ms FLIP completes.
  setTimeout(() => {
    allItems.forEach(el => el.classList.remove('fading-out'));
  }, 150);
}

// ============================================
// Keyboard Navigation
// ============================================

/**
 * Sets keyboard focus to a zone ('nav' or 'mosaic') at a given index.
 * Clears any previous focus first, then adds .focused to the target element.
 *
 * Like moving a selection cursor in a console game UI — only one element
 * is focused at a time across all zones.
 */
function setFocus(zone, index, { moveFocus = true } = {}) {
  clearFocus();
  focusZone = zone;

  // The .focused cursor and real DOM focus move together, so Tab continues
  // from wherever the arrows left off and screen readers announce the item.
  // preventScroll: the grid is fit to its box, nothing should scroll anyway.
  let target = null;
  if (zone === 'nav') {
    const navItems = document.querySelectorAll('#nav-menu .nav-item');
    navFocusIndex = Math.max(0, Math.min(index, navItems.length - 1));
    const el = navItems[navFocusIndex];
    el?.classList.add('focused');
    target = el;
  } else if (zone === 'mosaic') {
    const items = mosaicEl.querySelectorAll('.mosaic-item');
    mosaicFocusIndex = Math.max(0, Math.min(index, items.length - 1));
    const el = items[mosaicFocusIndex];
    el?.classList.add('focused');
    target = el?.querySelector('.mosaic-hit');
  }
  if (moveFocus && target && document.activeElement !== target) {
    target.focus({ preventScroll: true });
  }
}

/**
 * Real focus → .focused. Tab (or a screen reader) landing on a nav button or
 * a cell's overlay button moves the arrow-key cursor there too. Gated on
 * :focus-visible so a mouse click (which focuses the button in Chromium but
 * doesn't match :focus-visible) doesn't paint the keyboard cursor.
 */
// Safari < 15.4 throws on the :focus-visible selector; treat all focus as
// keyboard focus there.
function matchesFocusVisible(el) {
  try { return el.matches(':focus-visible'); } catch { return true; }
}

document.addEventListener('focusin', (e) => {
  if (!navReady) return;
  const t = e.target;
  if (!(t instanceof Element) || !matchesFocusVisible(t)) return;

  const navItem = t.closest('#nav-menu .nav-item');
  if (navItem) {
    if (navItem.classList.contains('focused')) return; // setFocus already did it
    const idx = [...document.querySelectorAll('#nav-menu .nav-item')].indexOf(navItem);
    if (idx >= 0) setFocus('nav', idx, { moveFocus: false });
    return;
  }

  const cell = t.classList.contains('mosaic-hit') ? t.closest('.mosaic-item') : null;
  if (cell) {
    if (cell.classList.contains('focused')) return;
    const idx = [...mosaicEl.querySelectorAll('.mosaic-item')].indexOf(cell);
    if (idx >= 0) setFocus('mosaic', idx, { moveFocus: false });
  }
});

/**
 * Focus leaving the nav/grid for some other control (General links, detail
 * nav buttons...) drops the .focused cursor so there's one indicator, not two.
 * relatedTarget null (window blur, element hidden/removed) keeps it, matching
 * the old behaviour where only clicks cleared it.
 */
document.addEventListener('focusout', (e) => {
  const next = e.relatedTarget;
  if (!focusZone || !(next instanceof Element)) return;
  if (next.closest('#nav-menu .nav-item') || next.classList.contains('mosaic-hit')) return;
  clearFocus();
});

/** Removes .focused from everything, resets zone tracking. */
function clearFocus() {
  document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
  focusZone = null;
  navFocusIndex = -1;
  mosaicFocusIndex = -1;
}

/**
 * Switches the mosaic to a category and opens a specific item's detail view.
 * Used by General section thumbnails to navigate directly to a piece.
 *
 * @param {string} category - Key from CATEGORIES
 * @param {number} itemIndex - Index within CATEGORIES[category]
 */
async function switchToAndOpenDetail(category, itemIndex) {
  const navMenu = document.getElementById('nav-menu');
  const navItem = [...navMenu.querySelectorAll('.nav-item')]
    .find(n => n.dataset.label === category);
  if (!navItem) return;

  await selectNavItem(navItem);
  // Another nav click may have replaced the view during the render.
  if (currentCategoryItems !== CATEGORIES[category] || activeDetail) return;

  const targetEl = mosaicEl.querySelector(`.mosaic-item[data-index="${itemIndex}"]`);
  const targetData = CATEGORIES[category]?.[itemIndex];
  if (targetEl && targetData) {
    detailOpenedByKeyboard = false; // opened from General, not from this cell
    openDetail(targetEl, targetData);
  }
}

/** Drops an open article without its fade (the next render replaces the view). */
function teardownArticle() {
  if (!activeArticle) return;
  if (activeArticle.observer) activeArticle.observer.disconnect();
  crtScreen.querySelector('.detail-nav')?.remove();
  mosaicEl.classList.remove('article-mode');
  activeArticle = null;
}

/** Toggles a nav item's .selected look and its aria-current together. */
function markNavSelected(navItem, selected) {
  navItem.classList.toggle('selected', selected);
  if (selected) navItem.setAttribute('aria-current', 'page');
  else navItem.removeAttribute('aria-current');
}

/**
 * Selects a nav item — updates .selected class and switches the mosaic.
 * Extracted so both click and keyboard nav can trigger it.
 * Returns the renderMosaic() Promise so callers can await the render.
 */
function selectNavItem(navItem) {
  const navMenu = document.getElementById('nav-menu');
  const current = navMenu.querySelector('.nav-item.selected');
  if (navItem === current) {
    // Re-clicking the current section while a piece is open acts as "back":
    // return to the section's grid/list view, same as the back button.
    if (activeDetail) closeDetail();
    else if (activeArticle) return closeArticlePage();
    return Promise.resolve();
  }

  teardownArticle();

  if (current) markNavSelected(current, false);
  markNavSelected(navItem, true);
  syncUrl();
  mosaicFocusIndex = -1; // mosaic content is changing, reset its focus

  const label = navItem.dataset.label;
  if (label === 'Games') return renderGames();
  return renderMosaic(label);
}

/** Activates (clicks) the currently focused element — Enter key handler. */
function activateFocused() {
  if (focusZone === 'nav') {
    // Nav items already auto-select on arrow, so Enter is a no-op here.
    // But keep it for consistency in case behavior changes.
    const navItems = document.querySelectorAll('#nav-menu .nav-item');
    selectNavItem(navItems[navFocusIndex]);
  } else if (focusZone === 'mosaic') {
    const items = mosaicEl.querySelectorAll('.mosaic-item');
    items[mosaicFocusIndex]?.click();
  }
}

/**
 * Handles arrow key navigation when in grid mode (no detail open).
 * First press with no focus → initializes focus on the nav's selected item.
 */
function handleArrowNav(key) {
  // No focus yet? Bootstrap into nav at the current selection, then
  // fall through so the arrow press moves immediately.
  if (!focusZone) {
    const navItems = document.querySelectorAll('#nav-menu .nav-item');
    const selectedIdx = [...navItems].findIndex(el => el.classList.contains('selected'));
    focusZone = 'nav';
    navFocusIndex = selectedIdx >= 0 ? selectedIdx : 0;
  }

  if (focusZone === 'nav') {
    const navItems = document.querySelectorAll('#nav-menu .nav-item');
    const count = navItems.length;

    if (key === 'ArrowUp') {
      setFocus('nav', Math.max(0, navFocusIndex - 1));
      selectNavItem(navItems[navFocusIndex]);
    } else if (key === 'ArrowDown') {
      setFocus('nav', Math.min(count - 1, navFocusIndex + 1));
      selectNavItem(navItems[navFocusIndex]);
    } else if (key === 'ArrowRight') {
      // Jump to mosaic — land on first item (or last focused if we had one)
      const mosaicItems = mosaicEl.querySelectorAll('.mosaic-item');
      if (mosaicItems.length > 0) {
        setFocus('mosaic', mosaicFocusIndex >= 0 ? mosaicFocusIndex : 0);
      }
    }
    // ArrowLeft from nav: no-op (nothing further left)
  }

  else if (focusZone === 'mosaic') {
    const items = mosaicEl.querySelectorAll('.mosaic-item');
    const count = items.length;

    if (key === 'ArrowRight' || key === 'ArrowDown') {
      if (mosaicFocusIndex < count - 1) {
        setFocus('mosaic', mosaicFocusIndex + 1);
      }
    } else if (key === 'ArrowUp') {
      if (mosaicFocusIndex > 0) {
        setFocus('mosaic', mosaicFocusIndex - 1);
      }
    } else if (key === 'ArrowLeft') {
      if (mosaicFocusIndex > 0) {
        setFocus('mosaic', mosaicFocusIndex - 1);
      } else {
        // At first mosaic item — jump back to nav
        const navItems = document.querySelectorAll('#nav-menu .nav-item');
        const selectedIdx = [...navItems].findIndex(el => el.classList.contains('selected'));
        setFocus('nav', selectedIdx >= 0 ? selectedIdx : 0);
      }
    }
  }
}

/**
 * Navigates to the previous/next piece while in detail view.
 * Recomputes layout for the new item's AR (landscape vs portrait may differ).
 * No FLIP animation — just an instant position swap.
 *
 * Guard: isNavigating prevents concurrent transitions from rapid arrow key
 * presses during the 250ms fade-out. Without this, multiple viewers mount
 * on the same element — leaking WebGL contexts.
 *
 * @param {number} direction - -1 for previous, +1 for next
 */
let isNavigating = false;

async function navigateDetail(direction) {
  if (!activeDetail || isNavigating) return;
  isNavigating = true;

  // Exclude placeholder from index calculation — it's a synthetic element
  const mosaicItems = [...mosaicEl.querySelectorAll('.mosaic-item:not(.mosaic-placeholder)')];
  const currentIdx = mosaicItems.indexOf(activeDetail.el);
  const nextIdx = currentIdx + direction;

  // Bounds check
  if (currentIdx < 0 || nextIdx < 0 || nextIdx >= mosaicItems.length) { isNavigating = false; return; }

  const nextEl = mosaicItems[nextIdx];
  // data-index, not DOM position: items with missing thumbnails are skipped in the DOM.
  const nextData = currentCategoryItems[Number(nextEl?.dataset.index)];
  if (!nextEl || !nextData) { isNavigating = false; return; }

  // closeDetail() can run during the fade-out await (Escape/back/nav click).
  const startSession = activeDetail.sessionId;

  try {
    // Reset fullscreen before navigating — restore targetRect so we
    // cleanly hand off from the correct position.
    if (detailFullscreen) {
      detachMediaClickHandler();
      if (activeDetail._galleryOverlay) {
        activeDetail._galleryOverlay.remove();
        activeDetail._galleryBackdrop?.remove();
        activeDetail._galleryOverlay = null;
        activeDetail._galleryBackdrop = null;
        activeDetail._galleryFromRect = null;
        activeDetail.el.style.opacity = '';
      } else {
        activeDetail._mainFsBackdrop?.remove();
        activeDetail._mainFsBackdrop = null;
        const layout = activeDetail.el._detailLayout;
        if (layout) {
          const { targetRect } = layout;
          activeDetail.el.style.left = `${targetRect.x}px`;
          activeDetail.el.style.top = `${targetRect.y}px`;
          activeDetail.el.style.width = `${targetRect.w}px`;
          activeDetail.el.style.height = `${targetRect.h}px`;
        }
        activeDetail.el.classList.remove('detail-transitioning');
      }
      detailFullscreen = false;
    } else {
      detachMediaClickHandler();
    }

    // Destroy current splat viewer before fading out
    destroySplatViewer(activeDetail.viewer);
    activeDetail.viewer = null;
    activeDetail.videoControls?.destroy();
    activeDetail.videoControls = null;

    // Fade out current image + info, then swap to new item
    const { el: currentEl } = activeDetail;
    currentEl.classList.add('detail-fading');

    const info = mosaicEl.querySelector('.detail-info');
    if (info) info.classList.remove('visible');

    // Wait for the fade-out to finish before swapping
    const FADE_MS = 250;
    await new Promise(r => setTimeout(r, FADE_MS));
    if (activeDetail?.sessionId !== startSession) return;

    // Clean up current item — add fading-out BEFORE removing detail-active so
    // it returns to grid flow at opacity:0, never flashing its grid position.
    activeDetail.placeholder?.remove();
    currentEl.getAnimations().forEach(a => a.cancel());
    currentEl.classList.add('fading-out');
    currentEl.classList.remove('detail-active', 'detail-fading');
    currentEl.style.left = '';
    currentEl.style.top = '';
    currentEl.style.width = '';
    currentEl.style.height = '';
    delete currentEl._detailLayout;

    // Remove old detail info
    if (info) info.remove();

    // Compute layout for the new item before touching its classes. Navigating
    // before the open FLIP landed: grow to the full box first (see openDetail).
    // The old item has no layout anymore, so the relayout inside is a no-op.
    expandDetailBox();
    const containerRect = mosaicEl.getBoundingClientRect();
    const layout = computeDetailLayout(nextEl, containerRect, nextData);

    // Pull nextEl out of grid flow while still invisible (detail-fading = opacity:0),
    // THEN remove fading-out — it never appears at its grid position.
    nextEl.classList.add('detail-active', 'detail-fading');
    setRect(nextEl, layout.targetRect);
    nextEl._detailLayout = layout;
    // Now safe — nextEl is already absolutely positioned and invisible via detail-fading
    nextEl.classList.remove('fading-out');

    // Hand video playback over: everything outside the incoming item stays
    // paused (it's behind the detail view), the incoming item's video runs.
    pauseManagedVideos(v => !nextEl.contains(v));
    resumeManagedVideos(v => nextEl.contains(v));

    const sessionId = ++detailSessionId;
    activeDetail = { el: nextEl, data: nextData, viewer: null, videoControls: null, sessionId, placeholder: null };
    syncUrl();
    mosaicFocusIndex = nextIdx;

    // Fade in after a frame (let browser paint the positioned element first)
    requestAnimationFrame(() => {
      nextEl.classList.remove('detail-fading');
    });

    // Build new detail info with computed layout (it has its own fade-in)
    buildDetailInfo(nextData, layout);
    // Attach click-to-fullscreen for the new item
    attachMediaClickHandler(nextEl);
    activeDetail.videoControls = mountDetailVideoControls(nextEl, nextData);

    // Mount splat viewer for the next item if it's a splat
    if (nextData.type === 'splat' && nextData.splat?.file) {
      mountSplatViewer(nextEl, nextData).then((viewer) => {
        if (activeDetail?.sessionId === sessionId) {
          activeDetail.viewer = viewer;
        } else {
          destroySplatViewer(viewer);
        }
      });
    }

    // Update prev/next disabled states for new position
    updateDetailNavButtons();
  } finally {
    // closeDetail already reset the flag if this detail was closed mid-await;
    // a newer navigation in a reopened detail may own it now.
    if (!activeDetail || activeDetail.sessionId === startSession) isNavigating = false;
  }
}

/**
 * Closes the detail view from the keyboard and hands focus back to the cell
 * that was open (its overlay button is display:none while open, so focus would
 * otherwise drop to <body>). Escape keeps the old rule: restore only when the
 * keyboard was in play (opened via Enter/Space, or arrow-navigated, which sets
 * mosaicFocusIndex). `force` is for the back button, whose own focus is about
 * to be destroyed.
 */
function closeDetailFromKeyboard(force = false) {
  if (!activeDetail) return;
  const openEl = activeDetail.el;
  const restore = force || detailOpenedByKeyboard || mosaicFocusIndex >= 0;
  closeDetail();
  detailOpenedByKeyboard = false;
  if (!restore) return;
  // Placeholder is already gone (closeDetail removes it synchronously), so
  // this index matches what setFocus walks.
  const idx = [...mosaicEl.querySelectorAll('.mosaic-item')].indexOf(openEl);
  if (idx >= 0) setFocus('mosaic', idx);
}

// ---- Master keydown handler ----
document.addEventListener('keydown', (e) => {
  // Ignore when nav isn't ready yet (intro still playing)
  if (!navReady) return;

  const key = e.key;

  // --- Article page mode ---
  if (activeArticle) {
    if (key === 'Escape') closeArticlePage();
    return;
  }

  // --- Detail view mode ---
  if (activeDetail) {
    // A focused seek bar owns the arrow keys (scrubbing) — don't navigate.
    // Escape still falls through so it keeps closing fullscreen/detail.
    if (key !== 'Escape' && e.target.closest?.('.video-controls')) return;
    if (key === 'Escape') {
      if (detailFullscreen) {
        exitDetailFullscreen();
      } else {
        closeDetailFromKeyboard();
      }
      return;
    }
    // Block arrow navigation while in fullscreen (arrows are hidden too)
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      if (!detailFullscreen) navigateDetail(key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    return; // swallow other keys in detail mode
  }

  // --- Grid mode ---
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    e.preventDefault();
    handleArrowNav(key);
    return;
  }

  // Enter/Space on a nav or cell button: let the native button activation
  // fire its click handler. Handling it here too would run the action twice
  // (or, with preventDefault, suppress the native click and diverge from it).
  if ((key === 'Enter' || key === ' ') && e.target.closest?.('#nav-menu .nav-item, .mosaic-hit')) {
    return;
  }

  // Fallback when the .focused cursor exists but real focus is elsewhere.
  if (key === 'Enter' && focusZone) {
    e.preventDefault();
    activateFocused();
    return;
  }
});

/**
 * Unhides the mosaic container and creates the static outline frame.
 * Call this while the nav menu is still being typed to start the frame
 * sweep early. Creates the frame element and triggers the CSS animation.
 */
function showMosaicFrame() {
  if (crtScreen.querySelector('.mosaic-frame')) return;
  const frame = document.createElement('div');
  frame.className = 'mosaic-frame crt-effects';

  const handle = document.createElement('div');
  handle.className = 'mosaic-handle';
  frame.appendChild(handle);

  crtScreen.appendChild(frame);

  if (!fullMotion()) {
    // Add visible before first paint — browser skips the transition entirely
    frame.classList.add('visible');
  } else {
    // Double rAF ensures initial clipped/transparent state is painted first,
    // so the transition fires from the start state rather than snapping
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        frame.classList.add('visible');
      });
    });
  }
}

/**
 * Call this once after the nav menu finishes typing.
 * The frame is already animating — this just reveals the mosaic content.
 */
function showMosaic() {
  mosaicEl.hidden = false;
  // If renderMosaic() ran while the grid was still [hidden] (display: none),
  // there were no layout boxes to measure — row count came back 0 and the fit
  // was skipped. Now that it's laid out, redo it.
  if (isThumbnailMosaic() && mosaicRows <= 0) {
    mosaicRows = measureMosaicRows();
    layoutMosaic();
  }
}

// ============================================
// URL Parameters
// ============================================

/**
 * window.location = current page URL info (like Application.absoluteURL in Unity)
 * URLSearchParams = parses query string (?key=value&other=123)
 *
 * Example: site.com/?name=John
 * - window.location.search = "?name=John"
 * - params.get('name') = "John"
 */
const params = new URLSearchParams(window.location.search);
const rawName = params.get('name');
const username = rawName
  ? rawName.trim().slice(0, 20)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  : null;

// ============================================
// Initialize & Run
// ============================================

const terminalElement = document.getElementById('terminal');
// Created in main() (intro) or bootDirect() (direct link).
let terminal = null;

// Build name for sequence (defaults to "Neo")
const wakeUpText = username ? `Wake up, ${username}...` : 'Wake up...';

// The Matrix opening terminal sequence
const introSequence = [
  { text: wakeUpText, submit: true },
  { text: 'Follow the white rabbit.', submit: false },
];

// Track rabbit instance for cleanup
let rabbit = null;

// Guard against double-click triggering multiple transitions
let transitionInProgress = false;

// ============================================
// Nav menu + URL routes (shared by the intro and direct links)
// ============================================

// Creation order. Each item is prepended, so the menu reads top to bottom
// General, Games, 3D Art, 3D Tech; the intro types them bottom-up.
const NAV_ORDER = ['3D Tech', '3D Art', 'Games', 'General'];

function revealNavMenu() {
  const navMenu = document.getElementById('nav-menu');
  navMenu.hidden = false;
  navMenu.setAttribute('aria-label', 'Sections');
  return navMenu;
}

/**
 * One empty nav button: <span class="nav-prompt"/><span class="nav-label"/>.
 * Real <button> so Tab reaches it and Enter/Space activate it. The aria-label
 * gives a stable name while the visible "> Label" is still being typed (and
 * keeps the decorative prompt/cursor out of it).
 */
function createNavItem(label) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'nav-item';
  item.dataset.label = label;
  item.setAttribute('aria-label', label);

  const promptSpan = document.createElement('span');
  promptSpan.className = 'nav-prompt';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'nav-label';
  item.append(promptSpan, labelSpan);
  return { item, promptSpan, labelSpan };
}

const navItemFor = (label) =>
  [...document.querySelectorAll('#nav-menu .nav-item')].find((n) => n.dataset.label === label);

/** Nav clicks, keyboard navigation and URL syncing go live (end of either boot). */
function enableNav(navMenu) {
  navMenu.addEventListener('click', (e) => {
    const clicked = e.target.closest('.nav-item');
    if (!clicked) return;

    // Mouse click resets the keyboard cursor. Enter/Space on the focused
    // button also arrives here as a click (detail === 0) — keep the cursor
    // on it then, since real focus stays put.
    if (e.detail !== 0) clearFocus();
    selectNavItem(clicked);
  });

  // Keyboard navigation is now active
  navReady = true;
  urlSync = createUrlSync({ currentRoute, applyRoute });
}

// Set once the nav is live; until then (intro playing) there's no route.
let urlSync = null;
function syncUrl() { urlSync?.(); }

/** What's on screen, as a route. See src/utils/route.js. */
function currentRoute() {
  const selected = document.querySelector('#nav-menu .nav-item.selected');
  if (!navReady || !selected) return null;
  const section = selected.dataset.label;
  const id = (activeDetail?.data ?? activeArticle?.data)?.id ?? null;
  // Mid-switch the old section's detail can still be open; it isn't part of
  // the new section's route.
  return { section, id: findItemIndex(section, id) >= 0 ? id : null };
}

/** Makes the screen match `route` (Back/Forward or an edited hash). */
async function applyRoute(route) {
  if (!navReady) return;
  const target = route ?? { section: 'General', id: null };
  const cur = currentRoute();
  if (cur && cur.section === target.section && cur.id === target.id) return;

  const navItem = navItemFor(target.section);
  if (!navItem) return;
  const sameSection = cur?.section === target.section;

  // ── Section only: close whatever is open, or switch section ──
  if (!target.id) {
    if (sameSection && activeArticle) return closeArticlePage();
    if (sameSection && activeDetail) return closeDetail();
    return selectNavItem(navItem);
  }

  const idx = findItemIndex(target.section, target.id);

  // ── A game: its full-page article ──
  if (target.section === 'Games') {
    if (activeDetail) closeDetail(true);
    teardownArticle();
    if (!sameSection) {
      const current = document.querySelector('#nav-menu .nav-item.selected');
      if (current) markNavSelected(current, false);
      markNavSelected(navItem, true);
    }
    return openArticlePage(GAMES[idx], 'Games');
  }

  // ── A grid piece: its detail view ──
  if (!sameSection) return switchToAndOpenDetail(target.section, idx);
  if (activeDetail) closeDetail(true);
  const cell = mosaicEl.querySelector(`.mosaic-item[data-index="${idx}"]`);
  if (cell) {
    detailOpenedByKeyboard = false;
    openDetail(cell, CATEGORIES[target.section][idx]);
  }
}

/**
 * Direct link (`/#3d-art/ardo`): build the screen the intro ends on, instantly,
 * then open the linked section/piece. No rabbit, no typing. Uses the same nav
 * builders and renderers as the intro, so the two paths can't drift apart.
 */
async function bootDirect(route) {
  terminal = new Terminal(terminalElement);
  startGlowNoise();
  terminal.addChar("Hi! I'm Tomás,");
  terminal.submitLine();
  terminal.addChar('Technical Artist');
  terminal.hideCursor();

  const navMenu = revealNavMenu();
  for (const label of NAV_ORDER) {
    const { item, promptSpan, labelSpan } = createNavItem(label);
    promptSpan.textContent = '> ';
    labelSpan.textContent = label;
    markNavSelected(item, label === route.section);
    navMenu.prepend(item);
  }

  showMosaicFrame();
  showMosaic();

  const idx = findItemIndex(route.section, route.id);
  if (route.section === 'Games' && idx >= 0) {
    // Straight to the article; rendering the games list first would only
    // flash it before the crossfade.
    await openArticlePage(GAMES[idx], 'Games');
  } else if (route.section === 'Games') {
    await renderGames();
  } else {
    await renderMosaic(route.section);
    const cell = idx >= 0 && mosaicEl.querySelector(`.mosaic-item[data-index="${idx}"]`);
    if (cell) openDetail(cell, CATEGORIES[route.section][idx]);
  }

  // After the opening view is up, so its state is the baseline URL sync
  // compares against (the link's own entry is replaced, never pushed).
  enableNav(navMenu);
  // Warm the other sections only now: started earlier, the staggered fetches
  // compete with the linked view's own images (the intro had ~10 s of idle
  // network for this; a direct link has none).
  preloadThumbnails();
}

/**
 * Transition: rabbit click → freeze → particle dissolve → white terminal → typing
 *
 * The rabbit shatters into white particles that converge into a cursor block,
 * then the DOM cursor is revealed and starts typing the introduction.
 */
async function startRabbitTransition() {
  if (transitionInProgress) return;
  transitionInProgress = true;

  try {
    // 1. Freeze rabbit — stop all animations, get position
    const rabbitRect = rabbit.freeze();

    // 2. Destroy old terminal text instantly
    terminal.destroy();

    // 3. Hide the rabbit DOM element (particles will represent it)
    rabbit.element.style.visibility = 'hidden';

    // 4. Set up the new terminal (same green as the first)
    const whiteTerminal = new Terminal(terminalElement);

    // 5. Measure cursor rect while it exists in layout, then hide it.
    //    The cursor flashes for 1 frame but the particle canvas covers it.
    const cursorTargetRect = whiteTerminal.getCursorRect();
    whiteTerminal.hideCursor();

    // 6. Start particle morph: rabbit sprite → cursor block
    const particleConfig = getParticleConfig();

    if (particleConfig) {
      const spriteImage = await preloadImage(rabbitSpritesheetUrl);
      const morph = new ParticleMorph({ ...particleConfig, particleScale: 1.5, particleSkip: 2 });

      const cleanupMorphSkip = enableSkipMorphOnClick(morph);
      await morph.start({
        source: {
          rect: rabbitRect,
          image: spriteImage,
          // The pose on screen at click time (may be mid-jump), not idle
          frame: rabbitRect.frame,
          flipped: rabbitRect.flipped,
        },
        target: { rect: cursorTargetRect },
        container: crtScreen,
        color: PARTICLE_CONFIG.color,
      });
      cleanupMorphSkip();

      // 7. Destroy the rabbit DOM element
      rabbit.destroy();
      rabbit = null;

      // 8. Show cursor (locked, no blink) under the canvas
      whiteTerminal.showCursor(true);

      // 9. Handoff: fade canvas, reveal DOM cursor
      await morph.handoff();
      morph.destroy();
    } else {
      // Low tier: skip particles, instant swap
      rabbit.destroy();
      rabbit = null;
      whiteTerminal.showCursor(true);
    }

    // 10. Start cursor blinking
    whiteTerminal.showCursor(false);
    await sleep(TIMING.normal);

    // 11. Type the introduction + nav menu (click to skip)
    let cleanupSkip = enableSkipOnClick();
    await whiteTerminal.type("Hi! I'm Tomás,");
    whiteTerminal.submitLine();
    await sleep(TIMING.normal);
    await whiteTerminal.type("Technical Artist");

    // 12. Reveal nav menu (already in DOM, just hidden)
    await sleep(TIMING.normal);
    whiteTerminal.hideCursor();

    const navMenu = revealNavMenu();
    await sleep(200);

    let prevItem = null;

    for (const label of NAV_ORDER) {
      // Deselect previous item
      if (prevItem) markNavSelected(prevItem, false);

      await sleep(100);

      const { item, promptSpan, labelSpan } = createNavItem(label);
      markNavSelected(item, true);  // selected while typing
      navMenu.prepend(item);  // prepend so each new item appears above the previous

      // Type "> Label" char by char with cursor
      const fullText = `> ${label}`;
      const cursorChar = document.createElement('span');
      cursorChar.className = 'cursor';
      cursorChar.textContent = '█';
      item.appendChild(cursorChar);

      // Start frame sweep as the last nav item begins typing
      if (label === NAV_ORDER[NAV_ORDER.length - 1]) showMosaicFrame();

      // First 2 chars ("> ") go into promptSpan, rest into labelSpan
      for (let i = 0; i < fullText.length; i++) {
        const target = i < 2 ? promptSpan : labelSpan;
        target.appendChild(document.createTextNode(fullText[i]));
        await sleep(getRandomDelay(config.baseSpeed * 0.5, config.variance));
      }

      // Remove typing cursor after item is done
      cursorChar.remove();
      await sleep(getRandomDelay(config.linePause*0.5, config.variance));

      prevItem = item;
    }

    await sleep(200);

    // Done typing — clean up skip listener
    cleanupSkip();
    skipTyping = false;

    // General was typed last and is already selected — no need to move selection.
    // Show mosaic with the initially selected category
    const initialCategory = prevItem.dataset.label;
    showMosaic();
    await renderMosaic(initialCategory);

    enableNav(navMenu);

  } catch (error) {
    console.error('Rabbit transition failed:', error);
    // Clean up partial state and show user-facing fallback
    if (rabbit) { rabbit.destroy(); rabbit = null; }
    terminalElement.innerHTML = `
      <div style="color: #fff; padding: 2rem; font-family: monospace;">
        > Something went wrong. <a href="." style="color: inherit">Reload?</a>
      </div>
    `;
  }
}

// Run sequence, then spawn rabbit
async function main() {
  terminal = new Terminal(terminalElement);
  // Subtle random dips in glow intensity (skipped under reduced motion).
  startGlowNoise();
  try {
    // Preload rabbit spritesheet before starting
    const spritesheet = await preloadImage(rabbitSpritesheetUrl);

    // Pre-warm sprite cell cache off the main thread — fire and forget.
    // The worker samples all morph frames during the intro typing sequence,
    // so the first morph hits the cache instead of paying the ~20ms GPU readback cost.
    const prewarmConfig = getParticleConfig();
    if (prewarmConfig) {
      try {
        // Every frame, not just the named ones: a click mid-jump morphs from
        // whichever frame is showing.
        const allFrames = Array.from({ length: RABBIT_CONFIG.frameCount }, (_, i) => -i * RABBIT_CONFIG.width);
        prewarmSampleCache(spritesheet, allFrames, prewarmConfig);
      } catch (e) {
        console.warn('[ParticleMorph] Cache prewarm failed (will sample on first morph):', e);
      }
    }

    // Kick off silent thumbnail preloading — fire and forget.
    // The intro sequence gives us 10+ seconds of idle network time,
    // so thumbnails will likely be cached before the user ever sees the gallery.
    preloadThumbnails();

    // Allow click to skip intro typing
    let cleanupSkip = enableSkipOnClick();
    await terminal.run(introSequence);
    cleanupSkip();
    skipTyping = false;  // reset for next typing phase

    terminal.hideCursor();
    await sleep(500);
    terminal.showCursor(true);

    // Get cursor position and hide cursor
    const cursorPos = terminal.getCursorPosition();
    const cursorRect = terminal.getCursorRect();

    await terminal.rampCursorBrightness(2500, 8);

    const particleConfig = getParticleConfig();

    if (!particleConfig) {
      // Low tier: skip particles, direct spawn + drop
      rabbit = new Rabbit();
      rabbit.spawnAndDrop(cursorPos.x, cursorPos.y, crtScreen);
      terminal.hideCursor();
    } else {
      // Mid/High tier: particle morph — cursor shatters into particles that
      // reassemble into the rabbit shape, then hand off to DOM element
      const spriteImage = await preloadImage(rabbitSpritesheetUrl);

      const morph = new ParticleMorph(particleConfig);
      const targetRect = {
        x: cursorPos.x,
        y: cursorPos.y,
        w: RABBIT_CONFIG.width,
        h: RABBIT_CONFIG.height,
      };

      terminal.delayedHideCursor(100)

      // Particles animate: scatter → drift → converge → settle (click to skip)
      const cleanupMorphSkip = enableSkipMorphOnClick(morph);
      await morph.start({
        source: { rect: cursorRect },
        target: { rect: targetRect, image: spriteImage, frame: RABBIT_CONFIG.frames.spawnStart, flipped: true },
        container: crtScreen,
      });
      cleanupMorphSkip();

      // Place the real DOM rabbit underneath the canvas (hidden)
      rabbit = new Rabbit();
      rabbit.spawnSilent(cursorPos.x, cursorPos.y, crtScreen);

      // Fade canvas out, revealing DOM rabbit underneath
      await morph.handoff();
      morph.destroy();

      // Now drop the rabbit to the bottom
      rabbit.startDrop();
    }

    // Set up rabbit click → white terminal transition
    rabbit.enableMouseReaction(undefined, {
      onClick: () => startRabbitTransition(),
    });

  } catch (error) {
    console.error('Failed to initialize terminal:', error);
    // Fallback: show error message to user
    const terminalEl = document.getElementById('terminal');
    if (terminalEl) {
      terminalEl.innerHTML = `
        <div style="color: var(--terminal-green, #8fff8f); padding: 2rem; font-family: monospace;">
          > System error. Please refresh the page.
        </div>
      `;
    }
  }
}

// `?p=` portfolio decks never reach this module (main.js routes them).
// A section/project link (`/#games`, `/#3d-art/ardo`) skips the intro.
const initialRoute = parseRoute();
if (initialRoute) {
  bootDirect(initialRoute).catch((err) => {
    console.error('Direct link boot failed:', err);
    window.location.replace(window.location.pathname + window.location.search);
  });
} else {
  main();
}
