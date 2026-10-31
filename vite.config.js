import { defineConfig } from 'vite';

export default defineConfig({
  root: 'viewer',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
