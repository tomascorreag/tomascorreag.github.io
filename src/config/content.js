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
 *   - detailLayout: (optional) override auto AR-based layout in detail view
 *       'info-left'  — image right, info panel left
 *       'info-right' — image left, info panel right
 *       'info-below' — image top, info panel below
 *       omit for auto (determined by aspect ratio)
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
  '../assets/thumbnails/**/*.{jpg,jpeg,png,webp,mp4,webm}',
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
        'I solve visual problems at the boundary between art and code, '+
        "building shaders, VFX, tools, and pipelines that make artists' "+
        'lives easier and games look and feel better. I develop systems for gameplay and player-machine interfaces, '+
        "and I'm increasingly asking what those systems do beyond the "+
        'screen: how games shape collective memory, social identities, and civic life.',
    // 'I solve visual problems at the boundary between art and code. ' +
    // 'I build shaders, VFX, tools, and pipelines that help artists work faster ' +
    // 'and games look better — always thinking in systems, always grounded in ' +
    // "real production needs, and always focused on the player's experience.",
  skills: [
    { label: 'Shaders & VFX', detail: 'Real-time shaders, particle systems, post-processing' },
    { label: '3D Art & Materials', detail: 'Modeling, texturing, procedural workflows in Blender', thumbnails: [
      { category: '3D Art', itemIndex: 1 },
      { category: '3D Art', itemIndex: 2 },
    ] },
    { label: 'Tools & Pipelines', detail: 'Custom editor tools, asset pipelines, workflow automation' },
    { label: 'Game Development', detail: 'ARBO: Arena Tactics (Steam, closed alpha) — Technical Artist & lead developer' },
  ],
  tools: ['Unity', 'Blender', 'C#', 'Python', 'HLSL/GLSL', 'SQL'],
  contacts: [
    { platform: 'linkedin', url: 'https://www.linkedin.com/in/tomás-correa-551b0a243', label: 'LinkedIn' },
    { platform: 'github',   url: 'https://github.com/tomascorreag', label: 'GitHub' },
    { platform: 'discord',  copyText: 'eltomoco', label: 'Discord' },
    { platform: 'email',    copyText: 'tomcorrea3+3@gmail.com', label: 'Email' },
  ],
  cta: 'Scroll the other sections to see the work.',
};

/**
 * Games section — each entry is a shipped game with a banner, description, and links.
 *   - src: thumbnail path (relative to assets/thumbnails/) — should be 2:1 aspect ratio
 *   - title: game name
 *   - description: short blurb
 *   - links: array of { label, url } shown as buttons below the description
 */
export const GAMES = [
  {
    src: 'games/arboThumb.png',       // place a 2:1 banner in src/assets/thumbnails/games/
    title: 'ARBO: Arena Tactics',
    description: 'A turn-based arena tactics game with roguelike progression. I served as Technical Artist and lead developer — responsible for shaders, VFX, art pipelines, and core gameplay systems. ARBO: Arena Tactics is currently listed on Steam in closed alpha. ',
    links: [
      { label: 'Steam',   icon: 'steam',   url: 'https://store.steampowered.com/app/2914810/ARBO_Arena_Tactics/' }, // TODO: replace with real URL
      { label: 'Website', icon: 'website', url: 'https://arbo.xyz/' }, // TODO: replace with real URL
    ],
  },
  {
    src: 'games/matrixThumb.png',     // place a 2:1 banner in src/assets/thumbnails/games/
    title: 'The Matrix',
    description: 'A pixel-art Metroidvania vertical slice set in the Matrix universe. Explore a hand-crafted slice of a glitching digital city, uncovering hidden paths and abilities. Built in Unity.',
    links: [
      { label: 'Play', icon: 'website', url: 'https://tomascorreag.github.io/the-matrix-vertical-slice/' }, // TODO: replace with itch.io or hosted WebGL URL
    ],
  },
];

export const CATEGORIES = {
  'General': [
    // Empty until you add images to src/assets/thumbnails/general/
  ],
  '3D Tech': [
    // Splat items use type: 'splat' to trigger the 3D viewer in detail view.
    // The thumbnail shows a static render; clicking opens the interactive viewer.
    // splat.file → filename in src/assets/splats/, resolved via resolveSplat().
    // splat.camera → optional [x,y,z] camera position override for this piece.

    // Add entries here as you export splats from Blender:
    // { src: '3d-assets/crystal.png', alt: 'Crystal material', cols: 2, rows: 2,
    //   title: 'Crystal', description: '...', type: 'splat',
    //   splat: { file: 'crystal.spz' } },
    { src: '3d-assets/fabricThumb.png', alt: '3D asset', cols: 4, rows: 2, title: 'Procedural Fabric Material', description: 'Procedural fabric material pack. Multiple weave patterns — basket, plaid, knit, chenille — driven by a single node group with exposed parameters.' },
    { src: '3d-assets/iceThumb.png', alt: '3D asset', cols: 4, rows: 2, title: 'Procedural Ice & Glass', description: 'Subsurface scattering study using ice and whiskey glass. Focus on light transmission, caustics, and volumetric absorption.' },
    { src: '3d-assets/toonThumb.webm', alt: '3D asset', cols: 4, rows: 2, title: 'NPR Toon Shader', description: 'Non-photorealistic render shader replicating a hand-drawn ink look entirely within Blender. Rendered in Blender EEVEE' },
    { src: '3d-assets/eyeThumb.png', alt: '3D asset', cols: 2, rows: 2, title: 'Procedural Eyes Asset, rigged', description: 'Anatomically detailed procedural eye. Iris pattern, sclera veins, and cornea wetness all generated without textures.',
      // gallery: ['3d-assets/eyeThumb.png'],  // Add extra view images here when ready
    },
    { src: '3d-assets/fleshThumb.png', alt: '3D asset', cols: 4, rows: 2, title: 'Procedural Raw Flesh Material', description: 'Procedural organic flesh material with colour variant controls. Used in the Ardo sculpt.' },
    { src: '3d-assets/paintThumb.png', alt: '3D asset', cols: 4, rows: 2, title: 'Oil Paint Shader', description: 'Procedural oil paint shader applied to a canvas scene. Brush stroke texture and impasto thickness driven by input image data.' },
    { src: '3d-assets/benchThumb.jpg', alt: '3D asset', cols: 2, rows: 1, title: 'Park Bench', description: 'Photorealistic park bench with wrought iron and wood slats, inspired by New Orleans benches. Study in material layering.' },
  ],
  '3D Art': [
    { src: '3d-art/thumb1.mp4', alt: 'Art piece', cols: 4, rows: 2, title: 'ALternate Realities Challenge', description: 'Inspired by the 2021 challenge from Pwnisher. Study in lighting, animation and simulation. Scene fully created and rendered in Blender Cycles, composited in DaVinci Resolve.'},
    { src: '3d-art/thumb2.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Ardo.', description: 'A study in organic sculpting and material design. Uses procedural flesh and skin assets shown in 3D asset section.' },
    { src: '3d-art/thumb3.jpeg', alt: 'Art piece', cols: 2, rows: 4, title: 'Menpō (面頬)', description: 'Study in hard-surface sculpting and composition.' },
    { src: '3d-art/ciudadFaroThumb.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Ciudad Faro', description: 'Inspired by Burning Caravan\'s Album Cover by the same name. Surrealist scene featuring a lighthouse surrounded by levitating whales.' },
    { src: '3d-art/marsThumb.png', alt: 'Art piece', cols: 4, rows: 2, title: 'Brain Farm', description: 'Surrealist Mars landscape. Stylized composite rendered in Blender Cycles. Part of an exploration on surrealist brain-themed scifi, including Brain-Cities.',
      gallery: ['3d-art/brainCityThumb.png'],
      detailLayout: 'below-split',
    },
    { src: '3d-art/ascensionThumb.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Ascension V', description: 'Inspired by Mobius\' piece "Ascension". Abstract study in volumetric lighting and particle simulation. Rendered in Blender Cycles.' },
    { src: '3d-art/donutThumb.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Donut', description: 'The one that started it all, my first 3D piece. Classic Blender Guru tutorial.' },
    { src: '3d-art/bioshockThumb.webm', alt: 'Art piece', cols: 2, rows: 2, title: 'Bioshock Hallway', description: 'A hallway from the classic Bioshock game, study in modeling, materials, and composition.' },
    { src: '3d-art/starWarsChaseThumb.webm', alt: 'Art piece', cols: 2, rows: 2, title: 'Rebel Chase', description: 'A bit of Star Wars inspired fan art, an X-wing chasing down a TIE-fighter. Made entirely in Blender, a study in lighting, animation and VFX.' },
  ],
};
