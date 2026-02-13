/**
 * Content Configuration — Single source of truth for all portfolio categories
 *
 * Each category maps to an array of thumbnail objects:
 *   - src: key into the thumbnailModules map (relative path from assets/thumbnails/)
 *   - alt: accessible description
 *   - cols: how many grid columns this item spans (1 or 2)
 *   - rows: how many grid rows this item spans (1 or 2)
 *
 * cols/rows create the irregular mosaic — some items are 2x2, 1x2, 2x1, etc.
 * CSS Grid's `grid-auto-flow: dense` packs them tightly to fill gaps.
 */

/**
 * import.meta.glob — Vite's way of importing many files at once.
 *
 * At build time, Vite scans the glob pattern and generates an object like:
 *   { './3d-art/0169.png': '/assets/0169-abc123.png', ... }
 *
 * The `eager: true` option means all imports resolve immediately (no async).
 * The `as: 'url'` option returns just the resolved URL string (not the module).
 *
 * This is how we avoid the "dynamic string path" trap — every image goes through
 * Vite's asset pipeline and gets hashed URLs that work in production.
 *
 * Think of it like Unity's Resources.LoadAll<Texture2D>("thumbnails/") —
 * it pre-discovers all matching assets at compile time.
 */
const thumbnailModules = import.meta.glob(
  '../assets/thumbnails/**/*.{jpg,jpeg,png,webp,mp4}',
  { eager: true, import: 'default' }
);

/**
 * Resolves a relative thumbnail path (like '3d-art/0169.png') to a Vite-processed URL.
 * Returns the hashed URL for production or the dev server URL in development.
 */
export function resolveThumbnail(relativePath) {
  // The glob keys are relative to THIS file, so they start with '../assets/thumbnails/'
  const key = `../assets/thumbnails/${relativePath}`;
  const resolved = thumbnailModules[key];
  if (!resolved) {
    console.warn(`Thumbnail not found: ${relativePath}`);
    return '';
  }
  return resolved;
}

export const CATEGORIES = {
  'General': [
    // Empty until you add images to src/assets/thumbnails/general/
  ],
  '3D Assets': [
    // Empty until you add images to src/assets/thumbnails/3d-assets/
  ],
  '3D Art': [
    { src: '3d-art/thumb1.mp4', alt: '3D Art piece', cols: 4, rows: 2 },
    { src: '3d-art/thumb2.png', alt: '3D Art piece', cols: 2, rows: 2 },
    { src: '3d-art/thumb3.jpeg', alt: '3D Art piece', cols: 2, rows: 4 },
  ],
};
