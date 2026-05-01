import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    // The AlphaTab web worker (alphaTab.worker.min.mjs) imports alphaTab.core.mjs
    // at runtime relative to its own URL. Copy the minified core alongside the
    // worker so the import resolves in both dev and production.
    {
      name: 'copy-alphatab-core',
      async buildStart() {
        const src = resolve('./node_modules/@coderline/alphatab/dist/alphaTab.core.min.mjs');
        const dest = resolve('./public/alphaTab.core.mjs');
        await copyFile(src, dest);
      },
    },
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          osmd: ['opensheetmusicdisplay'],
          pdf: ['jspdf', 'jszip'],
          alphatab: ['@coderline/alphatab'],
        },
      },
    },
  },
  // Prevent Vite from trying to bundle the alphaTab web worker — it is served
  // as a static asset from public/alphaTab.worker.min.mjs.
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },
});
