/**
 * Router entry — decides between the desktop and mobile apps at boot.
 *
 * Both branches are dynamic imports so only one code+CSS chunk actually
 * downloads per session. A mobile device never ships the Three.js/Rabbit/
 * ParticleMorph code, and a desktop never ships the mobile shell CSS.
 *
 * Loaded by index.html as a <script type="module">. Keep this file tiny —
 * anything imported at module scope here ends up in every user's bundle.
 */

/*
 * Device decision. Primary signal is pointer type: a phone/tablet reports
 * `(hover: none) and (pointer: coarse)`, a laptop (even a touch one) does
 * not. This catches large phones in landscape (iPhone Pro Max = 932px,
 * unfolded Fold = 884px) that a width-only gate would misroute to desktop.
 *
 * Width ≤ 820px is kept as a fallback for browsers/environments where the
 * hover/pointer media queries are unreliable (some older WebViews, automated
 * tools). iPads (portrait 768 mini / 1024 standard) report `hover: hover`
 * via Apple Pencil + trackpad paths and usually stay on desktop; iPad in
 * full tablet-only mode reports coarse and correctly gets mobile.
 */
const coarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const isMobile = coarsePointer || window.innerWidth <= 820;

if (isMobile) {
  document.documentElement.classList.add('mobile-mode');
  import('./mobile.js')
    .then((m) => m.boot())
    .catch((err) => {
      // Last-resort fallback: if the mobile chunk fails to load, surface a
      // readable error rather than a blank screen. The inline <div>s from
      // index.html will still be empty so the user sees just this message.
      console.error('Mobile boot failed:', err);
      document.body.insertAdjacentHTML(
        'beforeend',
        '<pre style="color:#6cff6c;padding:1.5rem;font:14px monospace">' +
          '&gt; Couldn&rsquo;t load mobile app. Please refresh.</pre>'
      );
    });
} else {
  import('./desktop.js').catch((err) => {
    console.error('Desktop boot failed:', err);
  });
}
