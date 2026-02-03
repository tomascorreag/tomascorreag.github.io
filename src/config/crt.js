/**
 * CRT Post-Processing Configuration
 *
 * Central config for all CRT visual effects: scanlines, glow, RGB split,
 * vignette, and flicker. CSS-first approach with optional WebGL later.
 *
 * Similar pattern to animations.js - values injected as CSS custom properties.
 */

export const CRT_CONFIG = {
  // Scanlines
  scanlineOpacity: 0.5,      // Base visibility (0-1)
  scanlineSpacing: 2,         // px gap between dark lines
  scanlineSize: 2,            // px thickness of dark lines

  // Glow (layered text-shadow)
  glowSpread: 1,              // Multiplier for glow blur radius
  glowIntensity: 1,           // Multiplier for glow opacity (0-1)
  glowColor: 'var(--terminal-green)',

  // Blur - softens pixel-perfect edges for CRT phosphor feel
  blur: 1.5,                 // px blur on sprites/images

  // RGB Split / Chromatic Aberration
  rgbOffset: 2,               // px offset for R/B channels
  rgbIntensity: 0.75,          // Opacity of offset shadows (0-1)

  // Vignette
  vignetteIntensity: 0.3,     // Darkness at edges (0-1)
  vignetteSize: 40,           // % from center where vignette starts

  // Flicker - base CSS animation
  flickerIntensity: 0.01,     // Opacity variation amount (0-1)
  flickerSpeed: 0.08,         // Seconds per flicker cycle

  // Flicker - JS-driven random spikes
  flickerSpikeChance: 0.1,  // Probability per frame (~60fps) of spike
  flickerSpikeIntensity: 1,// Opacity drop during spike (0-1)
  flickerSpikeDuration: 50000,   // Base ms duration of spike (+ random 0-100ms)

  // Mobile - reduce/disable heavy effects
  mobile: {
    enabled: true,            // Master toggle for mobile
    scanlineOpacity: 0.04,    // Lighter scanlines
    rgbOffset: 0,             // Disable RGB split
    flickerIntensity: 0,      // Disable flicker
    vignetteIntensity: 0.2,   // Lighter vignette
    blur: 0,                  // Disable blur on mobile
  },
};

/**
 * Detects if device is mobile/tablet
 * Uses viewport width + touch detection heuristic
 */
export function isMobile() {
  return window.innerWidth <= 768 ||
    ('ontouchstart' in window && window.innerWidth <= 1024);
}

/**
 * Gets active config values based on device
 */
export function getActiveConfig() {
  if (isMobile() && CRT_CONFIG.mobile.enabled) {
    return {
      ...CRT_CONFIG,
      scanlineOpacity: CRT_CONFIG.mobile.scanlineOpacity,
      rgbOffset: CRT_CONFIG.mobile.rgbOffset,
      flickerIntensity: CRT_CONFIG.mobile.flickerIntensity,
      vignetteIntensity: CRT_CONFIG.mobile.vignetteIntensity,
      blur: CRT_CONFIG.mobile.blur,
    };
  }
  return CRT_CONFIG;
}

/**
 * Injects CRT config as CSS custom properties
 * Call on page load, after animations.js injection
 */
export function injectCRTVariables() {
  const root = document.documentElement;
  const config = getActiveConfig();

  // Scanlines
  root.style.setProperty('--scanline-opacity', config.scanlineOpacity);
  root.style.setProperty('--scanline-spacing', `${config.scanlineSpacing}px`);
  root.style.setProperty('--scanline-size', `${config.scanlineSize}px`);

  // Glow
  root.style.setProperty('--crt-glow-spread', config.glowSpread);
  root.style.setProperty('--crt-glow-intensity', config.glowIntensity);

  // Blur
  root.style.setProperty('--crt-blur', `${config.blur}px`);

  // RGB Split
  root.style.setProperty('--rgb-offset', `${config.rgbOffset}px`);
  root.style.setProperty('--rgb-intensity', config.rgbIntensity);

  // Vignette
  root.style.setProperty('--vignette-intensity', config.vignetteIntensity);
  root.style.setProperty('--vignette-size', `${config.vignetteSize}%`);

  // Flicker
  root.style.setProperty('--flicker-intensity', config.flickerIntensity);
  root.style.setProperty('--flicker-speed', `${config.flickerSpeed}s`);
}

/**
 * Starts the flicker spike system
 * Runs a subtle random flicker on the CRT screen
 */
let flickerInterval = null;

export function startFlicker(screenElement) {
  if (!screenElement || flickerInterval) return;

  const config = getActiveConfig();
  if (config.flickerIntensity === 0) return;

  flickerInterval = setInterval(() => {
    // Random chance of spike
    if (Math.random() < config.flickerSpikeChance) {
      // Dramatic spike
      screenElement.style.opacity = 1 - config.flickerSpikeIntensity;
      setTimeout(() => {
        screenElement.style.opacity = '';
      }, config.flickerSpikeDuration + Math.random() * 100);
    }
  }, 16); // ~60fps check

  return flickerInterval;
}

export function stopFlicker() {
  if (flickerInterval) {
    clearInterval(flickerInterval);
    flickerInterval = null;
  }
}
