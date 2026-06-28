/**
 * PortfolioDeck — a linear, CRT-styled slide deck for URL-gated portfolio pages.
 *
 * Mounted by both the desktop and mobile entries when the URL carries a
 * `?p=<slug>` that matches a page in src/config/portfolio.js. It owns its own
 * full-screen `#deck` container, so it doesn't depend on the terminal/mosaic
 * shell (the mobile entry actually removes those nodes) and it skips the
 * terminal/rabbit intro entirely.
 *
 * Interaction model (per the brief):
 *   · Each slide is a COMPACT card — clear thumbnail + name + short blurb.
 *   · Clicking a card EXPANDS it into the full document (banner + markdown
 *     page), rendered with the exact same `.article-page` styles the Games
 *     detail view uses. A back button / Escape returns to the same card.
 *   · A final "outro" slide invites the visitor to the main site.
 *
 * Why a separate layer above the scanlines: like the main mosaic, the deck
 * sits above `.crt-overlay` (z-index), so thumbnails and document images read
 * CLEAN — the CRT character comes from the glow on text + the vignette, not
 * scanlines smeared over the artwork.
 *
 * Reuse (nothing here is reinvented):
 *   · createMediaElement → <picture>/<video> with the AVIF/WebP/MP4 fallback chain
 *   · parseMarkdown / applyInline → the Games article renderer
 *   · ICONS → shared inline SVGs for link buttons
 *   · resolvePage → slug → ordered { item, kind } slides
 */

import { resolvePage } from '../config/portfolio.js';
// Deck styles ride this chunk: the deck only exists on `/?p=` visits, so its
// ~14KB of CSS has no business in the render-blocking stylesheet every
// visitor downloads. Vite extracts this into the PortfolioDeck chunk's CSS
// and loads it alongside the dynamic import (same pattern as mobile.css).
import '../article.css'; // shared .article-* markdown styles
import './portfolio-deck.css';
import { createMediaElement, createSpritesheetElement } from '../utils/media.js';
import { parseMarkdown, applyInline } from '../utils/markdown.js';
import { openImageLightbox } from '../utils/imageLightbox.js';
import { ICONS } from '../config/icons.js';
import { deviceTier } from '../config/device.js';
import { attachVideoControls } from './VideoControls.js';

// DEV: temporarily forced off to test the carousel animation. Restore to:
//   window.matchMedia('(prefers-reduced-motion: reduce)').matches || deviceTier === 'low';
const reduceMotion = false;

// URL of the normal site = current path minus the `?p=` query. On the user
// site that's just "/", but using pathname keeps it correct under a subpath.
const mainSiteUrl = window.location.pathname || '/';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Tiny element helper (mirrors mobile.js `h`). `html` sets innerHTML and is
 * ONLY ever fed trusted strings (ICONS constants / applyInline output, which
 * escapes text before adding markup) — never raw user/DB data.
 */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) node.addEventListener(k, v);
  for (const child of Array.isArray(children) ? children : [children]) {
    // Skip falsy placeholders from `cond && el(...)` expressions (null, false,
    // 0 from `arr.length &&`, empty string) — only render Nodes / real text.
    if (child == null || child === false || child === 0 || child === '') continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Builds the media element for an item, branching on its kind the same way the
 * main site does: animated `type: 'spritesheet'` games (e.g. Páramo) have no
 * `src` and must use createSpritesheetElement; everything else (image/video
 * thumbnails, splat thumbnails) goes through createMediaElement. Returns null
 * if neither is available, so callers can render a fallback.
 */
function buildItemMedia(item, { className = '', alt = item.title || '', lazy = true } = {}) {
  if (item.type === 'spritesheet' && item.spritesheet) {
    return createSpritesheetElement(item.spritesheet, { className, alt, responsive: true });
  }
  if (item.src) {
    return createMediaElement(item.src, { className, alt, lazy });
  }
  return null;
}

/**
 * Sizes a media box to its image's exact width so the card frame hugs it (no
 * black side-letterbox on narrow pieces). The box height is flex-driven (the
 * "current sizing" we keep); we set an explicit width = height × aspect-ratio.
 * The aspect-ratio is stashed in `dataset.ar`, so this is also the per-resize
 * recompute. No-ops until the box has a laid-out height (post-mount / on load).
 */
// Split into measure (layout reads) + apply (style writes) so relayout() can
// batch all reads before any writes — a width write on slide i invalidates
// layout and forces a full re-layout pass before slide i+1's reads otherwise
// (classic read/write thrash, one forced layout per slide).
function measureMediaBox(box) {
  const ar = parseFloat(box.dataset.ar);
  if (!ar) return null;
  const card = box.closest('.deck-card');
  const slide = box.closest('.deck-slide');
  if (!card || !slide) return null;

  const h = box.clientHeight; // layout height — ignores the slide's transform scale
  if (!h) return null;

  // Width the image WANTS (height × aspect-ratio), capped to the space available
  // in the slot (slot − slide padding − card padding/border). Wide pieces fill
  // the slot exactly as before; only narrower-than-slot pieces hug. We set the
  // card width too (not fit-content) so an oversized media can't blow out the
  // flex item's min-content and overflow the slot.
  const px = (v) => parseFloat(v) || 0;
  const ss = getComputedStyle(slide);
  const cs = getComputedStyle(card);
  const slotInner = slide.clientWidth - px(ss.paddingLeft) - px(ss.paddingRight);
  const cardChrome = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  const avail = slotInner - cardChrome;
  if (avail <= 0) return null;

  const w = Math.min(Math.round(h * ar), Math.floor(avail));
  // CSS clamps card width to --card-max (a sane cap that keeps the wide pixel-art
  // title banners from sprawling on big screens). But for a stretchable image/video
  // piece that cap can be SMALLER than the height-driven fill width `w`, which pins
  // the card narrow and letterboxes square/tall art top & bottom. Lift the cap for
  // those so the card grows to `w` — already ≤ the slot, so it never overflows.
  // Fixed pixel-art (spritesheet) cards keep the cap (Páramo stays as-is).
  const stretches = !!box.querySelector('img, video');
  return { box, card, w, cardChrome, stretches };
}

function applyMediaBox({ box, card, w, cardChrome, stretches }) {
  // `w` is the width the MEDIA box should be. The card is border-box (its width
  // includes padding+border), so to give its *content* a width of `w` we must add
  // the chrome back — otherwise the media box ends up `cardChrome` px narrower than
  // `w` while keeping its full flex height, which letterboxes square/tall art top
  // & bottom. (avail already subtracted cardChrome, so w + cardChrome ≤ slot.)
  box.style.width = `${w}px`;
  card.style.width = `${w + cardChrome}px`;
  card.style.maxWidth = stretches ? 'none' : '';
}

function sizeMediaBox(box) {
  const m = measureMediaBox(box);
  if (m) applyMediaBox(m);
}

/**
 * Records the asset's true proportions on the media box (driving the hug).
 * Spritesheets carry their ratio in config; images/videos report it once their
 * metadata loads, so we set it on load if not already available.
 */
function applyMediaAspect(box, item, mediaEl) {
  const set = (w, h) => {
    if (!w || !h) return;
    box.style.aspectRatio = `${w} / ${h}`;
    box.dataset.ar = w / h;
    sizeMediaBox(box);
  };

  if (item.type === 'spritesheet') {
    const fa = item.spritesheet?.frameAspect;
    if (fa) {
      const [w, h] = fa.split('/').map((n) => parseFloat(n));
      set(w, h);
    }
    return;
  }
  if (!mediaEl) return;

  const img = mediaEl.tagName === 'IMG' ? mediaEl : mediaEl.querySelector?.('img');
  const video = mediaEl.tagName === 'VIDEO' ? mediaEl : mediaEl.querySelector?.('video');
  if (img) {
    if (img.complete && img.naturalWidth) set(img.naturalWidth, img.naturalHeight);
    else img.addEventListener('load', () => set(img.naturalWidth, img.naturalHeight), { once: true });
  } else if (video) {
    if (video.videoWidth) set(video.videoWidth, video.videoHeight);
    else video.addEventListener('loadedmetadata', () => set(video.videoWidth, video.videoHeight), { once: true });
  }
}

/** Make any `.article-reveal` children visible immediately (the deck doesn't
 *  scroll-reveal — content is short and the overlay animates as a whole). */
function revealAll(root) {
  root.querySelectorAll('.article-reveal').forEach((node) => node.classList.add('revealed'));
}

/**
 * Renders an item's `date` (verbatim string from content.js) as a small
 * metadata token. `className` lets the same token serve the compact card and
 * the document head.
 */
function buildDateEl(date, className) {
  return el('span', { class: className, text: date });
}

/** Builds the link-button row used in the document header (games carry links). */
function buildHeaderLinks(links) {
  const wrap = el('div', { class: 'article-header-links' });
  for (const link of links) {
    const icon = ICONS[link.icon] ?? ICONS.website;
    wrap.appendChild(
      el('a', {
        class: 'article-link',
        html: `${icon}<span>${link.label}</span>`,
        attrs: { href: link.url, target: '_blank', rel: 'noopener noreferrer' },
      }),
    );
  }
  return wrap;
}

/**
 * The full document for a project — identical structure to the Games article
 * page: banner, title + links, description, then the markdown body (or a
 * gallery for thumbnail-only pieces). Wrapped in `.article-page` so all the
 * existing CRT-glow/figure styling applies for free.
 */
function buildDocument(item) {
  const page = el('article', { class: 'article-page deck-doc' });

  // ── Header: banner + title-row + description ──
  const header = el('div', { class: 'article-header' });

  const banner = buildItemMedia(item, { className: 'article-banner', lazy: false });
  if (banner) {
    const bannerWrap = el('div', { class: 'article-banner-wrap' }, banner);
    // Pixel-art sprite titles must not get the .article-page CRT blur/filter —
    // mirror the main site's detail view (desktop.js), which clears it too.
    if (item.type === 'spritesheet') bannerWrap.style.filter = 'none';
    header.appendChild(bannerWrap);
  }

  // Title + date sit together on the left (date trails the title as a byline);
  // links, when present, stay pinned right via the row's space-between.
  const titleGroup = el('div', { class: 'article-title-group' }, [
    item.title && el('h1', { class: 'article-title', text: item.title }),
    item.date && buildDateEl(item.date, 'article-dateline'),
  ]);
  const titleRow = el('div', { class: 'article-title-row' }, [
    titleGroup,
    item.links?.length && buildHeaderLinks(item.links),
  ]);
  header.appendChild(titleRow);

  if (item.description) {
    header.appendChild(
      el('p', { class: 'article-description', html: applyInline(item.description) }),
    );
  }
  page.appendChild(header);

  // ── Body: markdown page (with click-to-zoom embedded images) ──
  if (item.page) {
    const body = el('div', { class: 'article-body' });
    body.appendChild(parseMarkdown(item.page, { createMediaElement, iconMap: ICONS }));
    // Embedded images are click-to-zoom, mirroring the desktop detail view.
    // Bind the whole <figure> (floated images wrap text + a caption, so the bare
    // <img> is an unreliable hit target). Video figures have no <img> → skipped.
    body.querySelectorAll('.article-figure').forEach((fig) => {
      const img = fig.querySelector('img');
      if (!img) return;
      fig.classList.add('zoomable');
      fig.addEventListener('click', () => openImageLightbox(img));
    });
    page.appendChild(body);
  }

  revealAll(page);
  return page;
}

/**
 * The compact card shown on a slide. Clicking (or Enter/Space) calls onOpen.
 * The small type label comes from the item's optional `kindLabel` (e.g.
 * 'FILM', 'ARTIFACT'), falling back to GAME/3D by `kind`.
 */
function buildCard(entry, indexLabel, onOpen) {
  const { item, kind } = entry;
  const blurb = item.description || '';

  const media = buildItemMedia(item, { className: 'deck-card-media-el' });
  const mediaBox = el('div', { class: 'deck-card-media' }, media || el('div', { class: 'deck-card-media-fallback' }));
  applyMediaAspect(mediaBox, item, media);

  const card = el(
    'div',
    {
      class: 'deck-card',
      attrs: { role: 'button', tabindex: '0', 'aria-label': `Open ${item.title || 'project'}` },
      on: {
        click: onOpen,
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        },
      },
    },
    [
      mediaBox,
      el('div', { class: 'deck-card-body' }, [
        // Metadata line: kind chip + (optional) date sit together on the left as
        // one cluster — both describe the work; the index, pinned right,
        // describes the slide's slot. A hairline divider encodes that grouping.
        el('div', { class: 'deck-card-meta' }, [
          el('span', { class: 'deck-card-kind', text: item.kindLabel || (kind === 'game' ? 'GAME' : '3D') }),
          item.date && buildDateEl(item.date, 'deck-card-date'),
        ]),
        el('span', { class: 'deck-card-num', text: indexLabel }),
        el('h2', { class: 'deck-card-title crt-effects', text: item.title || 'Untitled' }),
        blurb && el('p', { class: 'deck-card-desc', html: applyInline(blurb) }),
        el('span', { class: 'deck-card-cta', html: 'Open<span class="deck-cta-arrow">▸</span>' }),
      ]),
    ],
  );
  return card;
}

/** The closing call-to-action slide. */
function buildOutroSlide() {
  return el('div', { class: 'deck-slide deck-outro' }, [
    el('div', { class: 'deck-outro-inner' }, [
      el('p', { class: 'deck-outro-kicker', text: 'end of selection' }),
      el('h2', { class: 'deck-outro-title crt-effects', text: 'Want to see more?' }),
      el('a', {
        class: 'deck-outro-btn',
        html: 'Visit the main site<span class="deck-cta-arrow">▸</span>',
        attrs: { href: mainSiteUrl },
      }),
    ]),
  ]);
}

/** Replaces the page with a CRT "not found" panel and a way back. */
function renderNotFound(slug) {
  const panel = el('div', { class: 'deck deck-notfound' }, [
    el('div', { class: 'deck-notfound-inner' }, [
      el('p', { class: 'deck-notfound-line', text: `> portfolio "${slug || ''}" not found` }),
      el('p', { class: 'deck-notfound-sub', text: 'The link may be mistyped or retired.' }),
      el('a', {
        class: 'deck-outro-btn',
        html: 'Go to the main site<span class="deck-cta-arrow">▸</span>',
        attrs: { href: mainSiteUrl },
      }),
    ]),
  ]);
  document.body.appendChild(panel);
  return { destroy: () => panel.remove() };
}

/** Adds a robots:noindex meta tag (kept out of search engines) + sets title. */
function applyHeadMeta(title) {
  // The page title already carries the name ("Tomás Correa — Selected Work"),
  // so use it verbatim rather than re-appending the name.
  if (title) document.title = title;
  let meta = document.querySelector('meta[name="robots"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'robots';
    document.head.appendChild(meta);
  }
  meta.content = 'noindex,nofollow';
}

/**
 * Mounts the deck for `slug`. Returns a `{ destroy }` handle.
 * `opts.isMobile` only tunes minor affordances; layout is CSS-driven.
 */
export function mountDeck(slug, { isMobile = false } = {}) {
  const page = resolvePage(slug);
  applyHeadMeta(page?.title);
  if (!page) return renderNotFound(slug);

  const total = page.slides.length + (page.outro ? 1 : 0);
  let index = 0;
  let docOpen = false;
  let docControls = null; // video control bar handle for the open doc's banner

  // ── Scaffold ──
  const deck = el('div', { class: `deck${reduceMotion ? ' no-anim' : ''}${isMobile ? ' is-mobile' : ''}` });

  // `crt-effects` is the shared site-wide glow/RGB-split rule (style.css) — same
  // treatment the terminal and nav use, not a deck-local copy.
  const header = el('header', { class: 'deck-header' }, [
    el('div', { class: 'deck-header-titles' }, [
      el('h1', { class: 'deck-title crt-effects', text: page.title }),
      page.intro && el('p', { class: 'deck-intro', html: applyInline(page.intro) }),
    ]),
  ]);

  const track = el('div', { class: 'deck-track' });
  const viewport = el('div', { class: 'deck-viewport' }, track);

  const dots = el('div', { class: 'deck-dots' });

  const prevBtn = el('button', {
    class: 'deck-nav deck-nav-prev',
    html: '◀',
    attrs: { type: 'button', 'aria-label': 'Previous' },
    on: { click: () => goTo(index - 1) },
  });
  const nextBtn = el('button', {
    class: 'deck-nav deck-nav-next',
    html: '▶',
    attrs: { type: 'button', 'aria-label': 'Next' },
    on: { click: () => goTo(index + 1) },
  });

  // ── Document overlay (built once, populated on open) ──
  const docContent = el('div', { class: 'deck-doc-scroll' });
  const overlay = el('div', { class: 'deck-doc-overlay', attrs: { 'aria-hidden': 'true' } }, [
    el('button', {
      class: 'deck-doc-back',
      html: '<span class="deck-cta-arrow">◂</span> back',
      attrs: { type: 'button' },
      on: { click: closeDoc },
    }),
    docContent,
  ]);

  // Bright scanline that rides the leading edge of the overlay's clip-path
  // wipe (see .deck-doc-wipe in style.css). Sibling of the overlay so the
  // clip doesn't cut it; toggled in lockstep with the overlay below.
  const wipe = el('div', { class: 'deck-doc-wipe' });

  // ── Build slides ──
  page.slides.forEach((entry, i) => {
    const card = buildCard(entry, `${pad2(i + 1)} / ${pad2(page.slides.length)}`, () => activate(i));
    track.appendChild(el('div', { class: 'deck-slide' }, card));
  });
  if (page.outro) track.appendChild(buildOutroSlide());
  const slideEls = [...track.children];

  // ── Dots ──
  for (let i = 0; i < total; i++) {
    dots.appendChild(
      el('button', {
        class: 'deck-dot',
        attrs: { type: 'button', 'aria-label': `Go to slide ${i + 1}` },
        on: { click: () => goTo(i) },
      }),
    );
  }
  const dotEls = [...dots.children];

  deck.append(header, viewport, prevBtn, nextBtn, dots, overlay, wipe);
  document.body.appendChild(deck);

  // ── Navigation ──
  // Set the `transform` declaration directly (with the index baked in) so the
  // track's `transition: transform` reliably fires on every change. The CSS
  // `calc()` still keeps slide `index` centred while neighbours peek at the
  // edges; `var(--slide-w)` stays a var so the responsive width is honoured.
  function goTo(next) {
    index = Math.max(0, Math.min(total - 1, next));
    track.style.transform =
      `translateX(calc(${-index} * var(--slide-w) + (100% - var(--slide-w)) * 0.5))`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;
    dotEls.forEach((d, i) => d.classList.toggle('active', i === index));
    slideEls.forEach((s, i) => s.classList.toggle('is-active', i === index));
    syncSlideVideos();
  }

  // Only the centred card's video should decode/loop. Fully-offscreen slides
  // are paused by the shared media manager already, but neighbours peek at
  // the viewport edges and count as visible — sync them here. Clearing
  // `autoplay` matters as much as pause(): a video whose data arrives later
  // would otherwise start itself on a non-current slide.
  function syncSlideVideos() {
    slideEls.forEach((s, i) => {
      s.querySelectorAll('video').forEach((v) => {
        if (i === index) {
          v.autoplay = true;
          if (v.paused) v.play().catch(() => {});
        } else {
          v.autoplay = false;
          if (!v.paused) v.pause();
        }
      });
    });
  }

  // A card click means one of two things: tapping the already-centred card
  // opens its document; tapping a half-visible neighbour just slides to it.
  function activate(i) {
    if (i === index) openDoc(page.slides[i]);
    else goTo(i);
  }

  // Light the scanline for the length of the clip-path sweep, then let it
  // fade out (the .lit class only controls opacity; `top` is driven by
  // .at-bottom so the line stays glued to the clip edge either direction).
  const WIPE_MS = 460; // keep in sync with .deck-doc-overlay/.deck-doc-wipe CSS
  let wipeTimer = null;
  function flashWipe() {
    clearTimeout(wipeTimer);
    wipe.classList.add('lit');
    wipeTimer = setTimeout(() => wipe.classList.remove('lit'), WIPE_MS);
  }

  function openDoc(entry) {
    docControls?.destroy(); // stale bar from a previously opened doc
    docControls = null;
    docContent.replaceChildren(buildDocument(entry.item));
    if (entry.item.hasAudio) {
      const wrap = docContent.querySelector('.article-banner-wrap');
      const video = wrap?.querySelector('video');
      if (video) docControls = attachVideoControls(video, wrap, { reveal: 'auto' });
    }
    // The overlay (.deck-doc-overlay) is the scroll container, not docContent —
    // reset it so the previous doc's scroll position doesn't carry over.
    overlay.scrollTop = 0;
    flashWipe();
    wipe.classList.add('at-bottom'); // edge sweeps top → bottom with the clip
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    docOpen = true;
  }

  function closeDoc() {
    // closeDoc only hides the overlay — the doc stays mounted behind it
    // (openDoc rebuilds the content anyway). Stop its videos: an invisible
    // autoplaying loop keeps a decode pipeline alive indefinitely. Clearing
    // autoplay also stops late-arriving data from restarting them.
    docContent.querySelectorAll('video').forEach((v) => {
      v.autoplay = false;
      v.pause();
    });
    docControls?.destroy();
    docControls = null;
    flashWipe();
    wipe.classList.remove('at-bottom'); // edge rides bottom → top — same wipe, reversed
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    docOpen = false;
  }

  // ── Keyboard ──
  function onKey(e) {
    if (docOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeDoc(); }
      return; // let arrows scroll the document
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    else if (e.key === 'End') { e.preventDefault(); goTo(total - 1); }
  }
  window.addEventListener('keydown', onKey);

  // ── Touch / pointer swipe between cards (disabled while a doc is open) ──
  let swipeX = null;
  function onPointerDown(e) {
    if (docOpen || e.pointerType === 'mouse') return; // mouse uses arrows/dots
    swipeX = e.clientX;
  }
  function onPointerUp(e) {
    if (swipeX == null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 50) goTo(index + (dx < 0 ? 1 : -1));
  }
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', () => { swipeX = null; });

  goTo(0);

  // Now that the cards are laid out, size each media box to its image width so
  // the frame hugs (build-time clientHeight was 0). A second pass on the next
  // frame settles any title re-wrap caused by the first pass's width change.
  const relayout = () => {
    // All reads first, then all writes (see measureMediaBox).
    const jobs = [];
    for (const s of slideEls) {
      const box = s.querySelector('.deck-card-media');
      if (!box) continue;
      const m = measureMediaBox(box);
      if (m) jobs.push(m);
    }
    for (const j of jobs) applyMediaBox(j);
  };
  relayout();
  requestAnimationFrame(relayout);

  // Debounced: iOS fires resize streams while the address bar collapses;
  // re-laying-out every slide per event is pure waste — only the settled
  // size matters.
  let relayoutTimer = null;
  const onResize = () => {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(relayout, 120);
  };
  window.addEventListener('resize', onResize);

  return {
    destroy() {
      clearTimeout(wipeTimer);
      clearTimeout(relayoutTimer);
      docControls?.destroy();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      deck.remove();
    },
  };
}
