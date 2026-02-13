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
import { ParticleMorph } from './components/ParticleMorph.js';
import { TYPING_CONFIG, RABBIT_CONFIG, TIMING, MOSAIC_CONFIG, injectCSSVariables } from './config/animations.js';
import { injectCRTVariables, startFlicker, isMobile } from './config/crt.js';
import { PARTICLE_CONFIG } from './config/particles.js';
import { CATEGORIES, resolveThumbnail } from './config/content.js';
import rabbitSpritesheetUrl from './assets/spritesheets/RabbitAnimation_V1.png';

// Inject CSS variables from centralized config
injectCSSVariables();
injectCRTVariables();

// Get CRT container for spawning elements inside it
const crtScreen = document.getElementById('crt-screen');

// Start flicker effect
startFlicker(crtScreen);

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
        const url = resolveThumbnail(item.src);
        if (!url) return;

        if (item.src.endsWith('.mp4')) {
          // For video: a low-priority fetch pulls it into browser's HTTP cache.
          // 'no-cors' + low priority = invisible background fetch.
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
 * @param {string} category - Key from CATEGORIES ('General', '3D Assets', '3D Art')
 */
const mosaicEl = document.getElementById('mosaic');
let mosaicHasContent = false;

// ---- Detail view state ----
// Tracks which mosaic item is currently expanded (null = grid mode).
// Like a "selected" reference in a UI controller — only one at a time.
let activeDetail = null;

// ---- Keyboard navigation state ----
// Two focus "zones" — nav menu and mosaic grid — with arrow keys moving
// within and between them. Like a console game's UI selector system:
// a cursor moves independently, Enter confirms the selection.
let navReady = false;              // true after intro finishes & nav/mosaic visible
let focusZone = null;              // 'nav' | 'mosaic' | null
let navFocusIndex = -1;
let mosaicFocusIndex = -1;
let currentCategoryItems = [];     // content data array for current mosaic

async function renderMosaic(category) {
  const items = CATEGORIES[category];
  if (!items) return;

  // Close any open detail before switching categories
  if (activeDetail) closeDetail(true);

  // Store items array for keyboard detail navigation
  currentCategoryItems = items;

  // If mosaic already has content, fade out first
  if (mosaicHasContent) {
    mosaicEl.classList.remove('visible');
    await new Promise(r => setTimeout(r, MOSAIC_CONFIG.fadeDuration));
  }

  // Clear and rebuild
  mosaicEl.innerHTML = '';

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'mosaic-item';
    div.dataset.cols = item.cols;
    div.dataset.rows = item.rows;

    const isVideo = item.src.endsWith('.mp4');
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.src = resolveThumbnail(item.src);

    if (isVideo) {
      media.autoplay = true;
      media.loop = true;
      media.muted = true;        // required for autoplay in most browsers
      media.playsInline = true;   // prevents fullscreen on iOS
    } else {
      media.alt = item.alt;
      media.loading = 'lazy';
    }

    div.appendChild(media);
    mosaicEl.appendChild(div);

    // Click → open detail view for this item
    div.addEventListener('click', () => {
      if (activeDetail) return; // already in detail mode
      clearFocus(); // mouse click resets keyboard focus
      openDetail(div, item);
    });
  }

  mosaicHasContent = true;

  // Fade in after a brief frame delay (lets browser paint the new items)
  await new Promise(r => setTimeout(r, MOSAIC_CONFIG.renderDelay));
  mosaicEl.classList.add('visible');
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
  if (media.tagName === 'VIDEO') return media.videoWidth / media.videoHeight;
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
function computeDetailLayout(itemEl, containerRect) {
  const ar = getMediaAspectRatio(itemEl);
  const cw = containerRect.width;
  const ch = containerRect.height;

  let x, y, w, h, infoSide;

  if (ar > 1) {
    // ---- Landscape: image at top, info below ----
    w = cw;
    h = w / ar;
    // Cap height at 60% of container so info panel has room
    if (h > ch * 0.6) {
      h = ch * 0.6;
      w = h * ar;
    }
    // Center horizontally if width was capped
    x = (cw - w) / 2;
    y = 0;
    infoSide = 'below';
  } else {
    // ---- Portrait: image on one side, info beside it ----
    h = ch * 0.85;
    w = h * ar;
    // Cap width at 50% so info panel gets the other half
    if (w > cw * 0.5) {
      w = cw * 0.5;
      h = w / ar;
    }
    y = (ch - h) / 2;

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
  activeDetail = { el: itemEl, data: itemData };

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
  const layout = computeDetailLayout(itemEl, containerRect);
  const { targetRect } = layout;

  // Store layout on the element for closeDetail / navigateDetail
  itemEl._detailLayout = layout;

  // Hide siblings
  const allItems = mosaicEl.querySelectorAll('.mosaic-item');
  allItems.forEach(el => {
    if (el !== itemEl) {
      el.classList.add('fading-out');
      el.style.display = 'none';
    }
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

  anim.onfinish = () => {
    buildDetailInfo(itemData, layout);
  };
}

/**
 * Creates and injects the detail info panel (back button + title + description).
 * Positioned based on the layout computed by computeDetailLayout.
 *
 * Landscape: below the image, full container width.
 * Portrait: beside the image, filling the remaining horizontal space.
 *
 * @param {Object} itemData - Content data (title, description, etc.)
 * @param {Object} layout - From computeDetailLayout ({targetRect, infoSide})
 */
function buildDetailInfo(itemData, layout) {
  const { targetRect, infoSide } = layout;

  const info = document.createElement('div');
  info.className = `detail-info ${infoSide === 'below' ? 'landscape' : 'portrait'}`;

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.textContent = '< Back';
  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDetail();
  });
  info.appendChild(backBtn);

  if (itemData.title) {
    const h2 = document.createElement('h2');
    h2.textContent = itemData.title;
    info.appendChild(h2);
  }

  if (itemData.description) {
    const p = document.createElement('p');
    p.textContent = itemData.description;
    info.appendChild(p);
  }

  // Position based on layout
  const containerRect = mosaicEl.getBoundingClientRect();

  if (infoSide === 'below') {
    info.style.top = `${targetRect.y + targetRect.h}px`;
  } else if (infoSide === 'right') {
    // Image is on left, info on right
    info.style.left = `${targetRect.x + targetRect.w}px`;
    info.style.width = `${containerRect.width - targetRect.x - targetRect.w}px`;
    info.style.height = `${targetRect.h}px`;
  } else {
    // infoSide === 'left' — image is on right, info on left
    info.style.left = '0px';
    info.style.width = `${targetRect.x}px`;
    info.style.height = `${targetRect.h}px`;
  }

  mosaicEl.appendChild(info);

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

  const { el: itemEl } = activeDetail;
  activeDetail = null;

  // Remove detail info
  const info = mosaicEl.querySelector('.detail-info');
  if (info) info.remove();

  // Cancel any in-progress animation
  itemEl.getAnimations().forEach(a => a.cancel());

  // Clean up stored layout
  delete itemEl._detailLayout;

  if (instant) {
    itemEl.classList.remove('detail-active');
    itemEl.style.left = '';
    itemEl.style.top = '';
    itemEl.style.width = '';
    itemEl.style.height = '';
    const allItems = mosaicEl.querySelectorAll('.mosaic-item');
    allItems.forEach(el => {
      el.style.display = '';
      el.classList.remove('fading-out');
    });
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

  // Remove absolute positioning → item returns to grid flow
  itemEl.classList.remove('detail-active');
  itemEl.style.left = '';
  itemEl.style.top = '';
  itemEl.style.width = '';
  itemEl.style.height = '';

  // Show siblings (still fading-out = invisible)
  const allItems = mosaicEl.querySelectorAll('.mosaic-item');
  allItems.forEach(el => el.style.display = '');

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

  // Fade siblings back in alongside the animation
  allItems.forEach(el => el.classList.remove('fading-out'));
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
 * Selects a nav item — updates .selected class and switches the mosaic.
 * Extracted so both click and keyboard nav can trigger it.
 */
function selectNavItem(navItem) {
  const navMenu = document.getElementById('nav-menu');
  const current = navMenu.querySelector('.nav-item.selected');
  if (navItem === current) return;

  current?.classList.remove('selected');
  navItem.classList.add('selected');
  mosaicFocusIndex = -1; // mosaic content is changing, reset its focus
  renderMosaic(navItem.dataset.label);
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
 * @param {number} direction - -1 for previous, +1 for next
 */
function navigateDetail(direction) {
  if (!activeDetail) return;

  const mosaicItems = [...mosaicEl.querySelectorAll('.mosaic-item')];
  const currentIdx = mosaicItems.indexOf(activeDetail.el);
  const nextIdx = currentIdx + direction;

  // Bounds check
  if (nextIdx < 0 || nextIdx >= currentCategoryItems.length) return;

  const nextEl = mosaicItems[nextIdx];
  const nextData = currentCategoryItems[nextIdx];
  if (!nextEl || !nextData) return;

  // Clean up current item
  const { el: currentEl } = activeDetail;
  currentEl.getAnimations().forEach(a => a.cancel());
  currentEl.classList.remove('detail-active');
  currentEl.style.left = '';
  currentEl.style.top = '';
  currentEl.style.width = '';
  currentEl.style.height = '';
  currentEl.style.display = 'none';
  delete currentEl._detailLayout;

  // Remove old detail info
  const info = mosaicEl.querySelector('.detail-info');
  if (info) info.remove();

  // Compute layout for the new item (may be different AR)
  const containerRect = mosaicEl.getBoundingClientRect();
  // Temporarily show the item so we can read its natural dimensions
  nextEl.style.display = '';
  const layout = computeDetailLayout(nextEl, containerRect);
  const { targetRect } = layout;

  // Position the new item
  nextEl.classList.add('detail-active');
  nextEl.style.left = `${targetRect.x}px`;
  nextEl.style.top = `${targetRect.y}px`;
  nextEl.style.width = `${targetRect.w}px`;
  nextEl.style.height = `${targetRect.h}px`;
  nextEl._detailLayout = layout;

  activeDetail = { el: nextEl, data: nextData };
  mosaicFocusIndex = nextIdx;

  // Build new detail info with computed layout
  buildDetailInfo(nextData, layout);
}

// ---- Master keydown handler ----
document.addEventListener('keydown', (e) => {
  // Ignore when nav isn't ready yet (intro still playing)
  if (!navReady) return;

  const key = e.key;

  // --- Detail view mode ---
  if (activeDetail) {
    if (key === 'Escape') {
      closeDetail();
      // Restore mosaic focus to the item that was open
      if (mosaicFocusIndex >= 0) setFocus('mosaic', mosaicFocusIndex);
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      navigateDetail(key === 'ArrowLeft' ? -1 : 1);
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
 * Unhides the mosaic container (removes hidden attribute).
 * Call this once after the nav menu finishes typing.
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
const username = rawName ? rawName.trim().slice(0, 20).replace(/[<>]/g, '') : null;

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
    const spriteImage = await preloadImage(rabbitSpritesheetUrl);
    const morph = new ParticleMorph(PARTICLE_CONFIG);

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

    // 7. Destroy the rabbit DOM element
    rabbit.destroy();
    rabbit = null;

    // 8. Show cursor (locked, no blink) under the canvas
    whiteTerminal.showCursor(true);

    // 9. Handoff: fade canvas, reveal DOM cursor
    await morph.handoff();
    morph.destroy();

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

    // Type menu items one by one
    const menuItems = ['General', '3D Assets', '3D Art'];
    await sleep(200);

    let prevItem = null;

    for (const label of menuItems) {
      // Deselect previous item
      if (prevItem) prevItem.classList.remove('selected');

      await sleep(100);

      const item = document.createElement('div');
      item.className = 'nav-item selected';  // selected while typing
      item.dataset.label = label;
      navMenu.appendChild(item);

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

    // Move selection to last item
    prevItem.classList.remove('selected');

    const items = navMenu.querySelectorAll('.nav-item');
    const lastItem = items[items.length - 1];
    lastItem.classList.add('selected');

    // Show mosaic with the initially selected category
    const initialCategory = lastItem.dataset.label;
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
    await preloadImage(rabbitSpritesheetUrl);

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

    if (isMobile()) {
      // Mobile: skip particles, use existing direct spawn + drop
      rabbit = new Rabbit();
      rabbit.spawnAndDrop(cursorPos.x, cursorPos.y, crtScreen);
      terminal.hideCursor();
    } else {
      // Desktop: particle morph — cursor shatters into particles that
      // reassemble into the rabbit shape, then hand off to DOM element
      const spriteImage = await preloadImage(rabbitSpritesheetUrl);

      const morph = new ParticleMorph(PARTICLE_CONFIG);
      const targetRect = {
        x: cursorPos.x,
        y: cursorPos.y,
        w: RABBIT_CONFIG.width,
        h: RABBIT_CONFIG.height,
      };

      terminal.delayedHideCursor(100)

      // Particles animate: scatter → drift → converge → settle
      await morph.start({
        source: { rect: cursorRect },
        target: { rect: targetRect, image: spriteImage, frame: RABBIT_CONFIG.frames.spawnStart, flipped: true },
        container: crtScreen,
      });

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

main();
