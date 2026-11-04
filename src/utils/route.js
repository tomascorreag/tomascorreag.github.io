/**
 * Hash routes for the main site (desktop + mobile; `?p=` decks route
 * themselves in PortfolioDeck.js).
 *
 *   #general  #games  #3d-tech  #3d-art     a section
 *   #3d-art/ardo  #games/arbo               a project inside its section
 *
 * A route is `{ section, id }`: `section` is the CATEGORIES/nav label
 * ('3D Art'), `id` a content.js item id or null. Push/replace/Back behaviour
 * lives in historySync.js.
 */

import { CATEGORIES, GAMES } from '../config/content.js';
import { createHistorySync } from './historySync.js';

const SECTIONS = ['General', 'Games', '3D Tech', '3D Art'];

const slugOf = (section) => section.toLowerCase().replace(/\s+/g, '-');
const SECTION_BY_SLUG = new Map(SECTIONS.map((s) => [slugOf(s), s]));

/** Items a section can open, in display order. General has none. */
function sectionItems(section) {
  if (section === 'Games') return GAMES;
  return section === 'General' ? [] : (CATEGORIES[section] ?? []);
}

/** Index of item `id` in its section, or -1. */
export function findItemIndex(section, id) {
  return id ? sectionItems(section).findIndex((item) => item.id === id) : -1;
}

/** Parses `location.hash`. Unknown section → null; unknown id → section only. */
export function parseRoute(hash = window.location.hash) {
  let raw;
  try { raw = decodeURIComponent(hash.replace(/^#/, '')); } catch { return null; }
  const [slug, id, ...rest] = raw.split('/');
  const section = SECTION_BY_SLUG.get(slug?.toLowerCase());
  if (!section || rest.length) return null;
  return { section, id: findItemIndex(section, id) >= 0 ? id : null };
}

function routeUrl(route) {
  const base = window.location.pathname + window.location.search;
  if (!route) return base;
  const id = route.id ? `/${encodeURIComponent(route.id)}` : '';
  return `${base}#${slugOf(route.section)}${id}`;
}

/** URL sync for the main site. Returns `sync()`; see historySync.js. */
export function createUrlSync({ currentRoute, applyRoute }) {
  return createHistorySync({ currentRoute, applyRoute, parse: () => parseRoute(), format: routeUrl }).sync;
}
