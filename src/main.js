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

// URL-gated portfolio decks (`/?p=<slug>`) skip both apps: the deck is
// self-contained, so loading desktop.js (terminal, rabbit, particles, global
// key/resize handlers) or mobile.js just to mount it was wasted download and
// parse. mountDeck shows its own "not found" panel for an unknown slug, so
// presence of the param is enough.
const gatedSlug = new URLSearchParams(window.location.search).get('p');

if (gatedSlug !== null) {
  if (isMobile) document.documentElement.classList.add('mobile-mode');
  // index.html's desktop scene stubs are dead weight under the deck.
  document.querySelectorAll('#crt-screen, #mosaic, .crt-overlay').forEach((el) => el.remove());
  Promise.all([
    import('./components/PortfolioDeck.js'),
    // Desktop decks always ran with the tuned CRT glow values; mobile decks
    // use the CSS fallbacks. Keep both looks as they were.
    isMobile ? null : import('./config/crt.js').then((c) => c.injectCRTVariables()),
  ])
    .then(([m]) => m.mountDeck(gatedSlug, { isMobile }))
    .catch((err) => console.error('Deck boot failed:', err));
} else if (isMobile) {
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
