import { defineConfig } from 'vite'

export default defineConfig({
  // Base path for GitHub Pages deployment
  // For user site (username.github.io), use '/'
  base: '/',

  // Tell Vite to treat .spz files as static assets (hash them in production builds).
  // Without this, Vite ignores unknown extensions and import.meta.glob won't resolve them.
  assetsInclude: ['**/*.spz'],

  // Development server settings
  server: {
    open: true, // Auto-open browser on npm run dev
  },

  // Build output settings
  build: {
    outDir: 'dist',
  },
})
