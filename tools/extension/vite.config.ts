import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  // crx() return type lags behind Vite's PluginOption in the beta release;
  // cast to silence the structural mismatch until crxjs ships a stable release.
  plugins: [react(), crx({ manifest }) as unknown as PluginOption],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen/index.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
