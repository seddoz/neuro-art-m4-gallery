import { defineConfig } from 'vite';

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
      '/sd': `http://localhost:${PROXY_PORT}`
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
