/**
 * ParallaxBanner: a layered, animated banner built from a scene config
 * (see src/config/arboSplash.js for the format and the Unity source).
 *
 * Three motions stack on every layer:
 *   1. Placement: CSS left/top/width/height in percent of the parent layer,
 *      so the scene scales with the banner and needs no resize code.
 *   2. Idle loop: one Web Animation per layer on `transform` (plus `filter`
 *      for brightness keys), t0 → midpoint → t0. Unity's flat-tangent keys are
 *      a smoothstep, which cubic-bezier(1/3, 0, 2/3, 1) reproduces exactly.
 *   3. Pointer parallax: the CSS `translate` property, driven by two custom
 *      properties (--pb-mx, --pb-my in −1..1) on the banner root. `translate`
 *      composes outside `transform`, so it never fights the loop, and nested
 *      layers inherit their parents' shift (that nesting is the depth).
 *
 * Particles are a port of the game's UI_Particle_System (frame-rate
 * dependent intervals are emulated with a fixed 60 Hz step). Each particle
 * group is one canvas placed between the layers it sits between in Unity.
 *
 * The first layer animation doubles as the clock: particles and pointer
 * smoothing only advance while it is running. Whoever pauses the loop (the
 * offscreen media manager, the portfolio deck's slide sync) therefore
 * freezes the whole banner without knowing about particles.
 */

import { createMediaElement, registerManagedAnimation } from '../utils/media.js';
import { dimsFor, resolveThumbnail } from '../config/content.js';
import { deviceTier, prefersReducedMotion } from '../config/device.js';
import './parallax-banner.css';

const SMOOTHSTEP = 'cubic-bezier(0.3333, 0, 0.6667, 1)';
const STEP = 1 / 60;           // Unity ran the particle script once per frame
const MAX_STEPS = 4;           // catch-up cap after a stall
const POINTER_RATE = 5;        // 1/s, exponential approach toward the pointer
const SHINE_RATE = 7;          // 1/s, the logo glint trails the cursor a little
const SHINE_PARK = -0.6;       // glint rest position (wrap widths); off the left edge
// Window left → right maps to these glint positions (in logo widths). The
// stripe is 0.35 wide, so ±0.35 past the edges is fully off the glyphs.
const SHINE_RANGE = [-0.35, 1.35];
const PARTICLE_DPR_CAP = 1.5;  // soft dots: extra resolution buys nothing
const CANVAS_MARGIN = 160;     // canvas px of particle room beyond the view

/* ── Shared pointer + observers (one set for all banners) ───────────────── */

const pointer = { x: 0, y: 0, active: false };
let pointerHooked = false;
// Bumped on any scroll (capture: the site scrolls inner panels, not the
// window) or resize; banners re-measure their rect when it changes.
let layoutEpoch = 0;
const RECT_TTL = 500;

function hookPointer() {
  if (pointerHooked) return;
  pointerHooked = true;
  const bump = () => { layoutEpoch++; };
  window.addEventListener('scroll', bump, { passive: true, capture: true });
  window.addEventListener('resize', bump, { passive: true });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  }, { passive: true });
  // No reset on mouseleave/blur: the scene holds the last pointer position
  // rather than drifting back to centre when the cursor leaves the window.
}

const instances = new WeakMap();
let io = null;
let ro = null;

function observers() {
  if (io) return;
  io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const inst = instances.get(entry.target);
      if (!inst) continue;
      if (entry.target.isConnected) {
        inst.attached = true;
        inst.setVisible(entry.isIntersecting);
      } else if (inst.attached) {
        // Removed from the page (detail closed, list re-rendered).
        inst.destroy();
      }
      // Never attached yet: the first notification can beat the caller's
      // appendChild. Wait for the next one.
    }
  }, { threshold: 0 });
  ro = new ResizeObserver((entries) => {
    for (const entry of entries) instances.get(entry.target)?.resize();
  });
}

/* ── Scene helpers ──────────────────────────────────────────────────────── */

const pct = (n) => `${+n.toFixed(4)}%`;

/** Splits on commas outside parentheses (`min(860px, 100vw)` stays whole). */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/**
 * Scales a `sizes` value by `k`: each entry's length becomes calc(len * k).
 * An entry is "[media-condition] length"; the condition, when present,
 * starts with "(" and the length is the last top-level token.
 */
function scaleSizes(sizes, k) {
  return splitTopLevel(sizes).map((entry) => {
    let cond = '';
    let len = entry;
    if (entry.startsWith('(')) {
      // Last space at paren depth 0 separates condition and length.
      let depth = 0;
      let cut = -1;
      for (let i = 0; i < entry.length; i++) {
        if (entry[i] === '(') depth++;
        else if (entry[i] === ')') depth--;
        else if (entry[i] === ' ' && depth === 0) cut = i;
      }
      if (cut > 0) {
        cond = `${entry.slice(0, cut)} `;
        len = entry.slice(cut + 1);
      }
    }
    return `${cond}calc(${len} * ${+k.toFixed(4)})`;
  }).join(', ');
}

/**
 * CSS drop-shadow glow whose radius is in scene units: 100cqw is the banner
 * width (the root is a size container), so it scales with the banner.
 */
function dropShadow(glow, viewW) {
  // One { radius, color } or a list (stacked: tight core + wide bloom).
  return [].concat(glow).map(({ radius, color }) =>
    `drop-shadow(0 0 calc(100cqw * ${+(radius / viewW).toFixed(5)}) ${color})`).join(' ');
}

/**
 * CSS mask-image value for an optimizer-encoded image (`path` is the .webp
 * name). Prefers the `tier`-px-wide variant and AVIF: masks carry alpha, and
 * the optimizer's WebP alpha is near-lossless, so AVIF is 3–4× smaller
 * (e.g. the fire mask: 85 KB WebP → 17 KB AVIF at 960w). Blurry masks lose
 * nothing at 960w. image-set() lets the browser skip AVIF if it can't
 * decode it; `fallback` is a plain url() for engines without image-set().
 */
function maskSource(path, tier) {
  const base = path.replace(/\.webp$/, '');
  const pick = (ext) =>
    (tier && resolveThumbnail(`${base}-${tier}w.${ext}`, { quiet: true })) ||
    resolveThumbnail(`${base}.${ext}`, { quiet: true });
  const avif = pick('avif');
  const webp = pick('webp');
  if (!webp) return null;
  const fallback = `url("${webp}")`;
  const best = avif
    ? `image-set(url("${avif}") type("image/avif"), url("${webp}") type("image/webp"))`
    : fallback;
  return { best, fallback };
}

/** Sets a (prefixed) mask property, keeping `fallback` if `best` won't parse. */
function setMaskProp(el, prop, { best, fallback }) {
  for (const name of [prop, `-webkit-${prop}`]) {
    el.style.setProperty(name, fallback);
    el.style.setProperty(name, best); // ignored by engines that can't parse it
  }
}

/** Mouse-style input (hover + precise pointer), checked once per banner. */
const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * Masks the shine to the logo images: one mask layer per image, placed and
 * sized in percent of the union rect (ux, uy, uw, uh; node units, y-down).
 * mask-position percentages align the layer's point with the box's same
 * point, so p = offset / (box − layer).
 */
function applyMaskTo(mask, glyphs, ux, uy, uw, uh) {
  const urls = glyphs.map((g) => g.img.currentSrc || g.img.src);
  if (urls.some((u) => !u)) return;
  const posPct = (o, size, box) => (box - size > 1e-6 ? (o / (box - size)) * 100 : 0);
  const set = (prop, value) => {
    mask.style.setProperty(prop, value);
    mask.style.setProperty(`-webkit-${prop}`, value);
  };
  set('mask-image', urls.map((u) => `url("${u}")`).join(', '));
  set('mask-size', glyphs.map((g) => `${pct((g.w / uw) * 100)} ${pct((g.h / uh) * 100)}`).join(', '));
  set('mask-position', glyphs.map((g) =>
    `${pct(posPct(g.x - ux, g.w, uw))} ${pct(posPct(g.y - uy, g.h, uh))}`).join(', '));
  set('mask-repeat', 'no-repeat');
  mask.classList.add('is-masked');
}

/** Places `el` (a w×h rect, centre at pos, y-up) inside a parent rect. */
function place(el, [w, h], [x, y], [pw, ph], parentCy = 0) {
  el.style.left = pct(((pw / 2 + x - w / 2) / pw) * 100);
  el.style.top = pct(((ph / 2 - (y - parentCy) - h / 2) / ph) * 100);
  el.style.width = pct((w / pw) * 100);
  el.style.height = pct((h / ph) * 100);
}

function poseTransform(node, [x, y], rot, scale) {
  const [w, h] = node.size;
  const p0 = node.pos || [0, 0];
  // Delta from the placed (t0) position, in percent of the node's own box.
  const dx = ((x - p0[0]) / w) * 100;
  const dy = (-(y - p0[1]) / h) * 100;
  // Unity z rotation is counter-clockwise; CSS rotate() is clockwise.
  return `translate(${pct(dx)}, ${pct(dy)}) rotate(${-rot}deg) scale(${scale})`;
}

/* ── Unity Mathf.PerlinNoise stand-in (classic 2D gradient noise, 0..1) ── */

const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337; // fixed seed: same field every visit, like Unity's
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return Uint8Array.from([...p, ...p]);
})();

function perlin01(x, y) {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, gx, gy) => ((h & 1) ? -gx : gx) + ((h & 2) ? -gy : gy);
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[PERM[xi] + yi];
  const ab = PERM[PERM[xi] + yi + 1];
  const ba = PERM[PERM[xi + 1] + yi];
  const bb = PERM[PERM[xi + 1] + yi + 1];
  const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
  const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
  const n = x1 + v * (x2 - x1); // ≈ −1..1
  return Math.min(1, Math.max(0, (n + 1) / 2));
}

/* ── Particles ──────────────────────────────────────────────────────────── */

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => t * t * (3 - 2 * t);

/** The prefab's alphaOverLife: ease 0→1 by 25%, hold to 50%, ease 1→0. */
function alphaOverLife(t) {
  if (t < 0.25) return smooth(t / 0.25);
  if (t < 0.5) return 1;
  return 1 - smooth((t - 0.5) / 0.5);
}

/** Soft white dot ("Circle Filled Glow") tinted to the emitter colour. */
function glowSprite([r, g, b]) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Unity stores linear-ish 0–1 colours; the UI shader used them as sRGB.
  const rgb = `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;
  grad.addColorStop(0, `rgba(${rgb}, 1)`);
  grad.addColorStop(0.4, `rgba(${rgb}, 0.85)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return c;
}

class Emitter {
  constructor(cfg, scene) {
    this.cfg = cfg;
    this.noiseScale = scene.particleNoiseScale;
    this.noiseEvery = scene.noiseEveryFrames;
    this.velEvery = scene.velocityEveryFrames;
    // Site-side boost over the Unity values (scene.particleLook).
    this.sizeMul = scene.particleLook?.size ?? 1;
    this.alphaMul = scene.particleLook?.alpha ?? 1;
    this.sprite = glowSprite(cfg.color);
    this.parts = [];
    for (let i = 0; i < cfg.count; i++) {
      const p = { index: i };
      this.reset(p);
      // Unity spawns every particle at once on Start(). A banner that may
      // appear mid-scroll looks better already in flow: hold each particle
      // back by a random part of its first lifetime.
      p.delay = Math.random() * p.life;
      this.parts.push(p);
    }
  }

  reset(p) {
    const c = this.cfg;
    p.size = rand(c.size[0], c.size[1]);
    p.depth = rand(0.1, Math.min(c.maxDepth, 99));
    p.life = rand(c.lifetime[0], c.lifetime[1]);
    p.maxAlpha = rand(c.alpha[0], c.alpha[1]);
    p.vx = rand(c.velMin[0], c.velMax[0]);
    p.vy = rand(c.velMin[1], c.velMax[1]);
    p.age = 0;
    p.nx = 0;
    p.ny = 0;
    p.depthFactor = 1 - Math.min(1, Math.max(0, p.depth / c.maxDepth));
    // Position is relative to the emitter (Unity's Particle_Parent).
    p.x = rand(c.posMin[0], c.posMax[0]);
    p.y = rand(c.posMin[1], c.posMax[1]) + p.depth;
    p.drawSize = p.size * (0.1 + 0.9 * (1 - p.depth / 100));
  }

  /** One Unity frame of UI_ParticleInstance.Update + GetParticleMovement. */
  step(frame) {
    const c = this.cfg;
    for (const p of this.parts) {
      if (p.delay > 0) { p.delay -= STEP; continue; }
      if (p.age >= p.life) { this.reset(p); continue; }
      p.age += STEP;
      if ((frame + p.index) % this.noiseEvery === 0) {
        const sx = p.x * this.noiseScale;
        const sy = p.y * this.noiseScale;
        p.nx = (perlin01(sx, sy) * 2 - 1) * c.noise;
        p.ny = (perlin01(sx + 100, sy + 100) * 2 - 1) * c.noise;
      }
      const fx = (p.vx + p.nx + c.force[0]) * STEP;
      const fy = (p.vy + p.ny + c.force[1]) * STEP;
      p.x += fx * p.depthFactor;
      p.y += fy * p.depthFactor;
      if ((frame + p.index) % this.velEvery === 0) {
        p.vx = p.vx * c.drag + fx;
        p.vy = p.vy * c.drag + fy;
      }
    }
  }

  /** `map(x, y)` → canvas px for a point in the parent layer's space. */
  draw(ctx, map, unit) {
    const [ox, oy] = this.cfg.origin;
    for (const p of this.parts) {
      if (p.delay > 0) continue;
      const a = Math.min(1, p.maxAlpha * this.alphaMul * alphaOverLife(Math.min(1, p.age / p.life)));
      if (a <= 0.003) continue;
      const [cx, cy] = map(ox + p.x, oy + p.y);
      const s = p.drawSize * this.sizeMul * unit;
      ctx.globalAlpha = a;
      ctx.drawImage(this.sprite, cx - s / 2, cy - s / 2, s, s);
    }
  }
}

/* ── Banner ─────────────────────────────────────────────────────────────── */

/**
 * @param {object} scene  scene config (e.g. ARBO_SPLASH)
 * @param {object} opts
 *   className  classes for the root (banner slot styling: aspect, bg)
 *   alt        accessible label for the whole banner
 *   sizes      `sizes` of the banner slot; each layer scales it by its share
 *   lazy       lazy-load layer images (default true)
 *   managed    register with the shared offscreen manager (default true).
 *              Pass false when the caller plays/pauses the loop itself
 *              (portfolio deck) — it finds the animations via getAnimations.
 *   lite       skip particles, light effects and shine (small slots). Also
 *              forced on for low-tier devices.
 */
export function createParallaxBanner(scene, opts = {}) {
  const { className = '', alt = '', sizes = '100vw', lazy = true, managed = true } = opts;
  const reduced = prefersReducedMotion();
  // Lite: layers, idle loop and parallax only; no particles, light effects
  // or logo shine. For small slots where the extras are barely visible, and
  // for low-tier devices (config/device.js).
  const extras = !reduced && !opts.lite && deviceTier !== 'low';
  const [VW, VH] = scene.view;
  const loopMs = scene.loopSeconds * 1000;

  const root = document.createElement('div');
  root.className = `parallax-banner${className ? ` ${className}` : ''}`;
  root.setAttribute('role', 'img');
  if (alt) root.setAttribute('aria-label', alt);
  root.style.aspectRatio = `${VW} / ${VH}`;

  const anims = [];
  const imgs = [];
  // Pointer-follow shines: { wrap, sx } with sx the eased cursor fraction.
  const shineFollowers = [];
  // { canvas, ctx, emitters, left, top, w }: canvas edges in parent units, y-up
  const particleLayers = [];

  // `world` = parent's t0 centre in canvas space (y-up, canvas centre = 0,
  // view centre = (0, viewCenterY)), ignoring rotation/scale; only used to
  // aim particle canvases at the visible window (the margin absorbs the rest).
  function build(node, parentEl, parentSize, parentCy, world) {
    if (node.fx) {
      if (!extras) return undefined;
      const fxEl = buildFx(node, parentSize, parentCy);
      parentEl.appendChild(fxEl);
      return fxEl;
    }
    if (node.particles) {
      if (!extras) return;
      // Canvas = the visible window (plus margin) expressed in parent space.
      const w = VW + CANVAS_MARGIN * 2;
      const h = VH + CANVAS_MARGIN * 2;
      const cx = -world[0];
      const cy = scene.viewCenterY - world[1];
      const canvas = document.createElement('canvas');
      canvas.className = 'pb-particles';
      canvas.setAttribute('aria-hidden', 'true');
      place(canvas, [w, h], [cx, cy], parentSize, parentCy);
      parentEl.appendChild(canvas);
      particleLayers.push({
        canvas,
        ctx: canvas.getContext('2d'),
        emitters: node.particles.map((id) => new Emitter(scene.emitters[id], scene)),
        left: cx - w / 2,
        top: cy + h / 2,
        w,
      });
      return;
    }

    const el = document.createElement('div');
    el.className = 'pb-node';
    const pos = node.pos || [0, 0];
    place(el, node.size, pos, parentSize, parentCy);

    const rot0 = node.rot || 0;
    const scale0 = node.scale ?? 1;
    el.style.transform = poseTransform(node, pos, rot0, scale0);
    const filter = [
      node.grayscale && 'grayscale(1)',
      node.brightness != null && `brightness(${node.brightness})`,
      node.glow && dropShadow(node.glow, VW),
    ].filter(Boolean).join(' ');
    if (filter) el.style.filter = filter;

    if (node.parallax && !reduced) {
      const [px, py] = node.parallax;
      const [w, h] = node.size;
      // Pointer right/down → layer shifts right/down (follows the pointer);
      // nearer layers stack more.
      el.style.translate =
        `calc(var(--pb-mx, 0) * ${pct((px / w) * 100)}) calc(var(--pb-my, 0) * ${pct((py / h) * 100)})`;
    }

    if (node.img) {
      const d = dimsFor(node.img);
      // Rendered width share of the banner (object-fit: contain fit).
      const fitW = d ? Math.min(node.size[0], (node.size[1] * d.width) / d.height) : node.size[0];
      const media = createMediaElement(node.img, {
        alt: '',
        lazy,
        sizes: scaleSizes(sizes, (fitW * scale0) / VW),
      });
      if (media) {
        el.appendChild(media);
        const img = media.tagName === 'IMG' ? media : media.querySelector('img');
        if (img) imgs.push(img);
      }
    }

    if (node.loop && !reduced) {
      const L = node.loop;
      const mid = poseTransform(node, L.pos || pos, L.rot ?? rot0, L.scale ?? scale0);
      const start = el.style.transform;
      const k0 = { transform: start, easing: SMOOTHSTEP };
      const k1 = { transform: mid, easing: SMOOTHSTEP };
      const k2 = { transform: start };
      if (node.brightness != null) {
        k0.filter = k2.filter = `brightness(${node.brightness})`;
        k1.filter = `brightness(${L.brightness ?? node.brightness})`;
      }
      anims.push(el.animate([k0, k1, k2], { duration: loopMs, iterations: Infinity }));
    }

    parentEl.appendChild(el);
    const childWorld = [world[0] + pos[0], world[1] + pos[1]];
    const childEls = (node.children || []).map((child) => build(child, el, node.size, 0, childWorld));

    if (node.shine && extras) {
      const shine = buildShine(node, childEls);
      if (shine) {
        el.appendChild(shine.el);
        if (shine.anim) anims.push(shine.anim);
        shineSetups.push(shine.applyMask);
      }
    }
    return el;
  }

  /**
   * Shine: wrap (glow filter) > mask (alpha of the child images) > stripe
   * (animated). The wrap covers the union of the images' fitted rects; each
   * image becomes one mask layer placed and sized in percent of that union.
   * Masks reuse the exact URLs the <img>s loaded (currentSrc), so they're
   * cache hits; until then the mask stays hidden (an unmasked stripe would
   * show as a bar).
   */
  function buildShine(node, childEls) {
    const [gw, gh] = node.size;
    const glyphs = [];
    (node.children || []).forEach((c, i) => {
      const d = c.img && dimsFor(c.img);
      const img = childEls[i]?.querySelector('img');
      if (!d || !img) return;
      const [w, h] = c.size;
      const k = Math.min(w / d.width, h / d.height);
      const fw = d.width * k;
      const fh = d.height * k;
      const [x, y] = c.pos || [0, 0];
      // Fitted rect in the node's box, y-down.
      glyphs.push({ img, x: gw / 2 + x - fw / 2, y: gh / 2 - y - fh / 2, w: fw, h: fh });
    });
    if (!glyphs.length) return null;

    const ux = Math.min(...glyphs.map((g) => g.x));
    const uy = Math.min(...glyphs.map((g) => g.y));
    const uw = Math.max(...glyphs.map((g) => g.x + g.w)) - ux;
    const uh = Math.max(...glyphs.map((g) => g.y + g.h)) - uy;

    const { period, sweep, color, glow } = node.shine;
    const wrap = document.createElement('div');
    wrap.className = 'pb-shine';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.left = pct((ux / gw) * 100);
    wrap.style.top = pct((uy / gh) * 100);
    wrap.style.width = pct((uw / gw) * 100);
    wrap.style.height = pct((uh / gh) * 100);
    if (glow) wrap.style.filter = dropShadow(glow, VW);

    const mask = document.createElement('div');
    mask.className = 'pb-shine-mask';
    const stripe = document.createElement('div');
    stripe.className = 'pb-shine-stripe';
    // Soft edges, solid core: a thin hot line reads as a glint.
    stripe.style.background =
      `linear-gradient(90deg, transparent 0%, ${color} 42%, ${color} 58%, transparent 100%)`;
    mask.appendChild(stripe);
    wrap.appendChild(mask);

    // Stripe is 35% of the wrap wide; −120% → 300% of its own width carries
    // it fully across. `alternate` plays every other iteration in reverse, so
    // it sweeps back the other way. The rest is split half before and half
    // after the sweep, so both ends get the same full rest once mirrored.
    const off = 'translateX(-120%) skewX(-20deg)';
    const end = 'translateX(300%) skewX(-20deg)';
    // Pointer-follow (mouse devices): no timeline. The loop writes --pb-sx,
    // the cursor's x across this wrap (0 = left edge, 1 = right edge), and
    // `translate` centres the stripe there. The stripe is 35% of the wrap,
    // so wrap fraction f = translate f / 0.35 of its own width, minus half.
    if (node.shine.follow === 'pointer' && finePointer()) {
      stripe.style.transform = 'skewX(-20deg)';
      stripe.style.translate = `calc(var(--pb-sx, -1) * ${pct(100 / 0.35)} - 50%) 0`;
      shineFollowers.push({ wrap, sx: -1 });
      return { el: wrap, anim: null, applyMask: () => applyMaskTo(mask, glyphs, ux, uy, uw, uh) };
    }

    const s = Math.min(1, sweep / period);
    const a = (1 - s) / 2;
    const anim = stripe.animate(
      [
        { transform: off, offset: 0 },
        { transform: off, offset: a, easing: SMOOTHSTEP },
        { transform: end, offset: a + s },
        { transform: end, offset: 1 },
      ],
      { duration: period * 1000, iterations: Infinity, direction: 'alternate', delay: 1200 },
    );

    return { el: wrap, anim, applyMask: () => applyMaskTo(mask, glyphs, ux, uy, uw, uh) };
  }

  /**
   * Light effect over a painted glow (see `fx` in arboSplash.js). The node is
   * an additive overlay the size of the layer it sits in:
   *   mask   emission mask keyed from the layer's art (contain-fit, like the
   *          layer's <img>), so light only lands where the art glows
   *   img    a copy of an image to brighten (no mask needed)
   *   fill   flat colour through the mask
   *   noise  colour seen through a scrolling noise tile, two layers at
   *          different scales and speeds so the repeat doesn't show
   *   flow   a soft band travelling across at `angle` (energy along a beam)
   * The whole overlay's opacity either pulses (smooth, `pulse` s per cycle)
   * or flickers (random keys, `flicker` s per loop).
   */
  function buildFx(node, parentSize, parentCy) {
    const fx = node.fx;
    const [w] = node.size;
    const el = document.createElement('div');
    el.className = 'pb-fx';
    el.setAttribute('aria-hidden', 'true');
    place(el, node.size, node.pos || [0, 0], parentSize, parentCy);
    el.style.mixBlendMode = fx.blend || 'plus-lighter';

    if (fx.mask) {
      const src = maskSource(fx.mask, 960);
      if (src) {
        setMaskProp(el, 'mask-image', src);
        for (const [prop, value] of [
          ['mask-size', 'contain'],
          ['mask-position', 'center'],
          ['mask-repeat', 'no-repeat'],
        ]) {
          el.style.setProperty(prop, value);
          el.style.setProperty(`-webkit-${prop}`, value);
        }
      }
    }

    if (fx.img) {
      const media = createMediaElement(fx.img, { alt: '', lazy, sizes: scaleSizes(sizes, w / VW) });
      if (media) el.appendChild(media);
    }

    if (fx.fill) {
      const fill = document.createElement('div');
      fill.className = 'pb-fx-layer';
      fill.style.background = fx.fill;
      el.appendChild(fill);
    }

    if (fx.noise) {
      const tile = maskSource(fx.noise.tile, null);
      // Tile size in banner-relative units: 100cqw is the banner width.
      fx.noise.layers.forEach(({ size, period, drift = 0 }) => {
        const t = `calc(100cqw * ${+((size * w) / VW).toFixed(5)})`;
        const layer = document.createElement('div');
        layer.className = 'pb-fx-noise';
        layer.style.inset = `calc(${t} * -1)`;
        layer.style.background = fx.noise.color;
        if (tile) setMaskProp(layer, 'mask-image', tile);
        for (const [prop, value] of [
          ['mask-size', `${t} ${t}`],
          ['mask-repeat', 'repeat'],
        ]) {
          layer.style.setProperty(prop, value);
          layer.style.setProperty(`-webkit-${prop}`, value);
        }
        el.appendChild(layer);
        // Up by exactly one tile (plus `drift` whole tiles sideways) per
        // period: the end frame matches the start, so the loop is seamless.
        anims.push(layer.animate(
          [{ transform: 'translate(0, 0)' }, { transform: `translate(calc(${t} * ${drift}), calc(${t} * -1))` }],
          { duration: period * 1000, iterations: Infinity },
        ));
      });
    }

    if (fx.flow) {
      const { angle, period, color, width = 0.3 } = fx.flow;
      // A wide box rotated to the beam angle; a soft band slides through it.
      const box = document.createElement('div');
      box.className = 'pb-fx-flow';
      box.style.transform = `rotate(${-angle}deg)`;
      const band = document.createElement('div');
      band.className = 'pb-fx-flow-band';
      band.style.width = pct(width * 100);
      band.style.background = `linear-gradient(90deg, transparent, ${color}, transparent)`;
      box.appendChild(band);
      el.appendChild(box);
      const dir = fx.flow.reverse ? -1 : 1;
      const from = `translateX(${dir > 0 ? -100 : (1 / width) * 100}%)`;
      const to = `translateX(${dir > 0 ? (1 / width) * 100 : -100}%)`;
      anims.push(band.animate([{ transform: from }, { transform: to }],
        { duration: period * 1000, iterations: Infinity, easing: 'linear' }));
    }

    const [lo, hi] = fx.opacity || [0, 1];
    if (fx.pulse) {
      const keys = [{ opacity: lo, easing: SMOOTHSTEP }, { opacity: hi, easing: SMOOTHSTEP }, { opacity: lo }];
      if (fx.scale) {
        keys[0].transform = keys[2].transform = `scale(${fx.scale[0]})`;
        keys[1].transform = `scale(${fx.scale[1]})`;
      }
      anims.push(el.animate(keys, { duration: fx.pulse * 1000, iterations: Infinity }));
    } else if (fx.flicker) {
      // Random but repeating: `flickerKeys` keys per loop (default 16; first
      // = last for a clean wrap), so `flicker` sets the speed, not the count.
      // Keys are spaced unevenly too, so the rhythm doesn't read as a beat.
      const n = fx.flickerKeys || 16;
      const vals = Array.from({ length: n }, () => lo + Math.random() * (hi - lo));
      vals.push(vals[0]);
      const gaps = vals.slice(1).map(() => 0.5 + Math.random());
      const total = gaps.reduce((s, g) => s + g, 0);
      let at = 0;
      const keys = vals.map((opacity, i) => {
        const key = { opacity, offset: at, easing: 'ease-in-out' };
        if (i < gaps.length) at += gaps[i] / total;
        return key;
      });
      keys[keys.length - 1].offset = 1;
      anims.push(el.animate(keys, { duration: fx.flicker * 1000, iterations: Infinity }));
    } else {
      el.style.opacity = hi;
    }
    return el;
  }

  const shineSetups = [];
  build(scene.root, root, [VW, VH], scene.viewCenterY, [0, 0]);

  // Reveal once the layers have decoded, so the scene doesn't assemble piece
  // by piece. Lazy images only start loading near the viewport; that's fine,
  // the reveal simply waits for them.
  Promise.allSettled(imgs.map((img) => img.decode())).then(() => {
    for (const apply of shineSetups) apply();
    root.classList.add('is-ready');
  });

  if (managed && anims.length) registerManagedAnimation(root, anims);
  if (reduced || anims.length === 0) return root;

  /* ── Per-frame loop: particles + pointer smoothing ── */

  hookPointer();
  observers();

  const clock = anims[0];
  let raf = 0;
  let visible = false;
  let lastClock = null;
  let acc = 0;
  let frame = 0;
  let mx = 0;
  let my = 0;
  let unit = 1; // canvas px per scene unit

  function resize() {
    const bw = root.clientWidth;
    if (!bw) return;
    const dpr = Math.min(window.devicePixelRatio || 1, PARTICLE_DPR_CAP);
    unit = (bw / VW) * dpr;
    for (const layer of particleLayers) {
      const w = Math.round(layer.w * unit);
      const h = Math.round((VH + CANVAS_MARGIN * 2) * unit);
      if (layer.canvas.width !== w) layer.canvas.width = w;
      if (layer.canvas.height !== h) layer.canvas.height = h;
    }
  }

  // The banner's viewport rect, re-measured only after a scroll/resize (or
  // every RECT_TTL ms for layout shifts that are neither). Reading it every
  // frame would risk a forced layout whenever anything wrote styles first.
  let rect = null;
  let rectEpoch = -1;
  let rectAt = 0;
  function bannerRect() {
    const now = performance.now();
    if (!rect || rectEpoch !== layoutEpoch || now - rectAt > RECT_TTL) {
      rect = root.getBoundingClientRect();
      rectEpoch = layoutEpoch;
      rectAt = now;
    }
    return rect;
  }

  // rAF doesn't fire in hidden tabs, so tab switches need no handling here;
  // the clock (paused by the offscreen manager) absorbs the gap.
  function tick() {
    raf = 0;
    if (!visible || !root.isConnected) return;
    raf = requestAnimationFrame(tick);

    const now = clock.currentTime ?? 0;
    const running = clock.playState === 'running';
    const dt = lastClock == null ? 0 : Math.max(0, (now - lastClock) / 1000);
    lastClock = now;
    if (!running || dt === 0) return;

    // Pointer: normalised offset from the banner centre, eased.
    let tx = 0;
    let ty = 0;
    if (pointer.active) {
      const r = bannerRect();
      tx = Math.max(-1, Math.min(1, (pointer.x - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      ty = Math.max(-1, Math.min(1, (pointer.y - (r.top + r.height / 2)) / (window.innerHeight / 2)));
    }
    const k = 1 - Math.exp(-dt * POINTER_RATE);
    const nmx = mx + (tx - mx) * k;
    const nmy = my + (ty - my) * k;
    if (Math.abs(nmx - mx) > 1e-4 || Math.abs(nmy - my) > 1e-4) {
      mx = nmx;
      my = nmy;
      root.style.setProperty('--pb-mx', mx.toFixed(4));
      root.style.setProperty('--pb-my', my.toFixed(4));
    }

    // Shine glint: the cursor's x across the whole window maps onto the
    // logo (left screen edge → just off the logo's left, right edge → just
    // off its right), so any sweep of the mouse crosses it. Parked off-left
    // until the first mouse move; afterwards it holds the last position.
    if (shineFollowers.length) {
      const ks = 1 - Math.exp(-dt * SHINE_RATE);
      const target = pointer.active
        ? SHINE_RANGE[0] + (pointer.x / window.innerWidth) * (SHINE_RANGE[1] - SHINE_RANGE[0])
        : SHINE_PARK;
      for (const f of shineFollowers) {
        const next = f.sx + (target - f.sx) * ks;
        if (Math.abs(next - f.sx) > 1e-4) {
          f.sx = next;
          f.wrap.style.setProperty('--pb-sx', next.toFixed(4));
        }
      }
    }

    acc = Math.min(acc + dt, STEP * MAX_STEPS);
    while (acc >= STEP) {
      acc -= STEP;
      frame++;
      for (const layer of particleLayers) for (const em of layer.emitters) em.step(frame);
    }
    for (const layer of particleLayers) {
      const { ctx, canvas, left, top } = layer;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const map = (x, y) => [(x - left) * unit, (top - y) * unit];
      for (const em of layer.emitters) em.draw(ctx, map, unit);
      ctx.globalAlpha = 1;
    }
  }

  const inst = {
    attached: false,
    setVisible(v) {
      visible = v;
      lastClock = null;
      if (v && !raf) raf = requestAnimationFrame(tick);
    },
    resize,
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      visible = false;
      io.unobserve(root);
      ro.unobserve(root);
      instances.delete(root);
    },
  };
  instances.set(root, inst);
  io.observe(root);
  ro.observe(root);

  return root;
}
