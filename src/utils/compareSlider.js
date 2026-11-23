/* ────────────────────────────────────────────────────────────────────────
 * Before/after comparison slider. A draggable vertical line over a media box:
 * left of the line shows `before` (the source image), right of it the host's
 * own media (the painted render).
 *
 * The host's media stays untouched as the base layer. A frame matching that
 * media's layout box holds `before` (same object-fit, clipped with
 * clip-path: inset(0 calc(100% - pos) 0 0)), the line and the labels, so a
 * render pair at identical framing lines up pixel for pixel even when the
 * host is bigger than its media. Position lives in one CSS variable
 * (--compare-pos) on the host; a ResizeObserver keeps the frame on the media.
 *
 * Only the handle takes pointer input; clicks elsewhere on the media keep
 * their existing behaviour (fullscreen toggle, zoom-out). The handle stops
 * its pointer/click events so a drag never doubles as one of those clicks.
 * ──────────────────────────────────────────────────────────────────────── */

const KEY_STEP = 0.05;
const LOUPE_PX = 220;      // lens diameter cap (CSS px)
const LOUPE_HANDLE_GAP = 6; // cursor this close to the line shows no lens (the handle's grab zone)

/**
 * @param {HTMLElement} host - Positioned box whose media fills it.
 * @param {HTMLElement} beforeMedia - <img>/<picture> of the "before" image.
 * @param {{ start?: number, labels?: [string, string], loupe?: { zoom: number, src?: string } }} [opts]
 *   loupe: mouse-hover magnifier over the right-hand ("after") side. `src` is
 *   a higher-resolution copy of the base image at the same framing; without
 *   it the lens magnifies the base image's own pixels.
 * @returns {{ destroy(): void }}
 */
export function mountCompareSlider(host, beforeMedia, { start = 0.5, labels = ['source', 'painted'], loupe = null } = {}) {
  // The host's own media (read before anything is added). Hosts can be larger
  // than it (the mobile sheet's media box has a min-height), so everything
  // lives in a frame sized to this element's layout box.
  const base = host.querySelector('img, video');
  host.classList.add('has-compare');

  const frame = document.createElement('div');
  frame.className = 'compare-frame';

  const layer = document.createElement('div');
  layer.className = 'compare-before';
  layer.setAttribute('aria-hidden', 'true');
  layer.appendChild(beforeMedia);
  // Same fill as the base, and immune to host rules aimed at the base
  // (e.g. the sheet's height:auto / max-height on every img).
  const beforeImg = beforeMedia.tagName === 'IMG' ? beforeMedia : beforeMedia.querySelector('img');
  if (beforeImg) {
    Object.assign(beforeImg.style, { width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none' });
    if (base) beforeImg.style.objectFit = getComputedStyle(base).objectFit;
  }

  // offsetLeft/Top/Width/Height are layout values, so the FLIP and hover
  // transforms on the base don't skew the frame.
  const place = () => {
    let x = 0, y = 0, el = base;
    while (el && el !== host) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    if (!base || el !== host) {
      Object.assign(frame.style, { left: '0', top: '0', width: '100%', height: '100%' });
      return;
    }
    Object.assign(frame.style, {
      left: `${x}px`, top: `${y}px`, width: `${base.offsetWidth}px`, height: `${base.offsetHeight}px`,
    });
  };
  const ro = new ResizeObserver(place);
  ro.observe(host);
  if (base) ro.observe(base);

  const [leftLabel, rightLabel] = labels.map((text, i) => {
    const s = document.createElement('span');
    s.className = `compare-label compare-label--${i ? 'right' : 'left'}`;
    s.textContent = text;
    s.setAttribute('aria-hidden', 'true');
    return s;
  });

  const handle = document.createElement('div');
  handle.className = 'compare-handle';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', `Compare ${labels[0]} and ${labels[1]} images`);
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '100');
  const knob = document.createElement('span');
  knob.className = 'compare-knob';
  knob.textContent = '<>';
  handle.appendChild(knob);

  let pos = start;
  const set = (p) => {
    pos = Math.min(1, Math.max(0, p));
    host.style.setProperty('--compare-pos', `${pos * 100}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(pos * 100)));
  };
  set(start);

  const fromClientX = (x) => {
    const r = frame.getBoundingClientRect();
    if (r.width) set((x - r.left) / r.width);
  };

  let dragging = false;
  const onDown = (e) => {
    e.stopPropagation();
    e.preventDefault(); // no text/image drag, no focus-scroll on touch
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    fromClientX(e.clientX);
  };
  const onMove = (e) => { if (dragging) fromClientX(e.clientX); };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
  };
  const stop = (e) => e.stopPropagation();
  const onKey = (e) => {
    let next = null;
    if (e.key === 'ArrowLeft') next = pos - KEY_STEP;
    else if (e.key === 'ArrowRight') next = pos + KEY_STEP;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // the host views use arrows for navigation
    set(next);
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
  handle.addEventListener('click', stop);
  handle.addEventListener('keydown', onKey);

  frame.append(layer, leftLabel, rightLabel);
  const lens = loupe && base?.tagName === 'IMG' ? mountLoupe() : null;
  frame.append(handle);
  host.appendChild(frame);
  place();

  /*
   * Loupe: a circle following the mouse over the "after" side, showing the
   * image at `zoom` x its on-screen size. It's a background-image div, so the
   * high-res copy is fetched once, on first hover, and the browser's own
   * scaling does the magnification. Coordinates are in the base image's
   * content box (object-fit: contain inside the frame), so a high-res copy at
   * the same framing lines up with whatever is under the cursor.
   */
  function mountLoupe() {
    const el = document.createElement('div');
    el.className = 'compare-loupe';
    el.setAttribute('aria-hidden', 'true');
    let url = base.currentSrc || base.src;
    el.style.backgroundImage = `url("${url}")`;
    let hiresRequested = !loupe.src;
    const requestHires = () => {
      hiresRequested = true;
      const img = new Image();
      img.onload = () => { url = loupe.src; el.style.backgroundImage = `url("${url}")`; };
      img.src = loupe.src;
    };

    // The cursor would sit in the middle of the lens; hide it page-wide, since
    // the element under the mouse is often a backdrop, not the host.
    const root = document.documentElement;
    const hide = () => { el.classList.remove('on'); root.classList.remove('loupe-on'); };
    const onMove = (e) => {
      if (e.pointerType !== 'mouse' || dragging || !base.naturalWidth) return hide();
      const fr = frame.getBoundingClientRect();
      const nw = base.naturalWidth, nh = base.naturalHeight;
      const s = Math.min(fr.width / nw, fr.height / nh);
      const cw = nw * s, ch = nh * s;
      const ox = (fr.width - cw) / 2, oy = (fr.height - ch) / 2;
      const fx = e.clientX - fr.left, fy = e.clientY - fr.top;   // frame space
      const px = fx - ox, py = fy - oy;                          // content space
      const lineX = pos * fr.width;
      if (px < 0 || py < 0 || px > cw || py > ch || fx < lineX + LOUPE_HANDLE_GAP) return hide();
      if (!hiresRequested) requestHires();
      const size = Math.min(LOUPE_PX, fr.width * 0.4, fr.height * 0.4);
      const z = loupe.zoom;
      // Cut the lens off at the line: it only ever shows the "after" side.
      const cut = Math.max(0, lineX + 1 - (fx - size / 2));
      Object.assign(el.style, {
        clipPath: cut ? `inset(-12px -12px -12px ${cut}px)` : '',
        width: `${size}px`,
        height: `${size}px`,
        // `translate`, not `transform`: CSS animates `scale` for the grow /
        // shrink, and translate applies after scale, so it scales about the
        // lens centre wherever the lens is.
        translate: `${fx - size / 2}px ${fy - size / 2}px`,
        backgroundSize: `${cw * z}px ${ch * z}px`,
        backgroundPosition: `${size / 2 - px * z}px ${size / 2 - py * z}px`,
      });
      el.classList.add('on');
      root.classList.add('loupe-on');
    };
    // Document-level: the desktop zoom overlay is pointer-events: none (the
    // backdrop under it takes the clicks), so the host never sees the mouse.
    // onMove's bounds check stands in for pointerleave.
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', hide);
    handle.addEventListener('pointerdown', hide);
    frame.append(el);
    return {
      destroy() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerleave', hide);
        hide();
      },
    };
  }

  return {
    destroy() {
      lens?.destroy();
      ro.disconnect();
      frame.remove();
      host.classList.remove('has-compare');
      host.style.removeProperty('--compare-pos');
    },
  };
}
