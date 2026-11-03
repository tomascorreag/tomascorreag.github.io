# Code Review — 2026-02-18

## Files Reviewed
- `src/components/SplatViewer.js` (new)
- `src/config/device.js` (new)
- `src/config/splats.js` (new)
- `src/config/crt.js` (modified)
- `src/config/particles.js` (modified)
- `src/config/content.js` (modified)
- `src/main.js` (modified)
- `src/style.css` (modified)
- `vite.config.js` (modified)

## Summary
- Critical: 0
- High: 3
- Medium: 4
- Low: 3

---

## High Priority Issues

### [H1] `isNavigating` not released on bounds-check early exit
- **File:** `src/main.js` ~line 1340
- **Description:** The early return when `nextIdx` is out of bounds exits without setting `isNavigating = false`. After hitting the boundary, the user can never navigate again — arrow keys silently do nothing for the rest of the session.
- **Suggested Fix:** Move `isNavigating = true` to after both bounds checks, or add the release before the early return:
```js
if (nextIdx < 0 || nextIdx >= currentCategoryItems.length) {
  isNavigating = false;
  return;
}
```

### [H2] `getGPURenderer()` leaks a WebGL context
- **File:** `src/config/device.js` lines 40–50
- **Description:** Creates a canvas + WebGL context to read the GPU string but never releases it. Browsers cap contexts per page (~8–16). Currently only runs once at module load so not immediately dangerous, but the exported function could be called again.
- **Suggested Fix:**
```js
export function getGPURenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return null;
  }
}
```

### [H3] Empty URL from `resolveSplat()` reaches `viewer.mount()` unguarded
- **File:** `src/main.js`, `mountSplatViewer` function
- **Description:** If `resolveSplat()` returns `''` (file not found in glob), the empty string is passed directly to `SplatViewer.mount()` which passes it to `SplatMesh`. This triggers a `fetch('')` — a request to the page root — which returns HTML, fails to parse, eventually fires `onError`, but shows a loading spinner for the full timeout. The hover-prefetch path correctly guards this; the mount path does not.
- **Suggested Fix:** Add guard before `viewer.mount()`:
```js
const splatUrl = resolveSplat(itemData.splat.file);
if (!splatUrl) {
  container.classList.add('error');
  return viewer;
}
```

---

## Medium Priority Issues

### [M1] `import` statement appears after `Object.freeze()` in `crt.js`
- **File:** `src/config/crt.js` line ~49
- **Description:** `import { deviceTier, getDeviceTier } from './device.js'` appears after the `CRT_CONFIG` const. Valid JS (imports are hoisted), but non-idiomatic, confusing to read, and will be flagged by most linters.
- **Suggested Fix:** Move all imports to the top of the file.

### [M2] `deviceTier` (cached) vs `getDeviceTier()` (fresh) inconsistency undocumented
- **File:** `src/config/splats.js` and `src/config/crt.js`
- **Description:** Splats use the cached `deviceTier` export (tier fixed at load time), while CRT uses `getDeviceTier()` fresh on each call (responds to resize). The behavior difference is intentional — you don't want to change splat quality mid-session — but it is not documented, creating a maintenance trap.
- **Suggested Fix:** Add a comment in `splats.js` explaining why `deviceTier` is used instead of `getDeviceTier()`.

### [M3] `switchToAndOpenDetail` duplicates `selectNavItem` side effects
- **File:** `src/main.js` lines 1210–1229
- **Description:** The function manually replicates `.selected` class management from `selectNavItem()` because `selectNavItem()` doesn't return the `renderMosaic()` Promise. If `selectNavItem` gains new side effects (animations, analytics), they'll be silently skipped by this path.
- **Suggested Fix:** Refactor `selectNavItem()` to return the `renderMosaic()` Promise, then reuse it here. (Minor refactor, not a one-liner.)

### [M4] Hardcoded `itemIndex` values in skill thumbnails are fragile
- **File:** `src/config/content.js` lines 95–98
- **Description:** `{ category: '3D Art', itemIndex: 1 }` — the runtime guard (`if (!item) continue`) prevents crashes, but reordering `CATEGORIES['3D Art']` without updating these indices will silently produce empty thumbnail slots.
- **Suggested Fix:** Consider keying by title/id instead of index if the content set grows. Acceptable as-is for a small stable portfolio.

---

## Low Priority / Cosmetic

### [L1] CSS double semicolon on `.general-name`
- **File:** `src/style.css` line ~721
- **Description:** `filter: blur(calc(var(--crt-blur, 0.4px) * 0.75));;` — double semicolon. Ignored by CSS parser, but sloppy.
- **Suggested Fix:** Remove the extra `;`.

### [L2] `font-weight: 150` has near-zero font support
- **File:** `src/style.css` line ~717
- **Description:** Valid CSS (Fonts Level 4), but virtually no fonts ship with a weight axis covering 150. Browser will clamp to nearest available (100 or 200). If no variable font loaded with sub-200 range, use `100` or `200` explicitly.

### [L3] Duplicate JSDoc on `SplatViewer.mount()` with phantom `onProgress` param
- **File:** `src/components/SplatViewer.js` lines 33–49
- **Description:** Two consecutive JSDoc blocks for the same method. The first mentions `opts.onProgress` which is not implemented. Remove the first block.

---

## What Is Done Well

- **Session ID + navigation mutex**: The `detailSessionId` + `isNavigating` combination correctly covers both race conditions (stale async mounts, concurrent navigation). This is the hardest part of the async WebGL lifecycle to get right.
- **`destroySplatViewer` ordering**: Reads `viewer.renderer?.domElement?.parentElement` before `destroy()` is called — correct, the pre-saved ref stays valid.
- **Code splitting**: Lazy dynamic `import('./components/SplatViewer.js')` with module promise caching is architecturally correct. ~600KB never loads for users who don't open a splat.
- **Vite glob pattern**: `import.meta.glob` with `eager: true` at config layer is the right approach, survives production builds.
- **`import` hoisting**: The out-of-order import in `crt.js` is a style issue only — no runtime bug.
- **`Object.freeze` note**: The freeze is shallow — nested tier objects are technically mutable — but nothing mutates them in practice.
