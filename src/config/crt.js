/**
 * CRT Post-Processing Configuration
 *
 * Central config for all CRT visual effects: scanlines, glow, RGB split,
 * vignette, and glow noise. CSS-first approach with optional WebGL later.
 *
 * Similar pattern to animations.js - values injected as CSS custom properties.
 */

import { getDeviceTier, isMobileDevice } from './device.js';

export const CRT_CONFIG = Object.freeze({
  // Scanlines
  scanlineOpacity: 0.25,      // Base visibility (0-1)
  scanlineSpacing: 2,         // px gap between dark lines
  scanlineSize: 2,            // px thickness of dark lines

  // Glow (layered text-shadow)
  glowSpread: 1,              // Multiplier for glow blur radius
  glowIntensity: 1,           // Multiplier for glow opacity (0-1)

  // Glow noise — mostly static, occasional random drops
  glowNoiseMin: 0.75,          // Lowest a drop can go
  glowNoiseFrequency: 32,     // Tick rate (Hz) — controls recovery speed
  glowNoiseDropChance: 0.04,  // Probability per tick of triggering a drop
  glowNoiseRecovery: 0.5,     // Lerp factor back to baseline (0-1, higher = faster)

  // Blur - softens pixel-perfect edges for CRT phosphor feel
  blur: 1.5,                 // px blur on sprites/images

  // RGB Split / Chromatic Aberration
  rgbOffset: 2,               // px offset for R/B channels
  rgbIntensity: 0.75,          // Opacity of offset shadows (0-1)

  // Vignette
  vignetteIntensity: 0.3,     // Darkness at edges (0-1)
  vignetteSize: 40,           // % from center where vignette starts

  // Device tier overrides — merged on top of defaults
  tiers: {
    low: {
      scanlineOpacity: 0.04,    // Lighter scanlines
      rgbOffset: 0,             // Disable RGB split
      vignetteIntensity: 0.2,   // Lighter vignette
      blur: 0,                  // Disable blur
    },
    // mid and high: use defaults (no overrides needed)
  },
});

/**
 * Detects if device is mobile/tablet.
 * Kept for any remaining viewport-specific checks (layout, not quality).
 * Re-exported from device.js to avoid duplicate logic.
 */
export { isMobileDevice as isMobile };

/**
 * Gets active config values based on device tier.
 * Merges tier-specific overrides on top of the base config.
 */
export function getActiveConfig() {
  const tier = getDeviceTier();
  const overrides = CRT_CONFIG.tiers?.[tier];
  if (overrides) return { ...CRT_CONFIG, ...overrides };
  return CRT_CONFIG;
}

/**
 * Injects CRT config as CSS custom properties and listens for
 * viewport changes that cross a tier boundary.
 *
 * Without the resize listener, rotating a tablet or resizing the
 * browser would lock the user into the wrong CRT settings — like
 * a quality setting that only applies on launch, not at runtime.
 */
let lastTier = null;

export function injectCRTVariables() {
  const currentTier = getDeviceTier();

  // Set up resize listener on first call.
  // Debounced — getDeviceTier() calls isMobileDevice() which reads window.innerWidth,
  // and a tier change is only meaningful after the resize settles.
  if (lastTier === null) {
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const nowTier = getDeviceTier();
        if (nowTier !== lastTier) {
          lastTier = nowTier;
          injectCRTVariables();
        }
      }, 150);
    });
  }
  lastTier = currentTier;
  const root = document.documentElement;
  const config = getActiveConfig();

  // Scanlines
  root.style.setProperty('--scanline-opacity', config.scanlineOpacity);
  root.style.setProperty('--scanline-spacing', `${config.scanlineSpacing}px`);
  root.style.setProperty('--scanline-size', `${config.scanlineSize}px`);

  // Glow
  root.style.setProperty('--crt-glow-spread', config.glowSpread);
  root.style.setProperty('--crt-glow-intensity', config.glowIntensity);
  // Static copy for brightness filters — immune to glow noise
  root.style.setProperty('--crt-glow-brightness', config.glowIntensity);

  // Blur
  root.style.setProperty('--crt-blur', `${config.blur}px`);

  // RGB Split
  root.style.setProperty('--rgb-offset', `${config.rgbOffset}px`);
  root.style.setProperty('--rgb-intensity', config.rgbIntensity);

  // Vignette
  root.style.setProperty('--vignette-intensity', config.vignetteIntensity);
  root.style.setProperty('--vignette-size', `${config.vignetteSize}%`);

}

/**
 * Glow noise — mostly holds at baseline, occasionally drops then recovers.
 *
 * Like a fluorescent tube that's mostly stable but occasionally dips —
 * each tick has a small chance of triggering a drop to a random value
 * between min and baseline, then lerps back up. Same pattern as a
 * damage flash that decays back to 1.0 in a game shader.
 */
let glowNoiseInterval = null;

export function startGlowNoise() {
  if (glowNoiseInterval) return;

  const config = getActiveConfig();
  const { glowNoiseMin: min, glowNoiseFrequency: freq,
    glowNoiseDropChance: chance, glowNoiseRecovery: recovery } = config;
  const baseline = config.glowIntensity;
  if (!freq) return;

  const root = document.documentElement;
  let current = baseline;

  glowNoiseInterval = setInterval(() => {
    if (Math.random() < chance) {
      // Drop to a random depth between min and baseline
      current = min + Math.random() * (baseline - min);
    } else {
      // Recover toward baseline
      current += (baseline - current) * recovery;
    }
    root.style.setProperty('--crt-glow-intensity', current.toFixed(3));
  }, 1000 / freq);
}

export function stopGlowNoise() {
  if (glowNoiseInterval) {
    clearInterval(glowNoiseInterval);
    glowNoiseInterval = null;
  }
}
