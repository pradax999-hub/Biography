import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { apiPlugin } from './dev/apiPlugin.ts';

export default defineConfig({
  plugins: [react(), apiPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
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
