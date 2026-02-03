/**
 * Animation Configuration - Single Source of Truth
 *
 * All timing values, distances, and animation constants are defined here.
 * Think of this like a ScriptableObject in Unity - central data container.
 *
 * CSS animations that need these values can have them injected via
 * CSS custom properties set by JavaScript.
 */

// Terminal typing animation
export const TYPING_CONFIG = {
  baseSpeed: 90,       // Base ms per character
  variance: 0.33,       // ±35% random variation
  spacePause: 130,      // Extra pause around spaces (ms)
  linePause: 500,       // Pause after submitting a line (ms)
};

// Rabbit sprite animation
export const RABBIT_CONFIG = {
  // Sprite dimensions (unscaled)
  width: 32,
  height: 64,
  scale: 4,
  frameCount: 17,

  // Animation timing (must match CSS keyframe durations)
  spawnDuration: 750,   // ms - matches CSS rabbit-spawn-drop
  jumpDuration: 1100,   // ms - matches CSS rabbit-jump-sprite
  jumpCooldown: 100,    // ms - delay between jumps

  // Movement
  jumpDistance: 300,    // px per jump (matches CSS rabbit-jump-move)

  // Interaction
  mouseThreshold: 150,  // px distance to trigger jump

  // Frame positions for sprite sheet (px offset)
  // Formula: frame N = -((N - 1) * 32)px
  frames: {
    idle: -512,         // Frame 17 - standing still
    jumpStart: -32,     // Frame 2 - first jump frame
    spawnStart: -288,   // Frame 10 - spawn animation start
    spawnEnd: -512,     // Frame 17 - spawn animation end
  },
};

// Cursor animation
export const CURSOR_CONFIG = {
  blinkDuration: 1000,  // ms - matches CSS blink animation
};

// General timing presets (for consistency across animations)
export const TIMING = {
  fast: 150,
  normal: 300,
  slow: 600,
  verySlow: 1000,
};

/**
 * Injects animation config as CSS custom properties
 * Call this on page load to sync JS config with CSS
 */
export function injectCSSVariables() {
  const root = document.documentElement;

  // Rabbit config
  root.style.setProperty('--rabbit-scale', RABBIT_CONFIG.scale);
  root.style.setProperty('--rabbit-width', `${RABBIT_CONFIG.width}px`);
  root.style.setProperty('--rabbit-height', `${RABBIT_CONFIG.height}px`);
  root.style.setProperty('--rabbit-spawn-duration', `${RABBIT_CONFIG.spawnDuration}ms`);
  root.style.setProperty('--rabbit-jump-duration', `${RABBIT_CONFIG.jumpDuration}ms`);
  root.style.setProperty('--rabbit-jump-distance', `${RABBIT_CONFIG.jumpDistance}px`);

  // Timing presets
  root.style.setProperty('--timing-fast', `${TIMING.fast}ms`);
  root.style.setProperty('--timing-normal', `${TIMING.normal}ms`);
  root.style.setProperty('--timing-slow', `${TIMING.slow}ms`);
}
