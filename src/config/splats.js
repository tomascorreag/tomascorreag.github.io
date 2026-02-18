/**
 * Gaussian Splat Viewer Configuration
 *
 * Centralized defaults for Three.js renderer, camera, orbit controls,
 * and quality tiers. Same pattern as crt.js and animations.js —
 * one config file, imported wherever needed.
 *
 * Think of this like a quality settings preset in a game engine:
 * desktop gets full spherical harmonics (detailed lighting),
 * mobile gets SH0 (flat color per splat, ~4x cheaper to render).
 */

import { deviceTier } from './device.js';

export const SPLAT_CONFIG = Object.freeze({
  // --- Camera ---
  fov: 50,
  near: 0.1,
  far: 100,
  defaultPosition: [0, 0, 3], // [x, y, z] — where the camera starts

  // --- Orbit Controls ---
  // OrbitControls = Three.js camera controller. Like Unity's Cinemachine
  // FreeLook but for mouse/touch: drag to orbit, scroll to zoom.
  orbit: {
    enableDamping: true,     // Smooth deceleration after releasing drag
    dampingFactor: 0.08,     // Lower = more inertia (0-1)
    enablePan: false,        // Disable right-click pan — orbit only
    minDistance: 1,          // Closest zoom
    maxDistance: 8,          // Farthest zoom
    autoRotate: false,
    autoRotateSpeed: 0.5,    // Degrees per second (if autoRotate enabled)
  },

  // --- Quality Tiers ---
  // maxSh = max spherical harmonics degree for splat rendering.
  // SH3 = full directional color (view-dependent lighting).
  // SH0 = single color per splat (flat shading, much cheaper).
  // Like switching between PBR and unlit shaders in a game.
  tiers: {
    high: {
      maxSh: 3,
      pixelRatio: Math.min(window.devicePixelRatio, 2),
    },
    mid: {
      maxSh: 1,           // Basic directional color, cheaper than SH3
      pixelRatio: 1,      // 1x — saves fill rate
    },
    low: {
      maxSh: 0,           // Flat color — big perf win on phones
      pixelRatio: 1,
    },
  },
});

/**
 * Returns the active quality tier based on device capability.
 * Call this at viewer creation time (not cached — respects resize).
 */
export function getQualityTier() {
  return SPLAT_CONFIG.tiers[deviceTier] || SPLAT_CONFIG.tiers.mid;
}
