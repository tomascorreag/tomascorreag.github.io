/**
 * The Memory of the Land banner scene (loaded on demand by LandingBanner.js).
 *
 * A mock of MapColombia's Landing.svelte. It is laid out as the landing would
 * be at a virtual viewport with the SLOT's aspect ratio, at least 1500×750
 * (wider slot → wider viewport, taller slot → taller one), then scaled to the
 * slot with one transform. So a slot of any shape gets the landing's own
 * response to that shape instead of a crop: the title and the two archive
 * blocks never fall off the edges. Past MIN/MAX_ASPECT the frame stops
 * adapting and cover-crops the rest.
 *
 * The canvas effects are the landing's own code, vendored unmodified in
 * src/vendor/memory-of-the-land/ (read landingEffects.ts's header).
 *
 * Same data rule as the landing: every mark here is synthetic (seeded noise,
 * wounds scattered uniformly inside the country). Nothing is labelled or
 * scaled as a quantity, so the banner claims nothing the landing doesn't.
 *
 * Interaction (desktop shell with a mouse), measured against the banner:
 *   - Each flank field ignites with cursor proximity to its anchor.
 *   - The map overlay shows the archive of the side of the seam the cursor is
 *     on, strongest at the map box and fading out at the banner's edge.
 * Mobile shell, touch, or no mouse event yet: no interaction; the archives
 * take turns on the map.
 * Left out on purpose: the ENTER links and the language toggle (the whole
 * banner is one click target), the entrance choreography, and the
 * fade-to-black navigation.
 *
 * Clock: an empty Web Animation on the root, like ParallaxBanner. Whoever
 * pauses it (offscreen manager, portfolio deck slide sync) freezes the scene.
 * Rendering is capped by utils/frameGate.js: 120 fps, lite 30 fps (lite's
 * flanks alternate, so 15 fps each).
 */

import { COLOMBIA_VIEWBOX, COLOMBIA_PATH } from '../vendor/memory-of-the-land/colombiaOutline.ts';
import { createScarField, createEmberField } from '../vendor/memory-of-the-land/landingEffects.ts';
import { smoothstep } from '../vendor/memory-of-the-land/noise.ts';
import { registerManagedAnimation } from '../utils/media.js';
import { pointer, layoutEpoch, RECT_TTL } from '../utils/pointer.js';
import { createFrameGate, FPS_FULL, FPS_LITE } from '../utils/frameGate.js';
import { isMobileDevice } from '../config/device.js';
import { LANDING_VIEW } from './LandingBanner.js';

// Smallest virtual viewport. At ≥1500 px wide every clamp() in the landing's
// type sits at its max, so the type sizes in landing-banner.css are constants.
const [BASE_W, BASE_H] = LANDING_VIEW;
// Aspect range the frame adapts to; beyond it, the slot cover-crops.
const MIN_ASPECT = 0.75;
const MAX_ASPECT = 4;

const [, , VB_W, VB_H] = COLOMBIA_VIEWBOX.split(/\s+/).map(Number);

// [landing] Landing.svelte values, quoted.
const MAP_HEAT = 0.5;
const FIELD_ANCHOR = [[0.07, 0.3], [0.93, 0.3]];
const NEAR_FRAC = 0.05;
const PROX_GAMMA = 2;
const SEAM_GAP_PX = 28;

// [banner] No-interaction mode: each archive holds the map this long, and its
// flank warms to AUTO_IGNITE meanwhile.
const AUTO_HOLD_S = 7;
const AUTO_IGNITE = 0.3;
// [banner] Field resolution, as a fraction of the virtual viewport. The
// fields size their marks in their own CSS px, so 1 keeps the landing's
// composition. Small slots use less: chunkier marks, fewer cells per frame.
const FIELD_SCALE_FULL = 1;
const FIELD_SCALE_NARROW = 0.6; // slot under NARROW_PX wide
const FIELD_SCALE_LITE = 0.5;
// Lite flanks go coarser still: at thumbnail size their detail is invisible,
// and this is 1/16 of the full-res cells (~9k per flank instead of ~140k).
const FLANK_SCALE_LITE = 0.25;
const NARROW_PX = 600;
// Field rebuilds (geometry + rasterised scars) are not cheap: debounced.
const REBUILD_MS = 150;

const TEXT = {
  eyebrow: 'Colombia · two archives of loss',
  title: 'The Memory of the Land',
  sub: 'Two cartographic archives: human and ecological violence.',
  halves: [
    { file: 'File 01 · 1958–2026', title: 'Scars of Violence', desc: 'The armed conflict, case by case' },
    { file: 'File 02 · 2001–2025', title: 'Ashes of Death', desc: 'Where and when the trees came down' },
  ],
  sources: 'CNMH/SIEVCAC · CEDE · Hansen/UMD · IDEAM · DANE',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${COLOMBIA_VIEWBOX}' preserveAspectRatio='none'><path d='${COLOMBIA_PATH}'/></svg>`
)}")`;

// Point-in-country test in viewBox units (seeds the map scar wounds).
let hitPath = null;
let hitCtx = null;
function insideCountry(u, v) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  if (!hitCtx) {
    hitPath = new Path2D(COLOMBIA_PATH);
    hitCtx = document.createElement('canvas').getContext('2d');
  }
  return !!(hitCtx && hitCtx.isPointInPath(hitPath, u * VB_W, v * VB_H));
}

// The shine animates a custom property; it only interpolates once registered.
let shineRegistered = false;
function registerShineAngle() {
  if (shineRegistered) return;
  shineRegistered = true;
  try {
    CSS.registerProperty({ name: '--lb-shine-a', syntax: '<angle>', inherits: false, initialValue: '0deg' });
  } catch { /* already registered, or unsupported: the shine just holds still */ }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function svg(cls, paths) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', `lb-sil ${cls}`);
  s.setAttribute('viewBox', COLOMBIA_VIEWBOX);
  s.setAttribute('focusable', 'false');
  const out = paths.map((pc) => {
    const p = document.createElementNS(SVG_NS, 'path');
    if (pc) p.setAttribute('class', pc);
    p.setAttribute('d', COLOMBIA_PATH);
    s.appendChild(p);
    return p;
  });
  return [s, out];
}

const px = (n) => `${+n.toFixed(2)}px`;

/** The landing's geometry at a virtual viewport of W×H (its vw/dvh rules). */
function geometry(W, H) {
  const mapH = Math.min(0.86 * H, 0.92 * W);
  const mapW = mapH * (VB_W / VB_H);
  return {
    W, H,
    halfW: W / 2,
    padX: 0.06 * W,
    padB: 0.09 * H,
    mastTop: 0.08 * H,
    mapW, mapH,
    mapL: (W - mapW) / 2,
    mapT: (H - mapH) / 2,
  };
}

export function mountLandingScene(root, { lite = false, managed = true } = {}) {
  if (root.dataset.lbMounted) return;
  root.dataset.lbMounted = '1';

  /* ── DOM ── */
  const frame = el('div', 'lb-frame');
  frame.setAttribute('aria-hidden', 'true');

  const halves = [];
  const contents = [];
  const flankCanvases = [];
  TEXT.halves.forEach((t, i) => {
    const half = el('div', `lb-half ${i === 0 ? 'lb-violence' : 'lb-ashes'}`);
    const c = el('canvas', 'lb-fx');
    half.appendChild(c);
    flankCanvases.push(c);
    const content = el('div', 'lb-content');
    content.append(el('span', 'lb-file lb-mono', t.file), el('div', 'lb-h2', t.title), el('div', 'lb-desc', t.desc));
    half.appendChild(content);
    frame.appendChild(half);
    halves.push(half);
    contents.push(content);
  });

  const seam = el('div', 'lb-seam');
  frame.appendChild(seam);

  const map = el('div', 'lb-map');
  map.style.setProperty('--lb-map-mask', MAP_MASK);
  const [fillSvg] = svg('lb-fill', [null]);
  const mapScar = el('canvas', 'lb-mapfx lb-scars');
  const mapEmber = el('canvas', 'lb-mapfx lb-embers');
  const [lineSvg, [edge]] = svg('lb-line', ['lb-edge']);
  const [shineSvg] = svg('lb-shine', ['lb-halo', 'lb-core']);
  map.append(fillSvg, mapScar, mapEmber, lineSvg, shineSvg);
  frame.appendChild(map);

  const masthead = el('div', 'lb-masthead');
  masthead.append(el('span', 'lb-eyebrow lb-mono', TEXT.eyebrow), el('div', 'lb-h1', TEXT.title), el('div', 'lb-sub', TEXT.sub));
  frame.appendChild(masthead);

  const footer = el('div', 'lb-footer lb-mono');
  footer.append(el('span', 'lb-gold', 'Sources:'), document.createTextNode(` ${TEXT.sources}`));
  frame.appendChild(footer);

  root.appendChild(frame);

  /* ── Fields ── */
  const flankFields = [
    createScarField(flankCanvases[0], 'left'),
    createEmberField(flankCanvases[1], 'right'),
  ];
  // Lite: the flanks take turns, one per rendered frame (15 fps each at the
  // 30 fps cap), each catching up on the time it sat out. Their rest motion
  // is slow enough that the lower rate doesn't show at thumbnail size.
  const flankDt = [0, 0];
  let flankTurn = 0;
  const mapFields = [
    createScarField(mapScar, 'left', { fill: true, inside: insideCountry }),
    createEmberField(mapEmber, 'right', { fill: true }),
  ];

  /* ── Animations: clock + outline breathe + shine orbit ── */
  registerShineAngle();
  const clock = root.animate([], { duration: 1000, iterations: Infinity });
  const anims = [
    clock,
    edge.animate([{ strokeOpacity: 0.55 }, { strokeOpacity: 0.85 }], {
      duration: 6000, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out',
    }),
    // 26.67 s per lap, as on the landing
    shineSvg.animate([{ '--lb-shine-a': '0deg' }, { '--lb-shine-a': '360deg' }], {
      duration: 26670, iterations: Infinity, easing: 'linear',
    }),
  ];
  if (managed) registerManagedAnimation(root, anims);

  /* ── Layout ── */
  let G = geometry(BASE_W, BASE_H);
  let layoutKey = '';
  let fieldKey = '';
  let rebuildT = 0;
  let fontsReady = false;

  function applyLayout(g) {
    frame.style.width = px(g.W);
    frame.style.height = px(g.H);
    halves.forEach((h, i) => {
      h.style.left = px(i * g.halfW);
      h.style.width = px(g.halfW);
    });
    for (const c of contents) {
      c.style.width = px(g.halfW);
      c.style.padding = `0 ${px(g.padX)} ${px(g.padB)}`;
    }
    masthead.style.top = px(g.mastTop);
    Object.assign(map.style, { left: px(g.mapL), top: px(g.mapT), width: px(g.mapW), height: px(g.mapH) });
    if (fontsReady) placeSeam();
  }

  // Rebuild the fields for the current geometry, resolution tier and DPR.
  function rebuildFields(s) {
    const key = `${G.W.toFixed(0)}x${G.H.toFixed(0)}@${s}/${window.devicePixelRatio}`;
    if (key === fieldKey) return;
    fieldKey = key;
    const fs = lite ? FLANK_SCALE_LITE : s;
    for (const f of flankFields) f.resize(G.halfW * fs, G.H * fs);
    for (const f of mapFields) f.resize(G.mapW * s, G.mapH * s);
    // settled frame: scars accumulated and cold, embers mid-cool
    for (const f of flankFields) f.render(0, 0);
    // map fields hold their last frame; repaint them if they're showing
    for (let i = 0; i < mapFields.length; i++) if (mapNow[i] > 0.004) mapFields[i].render(0, mapNow[i] * MAP_HEAT);
  }

  function fit({ immediate = false } = {}) {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (!w || !h) return;
    const a = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
    const W = a >= BASE_W / BASE_H ? BASE_H * a : BASE_W;
    const H = W / a;
    const key = `${W.toFixed(1)}x${H.toFixed(1)}`;
    if (key !== layoutKey) {
      layoutKey = key;
      G = geometry(W, H);
      applyLayout(G);
    }
    // cover: exact for in-range aspects, crops the remainder outside them
    const k = Math.max(w / G.W, h / G.H);
    frame.style.transform = `translate(-50%, -50%) scale(${k.toFixed(5)})`;
    rectEpoch = -1;

    const s = lite ? FIELD_SCALE_LITE : w < NARROW_PX ? FIELD_SCALE_NARROW : FIELD_SCALE_FULL;
    clearTimeout(rebuildT);
    if (immediate || !fieldKey) rebuildFields(s);
    else rebuildT = setTimeout(() => rebuildFields(s), REBUILD_MS);
  }

  // Seam stops short of the masthead and the sources line, measured like the
  // landing does. offset* is untransformed layout, i.e. virtual px.
  function placeSeam() {
    const top = masthead.offsetTop + masthead.offsetHeight + SEAM_GAP_PX;
    const bottom = G.H - footer.offsetTop + SEAM_GAP_PX;
    seam.style.top = px(Math.round(top));
    seam.style.bottom = px(Math.round(bottom));
  }

  // Screen geometry for the proximity maths, re-measured after scroll/resize.
  const geo = { left: 0, right: 0, midX: 0, sx: 1, fx: 0, fy: 0 };
  let rectEpoch = -1;
  let rectAt = 0;
  function measure() {
    const now = performance.now();
    if (rectEpoch === layoutEpoch() && now - rectAt < RECT_TTL) return;
    rectEpoch = layoutEpoch();
    rectAt = now;
    const r = root.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    geo.left = r.left;
    geo.right = r.right;
    geo.midX = (r.left + r.right) / 2;
    geo.sx = f.width / G.W;
    geo.fx = f.left;
    geo.fy = f.top;
  }
  const toX = (x) => geo.fx + x * geo.sx;
  const toY = (y) => geo.fy + y * geo.sx;

  /* ── Interaction state (Landing.svelte's, per half / per archive) ── */
  const igniteTarget = [0, 0];
  const igniteNow = [0, 0];
  const igniteVar = ['', ''];
  const mapTarget = [0, 0];
  const mapNow = [0, 0];
  const mapVar = ['', ''];
  const MAP_VARS = ['--lb-fx-v', '--lb-fx-a'];
  // Pointer interaction: desktop shell with a real mouse only. Tablets and
  // phones send compatibility mouse events after taps; those must not count.
  const interactive = !isMobileDevice() && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function retarget(cx, cy) {
    measure();
    const ax = [toX(FIELD_ANCHOR[0][0] * G.halfW), toX(G.halfW + FIELD_ANCHOR[1][0] * G.halfW)];
    const ay = toY(FIELD_ANCHOR[0][1] * G.H);
    const span = Math.max(1, ax[1] - ax[0]);
    for (let i = 0; i < 2; i++) {
      const d = Math.hypot(cx - ax[i], cy - ay) / span;
      igniteTarget[i] = Math.pow(1 - smoothstep(NEAR_FRAC, 1, d), PROX_GAMMA);
    }
    // map: 0 at the banner's edge on that side, 1 at the map box and inside it
    const side = cx < geo.midX ? 0 : 1;
    const mL = toX(G.mapL);
    const mR = toX(G.mapL + G.mapW);
    const mT = toY(G.mapT);
    const mB = toY(G.mapT + G.mapH);
    const d = Math.hypot(Math.max(mL - cx, 0, cx - mR), Math.max(mT - cy, 0, cy - mB));
    const edgeGap = Math.max(1, side === 0 ? mL - geo.left : geo.right - mR);
    const near = smoothstep(0, 1, 1 - Math.min(1, d / edgeGap));
    mapTarget[0] = side === 0 ? near : 0;
    mapTarget[1] = side === 1 ? near : 0;
  }

  function autoTarget(tSec) {
    const side = Math.floor(tSec / AUTO_HOLD_S) % 2;
    for (let i = 0; i < 2; i++) {
      mapTarget[i] = i === side ? 1 : 0;
      igniteTarget[i] = i === side ? AUTO_IGNITE : 0;
    }
  }

  /* ── Loop ── */
  const gate = createFrameGate(lite ? FPS_LITE : FPS_FULL);
  let raf = 0;
  let visible = false;
  let lastClock = null;

  function tick(frameTime) {
    raf = 0;
    if (!visible || !root.isConnected) return;
    raf = requestAnimationFrame(tick);
    // Frame cap: skipped frames leave lastClock alone, so the next rendered
    // frame's dt covers them.
    if (!gate.due(frameTime)) return;
    const now = clock.currentTime ?? 0;
    const running = clock.playState === 'running';
    const dt = lastClock == null ? 0 : Math.min(Math.max(0, (now - lastClock) / 1000), 0.05);
    lastClock = now;
    if (!running || dt === 0) return;

    if (interactive && pointer.active) retarget(pointer.x, pointer.y);
    else autoTarget(now / 1000);

    flankTurn ^= 1;
    for (let i = 0; i < flankFields.length; i++) {
      igniteNow[i] += (igniteTarget[i] - igniteNow[i]) * Math.min(1, dt * 6);
      if (lite) {
        flankDt[i] += dt;
        if (i === flankTurn) {
          flankFields[i].render(Math.min(flankDt[i], 0.1), igniteNow[i]);
          flankDt[i] = 0;
        }
      } else {
        flankFields[i].render(dt, igniteNow[i]);
      }
      // quantised + diffed: igniteNow never quite lands on its target
      const v = igniteNow[i].toFixed(3);
      if (v !== igniteVar[i]) {
        igniteVar[i] = v;
        halves[i].style.setProperty('--lb-ignite', v);
      }
    }
    for (let i = 0; i < mapFields.length; i++) {
      mapNow[i] += (mapTarget[i] - mapNow[i]) * Math.min(1, dt * 4);
      // invisible → not painted at all
      if (mapNow[i] > 0.004) mapFields[i].render(dt, mapNow[i] * MAP_HEAT);
      const v = mapNow[i] < 0.004 ? '0' : mapNow[i].toFixed(3);
      if (v !== mapVar[i]) {
        mapVar[i] = v;
        map.style.setProperty(MAP_VARS[i], v);
      }
    }
  }

  /* ── Observers + teardown ── */
  let attached = false;
  let destroyed = false;
  const ro = new ResizeObserver(() => fit());
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.target.isConnected) {
        if (attached) destroy();
        continue;
      }
      attached = true;
      visible = entry.isIntersecting;
      lastClock = null;
      if (visible && !raf) raf = requestAnimationFrame(tick);
    }
  }, { threshold: 0 });

  // A DPR change (browser zoom, moving to another screen) often doesn't resize
  // the slot, so the ResizeObserver alone would leave the canvases at the old
  // resolution. A resolution query matches one DPR; re-armed after each change.
  let dprMq = null;
  const onDpr = () => {
    if (destroyed) return;
    fit({ immediate: true });
    watchDpr();
  };
  function watchDpr() {
    dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMq.addEventListener('change', onDpr, { once: true });
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    visible = false;
    clearTimeout(rebuildT);
    io.disconnect();
    ro.disconnect();
    dprMq?.removeEventListener('change', onDpr);
    for (const a of anims) a.cancel();
    for (const f of flankFields) f.destroy();
    for (const f of mapFields) f.destroy();
  }

  applyLayout(G);
  fit({ immediate: true });
  ro.observe(root);
  io.observe(root);
  watchDpr();

  // Reveal once the display faces are in (the seam is measured off the type).
  const fonts = document.fonts
    ? Promise.all([
      document.fonts.load('600 52px "MotL Spectral"', TEXT.title),
      document.fonts.load('italic 400 16px "MotL Spectral"', TEXT.sub),
    ]).catch(() => {})
    : Promise.resolve();
  fonts.then(() => {
    fontsReady = true;
    placeSeam();
    root.classList.add('is-live');
  });
}
