/**
 * Keeps the URL in step with what's on screen, and the screen in step with
 * Back/Forward. Shared by the main site (src/utils/route.js routes) and the
 * portfolio deck (`?p=<slug>#<id>`).
 *
 * A route is `{ section, id }` (either may be null; `id` = an open project).
 *
 * History policy:
 *   · no project → project: push an entry, so Back closes it
 *   · project → no project, on an entry we pushed: history.back(), so
 *     Back/Forward stay in step with the screen
 *   · anything else (section switch, prev/next between projects, closing a
 *     project that came from a pasted link): rewrite the current entry
 *
 * "We pushed it" is tagged per page load: after a reload, history.state still
 * carries the old tag, but going back to an entry from the previous load is a
 * full page load, not an in-page change. Those entries are treated as not ours.
 */

const LOAD_TAG = Math.random().toString(36).slice(2);
const isOurEntry = () => history.state?.urlSyncItem === LOAD_TAG;

const sameRoute = (a, b) =>
  (a?.section ?? null) === (b?.section ?? null) && (a?.id ?? null) === (b?.id ?? null);

const currentUrl = () => window.location.pathname + window.location.search + window.location.hash;

/**
 * @param {object} o
 * @param {() => object|null} o.currentRoute  route for what's on screen now
 * @param {(route: object|null) => any} o.applyRoute  make the screen match (may be async)
 * @param {() => object|null} o.parse  route from the current URL
 * @param {(route: object|null) => string} o.format  URL for a route
 * @returns {{ sync: () => void, dispose: () => void }}
 *   Call sync() after any state change; it's cheap and idempotent.
 */
export function createHistorySync({ currentRoute, applyRoute, parse, format }) {
  let last = currentRoute();
  let applying = false;    // inside applyRoute: the URL already says where we're going
  let pending = false;     // another popstate arrived while applying
  let backPending = false; // our own history.back(); its popstate isn't the user's

  function sync() {
    if (applying) return;
    const next = currentRoute();
    if (sameRoute(next, last)) return;
    const prev = last;
    last = next;
    // The popstate from our pending back() writes the URL for whatever the
    // route is by then; writing now would hit the entry being left.
    if (backPending) return;

    if (next?.id && !prev?.id) {
      history.pushState({ urlSyncItem: LOAD_TAG }, '', format(next));
    } else if (!next?.id && prev?.id && isOurEntry()) {
      backPending = true;
      history.back();
    } else {
      // Keep the entry's tag: prev/next inside an opened project stays ours,
      // so closing it later still goes back.
      history.replaceState(history.state, '', format(next));
    }
  }

  async function run() {
    applying = true;
    try {
      while (pending) {
        pending = false;
        await applyRoute(parse());
      }
    } catch (err) {
      console.error('Route change failed:', err);
    } finally {
      applying = false;
      // Normalise: an unknown id or a route the screen can't show exactly
      // leaves them slightly apart. Fix the URL, never add an entry.
      last = currentRoute();
      const url = format(last);
      if (url !== currentUrl()) history.replaceState(history.state, '', url);
    }
  }

  function onPopState() {
    if (backPending) {
      backPending = false;
      last = currentRoute();
      history.replaceState(null, '', format(last));
      return;
    }
    pending = true;
    if (!applying) run();
  }
  window.addEventListener('popstate', onPopState);

  return {
    sync,
    dispose: () => window.removeEventListener('popstate', onPopState),
  };
}
