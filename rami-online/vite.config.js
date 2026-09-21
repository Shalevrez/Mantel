import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single source of truth for the version: package.json.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    // Baked into the bundle at build time and shown in the app's corner.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // During `npm run dev`, forward /api to a locally-running `wrangler dev`
    // (run `npx wrangler dev` in another terminal). Not needed for production.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
