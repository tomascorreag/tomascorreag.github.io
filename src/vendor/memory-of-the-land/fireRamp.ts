// VENDORED from github.com/tomascorreag/MapColombia @ bc42ec4,
// frontend/src/lib/fireRamp.ts. Unmodified below this block.
//
// Burn-front colour ramp + timing knobs for the deforestation view's loss raster.
//
// Split out of LossRasterLayer.ts so this — pure data and pure functions, no
// deck.gl — can be imported by the landing page, whose ambient ember field
// quotes the same ramp. LossRasterLayer.ts re-exports everything here, so its
// public surface is unchanged and every existing call site still imports from
// there. This module is the single source of truth for the shipped look: if the
// ramp is retuned, the landing follows automatically instead of drifting.

// Recency-raster shader knobs. These defaults ARE the shipped look — the ?debug panel
// (defDebug.svelte.ts) mutates copies of them live; production always reads these.
export const FIRE_DEFAULTS = {
  // dissolve-in duration (timeline-years) as the playhead reaches each loss cohort
  fadeIn: 0.1,
  // burn-front cooling span (timeline-years): a cohort glows hot when the playhead
  // reaches it and cools to a deep ember over this many years behind the playhead
  cool: 8,
  // ignition spread in YEARS: each pixel's ignition is offset forward by jitter * noise
  // (noise 0..1). 0 = whole cohort lights at its year boundary; 1 = smeared across its own
  // year; >1 smears a cohort across MULTIPLE years so the annual front decorrelates instead
  // of sweeping as a synchronized wave. noiseScale sets the offset's spatial frequency, NOT
  // its amplitude — this knob is the amplitude.
  jitter: 2,
  // spatial frequency of that burn noise (cycles across the raster; higher = finer)
  noiseScale: 2000,
  // Pre-age the 2001/2002 baseline cohorts. Hansen's first years absorb the pre-2001
  // clearing backlog, so they should NOT ignite in unison. Each baseline pixel gets a
  // decorrelated noise age offset of up to baseAge * cool timeline-years — fractions land
  // past the cool span (already cold), the rest scatter across their lifecycle. 0 = off.
  baseAge: 1.5,
  // how strongly the long-cooled baseline desaturates toward grey (0 = stays ember warm,
  // 1 = fully grey at heat 0). Makes the oldest clearing read as established land.
  baseGrey: 0.5,
};
export type FireKnobs = typeof FIRE_DEFAULTS;

// Burn-front colour ramp: 4 stops keyed on heat (0 = long-cooled, 1 = at the front /
// freshly cleared). Muted clay/grey -> red -> orange -> hot near-white: the cold end
// reads as established/cooled land while the front glows, so cooled loss still shows as
// cumulative extent without screaming. The ?debug panel edits copies of these;
// production reads them verbatim. pos is the heat position.
export const RAMP_DEFAULTS: { hex: string; pos: number }[] = [
  { hex: '#ab8c87', pos: 0.0 }, // muted clay/grey (long cooled, established land)
  { hex: '#d11c0d', pos: 0.37 }, // red
  { hex: '#ff8a1f', pos: 0.71 }, // orange
  { hex: '#fff1c2', pos: 0.9 }, // hot near-white (at the front)
];

// hex "#rrggbb" -> [r,g,b,pos] in 0..1 for a vec4 ramp uniform.
export function rampStopToVec4(s: { hex: string; pos: number }): [number, number, number, number] {
  const h = s.hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
    s.pos,
  ];
}
