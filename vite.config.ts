import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// shown in the corner of the menu so it is obvious which version a server is running
let sha = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? '';
try { sha ||= execSync('git rev-parse --short HEAD').toString().trim(); } catch { sha ||= 'dev'; }
const BUILD = `${new Date().toISOString().slice(0, 10)} · ${sha}`;

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  root: 'client',
  // practice mode runs the server's room in the browser (client/src/practice): stand-ins for its two Node-only imports
  resolve: {
    alias: [
      { find: 'node:crypto', replacement: fileURLToPath(new URL('./client/src/practice/shims.ts', import.meta.url)) },
      { find: /^\.\/stats$/, replacement: fileURLToPath(new URL('./client/src/practice/stats.ts', import.meta.url)) },
    ],
  },
  worker: { format: 'es' },
  build: { outDir: '../dist/client', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true }, '/status': 'http://localhost:8080', '/health': 'http://localhost:8080', '/api': 'http://localhost:8080' },
  },
});
