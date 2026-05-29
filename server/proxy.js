// Neuro Art M4 - backend proxy + Stream Diffusion bridge + static server.
// Built only on Node core modules so it runs with `node server/proxy.js`
// without an npm install.
//
// Responsibilities:
//  1. /api/products  -> proxy AHG36 get-products, injecting X-API-Key
//                       (the key never reaches the browser).
//  2. /api/product/:id -> proxy AHG36 get-product (public; key optional).
//  3. POST /sd       -> forward manual SD slider values to TouchDesigner
//                       as OSC over UDP (operator/LAN bridge, see M4_DISCOVERY.md).
//  4. static dist/   -> serve the built client in production.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendOsc } from './osc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- lightweight .env loader (no dependency) ---
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const PORT = Number(process.env.PROXY_PORT || 8787);
const API_BASE = process.env.AHG36_API_BASE || 'https://www.ahg36.com/wpactions';
const API_KEY = process.env.AHG36_API_KEY || '';
const SD_HOST = process.env.SD_OSC_HOST || '127.0.0.1';
const SD_PORT = Number(process.env.SD_OSC_PORT || 4035);
const DIST = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.map': 'application/json'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

// Forward a GET to the AHG36 API. Adds X-API-Key when present.
function proxyApi(targetUrl, res) {
  const headers = { Accept: 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;

  const req = https.get(targetUrl, { headers, timeout: 20000 }, (upstream) => {
    let data = '';
    upstream.setEncoding('utf8');
    upstream.on('data', (c) => (data += c));
    upstream.on('end', () => {
      res.writeHead(upstream.statusCode || 502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
  });
  req.on('timeout', () => req.destroy(new Error('upstream timeout')));
  req.on('error', (err) => sendJson(res, 502, { error: 'upstream_error', detail: err.message }));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA fallback to index.html
      fs.readFile(path.join(DIST, 'index.html'), (e2, idx) => {
        if (e2) return sendJson(res, 404, { error: 'not_found' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(idx);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  // 1. full-stock list (needs key)
  if (p === '/api/products') {
    const qs = url.search || '';
    return proxyApi(`${API_BASE}/get-products/${qs}`, res);
  }

  // 2. single product (public)
  const single = p.match(/^\/api\/product\/(\d+)$/);
  if (single) {
    return proxyApi(`${API_BASE}/get-product/?id=${single[1]}`, res);
  }

  // 3. Stream Diffusion bridge
  if (p === '/sd' && req.method === 'POST') {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { error: 'bad_json' });
    }
    const { address, args } = payload;
    if (typeof address !== 'string' || !Array.isArray(args)) {
      return sendJson(res, 400, { error: 'address_and_args_required' });
    }
    return sendOsc(SD_HOST, SD_PORT, address, args, (err) => {
      if (err) return sendJson(res, 502, { ok: false, error: err.message });
      sendJson(res, 200, { ok: true, host: SD_HOST, port: SD_PORT, address });
    });
  }

  // image proxy: stream remote ahg36 images same-origin so WebGL textures are
  // not blocked by missing CORS headers on the image host.
  if (p === '/img') {
    const target = url.searchParams.get('url');
    if (!target) return sendJson(res, 400, { error: 'url_required' });
    let u;
    try {
      u = new URL(target);
    } catch {
      return sendJson(res, 400, { error: 'bad_url' });
    }
    if (!/(^|\.)ahg36\.com$/.test(u.hostname)) {
      return sendJson(res, 403, { error: 'host_not_allowed' });
    }
    https
      .get(target, { timeout: 20000 }, (up) => {
        res.writeHead(up.statusCode || 502, {
          'Content-Type': up.headers['content-type'] || 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400'
        });
        up.pipe(res);
      })
      .on('error', (e) => sendJson(res, 502, { error: e.message }));
    return;
  }

  // health
  if (p === '/sd/health') {
    return sendJson(res, 200, { ok: true, sd: { host: SD_HOST, port: SD_PORT }, hasKey: Boolean(API_KEY) });
  }

  // 4. static (production build)
  if (fs.existsSync(DIST)) return serveStatic(req, res, p);

  sendJson(res, 404, { error: 'not_found', hint: 'run vite dev for the client, or build to dist/' });
});

server.listen(PORT, () => {
  console.log(`[proxy] listening on http://localhost:${PORT}`);
  console.log(`[proxy] API base: ${API_BASE} (key ${API_KEY ? 'set' : 'MISSING - list endpoint will 401'})`);
  console.log(`[proxy] SD OSC -> ${SD_HOST}:${SD_PORT}`);
});
