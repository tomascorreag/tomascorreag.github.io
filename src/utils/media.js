import { variantsFor } from '../config/content.js';

/**
 * Builds a <picture> (images) or <video> (videos) element with the full
 * fallback chain wired up — browsers pick the best format they can decode.
 *
 * Why <picture>: the modern sources (AVIF, WebP) are listed first as <source>
 * elements; the universal <img src="...png"> lives inside as the last resort.
 * Browsers that can't decode any <source> fall back to <img>, and every CSS
 * selector written against `img` keeps matching (the <img> is still in the DOM).
 *
 * Why no src on <video>: when multiple <source> children are present, the
 * browser walks them in order and picks the first it can play. Setting
 * `src` too would short-circuit that selection.
 *
 * Returns null when the path isn't in the asset glob (mirrors the
 * `if (url)` guards that existed before this helper was introduced).
 */
export function createMediaElement(relativePath, opts = {}) {
  const {
    alt = '',
    className = '',
    lazy = true,
    video: videoOpts = {},
  } = opts;

  const variants = variantsFor(relativePath);
  if (!variants) return null;

  if (variants.kind === 'image') {
    const picture = document.createElement('picture');
    for (const src of variants.sources) {
      const source = document.createElement('source');
      source.type = src.type;
      source.srcset = src.url;
      picture.appendChild(source);
    }
    const img = document.createElement('img');
    img.src = variants.fallback.url;
    img.alt = alt;
    if (className) img.className = className;
    if (lazy) {
      img.loading = 'lazy';
      img.decoding = 'async';
    }
    picture.appendChild(img);
    return picture;
  }

  // variants.kind === 'video'
  const {
    autoplay = true,
    loop = true,
    muted = true,
    playsInline = true,
    preload = 'metadata',
  } = videoOpts;

  const video = document.createElement('video');
  if (className) video.className = className;
  // Muted must be set before autoplay to satisfy browser autoplay policies.
  video.muted = muted;
  video.autoplay = autoplay;
  video.loop = loop;
  video.playsInline = playsInline;
  video.preload = preload;
  for (const src of variants.sources) {
    const source = document.createElement('source');
    source.type = src.type;
    source.src = src.url;
    video.appendChild(source);
  }
  return video;
}
