/**
 * ParticleMorph — Reusable particle dissolution/formation effect
 *
 * Creates a fullscreen canvas overlay where square particles scatter from
 * a source rectangle and reassemble into a target image shape.
 *
 * Think of it like a VFX particle system in Unity:
 *   - Particles have position, velocity, and forces acting on them
 *   - A spring force pulls each particle toward its target position
 *   - Turbulence (layered sine waves) adds organic drift
 *   - Damping gradually kills velocity for a clean settle
 *
 * The physics loop runs per-frame via requestAnimationFrame — same concept
 * as Update() in Unity, but browser-driven instead of engine-driven.
 *
 * Usage:
 *   const morph = new ParticleMorph(PARTICLE_CONFIG);
 *   await morph.start(cursorRect, targetRect, spriteImage, frameOffset, container);
 *   // particles have settled — DOM element can be placed underneath
 *   await morph.handoff();  // fade canvas out
 *   morph.destroy();        // remove canvas from DOM
 */

export class ParticleMorph {
  constructor(config) {
    this.config = config;
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.animationId = null;
    this.startTime = 0;
  }

  /**
   * Main entry — runs the full particle animation.
   *
   * @param {DOMRect|{x,y,w,h}} sourceRect — bounding box particles scatter FROM
   * @param {{x,y,w,h}} targetRect — position/size of the target DOM element
   * @param {HTMLImageElement} targetImage — spritesheet image (already loaded)
   * @param {number} targetFrame — x-offset into spritesheet (e.g. -512 for idle)
   * @param {HTMLElement} container — DOM parent for the canvas
   * @returns {Promise} resolves when particles have fully settled
   */
  start(sourceRect, targetRect, targetImage, targetFrame, container) {
    return new Promise(resolve => {
      this.resolveStart = resolve;
      this.createCanvas(container);

      // Sample which cells in the target sprite are opaque
      const cells = this.sampleTargetImage(targetImage, targetFrame);

      // Create particles with source/target positions
      this.generateParticles(sourceRect, targetRect, cells);

      // Kick off the animation loop
      this.startTime = performance.now();
      this.animate = this.animate.bind(this);
      this.animationId = requestAnimationFrame(this.animate);
    });
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
  }

  // ──────────────────────────────────────────────
  // Internal methods
  // ──────────────────────────────────────────────

  /**
   * Creates a fullscreen fixed canvas for rendering particles.
   *
   * position: fixed + inset 0 makes it cover the entire viewport,
   * similar to a screen-space overlay in Unity.
   * pointer-events: none lets clicks pass through to elements below.
   */
  createCanvas(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'particle-canvas crt-effects';
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    // // Subtle blur to match CRT phosphor feel
    // this.canvas.style.filter = 'blur(0.4px)';

    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Samples the target sprite image to find opaque cells.
   *
   * Works like reading pixel data from a RenderTexture in Unity:
   * 1. Draw the sprite frame onto an offscreen canvas
   * 2. Read back pixel data with getImageData
   * 3. Group pixels into cells (cellSize × cellSize)
   * 4. A cell counts as "opaque" if ANY pixel in it has alpha > 0
   *
   * @param {HTMLImageElement} image — the full spritesheet
   * @param {number} frameOffset — negative px offset (e.g. -512)
   * @returns {Array<{localX, localY, r, g, b, a}>} — one entry per opaque cell
   */
  sampleTargetImage(image, frameOffset) {
    const { cellSize } = this.config;

    // Frame dimensions — single frame from the spritesheet
    // The spritesheet is horizontal: each frame is 32px wide, 64px tall
    const frameW = 32;
    const frameH = 64;

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
            // Average color of opaque pixels — stored for future per-particle color
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
   * Creates particle objects with source and target positions.
   *
   * Source positions: random within the cursor bounding rect (the "shatter")
   * Target positions: calculated from cell positions, accounting for the
   *   DOM element's transform: scale(-4, 4) with transform-origin: top center
   *
   * The flip math:
   *   The rabbit element is 32px wide, scaled 4x, flipped horizontally.
   *   transform-origin: top center means the center of the 32px width (16px)
   *   is the flip axis. A source pixel at x maps to:
   *     screenX = elementLeft + 16*scale + (16 - x) * scale    (before flip: 16 + x - 16)
   *   Wait — with scale(-4, 4) and origin at center:
   *     screenX = elementLeft + halfWidth + (halfWidth - localX) * scale
   *   where halfWidth = (width/2) * scale = 16 * 4 = 64
   *   Simplified: screenX = elementLeft + 2*halfWidth - localX*scale
   *             = elementLeft + width*scale - localX*scale
   *
   * Actually let's think about it more carefully:
   *   The element is 32px. transform-origin: top center = (16px, 0).
   *   scale(-4, 4) around that origin.
   *   A point at local (lx, ly) in the 32px element transforms to:
   *     screenX = elementLeft + 16 + (-4) * (lx - 16) = elementLeft + 16 - 4*lx + 64
   *             = elementLeft + 80 - 4*lx
   *   screenY = elementTop + 4 * ly
   *
   *   But elementLeft is the CSS left, not the visual left. The visual bounding box
   *   for a 32px element with scale(-4, 4) from center is:
   *     visual left = cssLeft + 16 - 16*4 = cssLeft - 48
   *     visual width = 128
   *   So if targetRect.x = cssLeft (the position set by Sprite.updatePosition):
   *     screenX = targetRect.x + 80 - 4 * localX
   *     screenY = targetRect.y + 4 * localY
   */
  generateParticles(sourceRect, targetRect, cells) {
    const { cellSize, displayScale, maxSpawnDelay } = this.config;
    const particleSize = cellSize * displayScale;

    // Source rect (cursor bounding box)
    const sx = sourceRect.x ?? sourceRect.left;
    const sy = sourceRect.y ?? sourceRect.top;
    const sw = sourceRect.w ?? sourceRect.width;
    const sh = sourceRect.h ?? sourceRect.height;

    // Target element CSS position (before transform)
    const tx = targetRect.x;
    const ty = targetRect.y;

    this.particles = cells.map(cell => {
      // Random starting position within cursor rect
      const startX = sx + Math.random() * sw;
      const startY = sy + Math.random() * sh;

      // Target screen position (accounting for flip)
      // See math explanation above
      const targetX = tx + 80 - displayScale * cell.localX;
      const targetY = ty + displayScale * cell.localY;

      return {
        x: startX,
        y: startY,
        vx: (Math.random() - 0.5) * 4,  // small initial scatter velocity
        vy: (Math.random() - 0.5) * 4,
        sourceX: startX,
        sourceY: startY,
        targetX,
        targetY,
        // Target color (stored for future per-particle color lerp)
        r: cell.r,
        g: cell.g,
        b: cell.b,
        a: cell.a,
        // Per-particle randomness
        noiseOffset: Math.random() * 1000,
        delay: Math.random() * maxSpawnDelay,
        size: particleSize,
        alpha: 0,  // fades in during stagger
      };
    });
  }

  /**
   * The animation loop — called every frame via requestAnimationFrame.
   *
   * This is the equivalent of Update() in Unity. The browser calls this
   * ~60 times per second (matching your monitor's refresh rate).
   *
   * Each frame:
   *   1. Calculate elapsed time and per-particle progress
   *   2. Apply physics forces (spring + damping + turbulence)
   *   3. Integrate velocity → position
   *   4. Render all particles to the canvas
   *   5. Check if all particles have settled
   */
  animate(timestamp) {
    const elapsed = timestamp - this.startTime;
    const {
      dissolveDuration, driftDuration, convergeDuration, settleDuration,
      stiffnessStart, stiffnessEnd, damping,
      noiseAmplitude, noiseFrequency, noiseSpeed,
    } = this.config;

    const totalDuration = dissolveDuration + driftDuration + convergeDuration + settleDuration;
    let allSettled = elapsed >= totalDuration + this.config.maxSpawnDelay;

    // Update each particle
    for (const p of this.particles) {
      // Per-particle timeline (accounting for stagger delay)
      const particleElapsed = elapsed - p.delay;
      if (particleElapsed < 0) {
        // Not started yet — keep invisible
        p.alpha = 0;
        allSettled = false;
        continue;
      }

      // Normalized progress (0 → 1) over the full duration
      const progress = Math.min(particleElapsed / totalDuration, 1);

      // Fade in: quick alpha ramp over first 100ms of this particle's life
      p.alpha = Math.min(particleElapsed / 100, 1);

      // Spring stiffness ramps up as progress increases
      // lerp(start, end, progress²) — quadratic ramp for late acceleration
      const stiffness = stiffnessStart + (stiffnessEnd - stiffnessStart) * progress * progress;

      // Spring force: F = k * (target - current)
      // This is Hooke's law — same as spring joints in physics engines
      const forceX = stiffness * (p.targetX - p.x);
      const forceY = stiffness * (p.targetY - p.y);

      // Turbulence: layered sine waves that decay with progress
      // Decays as (1 - progress²) so it's strong early, gone by settle phase
      const turbDecay = Math.max(0, 1 - progress * progress);
      const time = timestamp * noiseSpeed * 0.001;
      const nx = p.x * noiseFrequency + p.noiseOffset;
      const ny = p.y * noiseFrequency + p.noiseOffset;

      const turbX = this.noise2D(nx, ny + time) * noiseAmplitude * turbDecay;
      const turbY = this.noise2D(ny + 31.7, nx - time) * noiseAmplitude * turbDecay;

      // Apply forces to velocity
      p.vx += forceX;
      p.vy += forceY;
      p.vx += turbX;
      p.vy += turbY;

      // Damping: multiply velocity by factor < 1 each frame
      // This is like drag — prevents infinite oscillation
      p.vx *= damping;
      p.vy *= damping;

      // Integrate: position += velocity (Euler integration)
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
   *
   * This isn't Perlin noise — it's a sum of sine waves at different
   * frequencies and phases. Good enough for organic-looking turbulence
   * without needing a noise library. Same trick used in simple shader
   * effects where you layer sin() calls for fake noise.
   *
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
   *
   * clearRect wipes the canvas (like clearing a render target),
   * then fillRect draws each particle as a colored square.
   *
   * Uses uniform green color for now. The per-particle r/g/b stored
   * on each particle is ready for future color lerp support.
   */
  render() {
    const ctx = this.ctx;
    const { color } = this.config;

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
