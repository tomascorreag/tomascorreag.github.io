/**
 * Custom CRT scrollbar.
 *
 * Why this exists: a native browser scrollbar is UI chrome painted above its
 * container — it can't be moved below the scanline overlay, and it can't take
 * the frame's CRT filter (blur/RGB-split). This draws a real DOM thumb instead,
 * placed in #crt-screen at z 99 (under .crt-overlay's 100, so scanlines cover
 * it) and in the right gutter outside the scroll container (so it stays
 * draggable). See `.crt-scrollbar` in style.css for the layering rationale.
 *
 * Mental model (game-dev parallel): a UI slider bound to a scroll value. On
 * scroll we read scrollTop and drive the thumb (output); on drag we invert it
 * and write scrollTop (input). rAF-coalesced like batching transform writes to
 * one frame instead of thrashing layout per event.
 */

const MIN_THUMB = 28; // px — keep the thumb grabbable on very long content

export function createCrtScrollbar(scrollEl, parentEl) {
  const bar = document.createElement('div');
  bar.className = 'crt-scrollbar';

  const thumb = document.createElement('div');
  // crt-effects gives it the same blur+brightness pass as the frame.
  thumb.className = 'crt-scrollbar-thumb crt-effects';
  bar.appendChild(thumb);
  parentEl.appendChild(bar);

  let raf = 0;

  function sync() {
    raf = 0;
    const { scrollHeight, clientHeight, scrollTop } = scrollEl;
    const overflow = scrollHeight - clientHeight;
    if (overflow <= 1) {
      bar.classList.remove('visible');
      return;
    }
    bar.classList.add('visible');

    const trackH = bar.clientHeight;
    const thumbH = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * trackH);
    const maxTop = trackH - thumbH;
    const top = maxTop > 0 ? (scrollTop / overflow) * maxTop : 0;

    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${top}px)`;
  }

  function requestSync() {
    if (!raf) raf = requestAnimationFrame(sync);
  }

  // ── Drag-to-scroll ──────────────────────────────────────────────────────
  // Geometry (track rect, thumb height, scroll range) is stable for the
  // duration of a drag, so it's snapshotted once on pointerdown instead of
  // re-read per pointermove — five forced layout reads per event otherwise,
  // interleaved with the scrollTop write. Moves are rAF-coalesced like the
  // scroll→thumb direction above; latest pointer position wins.
  let grabOffset = 0;  // cursor offset within the thumb at grab time
  let dragGeom = null; // { trackTop, maxTop, overflow } while dragging
  let dragRaf = 0;
  let dragY = 0;

  function applyDrag() {
    dragRaf = 0;
    if (!dragGeom) return;
    let top = dragY - dragGeom.trackTop - grabOffset;
    top = Math.max(0, Math.min(dragGeom.maxTop, top));
    scrollEl.scrollTop = (top / dragGeom.maxTop) * dragGeom.overflow;
  }

  function onPointerMove(e) {
    dragY = e.clientY;
    if (!dragRaf) dragRaf = requestAnimationFrame(applyDrag);
  }

  function onPointerUp(e) {
    thumb.releasePointerCapture?.(e.pointerId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    dragGeom = null;
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
  }

  function onPointerDown(e) {
    e.preventDefault();
    const trackTop = bar.getBoundingClientRect().top;
    const maxTop = bar.clientHeight - thumb.offsetHeight;
    if (maxTop <= 0) return;
    dragGeom = {
      trackTop,
      maxTop,
      overflow: scrollEl.scrollHeight - scrollEl.clientHeight,
    };
    grabOffset = e.clientY - thumb.getBoundingClientRect().top;
    thumb.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  thumb.addEventListener('pointerdown', onPointerDown);

  // ── Resync triggers ─────────────────────────────────────────────────────
  scrollEl.addEventListener('scroll', requestSync, { passive: true });

  // Container resize (window/orientation). Content-driven height changes
  // (images decoding, reveals) don't resize the container, so we also catch
  // media `load` (capture — load doesn't bubble) plus a few delayed passes.
  const ro = new ResizeObserver(requestSync);
  ro.observe(scrollEl);
  scrollEl.addEventListener('load', requestSync, true);

  const delayed = [80, 300, 800].map((ms) => setTimeout(requestSync, ms));
  requestSync();

  return {
    update: requestSync,
    destroy() {
      scrollEl.removeEventListener('scroll', requestSync);
      scrollEl.removeEventListener('load', requestSync, true);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      delayed.forEach(clearTimeout);
      if (raf) cancelAnimationFrame(raf);
      if (dragRaf) cancelAnimationFrame(dragRaf);
      bar.remove();
    },
  };
}
