/**
 * Rabbit Sprite
 *
 * Interactive pixel art rabbit that drops from the terminal cursor
 * and jumps when the mouse gets close.
 *
 * Uses CSS sprite sheet animation with a green overlay that fades
 * on the first jump to reveal original colors.
 */

import { Sprite } from './Sprite.js';
import { RABBIT_CONFIG } from '../config/animations.js';
import { prefersReducedMotion } from '../config/device.js';

export class Rabbit extends Sprite {
  constructor(options = {}) {
    super({
      scale: RABBIT_CONFIG.scale,
      ...options,
    });

    // State flags
    this.isSpawning = true;
    this.isJumping = false;
    this.jumpCooldown = false;
    this.lastDirection = -1;  // Start facing right (flipped)

    // Glow state
    this.permanentGlowBonus = 0;
    this.lastMouseX = null;
    this.lastMouseY = null;
    this.glowAnimationId = null;
    this.isFrozen = false;

    // Cached bottom-center point — getBoundingClientRect is a forced layout
    // read, and the mousemove path runs up to 1000×/s on high-Hz mice. The
    // rect only changes during spawn/drop/jump animations and on resize, so
    // we cache it when the rabbit settles (like caching a world transform
    // instead of querying the physics engine every frame).
    this._bottomCenter = null;
    this._mouseRafId = null;

    // Mouse interaction handlers (stored for cleanup)
    this.mouseHandler = null;
    this.clickHandler = null;
    this.onClickCallback = null;
  }

  /**
   * Creates the rabbit DOM element
   */
  createElement() {
    const el = document.createElement('div');
    // Start flipped (facing right) for first jump
    el.className = 'rabbit spawning flipped color-revealed';
    el.style.position = 'fixed';
    return el;
  }

  /**
   * Spawns the rabbit at a position and drops to bottom of viewport
   * @param {number} x - Starting X position (centered on this point)
   * @param {number} y - Starting Y position (top of rabbit)
   * @param {HTMLElement} container - Container to spawn into (default: document.body)
   */
  spawnAndDrop(x, y, container = document.body) {
    this.x = x;
    this.y = y;

    this.spawn(container);

    // Apply CRT effects to rabbit (inner element, not wrapper)
    this.element.classList.add('crt-effects');

    this.updatePosition();

    // Reduced motion: skip the drop, land at the bottom immediately.
    if (prefersReducedMotion()) {
      this.element.classList.remove('spawning');
      this.isSpawning = false;
      const visualHeight = RABBIT_CONFIG.height * this.scale;
      this.y = window.innerHeight - visualHeight;
      this.updatePosition();
      this.refreshBottomCenter();
      return this;
    }

    // .spawning is already on the element (createElement), so the drop
    // distance must be set in this same task, before the first style recalc
    // starts the animation.
    this._armDrop();

    // Start tracking mouse position immediately for glow during drop
    this.earlyMouseHandler = (e) => {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    };
    document.addEventListener('mousemove', this.earlyMouseHandler);

    // Start glow animation during drop
    this.startGlowAnimation();

    // Listen for spawn animation end (specifically the drop, not sprite)
    // Can't use { once: true } because multiple animations fire animationend
    const onSpawnEnd = (e) => {
      // Only respond to the drop animation, not the sprite animation
      if (e.animationName !== 'rabbit-spawn-drop') return;

      // Remove listener now that we've handled the correct animation
      this.element.removeEventListener('animationend', onSpawnEnd);

      // Stop glow animation loop
      this.stopGlowAnimation();

      this.isSpawning = false;
      this.element.classList.remove('spawning');

      // Lock in final position at bottom of viewport
      this._commitDrop();
      this.refreshBottomCenter();
    };
    this.element.addEventListener('animationend', onSpawnEnd);

    return this;
  }

  /**
   * Sets --rabbit-drop-dy: the px distance from the current top to the landing
   * top (viewport bottom minus visual height). rabbit-spawn-drop animates the
   * `translate` property by this amount, so the fall runs on the compositor
   * instead of animating `top` (a layout property under a heavy filter).
   * transform-origin is top center, so the scaled sprite's visual top equals
   * its CSS top and the visual height is height × scale.
   */
  _armDrop() {
    const visualHeight = RABBIT_CONFIG.height * this.scale;
    const dy = window.innerHeight - visualHeight - this.y;
    this.element.style.setProperty('--rabbit-drop-dy', `${dy}px`);
  }

  /**
   * Commits the landing: writes the final `top` and drops the translate
   * variable. Called in the same task that removes the drop class, so the
   * translate (held by `forwards`) and the new top swap in one frame and the
   * cached geometry (bottom-center, jump math) reads the real position.
   */
  _commitDrop() {
    const visualHeight = RABBIT_CONFIG.height * this.scale;
    this.y = window.innerHeight - visualHeight;
    this.updatePosition();
    this.element.style.removeProperty('--rabbit-drop-dy');
  }

  /**
   * Creates the rabbit DOM element silently (hidden).
   * Used by the particle morph path — particles form the shape first,
   * then this element is revealed underneath when the canvas fades out.
   *
   * @param {number} x - CSS left position
   * @param {number} y - CSS top position
   * @param {HTMLElement} container - Parent element
   */
  spawnSilent(x, y, container = document.body) {
    this.x = x;
    this.y = y;

    this.spawn(container);
    // Remove spawning class — particle morph handles the reveal,
    // we don't want the spawn sprite+drop animation from .spawning
    this.element.classList.remove('spawning');
    this.element.classList.add('crt-effects');
    // Start at spawn frame (frame 10) to match particle morph target
    this.element.style.backgroundPosition = `${RABBIT_CONFIG.frames.spawnStart}px 0`;
    this.element.style.visibility = 'hidden';
    this.updatePosition();

    return this;
  }

  /**
   * Makes the hidden rabbit visible.
   */
  reveal() {
    if (this.element) {
      this.element.style.visibility = 'visible';
    }
  }

  /**
   * Starts only the drop animation (no sprite animation).
   * Used after particle morph — the shape is already formed by particles,
   * so we skip the spawn sprite animation and just do the gravity fall.
   */
  startDrop() {
    if (!this.element) return;

    this.reveal();

    // Reduced motion: skip the fall, land at the bottom immediately.
    if (prefersReducedMotion()) {
      this.isSpawning = false;
      const visualHeight = RABBIT_CONFIG.height * this.scale;
      this.y = window.innerHeight - visualHeight;
      this.updatePosition();
      this.element.style.backgroundPosition = `0px 0`;
      this.refreshBottomCenter();
      return;
    }

    // Start tracking mouse for glow during drop
    this.earlyMouseHandler = (e) => {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    };
    document.addEventListener('mousemove', this.earlyMouseHandler);
    this.startGlowAnimation();

    // Use dropping class (drop-only, no sprite animation). Distance first,
    // so the animation starts with the right target.
    this._armDrop();
    this.element.classList.add('dropping');

    const onDropEnd = (e) => {
      if (e.animationName !== 'rabbit-spawn-drop') return;
      this.element.removeEventListener('animationend', onDropEnd);

      this.stopGlowAnimation();
      this.isSpawning = false;
      this.element.classList.remove('dropping');

      // Lock final position at bottom of viewport
      this._commitDrop();
      this.element.style.backgroundPosition = `0px 0`;
      this.refreshBottomCenter();
    };
    this.element.addEventListener('animationend', onDropEnd);
  }

  /**
   * Plays the full jump animation
   * Returns a Promise that resolves when complete
   */
  jump() {
    return new Promise(resolve => {
      if (!this.element || this.isSpawning) return resolve();

      const visualWidth = RABBIT_CONFIG.width * this.scale;
      const jumpDist = RABBIT_CONFIG.jumpDistance;
      const edgeMargin = RABBIT_CONFIG.edgeMargin;

      // Check which directions are valid (won't go off-screen)
      const canGoLeft = this.x - jumpDist >= edgeMargin;
      const canGoRight = this.x + jumpDist + visualWidth <= window.innerWidth - edgeMargin;

      // Determine direction: 1 = left (unflipped), -1 = right (flipped)
      let direction;

      // Random direction, but force opposite if at edge
      if (!canGoLeft && !canGoRight) {
        this.isJumping = false;
        return resolve();
      } else if (!canGoLeft) {
        direction = -1;  // Must go right
      } else if (!canGoRight) {
        direction = 1;   // Must go left
      } else {
        // 1/3 chance to flip direction, 2/3 chance to continue same way
        direction = Math.random() < 1/3 ? -this.lastDirection : this.lastDirection;
      }

      // Update last direction for next jump
      this.lastDirection = direction;

      // Set CSS variable for animation direction
      this.element.style.setProperty('--jump-direction', direction);

      // Flip sprite based on direction
      if (direction === -1) {
        this.element.classList.add('flipped');
      } else {
        this.element.classList.remove('flipped');
      }

      // Reduced motion: hop instantly to the destination, no arc animation.
      if (prefersReducedMotion()) {
        this.x = this.x - RABBIT_CONFIG.jumpDistance * direction;
        this.updatePosition();
        this.refreshBottomCenter();
        this.isJumping = false;
        return resolve();
      }

      // Reset animation by removing and re-adding class
      this.element.classList.remove('jumping');
      void this.element.offsetWidth;  // Force reflow
      this.element.classList.add('jumping');

      // Start continuous glow updates during jump
      this.startGlowAnimation();

      // Listen for animation end
      // Can't use { once: true } because multiple animations fire animationend
      const onJumpEnd = (e) => {
        // Only respond to the jump sprite animation
        if (e.animationName !== 'rabbit-jump-sprite') return;

        // Remove listener now that we've handled the correct animation
        this.element.removeEventListener('animationend', onJumpEnd);

        // Drop .jumping BEFORE moving and measuring. rabbit-jump-move fills
        // `forwards`, so while the class is on, the element is still shifted
        // by the full jump distance; measuring then cached the feet one jump
        // past the real rabbit, and hovering the rabbit stopped working.
        // Both changes land in the same frame, so there's no visible snap.
        this.element.classList.remove('jumping');

        // Update position based on direction
        // _anchor also catches a resize that happened mid-jump.
        this.x -= RABBIT_CONFIG.jumpDistance * direction;
        this._anchor();

        // Stop continuous glow updates
        this.stopGlowAnimation();

        this.isJumping = false;
        resolve();
      };
      this.element.addEventListener('animationend', onJumpEnd);
    });
  }

  /**
   * Calculates distance from a point to rabbit's bottom center
   * Uses getBoundingClientRect for actual rendered position (accounts for CSS animations)
   * @returns {{ distance: number, rabbitBottomX: number, rabbitBottomY: number }}
   */
  getDistanceToBottomCenter(clientX, clientY) {
    if (!this.element) {
      return { distance: Infinity, rabbitBottomX: 0, rabbitBottomY: 0 };
    }

    // While animating, the rendered position changes per frame — read live.
    // Settled, the cached point is identical and costs no layout pass.
    let rabbitBottomX, rabbitBottomY;
    if (this.isSpawning || this.isJumping || this.glowAnimationId) {
      const rect = this.element.getBoundingClientRect();
      rabbitBottomX = rect.left + rect.width / 2;
      rabbitBottomY = rect.bottom;
    } else {
      if (!this._bottomCenter) this.refreshBottomCenter();
      rabbitBottomX = this._bottomCenter.x;
      rabbitBottomY = this._bottomCenter.y;
    }

    const dx = clientX - rabbitBottomX;
    const dy = clientY - rabbitBottomY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return { distance, rabbitBottomX, rabbitBottomY };
  }

  /**
   * Hit-test: is the point inside the rabbit's rendered box?
   * Padding adds a forgiving margin around the sprite edges.
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} padding - extra px added to each side
   * @returns {boolean}
   */
  isPointOnRabbit(clientX, clientY, padding = RABBIT_CONFIG.clickRadius) {
    if (!this.element) return false;
    const r = this.element.getBoundingClientRect();
    return (
      clientX >= r.left - padding &&
      clientX <= r.right + padding &&
      clientY >= r.top - padding &&
      clientY <= r.bottom + padding
    );
  }

  /**
   * Re-reads the rendered rect and caches the bottom-center point.
   * Call whenever the rabbit settles (spawn/drop/jump end) or the
   * viewport resizes.
   */
  refreshBottomCenter() {
    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();
    this._bottomCenter = {
      x: rect.left + rect.width / 2,
      y: rect.bottom,
    };
  }

  /**
   * Updates the glow intensity based on proximity + permanent bonus
   * @param {number} distance - Current distance to rabbit's bottom center
   */
  updateGlow(distance) {
    if (!this.element) return;

    const { glowRange, maxProximityGlow, maxProximitySpread, glowExponent } = RABBIT_CONFIG;

    // Calculate proximity factor (0 at glowRange, 1 at distance 0)
    // Exponent > 1 makes it accelerate as mouse gets closer
    let proximityFactor = 0;
    if (distance < glowRange) {
      const t = 1 - distance / glowRange;
      proximityFactor = Math.pow(t, glowExponent);
    }

    // Total glow = base (1) + proximity + permanent
    const totalGlow = 1 + proximityFactor * maxProximityGlow + this.permanentGlowBonus;
    const totalSpread = 1 + proximityFactor * maxProximitySpread;

    this.element.style.setProperty('--crt-glow-intensity', totalGlow);
    this.element.style.setProperty('--crt-glow-spread', totalSpread);
  }

  /**
   * Updates glow using last known mouse position
   */
  updateGlowFromStoredPosition() {
    // Skip if no mouse position recorded yet
    if (this.lastMouseX === null || this.lastMouseY === null) return;

    const { distance } = this.getDistanceToBottomCenter(this.lastMouseX, this.lastMouseY);
    this.updateGlow(distance);
  }

  /**
   * Starts continuous glow updates (for when rabbit is moving)
   */
  startGlowAnimation() {
    if (this.glowAnimationId) return;

    const animate = () => {
      this.updateGlowFromStoredPosition();
      this.glowAnimationId = requestAnimationFrame(animate);
    };
    this.glowAnimationId = requestAnimationFrame(animate);
  }

  /**
   * Stops continuous glow updates
   */
  stopGlowAnimation() {
    if (this.glowAnimationId) {
      cancelAnimationFrame(this.glowAnimationId);
      this.glowAnimationId = null;
    }
  }

  /**
   * Enables mouse-triggered jumping and proximity glow
   * @param {number} threshold - Distance in pixels to trigger jump
   */
  enableMouseReaction(threshold = RABBIT_CONFIG.mouseThreshold, { onClick } = {}) {
    this.onClickCallback = onClick || null;
    if (!this.element) return;

    // Remove early mouse handler if it exists (was used during spawn)
    if (this.earlyMouseHandler) {
      document.removeEventListener('mousemove', this.earlyMouseHandler);
      this.earlyMouseHandler = null;
    }

    // rAF-coalesced: pointer events can outpace the display (1000Hz mice);
    // anything more than once per frame is wasted work. Latest coords win.
    this.mouseHandler = (e) => {
      // Store mouse position for glow updates during movement
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (this._mouseRafId) return;
      this._mouseRafId = requestAnimationFrame(() => {
        this._mouseRafId = null;
        this.processMouseMove();
      });
    };

    this.processMouseMove = () => {
      if (!this.element) return;
      const { distance } = this.getDistanceToBottomCenter(this.lastMouseX, this.lastMouseY);

      // Update glow based on proximity (skip if animation loop is running)
      if (!this.glowAnimationId) {
        this.updateGlow(distance);
      }

      // Block jump if spawning, jumping, or in cooldown
      if (this.isSpawning || this.isJumping || this.jumpCooldown) return;

      if (distance < threshold) {
        this.isJumping = true;  // Set immediately to block further triggers
        this.jump().then(() => {
          // Cooldown prevents immediate re-trigger
          this.jumpCooldown = true;
          this.setTimeout(() => {
            this.jumpCooldown = false;
            // Mouse may not move again: if the rabbit landed near a resting
            // cursor, react now instead of waiting for the next mousemove.
            if (this.mouseHandler && this.lastMouseX !== null) this.processMouseMove();
          }, RABBIT_CONFIG.jumpCooldown);
        });
      }
    };

    // Click handler — calls onClick callback if set, otherwise glow boost.
    // Hit-test the rabbit's actual rendered box (not a radius from its feet):
    // the sprite is ~128×256px, so a small bottom-center radius missed every
    // click that landed on the visible body. Clicks are rare, so the
    // getBoundingClientRect layout read here is cheap.
    this.clickHandler = (e) => {
      if (this.isFrozen || !this.element) return;
      if (!this.isPointOnRabbit(e.clientX, e.clientY)) return;

      if (this.onClickCallback) {
        this.onClickCallback();
        return;
      }
      const { distance } = this.getDistanceToBottomCenter(e.clientX, e.clientY);
      this.permanentGlowBonus = Math.min(
        this.permanentGlowBonus + RABBIT_CONFIG.glowBoostPerClick,
        RABBIT_CONFIG.maxPermanentGlow
      );
      this.updateGlow(distance);
    };

    this.addEventListener(document, 'mousemove', this.mouseHandler);
    this.addEventListener(document, 'click', this.clickHandler);
  }

  /** Spawns and keeps the rabbit on the viewport floor across resizes. */
  spawn(parent) {
    super.spawn(parent);
    this.addEventListener(window, 'resize', () => {
      // Mid-drop/jump the end handlers re-anchor; frozen = mid-morph pose.
      if (!this.isSpawning && !this.isJumping && !this.isFrozen) this._anchor();
    });
    return this;
  }

  /**
   * Snaps `top` to the viewport floor and pulls `x` back inside the edges.
   * `top` is fixed px written on landing, so a taller window left the rabbit
   * floating and a shorter one dropped it below the fold.
   */
  _anchor() {
    if (!this.element) return;
    const { width, height, edgeMargin } = RABBIT_CONFIG;
    const maxX = window.innerWidth - width * this.scale - edgeMargin;
    this.x = Math.max(Math.min(edgeMargin, maxX), Math.min(this.x, maxX));
    this.y = window.innerHeight - height * this.scale;
    this.updatePosition();
    this.refreshBottomCenter();
  }

  /**
   * Disables mouse reaction and click glow
   */
  disableMouseReaction() {
    this.stopGlowAnimation();

    if (this.earlyMouseHandler) {
      document.removeEventListener('mousemove', this.earlyMouseHandler);
      this.earlyMouseHandler = null;
    }
    if (this.mouseHandler) {
      this.removeEventListener(document, 'mousemove', this.mouseHandler);
      this.mouseHandler = null;
    }
    if (this.clickHandler) {
      this.removeEventListener(document, 'click', this.clickHandler);
      this.clickHandler = null;
    }
  }

  /**
   * Freezes the rabbit — stops all animations and disables interaction.
   * Returns the pose the rabbit is showing right now (mid-jump or mid-drop
   * included) for use as the particle morph source.
   *
   * @returns {{ x: number, y: number, w: number, h: number, frame: number, flipped: boolean }}
   */
  freeze() {
    this.isFrozen = true;

    // Stop all interaction
    this.disableMouseReaction();

    // Capture the rendered pose BEFORE stopping the animations. A jump moves
    // the sprite with an animated transform and swaps frames via an animated
    // background-position, so this.x/this.y and the idle frame describe where
    // the jump started, not what's on screen.
    const pose = this.getRenderedPose();

    // Stop any in-progress jump
    this.element.classList.remove('jumping');
    this.isJumping = false;
    this.jumpCooldown = false;

    // Reset glow to neutral
    this.element.style.setProperty('--crt-glow-intensity', 1);
    this.element.style.setProperty('--crt-glow-spread', 1);

    return pose;
  }

  /**
   * The on-screen pose in the morph's coordinate convention: x/y are the
   * untransformed CSS left/top that would put the sprite where it's drawn
   * now (ParticleMorph applies the scale and flip math itself).
   *
   * transform-origin is top center, so the scaled box is centred on
   * left + width/2 and its top equals the CSS top; reading the rendered rect
   * folds in every animated offset (jump translate, drop translate).
   */
  getRenderedPose() {
    const { width, height } = RABBIT_CONFIG;
    const rect = this.element.getBoundingClientRect();
    // Animated value mid-jump (e.g. "-160px"); snap to a whole frame.
    const bgX = parseFloat(getComputedStyle(this.element).backgroundPositionX);
    const frame = Number.isFinite(bgX)
      ? Math.round(bgX / width) * width
      : RABBIT_CONFIG.frames.idle;
    return {
      x: rect.left + (rect.width - width) / 2,
      y: rect.top,
      w: width,
      h: height,
      frame,
      flipped: this.element.classList.contains('flipped'),
    };
  }

  /**
   * Clean up (extends parent)
   */
  destroy() {
    this.disableMouseReaction();
    super.destroy();
  }
}
