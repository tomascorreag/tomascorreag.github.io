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
    target: 'es2020',
    minify: 'esbuild',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Split Three.js + Spark into a named chunk. They're only imported from
        // the dynamically-loaded SplatViewer module, so this stays off the
        // initial bundle — naming just makes the chunk greppable in dist/.
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/@sparkjsdev')) {
            return 'splat-viewer-deps';
          }
        },
      },
    },
  },
})
