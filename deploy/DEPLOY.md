# M4 Staging Deployment Guide

Target: a shareable HTTPS URL on `staging.ahg36.com` (per `../../M4_SCOPE_LOCKED.md`).
This guide is executed once Bart provides host/DNS access (the one remaining
external dependency). Everything else for M4 is built and verified locally.

## What gets deployed

- `dist/` (Vite build) - the static Three.js client.
- `server/proxy.js` - Node process that injects the AHG36 API key for the
  full-stock list and bridges SD slider values to TouchDesigner over OSC.

## Steps

1. DNS: add `staging.ahg36.com` A record to the web server.
2. Copy the project to the server, e.g. `/home/admin/web/ahg36.com/m4-gallery`.
3. Configure secrets:
   ```bash
   cd m4-gallery
   cp .env.example .env
   # set AHG36_API_KEY (from Bart / AHG36 dev), keep SD_OSC_* for the operator PC
   npm install
   npm run build
   ```
4. Run the proxy as a service (systemd example):
   ```ini
   # /etc/systemd/system/m4-proxy.service
   [Unit]
   Description=Neuro Art M4 proxy
   After=network.target
   [Service]
   WorkingDirectory=/home/admin/web/ahg36.com/m4-gallery
   Environment=PROXY_PORT=8787
   ExecStart=/usr/bin/node server/proxy.js
   Restart=always
   User=admin
   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl enable --now m4-proxy
   ```
5. Nginx: install `nginx.staging.conf`, then enable TLS:
   ```bash
   sudo ln -s /etc/nginx/sites-available/staging.ahg36.com /etc/nginx/sites-enabled/
   sudo certbot --nginx -d staging.ahg36.com
   sudo nginx -t && sudo systemctl reload nginx
   ```
6. Verify:
   - `https://staging.ahg36.com` loads the gallery from a device NOT on the LAN.
   - `https://staging.ahg36.com/api/product/282910` returns JSON.
   - Filters return full stock (requires AHG36_API_KEY set).

## Stream Diffusion coupling on staging

SD runs on the operator PC. For acceptance (Bart on his PC via UltraViewer),
run `server/proxy.js` locally on that PC with `SD_OSC_HOST=127.0.0.1` so the
sliders reach TouchDesigner on `4035`. To let the public staging URL drive SD,
expose the operator bridge through a secured tunnel and point the staging proxy
at it (see Mode B in `../../M4_DISCOVERY.md`). Default acceptance does not
require public SD control.

## Embedding option (if Bart prefers WordPress over a subdomain)

Build `dist/` and embed via an iframe/shortcode on an ahg36.com page. The
`/api` and `/sd` paths must still reach the Node proxy (same-origin or CORS).
This changes only hosting, not the app.
