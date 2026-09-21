import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
