/**
 * Sprite Base Class
 *
 * Base class for interactive sprite elements. Handles common functionality
 * like positioning, event listener management, and cleanup.
 *
 * Think of this like a MonoBehaviour base class - provides common lifecycle
 * and utility methods that specific sprites can extend.
 */

export class Sprite {
  constructor(options = {}) {
    // DOM element reference
    this.element = null;

    // Position tracking (viewport-relative)
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;

    // Visual scale (like transform.localScale in Unity)
    this.scale = options.scale ?? 1;

    // Resource tracking for cleanup
    this.eventHandlers = [];  // Array of { target, event, handler }
    this.timers = [];         // Array of timeout/interval IDs
    this.isDestroyed = false;
  }

  /**
   * Creates and returns the DOM element for this sprite.
   * Override in subclass to create specific element structure.
   */
  createElement() {
    const el = document.createElement('div');
    el.className = 'sprite';
    return el;
  }

  /**
   * Spawns the sprite into the DOM at the given position
   * @param {HTMLElement} parent - Parent element to append to (default: document.body)
   */
  spawn(parent = document.body) {
    if (this.element) {
      console.warn('Sprite already spawned');
      return this;
    }

    this.element = this.createElement();
    this.updatePosition();
    parent.appendChild(this.element);

    return this;
  }

  /**
   * Updates the DOM element's position based on x, y properties
   */
  updatePosition() {
    if (!this.element) return;
    this.element.style.left = `${this.x}px`;
    this.element.style.top = `${this.y}px`;
  }

  /**
   * Sets position and updates DOM
   */
  setPosition(x, y) {
    this.x = x;
    this.y = y;
    this.updatePosition();
  }

  /**
   * Adds an event listener and tracks it for cleanup
   * Like subscribing to events in Unity - always track so you can unsubscribe
   *
   * @param {EventTarget} target - Element to listen on
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} options - addEventListener options
   */
  addEventListener(target, event, handler, options) {
    target.addEventListener(event, handler, options);

    // Only track non-once handlers (once handlers auto-remove)
    if (!options?.once) {
      this.eventHandlers.push({ target, event, handler });
    }
  }

  /**
   * Sets a timeout and tracks it for cleanup
   * @returns {number} Timeout ID
   */
  setTimeout(callback, delay) {
    const id = setTimeout(() => {
      // Remove from tracking once executed
      this.timers = this.timers.filter(t => t !== id);
      callback();
    }, delay);
    this.timers.push(id);
    return id;
  }

  /**
   * Removes the sprite from DOM and cleans up all resources
   * Like OnDestroy() in Unity - always clean up subscriptions
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Remove all tracked event listeners
    for (const { target, event, handler } of this.eventHandlers) {
      target.removeEventListener(event, handler);
    }
    this.eventHandlers = [];

    // Clear all timers
    for (const id of this.timers) {
      clearTimeout(id);
    }
    this.timers = [];

    // Remove from DOM
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
