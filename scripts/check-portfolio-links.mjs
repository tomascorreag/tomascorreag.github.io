// Fails (exit 1) if any portfolio link that has already been sent out stops
// resolving to a full deck. Run by `npm run build` (so CI won't deploy a broken
// link; the live site stays on the last good build) and by the pre-commit hook.
//
// To add a link here: only after it has been shared. Never remove one.
//
// Loads src/config/portfolio.js through Vite's SSR loader, because content.js
// uses Vite-only imports (JSON without attributes, import.meta.glob) that plain
// Node can't load.

import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// slug → why it is pinned. Every entry was sent to someone outside this repo.
const PINNED = {
  '65f2': 'UCL MA Digital Media: Production application (sent 2026)',
  '65f2v': 'UCL MA Digital Media: Production application (sent 2026)',
  '0c3d': 'OceanX Science Impact Challenge',
};

const errors = [];

// main.js must still route `?p=<slug>` to the deck.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
if (!/URLSearchParams\(window\.location\.search\)\.get\(['"]p['"]\)/.test(main) || !main.includes('mountDeck(')) {
  errors.push('src/main.js no longer routes ?p=<slug> to mountDeck()');
}

const server = await createServer({
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
});
try {
  const { PORTFOLIO_PAGES, PAGE_ALIASES, resolvePage } = await server.ssrLoadModule('/src/config/portfolio.js');
  for (const [slug, why] of Object.entries(PINNED)) {
    const page = resolvePage(slug);
    if (!page) {
      errors.push(`?p=${slug} (${why}) no longer resolves`);
      continue;
    }
    // resolvePage silently skips unknown item ids; a pinned deck must not
    // lose a project that way.
    const expected = PORTFOLIO_PAGES[PAGE_ALIASES[slug] ?? slug].items.length;
    if (page.slides.length !== expected) {
      errors.push(`?p=${slug} (${why}) shows ${page.slides.length}/${expected} projects; an item id is missing from content.js`);
    }
  }
} finally {
  await server.close();
}

if (errors.length) {
  console.error('\nPinned portfolio links are broken:\n  - ' + errors.join('\n  - '));
  console.error('\nThese URLs have been sent out. See the header of src/config/portfolio.js.\n');
  process.exit(1);
}
console.log(`portfolio links ok: ${Object.keys(PINNED).map((s) => '?p=' + s).join(', ')}`);
