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
    id: 'arbo',
    src: 'Games/ARBO/ARBO_thumb.jpg',
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
    id: 'paramo',
    type: 'spritesheet',
    spritesheet: {
      file: 'Games/Paramo/MainTitle_animated.png',
      frames: 24, first: 16, count: 8, fps: 10,
      // Pixel-perfect: native frame is 256×64; render at integer 1× = 256×64.
      frameWidth: 256, frameHeight: 64, scale: 1,
      frameAspect: '4 / 1',
      background: '#94a8bf',
    },
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
    id: 'matrix',
    type: 'spritesheet',
    spritesheet: {
      file: 'Games/Matrix/Neo_run_spriteSheet.png',
      frames: 8, first: 0, count: 8, fps: 10,
      // Pixel-perfect: native frame is 64×64; render at integer 2× = 128×128.
      frameWidth: 64, frameHeight: 64, scale: 2,
      frameAspect: '1 / 1',
      background: 'transparent',
    },
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
    {
      id: 'fabric', src: '3d-assets/fabricThumb.png', alt: 'Procedural fabric weave material', cols: 4, rows: 2,
      title: 'Procedural Fabric Material',
      description: 'A fully parametric weave material for Blender. A single node group exposes the weave pattern, scale, colour, and wear — scaling from tight basket to loose knit while staying physically believable.',
      gallery: [
        '3d-assets/fabric_details/detail1-min.png',
        '3d-assets/fabric_details/detail2-min.png',
        '3d-assets/fabric_details/detail4-min.png',
        '3d-assets/fabric_details/detail5-min.png',
      ],
    },
    {
      id: 'ice', src: '3d-assets/iceThumb.png', alt: 'Procedural ice in a glass', cols: 4, rows: 2,
      title: 'Procedural Ice',
      description: 'A procedural setup for building any kind of ice in Blender (Cycles), combining Geometry Nodes, the shader graph, and volumetric shading. Shown here in a glass with a drink — one of many possible variations.',
      gallery: [
        '3d-assets/ice_details/Glass_Var1.png',
        '3d-assets/ice_details/Glass_Var2.png',
        '3d-assets/ice_details/Glass_Var3.png',
        '3d-assets/ice_details/AllVars.png',
      ],
    },
    {
      id: 'toon', src: '3d-assets/toonThumb.webm', alt: 'Stylized toon shader render', cols: 4, rows: 2,
      title: 'Stylized Toon Shader',
      description: 'A Blender EEVEE shader built to emulate an illustrated look — reaching for, though not quite landing on, Moebius-style renders. A non-photorealistic study in ramp shading and line work.',
      gallery: [
        '3d-assets/toon_details/toonHead.mp4',
      ],
    },
    {
      id: 'eyes', src: '3d-assets/eyeThumb.png', alt: 'Procedural rigged eye', cols: 2, rows: 2,
      title: 'Procedural Eyes',
      description: 'An anatomically detailed procedural eye — iris pattern, sclera veins, and cornea wetness all generated without textures. Fully parametric (vein density, iris and sclera colour, and more) and rigged for animation out of the gate, including pupil dilation.',
      gallery: [
        '3d-assets/eye_details/var2.png',
        '3d-assets/eye_details/var3.png',
        '3d-assets/eye_details/var4.png',
        '3d-assets/eye_details/var5.png',
        '3d-assets/eye_details/allVars.png',
      ],
    },
    {
      id: 'flesh', src: '3d-assets/fleshThumb.png', alt: 'Procedural raw flesh material', cols: 4, rows: 2,
      title: 'Procedural Raw Flesh Material',
      description: 'A fully parametric organic flesh material for Blender (Cycles), with fine-grained controls over colour, wetness, and detail. Sold on Superhive (Blender Market) with 1,000+ sales.',
      gallery: [
        '3d-assets/flesh_details/var1_comp.png',
        '3d-assets/flesh_details/var2_comp.png',
        '3d-assets/flesh_details/var3_comp.png',
        '3d-assets/flesh_details/var4_comp.png',
        '3d-assets/flesh_details/var5_comp.png',
      ],
    },
    {
      id: 'paint', src: '3d-assets/paintThumb.png', alt: 'Procedural brushstroke painting material', cols: 4, rows: 2,
      title: 'Brushstroke Painting Material',
      description: 'A procedural oil-paint shader for Blender. It takes any image as input and renders it as if painted onto canvas with broad brushstrokes, impasto thickness driven by the source image.',
      gallery: [
        '3d-assets/paint_details/im2.png',
        '3d-assets/paint_details/im5.png',
      ],
    },
  ],
  '3D Art': [
    {
      id: 'alt-realities', src: '3d-art/thumb1.mp4', alt: 'Forest clearing with a worker and floating debris', cols: 4, rows: 2,
      title: 'Another Day at the Office',
      description: 'An early piece, submitted to Pwnisher\'s 2021 "Alternate Realities" challenge, with the required circle carved from negative space in the upper right. Everything but the character animation — modeling, texturing, shading, particles, boids, and cloth — built in Blender.',
      page: `
An early piece, submitted to Pwnisher's **"Alternate Realities" challenge** (2021). Entries had to work a circle into the frame; here it reads as **negative space** in the upper-right corner rather than a literal object.

---

## What I Made

Everything in the shot but the character's walk is mine:

- **Modeling, texturing, and shading** of the full environment
- **Particle emitters** scattering the forest and grass field
- **Boid simulation** driving the swarm of flies
- **Cloth simulation** for the clothing and the tarp

Built and rendered in **Blender**.
`,
    },
    {
      id: 'ardo', src: '3d-art/thumb2.png', alt: 'Visceral organic character bust', cols: 2, rows: 2, title: 'Ardo.',
      description: 'A personal piece made to channel a period of real anger — an end-to-end exercise in modeling, shading, and lighting in Blender, built on my custom parametric Eyes and Flesh assets.',
      page: `
*Ardo* (2024) came out of a period of real anger and became a way to channel it — built end-to-end in **Blender** as an exercise in modeling, shading, and lighting.

---

## Custom Assets

![Procedural Flesh material](3d-assets/flesh_details/var1_comp.png){right}
The surface shading is driven by two of my own parametric assets, both available in the **3D Tech** section.

*Flesh — a fully parametric organic material.*

The **Flesh** material handles the raw, living tissue — subsurface warmth, wetness, and pore-level detail, all procedural and tunable without textures.

---

![Procedural Eyes](3d-assets/eye_details/var2.png){left}
*Eyes — anatomically detailed and rigged.*

The **Eyes** are anatomically detailed and rigged — iris pattern, sclera veins, and cornea wetness generated without a single texture map.
`,
    },
    {
      id: 'menpo', src: '3d-art/thumb3.jpeg', alt: 'Sculpted Japanese menpō face armor', cols: 2, rows: 4, title: 'Menpō (面頬)',
      description: 'A modeling and hard-surface study of a Japanese menpō (samurai facial armour), focused on facial anatomy and shading. Built end-to-end in Blender.',
      page: `
*Menpō* (2021) is a modeling exercise built around a Japanese **menpō** — the half-face armour worn beneath a samurai helmet. The appeal was the face itself: studying its anatomy and translating it into hard, forged metal.

---

## Focus

- **Facial anatomy** — getting the underlying structure right so the mask reads as a face, not just a shape
- **Hard-surface shading** — worn, hammered metal with believable wear and specular break-up
- **Composition** — framing and lighting to give the piece presence

Built end-to-end in **Blender**.
`,
    },
    {
      id: 'ciudad-faro', src: '3d-art/ciudadFaroThumb.png', alt: 'Lighthouse surrounded by floating whales', cols: 2, rows: 2, title: 'Ciudad Faro',
      description: 'An homage to the band Burning Caravan and their album *Ciudad Faro*, rebuilding the cover composition in 3D. A study in modeling whales and their skeletons, the lighthouse, and volumetric lighting. Built end-to-end in Blender.',
      page: `
*Ciudad Faro* (2022) is a tribute to **Burning Caravan**, a band whose work I love, rebuilding the composition of their album cover of the same name as a 3D scene.

---

## What I Built

Translating a 2D painting into a dimensional scene, made end-to-end:

- **Whales and their skeletons** — the central forms, modeled from scratch
- **The lighthouse** anchoring the composition
- **Volumetric lighting** to carry the mood and depth of the original painting

Built end-to-end in **Blender**.
`,
    },
    {
      id: 'brain-farm', src: '3d-art/marsThumb.png', alt: 'Fantastical greenhouse on Mars powering a brain', cols: 4, rows: 2, title: 'Brain Farm',
      description: 'A fantastical greenhouse on Mars, powering a giant brain. Part of an ongoing exploration of brain-themed surrealism, alongside the Brain-City study. A study in particle-scattered environments, built end-to-end in Blender.',
      // Optional `page` Markdown drives the detail-view body (parsed by parseMarkdown).
      // Same syntax as a GAMES item's `page`: ## headings, paragraphs, --- dividers,
      // - lists, ![alt](path) images (path relative to src/assets/thumbnails/), and
      // [Label|icon](url) link rows. When omitted, the short `description` is shown instead.
      page: `
A fantastical greenhouse on Mars, powering a giant brain — part of an ongoing exploration of brain-themed surrealism and the fantastical compositions to set them in.

![Brain-City companion study](3d-art/brainCityThumb.png){right}
*Brain-City — a companion study: a vast city floating in space, powered by a brain (or a brain powered by a city?).*

The companion **Brain-City** piece extends the same motif into a sprawling city suspended in space.

---

## Technique

- Stylized composite rendered end-to-end in **Blender**
- **Particle systems** scattering the rocks across the Martian surface
- Volumetric atmosphere graded in post
`,
    },
    {
      id: 'ascension', src: '3d-art/ascensionThumb.png', alt: 'Abstract volumetric light and particles', cols: 2, rows: 2, title: 'Ascension V',
      description: 'Inspired by Moebius\' piece *Ascension*. An abstract study in volumetric lighting and particle simulation, built end-to-end in Blender.',
      page: `
*Ascension V* (2025) is drawn from **Moebius'** piece *Ascension*. Moebius is a long-standing influence on my work, and this is an abstract study in his direction.

---

## Focus

- **Volumetric lighting** as the primary subject
- **Particle simulation** shaping the forms in space

Made entirely by me in **Blender**.
`,
    },
    {
      id: 'frenesi', src: '3d-art/Frenesi.webm', alt: 'Animated short film still', cols: 2, rows: 2, title: 'Frenesí',
      description: 'A short film I directed and produced on psychoactive-substance use, gender, and sexuality. 2nd place (Animation) at the 8th Festival de Cortos Psicoactivos. Made almost entirely by me in Blender (Cycles).',
      page: `
*Frenesí* (2022) is a short film I directed and produced on psychoactive-substance use and its links to gender and sexuality — a thread central to harm-reduction discourse in Colombia.

---

## Recognition

**2nd place, Animation category** — 8th *Festival de Cortos Psicoactivos* (Psychoactive Short Film Festival), out of hundreds of submissions. The festival is organized by **Échele Cabeza**, a Colombian harm-reduction NGO.

---

## Craft

Apart from the voice acting, the film was made entirely by me in **Blender (Cycles)** — modeling, animation, shading, lighting, and rendering.
`,
    },
    {
      id: 'bioshock', src: '3d-art/bioshockThumb.webm', alt: 'Recreated BioShock hallway', cols: 2, rows: 2, title: 'Bioshock Hallway',
      description: 'A recreation of a hallway from the original *BioShock* — a study in modeling, materials, and composition. Built in Blender; every asset is mine except the vending-machine texture.',
      page: `
*Bioshock Hallway* (2023) recreates a corridor from the original **BioShock** — a franchise I love, and one whose art direction I wanted to explore firsthand.

---

## What I Built

A study in modeling, materials, and composition:

- Every asset modeled, textured, and shaded by me — **except the vending-machine texture**
- Period materials: worn brass, cracked tile, water-stained surfaces
- Lighting and framing tuned to the game's claustrophobic mood

Built end-to-end in **Blender**.
`,
    },
    {
      id: 'rebel-chase', src: '3d-art/starWarsChaseThumb.webm', alt: 'X-Wing chasing a TIE Fighter', cols: 2, rows: 2, title: 'Rebel Dogfight',
      description: 'A Star Wars scene: an X-Wing chasing down a TIE Fighter. An exploration of action-camera animation, environment design, and explosion VFX. Built in Blender; the X-Wing model was sourced online.',
      page: `
*Rebel Dogfight* is a Star Wars-inspired chase — an **X-Wing** running down a **TIE Fighter**.

---

## Focus

- **Action-camera animation** — choreographing a fast, readable dogfight
- **Environment design** for the surrounding space
- **Explosion VFX**

Made in **Blender**. The X-Wing model was sourced online; everything else is mine.
`,
    },
  ],
};
