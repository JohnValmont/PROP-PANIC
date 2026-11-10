import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist/client', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
