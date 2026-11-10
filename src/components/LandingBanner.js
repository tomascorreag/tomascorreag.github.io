/**
 * LandingBanner: The Memory of the Land's banner, a live scaled-down mock of
 * the MapColombia landing page (tomascorreag.github.io/MapColombia/).
 *
 * This module is the cheap, synchronous half: it returns the slot element at
 * once with the still thumbnail inside, and loads the scene
 * (landingBannerScene.js + the vendored canvas effects) as a separate chunk
 * only when the banner is near the viewport. The scene then fades in over the
 * still. Reduced motion keeps the still and never loads it; low-tier devices
 * (all phones) get the lite scene.
 */

import { createMediaElement } from '../utils/media.js';
import { deviceTier, prefersReducedMotion } from '../config/device.js';
import './landing-banner.css';

/** Reference frame the mock is laid out in: the landing at a 1500×750 viewport. */
export const LANDING_VIEW = [1500, 750];

/**
 * @param {object} opts
 *   still      thumbnail path (the item's `src`), shown until the scene is live
 *   className  slot class (.game-banner, .article-banner, ...)
 *   alt        accessible label
 *   sizes      `sizes` for the still
 *   lazy       lazy-load the still and defer the scene until near the viewport
 *   managed    register the scene's animations with the offscreen manager
 *              (false when the portfolio deck plays/pauses them itself)
 *   lite       small slots: every field at half resolution, 30 fps, the two
 *              flanks rendering on alternate frames (forced on for low-tier
 *              devices)
 */
export function createLandingBanner(opts = {}) {
  const { still, className = '', alt = '', sizes = '100vw', lazy = true, managed = true, lite = false } = opts;
  const root = document.createElement('div');
  root.className = `landing-banner${className ? ` ${className}` : ''}`;
  root.setAttribute('role', 'img');
  if (alt) root.setAttribute('aria-label', alt);
  root.style.aspectRatio = `${LANDING_VIEW[0]} / ${LANDING_VIEW[1]}`;

  const stillEl = still && createMediaElement(still, { alt: '', lazy, sizes, className: 'lb-still' });
  if (stillEl) root.appendChild(stillEl);

  if (prefersReducedMotion()) return root;

  // Low tier (every phone, weak desktops) gets lite, like ParallaxBanner.
  const liteMode = lite || deviceTier === 'low';
  const load = () => {
    import('./landingBannerScene.js')
      .then((m) => m.mountLandingScene(root, { lite: liteMode, managed }))
      .catch(() => { /* chunk failed to load: the still stays */ });
  };
  if (!lazy) {
    load();
  } else {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        load();
      }
    }, { rootMargin: '300px' });
    io.observe(root);
  }
  return root;
}
