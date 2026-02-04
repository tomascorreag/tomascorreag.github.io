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
    this.isFirstJump = true;
    this.colorRevealed = false;
    this.lastDirection = -1;  // Start facing right (flipped)

    // Glow state
    this.permanentGlowBonus = 0;
    this.lastMouseX = null;
    this.lastMouseY = null;
    this.glowAnimationId = null;

    // Mouse interaction handlers (stored for cleanup)
    this.mouseHandler = null;
    this.clickHandler = null;
  }

  /**
   * Creates the rabbit DOM element
   */
  createElement() {
    const el = document.createElement('div');
    // Start flipped (facing right) for first jump
    el.className = 'rabbit spawning flipped';
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
    };
    this.element.addEventListener('animationend', onSpawnEnd);

    return this;
  }

  /**
   * Plays the full jump animation
   * Returns a Promise that resolves when complete
   */
  jump() {
    return new Promise(resolve => {
      if (!this.element || this.isSpawning) return resolve();

      const isFirstJump = this.isFirstJump;
      const visualWidth = RABBIT_CONFIG.width * this.scale;
      const jumpDist = RABBIT_CONFIG.jumpDistance;
      const edgeMargin = 20;  // px buffer from screen edge

      // Check which directions are valid (won't go off-screen)
      const canGoLeft = this.x - jumpDist >= edgeMargin;
      const canGoRight = this.x + jumpDist + visualWidth <= window.innerWidth - edgeMargin;

      // Determine direction: 1 = left (unflipped), -1 = right (flipped)
      let direction;

      if (isFirstJump) {
        // First jump prefers right, but respects edge
        direction = canGoRight ? -1 : 1;
        this.isFirstJump = false;
        this.element.classList.add('color-fade');
      } else {
        // Random direction, but force opposite if at edge
        if (!canGoLeft && !canGoRight) {
          // Trapped - don't jump (shouldn't happen with normal jump distance)
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

        this.element.classList.remove('jumping');

        // Stop continuous glow updates
        this.stopGlowAnimation();

        // After first jump, keep overlay hidden permanently
        if (isFirstJump) {
          this.element.classList.remove('color-fade');
          this.element.classList.add('color-revealed');
          this.colorRevealed = true;
        }

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

    // Get actual rendered position (includes CSS animation transforms)
    const rect = this.element.getBoundingClientRect();

    // Bottom center of the rendered element
    const rabbitBottomX = rect.left + rect.width / 2;
    const rabbitBottomY = rect.bottom;

    const dx = clientX - rabbitBottomX;
    const dy = clientY - rabbitBottomY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return { distance, rabbitBottomX, rabbitBottomY };
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
  enableMouseReaction(threshold = RABBIT_CONFIG.mouseThreshold) {
    if (!this.element) return;

    // Remove early mouse handler if it exists (was used during spawn)
    if (this.earlyMouseHandler) {
      document.removeEventListener('mousemove', this.earlyMouseHandler);
      this.earlyMouseHandler = null;
    }

    this.mouseHandler = (e) => {
      // Store mouse position for glow updates during movement
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      const { distance } = this.getDistanceToBottomCenter(e.clientX, e.clientY);

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

    // Click handler for permanent glow boost
    this.clickHandler = (e) => {
      const { distance } = this.getDistanceToBottomCenter(e.clientX, e.clientY);

      if (distance < RABBIT_CONFIG.clickRadius) {
        this.permanentGlowBonus = Math.min(
          this.permanentGlowBonus + RABBIT_CONFIG.glowBoostPerClick,
          RABBIT_CONFIG.maxPermanentGlow
        );
        // Update glow immediately with new permanent bonus
        this.updateGlow(distance);
      }
    };

    this.addEventListener(document, 'mousemove', this.mouseHandler);
    this.addEventListener(document, 'click', this.clickHandler);
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
      document.removeEventListener('mousemove', this.mouseHandler);
      this.eventHandlers = this.eventHandlers.filter(
        h => h.handler !== this.mouseHandler
      );
      this.mouseHandler = null;
    }
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
      this.eventHandlers = this.eventHandlers.filter(
        h => h.handler !== this.clickHandler
      );
      this.clickHandler = null;
    }
  }

  /**
   * Clean up (extends parent)
   */
  destroy() {
    this.disableMouseReaction();
    super.destroy();
  }
}
