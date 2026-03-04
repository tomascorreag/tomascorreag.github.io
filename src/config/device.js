/**
 * Device Capability Detection & Quality Tiers
 *
 * Combines multiple browser APIs to estimate device performance and
 * assign a quality tier (low / mid / high). Think of it like auto-detect
 * graphics settings in a game — sniff hardware signals, pick a preset.
 *
 * Available signals (not all work in every browser):
 *   - navigator.hardwareConcurrency  → CPU core count (all browsers)
 *   - navigator.deviceMemory         → RAM in GB (Chrome/Edge only)
 *   - navigator.connection            → network info (Chrome/Edge only)
 *   - WebGL GPU string               → actual GPU name
 *   - window.devicePixelRatio        → screen density
 *   - screen dimensions              → total pixel count
 *
 * Missing values get safe mid-range defaults so the tier never crashes.
 *
 * Usage:
 *   import { getDeviceTier, deviceTier } from './device.js';
 *   if (deviceTier === 'low') { /* skip heavy effects * / }
 */

// --- Raw capability getters ---

/** CPU logical core count. 2 = budget phone, 8+ = modern desktop. */
export function getCoreCount() {
  return navigator.hardwareConcurrency || 4;
}

/** Device RAM in GB. Chrome/Edge only — returns null elsewhere. */
export function getDeviceMemory() {
  return navigator.deviceMemory ?? null;
}

/**
 * GPU renderer string via WebGL debug extension.
 * Returns null if unavailable. Useful for logging, not great for tiering
 * (thousands of GPU names, inconsistent across drivers).
 *
 * Result is cached at module load — the GPU never changes at runtime, and
 * creating/destroying a WebGL context is expensive (~10-50ms on some devices).
 */
function _queryGPURenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    // Release the context immediately — browsers cap WebGL contexts per page (~8–16).
    // Holding onto a sniff-only context would waste one slot for the lifetime of the tab.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return null;
  }
}
const _gpuRenderer = _queryGPURenderer();
export function getGPURenderer() { return _gpuRenderer; }

/** Network effective type ('slow-2g', '2g', '3g', '4g'). Chrome/Edge only. */
export function getNetworkType() {
  return navigator.connection?.effectiveType ?? null;
}

/** Whether the user has opted into data saving mode. */
export function getSaveData() {
  return navigator.connection?.saveData ?? false;
}

/** True if viewport + touch signals suggest mobile/tablet. */
export function isMobileDevice() {
  return window.innerWidth <= 768 ||
    ('ontouchstart' in window && window.innerWidth <= 1024);
}

// --- Tier assignment ---

/**
 * Computes a quality tier: 'low' | 'mid' | 'high'.
 *
 * Scoring approach — each signal contributes points, then thresholds decide:
 *   low  = mobile OR severely constrained hardware OR data-saver
 *   high = desktop with 8+ cores and 8+ GB RAM
 *   mid  = everything else
 *
 * Call once at startup; result is cached in `deviceTier`.
 */
export function getDeviceTier() {
  // Data saver = user explicitly wants lightweight — respect that
  if (getSaveData()) return 'low';

  const mobile = isMobileDevice();
  const cores = getCoreCount();
  const mem = getDeviceMemory(); // null on Firefox/Safari

  // Mobile is always low — same behavior as current `isMobile()` checks,
  // but now formalized as a tier
  if (mobile) return 'low';

  // Desktop with strong specs
  if (cores >= 8 && (mem === null || mem >= 8)) return 'high';

  // Weak desktop (2-core laptop, low RAM)
  if (cores <= 2 || (mem !== null && mem <= 2)) return 'low';

  return 'mid';
}

/**
 * Cached tier — computed once on module load.
 * Import this for quick checks: `if (deviceTier === 'low') ...`
 *
 * Debug override: append ?tier=low / ?tier=mid / ?tier=high to the URL.
 */
const _debugTier = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('tier')
  : null;
const _validTiers = ['low', 'mid', 'high'];
export const deviceTier = _validTiers.includes(_debugTier) ? _debugTier : getDeviceTier();

// Log once for debugging (visible in DevTools console)
if (import.meta.env.DEV) {
  const override = _validTiers.includes(_debugTier) ? ` (DEBUG OVERRIDE: ?tier=${_debugTier})` : '';
  console.log(
    `[device] tier: ${deviceTier}${override} | cores: ${getCoreCount()} | ` +
    `mem: ${getDeviceMemory() ?? '?'}GB | gpu: ${getGPURenderer() ?? '?'} | ` +
    `net: ${getNetworkType() ?? '?'} | dpr: ${devicePixelRatio}`
  );
}
