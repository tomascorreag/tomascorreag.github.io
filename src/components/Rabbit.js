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

    // Mouse interaction handler (stored for cleanup)
    this.mouseHandler = null;
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

    // Listen for spawn animation end (specifically the drop, not sprite)
    // Can't use { once: true } because multiple animations fire animationend
    const onSpawnEnd = (e) => {
      // Only respond to the drop animation, not the sprite animation
      if (e.animationName !== 'rabbit-spawn-drop') return;

      // Remove listener now that we've handled the correct animation
      this.element.removeEventListener('animationend', onSpawnEnd);

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
          direction = Math.random() < 0.5 ? 1 : -1;
        }
      }

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
   * Enables mouse-triggered jumping
   * @param {number} threshold - Distance in pixels to trigger jump
   */
  enableMouseReaction(threshold = RABBIT_CONFIG.mouseThreshold) {
    if (!this.element) return;

    const visualHeight = RABBIT_CONFIG.height * this.scale;
    const visualWidth = RABBIT_CONFIG.width * this.scale;

    this.mouseHandler = (e) => {
      // Block if spawning, jumping, or in cooldown
      if (this.isSpawning || this.isJumping || this.jumpCooldown) return;

      // Calculate rabbit's bottom center
      const rabbitBottomX = this.x + visualWidth / 2;
      const rabbitBottomY = this.y + visualHeight;

      // Distance from mouse to rabbit's bottom center
      const dx = e.clientX - rabbitBottomX;
      const dy = e.clientY - rabbitBottomY;
      const distance = Math.sqrt(dx * dx + dy * dy);

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

    this.addEventListener(document, 'mousemove', this.mouseHandler);
  }

  /**
   * Disables mouse reaction
   */
  disableMouseReaction() {
    if (this.mouseHandler) {
      document.removeEventListener('mousemove', this.mouseHandler);
      this.eventHandlers = this.eventHandlers.filter(
        h => h.handler !== this.mouseHandler
      );
      this.mouseHandler = null;
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
