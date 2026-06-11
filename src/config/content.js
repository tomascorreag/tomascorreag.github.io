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
      label: '3D Art & Materials', detail: 'Modelling, texturing, procedural workflows in Blender', thumbnails: [
        { category: '3D Art', itemIndex: 1 },
        { category: '3D Art', itemIndex: 2 },
      ]
    },
    { label: 'Tools & Pipelines', detail: 'Custom editor tools, asset pipelines, workflow automation' },
    { label: 'Game Development', detail: 'ARBO: Arena Tactics (shipped on Steam): Technical Artist & lead developer' },
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
 * Games section — each entry is a game or interactive artifact with a banner, description, and links.
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
    summary: 'Turn-based tactical combat with deckbuilding, built in Unity. Shipped on Steam in 2025.',
    description: 'Turn-based tactical combat with a deckbuilding layer, built in Unity and shipped on Steam in October 2025. Two players each command a team of hero robots across hex-grid arenas with elevation and line-of-sight, building protocol decks to outmaneuver and KO each other — StarCraft positioning crossed with Magic: The Gathering deck construction. I was the Technical Artist and a lead developer: I owned the real-time visual pipeline and editor tooling, and co-developed the core gameplay systems and UI/UX.',
    links: [
      { label: 'Steam', icon: 'steam', url: 'https://store.steampowered.com/app/2914810/ARBO_Arena_Tactics/' },
      { label: 'Website', icon: 'website', url: 'https://arbo.xyz/' },
    ],
    page: `
## About the Project

Turn-based tactical combat with a deckbuilding layer, built in Unity and shipped on Steam in October 2025. Two players each command a team of hero robots across hex-grid arenas — the design splices StarCraft's asymmetric units and positional play with Magic: The Gathering's deck construction and cost curves.

- **4 hero classes** — Worldforger, Reaver, Archon, Specter — each with 3 combat themes that steer how you build a deck
- **15-card protocol decks** drawing on energy, movement, and shields as cost pools. Energy doubles as health, so every cast spends survivability
- **Hex-grid arenas** featuring water, ice, magma, tar, and concealment tiles, plus per-tile elevation that shapes movement, targeting, and sightlines
- **Initiative-based turns** with accuracy-vs-evasion rolls — evasion scales with distance — and full line-of-sight occlusion from terrain and structures
- **A deep status-effect layer**, with 39 distinct effect types spanning stat modifiers, damage-over-time, control, immunities, and stacking mechanics

Four ways to play: online 1v1 multiplayer, a ranked ladder, an LLM-driven tutorial opponent, and Prompt Battler — an AI-agent mode where natural-language commands drive the match.

---

## My Role

Technical Artist and co-lead developer.

- **Real-time visual pipeline**: custom shaders in URP, built with Shader Graph and HLSL/GLSL
- **All VFX**: particle systems, VFX Graph, and bespoke effects
- **Custom Unity editor tools** for myself and the rest of the team
- Led the **2D-to-3D production transition**: a planned, year-long migration of the whole visual stack, executed across parallel branches without halting live development
- Co-developed the **hex-grid combat engine**, protocol-deck system, and status-effect framework
- Co-developed the **UI/UX** across the stack

---

![ARBO Molecular Punch VFX](Games/ARBO/punch.jpg)
*Molecular Punch on the Abyssal Pit map. Custom VFX, shader, and post-processing work.*

---

## Technical Highlights

- A custom real-time **shader pipeline** in URP, combining Shader Graph with hand-written HLSL/GLSL
- **VFX** spanning particle systems, VFX Graph, and fully custom effects
- **Editor tooling** that lets designers author and tune content without writing code
- **Fully data-driven content**: classes, protocols, operations, and arena setups defined in JSON profiles, so balance and content iteration never touches engine code
- **Elevation-aware combat math**: line-of-sight traced hex-by-hex over terrain heights, and chance-to-hit built on distance-scaled evasion
- **Two-tier networking**: Photon Fusion for in-match state sync, Colyseus for lobbies, matchmaking, and ranked
- **Server-driven AI opponents**: an LLM tutorial opponent with hint support and a reasoning agent powering the Prompt Battler mode, with per-turn failsafe timing

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
    description: 'An environmental strategy game set on a Colombian **páramo**, a high-altitude Andean ecosystem that supplies water to millions of people downstream. You play a field coordinator defending the mountain against extractive, biological, and climate threats while juggling community relationships and scarce resources. Built in Godot 4 with isometric pixel art. The argument lives in the systems rather than the script: it is a game about conservation that makes its case through play. Work in progress.',
    links: [
      { label: 'Play', icon: 'website', url: 'https://tomascorreag.github.io/Paramo/' },
    ],
    page: `
## About the Project

Tower defence meets environmental strategy, built in Godot 4. You play a field coordinator protecting a Colombian páramo, a high-altitude Andean ecosystem that works as a water factory for millions of people downstream. A glacial laguna sits at the summit. If it dies, everything below it dies with it.

Threats climb the mountain from below:

- **Extractive:** illegal miners, permitted mining operations, and land speculators
- **Biological:** invasive grasses creeping uphill and feral cattle compacting the soil
- **Human:** unmanaged tourists, reckless campers who start fires, and subsistence farmers with no other options
- **Environmental:** drought, wildfire, erosion, and an uncounterable climate shift that makes every year harder

Three resources govern a run. **Water** comes from the ecosystem itself, **funding** from grants and eco-tourism, and **community support** acts as a global modifier that decides whether locals are allies or adversaries.

![Páramo isometric tile system](Games/Paramo/Large.png)
*Isometric tile grid with elevation, vegetation, and terrain variety.*

---

## Design Intent

The game is built as procedural rhetoric in Ian Bogost's sense: its arguments are carried by the systems, not the narrative. The test is simple. Strip the prose, and if play alone still leads you to the proposition, the argument is procedural.

**The core claim:** conservation is asymmetric, community-dependent, and partly a losing fight. No amount of competence turns you into a savior.

The rules carry the sub-arguments:

- **Destruction is cheap; repair is dear.** A frailejón takes three or four seasons to mature and seconds to burn, and scarred tiles never fully recover.
- **Harm runs on a long delay.** Laguna contamination stays invisible until it is nearly irreversible, so you have to act upstream of the damage.
- **Fortress conservation fails.** Fencing the mountain off without community programs craters support and multiplies threats.
- **Permitted extraction is the worst threat.** Legal mining cannot be physically stopped, and the probabilistic legal route can still lose.
- **Climate is a ceiling, not an enemy.** There is no counter for it, only adaptation.
- **The map remembers.** Damage is partly irreversible, and the end-of-run screen shows what was lost rather than what was scored.

![Páramo mountain at dusk](Games/Paramo/Small.png)
*The mountain at dusk: stream, vegetation gradients, and atmospheric fog.*

---

## Technical Overview

Godot 4, isometric pixel art. Every system is data-driven, so new content is configuration rather than code.

- **Tile-based ecosystem simulation:** per-tile health states, moisture propagation, and altitude-dependent rules
- **Threat spawner:** seasonal intensity curves, weighted randomness, and climate escalation
- **Fog-of-war and visibility:** monitoring stations, ranger patrols, and directional audio cues
- **Two interaction tiers:** field presence (planting, firefighting) and station management (legal action, hiring, strategy)

*Work in progress, targeting a vertical-slice release: one handcrafted mountain, 10 seasons, the core threat and tool sets, and the full resource loop.*

---

[Play|website](https://tomascorreag.github.io/Paramo/)
`,
  },
  {
    id: 'scars-of-violence',
    src: 'artifacts/MapColombia_thumb.png',
    title: 'Scars of Violence',
    summary: 'A browser-based map of Colombia that renders seven decades of the armed conflict’s documented violence as wounds that heal into permanent scars. A digital-humanities artifact built with Svelte and MapLibre GL.',
    description: 'An interactive, browser-based map of Colombia that renders the documented violence of the armed conflict (1958–present) as wounds on the territory that heal into permanent scars. A digital-humanities artifact built on the case-by-case archive of the Centro Nacional de Memoria Histórica (CNMH), in Svelte and MapLibre GL.',
    links: [
      { label: 'Explore', icon: 'website', url: 'https://tomascorreag.github.io/MapColombia' },
    ],
    page: `
## About the Project

An interactive, browser-based map of Colombia that renders the documented violence of the country's armed conflict (1958–present) as **wounds on the territory that heal into permanent scars**. The marks are drawn from the case-by-case record compiled by the **Centro Nacional de Memoria Histórica** (CNMH) in its SIEVCAC archive.

Time is the central dimension. As the timeline plays from 1958 to the present:

- Each documented event appears **on its exact date**, as a wound at the place it occurred. Its visual extent is proportional to the number of victims — nothing is sized by interpretation or emphasis.
- The wound flares while fresh, then fades over roughly three years, leaving a **permanent scar** that never disappears. By the end of playback the map is not empty: it is covered in seven decades of accumulated marks.
- Blood-like tendrils spread from each wound across the surrounding territory, their density tracking victim counts, settling into thin, dark, permanent traces.
- Clicking a scar opens the documented record behind it — modality, date, place, and a demographic portrait of the victims, with its source citation.

The wound-and-scar metaphor is the thesis of the piece: violence is not a sequence of isolated incidents but an injury to territory and population whose marks persist. A massacre in 1997 is still visible in 2026, because it is still present in the country.

---

## Why I Made It

**Rutas del Conflicto** (rutasdelconflicto.com) is the direct inspiration. Their navigable, place-by-place archive of the conflict's massacres showed me that memory work could take the form of a map rather than a linear narrative. This piece keeps their core gesture — geography as the way into the conflict — while experimenting with a more visceral visual register: animation, accumulation, the wound-and-scar metaphor, to test whether the territory's marking can be *felt* as well as consulted. It is an homage and an experiment on top of their idea, not a correction of it.

The conflict's toll is usually communicated as aggregate numbers, and aggregates anaesthetise. The hypothesis is that a spatial-temporal rendering can do what a table cannot: convey that the violence had a *shape* — that it concentrated in specific regions, moved across the country in waves, and left wounds that are both spatial and temporal, and still visible decades later.

The second motivation is the **CNMH** itself. Its patient, rigorous, case-by-case documentation of the conflict in SIEVCAC is one of the most important memory undertakings in the country, and it deserves to be seen by more than researchers who can parse a CSV. This project puts interactive data visualisation at the service of an archive that already exists, rather than making a new claim about the conflict.

---

## Commitments

Because the archive records real victims, the design carries non-negotiable constraints:

- **Fidelity over drama.** Every mark corresponds to a documented case with a citation back to its source record. Missing values stay missing and are disclosed; the emotional force must come from the truth of the data, not embellishment of it. No coordinate, date, or victim count is ever estimated, interpolated, or fabricated.
- **Interpretation is labeled.** The wound metaphor is an authored reading, and the interface says so. The viewer can always reach the underlying record.
- **Dignity.** The archive is published for memory, research, and education. The aesthetic aims for gravity — a dark cartographic register, not spectacle.

---

[Explore the Map|website](https://tomascorreag.github.io/MapColombia)
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
      description: 'A fully parametric weave material for Blender. One node group exposes the weave pattern, scale, colour, and wear, so it scales from a tight basket to a loose knit while staying physically believable.',
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
      description: 'A procedural setup for building any kind of ice in Blender (Cycles), combining Geometry Nodes, the shader graph, and volumetric shading. Shown here in a glass with a drink, one of many possible variations.',
      gallery: [
        '3d-assets/ice_details/Glass_Var1.png',
        '3d-assets/ice_details/Glass_Var2.png',
        '3d-assets/ice_details/Glass_Var3.png',
        '3d-assets/ice_details/AllVars.png',
      ],
    },
    {
      id: 'toon', src: '3d-assets/toonThumb.webm', alt: 'Stylised toon shader render', cols: 4, rows: 2,
      title: 'Stylised Toon Shader',
      description: 'A Blender EEVEE shader that emulates an illustrated look, aiming in the direction of Moebius-style renders. A non-photorealistic study in ramp shading and line work.',
      gallery: [
        '3d-assets/toon_details/toonHead.mp4',
      ],
    },
    {
      id: 'eyes', src: '3d-assets/eyeThumb.png', alt: 'Procedural rigged eye', cols: 2, rows: 2,
      title: 'Procedural Eyes',
      description: 'An anatomically detailed procedural eye. The iris pattern, sclera veins, and cornea wetness are all generated without a single texture. Fully parametric (vein density, iris and sclera colour, and more) and rigged for animation from the start, pupil dilation included.',
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
      description: 'An early piece, submitted to Pwnisher\'s 2021 "Alternate Realities" challenge, with the required circle carved out of the negative space in the upper right. Everything but the character animation is mine: modelling, texturing, shading, particles, boids, and cloth, all built in Blender.',
      page: `
An early piece, submitted to Pwnisher's **"Alternate Realities" challenge** (2021). Entries had to work a circle into the frame; here it reads as **negative space** in the upper-right corner rather than a literal object.

---

## What I Made

Everything in the shot but the character's walk is mine:

- **Modelling, texturing, and shading** of the full environment
- **Particle emitters** scattering the forest and grass field
- **Boid simulation** driving the swarm of flies
- **Cloth simulation** for the clothing and the tarp

Built and rendered in **Blender**.
`,
    },
    {
      id: 'ardo', src: '3d-art/thumb2.png', alt: 'Character screaming as he burns in a nighttime wildfire', cols: 2, rows: 2, title: 'Ardo.',
      description: 'A character burns alive in a nighttime wildfire, screaming. Conceived to give form to deep rage and despair. Built end-to-end in Blender on my own parametric Eyes and Flesh assets.',
      page: `
*Ardo* (2024) means *I burn* in Spanish, and the piece takes the title at its word. It was conceived in a period of deep rage and despair, and made with one intent: to give that state a body, so it could exist somewhere outside of me.

---

## The Expression

A man burns alive in the middle of a forest wildfire at night. The frame stays close on his head as he screams, skin and flesh igniting. There is no story around it and no second read intended. This is what that period felt like from the inside, and I wanted the image to be as direct as the feeling was.

The contrast that carries the piece is between the figure and the night around him. The fire is violent and immediate; the forest behind it is still, dark, and completely indifferent. Rage is loud, but despair is the part where the world around you doesn't react. Both had to be in the same frame.

Making it was the way through. By the time the piece was finished, the feeling had somewhere to live that wasn't me.

---

## Process

I sculpted the head from scratch, iterating on it over about a month. The screaming expression took most of those passes; a face that extreme collapses into caricature very easily, and it had to stay believable for the image to hurt.

The lighting was the hardest part. Fire wants to dominate every frame it appears in, and I wanted the atmospheric stillness of the night to survive next to it. Most of the lighting work went into holding that balance, letting the chaos of the flames and the calm of the dark coexist without one flattening the other.

---

## Custom Assets

![Procedural Flesh material](3d-assets/flesh_details/var1_comp.png){right}
The surface shading is driven by two of my own parametric assets, both available in the **3D Tech** section.

*Flesh: a fully parametric organic material.*

The **Flesh** material handles the raw, living tissue: subsurface warmth, wetness, and pore-level detail, all procedural and tunable without textures.

---

![Procedural Eyes](3d-assets/eye_details/var2.png){left}
*Eyes: anatomically detailed and rigged.*

The **Eyes** are anatomically detailed and rigged, with iris pattern, sclera veins, and cornea wetness generated without a single texture map.
`,
    },
    {
      id: 'menpo', src: '3d-art/thumb3.jpeg', alt: 'Sculpted Japanese menpō face armour', cols: 2, rows: 4, title: 'Menpō (面頬)',
      description: 'A modelling and hard-surface study of a Japanese menpō (samurai facial armour), focused on facial anatomy and shading. Built end-to-end in Blender.',
      page: `
*Menpō* (2021) is a modelling exercise built around a Japanese **menpō**, the half-face armour worn beneath a samurai helmet. The draw was the face itself: studying its anatomy and translating it into hard, forged metal.

---

## Focus

- **Facial anatomy:** getting the underlying structure right so the mask reads as a face, not just a shape
- **Hard-surface shading:** worn, hammered metal with believable wear and specular break-up
- **Composition:** framing and lighting that give the piece presence

Built end-to-end in **Blender**.
`,
    },
    {
      id: 'ciudad-faro', src: '3d-art/ciudadFaroThumb.png', alt: 'Lighthouse surrounded by floating whales', cols: 2, rows: 2, title: 'Ciudad Faro',
      description: 'An homage to the band Burning Caravan and their album *Ciudad Faro*, rebuilding the cover composition in 3D. A study in modelling whales and their skeletons, the lighthouse, and volumetric lighting. Built end-to-end in Blender.',
      page: `
*Ciudad Faro* (2022) is a tribute to **Burning Caravan**, a band whose work I love, rebuilding the composition of their album cover of the same name as a 3D scene.

---

## What I Built

Translating a 2D painting into a dimensional scene, made end-to-end:

- **Whales and their skeletons**, the central forms, modelled from scratch
- **The lighthouse** that anchors the composition
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
A fantastical greenhouse on Mars, powering a giant brain. It is part of an ongoing exploration of brain-themed surrealism and the fantastical settings that frame it.

![Brain-City companion study](3d-art/brainCityThumb.png){right}
*Brain-City, a companion study: a vast city floating in space, powered by a brain (or is it a brain powered by a city?).*

The companion **Brain-City** piece extends the same motif into a sprawling city suspended in space.

---

## Technique

- Stylised composite rendered end-to-end in **Blender**
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
      // hasAudio: the clip has a soundtrack — detail/doc views attach custom
      // video controls (play/pause/seek/mute) so visitors can unmute it.
      id: 'frenesi', src: '3d-art/Frenesi.webm', alt: 'Animated short film still', cols: 2, rows: 2, title: 'Frenesí', hasAudio: true,
      description: 'A short film I directed and produced on psychoactive-substance use, gender, and sexuality, made to push back against the taboos around them in Colombia. 2nd place (Animation) at the 8th Festival de Cortos Psicoactivos. Made almost entirely by me in Blender (Cycles).',
      page: `
*Frenesí* (2022) is a short film I directed and produced about psychoactive-substance use and its ties to gender and sexuality. In Colombia these subjects are mostly discussed in whispers, if at all.

---

## Why I Made It

I grew up in a society where drug use, sex, and gender identity are wrapped in taboo, and in Colombia the cost of that taboo is not abstract. It is violence. The drug trade has fed decades of armed conflict, yet the stigma lands hardest on the people who use: criminalised, pushed to the margins, and in the worst cases murdered in so-called social cleansing. Trans and queer Colombians are harassed and killed for being visible. None of this is prevented by the silence around these subjects. The silence is what lets it continue.

Taboo also does its quieter damage. When something can't be discussed openly, people can't ask questions or get accurate information, and seeking help comes with shame attached. Stigma doesn't stop drug use and it doesn't make anyone's identity disappear. It pushes both into the dark, where the harm compounds.

Breaking a taboo is not the same as promoting what it hides. People are going to use substances, have sex, and live across the spectrum of gender whether we talk about it or not. Talking about it honestly is what makes those realities safer and the people living them less alone. That principle is the core of harm reduction, and it is the reason this film exists.

*Frenesí* treats these subjects as ordinary parts of human experience. In a country where saying that out loud is still difficult, that felt worth making.

---

## Recognition

**2nd place, Animation category** at the 8th *Festival de Cortos Psicoactivos* (Psychoactive Short Film Festival), out of hundreds of submissions. The festival is run by **Échele Cabeza**, a Colombian harm-reduction NGO.

---

## Craft

Apart from the voice acting, the film was made entirely by me in **Blender (Cycles)**: modelling, animation, shading, lighting, and rendering.
`,
    },
    {
      id: 'bioshock', src: '3d-art/bioshockThumb.webm', alt: 'Recreated BioShock hallway', cols: 2, rows: 2, title: 'Bioshock Hallway',
      description: 'A recreation of a hallway from the original *BioShock*, and a study in modelling, materials, and composition. Built in Blender, where every asset is mine except the vending-machine texture.',
      page: `
*Bioshock Hallway* (2023) recreates a corridor from the original **BioShock**, a franchise I love and one whose art direction I wanted to explore firsthand.

---

## What I Built

A study in modelling, materials, and composition:

- Every asset modelled, textured, and shaded by me, **except the vending-machine texture**
- Period materials: worn brass, cracked tile, water-stained surfaces
- Lighting and framing tuned to the game's claustrophobic mood

Built end-to-end in **Blender**.
`,
    },
    {
      id: 'rebel-chase', src: '3d-art/starWarsChaseThumb.webm', alt: 'X-Wing chasing a TIE Fighter', cols: 2, rows: 2, title: 'Rebel Dogfight',
      description: 'A Star Wars scene: an X-Wing chasing down a TIE Fighter. An exploration of action-camera animation, environment design, and explosion VFX. Built in Blender; the X-Wing model was sourced online.',
      page: `
*Rebel Dogfight* is a Star Wars-inspired chase: an **X-Wing** running down a **TIE Fighter**.

---

## Focus

- **Action-camera animation:** choreographing a fast, readable dogfight
- **Environment design** for the surrounding space
- **Explosion VFX**

Made in **Blender**. The X-Wing model was sourced online; everything else is mine.
`,
    },
  ],
};
