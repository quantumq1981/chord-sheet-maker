import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative asset paths so the app works on both user/organization
  // pages (https://<user>.github.io/) and project pages subpaths.
  base: './',
  plugins: [react()],
  build: {
    // Target modern browsers only — avoids unnecessary transpilation and
    // keeps the output smaller and faster.
    target: 'esnext',
    rollupOptions: {
      output: {
        // Split large dependencies into separate chunks so the browser can
        // cache them independently and the initial bundle stays lean.
        manualChunks: {
          react: ['react', 'react-dom'],
          osmd: ['opensheetmusicdisplay'],
          pdf: ['jspdf', 'jszip'],
        },
      },
    },
  },
});
