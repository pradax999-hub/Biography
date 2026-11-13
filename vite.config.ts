import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { apiPlugin } from './dev/apiPlugin.ts';

export default defineConfig({
  plugins: [react(), apiPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    // keep every font a real file: inlined data: fonts would need a looser Content-Security-Policy
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
  },
});
