import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import { facadeToolPlugin } from './scripts/photos/devPlugin.ts';

export default defineConfig({
  plugins: [glsl(), facadeToolPlugin()],
  server: {
    port: 5173,
    // The account API (backend/, FastAPI on :8000) is reached through /api so it shares the game's origin.
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: { target: 'es2022' },
});
