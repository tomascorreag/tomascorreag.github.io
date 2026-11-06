# TODO

## Before Launch

### ~~[M-1] Self-host Google Fonts (GDPR + SRI)~~ ✅ Done

Fonts self-hosted in `src/assets/fonts/` as woff2 (latin + latin-ext subsets). Google Fonts `<link>` tags and CSP allowlist entries removed from `index.html`. `@font-face` declarations added to `style.css`.
- [x] There's a bug on mobile where, when you drag the timeline of a thumbnail video like frenesi, it registers as a swipe and takes you to another item. Fix it.
- [x] there's no need for two separate links for the memory of the land sites, as there is a single landing page at MapColombia.
- [ ] Render new Flesh (`FLESH_MAT_V3_5.2.blend`) and Paint (`PAINT_MAT_5.2.blend`) shader versions for the site. Current site images are Flesh v4 (2024, `Flesh/Renders/renders_v4/`) and Paint 2021 (`Paint/renders/`). Render from `marketing/blender/scenes/FLESH_GALLERY_take.blend` and `PAINT_GALLERY_take.blend` (see `Blender_Material_Projects/marketing/README.md`), or copy existing gallery output from the Windows machine (`marketing/video/public/{flesh,paint}/gallery/`). Then replace `assets-src/thumbnails/3d-assets/{fleshThumb,paintThumb}.png` and `flesh_details/`, `paint_details/`, and regenerate the optimized variants.
