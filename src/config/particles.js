/**
 * Particle Morph Configuration
 *
 * Controls the cursor → rabbit dissolution effect.
 * Follows the same centralized config pattern as animations.js and crt.js.
 *
 * The morph has 4 phases:
 *   1. Dissolve  — cursor shatters into particles
 *   2. Drift     — particles float with turbulence
 *   3. Converge  — spring attraction pulls particles to target shape
 *   4. Settle    — high damping kills remaining motion
 *
 * After settle, a brief handoff fades the canvas out while the DOM element
 * is revealed underneath, then the canvas is removed.
 */

export const PARTICLE_CONFIG = Object.freeze({
  // Sampling — how the target image is divided into particles
  cellSize: 1,              // NxN source pixels per particle
  displayScale: 4,          // matches RABBIT_CONFIG.scale
  frameWidth: 32,           // px — single frame width in spritesheet (matches RABBIT_CONFIG.width)
  frameHeight: 64,          // px — single frame height in spritesheet (matches RABBIT_CONFIG.height)

  // Physics — spring-damper system
  stiffnessStart: 0.001,     // initial spring constant toward target
  stiffnessEnd: 0.11,       // ramps up during convergence
  damping: 0.7,            // velocity decay per frame (1 = no decay)

  // Turbulence — layered sine waves for organic drift
  noiseAmplitude: 2,      // max displacement per frame (screen px)
  noiseFrequency: 0.005,    // spatial frequency of noise
  noiseSpeed: 2.0,          // temporal speed of noise evolution

  // Phase durations (ms)
  dissolveDuration: 300,    // cursor fracture
  driftDuration: 150,       // free-floating turbulence
  convergeDuration: 100,   // spring attraction ramp
  settleDuration: 50,      // final damping

  // Handoff — canvas → DOM transition
  handoffDuration: 150,     // canvas opacity fade (ms)

  // Stagger — per-particle random start delay
  maxSpawnDelay: 300,       // max ms before a particle begins moving

  // Color (default — overridable per-morph call)
  color: { r: 242, g: 255, b: 242 },  // rgb(242, 255, 242) terminal green

  // Device tier overrides (merged on top of defaults)
  // low = skip particle morph entirely (same as old mobile behavior)
  // mid = larger particles → fewer pixels to process, still looks good
  tiers: {
    low: { enabled: false },
    mid: { cellSize: 2 },   // 2x2 source pixels per particle → 1/4 the particle count
  },
});
