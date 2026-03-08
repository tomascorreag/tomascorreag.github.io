# TODO

## Before Launch

### [M-1] Self-host Google Fonts (GDPR + SRI)

**Why:** Loading fonts from `fonts.googleapis.com` sends every visitor's IP to Google — a GDPR violation (German court ruling, 2022). Also: no integrity hash means a compromised CDN could inject arbitrary CSS.

**How:**
1. Go to https://fonts.google.com and download the two families:
   - Martian Mono (weights 100–800)
   - Space Mono (regular 400, bold 700, italic, bold italic)
2. Convert to `.woff2` if not already (use `fonttools` or an online converter)
3. Place files in `src/assets/fonts/`
4. Add `@font-face` declarations to `style.css` pointing to local files
5. Remove the three Google Fonts `<link>` tags from `index.html`
6. Update CSP in `index.html`: remove `https://fonts.googleapis.com` from `style-src` and `https://fonts.gstatic.com` from `font-src`

**Files to touch:** `index.html`, `src/style.css`
