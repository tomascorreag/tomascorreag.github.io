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

export class ParticleMorph {
  constructor(config) {
    this.config = config;
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.animationId = null;
    this.startTime = 0;
    this.morphColor = null; // per-morph color override
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
    return new Promise(resolve => {
      this.resolveStart = resolve;
      this.morphColor = color || null;
      this.createCanvas(container);

      // Generate cells for source and target
      const sourceCells = this.generateCells(source);
      const targetCells = this.generateCells(target);

      // Create particles mapping source → target positions
      this.generateParticles(source, target, sourceCells, targetCells);

      // Kick off the animation loop
      this.startTime = performance.now();
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
   * Creates a fullscreen fixed canvas for rendering particles.
   */
  createCanvas(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'particle-canvas crt-effects';
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
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

    // Frame dimensions — single frame from the spritesheet
    const frameW = frameWidth;
    const frameH = frameHeight;

    // Draw just this frame onto an offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = frameW;
    offscreen.height = frameH;
    const offCtx = offscreen.getContext('2d');

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

    // Shuffle both arrays to randomize pairing
    const shuffledSource = [...sourceCells].sort(() => Math.random() - 0.5);
    const shuffledTarget = [...targetCells].sort(() => Math.random() - 0.5);

    this.particles = [];

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
    const elapsed = timestamp - this.startTime;
    const {
      dissolveDuration, driftDuration, convergeDuration, settleDuration,
      stiffnessStart, stiffnessEnd, damping,
      noiseAmplitude, noiseFrequency, noiseSpeed,
      maxSpawnDelay,
    } = this.config;

    const totalDuration = dissolveDuration + driftDuration + convergeDuration + settleDuration;
    let allSettled = elapsed >= totalDuration + maxSpawnDelay;

    // Update each particle
    for (const p of this.particles) {
      // Per-particle timeline (accounting for stagger delay)
      const particleElapsed = elapsed - p.delay;
      if (particleElapsed < 0) {
        allSettled = false;
        continue;
      }

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

      // Turbulence: layered sine waves that decay with progress
      const turbDecay = Math.max(0, 1 - progress * progress);
      const time = timestamp * noiseSpeed * 0.001;
      const nx = p.x * noiseFrequency + p.noiseOffset;
      const ny = p.y * noiseFrequency + p.noiseOffset;

      const turbX = this.noise2D(nx, ny + time) * noiseAmplitude * turbDecay;
      const turbY = this.noise2D(ny + 31.7, nx - time) * noiseAmplitude * turbDecay;

      // Apply forces to velocity
      p.vx += forceX + turbX;
      p.vy += forceY + turbY;

      // Damping
      p.vx *= damping;
      p.vy *= damping;

      // Integrate
      p.x += p.vx;
      p.y += p.vy;
    }

    // Render
    this.render();

    // Continue or resolve
    if (allSettled) {
      // Snap all particles to exact targets for pixel-perfect result
      for (const p of this.particles) {
        p.x = p.targetX;
        p.y = p.targetY;
        p.alpha = 1;
      }
      this.render();
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
   */
  render() {
    const ctx = this.ctx;
    const color = this.morphColor || this.config.color;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const p of this.particles) {
      if (p.alpha <= 0) continue;

      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }

    ctx.globalAlpha = 1;
  }
}
