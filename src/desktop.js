/**
 * Terminal System
 *
 * A modular terminal emulator that can:
 * - Type text with natural randomness
 * - Handle multiple lines
 * - Submit lines (like pressing Enter)
 * - Queue and execute commands sequentially
 */

import { Rabbit } from './components/Rabbit.js';
import { ParticleMorph, prewarmSampleCache } from './components/ParticleMorph.js';
import { TYPING_CONFIG, RABBIT_CONFIG, TIMING, MOSAIC_CONFIG, injectCSSVariables } from './config/animations.js';
import { injectCRTVariables, startGlowNoise } from './config/crt.js';
import { PARTICLE_CONFIG } from './config/particles.js';
import { deviceTier } from './config/device.js';
import { CATEGORIES, GAMES, GENERAL_CONTENT, resolveThumbnail, resolveSplat, variantsFor } from './config/content.js';
import { ICONS as CONTACT_ICONS } from './config/icons.js';
import { createMediaElement, createSpritesheetElement } from './utils/media.js';
import { parseMarkdown, applyInline } from './utils/markdown.js';
import { attachVideoControls } from './components/VideoControls.js';
import { createCrtScrollbar } from './components/CrtScrollbar.js';

/**
 * Returns particle config with device-tier overrides merged in,
 * or null if particles are disabled for this tier.
 */
function getParticleConfig() {
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

// Start glow noise — subtle random dips in glow intensity
startGlowNoise();

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
  if (skipTyping) return Promise.resolve();
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
  const allItems = Object.values(CATEGORIES).flat();
  if (allItems.length === 0) return;

  const startPreload = () => {
    allItems.forEach((item, i) => {
      // Stagger each fetch by 200ms to avoid a bandwidth stampede
      setTimeout(() => {
        // Pick the preferred variant URL so preload matches what the browser
        // will actually render. variantsFor lists modern formats first
        // (avif, webm) with the original as fallback — the browser should
        // pick source[0] if supported, and that's ~universal on modern devices.
        const variants = variantsFor(item.src);
        if (!variants) return;
        const url = variants.kind === 'image'
          ? (variants.sources[0]?.url || variants.fallback.url)
          : variants.sources[0]?.url;
        if (!url) return;

        if (variants.kind === 'video') {
          // For video: a low-priority fetch pulls it into browser's HTTP cache.
          fetch(url, { priority: 'low' }).catch(() => {});
        } else {
          // For images: creating an Image() triggers a standard fetch.
          // Once loaded, the browser serves it from cache on next request.
          const img = new Image();
          img.src = url;
        }
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

  // Leaving any scrolling view — the thumbnail grid / General don't use it.
  unmountScrollbar();

  // Close any open detail before switching categories
  if (activeDetail) closeDetail(true);

  // Store items array for keyboard detail navigation
  currentCategoryItems = items;

  // If mosaic already has content, fade out first.
  // Listen to transitionend so we don't need to hardcode a duration that
  // must stay in sync with the CSS value. Fallback timeout prevents hanging
  // if the element is hidden/display:none and the transition never fires.
  if (mosaicHasContent) {
    mosaicEl.classList.remove('visible');
    await new Promise(r => {
      const fallback = setTimeout(r, MOSAIC_CONFIG.fadeDuration + 50);
      mosaicEl.addEventListener('transitionend', () => { clearTimeout(fallback); r(); }, { once: true });
    });
  }

  // Clear and rebuild
  mosaicEl.innerHTML = '';

  // General section renders text content instead of a thumbnail grid.
  // We reuse the same container but swap the layout mode via a CSS class.
  const isGeneral = category === 'General';
  mosaicEl.classList.remove('games-mode');
  mosaicEl.classList.toggle('general-mode', isGeneral);

  if (isGeneral) {
    renderGeneralContent();
  } else {
    const willReveal = deviceTier !== 'low';
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'mosaic-item' + (willReveal ? ' reveal' : '');
      div.dataset.cols = item.cols;
      div.dataset.rows = item.rows;

      const media = createMediaElement(item.src, { alt: item.alt });
      if (!media) continue; // skip items with unresolved thumbnails

      div.appendChild(media);
      mosaicEl.appendChild(div);

      // Click → open the FLIP detail view. Mosaic items render their `page`
      // markdown inside the detail panel (buildDetailInfo), so they must NOT
      // route to openArticlePage — that's the Games full-page article view
      // (banner + crossfade), which skips the thumbnail FLIP entirely.
      div.addEventListener('click', () => {
        if (activeDetail) return;
        clearFocus();
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

  // Fade in after a brief frame delay (lets browser paint the new items)
  await new Promise(r => setTimeout(r, MOSAIC_CONFIG.renderDelay));
  mosaicEl.classList.add('visible');

  // Per-item diagonal reveal — thumbs cascade in top-left → bottom-right.
  // Items were born with .reveal (opacity 0 + offset); this computes their
  // positional delays and triggers the transition to .revealed. Skipped for
  // General (has its own stagger-reveal) and low tier (perf).
  if (!isGeneral && deviceTier !== 'low') {
    applyDiagonalReveal(mosaicEl);
  }

  // Trigger staggered reveal for General section on mid/high tier.
  // Each element cascades in 210ms after the previous, starting as the
  // parent fade begins — the multiplied opacities create a natural reveal.
  staggerTimeouts.forEach(clearTimeout);
  staggerTimeouts = [];
  if (isGeneral && deviceTier !== 'low') {
    const targets = [...mosaicEl.querySelectorAll('.stagger-reveal')];
    staggerTimeouts = targets.map((el, i) =>
      setTimeout(() => el.classList.add('visible'), i * 200)
    );
  }
}

async function renderGames() {
  if (activeDetail) closeDetail(true);
  currentCategoryItems = [];

  if (mosaicHasContent) {
    mosaicEl.classList.remove('visible');
    await new Promise(r => {
      const fallback = setTimeout(r, MOSAIC_CONFIG.fadeDuration + 50);
      mosaicEl.addEventListener('transitionend', () => { clearTimeout(fallback); r(); }, { once: true });
    });
  }

  mosaicEl.innerHTML = '';
  mosaicEl.classList.remove('general-mode');
  mosaicEl.classList.add('games-mode');

  for (const game of GAMES) {
    const card = document.createElement('div');
    card.className = 'game-card';

    if (game.type === 'spritesheet') {
      const banner = createSpritesheetElement(game.spritesheet, { className: 'game-banner', alt: game.title });
      if (banner) card.appendChild(banner);
    } else if (game.src) {
      const banner = createMediaElement(game.src, { alt: game.title, className: 'game-banner' });
      if (banner) card.appendChild(banner);
    }

    const info = document.createElement('div');
    info.className = 'game-info';

    const h2 = document.createElement('h2');
    h2.textContent = game.title;
    info.appendChild(h2);

    const cardText = game.summary || game.description;
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
  if (activeDetail) closeDetail(true);

  activeArticle = { data: itemData, returnTo, observer: null };
  currentCategoryItems = [];

  if (mosaicHasContent) {
    mosaicEl.classList.remove('visible');
    await new Promise(r => {
      const fallback = setTimeout(r, MOSAIC_CONFIG.fadeDuration + 50);
      mosaicEl.addEventListener('transitionend', () => { clearTimeout(fallback); r(); }, { once: true });
    });
  }

  mosaicEl.innerHTML = '';
  mosaicEl.classList.remove('general-mode', 'games-mode');
  mosaicEl.classList.add('article-mode');
  mosaicEl.scrollTop = 0;

  buildArticleNav();

  const article = buildArticleContent(itemData);
  mosaicEl.appendChild(article);

  // Scroll-triggered reveal for content blocks
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { root: mosaicEl, threshold: 0.1 });

  article.querySelectorAll('.article-reveal').forEach(el => observer.observe(el));
  activeArticle.observer = observer;

  mosaicHasContent = true;
  await new Promise(r => setTimeout(r, MOSAIC_CONFIG.renderDelay));
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

  if (itemData.type === 'spritesheet' || itemData.src) {
    const bannerMedia = itemData.type === 'spritesheet'
      ? createSpritesheetElement(itemData.spritesheet, { className: 'article-banner', alt: itemData.title || '', responsive: true })
      : createMediaElement(itemData.src, {
        alt: itemData.title || '',
        className: 'article-banner',
        lazy: false,
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
    const fragment = parseMarkdown(itemData.page, { createMediaElement, iconMap: CONTACT_ICONS });
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
  mosaicEl.classList.remove('visible');
  await new Promise(r => {
    const fallback = setTimeout(r, MOSAIC_CONFIG.fadeDuration + 50);
    mosaicEl.addEventListener('transitionend', () => { clearTimeout(fallback); r(); }, { once: true });
  });

  mosaicEl.innerHTML = '';
  mosaicEl.classList.remove('article-mode');
  activeArticle = null;

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

        const media = createMediaElement(item.src, { alt: item.alt ?? '' });
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
          navigator.clipboard.writeText(c.copyText).catch(() => {});
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

  // Stagger reveal on mid/high tier — mark each top-level block.
  // JS triggers .visible on each sequentially after the mosaic fades in.
  if (deviceTier !== 'low') {
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
// Height reserved for the detail nav bar (back + prev/next arrows).
// 20px offset matches the CSS top: calc(5% + 20px) on .detail-nav.
const NAV_BAR_HEIGHT = 70;

function computeDetailLayout(itemEl, containerRect, itemData = {}) {
  const ar = getMediaAspectRatio(itemEl);
  const cw = containerRect.width;
  const ch = containerRect.height - NAV_BAR_HEIGHT; // available height below nav bar

  let x, y, w, h, infoSide;
  y = NAV_BAR_HEIGHT;

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
    const thumbRect = itemEl.getBoundingClientRect();
    const thumbCenterX = thumbRect.left + thumbRect.width / 2;
    const containerCenterX = containerRect.left + cw / 2;

    if (thumbCenterX <= containerCenterX) {
      // Thumbnail is on the left side → image stays left, info on right
      x = 0;
      infoSide = 'right';
    } else {
      // Thumbnail is on the right side → image on right, info on left
      x = cw - w;
      infoSide = 'left';
    }
  }

  return { targetRect: { x, y, w, h }, infoSide };
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

/**
 * Expands the detail image to fill the container (AR-preserved).
 * Fades out the info panel and hides the prev/next arrows.
 */
function enterDetailFullscreen() {
  if (!activeDetail || detailFullscreen) return;
  const { el: itemEl } = activeDetail;
  const layout = itemEl._detailLayout;
  if (!layout) return;

  const containerRect = mosaicEl.getBoundingClientRect();
  const { targetRect } = layout;
  const ar = targetRect.w / targetRect.h;
  // Reserve space for the back button nav bar — measure its actual bottom
  // relative to the mosaic top so the image never slides under it.
  const nav = crtScreen.querySelector('.detail-nav');
  const topMargin = nav
    ? Math.max(0, nav.getBoundingClientRect().bottom - containerRect.top) + 8
    : 0;
  const fsRect = computeFullscreenRect(ar, containerRect, topMargin);

  // Reset any scroll so the image expands from its unscrolled position (the
  // info is about to fade out, so the page collapses to a single screen anyway).
  mosaicEl.scrollTop = 0;

  itemEl.classList.add('detail-transitioning');
  void itemEl.offsetWidth; // force reflow so browser commits "from" state before animating
  itemEl.style.left = `${fsRect.x}px`;
  itemEl.style.top = `${fsRect.y}px`;
  itemEl.style.width = `${fsRect.w}px`;
  itemEl.style.height = `${fsRect.h}px`;

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
function enterGalleryImageFullscreen(imgEl) {
  if (!activeDetail || detailFullscreen) return;

  const containerRect = mosaicEl.getBoundingClientRect();
  const imgRect = imgEl.getBoundingClientRect();

  // mosaicEl (.detail-scroll) is the scroll container in BOTH portrait and
  // landscape. getBoundingClientRect is viewport-relative, but the overlay +
  // backdrop are absolutely positioned inside the SCROLLED content — so convert
  // to content space by adding the scroll offset. (The gallery side-image never
  // exposed this: it always sits at scroll 0.)
  const scrollLeft = mosaicEl.scrollLeft;
  const scrollTop = mosaicEl.scrollTop;

  const fromX = imgRect.left - containerRect.left + scrollLeft;
  const fromY = imgRect.top - containerRect.top + scrollTop;
  const fromW = imgRect.width;
  const fromH = imgRect.height;

  const ar = fromW / fromH;
  const nav = crtScreen.querySelector('.detail-nav');
  const topMargin = nav
    ? Math.max(0, nav.getBoundingClientRect().bottom - containerRect.top) + 8
    : 0;
  const toRect = computeFullscreenRect(ar, containerRect, topMargin);
  // computeFullscreenRect returns viewport-relative (visual) coords; shift into
  // content space too so the zoomed image lands centered in the CURRENT view.
  const toX = toRect.x + scrollLeft;
  const toY = toRect.y + scrollTop;

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
  overlay.style.left = `${fromX}px`;
  overlay.style.top = `${fromY}px`;
  overlay.style.width = `${fromW}px`;
  overlay.style.height = `${fromH}px`;

  const overlayImg = document.createElement('img');
  // currentSrc = the variant the browser actually picked (avif/webp) for a
  // <picture>; falls back to .src for a bare <img>. Avoids refetching the png.
  overlayImg.src = imgEl.currentSrc || imgEl.src;
  overlayImg.decoding = 'async';
  overlay.appendChild(overlayImg);
  mosaicEl.appendChild(overlay);

  // FLIP: commit "from" state then animate to "to"
  void overlay.offsetWidth;
  overlay.style.left = `${toX}px`;
  overlay.style.top = `${toY}px`;
  overlay.style.width = `${toRect.w}px`;
  overlay.style.height = `${toRect.h}px`;

  // Fade out main detail image alongside the info panel
  const { el: itemEl } = activeDetail;
  itemEl.style.opacity = '0';

  const info = mosaicEl.querySelector('.detail-info');
  if (info) { info.classList.remove('visible'); info.style.pointerEvents = 'none'; }

  const arrows = crtScreen.querySelector('.detail-nav-arrows');
  if (arrows) arrows.classList.add('hidden');

  activeDetail._galleryOverlay = overlay;
  activeDetail._galleryBackdrop = backdrop;
  activeDetail._galleryFromRect = { x: fromX, y: fromY, w: fromW, h: fromH };
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

    // After animation: remove overlay, restore info + arrows
    const cleanup = () => {
      overlay.remove();
      const info = mosaicEl.querySelector('.detail-info');
      if (info) { info.classList.add('visible'); info.style.pointerEvents = ''; }
      const arrows = crtScreen.querySelector('.detail-nav-arrows');
      if (arrows) arrows.classList.remove('hidden');
    };
    overlay.addEventListener('transitionend', cleanup, { once: true });
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

  // Remove transition class once the CSS animation completes (fallback: 350ms)
  const cleanup = () => itemEl.classList.remove('detail-transitioning');
  itemEl.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 350);
}

/**
 * Swaps the main detail media with a crossfade.
 * Destroys any active splat viewer before swapping.
 *
 * Takes a relative path (not a URL) so it can rebuild the full <picture>
 * / <video> fallback chain — setting .src on an <img> inside a <picture>
 * is ignored whenever a <source> above it can decode.
 *
 * @param {string} newRelPath - Relative thumbnail path (matches item.src format)
 * @param {HTMLElement} clickedThumb - The gallery thumb that was clicked
 */
function swapDetailImage(newRelPath, clickedThumb) {
  if (!activeDetail) return;
  if (activeDetail.viewer) {
    destroySplatViewer(activeDetail.viewer);
    activeDetail.viewer = null;
  }
  // The swapped-in media is always a gallery extra (never item.src), so the
  // controls don't come back until the item is reopened or navigated to.
  activeDetail.videoControls?.destroy();
  activeDetail.videoControls = null;

  // `oldMedia` is the <picture> or <video> (the direct child of .mosaic-item).
  // querySelector('img, video') would find the inner <img> and we'd need to
  // walk up; selecting picture|video directly is cleaner.
  const oldMedia = activeDetail.el.querySelector(':scope > picture, :scope > video');
  if (!oldMedia) return;

  const newMedia = createMediaElement(newRelPath, { alt: '', lazy: false });
  if (!newMedia) return;

  oldMedia.style.transition = 'opacity 150ms ease';
  oldMedia.style.opacity = '0';
  oldMedia.addEventListener('transitionend', () => {
    // Replace element wholesale so <source> variants update, not just .src.
    oldMedia.replaceWith(newMedia);
    // Starting state for fade-in on the new element
    newMedia.style.opacity = '0';
    newMedia.style.transition = 'opacity 150ms ease';
    requestAnimationFrame(() => { newMedia.style.opacity = ''; });
    setTimeout(() => { newMedia.style.transition = ''; }, 160);
  }, { once: true });

  document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
  clickedThumb.classList.add('active');
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

  const containerRect = mosaicEl.getBoundingClientRect();

  // ---- FIRST: snapshot the item's grid position relative to mosaic ----
  const itemRect = itemEl.getBoundingClientRect();
  const firstRect = {
    x: itemRect.left - containerRect.left,
    y: itemRect.top - containerRect.top,
    w: itemRect.width,
    h: itemRect.height,
  };

  // ---- Compute target rect (no CSS layout switching needed) ----
  const layout = computeDetailLayout(itemEl, containerRect, itemData);
  const { targetRect } = layout;

  // Store layout on the element for closeDetail / navigateDetail
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

  // Position the item absolutely at the target rect
  itemEl.classList.add('detail-active');
  itemEl.style.left = `${targetRect.x}px`;
  itemEl.style.top = `${targetRect.y}px`;
  itemEl.style.width = `${targetRect.w}px`;
  itemEl.style.height = `${targetRect.h}px`;

  // ---- FLIP: animate from grid rect → target rect ----
  // Uniform scale based on width — avoids distortion
  const s = firstRect.w / targetRect.w;
  const dx = firstRect.x - targetRect.x;
  const dy = firstRect.y - targetRect.y;

  const anim = itemEl.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], {
    duration: 400,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'none',
  });

  // Build nav bar immediately so it's visible during the FLIP animation
  buildDetailNav(itemData, layout);

  anim.onfinish = () => {
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

  const mosaicItems = [...mosaicEl.querySelectorAll('.mosaic-item')];
  const currentIdx = activeDetail ? mosaicItems.indexOf(activeDetail.el) : -1;

  const prevBtn = nav.querySelector('.detail-nav-prev');
  const nextBtn = nav.querySelector('.detail-nav-next');

  if (prevBtn) prevBtn.disabled = currentIdx <= 0;
  if (nextBtn) nextBtn.disabled = currentIdx >= currentCategoryItems.length - 1;
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
 * Prefers `page` (full Markdown via parseMarkdown); falls back to the short
 * `description` as a single inline-formatted paragraph for un-migrated items.
 *
 * @param {HTMLElement} container - Where the body is appended (info or text column)
 * @param {Object} itemData - Content data (page, description, ...)
 */
function appendDetailBody(container, itemData) {
  if (itemData.page) {
    const body = document.createElement('div');
    body.className = 'detail-info-body';
    const fragment = parseMarkdown(itemData.page, { createMediaElement, iconMap: CONTACT_ICONS });
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

function buildDetailInfo(itemData, layout) {
  const { targetRect, infoSide } = layout;

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

    if (itemData.gallery && itemData.gallery.length > 0) {
      const media = createMediaElement(itemData.gallery[0], { alt: '', lazy: false });
      if (media) {
        const sideImg = document.createElement('div');
        sideImg.className = 'detail-info-side-image';
        sideImg.appendChild(media);
        // Pass the inner <img> (or the element itself if it's a <video>) so
        // enterGalleryImageFullscreen can read getBoundingClientRect on the
        // actual rendered pixels, not the transparent <picture> wrapper.
        const clickTarget = media.querySelector?.('img') || media;
        sideImg.addEventListener('click', () => enterGalleryImageFullscreen(clickTarget));
        info.appendChild(sideImg);
      }
    }
  } else {
    if (itemData.title) {
      const h2 = document.createElement('h2');
      h2.textContent = itemData.title;
      info.appendChild(h2);
    }
    appendDetailBody(info, itemData);

    // Gallery strip — shows additional images for items that have them.
    if (itemData.gallery && itemData.gallery.length > 0) {
      const galleryEl = document.createElement('div');
      galleryEl.className = 'detail-gallery';

      itemData.gallery.forEach((extraSrc) => {
        const media = createMediaElement(extraSrc, { alt: '' });
        if (!media) return;
        const thumb = document.createElement('div');
        thumb.className = 'gallery-thumb';
        thumb.appendChild(media);
        // Pass the relative path so swapDetailImage can rebuild the main
        // media's full variant chain (can't just swap .src — <picture>
        // <source> children override it, and <video> uses <source> too).
        thumb.addEventListener('click', () => swapDetailImage(extraSrc, thumb));
        galleryEl.appendChild(thumb);
      });

      info.appendChild(galleryEl);
    }
  }

  // Position based on layout — also set height so overflow-y: auto works.
  // Without an explicit height, the browser can't know when to scroll.
  const containerRect = mosaicEl.getBoundingClientRect();

  if (infoSide === 'below' || infoSide === 'below-split') {
    // Landscape: pin the doc directly under the image at its natural height and
    // let .mosaic-grid.detail-scroll scroll the image + doc as one unit.
    info.style.top = `${targetRect.y + targetRect.h}px`;
    mosaicEl.classList.add('detail-scroll');
  } else {
    // Portrait: image on one side, doc spanning the FULL width beneath it.
    // A transparent floated spacer (first child) shadows the image's footprint
    // so the text wraps beside the image, then widens to full width once it
    // clears the image's bottom — true float-wrap. The image itself stays an
    // absolutely-positioned sibling; both scroll together via .detail-scroll.
    const PAD_X = 16;   // doc horizontal padding (px) — keep in sync with inline padding below
    const PAD_Y = 24;   // doc top padding (px)
    const GAP = 24;     // horizontal gap between image and wrapped text (px)

    info.style.top = `${targetRect.y}px`;
    info.style.left = '0px';
    info.style.width = `${containerRect.width}px`;
    info.style.padding = `${PAD_Y}px ${PAD_X}px`;

    const spacer = document.createElement('div');
    spacer.className = 'detail-info-float';
    // From the doc's content-top (targetRect.y + PAD_Y) down to the image's
    // bottom (targetRect.y + targetRect.h): the wrapped text clears at image bottom.
    spacer.style.height = `${targetRect.h - PAD_Y}px`;
    // Width spans image width + gap; negative margin pulls the float's outer
    // edge out of the doc padding to sit flush with the image's outer edge.
    spacer.style.width = `${targetRect.w + GAP}px`;
    if (infoSide === 'right') {
      spacer.style.float = 'left';   // image on the left (x = 0)
      spacer.style.marginLeft = `${-PAD_X}px`;
    } else {
      spacer.style.float = 'right';  // image on the right (x = cw - w)
      spacer.style.marginRight = `${-PAD_X}px`;
    }
    info.insertBefore(spacer, info.firstChild);

    mosaicEl.classList.add('detail-scroll');
  }

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

  // Remove detail info + nav bar, restore grid pointer events
  const info = mosaicEl.querySelector('.detail-info');
  if (info) info.remove();
  const nav = crtScreen.querySelector('.detail-nav');
  if (nav) nav.remove();
  // Drop scroll mode + reset position so the reverse FLIP snapshots the image at
  // its unscrolled spot, not wherever the user had scrolled to.
  mosaicEl.classList.remove('detail-mode', 'detail-scroll');
  mosaicEl.scrollTop = 0;

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
    return;
  }

  // ---- Reverse FLIP: absolute position → grid position ----
  const containerRect = mosaicEl.getBoundingClientRect();

  // FIRST: snapshot current absolute position (relative to mosaic)
  const itemRect = itemEl.getBoundingClientRect();
  const firstRect = {
    x: itemRect.left - containerRect.left,
    y: itemRect.top - containerRect.top,
    w: itemRect.width,
    h: itemRect.height,
  };

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
  const lastRect = {
    x: gridRect.left - containerRect.left,
    y: gridRect.top - containerRect.top,
    w: gridRect.width,
    h: gridRect.height,
  };

  // Uniform scale for reverse animation
  const s = firstRect.w / lastRect.w;
  const dx = firstRect.x - lastRect.x;
  const dy = firstRect.y - lastRect.y;

  itemEl.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], {
    duration: 400,
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
function setFocus(zone, index) {
  clearFocus();
  focusZone = zone;

  if (zone === 'nav') {
    const navItems = document.querySelectorAll('#nav-menu .nav-item');
    navFocusIndex = Math.max(0, Math.min(index, navItems.length - 1));
    navItems[navFocusIndex]?.classList.add('focused');
  } else if (zone === 'mosaic') {
    const items = mosaicEl.querySelectorAll('.mosaic-item');
    mosaicFocusIndex = Math.max(0, Math.min(index, items.length - 1));
    items[mosaicFocusIndex]?.classList.add('focused');
  }
}

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

  const mosaicItems = mosaicEl.querySelectorAll('.mosaic-item');
  const targetEl = mosaicItems[itemIndex];
  const targetData = CATEGORIES[category]?.[itemIndex];
  if (targetEl && targetData) openDetail(targetEl, targetData);
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

  // Clean up article page if open
  if (activeArticle) {
    if (activeArticle.observer) activeArticle.observer.disconnect();
    crtScreen.querySelector('.detail-nav')?.remove();
    mosaicEl.classList.remove('article-mode');
    activeArticle = null;
  }

  current?.classList.remove('selected');
  navItem.classList.add('selected');
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
  if (nextIdx < 0 || nextIdx >= currentCategoryItems.length) { isNavigating = false; return; }

  const nextEl = mosaicItems[nextIdx];
  const nextData = currentCategoryItems[nextIdx];
  if (!nextEl || !nextData) { isNavigating = false; return; }

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

    // Compute layout for the new item before touching its classes
    const containerRect = mosaicEl.getBoundingClientRect();
    const layout = computeDetailLayout(nextEl, containerRect, nextData);
    const { targetRect } = layout;

    // Pull nextEl out of grid flow while still invisible (detail-fading = opacity:0),
    // THEN remove fading-out — it never appears at its grid position.
    nextEl.classList.add('detail-active', 'detail-fading');
    nextEl.style.left = `${targetRect.x}px`;
    nextEl.style.top = `${targetRect.y}px`;
    nextEl.style.width = `${targetRect.w}px`;
    nextEl.style.height = `${targetRect.h}px`;
    nextEl._detailLayout = layout;
    // Now safe — nextEl is already absolutely positioned and invisible via detail-fading
    nextEl.classList.remove('fading-out');

    const sessionId = ++detailSessionId;
    activeDetail = { el: nextEl, data: nextData, viewer: null, videoControls: null, sessionId, placeholder: null };
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
    isNavigating = false;
  }
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
        closeDetail();
        // Restore mosaic focus to the item that was open
        if (mosaicFocusIndex >= 0) setFocus('mosaic', mosaicFocusIndex);
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

  if (deviceTier === 'low') {
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
const terminal = new Terminal(terminalElement);

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
          frame: RABBIT_CONFIG.frames.idle,
          flipped: rabbit.lastDirection === -1,
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

    const navMenu = document.getElementById('nav-menu');

    // Reveal the nav menu (already in DOM, just hidden)
    navMenu.hidden = false;

    // Type menu items bottom to top — Art first, General last (ends selected)
    const menuItems = ['3D Tech', '3D Art', 'Games', 'General'];
    await sleep(200);

    let prevItem = null;

    for (const label of menuItems) {
      // Deselect previous item
      if (prevItem) prevItem.classList.remove('selected');

      await sleep(100);

      const item = document.createElement('div');
      item.className = 'nav-item selected';  // selected while typing
      item.dataset.label = label;
      navMenu.prepend(item);  // prepend so each new item appears above the previous

      // Build structure: <span class="nav-prompt">> </span><span class="nav-label">Label</span>
      const promptSpan = document.createElement('span');
      promptSpan.className = 'nav-prompt';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'nav-label';

      item.appendChild(promptSpan);
      item.appendChild(labelSpan);

      // Type "> Label" char by char with cursor
      const fullText = `> ${label}`;
      const cursorChar = document.createElement('span');
      cursorChar.className = 'cursor';
      cursorChar.textContent = '█';
      item.appendChild(cursorChar);

      // Start frame sweep as the last nav item begins typing
      if (label === menuItems[menuItems.length - 1]) showMosaicFrame();

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

    // Click handler for selection + mosaic switch
    navMenu.addEventListener('click', (e) => {
      const clicked = e.target.closest('.nav-item');
      if (!clicked) return;

      clearFocus(); // mouse click resets keyboard focus
      selectNavItem(clicked);
    });

    // Keyboard navigation is now active
    navReady = true;

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
  try {
    // Preload rabbit spritesheet before starting
    const spritesheet = await preloadImage(rabbitSpritesheetUrl);

    // Pre-warm sprite cell cache off the main thread — fire and forget.
    // The worker samples all morph frames during the intro typing sequence,
    // so the first morph hits the cache instead of paying the ~20ms GPU readback cost.
    const prewarmConfig = getParticleConfig();
    if (prewarmConfig) {
      try {
        prewarmSampleCache(spritesheet, Object.values(RABBIT_CONFIG.frames), prewarmConfig);
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

// URL-gated portfolio decks: `/?p=<slug>` skips the terminal/rabbit intro and
// boots straight into the slide deck (code-split — the deck chunk only loads
// for gated visits, never for the normal site). mountDeck handles an unknown
// slug with its own "not found" panel, so presence of the param is enough.
const gatedSlug = new URLSearchParams(window.location.search).get('p');
if (gatedSlug !== null) {
  document.getElementById('crt-screen')?.setAttribute('hidden', '');
  import('./components/PortfolioDeck.js')
    .then((m) => m.mountDeck(gatedSlug, { isMobile: false }))
    .catch((err) => console.error('Deck boot failed:', err));
} else {
  main();
}
