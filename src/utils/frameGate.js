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
 *
 * Degradation order: thumbnail loops give up update rate before the page
 * gives up frames. Two things lower every gate's rate below its nominal fps:
 *   - busy: the page is running its own motion (a portfolio deck slide, the
 *     document wipe) and calls markBusy(ms). Gates drop to FPS_BUSY for that
 *     window, so the loops leave the frame budget to the motion.
 *   - governor: every gate feeds the shared rAF timestamps into a dropped-frame
 *     counter. Sustained drops step the cap down (120 → 60 → 30 → 15); a few
 *     clean seconds step it back up, one level at a time.
 * Gates whose nominal fps is already under a cap are unaffected by it.
 */

export const FPS_FULL = 120;
export const FPS_LITE = 30;
// Thumbnail rate while the page itself is animating (markBusy).
export const FPS_BUSY = 30;

// Offsets step in 1/120 s, the shortest common vsync: on 60 Hz two adjacent
// slots still differ by a frame half the time, on 120 Hz always.
const STAGGER_MS = 1000 / 120;
const slots = new Map(); // nominal fps → next slot index

/* ── Busy window ── */

let busyUntil = 0;

/** Throttle thumbnail loops to FPS_BUSY for the next `ms` (extends, never shortens). */
export function markBusy(ms) {
  busyUntil = Math.max(busyUntil, performance.now() + ms);
}

/* ── Governor ── */

// Cap ladder; Infinity = no cap beyond each gate's own fps.
const LADDER = [Infinity, 60, 30, 15];
const WINDOW = 30;        // frames per judgement window
const DROP_LIMIT = 4;     // missed vsyncs per window that trigger a step down
const CLEAN_LIMIT = 1;    // missed vsyncs per window that still count as clean
const STEP_UP_MS = 3000;  // clean time needed before stepping back up
const HOLD_MS = 1500;     // after a step down, let it take effect before judging again
const GAP_MS = 250;       // longer gaps are tab switches / stalled loops, not drops

let level = 0;            // index into LADDER
let lastStamp = -1;       // rAF timestamp of the last sampled frame
let vsync = 0;            // refresh-interval estimate (0 = not known yet)
let minDelta = Infinity;  // smallest delta in the current window (→ vsync)
let frames = 0;
let missed = 0;
let cleanSince = 0;
let holdUntil = 0;

function setLevel(next, now) {
  if (next === level) return;
  level = next;
  if (import.meta.env.DEV) console.debug(`[frameGate] thumbnail cap → ${LADDER[level]} fps`);
  holdUntil = now + HOLD_MS;
  cleanSince = now;
}

// Called by every gate on every frame. rAF hands all callbacks of one frame
// the same timestamp, so the first call per frame samples and the rest no-op.
function sample(now) {
  if (now === lastStamp) return;
  const d = now - lastStamp;
  const first = lastStamp < 0;
  lastStamp = now;
  if (first || d <= 0 || d > GAP_MS) return;

  if (d < minDelta) minDelta = d;
  // A delta of k refresh intervals means k − 1 vsyncs produced no frame.
  // Not counted while busy: those drops are the page's own motion (first
  // raster of a sliding card), which a lower thumbnail cap wouldn't fix, and
  // the busy cap already applies.
  if (vsync && d > vsync * 1.5 && now >= busyUntil) missed += Math.round(d / vsync) - 1;

  if (++frames < WINDOW) return;
  // Refresh rate = fastest frame of the window (re-estimated each window, so a
  // move to another monitor is picked up). Ignore implausible values.
  if (minDelta >= 4 && minDelta <= 60) vsync = minDelta;
  const m = missed;
  frames = 0;
  missed = 0;
  minDelta = Infinity;
  if (!vsync || now < holdUntil) return;

  if (m >= DROP_LIMIT) {
    if (level < LADDER.length - 1) setLevel(level + 1, now);
    else cleanSince = now;
  } else if (m <= CLEAN_LIMIT) {
    if (level > 0 && now - cleanSince >= STEP_UP_MS) setLevel(level - 1, now);
  } else {
    cleanSince = now;
  }
}

/** Current governor cap in fps (Infinity = uncapped). For debugging. */
export function thumbnailCap() {
  return LADDER[level];
}

/* ── Gates ── */

export function createFrameGate(fps) {
  const n = slots.get(fps) ?? 0;
  slots.set(fps, n + 1);
  // Half a 120 Hz frame of slack: rAF timestamps jitter around vsync, and a
  // frame landing a hair before the boundary would otherwise slip a whole
  // display frame (a 120 Hz cap on a 120 Hz screen would drop to ~60).
  const slack = STAGGER_MS / 2;
  let interval = 0;
  let offset = 0;
  let lastCell = -Infinity;

  return {
    /** True if the loop should render on the frame at rAF time `now`. */
    due(now) {
      sample(now);
      let eff = Math.min(fps, LADDER[level]);
      if (now < busyUntil) eff = Math.min(eff, FPS_BUSY);
      const iv = 1000 / eff;
      if (iv !== interval) {
        // Rate changed: re-derive this gate's stagger slot for the new grid
        // and fire on this frame (the old cell index means nothing on it).
        interval = iv;
        const steps = Math.max(1, Math.round(interval / STAGGER_MS));
        offset = (n % steps) * STAGGER_MS;
        lastCell = -Infinity;
      }
      const cell = Math.floor((now - offset + slack) / interval);
      if (cell === lastCell) return false;
      lastCell = cell;
      return true;
    },
    /** True while busy or the governor holds this gate under its nominal fps. */
    get throttled() {
      return interval > 1000 / fps + 1e-6;
    },
    reset() { lastCell = -Infinity; },
  };
}
