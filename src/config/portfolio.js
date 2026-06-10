/**
 * Portfolio Pages — curated, URL-gated slide decks.
 *
 * Each entry maps a slug to an ordered list of project ids. The deck at
 * `/?p=<slug>` renders those projects as compact cards that expand into full
 * documents (see src/components/PortfolioDeck.js).
 *
 * ── Gating is obscurity, not security ──────────────────────────────────────
 * This is a static GitHub Pages site: ALL content (including every slug and
 * every project's text) ships in the JS bundle. Anyone who opens DevTools can
 * read this file and enumerate the slugs. "Gated" here means UNLISTED (not
 * linked from the main site or nav) + `noindex` (kept out of search engines) —
 * it is NOT access control. Do not put anything genuinely private here.
 *
 * ── How ids resolve ────────────────────────────────────────────────────────
 * `items` holds ids that must match an `id` field on a GAMES entry or any
 * CATEGORIES item in src/config/content.js. resolvePage() builds a one-time
 * id → { item, kind } index over both sources; `kind` is 'game' (banner +
 * links + markdown page) or 'thumb' (mosaic thumbnail + description).
 *
 * To add a page:
 *   1. Make sure each project you want has an `id` in content.js.
 *   2. Add an entry below: a slug key + { title, intro?, items, outro? }.
 *   3. Share `https://tomascorreag.github.io/?p=<slug>`.
 */

import { CATEGORIES, GAMES } from './content.js';

// id → { item, kind }. Built once at module load. GAMES win over CATEGORIES on
// an id collision (shouldn't happen — keep ids globally unique), and a warning
// fires so duplicates are caught in dev.
const INDEX = new Map();

function indexItem(item, kind) {
  if (!item?.id) return;
  if (INDEX.has(item.id)) {
    console.warn(`[portfolio] duplicate item id "${item.id}" — keeping the first`);
    return;
  }
  INDEX.set(item.id, { item, kind });
}

for (const game of GAMES) indexItem(game, 'game');
for (const items of Object.values(CATEGORIES)) {
  for (const item of items) indexItem(item, 'thumb');
}

/**
 * Curated pages. Keys are slugs used in the `?p=<slug>` URL.
 *
 *   title  — heading shown in the deck header + document.title
 *   intro  — (optional) one-line subtitle under the title
 *   items  — ordered project ids (must exist in content.js)
 *   outro  — (optional, default true) append a final "visit the main site" slide
 */
export const PORTFOLIO_PAGES = {
  // UCL MA Digital Media: Production — application portfolio.
  // Shared at: https://tomascorreag.github.io/?p=ucl-digital-media
  'ucl-digital-media': {
    title: 'Tomás Correa — Selected Work',
    intro: 'Curated for the UCL MA Digital Media: Production application\nTap any piece to read more',
    items: ['paramo', 'ardo', 'frenesi'],
    outro: true,
  },
};

/**
 * Resolves a slug to a render-ready page, or null if the slug is unknown or
 * resolves to zero valid items (so callers can show a "not found" state).
 *
 * Unknown ids are skipped with a warning rather than failing the whole page.
 */
export function resolvePage(slug) {
  const page = PORTFOLIO_PAGES[slug];
  if (!page) return null;

  const slides = [];
  for (const id of page.items ?? []) {
    const entry = INDEX.get(id);
    if (!entry) {
      console.warn(`[portfolio] page "${slug}" references unknown item id "${id}" — skipping`);
      continue;
    }
    slides.push(entry);
  }
  if (slides.length === 0) return null;

  return {
    slug,
    title: page.title ?? 'Selected Work',
    intro: page.intro ?? '',
    outro: page.outro !== false,
    slides,
  };
}
