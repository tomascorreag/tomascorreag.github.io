/* ────────────────────────────────────────────────────────────────────────
 * Helpers shared by the two zoom views (desktop detail fullscreen in
 * desktop.js, the image lightbox used by the deck and the mobile sheet) for
 * figures that belong to a :::gallery strip or carry a comparison image.
 * ──────────────────────────────────────────────────────────────────────── */

import { createMediaElement } from './media.js';
import { mountCompareSlider } from './compareSlider.js';
import { resolveThumbnail } from '../config/content.js';

/**
 * The gallery strip `mediaEl` sits in: its slides, the index of this one, and
 * `row`, the media's position in a stacked slide (0 = top). Null when the
 * media isn't in a gallery (or the gallery has one slide).
 */
export function galleryOf(mediaEl) {
  const track = mediaEl?.closest('.article-gallery-track');
  if (!track) return null;
  const slides = [...track.querySelectorAll('.article-gallery-slide')];
  const slide = mediaEl.closest('.article-gallery-slide');
  const index = slides.indexOf(slide);
  const row = Math.max(0, [...slide.querySelectorAll('.article-figure')].indexOf(mediaEl.closest('.article-figure')));
  return slides.length > 1 && index >= 0 ? { track, slides, index, row } : null;
}

/**
 * The zoomable media in slide `i` at the gallery's row (stepping from a
 * close-up lands on the next close-up), or its last row if it has fewer.
 */
export function slideMedia(gallery, i) {
  const figs = gallery.slides[i]?.querySelectorAll('.article-figure');
  if (!figs?.length) return null;
  return figs[Math.min(gallery.row, figs.length - 1)].querySelector('img, video');
}

/**
 * Scrolls the strip so slide `i` is centred, instantly, so the zoom view can
 * measure the slide's on-page rect straight after (the close animation flies
 * back to wherever it is).
 */
export function revealSlide(gallery, i) {
  const { track, slides } = gallery;
  const slide = slides[i];
  if (!slide) return;
  const tr = track.getBoundingClientRect();
  const sr = slide.getBoundingClientRect();
  track.scrollTo({ left: track.scrollLeft + (sr.left - tr.left) - (tr.width - sr.width) / 2, behavior: 'instant' });
}

const LOUPE_ZOOM = 4;

/**
 * Mounts the comparison slider on `host` when the media's figure (or the
 * explicit `compareSrc`) names a "before" image. Returns its handle or null.
 * `loupe`: adds a 4x hover magnifier over the "after" side, but only when a
 * `<name>_hires.webp` sits next to the media's own image (`ownSrc`, else the
 * figure's data-src): a higher-resolution render at the same framing. Images
 * without one get no magnifier; magnifying their own pixels just blurs.
 */
export function mountMediaCompare(host, mediaEl, compareSrc = null, { loupe: withLoupe = false, ownSrc = null } = {}) {
  const fig = mediaEl?.closest('.article-figure');
  const src = compareSrc ?? fig?.dataset.compare;
  if (!src) return null;
  const before = createMediaElement(src, { alt: '', lazy: false });
  if (!before) return null;
  let loupe = null;
  const own = ownSrc ?? fig?.dataset.src;
  if (withLoupe && own) {
    const hires = resolveThumbnail(own.replace(/\.[^.]+$/, '_hires.webp'), { quiet: true });
    if (hires) loupe = { zoom: LOUPE_ZOOM, src: hires };
  }
  return mountCompareSlider(host, before, { loupe });
}

/**
 * Prev/next buttons for stepping through a gallery while zoomed. The caller
 * places `prev`/`next`; `onStep(dir)` runs on click.
 * @returns {{ prev: HTMLButtonElement, next: HTMLButtonElement, update(i, n): void, destroy(): void }}
 */
export function createZoomArrows(onStep, className = '') {
  const make = (dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `zoom-nav-btn zoom-nav-btn--${dir < 0 ? 'prev' : 'next'} ${className}`.trim();
    b.setAttribute('aria-label', dir < 0 ? 'Previous image' : 'Next image');
    b.textContent = dir < 0 ? '<' : '>';
    // Zoom views close on any click that reaches their backdrop/overlay.
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); onStep(dir); });
    return b;
  };
  const prev = make(-1);
  const next = make(1);
  return {
    prev,
    next,
    update(i, n) { prev.disabled = i <= 0; next.disabled = i >= n - 1; },
    destroy() { prev.remove(); next.remove(); },
  };
}
