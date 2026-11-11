import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// shown in the corner of the menu so it is obvious which version a server is running
let sha = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? '';
try { sha ||= execSync('git rev-parse --short HEAD').toString().trim(); } catch { sha ||= 'dev'; }
const BUILD = `${new Date().toISOString().slice(0, 10)} · ${sha}`;

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  root: 'client',
  build: { outDir: '../dist/client', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
