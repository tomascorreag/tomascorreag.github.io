# TODO

## Before Launch

### ~~[M-1] Self-host Google Fonts (GDPR + SRI)~~ ✅ Done

Fonts self-hosted in `src/assets/fonts/` as woff2 (latin + latin-ext subsets). Google Fonts `<link>` tags and CSP allowlist entries removed from `index.html`. `@font-face` declarations added to `style.css`.
- [x] There's a bug on mobile where, when you drag the timeline of a thumbnail video like frenesi, it registers as a swipe and takes you to another item. Fix it.
- [x] there's no need for two separate links for the memory of the land sites, as there is a single landing page at MapColombia.
- [x] Flesh: replaced with animated v3 renders from `Flesh/FLESH_MAT_ANIMATED_5.2.blend` (alpha pairs: `foo.alpha.webm` + flattened `foo.mp4`). v4 masters archived in `archive/flesh-v4/`.
- [ ] Render new Paint (`PAINT_MAT_5.2.blend`) shader version for the site. Current site images are Paint 2021 (`Paint/renders/`). Render from `marketing/blender/scenes/PAINT_GALLERY_take.blend` (see `Blender_Material_Projects/marketing/README.md`). Then replace `assets-src/thumbnails/3d-assets/paintThumb.png` and `paint_details/`, and regenerate the optimized variants.
