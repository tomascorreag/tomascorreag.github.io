# TODO

## Before Launch

### ~~[M-1] Self-host Google Fonts (GDPR + SRI)~~ ✅ Done

Fonts self-hosted in `src/assets/fonts/` as woff2 (latin + latin-ext subsets). Google Fonts `<link>` tags and CSP allowlist entries removed from `index.html`. `@font-face` declarations added to `style.css`.
- [x] There's a bug on mobile where, when you drag the timeline of a thumbnail video like frenesi, it registers as a swipe and takes you to another item. Fix it.
- [x] there's no need for two separate links for the memory of the land sites, as there is a single landing page at MapColombia.
