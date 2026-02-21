/**
 * ParticleMorph — Reusable particle dissolution/formation effect
 *
 * Creates a fullscreen canvas overlay where square particles morph from
 * a source shape to a target shape. Either side can be a sprite image
 * or a filled rectangle.
 *
 * Think of it like a VFX particle system in Unity:
 *   - Particles have position, velocity, and forces acting on them
 *   - A spring force pulls each particle toward its target position
 *   - Turbulence (layered sine waves) adds organic drift
 *   - Damping gradually kills velocity for a clean settle
 *
 * Usage:
 *   const morph = new ParticleMorph(PARTICLE_CONFIG);
 *   await morph.start({
 *     source: { rect, image?, frame?, flipped? },
 *     target: { rect, image?, frame?, flipped? },
 *     container,
 *     color?,
 *   });
 *   await morph.handoff();
 *   morph.destroy();
 */

// Reference frame duration — physics is tuned at 60fps, dt-scaled at runtime
const REF_FRAME_MS = 1000 / 60;

// Unbiased Fisher-Yates shuffle — returns a new shuffled copy of the array.
// Array.sort(() => Math.random() - 0.5) is biased because V8's Timsort does
// not compare every pair, making some permutations systematically more likely.
function fisherYates(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// Module-level cache for sampled sprite cells.
// Map<image.src, Map<cacheKey, cells[]>>
//   Outer key: image.src string — stable across multiple Image() elements for
//              the same URL (preloadImage() creates a new element each call,
//              so a WeakMap keyed on the element would always miss)
//   Inner key: `${frameOffset}:${cellSize}` — cellSize varies by device tier
const _cellCache = new Map();

export class ParticleMorph {
  constructor(config) {
    this.config = config;
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.animationId = null;
    this.startTime = 0;
    this.lastFrameTime = 0;
    this.morphColor = null; // per-morph color override
    this.settledCount = 0;
  }

  /**
   * Main entry — runs the full particle animation.
   *
   * @param {Object} options
   * @param {Object} options.source - Source side: { rect, image?, frame?, flipped? }
   * @param {Object} options.target - Target side: { rect, image?, frame?, flipped? }
   * @param {HTMLElement} options.container - DOM parent for the canvas
   * @param {{r,g,b}} [options.color] - Override config color for this morph
   * @returns {Promise} resolves when particles have fully settled
   *
   * If `image` is provided on a side, pixels are sampled from the sprite.
   * If no `image`, the rect is filled as a solid block (grid of cells).
   * `flipped` controls X-axis mirror math (default false).
   */
  start({ source, target, container, color }) {
    // Pre-assign so skip() is safe to call from the moment the listener
    // is registered — before the Promise executor actually runs.
    this.resolveStart = null;
    return new Promise(resolve => {
      this.resolveStart = resolve;
      this.morphColor = color || null;

      // Generate particles first so we can measure their bounding box
      const sourceCells = this.generateCells(source);
      const targetCells = this.generateCells(target);
      this.generateParticles(source, target, sourceCells, targetCells);

      // Size canvas to a tight bbox around the particles — the CSS filter then
      // only processes that small region instead of the entire viewport
      this.computeCanvasBounds();
      this.createCanvas(container);

      // Kick off the animation loop
      this.startTime = performance.now();
      this.lastFrameTime = 0;
      this.animate = this.animate.bind(this);
      this.animationId = requestAnimationFrame(this.animate);
    });
  }

  /**
   * Generates cells for one side (source or target).
   * If image provided → sample sprite pixels.
   * If no image → fill rect as solid grid.
   */
  generateCells(side) {
    if (side.image) {
      return this.sampleTargetImage(side.image, side.frame);
    } else {
      return this.generateFilledCells(side.rect);
    }
  }

  /**
   * Fades the canvas out over handoffDuration ms.
   * Call this after placing the DOM element underneath.
   * @returns {Promise} resolves when fade is complete
   */
  handoff() {
    return new Promise(resolve => {
      const duration = this.config.handoffDuration;
      this.canvas.style.transition = `opacity ${duration}ms ease-out`;
      this.canvas.style.opacity = '0';
      setTimeout(resolve, duration);
    });
  }

  /**
   * Immediately snaps all particles to their targets and resolves start().
   * Call this to skip the animation on user input (same idea as skipTyping).
   */
  skip() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    for (const p of this.particles) {
      p.x = p.targetX;
      p.y = p.targetY;
      p.alpha = 1;
      p.settled = true;
    }
    this.settledCount = this.particles.length;
    this.render();
    if (this.resolveStart) this.resolveStart();
  }

  /**
   * Removes the canvas from the DOM and cancels any pending animation.
   */
  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.ctx = null;
    this.particles = [];
    this.morphColor = null;
  }

  // ──────────────────────────────────────────────
  // Internal methods
  // ──────────────────────────────────────────────

  /**
   * Computes a tight bounding box around all particle source and target
   * positions, with padding for turbulence drift and the glow filter bleed.
   *
   * Must be called after generateParticles(). Stores:
   *   this.canvasLeft, this.canvasTop  — viewport offset of canvas origin
   *   this.canvasWidth, this.canvasHeight — canvas pixel dimensions
   *
   * Why: CSS filter cost scales with canvas area. Shrinking the canvas from
   * fullscreen (~1.5M px) to the actual particle region (~30-100K px) gives
   * a ~15-50x reduction in filter work with identical visual output.
   */
  computeCanvasBounds() {
    // Extra space on each side: 80px covers the 30px glow spread + ~50px of
    // turbulence drift (noiseAmplitude × drift frames, generously rounded up)
    const PADDING = 80;

    if (!this.particles.length) {
      // No particles — fall back to a minimal 1x1 canvas so createCanvas() is safe
      this.canvasLeft = 0; this.canvasTop = 0;
      this.canvasWidth = 1; this.canvasHeight = 1;
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.particles) {
      minX = Math.min(minX, p.sourceX, p.targetX);
      minY = Math.min(minY, p.sourceY, p.targetY);
      maxX = Math.max(maxX, p.sourceX + p.size, p.targetX + p.size);
      maxY = Math.max(maxY, p.sourceY + p.size, p.targetY + p.size);
    }

    this.canvasLeft = Math.max(0, minX - PADDING);
    this.canvasTop  = Math.max(0, minY - PADDING);
    this.canvasWidth  = Math.min(window.innerWidth,  maxX + PADDING) - this.canvasLeft;
    this.canvasHeight = Math.min(window.innerHeight, maxY + PADDING) - this.canvasTop;
  }

  /**
   * Creates a fixed canvas sized to the particle bounding box.
   * Must be called after computeCanvasBounds().
   */
  createCanvas(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'particle-canvas crt-effects';
    this.canvas.width  = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
    // Override the CSS top:0; left:0 defaults to position over the bbox
    this.canvas.style.left = `${this.canvasLeft}px`;
    this.canvas.style.top  = `${this.canvasTop}px`;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Samples the target sprite image to find opaque cells.
   *
   * Works like reading pixel data from a RenderTexture in Unity:
   * 1. Draw the sprite frame onto an offscreen canvas
   * 2. Read back pixel data with getImageData
   * 3. Group pixels into cells (cellSize x cellSize)
   * 4. A cell counts as "opaque" if ANY pixel in it has alpha > 0
   *
   * @param {HTMLImageElement} image — the full spritesheet
   * @param {number} frameOffset — negative px offset (e.g. -512)
   * @returns {Array<{localX, localY, r, g, b, a}>} — one entry per opaque cell
   */
  sampleTargetImage(image, frameOffset) {
    const { cellSize, frameWidth, frameHeight } = this.config;

    // Cache hit — same image+frame+cellSize already sampled, return stored cells
    const cacheKey = `${frameOffset}:${cellSize}`;
    let frameMap = _cellCache.get(image.src);
    if (frameMap?.has(cacheKey)) return frameMap.get(cacheKey);

    // Frame dimensions — single frame from the spritesheet
    const frameW = frameWidth;
    const frameH = frameHeight;

    // Draw just this frame onto an offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = frameW;
    offscreen.height = frameH;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    // frameOffset is negative (e.g. -512), so the source x = abs(frameOffset)
    const srcX = Math.abs(frameOffset);
    offCtx.drawImage(image, srcX, 0, frameW, frameH, 0, 0, frameW, frameH);

    const imageData = offCtx.getImageData(0, 0, frameW, frameH);
    const pixels = imageData.data; // RGBA flat array, 4 bytes per pixel

    const cells = [];
    const cellsX = Math.ceil(frameW / cellSize);
    const cellsY = Math.ceil(frameH / cellSize);

    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        // Check if any pixel in this cell is opaque
        let hasOpaque = false;
        let totalR = 0, totalG = 0, totalB = 0, count = 0;

        for (let py = 0; py < cellSize; py++) {
          for (let px = 0; px < cellSize; px++) {
            const pixelX = cx * cellSize + px;
            const pixelY = cy * cellSize + py;
            if (pixelX >= frameW || pixelY >= frameH) continue;

            const i = (pixelY * frameW + pixelX) * 4;
            if (pixels[i + 3] > 0) {
              hasOpaque = true;
              totalR += pixels[i];
              totalG += pixels[i + 1];
              totalB += pixels[i + 2];
              count++;
            }
          }
        }

        if (hasOpaque) {
          cells.push({
            localX: cx * cellSize,
            localY: cy * cellSize,
            r: Math.round(totalR / count),
            g: Math.round(totalG / count),
            b: Math.round(totalB / count),
            a: 255,
          });
        }
      }
    }

    // Store in cache before returning
    if (!frameMap) { frameMap = new Map(); _cellCache.set(image.src, frameMap); }
    frameMap.set(cacheKey, cells);

    return cells;
  }

  /**
   * Generates a grid of cells that fill a rect as a solid block.
   * Used when no sprite image is provided — the target/source is just
   * a filled rectangle (like a cursor block).
   *
   * @param {{x, y, w, h}} rect — the rectangle to fill
   * @returns {Array<{localX, localY, r, g, b, a}>}
   */
  generateFilledCells(rect) {
    const { cellSize } = this.config;
    const w = rect.w ?? rect.width;
    const h = rect.h ?? rect.height;

    // How many cells fit in the rect at display scale?
    // The rect is already in screen space, so we need local coords
    // that when multiplied by displayScale give the rect dimensions.
    // localW * displayScale = w → localW = w / displayScale
    const { displayScale } = this.config;
    const localW = Math.round(w / displayScale);
    const localH = Math.round(h / displayScale);

    const cellsX = Math.ceil(localW / cellSize);
    const cellsY = Math.ceil(localH / cellSize);

    const cells = [];
    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        cells.push({
          localX: cx * cellSize,
          localY: cy * cellSize,
          r: 255, g: 255, b: 255, a: 255,
        });
      }
    }

    return cells;
  }

  /**
   * Converts a cell's local coordinates to screen position.
   *
   * @param {{localX, localY}} cell — cell in local sprite space
   * @param {{x, y}} rect — screen position of the element
   * @param {number} scale — display scale
   * @param {boolean} flipped — whether X axis is mirrored
   * @returns {{screenX, screenY}}
   */
  cellToScreen(cell, rect, scale, flipped) {
    const screenY = rect.y + scale * cell.localY;
    let screenX;
    if (flipped) {
      // Flip math for transform-origin: top center.
      // The sprite is 32px wide, scaled 4x, with origin at center (16px).
      // Flipped screenX = rect.x + (spriteWidth/2 + spriteWidth/2 * scale) - scale * localX
      // = rect.x + 16 + 64 = rect.x + 80 for a 32px sprite at 4x scale.
      const flipOffset = (this.config.frameWidth / 2) * (1 + scale);
      screenX = rect.x + flipOffset - scale * cell.localX;
    } else {
      screenX = rect.x + scale * cell.localX;
    }
    return { screenX, screenY };
  }

  /**
   * Creates particle objects mapping source cells → target cells.
   *
   * When cell counts differ, redistributes: extra particles map to random
   * positions on the smaller side. Shuffle ensures even distribution.
   *
   * @param {{ rect: {x,y,w,h}, image?: HTMLImageElement, flipped?: boolean }} source
   * @param {{ rect: {x,y,w,h}, image?: HTMLImageElement, flipped?: boolean }} target
   * @param {Array<{localX: number, localY: number, r: number, g: number, b: number, a: number}>} sourceCells
   * @param {Array<{localX: number, localY: number, r: number, g: number, b: number, a: number}>} targetCells
   */
  generateParticles(source, target, sourceCells, targetCells) {
    const { cellSize, displayScale, maxSpawnDelay } = this.config;
    const particleSize = cellSize * displayScale;

    // Determine if source is a sprite (pixel-aligned start) or random-in-rect
    const sourceIsSprite = !!source.image;

    // Build matched pairs: zip source and target cells, handling count mismatch
    const maxLen = Math.max(sourceCells.length, targetCells.length);

    // Shuffle both arrays to randomize pairing (Fisher-Yates — unbiased)
    const shuffledSource = fisherYates(sourceCells);
    const shuffledTarget = fisherYates(targetCells);

    this.particles = [];
    this.settledCount = 0;

    for (let i = 0; i < maxLen; i++) {
      // Wrap around if one side has fewer cells
      const sCell = shuffledSource[i % shuffledSource.length];
      const tCell = shuffledTarget[i % shuffledTarget.length];

      // Calculate screen positions
      const { screenX: startX, screenY: startY } = sourceIsSprite
        ? this.cellToScreen(sCell, source.rect, displayScale, source.flipped ?? false)
        : this.randomInRect(source.rect);

      const { screenX: targetX, screenY: targetY } =
        this.cellToScreen(tCell, target.rect, displayScale, target.flipped ?? false);

      this.particles.push({
        x: startX,
        y: startY,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        sourceX: startX,
        sourceY: startY,
        targetX,
        targetY,
        r: tCell.r,
        g: tCell.g,
        b: tCell.b,
        a: tCell.a,
        noiseOffset: Math.random() * 1000,
        delay: sourceIsSprite ? 0 : Math.random() * maxSpawnDelay,
        size: particleSize,
        // Start visible if coming from sprite (they ARE the sprite pixels)
        alpha: sourceIsSprite ? 1 : 0,
        settled: false,
      });
    }
  }

  /**
   * Returns a random screen position within a rect.
   * Used for non-sprite source (like cursor shatter).
   */
  randomInRect(rect) {
    const x = (rect.x ?? rect.left) + Math.random() * (rect.w ?? rect.width);
    const y = (rect.y ?? rect.top) + Math.random() * (rect.h ?? rect.height);
    return { screenX: x, screenY: y };
  }

  /**
   * The animation loop — called every frame via requestAnimationFrame.
   *
   * This is the equivalent of Update() in Unity. The browser calls this
   * ~60 times per second (matching your monitor's refresh rate).
   */
  animate(timestamp) {
    // Delta time in ms since last frame, clamped to 3 reference frames max.
    // The clamp prevents a huge single step when the tab regains focus after
    // being backgrounded (browsers pause rAF on hidden tabs).
    const rawDt = this.lastFrameTime ? timestamp - this.lastFrameTime : REF_FRAME_MS;
    const dt = Math.min(rawDt, REF_FRAME_MS * 3);
    this.lastFrameTime = timestamp;

    // How many 60fps reference frames fit in this real dt.
    // dtScale = 1.0 at 60fps, 2.0 at 30fps, 0.5 at 120fps.
    // All force, damping, and integration are multiplied by this so the
    // animation plays at identical real-world speed regardless of framerate.
    const dtScale = dt / REF_FRAME_MS;

    // Pre-compute per-frame damping: correct framerate-independent equivalent
    // of applying per-frame damping `dtScale` times.
    // e.g. at 30fps: Math.pow(0.7, 2) = 0.49 ≈ two 60fps damping steps.
    const dampingFactor = Math.pow(this.config.damping, dtScale);

    const elapsed = timestamp - this.startTime;
    const {
      dissolveDuration, driftDuration, convergeDuration, settleDuration,
      stiffnessStart, stiffnessEnd,
      noiseAmplitude, noiseFrequency, noiseSpeed,
      maxSpawnDelay,
    } = this.config;

    const totalDuration = dissolveDuration + driftDuration + convergeDuration + settleDuration;

    // Update each particle
    for (const p of this.particles) {
      // Per-particle timeline (accounting for stagger delay)
      const particleElapsed = elapsed - p.delay;
      if (particleElapsed < 0) continue;

      // Skip fully settled particles — alpha is already 1, position is at target
      if (p.settled) continue;

      // Normalized progress (0 → 1) over the full duration
      const progress = Math.min(particleElapsed / totalDuration, 1);

      // Fade in: quick alpha ramp over first 100ms (only if started invisible)
      if (p.delay > 0) {
        p.alpha = Math.min(particleElapsed / 100, 1);
      }

      // Spring stiffness ramps up as progress increases
      const stiffness = stiffnessStart + (stiffnessEnd - stiffnessStart) * progress * progress;

      // Spring force: F = k * (target - current)
      const forceX = stiffness * (p.targetX - p.x);
      const forceY = stiffness * (p.targetY - p.y);

      // Turbulence: layered sine waves that decay with progress.
      // Skip entirely once decay is negligible — saves 6 Math.sin() calls per particle.
      const turbDecay = Math.max(0, 1 - progress * progress);
      let turbX = 0, turbY = 0;
      if (turbDecay > 0.005) {
        const time = timestamp * noiseSpeed * 0.001;
        const nx = p.x * noiseFrequency + p.noiseOffset;
        const ny = p.y * noiseFrequency + p.noiseOffset;
        turbX = this.noise2D(nx, ny + time) * noiseAmplitude * turbDecay;
        turbY = this.noise2D(ny + 31.7, nx - time) * noiseAmplitude * turbDecay;
      }

      // Apply forces scaled by dt — accumulate the right amount of impulse
      // regardless of how much real time passed since the last frame
      p.vx += (forceX + turbX) * dtScale;
      p.vy += (forceY + turbY) * dtScale;

      // Damping scaled by dt — equivalent to applying per-frame damping dtScale times
      p.vx *= dampingFactor;
      p.vy *= dampingFactor;

      // Integrate scaled by dt — move the right number of pixels for this timestep
      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;

      // Mark settled when actual displacement this step is negligible
      if (progress >= 1 && Math.abs(p.vx * dtScale) < 0.1 && Math.abs(p.vy * dtScale) < 0.1) {
        p.x = p.targetX;
        p.y = p.targetY;
        p.alpha = 1;
        p.settled = true;
        this.settledCount++;
      }
    }

    // Precise check: all particles flagged settled AND spawn delay has passed
    // (the delay guard prevents resolving before staggered particles even start).
    // Evaluated after the loop so this.settledCount reflects the current frame.
    const allSettled = this.settledCount >= this.particles.length &&
                       elapsed >= maxSpawnDelay;

    // Render
    this.render();

    // Continue or resolve
    if (allSettled) {
      // All particles already have p.x === p.targetX (set in the settle check
      // above), so no snap pass is needed — render() above already drew the
      // pixel-perfect final frame.
      this.animationId = null;
      if (this.resolveStart) this.resolveStart();
    } else {
      this.animationId = requestAnimationFrame(this.animate);
    }
  }

  /**
   * Cheap 2D noise via layered sine waves.
   * Returns value in range roughly [-1, 1].
   */
  noise2D(x, y) {
    return (
      Math.sin(x * 1.2 + y * 0.7) * 0.5 +
      Math.sin(x * 0.5 - y * 1.3 + 2.1) * 0.3 +
      Math.sin(x * 2.1 + y * 1.1 - 1.7) * 0.2
    );
  }

  /**
   * Renders all particles to the canvas.
   * Uses per-morph color override if set, otherwise config color.
   *
   * Two-pass approach: fully opaque particles first (no per-particle state
   * change), then fading particles. This avoids N globalAlpha + fillStyle
   * state changes when all particles are settled (the common case).
   */
  render() {
    const ctx = this.ctx;
    const color = this.morphColor || this.config.color;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Set color once — all particles share the same color
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;

    const ox = this.canvasLeft;
    const oy = this.canvasTop;

    // Pass 1: fully opaque particles (no globalAlpha state change needed)
    ctx.globalAlpha = 1;
    for (const p of this.particles) {
      if (p.alpha < 1) continue;
      ctx.fillRect((p.x - ox) | 0, (p.y - oy) | 0, p.size, p.size);
    }

    // Pass 2: fading-in particles (only during the brief spawn delay window)
    for (const p of this.particles) {
      if (p.alpha <= 0 || p.alpha >= 1) continue;
      ctx.globalAlpha = p.alpha;
      ctx.fillRect((p.x - ox) | 0, (p.y - oy) | 0, p.size, p.size);
    }

    ctx.globalAlpha = 1;
  }
}

/**
 * Pre-warms the sprite cell cache off the main thread.
 *
 * Call this once after the spritesheet image loads, passing all frame offsets
 * the morph will ever use. By the time the user triggers the first morph,
 * the cache will be populated and sampleTargetImage() returns instantly.
 *
 * How it works:
 *   1. createImageBitmap() extracts each frame asynchronously (non-blocking)
 *   2. The bitmap is transferred zero-copy to a Web Worker
 *   3. The worker runs drawImage + getImageData + pixel loop off-thread
 *   4. Results are stored in _cellCache when the worker responds
 *
 * If start() fires before pre-warming completes (race), sampleTargetImage()
 * falls back to its synchronous path — no breakage, just the one-time cost.
 *
 * @param {HTMLImageElement} image       — the loaded spritesheet
 * @param {number[]}         frameOffsets — e.g. [-512, -288, -32]
 * @param {{ cellSize, frameWidth, frameHeight }} config — from PARTICLE_CONFIG
 */
export function prewarmSampleCache(image, frameOffsets, { cellSize, frameWidth, frameHeight }) {
  // Deduplicate — e.g. spawnEnd and idle both map to -512
  const unique = [...new Set(frameOffsets)];
  let remaining = unique.length;

  const worker = new Worker(new URL('../workers/sampleWorker.js', import.meta.url));

  worker.onmessage = ({ data: { cells, frameOffset } }) => {
    const cacheKey = `${frameOffset}:${cellSize}`;
    let frameMap = _cellCache.get(image.src);
    if (!frameMap) { frameMap = new Map(); _cellCache.set(image.src, frameMap); }
    frameMap.set(cacheKey, cells);

    if (--remaining === 0) worker.terminate();
  };

  // Terminate the worker if it throws an uncaught error
  worker.onerror = () => worker.terminate();

  for (const frameOffset of unique) {
    const srcX = Math.abs(frameOffset);
    // createImageBitmap is async and non-blocking — resolves after browser
    // decodes the sub-region without stalling the main thread
    createImageBitmap(image, srcX, 0, frameWidth, frameHeight)
      .then(bitmap => {
        // Transfer the bitmap zero-copy — main thread loses ownership,
        // worker receives it directly without copying pixel data
        worker.postMessage(
          { bitmap, width: frameWidth, height: frameHeight, cellSize, frameOffset },
          [bitmap],
        );
      })
      .catch(() => {
        // createImageBitmap failed for this frame — decrement remaining so the
        // worker still terminates when all other frames finish (or immediately
        // if this was the last one).
        if (--remaining === 0) worker.terminate();
      });
  }
}
