/**
 * Shared mouse position + layout epoch for the pointer-reactive banners
 * (ParallaxBanner, LandingBanner). One set of window listeners for all of them.
 */

/** Last known mouse position in client px. `active` once any mouse event arrived. */
export const pointer = { x: 0, y: 0, active: false };

// Bumped on any scroll (capture: the site scrolls inner panels, not the
// window) or resize; banners re-measure their rect when it changes.
let epoch = 0;
export const layoutEpoch = () => epoch;

/** Max age of a cached banner rect, for layout shifts that are neither scroll nor resize. */
export const RECT_TTL = 500;

function hookPointer() {
  const bump = () => { epoch++; };
  window.addEventListener('scroll', bump, { passive: true, capture: true });
  window.addEventListener('resize', bump, { passive: true });
  // Any mouse event with a position counts, not only moves: the click that
  // opens a page, and the mouseover browsers send when the page (or content
  // under a still cursor) changes, tell us where the cursor is before it moves.
  const track = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  };
  for (const type of ['pointermove', 'pointerdown', 'mouseover']) {
    window.addEventListener(type, track, { passive: true, capture: true });
  }
  // No reset on mouseleave/blur: scenes hold the last pointer position
  // rather than drifting back to rest when the cursor leaves the window.
}

// Listen from module load, not from the first banner: the cursor position
// often arrives (load-time mouseover, the click that opens a page) before
// any banner exists.
if (typeof window !== 'undefined') hookPointer();
