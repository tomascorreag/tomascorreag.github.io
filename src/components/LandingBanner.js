/**
 * LandingBanner: The Memory of the Land's banner, a live scaled-down mock of
 * the MapColombia landing page (tomascorreag.github.io/MapColombia/).
 *
 * This module is the cheap, synchronous half: it returns the empty slot element
 * at once (the landing's ink background), and loads the scene
 * (landingBannerScene.js + the vendored canvas effects) as a separate chunk
 * only when the banner is near the viewport. The scene then fades in. The
 * still thumbnail only appears if the chunk fails to load. Low-tier devices
 * (all phones) get the lite scene.
 */

import { createMediaElement } from '../utils/media.js';
import { deviceTier } from '../config/device.js';
import './landing-banner.css';

/** Reference frame the mock is laid out in: the landing at a 1500×750 viewport. */
export const LANDING_VIEW = [1500, 750];

/**
 * @param {object} opts
 *   still      thumbnail path (the item's `src`), shown only if the scene's chunk fails to load
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

  // No still while the scene loads: the slot shows its plain ink background
  // and the scene fades in over it. The still (a shot of the real landing at
  // another viewport size) laid out differently from the mock, so the
  // cross-fade visibly jumped. It is only the fallback if the chunk fails.
  const showStill = () => {
    const stillEl = still && createMediaElement(still, { alt: '', lazy, sizes, className: 'lb-still' });
    if (stillEl) root.prepend(stillEl);
  };

  // Low tier (every phone, weak desktops) gets lite, like ParallaxBanner.
  const liteMode = lite || deviceTier === 'low';
  const load = () => {
    import('./landingBannerScene.js')
      .then((m) => m.mountLandingScene(root, { lite: liteMode, managed }))
      .catch(showStill);
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
