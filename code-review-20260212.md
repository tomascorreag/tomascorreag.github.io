# Code Review - 2026-02-12

## Files Reviewed
- `index.html`
- `src/style.css`
- `src/main.js`
- `src/config/content.js`
- `src/config/animations.js`
- `src/config/particles.js`
- `src/config/crt.js`
- `src/components/Sprite.js`
- `src/components/Rabbit.js`
- `src/components/ParticleMorph.js`

## Summary
- Critical: 0 issues
- High: 3 issues
- Medium: 10 issues
- Low/Info: 7 issues

---

## High Priority

### [H1] Flicker spike duration is 50 SECONDS instead of 50ms
- **File:** `src/config/crt.js:39`
- **Description:** `flickerSpikeDuration: 50000` causes flicker spikes to last ~50 seconds, completely defeating the "subtle flicker" intent. The screen stays dimmed for absurdly long periods.
- **Fix:** Change to `flickerSpikeDuration: 50`

### [H2] Race condition — double-clicking rabbit fires multiple transitions
- **File:** `src/main.js:444-599`
- **Description:** No guard prevents re-entry into `startRabbitTransition()`. Rapid clicks can spawn multiple particle morphs, duplicate terminals, or leave incomplete cleanup.
- **Fix:** Add `transitionInProgress` flag at the top of the function.

### [H3] Mobile detection doesn't respond to window resize
- **File:** `src/config/crt.js:56-59, 82-84`
- **Description:** `isMobile()` runs once at page load. Rotating a tablet or resizing the browser never re-injects CRT variables, locking users into wrong settings.
- **Fix:** Add a resize listener that re-injects variables when crossing the mobile threshold.

---

## Medium Priority

### [M1] Massive CSS duplication — CRT effects repeated 4+ times
- **File:** `src/style.css:452-507, 565-577`
- **Description:** `.terminal.crt-effects`, `.nav-menu.crt-effects`, `.rabbit.crt-effects`, `.rabbit.flipped.crt-effects`, and a generic `.crt-effects` all repeat the full filter chain with minor variations. Changing glow values means updating 4+ places.
- **Fix:** Consolidate into a single `.crt-effects` rule with element-specific CSS variable overrides (e.g., `--element-scale`, `--brightness-boost`, `--rgb-multiplier`).

### [M2] Dead/commented code should be removed
- **Files:** `index.html:44`, `main.js:555,561-564,622`
- **Description:** Commented-out canvas element, commented-out className assignment, commented-out "move selection to General" logic, commented-out sleep. Git history is the right place for old code, not comments.
- **Fix:** Delete all commented-out code.

### [M3] Unused config values
- **File:** `src/config/animations.js:44-45`, `src/config/crt.js:19`
- **Description:** `glowBoostPerClick: 0` makes the click-glow system inactive. `CRT_CONFIG.glowColor` is defined but never used (actual glow color comes from CSS variable).
- **Fix:** Remove if unused, or add comments explaining why disabled.

### [M4] Magic numbers despite centralized config
- **Files:** `main.js:300,400,502`, `Rabbit.js:186`, `ParticleMorph.js:262,373`
- **Description:** Hardcoded values like `await sleep(300)`, `edgeMargin = 20`, `screenX = rect.x + 80`, `100` ms fade-in duration — all should be in config or documented inline.
- **Fix:** Extract to config files or add calculation comments.

### [M5] No validation on URL parameter
- **File:** `src/main.js:416-427`
- **Description:** `params.get('name')` is used directly. While DOM text node insertion is XSS-safe, a 10,000-character name breaks layout. Bad precedent if later interpolated into HTML.
- **Fix:** `rawName.trim().slice(0, 20).replace(/[<>]/g, '')`

### [M6] ParticleMorph hardcodes sprite frame dimensions
- **File:** `src/components/ParticleMorph.js:147-149`
- **Description:** `const frameW = 32; const frameH = 64;` are hardcoded despite being available in `RABBIT_CONFIG.width/height`. Creates coupling and potential bugs if sprite dimensions change.
- **Fix:** Import and use `RABBIT_CONFIG.width/height`, or pass dimensions via config.

### [M7] Inconsistent error handling
- **File:** `src/main.js:444-599`
- **Description:** `main()` shows a user-facing error fallback, but `startRabbitTransition()` only logs to console. If the transition fails, the user sees nothing — the rabbit just becomes unresponsive.
- **Fix:** Add user-facing fallback to the catch block.

### [M8] Rabbit cleanup bypasses parent class abstraction
- **File:** `src/components/Rabbit.js:404-425`
- **Description:** `disableMouseReaction()` manually filters `this.eventHandlers` instead of using a parent class method. Parallel cleanup logic that could drift if `Sprite` evolves.
- **Fix:** Add `removeTrackedListener(target, event, handler)` method to `Sprite` base class.

### [M9] CSS `[hidden]` overrides may be redundant
- **File:** `src/style.css:519-521, 593-595`
- **Description:** `.nav-menu[hidden]` and `.mosaic-grid[hidden]` both set `display: none`, which the `hidden` attribute already does natively. Only needed if flex/grid contexts override it.
- **Fix:** Either document why needed or remove if redundant.

### [M10] `.media-wrapper` div is now inert
- **File:** `src/style.css:625-628`, `src/main.js:367-368`
- **Description:** After the hover refactor, `.media-wrapper` does nothing — it's just `width:100%; height:100%`. JS still creates it unnecessarily.
- **Fix:** Remove the wrapper div from JS and CSS. Place media directly inside `.mosaic-item`.

---

## Low / Info

### [L1] Config objects should be frozen
- **Files:** All config files
- **Description:** Config objects are mutable. `Object.freeze()` makes them truly immutable and self-documenting as data, not state.

### [L2] Missing JSDoc on complex functions
- **Files:** `ParticleMorph.js`, `Rabbit.js`
- **Description:** Complex methods like `generateParticles` would benefit from JSDoc for IDE hints and type safety.

### [L3] `startFlicker()` interval not cleanable from outside
- **File:** `src/config/crt.js:117-135`
- **Description:** No way to stop flicker from main.js. Return a cleanup function for future SPA use.

### [L4] `Sprite.setTimeout` edge case with delay=0
- **File:** `src/components/Sprite.js:96-104`
- **Description:** If timeout fires before function returns (delay=0), ID tracking could miss. Unlikely to cause real issues.

### [L5] `Terminal.run()` has no explicit return
- **File:** `src/main.js:233-241`
- **Description:** Async function with no return. While correct, explicit `return` is clearer.

### [L6] CSS comment quality could be more educational in places
- **File:** `src/style.css:550`
- **Description:** `visibility: hidden` comment could draw the parallel to Unity's disabled renderer for the learning audience.

### [L7] Commented canvas element in HTML
- **File:** `index.html:44`
- **Description:** Leftover `<!-- <canvas> -->` from development. Remove or explain.
