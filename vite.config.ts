import { defineConfig } from 'vitest/config';

// Vite serves index.html at the repo root and bundles src/main.ts.
// Vitest reuses this config; pure-logic tests run in a node environment
// (no DOM, no WebGL) so the simulation core stays testable in isolation.
export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
