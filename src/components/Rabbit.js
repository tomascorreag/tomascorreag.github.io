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
      const visualHeight = RABBIT_CONFIG.height * this.scale;
      this.y = window.innerHeight - visualHeight;
      this.updatePosition();
      this.refreshBottomCenter();
    };
    this.element.addEventListener('animationend', onSpawnEnd);

    return this;
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

    // Start tracking mouse for glow during drop
    this.earlyMouseHandler = (e) => {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    };
    document.addEventListener('mousemove', this.earlyMouseHandler);
    this.startGlowAnimation();

    // Use dropping class (drop-only, no sprite animation)
    this.element.classList.add('dropping');

    const onDropEnd = (e) => {
      if (e.animationName !== 'rabbit-spawn-drop') return;
      this.element.removeEventListener('animationend', onDropEnd);

      this.stopGlowAnimation();
      this.isSpawning = false;
      this.element.classList.remove('dropping');

      // Lock final position at bottom of viewport
      const visualHeight = RABBIT_CONFIG.height * this.scale;
      this.y = window.innerHeight - visualHeight;
      this.updatePosition();
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

        // Update position based on direction
        const offset = RABBIT_CONFIG.jumpDistance * direction;
        this.x = this.x - offset;
        this.updatePosition();
        this.refreshBottomCenter();

        this.element.classList.remove('jumping');

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
    // The cached bottom-center goes stale if the viewport changes size
    // (the rabbit is anchored to the viewport bottom).
    this.addEventListener(window, 'resize', () => this.refreshBottomCenter());
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
   * Returns the rabbit's current CSS position as a rect for use as
   * the particle morph source.
   *
   * @returns {{ x: number, y: number, w: number, h: number }}
   */
  freeze() {
    this.isFrozen = true;

    // Stop all interaction
    this.disableMouseReaction();

    // Stop any in-progress jump
    this.element.classList.remove('jumping');
    this.isJumping = false;
    this.jumpCooldown = false;

    // Reset glow to neutral
    this.element.style.setProperty('--crt-glow-intensity', 1);
    this.element.style.setProperty('--crt-glow-spread', 1);

    // Return the CSS position (not visual bounding rect — the particle
    // morph needs the untransformed position to apply its own flip math)
    return {
      x: this.x,
      y: this.y,
      w: RABBIT_CONFIG.width,
      h: RABBIT_CONFIG.height,
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
