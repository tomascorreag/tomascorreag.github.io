import { defineConfig } from 'vite'

export default defineConfig({
  // Base path for GitHub Pages deployment
  // For user site (username.github.io), use '/'
  base: '/',

  // Development server settings
  server: {
    open: true, // Auto-open browser on npm run dev
  },

  // Build output settings
  build: {
    outDir: 'dist',
  },
})
