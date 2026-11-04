/**
 * Scroll reveal for markdown documents: `.article-reveal` blocks fade/slide in
 * as they scroll into view, and fade out again once fully out of view, so the
 * effect replays scrolling down AND back up (the hidden/shown styles live in
 * article.css).
 *
 * Two thresholds give hysteresis: a block is revealed at 10% visible but only
 * hidden at 0%. With a single threshold, a block at the top edge could
 * flicker: hiding it shifts it 12px down (the hidden-state transform), which
 * pushes it back over the threshold, which reveals it, and so on.
 *
 * @param {Element} content    element containing the .article-reveal blocks
 * @param {Element} scrollRoot the scrolling container they move through
 * @returns {IntersectionObserver} call .disconnect() when the document goes away
 */
export function observeScrollReveal(content, scrollRoot) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.intersectionRatio >= 0.1) entry.target.classList.add('revealed');
      else if (!entry.isIntersecting) entry.target.classList.remove('revealed');
    }
  }, { root: scrollRoot, threshold: [0, 0.1] });

  content.querySelectorAll('.article-reveal').forEach((el) => observer.observe(el));
  return observer;
}
