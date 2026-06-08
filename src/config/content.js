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
  '../assets/thumbnails/**/*.{jpg,jpeg,png,webp,avif,mp4,webm}',
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

// Extensions, grouped by media kind. `image` fallback uses the originally
// referenced extension (png/jpg/jpeg) — preserves author intent from content.js.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const MIME_BY_EXT = {
  avif: 'image/avif',
  webp: 'image/webp',
  webm: 'video/webm',
  mp4: 'video/mp4',
};

function tryResolve(basePath, ext) {
  const key = `../assets/thumbnails/${basePath}.${ext}`;
  return thumbnailModules[key] || null;
}

/**
 * Returns all available variants for a thumbnail path, in preference order.
 *
 * For images, `sources` holds the modern formats the browser should try first
 * (avif, webp). `fallback` is the originally referenced file (png/jpg/jpeg) —
 * every browser can decode it, so it's the `<img>` inside `<picture>`.
 *
 * For videos, `sources` holds webm (preferred) then mp4 (universal fallback).
 *
 * Returns null if the path is unknown, so callers can mirror existing
 * `if (url)` guards with `if (element)`.
 */
export function variantsFor(relativePath) {
  const dot = relativePath.lastIndexOf('.');
  if (dot < 0) return null;
  const basePath = relativePath.slice(0, dot);
  const ext = relativePath.slice(dot + 1).toLowerCase();

  if (IMAGE_EXTS.has(ext)) {
    const fallbackUrl = tryResolve(basePath, ext);
    if (!fallbackUrl) {
      console.warn(`Thumbnail not found: ${relativePath}`);
      return null;
    }
    const sources = [];
    for (const modern of ['avif', 'webp']) {
      const url = tryResolve(basePath, modern);
      if (url) sources.push({ type: MIME_BY_EXT[modern], url });
    }
    return { kind: 'image', sources, fallback: { url: fallbackUrl, ext } };
  }

  if (VIDEO_EXTS.has(ext)) {
    const sources = [];
    // Preferred first: webm (smaller), then mp4 (universal).
    for (const vext of ['webm', 'mp4']) {
      const url = tryResolve(basePath, vext);
      if (url) sources.push({ type: MIME_BY_EXT[vext], url });
    }
    if (sources.length === 0) {
      console.warn(`Thumbnail not found: ${relativePath}`);
      return null;
    }
    return { kind: 'video', sources };
  }

  console.warn(`Unsupported thumbnail extension: ${relativePath}`);
  return null;
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
    'I solve visual problems at the boundary between art and code, ' +
    "building shaders, VFX, tools, and pipelines that make artists' " +
    'lives easier and games look and feel better. I develop systems for gameplay and player-machine interfaces, ' +
    "and I'm increasingly asking what those systems do beyond the " +
    'screen: how games shape collective memory, social identities, and civic life.',
  // 'I solve visual problems at the boundary between art and code. ' +
  // 'I build shaders, VFX, tools, and pipelines that help artists work faster ' +
  // 'and games look better — always thinking in systems, always grounded in ' +
  // "real production needs, and always focused on the player's experience.",
  skills: [
    { label: 'Shaders & VFX', detail: 'Real-time shaders, particle systems, post-processing' },
    {
      label: '3D Art & Materials', detail: 'Modeling, texturing, procedural workflows in Blender', thumbnails: [
        { category: '3D Art', itemIndex: 1 },
        { category: '3D Art', itemIndex: 2 },
      ]
    },
    { label: 'Tools & Pipelines', detail: 'Custom editor tools, asset pipelines, workflow automation' },
    { label: 'Game Development', detail: 'ARBO: Arena Tactics (Steam, closed alpha) — Technical Artist & lead developer' },
  ],
  tools: ['Unity', 'Blender', 'C#', 'Python', 'HLSL/GLSL', 'SQL'],
  contacts: [
    { platform: 'linkedin', url: 'https://www.linkedin.com/in/tomás-correa-551b0a243', label: 'LinkedIn' },
    { platform: 'github', url: 'https://github.com/tomascorreag', label: 'GitHub' },
    { platform: 'discord', copyText: 'eltomoco', label: 'Discord' },
    // Split at build time so a naive HTML/source scraper sees two unrelated
    // strings instead of a literal `user@domain`. Stops casual crawlers only;
    // a real harvester can still join the halves. Plus-addressing (+3)
    // doubles as a disposable tag we can retire if spam gets bad.
    { platform: 'email', copyText: ['tomcorrea3+3', 'gmail.com'].join('@'), label: 'Email' },
  ],
  cta: 'Scroll the other sections to see the work.',
};

/**
 * Games section — each entry is a shipped game with a banner, description, and links.
 *   - src: thumbnail path (relative to assets/thumbnails/) — should be 2:1 aspect ratio
 *   - title: game name
 *   - description: short blurb
 *   - links: array of { label, url } shown as buttons below the description
 *   - page: (optional) markdown string for an article page (parsed by utils/markdown.js)
 *
 * Supported markdown syntax:
 *   ## Heading          → <h3> section heading
 *   Paragraph text      → <p> (blank-line separated)
 *   ---                 → <hr> divider
 *   ![alt](src)         → <figure> image/video via createMediaElement
 *   *caption*           → <figcaption> (line after image only)
 *   [Label|icon](url)   → link button (consecutive lines group)
 */
export const GAMES = [
  {
    src: 'games/arboThumb.png',       // place a 2:1 banner in src/assets/thumbnails/games/
    title: 'ARBO: Arena Tactics',
    summary: 'Turn-based tactical combat with deckbuilding, built in Unity. In closed alpha on Steam.',
    description: 'Turn-based tactical combat with a deckbuilding layer, built in Unity. Two players each command a team of heroes on a hex grid, assembling protocol decks to outmaneuver and KO the opposition. I served as Technical Artist and lead developer — owning the real-time visual pipeline and editor tooling, and co-developing core gameplay systems and UI/UX. In closed alpha on Steam.',
    links: [
      { label: 'Steam', icon: 'steam', url: 'https://store.steampowered.com/app/2914810/ARBO_Arena_Tactics/' },
      { label: 'Website', icon: 'website', url: 'https://arbo.xyz/' },
    ],
    page: `
## About the Project

Turn-based tactical combat with a deckbuilding layer, built in Unity. Two players command teams of heroes on hex-grid arenas.

- **4 hero classes**, each with 3 combat themes that guide deckbuilding
- **15-card protocol decks** — energy, MP, and shield as cost pools
- **Hex-grid arenas** with water, ice, magma, tar, and elevation
- **Initiative-based turns** with accuracy-vs-evasion rolls and line-of-sight
- **Deep status-effect layer** — 39 effect types shipped

Game modes: 1v1 multiplayer, ranked ladder, LLM-driven tutorial opponent, and an AI-reasoning-agent mode where natural-language commands drive match play.

---

## My Role

Technical Artist and co-lead developer.

- **Real-time visual pipeline** — custom shaders via Shader Graph + HLSL/GLSL in URP
- **All VFX** — particle systems, VFX Graph, and bespoke implementations
- **Custom Unity editor tools** for myself and the dev team to use
- Co-developed the **hex-grid combat engine**, protocol-deck system, and status-effect framework
- Co-developed **UI/UX** across the stack

---

![ARBO Molecular Punch VFX](Games/ARBO/punch.jpg)
*Molecular Punch on the Abyssal Pit map. Custom VFX, shader, and post-processing work.*

---

## Technical Highlights

- Custom real-time **shader pipeline** in URP (Shader Graph + HLSL/GLSL)
- **VFX** via particle systems, VFX Graph, and custom implementations
- **Editor tooling** enabling designers to author and tune game content without code

![ARBO Incendiary Flames VFX](Games/ARBO/flamethrower.jpg)
*Incendiary Flames. Particle systems and post-processing on display.*

[Steam|steam](https://store.steampowered.com/app/2914810/ARBO_Arena_Tactics/)
[Website|website](https://arbo.xyz/)
`,
  },
  {
    src: 'games/paramoThumb.png',
    title: 'Páramo',
    summary: 'Environmental strategy on a Colombian páramo, built in Godot 4. Work in progress.',
    description: 'An environmental strategy game set on a Colombian **páramo** (a high-altitude Andean ecosystem that supplies water to millions downstream). The player is a field coordinator protecting the mountain from extractive, biological, and climate threats while managing community relationships and scarce resources. Built in Godot 4 with isometric pixel art. Designed as procedural rhetoric: the game\'s systems argue about conservation, not its text. Work in progress.',
    links: [
      { label: 'Play', icon: 'website', url: 'https://tomascorreag.github.io/Paramo/' },
    ],
    page: `
## About the Project

Tower defense meets environmental strategy, built in Godot 4. You are a field coordinato protecting a Colombian páramo — a high-altitude Andean ecosystem that functions as a water factory for millions downstream. A glacial laguna sits at the summit. If it dies, everything below it dies.

Threats climb the mountain from below:

- **Extractive** — illegal miners, legal mining operations with government permits, land speculators
- **Biological** — invasive grasses creeping uphill, feral cattle compacting soil
- **Human** — unmanaged tourists, reckless campers who start fires, desperate subsistence farmers with no alternatives
- **Environmental** — drought, wildfire, erosion, and an uncounterable climate shift that makes every year harder

Three resources govern the run: **water** generated by the ecosystem itself, **funding** from grants and eco-tourism, and **community support** — a global modifier that determines whether locals are allies or adversaries.

![Páramo isometric tile system](Games/Paramo/Large.png)
*Isometric tile grid with elevation, vegetation, and terrain variety.*

---

## Design Intent

Designed as procedural rhetoric in the sense Ian Bogost defines it: the game's arguments are carried by its systems, not its narrative. If the prose were stripped and the player still arrived at the proposition through play, the argument is procedural.

**Core claim:** conservation is asymmetric, community-dependent, and partially losing — and no amount of competence makes the player a savior.

Sub-arguments carried by the rules:

- **Destruction is cheap; repair is dear** — a frailejon takes 3–4 seasons to mature and seconds to burn; scarred tiles never fully recover
- **Harm has long latency** — laguna contamination is invisible until nearly irreversible; act upstream before you see the damage
- **Fortress conservation fails** — fencing without community programs craters support, multiplying threats
- **Permitted extraction is the worst threat** — legal mining can't be physically stopped; the probabilistic legal path can lose
- **Climate is a ceiling, not an enemy** — no counter, only adaptation
- **The map remembers** — damage is partially irreversible; the end-of-run view shows what was lost, not what was scored

![Páramo mountain at dusk](Games/Paramo/Small.png)
*The mountain at dusk — stream, vegetation gradients, and atmospheric fog.*

---

## Technical Overview

Godot 4, isometric pixel art. All systems data-driven — new content is configuration, not code.

- **Tile-based ecosystem simulation** — per-tile health states, moisture propagation, altitude-dependent rules
- **Threat spawner** — seasonal intensity curves, weighted randomness, climate escalation
- **Fog-of-war and visibility** — monitoring stations, ranger patrols, directional audio cues
- **Interaction tiers** — field presence (planting, firefighting) vs. station management (legal, hiring, strategy)

*Work in progress — targeting a vertical-slice release: one handcrafted mountain, 10 seasons, core threat and tool sets, full resource loop.*

---

[Play|website](https://tomascorreag.github.io/Paramo/)
`,
  },
  {
    src: 'games/matrixThumb.png',     // place a 2:1 banner in src/assets/thumbnails/games/
    title: 'The Matrix',
    description: 'A 2D platformer vertical slice showcasing CRT shaderwork and pixel art movement. Built in Unity.',
    links: [
      { label: 'Play', icon: 'website', url: 'https://tomascorreag.github.io/the-matrix-vertical-slice/' },
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
    {
      src: '3d-assets/eyeThumb.png', alt: '3D asset', cols: 2, rows: 2, title: 'Procedural Eyes Asset, rigged', description: 'Anatomically detailed procedural eye. Iris pattern, sclera veins, and cornea wetness all generated without textures.',
      // gallery: ['3d-assets/eyeThumb.png'],  // Add extra view images here when ready
    },
    { src: '3d-assets/fleshThumb.png', alt: '3D asset', cols: 4, rows: 2, title: 'Procedural Raw Flesh Material', description: 'Procedural organic flesh material with colour variant controls. Used in the Ardo sculpt.' },
    { src: '3d-assets/paintThumb.png', alt: '3D asset', cols: 4, rows: 2, title: 'Oil Paint Shader', description: 'Procedural oil paint shader applied to a canvas scene. Brush stroke texture and impasto thickness driven by input image data.' },
    { src: '3d-assets/benchThumb.jpg', alt: '3D asset', cols: 2, rows: 1, title: 'Park Bench', description: 'Photorealistic park bench with wrought iron and wood slats, inspired by New Orleans benches. Study in material layering.' },
  ],
  '3D Art': [
    { src: '3d-art/thumb1.mp4', alt: 'Art piece', cols: 4, rows: 2, title: 'ALternate Realities Challenge', description: 'Inspired by the 2021 challenge from Pwnisher. Study in lighting, animation and simulation. Scene fully created and rendered in Blender Cycles, composited in DaVinci Resolve.' },
    { src: '3d-art/thumb2.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Ardo.', description: 'A study in organic sculpting and material design. Uses procedural flesh and skin assets shown in 3D asset section.' },
    { src: '3d-art/thumb3.jpeg', alt: 'Art piece', cols: 2, rows: 4, title: 'Menpō (面頬)', description: 'Study in hard-surface sculpting and composition.' },
    { src: '3d-art/ciudadFaroThumb.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Ciudad Faro', description: 'Inspired by Burning Caravan\'s Album Cover by the same name. Surrealist scene featuring a lighthouse surrounded by levitating whales.' },
    {
      src: '3d-art/marsThumb.png', alt: 'Art piece', cols: 4, rows: 2, title: 'Brain Farm', description: 'Surrealist Mars landscape. Stylized composite rendered in Blender Cycles. Part of an exploration on surrealist brain-themed scifi, including Brain-Cities.',
      gallery: ['3d-art/brainCityThumb.png'],
      detailLayout: 'below-split',
    },
    { src: '3d-art/ascensionThumb.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Ascension V', description: 'Inspired by Mobius\' piece "Ascension". Abstract study in volumetric lighting and particle simulation. Rendered in Blender Cycles.' },
    { src: '3d-art/donutThumb.png', alt: 'Art piece', cols: 2, rows: 2, title: 'Donut', description: 'The one that started it all, my first 3D piece. Classic Blender Guru tutorial.' },
    { src: '3d-art/bioshockThumb.webm', alt: 'Art piece', cols: 2, rows: 2, title: 'Bioshock Hallway', description: 'A hallway from the classic Bioshock game, study in modeling, materials, and composition.' },
    { src: '3d-art/starWarsChaseThumb.webm', alt: 'Art piece', cols: 2, rows: 2, title: 'Rebel Chase', description: 'A bit of Star Wars inspired fan art, an X-wing chasing down a TIE-fighter. Made entirely in Blender, a study in lighting, animation and VFX.' },
  ],
};
