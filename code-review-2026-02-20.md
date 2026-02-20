# Code Review — 2026-02-20

## Commits Reviewed
- `9c3d0ce` optimizations
- `9e14c1c` Update style.css
- `5c41ff2` particle optimization pass 1
- `0722f43` Merge pull request (gaussianSplats MVP)
- `536f279` visual fixes

## Files Reviewed
- `src/components/ParticleMorph.js`
- `src/workers/sampleWorker.js`
- `src/config/particles.js`
- `src/config/device.js`
- `src/main.js`

## Summary
- Critical: 1 issue
- High: 4 issues
- Medium: 6 issues
- Low/Info: 6 notes

---

## Critical Issues

### [C1] XSS sanitiser is insufficient
- **File:** `src/main.js:1490`
- **Description:** `rawName` from URL params is sanitised with `.replace(/[<>]/g, '')` only. This is insufficient — it doesn't neutralise `javascript:` URIs, attribute injection, or other XSS vectors. The current use via `createTextNode()` is safe, but the pattern itself is dangerous: if `username` ever ends up in an `href`, `src`, or `innerHTML`, it's exploitable. `renderGeneralContent` also uses `innerHTML` (line 596) with currently-static data — a habit to break.
- **Suggested Fix:** Use a full HTML entity encoder for all 5 special chars (`& < > " '`), or use `DOMPurify`. At minimum flag every `innerHTML` assignment in the codebase for audit.

---

## High Priority Issues

### [H1] Worker never terminated on error in `prewarmSampleCache`
- **File:** `src/components/ParticleMorph.js:596`
- **Description:** If `createImageBitmap()` rejects (cross-origin, invalid rect, etc.) or the worker throws an error, `remaining` never reaches zero and `worker.terminate()` is never called. The worker thread lives for the lifetime of the tab and the transferred `ImageBitmap` objects are never released.
- **Suggested Fix:**
  ```js
  worker.onerror = () => worker.terminate();

  createImageBitmap(...)
    .then(bitmap => { worker.postMessage(..., [bitmap]); })
    .catch(() => { if (--remaining === 0) worker.terminate(); });
  ```

### [H2] `allSettled` evaluated before the particle physics loop
- **File:** `src/components/ParticleMorph.js:440`
- **Description:** `allSettled` is computed at the top of `animate()` using `this.settledCount`, but the loop below it increments `this.settledCount`. The animation always resolves one frame late — on the frame where the last particle settles, `allSettled` is still `false`. Additionally there is a redundant `render()` call: one always fires before the `if (allSettled)` block, then another fires inside it to snap particles.
- **Suggested Fix:** Move `allSettled` evaluation to after the particle loop.

### [H3] `getMediaAspectRatio` throws or returns NaN if media is null or unloaded
- **File:** `src/main.js:780`
- **Description:** If `media` is `null` (no `img`/`video` child) this throws a `TypeError` that crashes `openDetail`, leaving the mosaic stuck in `detail-mode` with no recovery. If the image hasn't loaded yet, `naturalWidth / naturalHeight = 0 / 0 = NaN`, silently forcing portrait layout on every item.
- **Suggested Fix:**
  ```js
  function getMediaAspectRatio(itemEl) {
    const media = itemEl.querySelector('img, video');
    if (!media) return 1;
    if (media.tagName === 'VIDEO') return media.videoWidth / media.videoHeight || 1;
    if (!media.complete || media.naturalWidth === 0) return 1;
    return media.naturalWidth / media.naturalHeight;
  }
  ```

### [H4] `resolveThumbnail` empty-string miss not guarded in `renderMosaic`
- **File:** `src/main.js:535`
- **Description:** `resolveThumbnail()` returns `''` on a miss. The splat path correctly guards `if (!url) return`, but in `renderMosaic` the thumbnail path does `media.src = resolveThumbnail(item.src)` with no check. Setting `src=""` causes a request to the page root — a silent 404 or worse.
- **Suggested Fix:**
  ```js
  const thumbUrl = resolveThumbnail(item.src);
  if (!thumbUrl) continue; // skip item or show placeholder
  media.src = thumbUrl;
  ```

---

## Medium Priority Issues

### [M1] CSS `clamp()` arguments inverted in `.detail-nav`
- **File:** `src/style.css` (`.detail-nav` rule)
- **Description:** `font-size: clamp(1.6rem, 1.8vw, 0.9rem)` has `min > max`. Browsers evaluate this as permanently `1.6rem` — the preferred and max values are dead. This is almost certainly the opposite of the intended behaviour.
- **Suggested Fix:** `font-size: clamp(0.9rem, 1.8vw, 1.6rem)`

### [M2] Sort-based shuffle is biased
- **File:** `src/components/ParticleMorph.js:352-353`
- **Description:** `[...arr].sort(() => Math.random() - 0.5)` produces a non-uniform distribution (well-documented V8 Timsort anti-pattern). Some source→target pairings are consistently preferred, making the particle scatter less organic than intended.
- **Suggested Fix:**
  ```js
  function fisherYates(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  ```

### [M3] `noise2D` per-particle offset is a coordinate shift, not a phase shift
- **File:** `src/components/ParticleMorph.js:473-476`
- **Description:** `p.noiseOffset` is added to `nx`/`ny` (coordinate offsets), so two particles at the same screen position still sample identical noise. This causes visible clustering. It should be used as a per-sine phase offset so each particle gets genuinely independent turbulence.
- **Suggested Fix:**
  ```js
  turbX = (
    Math.sin(nx * 1.2 + ny * 0.7 + p.noiseOffset) * 0.5 +
    Math.sin(nx * 0.5 - ny * 1.3 + p.noiseOffset + 2.1) * 0.3 +
    Math.sin(nx * 2.1 + ny * 1.1 + p.noiseOffset - 1.7) * 0.2
  ) * noiseAmplitude * turbDecay;
  ```

### [M4] Duplicate mobile detection logic
- **File:** `src/config/device.js:67` and `src/config/crt.js` (~line 55)
- **Description:** `isMobileDevice()` in `device.js` and `isMobile()` in `crt.js` are byte-for-byte identical. Two sources of truth = divergence risk when breakpoints change.
- **Suggested Fix:** Export `isMobileDevice` from `device.js`, import it in `crt.js`.

### [M5] `getGPURenderer()` called on resize — creates/destroys WebGL context each time
- **File:** `src/config/crt.js` (resize handler), `src/config/device.js:40`
- **Description:** The resize listener calls `getDeviceTier()` → `getGPURenderer()` which creates and immediately destroys a WebGL context. Context creation is expensive (~10-50ms). No debounce on the resize handler.
- **Suggested Fix:** Cache `getGPURenderer()` result at module load (it never changes at runtime). Add a debounce to the resize handler:
  ```js
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { /* tier check */ }, 150);
  });
  ```

### [M6] `mosaic` fade uses `setTimeout` instead of `transitionend`
- **File:** `src/main.js:513`
- **Description:** `await new Promise(r => setTimeout(r, MOSAIC_CONFIG.fadeDuration))` — the hardcoded duration must stay in sync with the CSS transition. If one changes without the other, either the DOM rebuilds mid-fade (visual glitch) or there's a sluggish delay.
- **Suggested Fix:** Listen to `transitionend` with a fallback timeout:
  ```js
  await new Promise(r => {
    const t = setTimeout(r, MOSAIC_CONFIG.fadeDuration + 50); // fallback
    mosaicEl.addEventListener('transitionend', () => { clearTimeout(t); r(); }, { once: true });
  });
  ```

---

## Info / Low Priority

### [I1] `getParticleConfig` returns frozen object OR mutable spread — inconsistent
- **File:** `src/main.js:24-30`
- **Description:** Returns the frozen `PARTICLE_CONFIG` directly when no tier override applies, but a new mutable spread when overrides exist. Callers get different types depending on tier. No current mutation bug, but a footgun.
- **Suggested Fix:** Always return a spread: `return { ...PARTICLE_CONFIG, ...(tierOverrides || {}) }`

### [I2] `computeCanvasBounds` produces NaN if called with no particles
- **File:** `src/components/ParticleMorph.js:152`
- **Description:** If `this.particles` is empty, `minX` stays `Infinity` and `canvasWidth = Math.min(...) - Infinity = NaN`. Call order in `start()` is correct, but worth asserting defensively.
- **Suggested Fix:** Add `if (!this.particles.length) return;` at the top of `computeCanvasBounds`.

### [I3] `_cellCache` is unbounded
- **File:** `src/components/ParticleMorph.js:35`
- **Description:** Cache has no eviction policy. Fine for the current 4-frame sprite, but worth documenting. Dev hot reloads with cache-busted URLs will accumulate entries.

### [I4] Double render on final frame in `animate()`
- **File:** `src/components/ParticleMorph.js:502-513`
- **Description:** `render()` is called unconditionally before the `if (allSettled)` check, then called again inside it to snap particles. The second call is wasted work when combined with fixing [H2].

### [I5] `render()` iterates all particles twice per frame
- **File:** `src/components/ParticleMorph.js:541-568`
- **Description:** Two separate loops (opaque pass + partial alpha pass). Correct for batching state changes. Could be optimised with two pre-allocated arrays populated during the physics loop, but this is a micro-optimisation given current particle counts.

### [I6] `earlyMouseHandler` registered directly on `document`, bypassing `Sprite` cleanup tracking
- **File:** `src/components/Rabbit.js` (~line 69)
- **Description:** Bypasses `Sprite.addEventListener` which tracks listeners for cleanup. Works because `destroy()` calls `disableMouseReaction()`, but it's inconsistent and a footgun if that call order ever changes.
