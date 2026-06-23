/* ────────────────────────────────────────────────────────────────────────
 * Image lightbox — click an image, it FLIP-zooms to fill the screen; click
 * the backdrop / the image / Escape to animate back.
 *
 * Standalone and view-agnostic: it positions a `fixed` overlay relative to the
 * viewport, so it works inside any scroll container (the desktop detail view has
 * its own scroll-space variant in desktop.js; this one is used by the portfolio
 * deck, which scrolls its own overlay). "FLIP" = First/Last/Invert/Play: snapshot
 * the image's current rect, drop a copy there, then transition it to the target
 * rect — the browser tweens the gap. Same idea as a tween between two transforms.
 * ──────────────────────────────────────────────────────────────────────── */

const MARGIN = 24;        // gap (px) between the zoomed image and the viewport edge
const ANIM_MS = 300;      // keep in sync with .img-lightbox-overlay transition (CSS)

// Only one lightbox at a time. Also lets the Escape handler know it's the owner
// of the key press (so it can stop the event before a host view's own Escape).
let activeClose = null;

/** AR-preserved rect that fills the viewport minus a uniform margin. */
function containRect(ar, vw, vh) {
  const cw = vw - MARGIN * 2;
  const ch = vh - MARGIN * 2;
  let w, h;
  if (cw / ch > ar) { h = ch; w = h * ar; } else { w = cw; h = w / ar; }
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/**
 * Opens the lightbox for `imgEl` (the rendered <img> in the document).
 * No-op if a lightbox is already open or the image has no measurable size.
 */
export function openImageLightbox(imgEl) {
  if (activeClose) return;

  const from = imgEl.getBoundingClientRect();
  if (!from.width || !from.height) return;

  const ar = from.width / from.height;
  const to = containRect(ar, window.innerWidth, window.innerHeight);

  const backdrop = document.createElement('div');
  backdrop.className = 'img-lightbox-backdrop';

  const overlay = document.createElement('div');
  overlay.className = 'img-lightbox-overlay';
  overlay.style.left = `${from.left}px`;
  overlay.style.top = `${from.top}px`;
  overlay.style.width = `${from.width}px`;
  overlay.style.height = `${from.height}px`;

  const img = document.createElement('img');
  // currentSrc = the variant the browser actually picked for a <picture>
  // (avif/webp); falls back to .src for a bare <img>. Avoids a refetch.
  img.src = imgEl.currentSrc || imgEl.src;
  img.alt = imgEl.alt || '';
  img.decoding = 'async';
  overlay.appendChild(img);

  document.body.appendChild(backdrop);
  document.body.appendChild(overlay);

  // FLIP: commit the "from" rect, then animate to the "to" rect. The backdrop
  // starts transparent (CSS) and fades in over the same reflow.
  void overlay.offsetWidth;
  backdrop.style.opacity = '1';
  overlay.style.left = `${to.x}px`;
  overlay.style.top = `${to.y}px`;
  overlay.style.width = `${to.w}px`;
  overlay.style.height = `${to.h}px`;

  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    activeClose = null;
    document.removeEventListener('keydown', onKey, true);

    // Re-read the source rect at close time so the reverse FLIP lands on the
    // image even if the page scrolled while the lightbox was open.
    const back = imgEl.getBoundingClientRect();
    backdrop.style.opacity = '0';
    overlay.style.left = `${back.left}px`;
    overlay.style.top = `${back.top}px`;
    overlay.style.width = `${back.width}px`;
    overlay.style.height = `${back.height}px`;

    const cleanup = () => {
      overlay.removeEventListener('transitionend', cleanup);
      overlay.remove();
      backdrop.remove();
    };
    overlay.addEventListener('transitionend', cleanup);
    setTimeout(cleanup, ANIM_MS + 50); // fallback if transitionend never fires
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Pre-empt any host-view Escape handler (e.g. the deck's close-doc) so the
    // first Escape only dismisses the lightbox.
    e.stopPropagation();
    e.preventDefault();
    close();
  }

  backdrop.addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true); // capture phase → runs first

  activeClose = close;
}
