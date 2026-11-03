# Optimization report: 2026-11-02

Read-only audit; no source changes. Four parallel reviews (desktop JS, mobile, CSS/HTML/a11y/SEO, assets/build) plus spot-checks of the headline claims. Follows up `optimization-report-2026-06-11.md`.

Measured: fresh `vite build` → dist 94 MB (PNG 48.8, MP4 29.1, WebM 9.6, WebP 6.5, AVIF 2.0, JPG 1.3). Down from 238 MB in June.

Legend: **[V]** = spot-checked against source by the lead; others come from reviewer reports with file:line evidence; SPIKE-GATED = reasoned from spec, needs a browser test.

## Fix status (end of 2026-11-02, uncommitted, build passes, not browser-tested)

Done: H1–H5, M1, M2 (videos no longer prefetched), M3 part 1 (thumbnails not inlined; shared chunk 113.6 → 89.8 KB), M4–M9, M11 (desktop nav = buttons, mosaic cells get a stretched button; mobile cards = article + stretched button), M12 (`<noscript>`), M14–M16, T1, T2 (BSD stat, bash 3.2, avifenc for alpha AVIF + AVIF inversion guard), T4 (Node 24, paths-ignore, dependabot), T5 (reports moved to `docs/reviews/`), C3 rabbit drop (now `translate`), most Lows (sitemap, icons, JSON-LD, CSP comment + comments stripped from dist, dead CSS/code, focus styles, tap targets, contrast, z-index tokens for page layers).

Done 2026-11-03 (after `brew install ffmpeg`):
- M10: 1440w WebP/AVIF tier for 15 images (`TIER_WIDTHS` in script + content.js).
- M13: thumb1.mp4 re-encoded from the 48 MB master in git history (6.43 → 4.63 MB, VMAF 92.0 → 92.2, audio track dropped); Frenesi.mp4 from the .mov master (16.8 → 11.5 MB, VMAF 95.1 → 93.2). Frenesi.webm kept: a VP9 re-encode from the master scored the same (87.7). First-frame posters for all 6 videos (`<name>-poster.jpg`, wired through variantsFor → `video.poster`).
- Mobile scanlines covered card media and game banners: `content-visibility: auto` (paint containment) and a finished `forwards` fade animation each create a stacking context that traps the media's z-index opt-out. Verified in headless Chrome; removed content-visibility, fade switched to `backwards`.
- optimize-assets.sh: image encodes moved to cwebp/avifenc (Homebrew ffmpeg lacks libwebp/libaom); ffprobe 9 duplicate-line output fixed (it had corrupted asset-dims.json); AVIF guard now drops only inverted tiers; poster generation.

Not done:
- M3 part 2 (lazy-load page markdown, ~10 KB gzip): touches content.js + desktop/mobile/deck consumers; low gain vs. a 52 MB media site.
- `.m-card:active` scale briefly puts card media under the scanlines during a tap (~160 ms).
- T3 (git history rewrite): WON'T DO (decided 2026-11-03). Large first clone is acceptable, and history is the only copy of the original video/image masters.
- FLIP animations on left/top/width/height (detail, gallery, lightbox): JS-driven; rewrite to transform-based FLIP is a larger change.
- Sampling loop duplicated in ParticleMorph + classic worker: dedupe needs a module worker.
- Robots `Disallow: /*?p=` kept (deck URLs stay unlisted).

## Status of June findings

| ID | Status | Note |
|---|---|---|
| A1 unreferenced files | Fixed | 2 new tiny leftovers (see L-assets) |
| A2 oversized images | Partial | all ≤1920px with tiers; fallbacks still full PNG; 12 alpha PNGs lack AVIF |
| A3 video encodes | Partial | thumb1 48→6.4 MB, inversions removed; Frenesí unchanged |
| B1 glow noise | Partial | now episodic (~9 writes/s avg vs 32), still on `:root`, no reduced-motion gate |
| B2 video autoplay | Fixed | but new bug H3 |
| B3 preload everything | Partial | `getNetworkType()` is null on Safari/Firefox → treated as "preload"; ~16.8 MB video prefetch |
| B4–B9 | Fixed | |
| C1, C2, C4, C5, C6 | Fixed | C4 split introduced H1 and M7 |
| C3 layout animations | Partial | detail FLIP, gallery-fs, lightbox, rabbit drop still animate top/left/width/height |
| D1, D4, D6 | Fixed | |
| D2, D3, D5 | Partial | see M4, M10 |
| E1 reduced motion | **Still open** | `PortfolioDeck.js:45 const reduceMotion = false` [V]; CSS block commented out; zero desktop handling |

## High

- **H1. Mobile image lightbox is unstyled [V].** `.img-lightbox-*` rules live only in `portfolio-deck.css`; `mobile.js:851` opens the lightbox from the feed sheet, where the deck CSS isn't loaded unless the deck was opened earlier. Fix: move the rules to `article.css` (imported by all branches).
- **H2. PNG/JPG fallbacks: 50.1 MB of the 94 MB dist, never fetched [V]. DONE 2026-11-02.** Masters moved to `assets-src/` (not deployed); `scripts/make-fallbacks.py` writes full-resolution JPEG q85 fallbacks (transparent masters flattened onto `#0a0a0a`, WebP keeps alpha). Fallbacks 50.6 → 7.5 MB; dist 94 → 54 MB.
- **H3. Videos hidden behind the detail view restart.** `media.js:61-62,88-93` [V]: paused-by-manager videos keep `lastVisible=true`, so a tab switch (or observer re-entry in `.detail-scroll`) calls `onEnter()` → `play()` at opacity 0. Fix: a `suppressed` flag set in `pauseManagedVideos`, cleared in `resumeManagedVideos`, checked in `onEnter`.
- **H4. No social preview. DONE 2026-11-02:** `public/og-image.png` (1200×630, generated by `scripts/make-og-image.py`), og:image + dims/alt, `summary_large_image`, canonical, `og:site_name`, `og:locale`.
- **H5. Reduced motion disabled everywhere (E1).** Restore `matchMedia` in PortfolioDeck, uncomment `portfolio-deck.css:701-714`, add a desktop block (cursor blink, rabbit, reveals, FLIP, glow noise, spritesheets).

## Medium

- **M1. CSP blocks the particle worker.** `worker-src blob:` without `'self'` (`index.html:43`) [V]; `ParticleMorph.js:648` loads a same-origin worker → falls back to main-thread sampling. Fix: `worker-src 'self' blob:`. SPIKE-GATED: confirm violation in prod console.
- **M2. Desktop speculative video prefetch ~16.8 MB** (`desktop.js:472-495`) [V]. Safari/Firefox count as "unknown → preload"; Safari may then play the mp4 and waste the webm fetch. Fix: skip files >2 MB (Frenesí, thumb1), or prefetch on hover.
- **M3. Shared chunk on the critical path: 113.6 KB raw / 44.6 KB gzip.** Rollup named it `VideoControls-*`; it holds content.js (≈28.5 KB of `page:` markdown prose) + 27 KB of base64-inlined thumbnail tiers. Fix: `build.assetsInlineLimit: f => !f.includes('/thumbnails/')` (−27 KB, one line); move `page` text into lazily globbed `.md` files (−25–35 KB).
- **M4. Mobile feed video keeps decoding behind the open sheet.** `mobile.js` never calls `pauseManagedVideos`. Fix: pause in `openSheet`, resume in `closeSheet`.
- **M5. Escape during prev/next navigation throws** (`desktop.js:2450-2454`); tile stays at opacity 0 (`.detail-fading` never removed in `closeDetail`). Fix: session check after the await; clear the class in `closeDetail`.
- **M6. Next button disabled on second-to-last item [V].** `updateDetailNavButtons` (`desktop.js:1921`) counts the placeholder; `navigateDetail` (`:2394`) excludes it. Fix: same `:not(.mosaic-placeholder)` selector.
- **M7. Deck on mobile loses its glow.** `.crt-effects` text rule is only in desktop `style.css:491-508`. Copy to `portfolio-deck.css`.
- **M8. Mobile sheet media sizing.** `mobile.css:975-981` `max-height:100%` resolves against a parent with no height; width/height attrs then act as CSS height → letterboxing/cropping. Fix: `width:100%; height:auto; max-height:65svh` on the media itself.
- **M9. `contain-intrinsic-size` without `auto`** (`mobile.css:716,801`) → scroll jumps when scrolling back up. Fix: `auto 320px`.
- **M10. iPhones still get full-size images.** Top tier below full is 960w; a 390px DPR-3 screen needs ~1170px. Accept, or add a 1440w tier for portrait/hero items.
- **M11. Keyboard/screen reader.** Nav items and mosaic cells are `div`s with no role/tabindex (`desktop.js:2761,784`); keyboard nav is a document-level arrow handler moving a `.focused` class. Fix: `<button>`s with `aria-label`, `:focus-visible`, `aria-current`.
- **M12. Content only exists after JS.** Body has empty containers. Add a `<noscript>`/visually-hidden block with name, role, project list, contact links.
- **M13. Video/encode work.** thumb1.mp4 8.2 Mbps with an unused AAC track (CRF 26 `-an` → est. 2–3 MB); Frenesí mp4 16.8 MB (CRF 27 → est. 8–10 MB); no `poster` anywhere (Save-Data/`preload=none` shows black boxes).
- **M14. Throwaway WebGL context on every boot** (`device.js:43-58`), only used for a DEV log. Gate behind `import.meta.env.DEV`.
- **M15. Fade-out waits accept bubbled `transitionend`** (`desktop.js:766,871,970,1149`, duplicated ×4). One helper checking `e.target===mosaicEl && propertyName==='opacity'`.
- **M16. Failed splat renders every frame forever** (`SplatViewer.js:111-114,149`). Set a `failed` flag in `onError`. Latent: no splats ship.

## Tooling / repo

- **T1. `npm run` broken on this Mac [V]. DONE 2026-11-02:** `.npmrc` deleted, CI `NPM_CONFIG_SCRIPT_SHELL` override removed. Still open: `scripts/optimize-assets.ps1` is dead too.
- **T2. `optimize-assets.sh` broken on macOS.** ffmpeg not installed; bash 3.2 + `set -u` + empty `"${args[@]}"` aborts full-size encodes; GNU `stat -c` returns 0 on BSD so the webm-inversion guard never fires. Fix: `stat -f %z || stat -c %s`, `${args[@]+"${args[@]}"}`, use `avifenc` for alpha PNGs (tested: ~20–25% smaller than WebP, keeps alpha).
- **T3. Git history 399 MiB** (Frenesi.mov 91 MB, old thumb1.mp4 48 MB, …). `git filter-repo` + force-push would shrink clones; history rewrite, your call.
- **T4. CI:** Node 20 → 24 (Node 20 EOL date UNVERIFIED); `paths-ignore: ['**.md']` so doc commits don't redeploy; the comment mentions Dependabot but no `dependabot.yml` exists.
- **T5. Six stale review .md files at root** (tracked, not in dist, readable on GitHub if public).

## Low

- Mobile: tap targets ~36px on `.vc-btn`, 8px seek thumb (`base.css:241-306`); `prevFocus` captured after `inert` (`mobile.js:692-696`); Save-Data tap both plays and opens sheet; `<button>` card wraps headings; intro padding still `vh`; reduced-motion sampled once without listener (`mobile.js:42`).
- Desktop: overlapping nav-click renders (no generation token); detached videos keep downloading on category switch; double fullscreen cleanup (`desktop.js:1686,1714`); `?p=` deck visits still boot terminal/rabbit/glow; `video.play()` without `.catch` (`VideoControls.js:125`); unguarded `navigator.clipboard` (`desktop.js:1336`).
- Splat (latent, no content): mobile `splatSession` not bumped for non-splat items (`mobile.js:775-816`) [V]; info panel waits on splat load; CSP lacks `'wasm-unsafe-eval'` and `data:` in `connect-src` for Spark's inline wasm.
- SEO: no `sitemap.xml` / `Sitemap:` line; no apple-touch-icon; thin Person JSON-LD (add `sameAs`, `alumniOf`, `image`); CSP comment wrongly claims clickjacking protection and ships in dist.
- CSS: `var(--mg-line)` undefined on desktop (`style.css:1450`); dead `.deck-counter`, `.detail-info-side-image`, `.rabbit.color-fade`; duplicate `blink` keyframes and `.detail-info` blocks; 21 z-index values; `.general-contact-typeout.copied` ~4.2:1 contrast.
- Dead code: `resolveThumbnail` import (`desktop.js:23`), `stopGlowNoise`, `isMobile` re-export (`crt.js:56`), sampling loop duplicated in ParticleMorph + worker. Shared desktop/mobile logic: splat load/destroy, markdown body render, contacts, fullscreen reset.
- Assets: `ice_details/Glass_Var1.*` byte-identical to `iceThumb.*` (0 B in dist, 524 KB in repo); `spritesheets/RabbitAnimation_V1.webp` unused.

## Suggested order

1. Quick wins (<1 h total): T1, M1, M6, H1, M7, `assetsInlineLimit` (M3 part 1), M14.
2. H2 fallbacks (−45–50 MB) after fixing T2.
3. H3, M4, M5 video/navigation bugs.
4. H4 + M12 + sitemap/icons (sharing/SEO for applications).
5. H5 reduced motion + M11 keyboard access.
6. M13 re-encodes + posters, M2 prefetch cap.
7. T3 history rewrite, if wanted.
