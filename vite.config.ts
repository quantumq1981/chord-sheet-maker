import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react(),
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
