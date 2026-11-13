import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { apiPlugin } from './dev/apiPlugin.ts';

/**
 * NW_REMOTE_PREVIEW=1 — the site is being shown through a tunnel or a remote
 * preview (another device, a cloud workspace): accept any host name.
 * Leave it off for normal local work.
 */
const remote = process.env.NW_REMOTE_PREVIEW === '1';

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
    allowedHosts: remote ? true : undefined,
  },
  preview: {
    port: 4173,
    host: remote ? true : undefined,
    allowedHosts: remote ? true : undefined,
  },
  test: {
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
  },
});
