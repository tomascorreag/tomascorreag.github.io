// VENDORED from github.com/tomascorreag/MapColombia @ bc42ec4,
// frontend/src/lib/landingEffects.ts. Unmodified below this block; used by
// src/components/LandingBanner.js. Copied once, not synced: re-copy by hand if
// the landing's effects change.
//
// Landing-page ambient effects: canvas-2D ports of the two archives' signature
// marks — the violence view's blood tendrils and the deforestation view's
// burning loss pixels.
//
// ATMOSPHERE, NOT CARTOGRAPHY. Read this before changing anything here.
//
// These fields carry NO DATA. The real tendril field (tendrils.ts) grows from
// actual event coordinates, seeded in proportion to victim counts; the real
// ember raster (LossRasterLayer.ts) samples Hansen's 30 m tree-cover-loss
// pixels. The landing fetches neither — App.svelte deliberately short-circuits
// the data load when there is no ?section, and this module must never give it a
// reason to. Every wound point, loss year and density here is SYNTHETIC, drawn
// from a seeded PRNG and value noise.
//
// So these effects must never be readable as a map. The rules that keep them so:
//   1. The ambient fields are masked to the OUTER FLANK of each half.
//   2. The 'fill' instances (FieldOptions.fill) DO paint inside the Colombia
//      silhouette — an owner decision (2026-11). They show only while the
//      cursor is on the country, at full extent, with wounds scattered uniformly
//      and embers from value noise: no position, cluster or density carries any
//      relation to where the real archives put violence or loss.
//   3. Nothing here is labelled, scaled, or captioned as a quantity.
// They are an evocation of each archive's visual language, nothing more. The
// project's data-integrity rule (CLAUDE.md) is why this comment is this long.
//
// What IS faithful is the shape of the maths: the flow field (shared verbatim
// via noise.ts), the taper/pulse/envelope profiles from TendrilLayer.ts, and
// the fire ramp and burn maths from LossRasterLayer.ts (shared verbatim via
// fireRamp.ts). Constants below are marked [verbatim] where they are quoted from
// the real layer and [landing] where they are retuned for a looping 2D field —
// the retuned ones are all timing, because the real views are scrubbed by a user
// and this one runs on its own.

import { mulberry32, valueNoise, flowAngle, smoothstep, pmod, type FlowParams } from './noise';
import { RAMP_DEFAULTS, FIRE_DEFAULTS, rampStopToVec4 } from './fireRamp';

/** Rendering resolution cap. The map has a tier system (perf.svelte.ts) but it
 * sniffs the GPU by creating a throwaway WebGL context at module load — a real
 * side effect on a page with no WebGL, for a budget orders of magnitude smaller
 * than the map's. A flat cap is the right trade here. */
const DPR_CAP = 1.5;

export interface AmbientField {
  /** Re-fit to a new CSS size. Rebuilds geometry; not cheap — debounce it. */
  resize(cssW: number, cssH: number): void;
  /** Advance by dtSec and paint. `ignite` is 0..1 — CURSOR PROXIMITY, not a
   * hover flag: Landing.svelte feeds a continuous falloff from each field's mask
   * centre, so every value in between is a real state this must render. It drives
   * speed, glow and growth together, with a deliberately wide rest->hot span.
   * Call with dtSec = 0, ignite = 0 for a settled frame. */
  render(dtSec: number, ignite: number): void;
  destroy(): void;
}

export type Side = 'left' | 'right';

export interface FieldOptions {
  /** Cover the whole canvas, growing from its centre, instead of hugging the
   * half's outer flank. Used for the map overlay. */
  fill?: boolean;
  /** Fill mode only: is a normalised (0..1) canvas point inside the shape the
   * canvas is masked to? Scar wounds are only seeded where it is true, so no
   * strand budget is spent on curves the mask would hide. */
  inside?: (u: number, v: number) => boolean;
}

// ---------------------------------------------------------------------------
// Field reach — the "extend further out" that ignite pulls on, shared by both
// fields so they grow by the same rule.
//
// These MUST track the `mask-image` ellipses in Landing.svelte's <style>. The
// CSS mask cannot grow with ignite, and that is not a limitation to work around
// — it is calibrated to the type. At 1500x900 the left field's visible edge
// lands at x=339 and the masthead starts at x=337: two pixels of clearance.
// Widen the mask and the fields paint behind the title.
//
// So reach grows the other way. At rest the field is held to a tight knot at the
// flank's heart; ignite pushes it out to MASK_EDGE, where the CSS mask — already
// calibrated to clear the masthead and the content block — takes back over as the
// limit. The growth is real and large, and it can never widen the footprint past
// what the type layout allows.
const MASK_CX = 0.07; // as authored for 'left'; mirrored for 'right'
const MASK_CY = 0.3;
const MASK_RX = 0.7;
const MASK_RY = 0.62;
const MASK_EDGE = 0.74; // the gradient reaches transparent at this fraction of RX/RY

const FIELD_REACH_REST = 0.4;
const FIELD_REACH_HOT = 0.82; // past MASK_EDGE on purpose: the CSS mask is the bound
const FIELD_REACH_EDGE = 0.3; // soft rim, so the field grows rather than wipes

// Fill mode (the map overlay): no CSS ellipse to mirror — the bound is the
// country mask. Reach is measured against a centred ellipse touching the box
// edges, so 1 is the edge midpoints and ~1.41 the corners. Landing drives these
// fields at half ignite (MAP_HEAT), where this gives reach 1.65 with full
// strength out to ~1.16 — the whole country, with only the box corners (outside
// it) in the soft rim.
const FILL_REACH_REST = 0.3;
const FILL_REACH_HOT = 3.0;

interface ReachGeom {
  cx: number; // centre, fraction of width
  cy: number;
  rx: number; // radii, fraction of width/height
  ry: number;
  rest: number;
  hot: number;
}

function reachGeom(side: Side, fill: boolean): ReachGeom {
  if (fill) return { cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, rest: FILL_REACH_REST, hot: FILL_REACH_HOT };
  return {
    cx: side === 'left' ? MASK_CX : 1 - MASK_CX,
    cy: MASK_CY,
    rx: MASK_RX,
    ry: MASK_RY,
    rest: FIELD_REACH_REST,
    hot: FIELD_REACH_HOT,
  };
}

/** Normalised distance from the field's reach centre: 0 at the centre, 1 at the
 * ellipse (for flank fields, MASK_EDGE is where the CSS mask has faded out). */
function maskRadius(pxX: number, pxY: number, w: number, h: number, m: ReachGeom): number {
  const dx = (pxX - m.cx * w) / (m.rx * w);
  const dy = (pxY - m.cy * h) / (m.ry * h);
  return Math.sqrt(dx * dx + dy * dy);
}

function fieldReach(ignite: number, m: ReachGeom): number {
  return m.rest + (m.hot - m.rest) * ignite;
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d');
}

function dprOf(): number {
  return Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, DPR_CAP);
}

// ===========================================================================
// Scar field — tendrils.ts geometry + TendrilLayer.ts timing
// ===========================================================================

const STEPS = 22; // [verbatim] tendrils.ts segments per curve

// [verbatim] TENDRIL_GEO_DEFAULTS — the flow field's shape
const FLOW: FlowParams = {
  seed: 0x1958,
  noiseLen1: 40,
  noiseLen2: 6,
  noiseAmp1: 3.0,
  noiseAmp2: 0.4,
};
const STEP_KM = 4.2; // [verbatim] -> curves ~92 km long
const REACH_KM = 80; // [verbatim] the SHIPPED value (debug.svelte.ts), not the 55 in tendrils.ts
const VICTIM_NORM = 5; // [verbatim]

// [verbatim] TendrilLayer.ts width/alpha profile
const WIDTH_BOOST = 7.5;
const WIDTH_FALLOFF = 2.7;
const SCAR_WIDTH = 1.0; // note: 1.0 means fresh and scar share a width; only colour/alpha/blend differ
// [landing] The real field ships SCAR_ALPHA 0.3 (debug.svelte.ts; the TS const
// says 0.15) and gets its body from ~80k curves piling up until they hit the
// normal-blend ceiling. A few hundred curves never accumulate, so per-curve
// alpha has to carry what overlap carried there, or the scars read as bare ink.
const SCAR_ALPHA = 0.55;
const FRESH_ALPHA = 0.96;
const PULSE_STRENGTH = 1.05;
const PULSE_SPEED_KM_PER_DAY = 0.4;
const PULSE_WIDTH_KM = 24;
const FULL_DAYS = 30;

// [verbatim] TendrilLayer.ts fragment shader
const SCAR_RGB = [96, 16, 22]; // vec3(0.376, 0.063, 0.086)
const FLARE_RGB = [255, 58, 28]; // vec3(1.0, 0.227, 0.110)

// [landing] The real fade is WOUND_FADE_DAYS = 1050 (~3 yr), which encodes the
// memoria view's "a wound stays fresh for three years" semantic. That has no
// meaning on a front door with no timeline, and at any watchable rate it smears
// every flare into a permanent wash. Shortened so a flare reads as one event.
const FADE_DAYS = 420;
// [landing] Wound re-fire period, and the knob for how OFTEN the field lights up.
// Still comfortably longer than FADE_DAYS, which is the invariant that matters:
// each flare must fully settle into its scar before its wound fires again, or the
// pulse resets mid-travel and the strand visibly restarts.
// The FADE_DAYS/PERIOD ratio IS the concurrency budget, and it is not a free knob.
// At the old 1/7 only one or two wounds were ever mid-flare and the flank read as
// mostly dormant; at ~1/3.6 several overlap, so wounds fire noticeably more often.
// Halving this doubled the per-frame stroke count and MEASURABLY BROKE THE FRAME:
// 33 ms/frame ignited (30 fps), p95 50 ms. It is affordable now only because the
// bloom pass gained a visibility cull (HALO_MIN_ALPHA) that took the frame back to
// 16.7 ms with no visible change — peak flare energy 970 vs 972 before it.
// So: this is the first number to look at if the landing ever drops frames, and
// lowering it further needs the same treatment — measure, don't assume.
const WOUND_PERIOD_DAYS = 1500;
// [landing] sim-days per real second, at rest and fully ignited. Integrated (not
// t * rate) so changing rate mid-flight never jumps the phase — which is what
// lets the rate swing this hard without the field ever popping.
// The ~13x span is the point: `ignite` is cursor PROXIMITY (Landing.svelte), so
// the far half must read as barely turning over while the near one races. Note
// this is rate only — it does not touch FADE_DAYS/WOUND_PERIOD_DAYS, whose ratio
// is the concurrency budget, so the per-frame stroke count is unchanged.
const SCAR_DAYS_PER_SEC_REST = 26;
const SCAR_DAYS_PER_SEC_HOT = 340;

// [landing] Flare response to ignite. Rest is a smoulder; hot is violent.
// FLARE_GAIN_HOT is >1 deliberately — per-segment alpha clamps at 1, so the
// excess drives segments INTO saturation rather than brightening linearly, which
// is what makes the core of a strand go solid instead of merely lighter.
const FLARE_GAIN_REST = 0.18;
const FLARE_GAIN_HOT = 1.15;
// [landing] Stroke-width multiplier at full ignite — the "grow". Applies to the
// flare pass only; scars are pre-rasterised (they are permanent, see paintScars)
// so they brighten but never swell. Multiplies the pen, leaving the verbatim
// taper/WIDTH_BOOST profile that shapes each strand untouched.
const FLARE_GROW = 1.4;
// [landing] Additive bloom: a wide, faint pass under each flare stroke. Under
// 'lighter' the overlap SUMS, so it reads as light spilling off the strand
// rather than as a fatter strand. Ignite-gated to nothing at rest. Stroked in
// SCAR_RGB rather than the flare colour — see the pass itself for why.
const HALO_WIDTH = 3.4;
const HALO_ALPHA = 0.42;
// [landing] Visibility cull for the bloom pass — see where it is used. A wide
// stroke below this alpha is invisible against ink but costs the most pixels of
// any stroke in the frame, and there are thousands of them on the tapered tips.
const HALO_MIN_ALPHA = 0.07;
// [landing] How far the LIGHT runs out along each strand, as km of arc from the
// wound. This is the "reach" the cursor pulls on. The strands themselves are
// permanent and always drawn at full extent (the scar blit) — what grows is how
// far a fresh flare travels along them, so approaching a half reads as its wounds
// reaching deep into the flank while the dim crimson veins show where they will
// go. Baked geometry is untouched: segArc is already each segment's arc length
// from its wound, so this gates the existing curve rather than rebuilding it,
// which is what keeps a per-frame reach affordable at all.
const FLARE_ARC_REST_KM = 40;
const FLARE_ARC_HOT_KM = 320;
const FLARE_ARC_EDGE_KM = 45; // soft tip: light fades in along the strand, never pops

const PX_PER_KM = 1.6; // [landing] km-space -> CSS px
// [landing] The real field draws ~80k curves at 0.5 px and gets its body from
// sheer overlap. A flank holds ~600, which never accumulates that way, so
// per-curve width carries what overlap carried there (as does SCAR_ALPHA above).
const BASE_WIDTH_PX = 0.85;
const CURVE_AREA_PX2 = 1100; // one curve per this much area, so density is resolution-independent
const MAX_CURVES = 900;
const MIN_CURVES = 100;
const WOUND_AREA_PX2 = 46000; // one synthetic wound per this much area

interface ScarGeom {
  n: number; // curve count
  ptsX: Float32Array; // (STEPS+1) per curve, CSS px
  ptsY: Float32Array;
  segTaper: Float32Array; // STEPS per curve — pow(1 - dist/reach, falloff)
  segArc: Float32Array; // STEPS per curve — km along the pulse path from the wound
  woundPhase: Float32Array; // per wound, days
  woundCurves: number[][]; // wound -> its curve indices, so a flare needn't scan the field
}

/** Ambient blood-tendril field. Scars are permanent, so they rasterise ONCE to
 * an offscreen canvas and are thereafter a single drawImage; only the wounds
 * currently flaring stroke per frame. That is not a shortcut around the real
 * semantics — it IS them (TendrilLayer.ts: the scar pass never fades). */
export function createScarField(
  canvas: HTMLCanvasElement,
  side: Side,
  opts: FieldOptions = {}
): AmbientField {
  const fill = !!opts.fill;
  const rg = reachGeom(side, fill);
  const ctx = ctx2d(canvas);
  const scarCanvas = document.createElement('canvas');
  const sctx = ctx2d(scarCanvas);

  let geom: ScarGeom | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = dprOf();
  let simDay = 0;

  function build(w: number, h: number): ScarGeom {
    const rand = mulberry32(FLOW.seed ^ (side === 'left' ? 0 : 0x5eed) ^ (fill ? 0xf111 : 0));

    // Synthetic wounds, biased to the outer flank (where the mask reveals the
    // field). Deterministic — the same field every load, like the speck grid it
    // replaces. These are invented points; see the header.
    const nW = Math.max(6, Math.min(16, Math.round((w * h) / WOUND_AREA_PX2)));
    const wx = new Float32Array(nW);
    const wy = new Float32Array(nW);
    const wVict = new Float32Array(nW);
    const woundPhase = new Float32Array(nW);
    for (let i = 0; i < nW; i++) {
      if (fill) {
        // uniform over the box, rejection-sampled into the masked shape — no
        // placement here is meant to say anything about where
        let u = 0;
        let v = 0;
        let tries = 0;
        do {
          u = 0.05 + rand() * 0.9;
          v = 0.04 + rand() * 0.92;
        } while (opts.inside && !opts.inside(u, v) && ++tries < 60);
        wx[i] = u * w;
        wy[i] = v * h;
      } else {
        const fx = -0.04 + rand() * 0.56; // flank-weighted
        wx[i] = (side === 'left' ? fx : 1 - fx) * w;
        wy[i] = (0.04 + rand() * 0.72) * h;
      }
      wVict[i] = 1.6 + rand() * 7.4; // stands in for sqrt(victims); drives reach + curve share
      woundPhase[i] = rand() * WOUND_PERIOD_DAYS; // stagger so they never fire in unison
    }

    // cumulative weights: curves per wound ∝ its weight (mirrors tendrils.ts)
    const cum = new Float64Array(nW);
    let acc = 0;
    for (let i = 0; i < nW; i++) {
      acc += wVict[i];
      cum[i] = acc;
    }
    const pick = (r: number) => {
      let lo = 0;
      let hi = nW - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] > r) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };

    const n = Math.max(MIN_CURVES, Math.min(MAX_CURVES, Math.round((w * h) / CURVE_AREA_PX2)));
    const ptsX = new Float32Array(n * (STEPS + 1));
    const ptsY = new Float32Array(n * (STEPS + 1));
    const segTaper = new Float32Array(n * STEPS);
    const segArc = new Float32Array(n * STEPS);
    const woundCurves: number[][] = Array.from({ length: nW }, () => []);

    const vx = new Float64Array(STEPS + 1); // km-space vertices
    const vy = new Float64Array(STEPS + 1);

    for (let c = 0; c < n; c++) {
      const gi = pick(rand() * acc);
      woundCurves[gi].push(c);
      // [verbatim] reach is victim-scaled exactly as the shader does it
      const reach = REACH_KM * (0.5 + 0.5 * Math.min(wVict[gi] / VICTIM_NORM, 2));
      const wxKm = wx[gi] / PX_PER_KM;
      const wyKm = wy[gi] / PX_PER_KM;

      // seed uniformly in a disk around the wound (tendrils.ts:165)
      const ang0 = rand() * 2 * Math.PI;
      const r0 = Math.sqrt(rand()) * reach * 0.85;
      vx[0] = wxKm + Math.cos(ang0) * r0;
      vy[0] = wyKm + Math.sin(ang0) * r0;
      // [verbatim] integrate through the shared flow field (tendrils.ts:168)
      for (let s = 0; s < STEPS; s++) {
        const a = flowAngle(vx[s], vy[s], FLOW);
        vx[s + 1] = vx[s] + Math.cos(a) * STEP_KM;
        vy[s + 1] = vy[s] + Math.sin(a) * STEP_KM;
      }

      // closest approach -> where the pulse enters the curve (tendrils.ts:177)
      let bestD = Infinity;
      let bestVert = 0;
      for (let v = 0; v <= STEPS; v++) {
        const dx = vx[v] - wxKm;
        const dy = vy[v] - wyKm;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          bestVert = v;
        }
      }
      bestD = Math.sqrt(bestD);

      for (let s = 0; s <= STEPS; s++) {
        ptsX[c * (STEPS + 1) + s] = vx[s] * PX_PER_KM;
        ptsY[c * (STEPS + 1) + s] = vy[s] * PX_PER_KM;
      }
      for (let s = 0; s < STEPS; s++) {
        const mxKm = (vx[s] + vx[s + 1]) / 2;
        const myKm = (vy[s] + vy[s + 1]) / 2;
        const dx = mxKm - wxKm;
        const dy = myKm - wyKm;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const norm = Math.min(1, Math.max(0, dist / reach));
        // [verbatim] thickest at the wound, tapering to 0 at reach
        segTaper[c * STEPS + s] = Math.pow(1 - norm, WIDTH_FALLOFF);
        segArc[c * STEPS + s] = bestD + Math.abs(s + 0.5 - bestVert) * STEP_KM;
      }
    }

    return { n, ptsX, ptsY, segTaper, segArc, woundPhase, woundCurves };
  }

  /** Rasterise the permanent scars once. NORMAL blending, so any number of
   * overlapping strands composites to one ceiling alpha — every scar settles to
   * the same intensity regardless of how many curves cross it. That ceiling is
   * the real layer's editorial point, and source-over reproduces it exactly. */
  function paintScars(g: ScarGeom) {
    if (!sctx) return;
    scarCanvas.width = Math.max(1, Math.round(cssW * dpr));
    scarCanvas.height = Math.max(1, Math.round(cssH * dpr));
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, cssW, cssH);
    sctx.globalCompositeOperation = 'source-over';
    sctx.strokeStyle = `rgb(${SCAR_RGB[0]}, ${SCAR_RGB[1]}, ${SCAR_RGB[2]})`;
    sctx.lineCap = 'round';
    for (let c = 0; c < g.n; c++) {
      for (let s = 0; s < STEPS; s++) {
        const taper = g.segTaper[c * STEPS + s];
        const ws = taper * WIDTH_BOOST * SCAR_WIDTH;
        if (ws < 0.003) continue; // [verbatim] the shader's width cull
        const alpha = taper * SCAR_ALPHA;
        if (alpha < 0.004) continue; // [verbatim] the shader's alpha discard
        sctx.globalAlpha = alpha;
        sctx.lineWidth = BASE_WIDTH_PX * ws;
        const i = c * (STEPS + 1) + s;
        sctx.beginPath();
        sctx.moveTo(g.ptsX[i], g.ptsY[i]);
        sctx.lineTo(g.ptsX[i + 1], g.ptsY[i + 1]);
        sctx.stroke();
      }
    }
    sctx.globalAlpha = 1;
  }

  function resize(w: number, h: number) {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    dpr = dprOf();
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    geom = build(cssW, cssH);
    paintScars(geom);
  }

  function render(dtSec: number, ignite: number) {
    if (!ctx || !geom) return;
    const g = geom;
    simDay += dtSec * (SCAR_DAYS_PER_SEC_REST + (SCAR_DAYS_PER_SEC_HOT - SCAR_DAYS_PER_SEC_REST) * ignite);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // permanent scars: one blit, unchanged since the last resize
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.6 + 0.4 * ignite;
    ctx.drawImage(scarCanvas, 0, 0);
    ctx.globalAlpha = 1;

    // fresh flares: ADDITIVE, matching the real pass's src-alpha/ONE blend
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const flareGain = FLARE_GAIN_REST + (FLARE_GAIN_HOT - FLARE_GAIN_REST) * ignite;
    const grow = 1 + FLARE_GROW * ignite;
    const haloA = HALO_ALPHA * ignite;
    const arcNow = FLARE_ARC_REST_KM + (FLARE_ARC_HOT_KM - FLARE_ARC_REST_KM) * ignite;

    // One wound's curves, stroked at a given colour/width/alpha. The halo and the
    // core run this as two separate passes rather than two strokes per segment:
    // strokeStyle re-parses its CSS-colour string on every assignment, so
    // alternating colour per segment would cost far more than recomputing the
    // (cheap) taper/pulse maths a second time.
    const strokeWound = (
      wi: number,
      env: number,
      tF: number,
      widthMul: number,
      gain: number,
      minAlpha: number
    ) => {
      for (const c of g.woundCurves[wi]) {
        for (let s = 0; s < STEPS; s++) {
          const taper = g.segTaper[c * STEPS + s];
          const ws = taper * WIDTH_BOOST * (SCAR_WIDTH + (1 - SCAR_WIDTH) * env);
          if (ws < 0.003) continue;
          const arc = g.segArc[c * STEPS + s];
          // [landing] the reach gate — how far out along this strand the light
          // has run. Cheapest possible cull, so it goes before the exp() below.
          const ext = 1 - smoothstep(arcNow - FLARE_ARC_EDGE_KM, arcNow, arc);
          if (ext < 0.004) continue;
          // [verbatim] travelling gaussian along arc length from the wound
          const pd = (arc - tF * PULSE_SPEED_KM_PER_DAY) / PULSE_WIDTH_KM;
          const pulse = Math.exp(-pd * pd) * env;
          const alpha = Math.min(1, taper * env * (FRESH_ALPHA + PULSE_STRENGTH * pulse) * gain * ext);
          if (alpha < minAlpha) continue;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = BASE_WIDTH_PX * ws * grow * widthMul;
          const i = c * (STEPS + 1) + s;
          ctx.beginPath();
          ctx.moveTo(g.ptsX[i], g.ptsY[i]);
          ctx.lineTo(g.ptsX[i + 1], g.ptsY[i + 1]);
          ctx.stroke();
        }
      }
    };

    for (let wi = 0; wi < g.woundPhase.length; wi++) {
      const tF = pmod(simDay - g.woundPhase[wi], WOUND_PERIOD_DAYS);
      // [verbatim] the fresh-wound envelope: full for FULL_DAYS, then smoothstep out
      const env = 1 - smoothstep(FULL_DAYS, FADE_DAYS, tF);
      if (env < 0.004) continue;

      // Bloom pass, under the core. Stroked in SCAR_RGB — the deep crimson — and
      // NOT in the flare colour, which is the load-bearing part. 'lighter' sums
      // channels, so blooming with #ff3a1c saturates R and then drags G and B up
      // until the wound's core goes cream-white: the violence half starts reading
      // as FIRE, which is the other archive's whole visual language (see the
      // palette note in CLAUDE.md — the halves are told apart by the form of their
      // mark, and hue drift collapses that). #601016 is ~all red, so the spill can
      // only ever deepen toward blood no matter how much of it piles up.
      if (haloA > 0.004) {
        ctx.strokeStyle = `rgb(${SCAR_RGB[0]}, ${SCAR_RGB[1]}, ${SCAR_RGB[2]})`;
        // HALO_MIN_ALPHA, not the shader's 0.004: this pass strokes at HALO_WIDTH,
        // so each of its segments rasterises ~3.4x the pixels of a core one and it
        // dominates the frame. Culling it at the threshold where the bloom stops
        // being *visible* keeps the glow exactly where it reads — around the bright
        // pulse and the thick base — and drops it from the faint tapered tips where
        // a wide 0.02-alpha stroke costs the most and shows the least.
        strokeWound(wi, env, tF, HALO_WIDTH, flareGain * haloA, HALO_MIN_ALPHA);
      }

      // [verbatim] fresh cools toward the scar colour as the envelope decays
      const r = Math.round(SCAR_RGB[0] + (FLARE_RGB[0] - SCAR_RGB[0]) * env);
      const gg = Math.round(SCAR_RGB[1] + (FLARE_RGB[1] - SCAR_RGB[1]) * env);
      const b = Math.round(SCAR_RGB[2] + (FLARE_RGB[2] - SCAR_RGB[2]) * env);
      ctx.strokeStyle = `rgb(${r}, ${gg}, ${b})`;
      strokeWound(wi, env, tF, 1, flareGain, 0.004); // [verbatim] the shader's alpha discard
    }
    ctx.globalAlpha = 1;

    // REACH: trim the whole composited field — permanent veins and flares alike —
    // to an ellipse that grows with ignite. One destination-in pass rather than a
    // per-segment gate, because the scars are a pre-rasterised BLIT: a per-segment
    // test could only ever reach the flares, leaving the veins at full extent to
    // give the field's true size away at rest, and the growth would read as
    // brightness again instead of reach.
    //
    // The scars are still permanent — nothing here fades or forgets them. What
    // moves is how much of the flank the field has spread across, which is the
    // atmosphere's business, not the archive's.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.save();
    // unit circle -> the mask's ellipse, so this falloff is concentric with the
    // CSS mask instead of fighting it
    ctx.translate(rg.cx * cssW, rg.cy * cssH);
    ctx.scale(rg.rx * cssW, rg.ry * cssH);
    const reach = fieldReach(ignite, rg);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(Math.max(0.001, 1 - FIELD_REACH_EDGE), 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    // in unit space the canvas is at most ~1/r across; 4 covers it from any centre
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  function destroy() {
    geom = null;
    scarCanvas.width = 0;
    scarCanvas.height = 0;
  }

  return { resize, render, destroy };
}

// ===========================================================================
// Ember field — LossRasterLayer.ts burn maths
// ===========================================================================

// [verbatim] FIRE_DEFAULTS
const COOL = FIRE_DEFAULTS.cool; // 8 — burn-front cooling span, timeline-years
const JITTER = FIRE_DEFAULTS.jitter; // 2 — ignition offset amplitude, years
const FADE_IN = FIRE_DEFAULTS.fadeIn; // 0.1 — dissolve-in duration

// [landing] Hansen's timeline is 2001..2025 and the user scrubs it. Here the
// playhead runs forever, so each cell cycles on its own modulo instead: ignite ->
// cool -> fade out -> re-ignite. Ramping a global playhead 0..25 and snapping
// back would blank and re-light the entire field in one frame.
// COOL/EMBER_PERIOD is the fraction of cells burning at any moment, and it is
// the knob that decides whether this reads as fire or as dirt. At 8/60 the field
// was 13% warm — bare ink with grit on it. Tuning the PERIOD rather than COOL
// keeps COOL verbatim: cells still cool over exactly the real 8 timeline-years,
// they just come round again sooner.
const EMBER_PERIOD = 18; // years per cell cycle; > COOL so cells rest cold between burns
const EMBER_TAIL = 5; // years of fade-out before a cell re-ignites — kills the wrap pop
// [landing] ~12x span, for the same reason as the scar field's: ignite is cursor
// proximity, so the far half must read as almost becalmed. Only the playhead RATE
// changes — COOL/EMBER_PERIOD are untouched, so a cell still cools over exactly
// the real 8 timeline-years and the fraction of the field burning is constant.
const EMBER_YEARS_PER_SEC_REST = 0.25;
const EMBER_YEARS_PER_SEC_HOT = 3.0;

// [landing] The real raster's structure comes from Hansen pixels; here noise
// stands in for it.
//
// Wavelengths are in CSS PIXELS. They used to be in cells, which quietly tied the
// SIZE OF THE SHAPES to the grid resolution — every refinement of CELL_PX shrank
// every patch by the same factor, so "finer pixels" and "bigger shapes" fought
// each other. In px they are independent: CELL_PX sets the grain, these set the
// composition.
const YEAR_LEN_PX = 68; // loss-year patches: neighbours share a cohort, so fronts move as fronts
const COV_LEN_PX = 34; // coverage: where there is loss at all (sparse, like the real raster)
// These last two stay in CELLS on purpose. They are TEXTURE, not composition:
// their job is to break the field up pixel-to-pixel, so they must follow the grid
// rather than the layout, and they are what keeps the mark reading as burning
// pixels instead of smooth cloud. Pin them to px and they turn coherent as the
// grid refines — a 24px burn wavelength at a 2px cell is 12 cells across, which
// ignites whole neighbourhoods in unison and melts the field into blobs.
//
// Ignition offset within a cohort. Small but NOT per-cell: at ~1 cell it
// decorrelates completely and the front dissolves into salt-and-pepper; ~2-3
// cells gives a ragged front with pixel texture, which is what the real raster
// looks like (its noiseScale of 2000 is likewise coherent across a few native
// pixels). This is the constant that breaks a cohort's edge into embers.
const BURN_LEN_CELLS = 2.5;
// Per-cell density speckle, so a patch is never a flat slab of one value.
const GRIT_LEN_CELLS = 1.1;
// [landing] Below this coverage there is no loss in a cell at all — it is what
// keeps the field sparse. Ignite LOWERS it, which is the ember field's "reach":
// the burnt patches themselves spread outward into clean ground as the cursor
// closes, the counterpart to the scar field's strands running further. The floor
// therefore cannot be baked into a per-cell alpha at build time the way it used
// to be — the raw coverage noise is kept per cell and thresholded per frame.
const COV_FLOOR_REST = 0.47;
const COV_FLOOR_HOT = 0.3;

// [landing] Cold cells nearly vanish here. In the real view a long-cooled pixel
// stays visible in clay (#ab8c87) because cumulative extent is a claim it must
// keep making — that clay sits on green forest and reads as cleared land. On an
// ink ground with no cumulative claim to make, a light clay at high alpha is
// just fog: it drowns the embers and greys the whole half. So alpha tracks heat
// and only the burning front really shows.
const COLD_FLOOR = 0.08; // alpha multiplier at heat 0 — enough to read as ash, not enough to fog
// [landing] Gamma on the heat->alpha curve; >1 concentrates alpha into the front.
// Ignite drives it BELOW 1, which is the ember field's "grow": cells can't swell
// (they are fixed-size pixels, and that is the whole point of the mark), so the
// growth has to be the burning front itself widening — more of each cohort's
// cooling tail reads as lit. Dropping the gamma does exactly that without
// touching the verbatim COOL span that defines how fast a cell actually cools.
const HEAT_GAMMA_REST = 1.6;
const HEAT_GAMMA_HOT = 0.85;
// [landing] Overall alpha gain. Hot exceeds 1 on purpose — it pushes the front's
// colour to full opacity instead of compositing grey against the ink ground.
const EMBER_GAIN_REST = 0.85;
const EMBER_GAIN_HOT = 1.9;

// [landing] Where on the VERBATIM ramp this field actually sits. The full 0..1
// range spends its bottom end in clay (#ab8c87 — a desaturated grey-pink that
// exists to read as established land, i.e. a cumulative-extent claim the landing
// explicitly does not make; see COLD_FLOOR) and its top in cream (#fff1c2 —
// bright but almost colourless). Both ends wash the field out, so the saturated
// red->orange heart of the ramp is what this samples. No colour is invented: the
// ramp is a continuous interpolation of the quoted stops, so every value in this
// window is already on it — this only chooses where on the quoted ramp to sit.
const RAMP_LO = 0.3;
const RAMP_HI = 0.92;

// [landing] CSS px per cell. The mark must stay BLOCKY — "blocky amber pixels"
// vs "crimson strands" is what tells the two halves apart (CLAUDE.md), and the
// real layer mandates nearest filtering — so this is a FINER pixel, never a
// smooth one. At 2 CSS px (3 device px at the DPR cap) the grid still reads
// unmistakably as pixels, and it is arguably closer to the real view, whose
// finest tiles are ~38 m/px and so are small on screen at most zooms.
const CELL_PX = 2;
// Raised with the finer cell so the cap doesn't just claw the size back. ~169k
// cells at 1500x900; the per-frame LUTs below are what make that affordable.
const MAX_CELLS = 190000;
const RAMP_LUT_N = 256;

const RAMP = RAMP_DEFAULTS.map(rampStopToVec4);

/** [verbatim] LossRasterLayer.ts:189. Cumulative mixes, NOT a segment lookup —
 * a segment lookup shifts the midtones. Ported literally. */
function fireRamp(r: number): [number, number, number] {
  let cr = RAMP[0][0];
  let cg = RAMP[0][1];
  let cb = RAMP[0][2];
  for (let i = 1; i < RAMP.length; i++) {
    const t = smoothstep(RAMP[i - 1][3], RAMP[i][3], r);
    cr += (RAMP[i][0] - cr) * t;
    cg += (RAMP[i][1] - cg) * t;
    cb += (RAMP[i][2] - cb) * t;
  }
  return [cr, cg, cb];
}

/** Ambient burning-pixel field. An ImageData grid upscaled with smoothing off —
 * the real layer mandates nearest filtering, so the blocky look is the faithful
 * one, not a corner cut. */
export function createEmberField(
  canvas: HTMLCanvasElement,
  side: Side,
  opts: FieldOptions = {}
): AmbientField {
  const fill = !!opts.fill;
  const rg = reachGeom(side, fill);
  const ctx = ctx2d(canvas);
  const grid = document.createElement('canvas');
  const gctx = ctx2d(grid);

  let img: ImageData | null = null;
  let cellBurnT: Float32Array | null = null;
  let cellCov: Float32Array | null = null; // raw coverage noise — thresholded per frame
  let cellGrit: Float32Array | null = null; // baked per-cell speckle multiplier
  let cellRad: Float32Array | null = null; // baked distance from the mask centre — see fieldReach
  let gw = 0;
  let gh = 0;
  let cssW = 0;
  let cssH = 0;
  let dpr = dprOf();
  let playhead = 0;

  // fireRamp depends only on heat -> precompute it. Saves ~24k ramp evaluations
  // per frame; 256 steps is far finer than 8-bit output can show.
  // Sampled across the RAMP_LO..RAMP_HI window rather than the full 0..1, so the
  // index is just heat and the window costs nothing at render time.
  const lut = new Uint8Array(RAMP_LUT_N * 3);
  for (let i = 0; i < RAMP_LUT_N; i++) {
    const heat = i / (RAMP_LUT_N - 1);
    const [r, g, b] = fireRamp(RAMP_LO + (RAMP_HI - RAMP_LO) * heat);
    lut[i * 3] = Math.round(r * 255);
    lut[i * 3 + 1] = Math.round(g * 255);
    lut[i * 3 + 2] = Math.round(b * 255);
  }

  // Per-FRAME lookups, rebuilt whenever ignite moves them. Both curves used to be
  // a Math.pow per cell, which was affordable at 24k cells and is not at 90k. A
  // 256-entry rebuild is ~256 pows per frame against ~75k saved — and heat/cov
  // are quantised to 8 bits on output anyway, so the table costs no fidelity.
  const heatLut = new Float32Array(RAMP_LUT_N); // heat -> alpha multiplier
  const covLut = new Float32Array(RAMP_LUT_N); // coverage -> base alpha
  let lutGamma = -1;
  let lutFloor = -1;
  function refreshLuts(gamma: number, floor: number) {
    if (gamma === lutGamma && floor === lutFloor) return;
    lutGamma = gamma;
    lutFloor = floor;
    for (let i = 0; i < RAMP_LUT_N; i++) {
      const t = i / (RAMP_LUT_N - 1);
      heatLut[i] = COLD_FLOOR + (1 - COLD_FLOOR) * Math.pow(t, gamma);
      // [verbatim] alpha = clamp(pow(density, 0.6) * 0.95, 0, 0.95)
      const density = smoothstep(floor, 0.85, t);
      covLut[i] = t < floor ? 0 : Math.min(0.95, Math.max(0, Math.pow(density, 0.6) * 0.95));
    }
  }

  function build(w: number, h: number) {
    let cell = CELL_PX;
    // keep the per-frame cell budget bounded on very large viewports
    while (Math.ceil(w / cell) * Math.ceil(h / cell) > MAX_CELLS) cell += 1;
    gw = Math.max(1, Math.ceil(w / cell));
    gh = Math.max(1, Math.ceil(h / cell));
    grid.width = gw;
    grid.height = gh;
    img = gctx ? gctx.createImageData(gw, gh) : null;
    cellBurnT = new Float32Array(gw * gh);
    cellCov = new Float32Array(gw * gh);
    cellGrit = new Float32Array(gw * gh);
    cellRad = new Float32Array(gw * gh);

    // px wavelengths -> cells, so the SHAPES keep their size whatever CELL_PX is.
    // The texture wavelengths below are already in cells and stay that way.
    const covLen = COV_LEN_PX / cell;
    const yearLen = YEAR_LEN_PX / cell;

    const seed = (side === 'left' ? 0xa5e1 : 0xc0ca) ^ (fill ? 0x3a9 : 0);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        // mirror x on the right half so the densest loss sits on the outer flank
        const fx = side === 'left' ? x : gw - 1 - x;

        // where there is loss at all — soft-edged organic patches, not a full
        // field. Stored RAW and thresholded per frame: the floor moves with
        // ignite (COV_FLOOR_REST/HOT), so a cell under it now may be burning a
        // moment later, and every cell has to arrive ready to light.
        cellCov[i] = valueNoise(fx / covLen, y / covLen, seed ^ 0x11);

        // synthetic loss year, patchy so neighbours burn as a cohort
        const yn = valueNoise(fx / yearLen, y / yearLen, seed ^ 0x22);
        const year = 1 + Math.min(24, Math.floor(yn * 25));

        // [verbatim] burnT = (year - 1) + jitter * noise — the wavy front edge
        const burn = valueNoise(fx / BURN_LEN_CELLS, y / BURN_LEN_CELLS, seed ^ 0x33);
        cellBurnT[i] = year - 1 + JITTER * burn;

        // [landing] a near-per-cell speckle, so a patch is never a flat slab of
        // one value — the real raster's density varies pixel to pixel
        const grit = valueNoise(fx / GRIT_LEN_CELLS, y / GRIT_LEN_CELLS, seed ^ 0x44);
        cellGrit[i] = 0.55 + 0.45 * grit;

        // real (unmirrored) position, so the reach grows from the actual flank
        cellRad[i] = maskRadius(x * cell + cell / 2, y * cell + cell / 2, w, h, rg);
      }
    }
    // NOTE: the real shader also pre-ages the 2001/2002 cohorts (baseAge/baseGrey)
    // because Hansen's first years absorb the pre-2001 clearing backlog. That is a
    // fix for a data artifact; with synthetic years there is no backlog to spread,
    // so it is deliberately not ported.
  }

  function resize(w: number, h: number) {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    dpr = dprOf();
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    build(cssW, cssH);
  }

  function render(dtSec: number, ignite: number) {
    if (!ctx || !gctx || !img || !cellBurnT || !cellCov || !cellGrit || !cellRad) return;
    playhead +=
      dtSec * (EMBER_YEARS_PER_SEC_REST + (EMBER_YEARS_PER_SEC_HOT - EMBER_YEARS_PER_SEC_REST) * ignite);

    // [landing] The ramp only reads as hot if it lands near-opaque: at ~0.5 alpha
    // a warm stop over ink composites to grey, and the burn front turns into grey
    // speckle. The real layer gets away with less because its embers sit on a
    // green canopy, not on black. Cold cells stay faint regardless — heatA, not
    // gain, is what suppresses them.
    const gain = EMBER_GAIN_REST + (EMBER_GAIN_HOT - EMBER_GAIN_REST) * ignite;
    const heatGamma = HEAT_GAMMA_REST + (HEAT_GAMMA_HOT - HEAT_GAMMA_REST) * ignite;
    const covFloor = COV_FLOOR_REST + (COV_FLOOR_HOT - COV_FLOOR_REST) * ignite;
    refreshLuts(heatGamma, covFloor);
    const d = img.data;
    const bT = cellBurnT;
    const cov = cellCov;
    const grit = cellGrit;
    const rad = cellRad;
    const N = RAMP_LUT_N - 1;
    // REACH — the same rule the scar field trims itself with, but applied per
    // cell here rather than as a composite pass, since this loop already writes
    // alpha. The burnt ground itself spreads out across the flank with ignite.
    const reach = fieldReach(ignite, rg);
    const reachIn = reach * (1 - FIELD_REACH_EDGE);

    for (let i = 0; i < bT.length; i++) {
      const o = i * 4;
      // cheapest possible rejects, and the two that move with ignite: outside the
      // field's current reach, or below the coverage floor (no loss here yet)
      const rd = rad[i];
      if (rd >= reach) {
        d[o + 3] = 0;
        continue;
      }
      const cv = cov[i];
      if (cv < covFloor) {
        d[o + 3] = 0;
        continue;
      }
      const fieldA = rd <= reachIn ? 1 : 1 - smoothstep(reachIn, reach, rd);
      const age = pmod(playhead - bT[i], EMBER_PERIOD);
      // [verbatim] heat = 1 - clamp(age / cool, 0, 1); 1 = at the front, 0 = long cooled
      const heat = 1 - Math.min(1, Math.max(0, age / COOL));
      // [verbatim] dissolve in as the front arrives — only ever partial for the
      // first FADE_IN years of a cycle, so skip the smoothstep the rest of the time
      const reveal = age < FADE_IN ? smoothstep(0, FADE_IN, age) : 1;
      // [landing] and fade out before re-igniting, so the cycle has no seam
      const fadeOut =
        age > EMBER_PERIOD - EMBER_TAIL ? 1 - smoothstep(EMBER_PERIOD - EMBER_TAIL, EMBER_PERIOD, age) : 1;
      const hi = (heat * N) | 0;
      // base coverage alpha [verbatim curve, via LUT] * [landing] per-cell speckle
      const a = covLut[(cv * N) | 0] * grit[i] * reveal * fadeOut * gain * heatLut[hi] * fieldA;
      if (a < 0.02) {
        // [verbatim] the shader's alpha discard
        d[o + 3] = 0;
        continue;
      }
      d[o] = lut[hi * 3];
      d[o + 1] = lut[hi * 3 + 1];
      d[o + 2] = lut[hi * 3 + 2];
      // gain can exceed 1 (EMBER_GAIN_HOT), so clamp rather than lean on the
      // Uint8ClampedArray to do it — the intent should be readable here
      d[o + 3] = Math.min(255, (a * 255) | 0);
    }

    gctx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // nearest-neighbour upscale: the real layer requires nearest filtering, and
    // the hard cell edges are the point — these are burning PIXELS
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(grid, 0, 0, canvas.width, canvas.height);
  }

  function destroy() {
    img = null;
    cellBurnT = null;
    cellCov = null;
    cellGrit = null;
    cellRad = null;
    grid.width = 0;
    grid.height = 0;
  }

  return { resize, render, destroy };
}
