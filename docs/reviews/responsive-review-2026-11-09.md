# Responsive review: 2026-11-09

Trigger: the ARBO parallax banner left an empty band above its background in the UCL deck (`/?p=65f2`) on narrow windows. Layers were placed in percent of the banner box, so any box that wasn't 2:1 stretched them and the contain-fit images letterboxed inside. That prompted a site-wide sweep for the same class of bug: anything that breaks when window size, aspect, orientation, zoom or DPR changes.

Three read-only reviews (deck/article, desktop, mobile), then three fix passes with separate file ownership, then a browser pass by the lead.

Legend: **[B]** = checked in a browser (desktop Chrome, emulated sizes); others build and were reviewed against the code but not rendered. Touch-only behaviour (coarse pointer, notch insets, pinch zoom) can't be emulated with a desktop mouse.

## Fix status (uncommitted, build passes)

### Parallax banner
- **[B]** Cover-fit stage. `.pb-stage` keeps the scene's aspect and covers the root (`width: max(100cqw, 100cqh * AR)`, centred); every layer, mask, particle canvas and the logo shine sit inside it, so any slot shape crops instead of distorting. Root is `container-type: size`; the stage is the `inline-size` container that glow radii and noise tiles resolve against. Particle canvas size uses the stage width.
- DPR change (window moved between 1× and 2× screens, zoom) re-sizes particle canvases via one shared `(resolution: Ndppx)` listener. SplatViewer (high tier) does the same for `setPixelRatio`.

### Portfolio deck
- **[B]** Prev/next arrows stay on screen: position is `min(slot edge + gap, 100% − arrow − inset)`. They used to sit at `50% + slide-w/2`, off-screen once the slide is 88% wide.
- Safe-area insets (`env(safe-area-inset-*)` via `--safe-*`) on the header, dots, sticky back button, document side padding and arrows. Every use is `max(old spacing, inset)`, so non-notched screens are unchanged.
- **[B]** Card media box matches the piece's aspect in both axes (`measureMediaBox` fits the aspect into the space left after the card body). Before, a width-limited box kept its flex-grown height: images letterboxed and the parallax banner cropped ~65% and loaded images ~2.7× too small for their drawn size.
- **[B]** Cards keep at least `MIN_CARD_REM` (20rem) width, so a short window doesn't squeeze the title and blurb into a sliver. Found in the browser pass at 844×390.
- **[B]** `@media (max-height: 500px)`: smaller deck title/intro, card title, one-line blurb.
- **[B]** Spritesheet cards (Páramo) get a background band above and below the title (`SPRITE_PAD_Y` = 0.2 of the frame height per side).
- Relayout: two-frame settle on mount, on `.deck-viewport` ResizeObserver, on `document.fonts` ready/loadingdone. Replaces the 120 ms resize debounce, which let cards overflow while it waited.

### Routing
- **[B]** Desktop/mobile choice re-evaluated on `matchMedia` change (`(max-width: 820px)`, coarse pointer). When it flips, the page reloads after 400 ms of quiet. Routes live in the URL hash, so the open page survives. Reload rather than hot-swap: the apps install global handlers and have no teardown. A desktop window shrunk into mobile shows the one-per-session "best on a computer" notice.

### Desktop
- **[B]** Open detail, fullscreen, gallery overlay and exit-fullscreen target re-layout on resize, zoom and crossing the portrait query (`relayoutDetail`, piggybacked on the mosaic resize rAF). Positions snap during resize instead of tweening.
- **[B]** Detail view uses the full available box (`--mosaic-avail-*`), not the box fitted to the category's thumbnail rows. A 3-row category at 1920 wide had capped landscape images at ~203 px tall.
- **[B]** Stacked layout also applies below `62.5em` (~1000 px) wide, not only at aspect ≤ 4:3. The side-by-side mosaic collapsed to tiny cells below ~1000 px and vanished at ≤ 594 px.
- Mosaic frame transitions are off while resizing (`html.is-resizing`), so the border no longer trails the grid.
- `MOSAIC_PAD_TOP` and `NAV_BAR_HEIGHT` px constants replaced with values read from computed styles / the root font size; they drifted under non-default browser font sizes.
- Scanline line and gap snapped to whole device pixels (`round(px*dpr)/dpr`) to avoid moiré at 125–150 % scaling. DPR 1 and 2 unchanged. Not checked visually at fractional DPR.
- Rabbit re-anchors to the viewport floor and back inside the edges on resize (`Rabbit._anchor`), also after a jump that spanned a resize. The resize listener moved from `enableMouseReaction` (which added a new one on every call) to `spawn`.

### Mobile
- **[B]** Matrix game banner: new `fit: 'contain'` option in `createSpritesheetElement` (mobile Games feed only) fits the whole frame in the 2:1 box at the largest whole-device-pixel scale. The 1:1 sprite was drawn at full width, twice the box height, cutting off head and feet.
- **[B]** Rabbit reserves the height it draws above its layout box (`--rabbit-scale`). `@media (max-height: 500px)`: compact intro (rabbit scale 2), one-line header, shorter tab bar (38 px tabs, below the 44 px guideline), card media `contain` capped at `100svh − 120px`, compact detail sheet.
- Tablets / wide coarse screens: content capped at a centred 720 px column; header and tab bar stay full width.
- Detail-sheet swipe ignored while pinch-zoomed (`visualViewport.scale > 1.01`), checked at start and end.
- Image lightbox follows resize/orientation while open (desktop and mobile).
- Removed unused `--header-h` / `--tabbar-h`.

## Not done / open

- Very short desktop deck windows: the tall arrow rails overlap the intro text. Not checked whether this predates this round.
- Resizing during an open/fullscreen animation snaps to the end state instead of finishing the tween.
- Mobile `fit: 'contain'` sprite doesn't re-fit on a DPR change alone; centring can land on a half pixel.
- Game card / mobile game banner `sizes` are only exact while their slot keeps the scene's aspect (it does today).
- Mosaic grid `padding-top: calc(33px - 1.5rem + 12px)` hardcodes the stacked frame pad, so landscape (2rem pad) clears the frame handle by ~8px, not 12px. Predates this round and is the shipped look; switching to `var(--mosaic-frame-pad)` would move the first row down 4px.
- Untested on devices: notch insets, pinch-zoom guard, coarse-pointer tablets, fractional-DPR scanlines, lightbox and gallery overlay during resize.
