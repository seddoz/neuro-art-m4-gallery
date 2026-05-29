# Neuro Art - Milestone 4: Unified Three.js Gallery

Single shareable 3D gallery over the full AHG36 stock with session filters,
depth / "enter painting" animation, manual Stream Diffusion controls, and an
Environment-vs-Painting toggle. Scope authority: `../M4_SCOPE_LOCKED.md`.
Decisions and discovery: `../M4_DISCOVERY.md`.

## Architecture

```
Browser (Three.js)
  |  /api/*   -> Node proxy (server/proxy.js) -> AHG36 API  (X-API-Key server-side)
  |  /sd      -> Node proxy -> OSC UDP -> TouchDesigner (127.0.0.1:4035)  [operator/LAN]
  |  /        -> static dist/ in production
```

- The browser never holds the API key. The full-stock list endpoint
  (`get-products`) requires `X-API-Key`; single-product reads are public.
- Stream Diffusion runs locally in TouchDesigner on the operator PC. Slider
  values are sent as OSC. When the bridge is offline the sliders still drive a
  local visual "look" (graceful fallback).

## Prerequisites

- Node.js 18+ (the proxy uses only built-in modules; the client uses Vite + three).

## Setup

```bash
cd web
cp .env.example .env       # set AHG36_API_KEY for full stock; SD_OSC_* for the bridge
npm install
```

## Run (development)

Two processes:

```bash
npm run proxy             # terminal 1: API proxy + SD bridge on :8787
npm run dev               # terminal 2: Vite dev server on :5173 (proxies /api and /sd)
```

Open http://localhost:5173. Without an API key the gallery loads mock data plus
live single-product data for the acceptance IDs (282910, 282953, 282966).

## Build + serve (production / staging)

```bash
npm run build             # outputs dist/
npm run proxy             # serves dist/ and proxies /api + /sd on :8787
```

Point the staging subdomain (e.g. `staging.ahg36.com`) at the proxy, or serve
`dist/` from any static host and run the proxy separately for `/api` and `/sd`.

## Controls

- Drag to look, scroll to zoom, click a painting to select.
- Mode toggle (top bar): Environment manipulates the 3D space; Painting
  manipulates the selected work.
- SD sliders: Steps/t_list, Guidance scale, Delta, Seed.
- Animation On/Off and Enter painting on the selected work.

## Deployment notes

See `../M4_ACCEPTANCE.md` for the sign-off checklist and `../M4_DISCOVERY.md`
for the hosting/SD decisions.
