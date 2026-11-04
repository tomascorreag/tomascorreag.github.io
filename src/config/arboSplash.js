/**
 * ARBO sign-in splash (Seq13, "Reaver reaching out"), rebuilt for the web.
 *
 * Source: the game's Unity project.
 *   Layout     Prefabs/UI/Panels and Canvas/SplashImage_Complete.prefab
 *   Loop       Animations/UI_Animations/SplashScreenSeq13_MainLoop.anim
 *   Particles  Scripts/UI/UI_Particle_System.cs + per-emitter prefab overrides
 *   Logo       Prefabs/UI/Panels and Canvas/Login.prefab ("Arena Tactics" + "Arbo Logo")
 *
 * Units are Unity canvas pixels (reference frame 1920 wide), y-up, with every
 * anchor and pivot at the rect centre, so `pos` is the offset of a node's
 * centre from its parent's centre. ParallaxBanner.js converts to CSS
 * percentages, so nothing here depends on the rendered banner size.
 *
 * Nesting is the depth effect: a child moves with every ancestor, so each
 * ground layer adds its own motion on top of the layers behind it. Children
 * render in array order (back to front), as in Unity.
 *
 * Per node:
 *   img       asset path under src/assets/thumbnails (drawn object-fit: contain,
 *             same as Unity's Image "Preserve Aspect"). Always .jpg: that's the
 *             optimizer's fallback name even for PNG masters; browsers get the
 *             transparent WebP/AVIF, and the flat .jpg only without either.
 *   size      rect [w, h]
 *   pos/rot/scale   pose at t = 0 of the loop (rot in degrees, CCW positive)
 *   loop      pose at the loop midpoint; the clip eases t0 → mid → t0. Every
 *             key in the clip has flat tangents, so each half is a smoothstep.
 *   parallax  [x, y] canvas px this node shifts at full pointer deflection,
 *             ADDED to its ancestors' shift (same nesting as the loop)
 *   particles emitters drawn on one canvas at this point in the stack
 *   brightness   static CSS brightness (animated if `loop.brightness` is set)
 *   grayscale    true → desaturate the node (and its children) to neutral
 *   glow         { radius, color } or a list of them: soft halo; radius in canvas px
 *   fx           light effect over painted glow; see buildFx in
 *                ParallaxBanner.js. Masks come from scripts/make-arbo-fx-masks.py
 *                and are referenced as .webp (masks need the alpha channel).
 *   shine        { period, sweep, color, glow }: a light streak across the
 *                node's child images, clipped to their alpha. It takes `sweep` s
 *                to cross, rests, and comes back the other way; one crossing
 *                plus rest = `period` s. `glow` blooms it past the edges.
 *                follow: 'pointer' → on mouse devices the streak sits under
 *                the cursor's x over the logo instead (the timed sweep stays
 *                as the touch fallback).
 */

// Logo lockup, not part of the Unity splash. Proportions from Login.prefab
// ("ARENA TACTICS" in a 328×129 box, the ARBO wordmark above it), scaled 1.9.
// Centred near the top, in front of everything (as the game's Login screen
// does), as the last child of Ground (2): it moves with the ground stack and
// gets the strongest parallax of its own, so it reads as the nearest layer:
// 40 inherited + 50 own = ~90 canvas px at full deflection, more than the
// FG Rocks (~80), previously the nearest layer.
// `pos` is in Ground (2) space, whose centre sits at view y ≈ −371, so
// y 501 puts the lockup ~130 above the view centre.
// Earlier layout: child of Ground (1) after the particles, pos [560, 130],
// parallax [2, 1], with the Reaver at Unity's x; the spear crossed in front.
const LOGO = {
  name: 'Logo',
  size: [328, 129],
  pos: [0, 501], scale: 1.9,
  parallax: [50, 30],
  // Neutral white: grayscale strips the art's lavender tint (and the ARBO
  // wordmark's baked Login tint). The shine reads mostly through its bloom,
  // since the glyphs are already near-white.
  grayscale: true,
  brightness: 1.08,
  glow: { radius: 10, color: 'rgba(255, 255, 255, 0.35)' },
  shine: {
    // With a mouse the glint follows the cursor across the logo.
    // Touch: sweeps one way over `sweep` s, rests, sweeps back.
    follow: 'pointer',
    period: 9, sweep: 4.5,
    color: 'rgba(255, 255, 255, 0.7)',
    glow: [
      { radius: 4, color: 'rgba(255, 255, 255, 0.6)' },
      { radius: 16, color: 'rgba(255, 255, 255, 0.35)' },
    ],
  },
  children: [
    {
      name: 'Arena Tactics',
      img: 'Games/ARBO/splash/Logo_ArenaTactics.jpg',
      size: [328, 129],
      pos: [0, 0],
    },
    {
      name: 'Arbo Logo',
      img: 'Games/ARBO/splash/Logo_ARBO.jpg',
      // 1.175× Login.prefab's 101×36. Placed by the glyphs, not the boxes
      // (both PNGs have transparent padding): ARBO's letters end ~15 units
      // above ARENA's (Login.prefab: ~22).
      // Login.prefab's Image tint (0.925, 0.941, 1) is baked into the master.
      size: [118.7, 42.3],
      pos: [0, 79.7],
    },
  ],
};

export const ARBO_SPLASH = {
  // Unity clip is 20 s at animator speed 0.5 → one out-and-back per 40 s.
  loopSeconds: 40,
  // The game frames 1920×1080 out of a 1920×1302 canvas; the site banner is
  // 2:1, so we show 1920×960. `viewCenterY` slides that window (y-up).
  canvas: [1920, 1302],
  view: [1920, 960],
  viewCenterY: 0,

  root: {
    name: 'BG',
    img: 'Games/ARBO/splash/BG.jpg',
    size: [2380, 1302],
    pos: [0, 0], scale: 1.01,
    loop: { pos: [-11, -12], scale: 1 },
    parallax: [8, 5],
    children: [
      // Fire flicker: warm light seen through scrolling noise, only where the
      // plate's flames are (mask keyed by scripts/make-arbo-fx-masks.py).
      {
        name: 'Fire FX',
        size: [2380, 1302],
        fx: {
          mask: 'Games/ARBO/splash/fx/Fire_BG.webp',
          noise: {
            tile: 'Games/ARBO/splash/fx/Noise.webp',
            color: 'rgb(255, 155, 55)',
            layers: [
              { size: 0.12, period: 15 },
              { size: 0.22, period: 23, drift: 1 },
            ],
          },
          opacity: [0.6, 1],
          flicker: 10.7,
        },
      },
      {
        name: 'Archon',
        img: 'Games/ARBO/splash/Archon.jpg',
        size: [1227, 954],
        pos: [-491, 194],
        loop: { pos: [-498, 200], brightness: 1 },
        brightness: 0.9,
        parallax: [4, 2],
        children: [
          // The Archon layer is mostly its own blue aura: an additive copy
          // breathing in and out makes the glow pulse.
          {
            name: 'Archon Glow FX',
            size: [1227, 954],
            fx: {
              img: 'Games/ARBO/splash/Archon.jpg',
              opacity: [0, 0.65],
              scale: [1, 1.05],
              pulse: 12,
            },
          },
        ],
      },
      {
        name: 'Archon Rocks',
        img: 'Games/ARBO/splash/Archon_Rocks_1.jpg',
        size: [445, 700],
        pos: [-506, 294], rot: 1.5,
        loop: { pos: [-502, 293], rot: -1.5, scale: 1.07 },
        parallax: [14, 9],
      },
      {
        name: 'Archon Rocks (1)',
        img: 'Games/ARBO/splash/Archon_Rocks_2.jpg',
        size: [985, 711],
        pos: [-283, 358],
        loop: { pos: [-283, 361], rot: -0.5, scale: 1.1 },
        parallax: [10, 6],
      },
      {
        name: 'Archon Rocks (2)',
        img: 'Games/ARBO/splash/Archon_Rocks_3.jpg',
        size: [590.8, 711],
        pos: [-590, 189], rot: 1,
        loop: { pos: [-594, 187], rot: -1, scale: 1.15 },
        parallax: [20, 12],
      },
      {
        name: 'Ground',
        img: 'Games/ARBO/splash/Ground_01.jpg',
        size: [2380, 1302],
        pos: [0, -390],
        loop: { pos: [4, -387], scale: 1.003 },
        parallax: [10, 6],
        children: [
          { name: 'Particles_BG', particles: ['bg'] },
          {
            name: 'Ground (1)',
            img: 'Games/ARBO/splash/Ground_02.jpg',
            size: [2300, 1302],
            pos: [0, 313],
            loop: { pos: [5, 322], scale: 1.004 },
            parallax: [10, 6],
            children: [
              // Laser: the beam flickers, and a bright band runs along it from
              // the flyer's muzzle to the impact (beam rises ~22° to the right
              // in this layer, so the band travels the other way).
              {
                name: 'Laser FX',
                size: [2300, 1302],
                fx: {
                  mask: 'Games/ARBO/splash/fx/Laser_Ground02.webp',
                  fill: 'rgba(120, 215, 255, 0.4)',
                  flow: { angle: 22.4, period: 3, width: 0.12, reverse: true, color: 'rgba(225, 250, 255, 0.6)' },
                  // Random flicker instead of a smooth pulse: 28 unevenly
                  // spaced keys over 5 s (~0.18 s apart) reads as unstable energy.
                  opacity: [0.2, 0.55],
                  flicker: 5,
                  flickerKeys: 28,
                },
              },
              { name: 'Particles_Specter+WF', particles: ['specter', 'wf'] },
              {
                name: 'Ground (2)',
                img: 'Games/ARBO/splash/Ground_03.jpg',
                size: [2380, 1302],
                pos: [0, -294],
                loop: { pos: [8, -282], scale: 1.008 },
                parallax: [12, 7],
                children: [
                  { name: 'Particles_FG', particles: ['fg'] },
                  {
                    name: 'Reaver',
                    img: 'Games/ARBO/splash/Reaver_Main.jpg',
                    size: [1227, 954],
                    // Unity: pos (216, 335) → (227, 345), scale 1 → 1.008.
                    // Shifted +90 x, −90 y and scaled 0.95 (loop scale keeps
                    // Unity's 1.008 breathing: 0.95 × 1.008) to open the top
                    // centre for the logo. Scale also shrinks its children
                    // (hand, thumb, FG Rocks) about the Reaver's centre.
                    pos: [306, 245], scale: 0.95,
                    loop: { pos: [317, 255], rot: -2, scale: 0.9576 },
                    parallax: [10, 6],
                    children: [
                      {
                        name: 'ReaverHand_Parent',
                        size: [670, 300],
                        pos: [-468, -197],
                        loop: { pos: [-468, -193], rot: 5, scale: 1.005 },
                        parallax: [6, 4],
                        children: [
                          {
                            name: 'ReaverThumb_Parent',
                            size: [290, 180],
                            pos: [292, -8], rot: 3,
                            loop: { rot: -3 },
                            children: [
                              {
                                name: 'Reaver Thumb',
                                img: 'Games/ARBO/splash/Reaver_thumb.jpg',
                                size: [290, 180],
                                pos: [54, -30],
                              },
                            ],
                          },
                          // The clip's 1.002 scale curve on this hand targets a
                          // wrong path in Unity and never plays; left out here too.
                          {
                            name: 'Reaver Hand',
                            img: 'Games/ARBO/splash/Reaver_hand.jpg',
                            size: [670, 300],
                            pos: [180, 4],
                          },
                        ],
                      },
                      {
                        name: 'FG Rocks',
                        img: 'Games/ARBO/splash/FG_Rocks.jpg',
                        size: [295, 656],
                        pos: [524, -244],
                        loop: { pos: [558, -208], scale: 1.02 },
                        parallax: [30, 18],
                      },
                    ],
                  },
                  LOGO,
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // UI_Particle_System settings after prefab overrides. `origin` is the
  // emitter's position in its parent ground layer. Ranges are [min, max].
  // Colours are linear 0–1 RGB, as stored by Unity.
  emitters: {
    bg: {
      origin: [-731, 33], count: 24, color: [1, 0.54901963, 0.28627452],
      alpha: [0.5, 1], size: [5, 7], maxDepth: 50, lifetime: [4, 8],
      posMin: [-350, 0], posMax: [250, 200],
      velMin: [-100, 150], velMax: [250, 250],
      drag: 0.4, noise: 64, force: [32, 64],
    },
    specter: {
      origin: [416, 316], count: 24, color: [0.56078434, 0.8745098, 1],
      alpha: [0.3, 0.75], size: [6, 10], maxDepth: 50, lifetime: [1, 3],
      posMin: [-50, -50], posMax: [50, 50],
      velMin: [-100, -100], velMax: [100, 100],
      drag: 0.1, noise: 64, force: [0, 0],
    },
    wf: {
      origin: [-384, -8], count: 32, color: [0.56078434, 1, 0.98039216],
      alpha: [0.3, 0.75], size: [7, 11], maxDepth: 50, lifetime: [1, 3],
      posMin: [-55, -55], posMax: [55, 55],
      velMin: [-100, -100], velMax: [200, 150],
      drag: 0.1, noise: 64, force: [0, 0],
    },
    fg: {
      origin: [0, 0], count: 64, color: [0.83137256, 0.63529414, 0.52156866],
      alpha: [0.25, 0.6], size: [6, 8], maxDepth: 80, lifetime: [4, 8],
      posMin: [-1024, -50], posMax: [512, 300],
      velMin: [-150, 150], velMax: [150, 250],
      drag: 0.3, noise: 64, force: [32, 64],
    },
  },
  // Site-side look on top of the Unity values: dots render larger and
  // brighter than in game (alpha is capped at 1).
  particleLook: { size: 1.35, alpha: 1.3 },
  // Shared UI_Particle_System defaults (not overridden by any emitter).
  particleNoiseScale: 0.01,
  noiseEveryFrames: 9,
  velocityEveryFrames: 3,
};
