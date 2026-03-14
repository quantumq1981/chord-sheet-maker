/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/chord-sheet-maker/',
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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/converters/**', 'src/parsers/**', 'src/ingest/**', 'src/models/**'],
    },
  },
});
