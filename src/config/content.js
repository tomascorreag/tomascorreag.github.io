/**
 * Content Configuration — Single source of truth for all portfolio categories
 *
 * Each category maps to an array of thumbnail objects:
 *   - src: key into the thumbnailModules map (relative path from assets/thumbnails/)
 *   - alt: accessible description
 *   - cols: how many grid columns this item spans (1 or 2)
 *   - rows: how many grid rows this item spans (1 or 2)
 *   - title: (optional) display name shown in detail view
 *   - description: (optional) text shown below image in detail view
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
 * Splat asset glob — same pattern as thumbnails but for .spz files.
 *
 * `as: 'url'` tells Vite "give me the resolved URL, don't import the file contents."
 * At build time this becomes a map like:
 *   { '../assets/splats/crystal.spz': '/assets/crystal-abc123.spz' }
 *
 * The .spz file itself is NOT downloaded at page load — it's just a URL string.
 * The actual fetch happens when SplatViewer mounts and requests it.
 */
const splatModules = import.meta.glob(
  '../assets/splats/**/*.spz',
  { eager: true, query: '?url', import: 'default' }
);

/**
 * Resolves a splat filename (like 'crystal.spz') to a Vite-processed URL.
 * Parallel to resolveThumbnail() — same glob-based pattern.
 */
export function resolveSplat(filename) {
  const key = `../assets/splats/${filename}`;
  const resolved = splatModules[key];
  if (!resolved) {
    console.warn(`Splat not found: ${filename}`);
    return '';
  }
  return resolved;
}

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

/**
 * General section content — text-based "CV" instead of a thumbnail mosaic.
 * Structured as data so the rendering logic stays in main.js.
 */
export const GENERAL_CONTENT = {
  name: 'Tomás Correa',
  title: 'Technical Artist',
  subtitle: 'Game Developer · Creative Engineer',
  summary:
    'I solve visual problems at the boundary between art and code. ' +
    'I build shaders, VFX, tools, and pipelines that help artists work faster ' +
    'and games look better — always thinking in systems, always grounded in ' +
    "real production needs, and always focused on the player's experience.",
  skills: [
    { label: 'Shaders & VFX', detail: 'Real-time shaders, particle systems, post-processing' },
    { label: '3D Art & Materials', detail: 'Modeling, texturing, procedural workflows in Blender', thumbnails: [
      { category: '3D Art', itemIndex: 1 },
      { category: '3D Art', itemIndex: 2 },
    ] },
    { label: 'Tools & Pipelines', detail: 'Custom editor tools, asset pipelines, workflow automation' },
    { label: 'Game Development', detail: 'Shipped ARBO: Arena Tactics on Steam — end-to-end' },
  ],
  tools: ['Unity', 'Blender', 'HLSL/GLSL', 'C#', 'Python'],
  contacts: [
    { platform: 'linkedin', url: 'https://www.linkedin.com/in/tomás-correa-551b0a243', label: 'LinkedIn' },
    { platform: 'github',   url: 'https://github.com/tomascorreag', label: 'GitHub' },
    { platform: 'discord',  copyText: 'eltomoco', label: 'Discord' },
    { platform: 'email',    copyText: 'tomcorrea3+3@gmail.com', label: 'Email' },
  ],
  cta: 'Scroll the other sections to see the work.',
};

export const CATEGORIES = {
  'General': [
    // Empty until you add images to src/assets/thumbnails/general/
  ],
  '3D Assets': [
    // Splat items use type: 'splat' to trigger the 3D viewer in detail view.
    // The thumbnail shows a static render; clicking opens the interactive viewer.
    // splat.file → filename in src/assets/splats/, resolved via resolveSplat().
    // splat.camera → optional [x,y,z] camera position override for this piece.

    // Add entries here as you export splats from Blender:
    // { src: '3d-assets/crystal.png', alt: 'Crystal material', cols: 2, rows: 2,
    //   title: 'Crystal', description: '...', type: 'splat',
    //   splat: { file: 'crystal.spz' } },
  ],
  '3D Art': [
    { src: '3d-art/thumb1.mp4', alt: '3D Art piece', cols: 4, rows: 2, title: 'Animated Scene', description: 'Looping animation rendered in Blender Cycles.' },
    { src: '3d-art/thumb2.png', alt: '3D Art piece', cols: 2, rows: 2, title: 'Crystal Material', description: 'Procedural crystal material built in Blender.' },
    { src: '3d-art/thumb3.jpeg', alt: '3D Art piece', cols: 2, rows: 4, title: 'Environment Study', description: 'Stylized environment concept.' },
  ],
};
