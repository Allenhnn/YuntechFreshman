import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import { facadeToolPlugin } from './scripts/photos/devPlugin.ts';

export default defineConfig({
  plugins: [glsl(), facadeToolPlugin()],
  server: { port: 5173 },
  build: { target: 'es2022' },
});
