/**
 * Mobile entry — a completely separate app from src/desktop.js.
 *
 * Boots when the device looks mobile (see src/main.js dispatch).
 * Never loads the desktop terminal / rabbit / mosaic / detail flow.
 *
 * Architecture:
 *   · Quick typewriter intro with a single tap affordance
 *   · Shell = thin top header + scrollable content + bottom tab bar
 *   · Four tabs: About (CV), Tech feed, Art feed, Games feed
 *   · Detail sheet slides up, supports swipe navigation + splat viewer
 *
 * Perf principles (mobile-first):
 *   - No particle morph, no heavy WebGL on the intro
 *   - No filter: blur on scroll containers
 *   - content-visibility on long feeds
 *   - loading="lazy" / decoding="async" on all thumbs
 *   - Dynamic import for the splat viewer (same chunk as desktop)
 */

import './mobile.css';
import {
  CATEGORIES,
  GAMES,
  GENERAL_CONTENT,
  resolveSplat,
} from './config/content.js';
import { ICONS } from './config/icons.js';
import { createMediaElement } from './utils/media.js';
import { applyInline } from './utils/markdown.js';


// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isVideoSrc = (src) => typeof src === 'string' && /\.(mp4|webm|mov|m4v)$/i.test(src);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Create element with optional className/attrs/children. Tiny hyperscript.
 *
 * `unsafeHtml` is deliberately named to flag that it sets innerHTML — only
 * feed it from trusted sources (the ICONS module constant, never user data
 * or anything interpolated at runtime). See the security contract at the
 * top of src/config/icons.js.
 */
function h(tag, opts = {}, children = []) {
  const el = document.createElement(tag);
  if (opts.class) el.className = opts.class;
  if (opts.text != null) el.textContent = opts.text;
  if (opts.unsafeHtml != null) el.innerHTML = opts.unsafeHtml;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, v);
  if (opts.style) Object.assign(el.style, opts.style);
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) el.addEventListener(k, v);
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}


// ---------------------------------------------------------------------------
// Splat viewer lazy-load (shared chunk with desktop — same dynamic import
// target = same Vite chunk).
// ---------------------------------------------------------------------------
let _splatModulePromise = null;
function loadSplatModule() {
  if (!_splatModulePromise) {
    _splatModulePromise = import('./components/SplatViewer.js');
  }
  return _splatModulePromise;
}

// Monotonic counter that invalidates every in-flight splat mount. Every
// renderSheetItem call captures a local `my = ++splatSession`; after any
// await, it compares `my === splatSession` to decide whether to continue.
// This replaces the previous per-sheet field which was assigned but never read.
let splatSession = 0;


// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'General', label: 'About' },
  { id: '3D Tech', label: 'Tech' },
  { id: '3D Art',  label: 'Art' },
  { id: 'Games',   label: 'Games' },
];

let appEl = null;
let contentEl = null;
let tabButtons = [];
let activeTabId = 'General';

// Detail sheet state
let activeSheet = null;  // { el, categoryId, index, items, viewer, ... }


// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
export async function boot() {
  document.documentElement.classList.add('mobile-mode');

  // Remove desktop DOM stubs — index.html ships empty placeholders for the
  // terminal / mosaic / scanline overlay so the desktop entry can boot
  // without layout shift. On mobile they're dead weight that also pollute
  // the a11y tree (an empty <main id="terminal"> would otherwise be a
  // second main landmark alongside the mobile content <main>).
  document.querySelectorAll('#crt-screen, #mosaic, .crt-overlay')
    .forEach((el) => el.remove());

  // Build the root container
  appEl = h('div', { attrs: { id: 'mobile-app' } });
  document.body.appendChild(appEl);

  await runIntro();
  buildShell();
  switchTab('General', { immediate: true });
}


// ---------------------------------------------------------------------------
// Intro
//
// 100% CSS-driven. Both lines are mounted with their full text in a single
// paint, then mobile.css's clip-path + steps() animation reveals each line
// character-by-character on a fixed schedule (see keyframes m-reveal and
// m-rabbit-enter). JS only appends the DOM and waits for the dismiss tap —
// no JS timers means no missed-frame races and no font-metric dependency.
// ---------------------------------------------------------------------------

function buildIntroLine(text, lineClass) {
  return h('p', { class: `line ${lineClass}` }, [
    h('span', { class: 'prompt', text: '>' }),
    h('span', { class: 'body', text }),
    h('span', { class: 'cursor', text: '▮' }),
  ]);
}

/**
 * Toggles the `.jumping` class on the rabbit sprite on a randomised schedule
 * so the splash rabbit occasionally hops instead of only idling. Duration
 * (900ms) must match the `.m-rabbit-sprite.jumping` animation in mobile.css
 * — when the class comes off the sprite returns to `m-rabbit-idle`.
 *
 * Silently no-ops under prefers-reduced-motion. Returns a cancel function.
 */
function startRabbitRandomJumps(sprite) {
  if (prefersReducedMotion || !sprite) return () => {};

  const JUMP_DURATION = 900;   // ms, matches CSS
  let cancelled = false;
  let scheduleTimer = null;
  let endTimer = null;

  const scheduleNext = (delay) => {
    if (cancelled) return;
    scheduleTimer = setTimeout(() => {
      if (cancelled || !sprite.isConnected) return;
      // Force reflow so re-adding the class restarts the animation cleanly
      // if a previous run somehow left it on.
      sprite.classList.remove('jumping');
      void sprite.offsetWidth;
      sprite.classList.add('jumping');
      endTimer = setTimeout(() => {
        if (cancelled) return;
        sprite.classList.remove('jumping');
        // Next jump in 2–5s
        scheduleNext(2000 + Math.random() * 3000);
      }, JUMP_DURATION);
    }, delay);
  };

  // First jump ~3.0–4.5s after mount: the parent `.m-intro-rabbit` finishes
  // its fade-in at 2620ms, then we give the viewer a breath before the hop.
  scheduleNext(3000 + Math.random() * 1500);

  return () => {
    cancelled = true;
    clearTimeout(scheduleTimer);
    clearTimeout(endTimer);
  };
}

async function runIntro() {
  const line1 = buildIntroLine("Hi, I'm Tomás.",    'line-1');
  const line2 = buildIntroLine('Technical Artist.', 'line-2');
  const terminal = h('div', { class: 'm-intro-terminal' }, [line1, line2]);

  const rabbitSprite = h('span', { class: 'm-rabbit-sprite', attrs: { 'aria-hidden': 'true' } });
  const rabbitWrap = h('div', { class: 'm-intro-rabbit' }, [
    rabbitSprite,
    h('p', { class: 'm-tap-hint', text: 'tap to enter' }),
  ]);

  const intro = h('div', { class: 'm-intro' }, [terminal, rabbitWrap]);
  appEl.appendChild(intro);

  // Random idle jumps — kicks in after the rabbit's reveal animation (parent
  // fades in at 2200ms + 420ms). Returns a cancel fn that the dismiss path
  // calls so timers never outlive the splash DOM.
  const cancelRabbitJumps = startRabbitRandomJumps(rabbitSprite);

  // Wait for a tap OR key press, with a short grace period so that a
  // queued page-load pointerdown can't immediately dismiss the intro.
  // Also auto-dismiss after 12s of no interaction so an idle tab doesn't
  // leave the user stuck on the splash if they return to it.
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      cancelRabbitJumps();
      intro.removeEventListener('pointerdown', finish);
      document.removeEventListener('keydown', finish);
      resolve();
    };
    const idleTimer = setTimeout(finish, 12_000);
    setTimeout(() => {
      if (done) return;
      intro.addEventListener('pointerdown', finish, { once: true });
      document.addEventListener('keydown', finish, { once: true });
    }, 220);
  });

  intro.classList.add('fading');
  await sleep(prefersReducedMotion ? 0 : 300);
  intro.remove();
}


// ---------------------------------------------------------------------------
// Shell — header + content + tab bar
// ---------------------------------------------------------------------------
function buildShell() {
  const header = h('header', { class: 'm-header' }, [
    h('div', { class: 'm-header-name' }, [
      h('span', { class: 'prompt', text: '>' }),
      h('span', { text: GENERAL_CONTENT.name }),
    ]),
    h('span', { class: 'm-header-role', text: GENERAL_CONTENT.title }),
  ]);

  // Use <main> (implicit role="main") — one main landmark per page. The
  // sheet uses <section>, not another <main>, to avoid a duplicate.
  contentEl = h('main', { class: 'm-content' });

  const tabbar = h('nav', { class: 'm-tabbar', attrs: { 'aria-label': 'Sections' } });
  tabButtons = TABS.map((tab) => {
    const btn = h('button', {
      class: 'm-tab',
      text: tab.label,
      attrs: { type: 'button', 'data-tab': tab.id },
      on: { click: () => switchTab(tab.id) },
    });
    tabbar.appendChild(btn);
    return btn;
  });

  appEl.append(header, contentEl, tabbar);
}

function switchTab(id, { immediate = false } = {}) {
  if (id === activeTabId && !immediate) return;
  activeTabId = id;

  for (const btn of tabButtons) {
    btn.classList.toggle('is-active', btn.dataset.tab === id);
  }

  // Clear content; JS handles stagger via .m-fade animations
  contentEl.replaceChildren();
  contentEl.scrollTop = 0;

  switch (id) {
    case 'General':  renderAbout();                break;
    case 'Games':    renderGamesFeed();            break;
    default:         renderCategoryFeed(id);       break;
  }
}


// ---------------------------------------------------------------------------
// About tab
// ---------------------------------------------------------------------------
function renderAbout() {
  const { name, title, subtitle, summary, skills, tools, contacts } = GENERAL_CONTENT;

  const root = h('section', { class: 'm-about' });

  root.append(
    h('div', { class: 'm-fade' }, [
      h('h1', { text: name }),
      h('p', { class: 'role', text: title }),
      h('p', { class: 'subtitle', text: subtitle }),
    ]),
    h('p', { class: 'm-summary m-fade', text: summary }),
    h('div', { class: 'm-divider' }),
  );

  // Skills
  const skillsWrap = h('div', { class: 'm-fade' }, [
    h('p', { class: 'm-section-label', text: 'skills' }),
    buildSkillsList(skills),
  ]);
  root.appendChild(skillsWrap);

  root.appendChild(h('div', { class: 'm-divider' }));

  // Tools
  root.appendChild(h('div', { class: 'm-fade' }, [
    h('p', { class: 'm-section-label', text: 'tools' }),
    h('div', { class: 'm-tools' }, tools.map((t) =>
      h('span', { class: 'm-tool', text: t })
    )),
  ]));

  root.appendChild(h('div', { class: 'm-divider' }));

  // Contacts
  root.appendChild(h('div', { class: 'm-fade' }, [
    h('p', { class: 'm-section-label', text: 'contact' }),
    buildContactsList(contacts),
  ]));

  contentEl.appendChild(root);
  scheduleFadeStagger(root);
}

function buildSkillsList(skills) {
  const wrap = h('div', { class: 'm-skills' });
  for (const skill of skills) {
    const row = h('div', { class: 'm-skill-row' }, [
      h('div', { class: 'm-skill-head', text: skill.label }),
      h('p', { class: 'm-skill-detail', text: skill.detail }),
    ]);
    if (skill.thumbnails?.length) {
      const strip = h('div', { class: 'm-skill-thumbs' });
      for (const ref of skill.thumbnails) {
        const item = CATEGORIES[ref.category]?.[ref.itemIndex];
        if (!item) continue;
        const thumb = buildMediaThumb(item, 'm-skill-thumb');
        thumb.addEventListener('click', () => openSheet(ref.category, ref.itemIndex));
        strip.appendChild(thumb);
      }
      row.appendChild(strip);
    }
    wrap.appendChild(row);
  }
  return wrap;
}

function buildContactsList(contacts) {
  const wrap = h('div', { class: 'm-contacts' });
  for (const c of contacts) {
    if (c.copyText) {
      const row = h('div', {
        class: 'm-contact',
        attrs: { role: 'button', tabindex: '0', 'aria-label': `Copy ${c.label}` },
      }, [
        h('span', { unsafeHtml: ICONS[c.platform] || '' }),
        h('span', { class: 'value', text: c.copyText }),
        h('span', { class: 'label', text: 'tap to copy' }),
      ]);
      const onCopy = async () => {
        // Only show the "copied" confirmation if the copy actually succeeded.
        // navigator.clipboard is undefined in non-secure contexts and some
        // in-app WebViews — silently pretending to copy would be a lie.
        let ok = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(c.copyText);
            ok = true;
          }
        } catch {
          ok = false;
        }
        const label = row.querySelector('.label');
        if (!ok) {
          if (label) label.textContent = 'copy failed';
          setTimeout(() => { if (label) label.textContent = 'tap to copy'; }, 1400);
          return;
        }
        row.classList.add('copied');
        if (label) label.textContent = 'copied';
        setTimeout(() => {
          row.classList.remove('copied');
          if (label) label.textContent = 'tap to copy';
        }, 1400);
      };
      row.addEventListener('click', onCopy);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopy(); }
      });
      wrap.appendChild(row);
    } else {
      if (!/^https?:\/\//i.test(c.url || '')) continue;
      const a = h('a', {
        class: 'm-contact',
        attrs: { href: c.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': c.label },
      }, [
        h('span', { unsafeHtml: ICONS[c.platform] || '' }),
        h('span', { class: 'value', text: c.label }),
        h('span', { class: 'label', text: 'open' }),
      ]);
      wrap.appendChild(a);
    }
  }
  return wrap;
}


// ---------------------------------------------------------------------------
// Category feed (Tech / Art)
// ---------------------------------------------------------------------------
function renderCategoryFeed(categoryId) {
  const items = CATEGORIES[categoryId] || [];

  if (items.length === 0) {
    contentEl.appendChild(h('div', { class: 'm-empty m-fade', text: 'no entries yet.' }));
    return;
  }

  const feed = h('section', { class: 'm-feed' });
  items.forEach((item, idx) => {
    const card = buildFeedCard(item);
    card.addEventListener('click', () => openSheet(categoryId, idx));
    feed.appendChild(card);
  });
  contentEl.appendChild(feed);
  scheduleFadeStagger(feed);
}

function buildFeedCard(item) {
  const mediaWrap = h('div', { class: 'm-card-media' });
  const media = buildMedia(item, { inCard: true });
  mediaWrap.appendChild(media);

  if (item.type === 'splat') {
    mediaWrap.appendChild(h('span', { class: 'badge', text: '3D' }));
  }

  const body = h('div', { class: 'm-card-body' }, [
    item.title ? h('h3', { class: 'm-card-title', text: item.title }) : null,
    item.description ? h('p', { class: 'm-card-desc', unsafeHtml: applyInline(item.description) }) : null,
  ]);

  // Use a <button> so keyboard activation + role semantics come free
  const card = h('button', { class: 'm-card m-fade', attrs: { type: 'button' } }, [mediaWrap, body]);
  return card;
}

/** Builds a <picture> or <video> element appropriate for the item. */
function buildMedia(item, { inCard = false } = {}) {
  const el = createMediaElement(item.src, {
    alt: item.alt || item.title || '',
    video: { preload: inCard ? 'metadata' : 'auto' },
  });
  // Placeholder matches pre-existing behavior for unresolved thumbnails.
  if (!el) return h('div', { style: { aspectRatio: '4 / 3', background: '#060806' } });
  return el;
}

function buildMediaThumb(item, className) {
  const el = h('div', { class: className }, [buildMedia(item)]);
  return el;
}


// ---------------------------------------------------------------------------
// Games feed
// ---------------------------------------------------------------------------
function renderGamesFeed() {
  if (!GAMES || GAMES.length === 0) {
    contentEl.appendChild(h('div', { class: 'm-empty m-fade', text: 'no games yet.' }));
    return;
  }

  const feed = h('section', { class: 'm-feed' });
  for (const game of GAMES) {
    const banner = game.src
      ? createMediaElement(game.src, { alt: game.title, className: 'm-game-banner' })
      : null;

    const links = (game.links || []).map((l) =>
      h('a', {
        class: 'm-game-link',
        attrs: { href: l.url, target: '_blank', rel: 'noopener noreferrer' },
      }, [
        h('span', { unsafeHtml: ICONS[l.icon] || ICONS.website }),
        h('span', { text: l.label }),
      ])
    );

    const card = h('article', { class: 'm-game-card m-fade' }, [
      banner,
      h('div', { class: 'm-game-body' }, [
        h('h2', { text: game.title }),
        game.description ? h('p', { unsafeHtml: applyInline(game.description) }) : null,
        links.length ? h('div', { class: 'm-game-links' }, links) : null,
      ]),
    ]);
    feed.appendChild(card);
  }
  contentEl.appendChild(feed);
  scheduleFadeStagger(feed);
}


// ---------------------------------------------------------------------------
// Stagger animation — assigns increasing animation-delay to .m-fade kids
// ---------------------------------------------------------------------------
function scheduleFadeStagger(root) {
  if (prefersReducedMotion) return;
  const kids = [...root.querySelectorAll('.m-fade'), ...(root.classList.contains('m-fade') ? [root] : [])];
  kids.forEach((el, i) => {
    el.style.animationDelay = `${Math.min(i * 40, 400)}ms`;
  });
}


// ---------------------------------------------------------------------------
// Focus trap — simple Tab cycle between the first & last focusable elements
// of the sheet. Not a full a11y-tree lockdown, but enough that keyboard
// users can't Tab out to the underlying feed cards while the sheet is open.
// ---------------------------------------------------------------------------
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';

function getFocusable(root) {
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
  );
}


// ---------------------------------------------------------------------------
// Detail sheet
// ---------------------------------------------------------------------------
function openSheet(categoryId, index) {
  if (activeSheet) return; // ignore rapid double-taps while one's open
  const items = CATEGORIES[categoryId] || [];
  const item = items[index];
  if (!item) return;

  const media = h('div', { class: 'm-sheet-media' });
  const info = h('div', { class: 'm-sheet-info' });
  // Inner scroll container is a <section>, not <main> — avoids a duplicate
  // main landmark (the shell's content <main> is still in the a11y tree
  // even when marked inert, in some screen readers).
  const scroll = h('section', { class: 'm-sheet-scroll' }, [media, info]);

  const counter = h('div', { class: 'm-sheet-counter' });
  const prevBtn = h('button', { class: 'm-sheet-btn', text: '‹', attrs: { type: 'button', 'aria-label': 'Previous' } });
  const nextBtn = h('button', { class: 'm-sheet-btn', text: '›', attrs: { type: 'button', 'aria-label': 'Next' } });
  const closeBtn = h('button', { class: 'm-sheet-btn', text: '✕', attrs: { type: 'button', 'aria-label': 'Close' } });

  const nav = h('div', { class: 'm-sheet-nav' }, [
    closeBtn,
    counter,
    h('div', { class: 'm-sheet-arrows' }, [prevBtn, nextBtn]),
  ]);

  const swipeHint = h('div', { class: 'm-swipe-hint', text: '‹ swipe ›' });
  const sheet = h('div', { class: 'm-sheet m-sheet-entering', attrs: { role: 'dialog', 'aria-modal': 'true' } },
                  [nav, scroll, swipeHint]);

  // Hide the underlying shell from AT + tab order while the sheet is open.
  // Without this, `aria-modal="true"` is a lie: keyboard users tab out to
  // the feed cards behind the sheet.
  if (appEl) appEl.setAttribute('inert', '');

  document.body.appendChild(sheet);

  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  activeSheet = {
    el: sheet, categoryId, items, index,
    media, info, counter, prevBtn, nextBtn, closeBtn,
    viewer: null, scroll, prevFocus,
  };

  closeBtn.addEventListener('click', closeSheet);
  prevBtn.addEventListener('click', () => navigateSheet(-1));
  nextBtn.addEventListener('click', () => navigateSheet(1));

  // Swipe gestures on the media area (not on the info text so the user can
  // still select text if they want). Feels like a native photo viewer.
  attachSwipe(media, {
    onHorizontal: (dx) => navigateSheet(dx < 0 ? 1 : -1),
  });

  // Global escape + arrow keys + Tab trap
  const onKey = (e) => {
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'ArrowLeft')  { navigateSheet(-1); return; }
    if (e.key === 'ArrowRight') { navigateSheet(1);  return; }
    if (e.key === 'Tab') {
      const focusable = getFocusable(sheet);
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  activeSheet._onKey = onKey;

  // Populate first item
  renderSheetItem(index);

  // Enter animation; move focus to the close button once the sheet is
  // mounted so keyboard users land inside the dialog immediately.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.classList.remove('m-sheet-entering');
      closeBtn.focus();
    });
  });

  // Hint removes itself after its keyframe finishes (CSS animation)
  swipeHint.addEventListener('animationend', () => swipeHint.remove(), { once: true });
}

async function renderSheetItem(index) {
  if (!activeSheet) return;
  const { items, media, info, counter, prevBtn, nextBtn } = activeSheet;
  const item = items[index];
  if (!item) return;

  activeSheet.index = index;
  counter.textContent = `${index + 1} / ${items.length}`;
  prevBtn.disabled = index <= 0;
  nextBtn.disabled = index >= items.length - 1;

  // Teardown any previous splat viewer before swapping media
  if (activeSheet.viewer) {
    destroySplatViewer(activeSheet.viewer);
    activeSheet.viewer = null;
  }

  // Replace media
  media.replaceChildren();
  media.classList.remove('loading');

  if (item.type === 'splat' && item.splat?.file) {
    // Show thumbnail as a placeholder while the splat + Three.js load
    const placeholder = buildMedia(item);
    media.appendChild(placeholder);
    media.classList.add('loading');
    const mySession = ++splatSession;
    try {
      const { SplatViewer } = await loadSplatModule();
      // After any await, bail if the user navigated away or closed the sheet.
      if (!activeSheet || mySession !== splatSession) return;
      const container = h('div', { class: 'splat-viewer-container' });
      media.appendChild(container);
      const url = resolveSplat(item.splat.file);
      if (!url) throw new Error('splat URL unresolved');
      const viewer = new SplatViewer();
      viewer.mount(container, url, {
        cameraPosition: item.splat.camera,
        onLoad: () => {
          if (activeSheet && mySession === splatSession) {
            container.classList.add('loaded');
            media.classList.remove('loading');
          }
        },
        onError: () => {
          if (activeSheet && mySession === splatSession) {
            media.classList.remove('loading');
          }
        },
      });
      // If we raced with a teardown between viewer creation and here,
      // destroy immediately — the session counter already moved on.
      if (!activeSheet || mySession !== splatSession) {
        try { viewer.destroy(); } catch { /* ignore */ }
        return;
      }
      activeSheet.viewer = viewer;
    } catch (err) {
      console.warn('Splat failed to load:', err);
      if (activeSheet && mySession === splatSession) {
        media.classList.remove('loading');
      }
    }
  } else {
    media.appendChild(buildMedia(item));
  }

  // Info panel
  info.replaceChildren();
  if (item.title) info.appendChild(h('h2', { text: item.title }));
  if (item.description) info.appendChild(h('p', { unsafeHtml: applyInline(item.description) }));

  // Gallery strip
  if (Array.isArray(item.gallery) && item.gallery.length > 0) {
    const gallery = h('div', { class: 'm-sheet-gallery' });
    // First thumb = primary media (main shot)
    const all = [item.src, ...item.gallery];
    let activeMediaSrc = item.src;

    const thumbs = all.map((src, i) => {
      const thumbMedia = createMediaElement(src, { alt: '' });
      const t = h('button', {
        class: 'm-gallery-thumb' + (i === 0 ? ' is-active' : ''),
        attrs: { type: 'button', 'aria-label': `Image ${i + 1}` },
      }, [thumbMedia]);
      t.addEventListener('click', () => {
        if (src === activeMediaSrc) return;
        activeMediaSrc = src;
        // If a splat viewer is currently mounted (main item is a splat),
        // tear it down before replacing the media node — otherwise its
        // requestAnimationFrame keeps ticking on a detached canvas.
        if (activeSheet?.viewer) {
          destroySplatViewer(activeSheet.viewer);
          activeSheet.viewer = null;
        }
        // Invalidate any in-flight splat load targeting the main slot.
        splatSession++;
        media.classList.remove('loading');
        // Swap main media — rebuild full variant chain, not just .src
        // (a <picture>'s <source> children would override any .src change).
        const newMedia = createMediaElement(src, { alt: '', lazy: false });
        if (newMedia) {
          media.replaceChildren(newMedia);
        }
        for (const other of thumbs) other.classList.remove('is-active');
        t.classList.add('is-active');
      });
      return t;
    });
    for (const t of thumbs) gallery.appendChild(t);
    info.appendChild(gallery);
  }
}

function navigateSheet(dir) {
  if (!activeSheet) return;
  const { items, index } = activeSheet;
  const next = index + dir;
  if (next < 0 || next >= items.length) return;
  renderSheetItem(next);
}

function closeSheet() {
  if (!activeSheet) return;
  const { el, viewer, _onKey, prevFocus } = activeSheet;
  if (_onKey) document.removeEventListener('keydown', _onKey);

  el.classList.add('m-sheet-exiting');
  activeSheet = null;

  // Defer splat destroy + DOM removal until the exit transition completes
  // so the canvas doesn't pop out mid-slide. Guard against transitionend
  // firing per property + setTimeout fallback racing each other.
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(fallback);
    el.removeEventListener('transitionend', cleanup);
    destroySplatViewer(viewer);
    el.remove();
  };
  el.addEventListener('transitionend', cleanup);
  // Fallback in case transitionend never fires (e.g. reduced motion where
  // transform transition is suppressed but opacity still runs, or no
  // transition properties at all).
  const fallback = setTimeout(cleanup, 400);

  // Re-expose the shell to AT + tab order, restore focus to whatever
  // triggered the open.
  if (appEl) appEl.removeAttribute('inert');
  if (prevFocus && typeof prevFocus.focus === 'function') {
    try { prevFocus.focus(); } catch { /* ignore */ }
  }
}

function destroySplatViewer(viewer) {
  if (!viewer) return;
  try { viewer.destroy(); } catch { /* ignore */ }
}


// ---------------------------------------------------------------------------
// Swipe helper — horizontal-only, ignores vertical scroll gestures
// ---------------------------------------------------------------------------
function attachSwipe(el, { onHorizontal, threshold = 48, offAxis = 0.6 } = {}) {
  let startX = 0, startY = 0, active = false;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; if (!t) return;
    startX = t.clientX; startY = t.clientY; active = true;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!active) return;
    active = false;
    const t = e.changedTouches[0]; if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) < threshold) return;
    if (Math.abs(dy) > Math.abs(dx) * offAxis) return; // vertical intent
    onHorizontal?.(dx);
  }, { passive: true });
  el.addEventListener('touchcancel', () => { active = false; }, { passive: true });
}
