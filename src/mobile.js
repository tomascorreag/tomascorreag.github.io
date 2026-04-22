/**
 * Mobile entry — a completely separate app from src/main.js.
 *
 * Boots when window.innerWidth is mobile-sized (see src/main.js dispatch).
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
  resolveThumbnail,
  resolveSplat,
} from './config/content.js';

// ---------------------------------------------------------------------------
// Contact icon SVGs — duplicated from desktop main.js (same markup). Kept
// local so mobile.js has no runtime dependency on main.js.
// ---------------------------------------------------------------------------
const ICONS = {
  linkedin: `<svg viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
  github: `<svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
  discord: `<svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
  email: `<svg viewBox="0 0 24 24"><path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z"/><path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z"/></svg>`,
  steam: `<svg viewBox="0 0 24 24"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.523-4.524 4.523h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.624 0 11.998-5.375 11.998-12S18.603 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/></svg>`,
  website: `<svg viewBox="0 0 24 24"><path d="M21.721 12.752a9.711 9.711 0 00-.945-5.003 12.754 12.754 0 01-4.339 2.708 18.991 18.991 0 01-.214 4.772 17.165 17.165 0 005.498-2.477zM14.634 15.55a17.324 17.324 0 00.332-4.647c-.952.227-1.945.347-2.966.347-1.021 0-2.014-.12-2.966-.347a17.515 17.515 0 00.332 4.647 17.385 17.385 0 005.268 0zM9.772 17.119a18.963 18.963 0 004.456 0A17.182 17.182 0 0112 21.724a17.18 17.18 0 01-2.228-4.605zM7.777 15.23a18.87 18.87 0 01-.214-4.772 12.753 12.753 0 01-4.34-2.708 9.711 9.711 0 00-.944 5.004 17.165 17.165 0 005.498 2.477zM21.356 14.752a9.765 9.765 0 01-7.478 6.817 18.64 18.64 0 001.988-4.718 18.627 18.627 0 005.49-2.098zM2.644 14.752c1.682.971 3.53 1.688 5.49 2.099a18.64 18.64 0 001.988 4.718 9.765 9.765 0 01-7.478-6.816zM13.878 2.43a9.755 9.755 0 016.116 3.986 11.267 11.267 0 01-3.746 2.504 18.63 18.63 0 00-2.37-6.49zM12 2.276a17.152 17.152 0 012.805 7.121c-.897.23-1.837.353-2.805.353-.968 0-1.908-.122-2.805-.353A17.151 17.151 0 0112 2.276zM10.122 2.43a18.629 18.629 0 00-2.37 6.49 11.266 11.266 0 01-3.746-2.504 9.754 9.754 0 016.116-3.985z"/></svg>`,
};


// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isVideoSrc = (src) => typeof src === 'string' && /\.(mp4|webm)$/i.test(src);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Create element with optional className/attrs/children. Tiny hyperscript. */
function h(tag, opts = {}, children = []) {
  const el = document.createElement(tag);
  if (opts.class) el.className = opts.class;
  if (opts.text != null) el.textContent = opts.text;
  if (opts.html != null) el.innerHTML = opts.html;
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
let activeSheet = null;  // { el, category, index, items, viewer, swipe }


// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
export async function boot() {
  document.documentElement.classList.add('mobile-mode');
  // Remove <main id="terminal"> etc. — desktop CSS hides them, but we also
  // want to stop any autoplay videos that may have been mounted by a
  // mis-loaded desktop script. In practice main.js isn't imported on mobile.

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
// Typing is driven by CSS `steps()` animation on each line's body span
// (see .m-intro-terminal .line-*.typing .body in mobile.css). Building the
// full text into the DOM upfront avoids every async pitfall the earlier
// JS-driven approach had — the browser handles frame-by-frame rendering
// and there's no way line 1 can be "skipped" by a stray pointerdown.
// JS here only:
//   1. Builds the DOM with both lines of text already in place.
//   2. Toggles the `.typing` class on each line to trigger the CSS animation.
//   3. Reveals the rabbit + tap hint once typing has finished.
//   4. Waits for the dismiss tap and fades the intro out.
// ---------------------------------------------------------------------------

// Timing must stay in sync with the keyframes in mobile.css.
// Line 1: 620ms reveal, Line 2: 760ms reveal. Dwells keep the eye from rushing.
const INTRO_LINE1_MS = 620;
const INTRO_LINE2_MS = 760;
const INTRO_DWELL_BETWEEN = 360;
const INTRO_DWELL_AFTER = 420;

function buildIntroLine(text, lineClass) {
  return h('p', { class: `line ${lineClass}` }, [
    h('span', { class: 'prompt', text: '>' }),
    h('span', { class: 'body', text }),
    h('span', { class: 'cursor', text: '▮' }),
  ]);
}

async function runIntro() {
  const line1 = buildIntroLine("Hi, I'm Tomás.",    'line-1');
  const line2 = buildIntroLine('Technical Artist.', 'line-2');
  const terminal = h('div', { class: 'm-intro-terminal' }, [line1, line2]);

  const rabbitWrap = h('div', { class: 'm-intro-rabbit' }, [
    h('span', { class: 'm-rabbit-sprite', attrs: { 'aria-hidden': 'true' } }),
    h('p', { class: 'm-tap-hint', text: 'tap to enter' }),
  ]);

  const intro = h('div', { class: 'm-intro' }, [terminal, rabbitWrap]);
  appEl.appendChild(intro);

  if (prefersReducedMotion) {
    // Skip every animation — show everything at once.
    line1.classList.add('typing');
    line2.classList.add('typing');
    rabbitWrap.classList.add('revealed');
  } else {
    // Double rAF: commit the initial (width: 0) state to the GPU before
    // adding the class that kicks off the animation. Without this, some
    // browsers coalesce the two DOM mutations and skip straight to the
    // final frame — which would look identical to "text appears instantly".
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    line1.classList.add('typing');

    await sleep(INTRO_LINE1_MS + INTRO_DWELL_BETWEEN);
    // Line 1 is done — drop its cursor so only the currently-typing line has one
    line1.querySelector('.cursor')?.remove();
    line2.classList.add('typing');

    await sleep(INTRO_LINE2_MS + INTRO_DWELL_AFTER);
    rabbitWrap.classList.add('revealed');
  }

  // Wait for a tap to dismiss. Short grace period prevents a stray
  // queued page-load pointerdown from immediately closing the intro.
  await new Promise((resolve) => {
    const onTap = () => {
      intro.removeEventListener('pointerdown', onTap);
      resolve();
    };
    setTimeout(() => intro.addEventListener('pointerdown', onTap, { once: true }), 180);
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
      h('span', { text: GENERAL_CONTENT.name.toLowerCase() }),
    ]),
    h('span', { class: 'm-header-role', text: GENERAL_CONTENT.title }),
  ]);

  contentEl = h('main', { class: 'm-content', attrs: { role: 'main' } });

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
        h('span', { html: ICONS[c.platform] || '' }),
        h('span', { class: 'value', text: c.copyText }),
        h('span', { class: 'label', text: 'tap to copy' }),
      ]);
      const onCopy = async () => {
        try { await navigator.clipboard.writeText(c.copyText); } catch { /* ignore */ }
        row.classList.add('copied');
        const label = row.querySelector('.label');
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
        h('span', { html: ICONS[c.platform] || '' }),
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
    item.description ? h('p', { class: 'm-card-desc', text: item.description }) : null,
  ]);

  // Use a <button> so keyboard activation + role semantics come free
  const card = h('button', { class: 'm-card m-fade', attrs: { type: 'button' } }, [mediaWrap, body]);
  return card;
}

/** Builds an <img> or <video> element appropriate for the item. */
function buildMedia(item, { inCard = false } = {}) {
  const thumbUrl = resolveThumbnail(item.src);
  if (!thumbUrl) return h('div', { style: { aspectRatio: '4 / 3', background: '#060806' } });

  if (isVideoSrc(item.src)) {
    const v = h('video', {
      attrs: {
        src: thumbUrl,
        autoplay: 'true',
        loop: 'true',
        muted: 'true',
        playsinline: 'true',
        preload: inCard ? 'metadata' : 'auto',
      },
    });
    v.muted = true;           // iOS needs the property, not just the attr
    v.playsInline = true;
    return v;
  }

  return h('img', {
    attrs: {
      src: thumbUrl,
      alt: item.alt || item.title || '',
      loading: 'lazy',
      decoding: 'async',
    },
  });
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
      ? h('img', {
          class: 'm-game-banner',
          attrs: {
            src: resolveThumbnail(game.src) || '',
            alt: game.title,
            loading: 'lazy',
            decoding: 'async',
          },
        })
      : null;

    const links = (game.links || []).map((l) =>
      h('a', {
        class: 'm-game-link',
        attrs: { href: l.url, target: '_blank', rel: 'noopener noreferrer' },
      }, [
        h('span', { html: ICONS[l.icon] || ICONS.website }),
        h('span', { text: l.label }),
      ])
    );

    const card = h('article', { class: 'm-game-card m-fade' }, [
      banner,
      h('div', { class: 'm-game-body' }, [
        h('h2', { text: game.title }),
        game.description ? h('p', { text: game.description }) : null,
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
// Detail sheet
// ---------------------------------------------------------------------------
function openSheet(categoryId, index) {
  if (activeSheet) return; // ignore rapid double-taps while one's open
  const items = CATEGORIES[categoryId] || [];
  const item = items[index];
  if (!item) return;

  const media = h('div', { class: 'm-sheet-media' });
  const info = h('div', { class: 'm-sheet-info' });
  const scroll = h('main', { class: 'm-sheet-scroll' }, [media, info]);

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

  document.body.appendChild(sheet);

  activeSheet = {
    el: sheet, categoryId, items, index,
    media, info, counter, prevBtn, nextBtn, closeBtn,
    viewer: null, scroll,
  };

  closeBtn.addEventListener('click', closeSheet);
  prevBtn.addEventListener('click', () => navigateSheet(-1));
  nextBtn.addEventListener('click', () => navigateSheet(1));

  // Swipe gestures on the media area (not on the info text so the user can
  // still select text if they want). Feels like a native photo viewer.
  attachSwipe(media, {
    onHorizontal: (dx) => navigateSheet(dx < 0 ? 1 : -1),
  });

  // Global escape + back-button-ish (history entry)
  const onKey = (e) => {
    if (e.key === 'Escape') closeSheet();
    else if (e.key === 'ArrowLeft') navigateSheet(-1);
    else if (e.key === 'ArrowRight') navigateSheet(1);
  };
  document.addEventListener('keydown', onKey);
  activeSheet._onKey = onKey;

  // Populate first item
  renderSheetItem(index);

  // Enter animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.classList.remove('m-sheet-entering'));
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
    const sessionId = ++activeSheet._splatSession || (activeSheet._splatSession = 1);
    try {
      const { SplatViewer } = await loadSplatModule();
      if (!activeSheet || activeSheet.index !== index) return; // user navigated away
      const container = h('div', { class: 'splat-viewer-container' });
      media.appendChild(container);
      const url = resolveSplat(item.splat.file);
      if (!url) throw new Error('splat URL unresolved');
      const viewer = new SplatViewer();
      viewer.mount(container, url, {
        cameraPosition: item.splat.camera,
        onLoad: () => {
          if (activeSheet?.index === index) {
            container.classList.add('loaded');
            media.classList.remove('loading');
          }
        },
        onError: () => media.classList.remove('loading'),
      });
      activeSheet.viewer = viewer;
    } catch (err) {
      console.warn('Splat failed to load:', err);
      media.classList.remove('loading');
    }
  } else {
    media.appendChild(buildMedia(item));
  }

  // Info panel
  info.replaceChildren();
  if (item.title) info.appendChild(h('h2', { text: item.title }));
  if (item.description) info.appendChild(h('p', { text: item.description }));

  // Gallery strip
  if (Array.isArray(item.gallery) && item.gallery.length > 0) {
    const gallery = h('div', { class: 'm-sheet-gallery' });
    // First thumb = primary media (main shot)
    const all = [item.src, ...item.gallery];
    let activeMediaSrc = item.src;

    const thumbs = all.map((src, i) => {
      const url = resolveThumbnail(src);
      const t = h('button', {
        class: 'm-gallery-thumb' + (i === 0 ? ' is-active' : ''),
        attrs: { type: 'button', 'aria-label': `Image ${i + 1}` },
      }, [
        url ? h('img', { attrs: { src: url, alt: '', loading: 'lazy', decoding: 'async' } }) : null,
      ]);
      t.addEventListener('click', () => {
        if (src === activeMediaSrc) return;
        activeMediaSrc = src;
        // Swap main media — fade-in new image
        const newMedia = url ? h('img', { attrs: { src: url, alt: '', decoding: 'async' } }) : null;
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
  const { el, viewer, _onKey } = activeSheet;
  if (_onKey) document.removeEventListener('keydown', _onKey);

  destroySplatViewer(viewer);
  el.classList.add('m-sheet-exiting');
  activeSheet = null;

  const cleanup = () => el.remove();
  el.addEventListener('transitionend', cleanup, { once: true });
  // Fallback in case transitionend never fires (e.g. reduced motion)
  setTimeout(cleanup, 400);
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
