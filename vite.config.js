import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// During `npm run dev`, Vite serves the client and forwards API + SD bridge
// calls to the local Node proxy (server/proxy.js) so the API key and OSC
// socket never live in the browser.
const PROXY_PORT = process.env.PROXY_PORT || 8787;

export default defineConfig({
  root: '.',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': `http://localhost:${PROXY_PORT}`,
      '/sd': `http://localhost:${PROXY_PORT}`,
      '/img': `http://localhost:${PROXY_PORT}`
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Multi-page: the main gallery (index.html) plus the isolated Scan Room
    // experiment (scan.html). Keeping scan.html as a separate entry means the
    // production gallery bundle is unaffected.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        scan: resolve(__dirname, 'scan.html')
      }
    }
  }
});
