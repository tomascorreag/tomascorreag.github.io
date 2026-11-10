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
import { createParallaxBanner } from './ParallaxBanner.js';
import { createLandingBanner, LANDING_VIEW } from './LandingBanner.js';
import { parseMarkdown, applyInline } from '../utils/markdown.js';
import { openImageLightbox } from '../utils/imageLightbox.js';
import { ICONS } from '../config/icons.js';
import { deviceTier, prefersReducedMotion, getSaveData } from '../config/device.js';
import { attachVideoControls } from './VideoControls.js';
import { createHistorySync } from '../utils/historySync.js';
import { observeScrollReveal } from '../utils/scrollReveal.js';

const reduceMotion = prefersReducedMotion() || deviceTier === 'low';

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
function buildItemMedia(item, { className = '', alt = item.title || '', lazy = true, sizes, video, managed = true } = {}) {
  if (item.type === 'spritesheet' && item.spritesheet) {
    return createSpritesheetElement(item.spritesheet, { className, alt, responsive: true, managed });
  }
  if (item.type === 'parallax' && item.parallax) {
    return createParallaxBanner(item.parallax, { className, alt, lazy, sizes, managed });
  }
  if (item.type === 'landing') {
    return createLandingBanner({ still: item.src, className, alt, lazy, sizes, managed });
  }
  if (item.src) {
    return createMediaElement(item.src, { className, alt, lazy, sizes, video });
  }
  return null;
}

// Card media is at most one slot wide: --slide-w is 50% on desktop, 88% on
// narrow/touch screens (see portfolio-deck.css). Without this the default
// '100vw' fetches and decodes twice the pixels the card can show.
const CARD_SIZES = '(max-width: 820px) 88vw, (hover: none) and (pointer: coarse) 88vw, 50vw';

// Narrowest a card gets when its media is height-limited (short windows).
const MIN_CARD_REM = 20;

// Spritesheet title cards (Páramo): bg band above and below the title, as a
// fraction of the frame height.
const SPRITE_PAD_Y = 0.2;

// The open document's column is capped at 860px (.deck-doc-scroll), so its
// banner and embedded images never render wider than that.
const DOC_SIZES = 'min(860px, 100vw)';
const createDocMedia = (src, opts) => createMediaElement(src, { sizes: DOC_SIZES, ...opts });

// Web Animations the deck owns (the Páramo sprite loop), as opposed to the CSS
// transitions that also show up in getAnimations().
const isScriptAnimation = (a) => !('transitionProperty' in a) && !('animationName' in a);

/**
 * Sizes a media box to the piece's aspect so the card frame hugs it on both
 * axes (no letterbox, no parallax crop). The box fills the height the slot
 * leaves below the card body, unless that would be wider than the slot; then
 * it is slot-wide and its height drops to width / aspect. The card height
 * goes to auto, so the shorter card centres in the slide (align-items).
 * The card never gets narrower than MIN_CARD_REM (or the slot), so very
 * short windows widen the card around the media instead of hugging it.
 * The aspect is stashed in `dataset.ar`, so this is also the per-resize
 * recompute. Space is measured from the slide, not the box's own size, so
 * a previous pass's px can't feed back into the next one.
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

  const px = (v) => parseFloat(v) || 0;
  const ss = getComputedStyle(slide);
  const cs = getComputedStyle(card);
  const bs = getComputedStyle(box);
  // CSS clamps card width to --card-max (a sane cap that keeps the wide pixel-art
  // title banners from sprawling on big screens). But for a stretchable image/video
  // piece that cap can be SMALLER than the height-driven fill width, which pins
  // the card narrow and letterboxes square/tall art top & bottom. Lift the cap for
  // those (applyMediaBox); fixed pixel-art (spritesheet) cards keep it.
  const stretches = !!box.querySelector('img, video');

  // Layout sizes (client/offset) ignore the slide's transform scale.
  const slotW = slide.clientWidth - px(ss.paddingLeft) - px(ss.paddingRight);
  const slotH = slide.clientHeight - px(ss.paddingTop) - px(ss.paddingBottom);
  const cardChrome = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  const cardChromeY = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  const bodyH = card.querySelector('.deck-card-body')?.offsetHeight || 0;
  const boxX = px(bs.borderLeftWidth) + px(bs.borderRightWidth);
  const boxY = px(bs.borderTopWidth) + px(bs.borderBottomWidth);

  let availW = slotW - cardChrome;
  const cardMax = px(cs.getPropertyValue('--card-max'));
  if (!stretches && cardMax) availW = Math.min(availW, cardMax - cardChrome);
  const availH = slotH - cardChromeY - bodyH - px(cs.rowGap);

  // Media area inside the box's own border, fitted to the aspect.
  const innerW = availW - boxX;
  const innerH = availH - boxY;
  // No room (collapsed slot): drop back to the CSS sizing rather than keep
  // px from an older, larger layout.
  if (innerW <= 0 || innerH <= 0) return { box, card, reset: true };

  const mw = Math.floor(Math.min(innerH * ar, innerW));
  const mh = Math.min(Math.round(mw / ar), Math.floor(innerH));
  // Short windows make height-limited media tiny; hugging it would squeeze
  // the title/blurb into a sliver. Keep the card at least a readable column
  // (media stays centred inside it).
  const minCardW = Math.min(slotW, MIN_CARD_REM * px(getComputedStyle(document.documentElement).fontSize));
  const cardW = Math.max(mw + boxX + cardChrome, minCardW);
  return { box, card, w: mw + boxX, h: mh + boxY, cardW, stretches };
}

function applyMediaBox({ box, card, w, h, cardW, stretches, reset }) {
  if (reset) {
    box.style.width = box.style.height = box.style.flex = '';
    card.style.width = card.style.height = card.style.maxWidth = '';
    return;
  }
  // `w` is the border-box width of the MEDIA box; `cardW` is the card's
  // border-box width (media + chrome, or the readable minimum), ≤ the slot.
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  box.style.flex = '0 0 auto'; // explicit height, not the flex-grown one
  card.style.width = `${cardW}px`;
  card.style.height = 'auto';
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
      // Taller than the frame: the sprite element centres the title on its
      // solid bg colour, so this leaves a band of bg above and below it.
      set(w, h * (1 + 2 * SPRITE_PAD_Y));
    }
    return;
  }
  if (item.type === 'parallax') {
    // Layered scene: its aspect is the scene's view, not any one layer image.
    const [w, h] = item.parallax.view;
    set(w, h);
    return;
  }
  if (item.type === 'landing') {
    set(...LANDING_VIEW);
    return;
  }
  if (!mediaEl) return;

  const img = mediaEl.tagName === 'IMG' ? mediaEl : mediaEl.querySelector?.('img');
  const video = mediaEl.tagName === 'VIDEO' ? mediaEl : mediaEl.querySelector?.('video');
  // createMediaElement copies the manifest dimensions into width/height
  // attributes. Using them now means the aspect is known before any bytes
  // arrive, so no load event later forces a re-layout (possibly mid-slide).
  const known = img || video;
  const aw = Number(known?.getAttribute('width'));
  const ah = Number(known?.getAttribute('height'));
  if (aw && ah) {
    set(aw, ah);
    return;
  }
  if (img) {
    if (img.complete && img.naturalWidth) set(img.naturalWidth, img.naturalHeight);
    else img.addEventListener('load', () => set(img.naturalWidth, img.naturalHeight), { once: true });
  } else if (video) {
    if (video.videoWidth) set(video.videoWidth, video.videoHeight);
    else video.addEventListener('loadedmetadata', () => set(video.videoWidth, video.videoHeight), { once: true });
  }
}

/** Make any `.article-reveal` children visible immediately (reduced motion /
 *  low tier, where the deck runs without animation). */
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

  const banner = buildItemMedia(item, { className: 'article-banner', lazy: false, sizes: DOC_SIZES });
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
  // `deckPage` is a deck-only override (e.g. ARBO's design post-mortem section,
  // shown to application reviewers but not on the main site). Falls back to
  // the regular `page`.
  const pageMd = item.deckPage ?? item.page;
  if (pageMd) {
    const body = el('div', { class: 'article-body' });
    body.appendChild(parseMarkdown(pageMd, { createMediaElement: createDocMedia, iconMap: ICONS }));
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

  // Eager: the deck has ~5 cards, and a lazy image only starts loading once
  // its slide slides into view, so it would decode mid-transition.
  // autoplay:false keeps card videos out of the shared offscreen manager, which
  // would play any video that peeks into the viewport (neighbours included).
  // The deck plays only the centred card's media (syncSlideMedia).
  const media = buildItemMedia(item, {
    className: 'deck-card-media-el',
    lazy: false,
    sizes: CARD_SIZES,
    video: { autoplay: false },
    managed: false, // same reason, for the Páramo sprite loop
  });
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
  let docReveal = null;   // scroll-reveal observer for the open doc

  // ── Scaffold ──
  const deck = el('div', { class: `deck${reduceMotion ? ' no-anim' : ''}${isMobile ? ' is-mobile' : ''}` });

  // `crt-effects` gets the deck's copy of the CRT glow/RGB-split rule in
  // portfolio-deck.css (style.css isn't loaded on mobile); it mirrors the
  // terminal/nav rule in style.css.
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
  const backBtn = el('button', {
    class: 'deck-doc-back',
    html: '<span class="deck-cta-arrow">◂</span> back',
    attrs: { type: 'button' },
    on: { click: () => closeDoc() },
  });
  const overlay = el('div', { class: 'deck-doc-overlay', attrs: { 'aria-hidden': 'true' } }, [
    backBtn,
    docContent,
  ]);
  // Closed overlay: out of the tab order and the a11y tree (it only fades
  // visually; its last document stays mounted).
  overlay.inert = true;

  // Screen-reader announcement of the current slide ("2 of 6: Páramo").
  const status = el('p', { class: 'deck-sr-only', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } });

  // Bright scanline that rides the leading edge of the overlay's clip-path
  // wipe (see .deck-doc-wipe in portfolio-deck.css). Sibling of the overlay so the
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

  deck.append(header, viewport, prevBtn, nextBtn, dots, overlay, wipe, status);
  document.body.appendChild(deck);

  // Everything behind the open document. Made inert while it's open so Tab
  // and screen readers stay inside the document.
  const behindDoc = [header, viewport, prevBtn, nextBtn, dots];

  const slideTitle = (i) => page.slides[i]?.item.title || (i === page.slides.length ? 'End of selection' : '');

  // The viewport is overflow:hidden, but focusing an element inside it can
  // still scroll it, which would offset every slide from the translateX math.
  viewport.addEventListener('scroll', () => {
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  });

  // ── Navigation ──
  // Set the `transform` declaration directly (with the index baked in) so the
  // track's `transition: transform` reliably fires on every change. The CSS
  // `calc()` still keeps slide `index` centred while neighbours peek at the
  // edges; `var(--slide-w)` stays a var so the responsive width is honoured.
  let announce = false; // set after mount: the first slide isn't announced
  function goTo(next) {
    const prevIndex = index;
    index = Math.max(0, Math.min(total - 1, next));
    track.style.transform =
      `translateX(calc(${-index} * var(--slide-w) + (100% - var(--slide-w)) * 0.5))`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;
    dotEls.forEach((d, i) => {
      d.classList.toggle('active', i === index);
      if (i === index) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
    // Keyboard focus follows the slide when it was on the old card, so it
    // never sits on a card that's now off to the side.
    const focusWasOnSlide = slideEls[prevIndex]?.contains(document.activeElement);
    slideEls.forEach((s, i) => {
      const on = i === index;
      s.classList.toggle('is-active', on);
      // Side slides stay clickable (a click slides to them) but leave the tab
      // order and the a11y tree. Not `inert`: that would block the click too.
      s.querySelectorAll('.deck-card, a').forEach((f) => { f.tabIndex = on ? 0 : -1; });
    });
    // Move focus before hiding the old slide (focus inside aria-hidden is invalid).
    if (focusWasOnSlide && prevIndex !== index) {
      slideEls[index].querySelector('.deck-card, a')?.focus({ preventScroll: true });
    }
    slideEls.forEach((s, i) => {
      if (i === index) s.removeAttribute('aria-hidden');
      else s.setAttribute('aria-hidden', 'true');
    });
    if (announce) status.textContent = `${index + 1} of ${total}: ${slideTitle(index)}`;
    syncSlideMedia();
  }

  // Only the centred card's media plays. Card videos and sprite loops are
  // built outside the shared media manager (it would play anything that peeks
  // into view), so the deck is their only owner. Others pause right away. The
  // centred video starts once the slide has settled, because starting playback
  // (first decode, first GPU upload) during the slide drops frames: on a cold
  // GPU cache, measured in Chrome, it froze one transition for ~200 ms. Sprite
  // loops are cheap to resume, so they start immediately.
  const SLIDE_MS = 560; // keep in sync with .deck-track / .deck-slide transitions
  const saveData = getSaveData();
  let playTimer = null;
  const spriteAnims = (s) =>
    s.querySelector('.deck-card-media')?.getAnimations({ subtree: true }).filter(isScriptAnimation) ?? [];

  function syncSlideMedia({ immediate = false } = {}) {
    clearTimeout(playTimer);
    playTimer = null;
    const visible = !docOpen && !document.hidden;
    let current = null;
    slideEls.forEach((s, i) => {
      const on = i === index && visible;
      for (const a of spriteAnims(s)) {
        if (on && a.playState === 'paused') a.play();
        else if (!on && a.playState === 'running') a.pause();
      }
      for (const v of s.querySelectorAll('video')) {
        if (i === index) current = v;
        else if (!v.paused) v.pause();
      }
    });
    // Data saver: no autoplay (createMediaElement's rule).
    if (!current || saveData || !visible) return;
    const start = () => { if (current.paused) current.play().catch(() => {}); };
    if (immediate || reduceMotion) start();
    else playTimer = setTimeout(start, SLIDE_MS);
  }

  function pauseSlideMedia() {
    clearTimeout(playTimer);
    playTimer = null;
    track.querySelectorAll('video').forEach((v) => v.pause());
    for (const s of slideEls) for (const a of spriteAnims(s)) a.pause();
  }

  const onVisibility = () => {
    if (document.hidden) pauseSlideMedia();
    else syncSlideMedia({ immediate: true });
  };
  document.addEventListener('visibilitychange', onVisibility);

  // A card click means one of two things: tapping the already-centred card
  // opens its document; tapping a half-visible neighbour just slides to it.
  function activate(i) {
    if (i === index) openDoc(i);
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

  // ── Documents + browser history ──
  // An open document is `#<id>` (historySync.js): opening one adds a history
  // entry, so Back / swipe-back closes it instead of leaving the deck, and
  // `?p=<slug>#<id>` links straight to one project.
  const slideIndexOf = (id) => (id ? page.slides.findIndex((s) => s.item.id === id) : -1);
  const parseDocRoute = () => {
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* malformed */ }
    return slideIndexOf(id) >= 0 ? { section: null, id } : null;
  };
  const docRouteUrl = (route) =>
    window.location.pathname + window.location.search + (route ? `#${encodeURIComponent(route.id)}` : '');
  let openIndex = -1;
  let urlSync = null; // created after the opening view is up (see bottom)
  const syncUrl = () => urlSync?.sync();

  function openDoc(i) {
    const entry = page.slides[i];
    if (!entry) return;
    openIndex = i;
    docControls?.destroy(); // stale bar from a previously opened doc
    docControls = null;
    docContent.replaceChildren(buildDocument(entry.item));
    // Same scroll reveal as the main site's article pages, replaying both
    // ways. The overlay is the scroll container.
    docReveal?.disconnect();
    docReveal = null;
    if (reduceMotion) revealAll(docContent);
    else docReveal = observeScrollReveal(docContent, overlay);
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
    overlay.inert = false;
    behindDoc.forEach((n) => { n.inert = true; });
    backBtn.focus({ preventScroll: true });
    docOpen = true;
    // The opaque overlay covers the card; Frenesí's doc banner is the same
    // file, so leaving the card playing meant two decodes of one video.
    pauseSlideMedia();
    syncUrl();
  }

  // Back/Forward (or an edited hash) → screen.
  function applyDocRoute(route) {
    const i = slideIndexOf(route?.id);
    if (i < 0) {
      if (docOpen) closeDoc();
      return;
    }
    if (docOpen && openIndex === i) return;
    if (i !== index) goTo(i);
    openDoc(i);
  }

  function closeDoc() {
    if (!docOpen) return;
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
    behindDoc.forEach((n) => { n.inert = false; });
    // Return focus to the card the document came from (it's the centred one).
    slideEls[index]?.querySelector('.deck-card, a')?.focus({ preventScroll: true });
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    docOpen = false;
    openIndex = -1;
    syncSlideMedia({ immediate: true });
    syncUrl();
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
  let swipeX = null, swipeY = 0;
  function onPointerDown(e) {
    if (docOpen || e.pointerType === 'mouse') return; // mouse uses arrows/dots
    swipeX = e.clientX; swipeY = e.clientY;
  }
  function onPointerUp(e) {
    if (swipeX == null) return;
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    swipeX = null;
    if (Math.abs(dx) <= 50) return;
    // Off-axis guard (same ratio as mobile attachSwipe). touch-action: pan-y
    // makes the browser claim most vertical drags via pointercancel, but a
    // diagonal it doesn't claim shouldn't flip cards either.
    if (Math.abs(dy) > Math.abs(dx) * 0.6) return;
    goTo(index + (dx < 0 ? 1 : -1));
  }
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', () => { swipeX = null; });

  // Deep link (`#<id>`): land on that slide with its document already open,
  // without playing the slide or wipe animations on page load.
  const linked = slideIndexOf(parseDocRoute()?.id);
  if (linked >= 0) {
    deck.classList.add('no-anim');
    goTo(linked);
    openDoc(linked);
    clearTimeout(wipeTimer);
    wipe.classList.remove('lit');
    void deck.offsetWidth; // commit the no-transition state before re-enabling
    if (!reduceMotion) deck.classList.remove('no-anim');
  } else {
    goTo(0);
  }
  announce = true;
  // After the opening view: a linked document is the baseline, so its entry
  // is rewritten on close rather than going back out of the deck.
  urlSync = createHistorySync({
    currentRoute: () => (docOpen ? { section: null, id: page.slides[openIndex].item.id } : null),
    applyRoute: applyDocRoute,
    parse: parseDocRoute,
    format: docRouteUrl,
  });

  // Now that the cards are laid out, size each media box to its piece so the
  // frame hugs (at build time the slides had no size).
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

  // Two passes, one frame apart: the first pass's width change can re-wrap a
  // card title, which changes the body height the second pass measures.
  // rAF-throttled rather than debounced: iOS fires resize streams while the
  // address bar collapses, and a debounce left the old px overflowing the new
  // size until it fired. At most one settle is queued at a time.
  let settleRaf = 0;
  let destroyed = false;
  const settle = () => {
    if (settleRaf || destroyed) return;
    settleRaf = requestAnimationFrame(() => {
      relayout();
      settleRaf = requestAnimationFrame(() => {
        settleRaf = 0;
        relayout();
      });
    });
  };
  relayout();
  settle();

  // The viewport box covers window resizes and header re-wraps (font swap,
  // user text scaling). Card body text can re-wrap from a font swap without
  // the viewport changing, so font loads settle too.
  const ro = new ResizeObserver(settle);
  ro.observe(viewport);
  document.fonts?.ready.then(settle);
  document.fonts?.addEventListener('loadingdone', settle);

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(settleRaf);
      ro.disconnect();
      document.fonts?.removeEventListener('loadingdone', settle);
      clearTimeout(wipeTimer);
      pauseSlideMedia();
      docControls?.destroy();
      document.removeEventListener('visibilitychange', onVisibility);
      urlSync?.dispose();
      docReveal?.disconnect();
      window.removeEventListener('keydown', onKey);
      deck.remove();
    },
  };
}
