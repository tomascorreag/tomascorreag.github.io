# Optimization Report — 2026-06-11

Read-only audit. No changes applied. Four parallel reviews (desktop runtime, mobile, CSS/rendering, asset inventory) + manual verification of headline claims. All file:line refs verified against source; byte counts from `stat`/`ffprobe`.

## Executive summary

The site ships **~238 MB of assets** to dist, of which **~15 MB is entirely unreferenced** and **~117 MB is PNG/JPG fallbacks** that modern browsers never download but every byte of which sits in the repo/deploy. The single worst file is a **48 MB / 61 Mbps mp4 master** shipped verbatim as a "fallback". At runtime, the biggest costs are a **32 Hz `setInterval` that invalidates a `:root` CSS variable forever** (feeding full-screen text-shadow + blur repaints), **every mosaic/feed video autoplaying simultaneously with no offscreen pause**, and **`prefers-reduced-motion` deliberately disabled** by a leftover dev hack. Mobile additionally pays for the full 92 KB desktop stylesheet, render-blocking, before its own CSS.

Top 5 by impact:

| # | Finding | Est. impact |
|---|---|---|
| 1 | Re-encode `thumb1.mp4` (61 Mbps master shipped as-is) | −43 MB |
| 2 | Resize >2K images to ≤1920px + re-encode fallbacks + full AVIF coverage | ~126 MB → ~15 MB images |
| 3 | Glow-noise interval: 32 Hz `:root` invalidation, never stopped, not gated | Idle CPU/battery burn for entire session |
| 4 | Videos: all autoplay at once, never paused offscreen, preloaded in full on metered connections | ~19 MB cellular on one tab + N decode pipelines |
| 5 | `reduceMotion = false` dev hack + commented-out CSS block shipped | Accessibility regression, all motion forced on |

---

## A. Asset weight (highest ROI)

### A1. Unreferenced files ship anyway — 25 files, 15.0 MB (verified)
`import.meta.glob` in `src/config/content.js:36` eagerly maps **everything** under `assets/thumbnails/`, so unreferenced files get hashed into dist. Cross-referenced against CATEGORIES (src + gallery), GAMES (src + spritesheet), all `![...](...)` paths in page markdown, and greps of all src JS:

| Group | Files | Bytes |
|---|---|---|
| `3d-art/thumb1_static.{png,avif,webp}` (png alone 7.7 MB) | 3 | 8,027,292 |
| `3d-assets/paint_details/paintThumb.*` | 3 | 1,862,168 |
| `3d-assets/paint_details/thumbnail.*` | 3 | 1,657,783 |
| `3d-art/portada5Thumb.*` | 3 | 1,498,926 |
| `3d-art/donutThumb.*` | 3 | 1,125,936 |
| `3d-assets/toonThumb.{jpg,avif,webp}` (item src is .webm; stills unused) | 3 | 474,157 |
| `3d-assets/benchThumb.*` | 3 | 268,442 |
| `Games/Paramo/MainTitle_animated.webp` + `Games/Matrix/Neo_run_spriteSheet.webp` (spritesheets resolve via `resolveThumbnail()` only — webp variants never served) | 2 | 51,348 |
| `Games/Matrix/Neo_idle_spriteSheet.{png,webp}` (only Neo_run used) | 2 | 8,058 |
| **Total** | **25** | **~15.0 MB** |

Options: delete the files, or move non-portfolio files out of the glob path. (Note: spritesheet `.webp` siblings being dead is structural — `createSpritesheetElement` at `src/utils/media.js:102` bypasses `variantsFor()`.)

### A2. Oversized source images — no resizing anywhere (verified)
`scripts/optimize-assets.sh` **never resizes** (no scale filter; confirmed by reading the script). Detail view maxes ~1920px wide; these ship at source dims:

| Image | Dims | PNG/JPG | Best served variant |
|---|---|---|---|
| `3d-art/thumb2.png` (Ardo) | 2160×2160 | **20.1 MB** | avif OK |
| `3d-assets/paintThumb.png` | 3840×2160 | 15.5 MB | **webp 1.45 MB — no avif** |
| `3d-art/ascensionThumb.png` | (2K-class) | 15.0 MB | avif OK |
| `3d-art/marsThumb.png` | 4096×2048 | 9.4 MB | avif 465 KB — still large |
| `3d-assets/fabricThumb.png` | 1920×960 | 9.0 MB | **webp 319 KB — no avif** |
| `3d-art/thumb3.jpeg` (Menpō) | 2048×4096 | 2.8 MB | webp 855 KB |
| `3d-art/ciudadFaroThumb.png` | 2480×2480 | 5.2 MB | avif OK |

- **13 referenced images have no AVIF** (script skips alpha-bearing PNGs: all eye_details, fabric, fabric_details, flesh, paint). For those, webp is the best served format.
- PNG/JPG fallbacks total **~117 MB (49% of dist)** — served only to browsers without webp+avif (effectively none today), but shipped/deployed regardless. Fallbacks could be resized + re-encoded q~85 → ~10 MB.

### A3. Video encodes (all 6 referenced; ffprobe-verified)

| Video | Dims / dur | MP4 | WebM | Problem |
|---|---|---|---|---|
| `3d-art/thumb1` | 1920×1080, 6.3s | **48.3 MB @ 61.4 Mbps** | 8.0 MB @ 10.2 Mbps | mp4 is an unencoded master; CRF 23 ≈ 4–6 MB. WebM also fat; VP9 CRF~34 ≈ 2–4 MB |
| `3d-art/Frenesi` | 720×720, 3m22s | 16.8 MB | 7.8 MB | mp4 fallback 2.1× webm; CRF 25–26 → ~10 MB |
| `3d-art/starWarsChaseThumb` | **2160×2160**, 5.9s | 4.4 MB | 2.4 MB | 4K-square for a 2×2 card; 1080² → ~¼ size |
| `3d-assets/toonThumb` | 1920×1080, 5.8s | 1.4 MB | **2.8 MB** | **WebM 2× larger than mp4 yet served first** (`variantsFor` prefers webm, `content.js:136`) |
| `3d-art/bioshockThumb` | 1080×1080, 8.4s | 0.63 MB | **1.06 MB** | Same inversion, +68% |
| `toon_details/toonHead` | 1080×1080, 13.7s | 2.3 MB | 1.2 MB | OK |

Root causes (from reading `optimize-assets.sh`): (1) the older file in a pair is treated as the untouchable "source" and never re-encoded — hence the 61 Mbps master ships; (2) WebM is encoded at fixed CRF 32 *from the already-compressed mp4*, inflating efficient sources — hence the inversions. Fix idea: cap output bitrate / skip webm when it exceeds the mp4, and re-encode masters into properly-sized fallbacks.

### A4. Weight scenarios

| Scenario | Est. dist |
|---|---|
| Current | 238 MB |
| + delete unreferenced (A1) | 223 MB (verified delta) |
| + resize/re-encode images (A2) | ~113–116 MB (estimate) |
| + re-encode videos (A3) | **~52–56 MB** (estimate; Frenesí's 3:21 runtime keeps ~18 MB legitimately) |

### A5. `src/assets/splats/` is empty
SplatViewer + Spark infrastructure ships (~974 KB lazy chunk — correctly code-split, never in initial bundle) but there is zero splat content. No action needed for perf (chunk only loads on splat click, and no items have `type: 'splat'`); noting for content planning.

---

## B. Runtime / main-thread (desktop)

### B1. HIGH — Glow-noise interval: 32 Hz `:root` invalidation, forever, ungated
`src/config/crt.js:148-157` — `setInterval` at `glowNoiseFrequency: 32` (crt.js:24) writes `--crt-glow-intensity` onto `document.documentElement`. Started unconditionally (`desktop.js:136`); `stopGlowNoise()` (crt.js:160) is **never called** (grep-verified). The variable feeds multi-layer `text-shadow` on every `.crt-effects` element (style.css:593-595 et al.), under the terminal's full-screen `filter: blur()` — so each tick can repaint a viewport-sized blurred layer, ~32×/s, for the whole session, in every state (mosaic, detail, deck). Not gated by device tier or reduced-motion. `setInterval` keeps firing in hidden tabs (throttled to 1 Hz, not zero).
**Fix:** drive from rAF (auto-pauses hidden), dirty-check before `setProperty`, scope variable to the terminal container, gate behind tier + reduced-motion, stop when terminal not visible.

### B2. HIGH — All videos autoplay simultaneously; nothing ever pauses them
`src/utils/media.js:52-63` — every video defaults `autoplay: true, loop: true`; `preload: 'metadata'` is moot since autoplay forces full download. Grep-verified: **zero** `pause()` calls outside the user toggle (VideoControls.js:121), zero `visibilitychange` listeners, and the only IntersectionObserver in the app is the article text-reveal (desktop.js:820). When a detail opens, siblings get `.fading-out` = `opacity: 0` only (style.css:1719-1722) — hidden videos keep decoding and looping. PortfolioDeck: every slide's video plays even when translated offscreen; `closeDoc` (PortfolioDeck.js:465-470) admits the doc's video keeps playing behind the closed overlay.
**Fix:** one IntersectionObserver (`play()`/`pause()` on visibility) + pause-all on `visibilitychange` + pause in `closeDoc`.

### B3. HIGH — `preloadThumbnails` downloads every asset in every category, including full video bodies, with no gating
`src/desktop.js:461-501` — `fetch(url, {priority: 'low'})` per video fetches the **entire file**. `device.js` exposes `getSaveData()`, `deviceTier`, `effectiveType` (device.js:62-69) but none are consulted. A metered visitor pays tens of MB for content they may never open.
**Fix:** skip videos (or everything) when `saveData` / `low` tier / non-4g.

### B4. MED — SplatViewer renders continuously when idle
`src/components/SplatViewer.js:111-127` — unconditional rAF render loop; `autoRotate: false` so an idle viewer does full-rate GPU sort/raster for nothing. Also `destroy()` (160-164) lacks `renderer.forceContextLoss()` — GL context lingers until GC; rapid open/close can exhaust the ~8–16 context cap despite the session-ID guard.
**Fix:** render on OrbitControls `change` + damping tail; add forceContextLoss.

### B5. MED — Rabbit: `getBoundingClientRect()` per mousemove, document-level, lifetime of the rabbit
`src/components/Rabbit.js:352-377, 266` — forced layout read per pointer event (up to 1000/s on high-Hz mice). The rect only changes during jump/drop.
**Fix:** cache rect on settle, recompute on jump end/resize; rAF-throttle the handler.

### B6. MED — CrtScrollbar drag does 5 layout reads per pointermove, uncoalesced
`src/components/CrtScrollbar.js:57-69` — rect/clientHeight/offsetHeight/scrollHeight reads + scrollTop write per event, interleaving with the (correctly rAF-coalesced) scroll handler.
**Fix:** cache geometry on pointerdown; route moves through the same rAF gate.

### B7. MED — No intrinsic dimensions on `createMediaElement` images → CLS
`src/utils/media.js:38-46` — `loading=lazy`/`decoding=async` are set (good) but no width/height/aspect-ratio. Mosaic cells are grid-sized (safe), but article bodies, galleries, and mobile feed cards lay out at 0-height until decode → layout shift while scrolling.
**Fix:** store dims/aspect in content.js entries; set `img.width/height`.

### B8. LOW — Spritesheet WAAPI loops animate `background-position` (paint-side) at `iterations: Infinity` even when covered/offscreen (`media.js:158-161`). Pause when host not visible.

### B9. LOW — PortfolioDeck `relayout` on raw resize, read/write interleaved per slide (PortfolioDeck.js:511-519, 98-121). Debounce + batch reads before writes. Matters most on iOS address-bar resize streams.

---

## C. CSS / rendering

### C1. HIGH — Full-screen `filter: blur() brightness()` on the always-visible terminal
`src/style.css:579-596` — `.terminal.crt-effects` is 100%×100% (style.css:191-193) and carries `filter: blur(var(--crt-blur)) brightness(...)`; crt.js injects **1.5px** blur on mid/high tier (crt.js:29). A filter on a full-screen ancestor rasterizes the subtree and re-runs a viewport-sized Gaussian blur on every invalidation inside it — which happens at minimum every 500 ms forever (`.cursor` blink, style.css:255-258) and at 32 Hz during B1 bursts. This + B1 is the single most expensive standing cost on the site.
**Fix:** apply blur to the small text wrapper instead of the full-screen container, or bake softness into rendering; keep brightness (cheap).
*(Note: magnitude inferred from standard Chromium compositor behavior; worth one DevTools Performance trace to confirm before prioritizing.)*

### C2. MED — `will-change: transform` on every mosaic thumbnail (`style.css:835-838`) — permanent compositor layer per item, dozens at once (GPU memory w×h×4 each). Move to `:hover`/`.focused` or drop.

### C3. MED — Animations on layout properties:
- Rabbit jump animates `margin-left` / `top` under a 6-pass filter chain (style.css:463-487, 400-410, 606-611) → layout + multi-blur re-raster per step. Use `transform: translate`.
- `.deck-doc-wipe` transitions `top` with 4 large box-shadows; `will-change: top` is a no-op (style.css:2941-2992). Use `translateY`.
- Gallery fullscreen + detail transitions animate `left/top/width/height` on near-viewport media (style.css:2283-2288, 2335-2342). Reuse the existing FLIP pattern.

### C4. MED — 92 KB render-blocking CSS for every visitor; ~22% is deck-only
`index.html:69` loads all of style.css blocking. The deck section (style.css:2405-3098) is only used on `?p=` visits and is mounted by a dynamically imported component — natural split point (the mobile.css pattern already proves it works, mobile.js:21). Mobile is worse off: see D1.

### C5. MED — Fonts:
- **8 of 10 `@font-face` declarations are dead** — all Space Mono faces (style.css:37-111); zero `font-family` usages anywhere. ~136 KB of font files ship to dist + dead CSS in the blocking file. Delete or use.
- **No font preload** — the landing experience is typed terminal text in Martian Mono with `font-display: swap`; first visitors watch the very first thing on the site swap fonts. `MartianMono-latin.woff2` is 23.5 KB. Preload it.

### C6. LOW — `.general-content` carries `filter: blur+brightness` over a scrolling panel (style.css:1465-1489) — re-rasters on scroll. / Duplicate `.detail-transitioning` selector blocks (style.css:2189 vs 2335). / `.crt-scrollbar-thumb` `will-change: transform, height` — `height` half is wasted (style.css:1092).

### Verified non-issues
Scanline overlays are static gradients — painted once, composited (style.css:536-562, mobile.css:80-95). No `backdrop-filter` / `mix-blend-mode` anywhere (grep-confirmed). Font subsetting + `font-display: swap` well done. mobile.css correctly code-split. `content-visibility: auto` on mobile feed cards is a genuine win.

---

## D. Mobile-specific

### D1. HIGH — Mobile downloads the full desktop stylesheet, render-blocking, then its own on top
`index.html:69` ships style.css (92,280 B raw / **23.2 KB gzip**) to phones; mobile.css (7.6 KB gzip) loads additionally via `mobile.js:21`. ~85–90% of style.css is desktop-only dead weight on phones — but mobile can't drop it entirely: fonts, `.vc-*` video-control styles, splat spinner, and the `html.mobile-mode` kill-switch (style.css:2399-2403) live there.
**Fix:** extract shared base (fonts + VideoControls + spinner + kill-switch) into a small blocking `base.css`; move desktop scene CSS behind the desktop chunk, deck CSS behind the deck chunk (C4).

### D2. HIGH — ~19 MB of autoplaying video on the Art tab over cellular
Art-tab webm sum: thumb1 8.0 + Frenesí 7.8 + starWars 2.4 + bioshock 1.1 ≈ **19.3 MB**, all autoplaying (B2), none paused offscreen — `content-visibility: auto` (mobile.css:694) skips rendering but not download/playback, and videos behind an open sheet keep playing. mobile.js never imports device.js, so **Save-Data users get the full payload** (grep-verified).
**Fix:** IntersectionObserver pause/swap-to-poster + Save-Data → tap-to-play posters + re-encode (A3).

### D3. HIGH — No responsive sizing: phones download desktop-resolution images
`media.js:35` emits a single srcset candidate, no width descriptors, no `sizes`. A ~400px card pulls marsThumb.webp 929 KB, thumb3.webp 855 KB, etc. Conservatively 3–5 MB of image bytes per feed where ~400 KB of 800w variants would do — plus decode cost on low-end phones.
**Fix:** emit -480w/-960w/-1920w tiers in optimize-assets and wire `srcset`/`sizes` in `createMediaElement`. (Same change fixes A2's oversized-dims problem.)

### D4. MED — Device-routing mismatch for tablets: `main.js:24-25` routes any coarse-pointer device to mobile, but `device.js:72-75` only flags mobile at width ≤768 — a 1280px Android tablet lands in the mobile shell with `deviceTier: 'high'` → SH3 + 2x pixelRatio splats (splats.js:41-43) inside a mobile sheet. Align the checks.

### D5. MED — CSS waterfall: mobile shell CSS can't start downloading until main.js executes (index.html:87 → dynamic import → split CSS). Add `modulepreload` hints for the chunks.

### D6. LOW — `vh` instead of `svh`/`dvh` for sheet media sizing (mobile.css:946-947, 716) — oversized hero with iOS toolbar visible (shell itself correctly uses `100dvh`). / `mask-image` on the scroll container (mobile.css:453-459) re-rasters during scroll on some Android GPUs — two fixed overlay strips are cheaper. / All images lazy including above-the-fold — first card should get `lazy: false` + `fetchpriority=high` (mild LCP penalty). / `preload: 'auto'` latent path for non-card thumbs (mobile.js:565, 572-575).

### Verified good on mobile
Passive touch listeners everywhere, `overscroll-behavior: none`, `contain` on scrollers, no permanent rAF loops in mobile.js, desktop CRT effects fully disabled pre-paint via `html.mobile-mode`, mobile scanlines static, video attrs correct (muted-before-autoplay, playsInline), mobile gets SH0/1x splats (modulo D4).

---

## E. Reduced motion / accessibility-perf

### E1. HIGH — Dev hack ships: reduced-motion forced off
- `src/components/PortfolioDeck.js:36-38` — `const reduceMotion = false;` with the comment "DEV: temporarily forced off… Restore to: matchMedia('(prefers-reduced-motion: reduce)').matches || deviceTier === 'low'". **Verified in source.**
- The matching CSS block is commented out at style.css:3085-3098.
- Desktop has essentially no reduced-motion coverage: the only active block (style.css:1432-1441) covers the article reveal; glow noise (B1), ParticleMorph, FLIP, rabbit, cursor blink, spritesheet loops, splat spinner all ignore it. mobile.css does it properly (:1156-1175); desktop has no equivalent.
**Fix:** restore the documented line, restore the CSS block, add one shared `prefersReducedMotion` flag consulted by desktop.js heavy paths + `startGlowNoise()`.

---

## F. Housekeeping (found during audit)

- **CLAUDE.md is significantly stale**: says variants are "not yet referenced in the DOM" (they are — `createMediaElement` builds full `<picture>`/`<video>` chains); doesn't mention desktop.js/mobile.js split, ParticleMorph, PortfolioDeck, Rabbit, deck routes. Worth a docs pass after the optimization lands.
- 5 old code-review .md files at repo root.
- `prefersReducedMotion` sampled once at boot on mobile (mobile.js:40), no `change` listener — cosmetic.
- ParticleMorph is clean (dt-clamped, self-terminating rAF, worker terminated) — renders at CSS px not DPR; looks intentional for the retro look, just confirm.

---

## Suggested execution order

1. **Asset pass** (no code): re-encode thumb1.mp4 + starWars to 1080², fix webm>mp4 inversions, delete 25 unreferenced files. ~−60 MB, zero risk. Fix optimize-assets.sh root causes (resize step, webm-larger-than-mp4 guard, master re-encode) so it stays fixed.
2. **Resolution tiers**: add -480w/-960w/-1920w generation to the script + `srcset`/`sizes` in `createMediaElement`; resize fallbacks. Biggest mobile win (D3 + A2).
3. **Video lifecycle**: shared IntersectionObserver pause/play + visibilitychange + closeDoc pause + Save-Data gating of preloadThumbnails (B2, B3, D2).
4. **Glow noise + terminal blur** (B1, C1): rAF-driven, dirty-checked, scoped, gated; blur off the full-screen container. Profile before/after with one DevTools trace.
5. **Reduced motion** (E1): restore the two commented-out pieces + desktop-wide gating.
6. **CSS split + fonts** (C4, C5, D1): base.css extraction, deck CSS into deck chunk, delete Space Mono, preload Martian Mono latin.
7. Remaining MED/LOW: dims-for-CLS (B7), splat render-on-demand (B4), rabbit/scrollbar layout reads (B5, B6), tablet routing (D4), `svh` (D6).

**Confidence**: MEDIUM
- Factual accuracy: HIGH on file sizes, dimensions, bitrates, code refs (all verified); MEDIUM on rendering-cost *magnitudes* (B1/C1 follow standard compositor behavior but weren't profiled on this site).
- Completeness: MEDIUM — weight scenarios in A4 are encode estimates, not measured builds; no Lighthouse/trace run was performed.
