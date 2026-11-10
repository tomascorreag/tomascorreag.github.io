// VENDORED from github.com/tomascorreag/MapColombia @ bc42ec4,
// frontend/src/lib/noise.ts. Unmodified below this block.
//
// Deterministic noise primitives shared by the tendril field (tendrils.ts, the
// real violence view) and the landing page's ambient effects (landingEffects.ts).
//
// Extracted verbatim from tendrils.ts so both callers integrate curves through
// the SAME flow field — the landing's strands are recognisably the same species
// of mark as the archive's, without a second copy of the maths drifting out of
// sync. Pure functions, no state, no side effects: safe to import anywhere
// (notably the landing, which must not pull in the data layer).

/** Seeded PRNG. Deterministic: same seed -> same stream, across reloads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** integer-lattice hash -> [0, 1); deterministic value-noise basis */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x85ebca6b) ^ Math.imul(iy, 0xc2b2ae35) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** bilinear value noise over the integer lattice, smoothstep-eased */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(ix, iy, seed);
  const v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);
  return v00 + (v10 - v00) * fx + (v01 - v00) * fy + (v11 + v00 - v10 - v01) * fx * fy;
}

/** The subset of tendril geometry params that shape the flow field itself.
 * TendrilGeoParams extends this with the curve-budget knobs flowAngle ignores. */
export interface FlowParams {
  seed: number; // distinct per field: decorrelates noise AND curve seeding
  noiseLen1: number; // km wavelength, broad meander
  noiseLen2: number; // km wavelength, fine wiggle
  noiseAmp1: number; // turns contributed by the broad octave
  noiseAmp2: number; // turns contributed by the fine octave
}

/** flow direction (radians) at a km-space point; two octaves for organic curl */
export function flowAngle(xKm: number, yKm: number, p: FlowParams): number {
  const broad = valueNoise(xKm / p.noiseLen1, yKm / p.noiseLen1, p.seed);
  const fine = valueNoise(xKm / p.noiseLen2, yKm / p.noiseLen2, p.seed);
  return (broad * p.noiseAmp1 + fine * p.noiseAmp2) * 2 * Math.PI;
}

/** GLSL smoothstep, for ports of shader maths. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Non-negative modulo — JS `%` keeps the sign of the dividend. Used to phase
 * the landing's looping timelines without a negative first cycle. */
export function pmod(x: number, m: number): number {
  return ((x % m) + m) % m;
}
