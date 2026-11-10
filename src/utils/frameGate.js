/**
 * Frame-rate caps for the banners' rAF loops (ParallaxBanner, LandingBanner).
 *
 * A gate fires on the first frame after each boundary of a fixed time grid
 * (interval = 1000 / fps), so the cap holds whatever the display rate, and a
 * loop that skips frames just accumulates simulation time until it fires.
 *
 * Gates at the same rate are STAGGERED: each new one is offset by a fraction
 * of the interval, so two 30 fps thumbnails on a 60/120 Hz display land on
 * different vsync frames instead of doubling up on the same one.
 */

export const FPS_FULL = 120;
export const FPS_LITE = 30;

// Offsets step in 1/120 s, the shortest common vsync: on 60 Hz two adjacent
// slots still differ by a frame half the time, on 120 Hz always.
const STAGGER_MS = 1000 / 120;
const slots = new Map(); // fps → next slot index

export function createFrameGate(fps) {
  const interval = 1000 / fps;
  const n = slots.get(fps) ?? 0;
  slots.set(fps, n + 1);
  const steps = Math.max(1, Math.round(interval / STAGGER_MS));
  const offset = (n % steps) * STAGGER_MS;
  // Half a 120 Hz frame of slack: rAF timestamps jitter around vsync, and a
  // frame landing a hair before the boundary would otherwise slip a whole
  // display frame (a 120 Hz cap on a 120 Hz screen would drop to ~60).
  const slack = STAGGER_MS / 2;
  let lastCell = -Infinity;
  return {
    /** True if the loop should render on the frame at rAF time `now`. */
    due(now) {
      const cell = Math.floor((now - offset + slack) / interval);
      if (cell === lastCell) return false;
      lastCell = cell;
      return true;
    },
    reset() { lastCell = -Infinity; },
  };
}
