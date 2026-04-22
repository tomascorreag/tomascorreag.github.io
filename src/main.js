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
 * Device decision. Viewport width is the most reliable phone signal:
 * touch-capable laptops are common, so "has touch" alone would misroute.
 * 820px covers every mainstream phone (inc. large Android landscape) but
 * stays well below iPad portrait (768 for mini, 1024 for standard), so
 * tablets keep the desktop experience where the cursor-driven CRT works.
 */
const isMobile = window.innerWidth <= 820;

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
