// Scan Room - renders a Scaniverse scan of a physical gallery room and overlays
// the live AHG36 stock for that room as clickable pins. Clicking a pin shows the
// same stock metadata as the main gallery.
//
// The scan ("Scaniverse 2026-06-25 ...ply") is a colored POINT CLOUD
// (x,y,z + r,g,b), not a Gaussian splat, so it renders natively with three's
// PLYLoader + THREE.Points - no GPU splat pipeline required.
//
// Pin positions ("anchors") can be set three ways:
//   1. Manually: Place mode -> click where a work hangs in the scan.
//   2. Imported: a splat_analyzer interactions.json (box centers become anchors).
//   3. Saved: previously saved anchors (localStorage / room1.hotspots.json).
//
// This page is intentionally isolated from index.html so the production gallery
// is untouched; reverting the experiment never affects the main app.

import './style.css';
import './scanroom.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { fetchAllPaintings, applyFilters, buildFacets } from './api.js';

const params = new URLSearchParams(location.search);
const SCAN_URL = params.get('scan') || '/scans/room1.ply';
const HOTSPOTS_URL = params.get('hotspots') || '/scans/room1.hotspots.json';
const DEFAULT_LOCATION = params.get('location') || 'Room 1';

const el = (id) => document.getElementById(id);
const imgProxy = (url) => (url && /(^|\.)ahg36\.com\//.test(url) ? `/img?url=${encodeURIComponent(url)}` : url || '');

// ------------------------------------------------------------------ renderer
const canvas = el('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0f);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Group holds the cloud + pins so an up-axis flip rotates everything together
// and saved anchors (stored in group-local space) stay attached.
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);

const state = {
  points: null,
  radius: 1,
  pointSize: 0.012,
  upFlip: 0, // index into UP_ROTATIONS
  all: [],
  roomStock: [],
  pins: new Map(), // id -> { painting, sprite, anchored }
  detectionBoxes: [], // imported splat_analyzer boxes (THREE.Box3 in local space)
  selectedId: null,
  placeMode: false,
  location: DEFAULT_LOCATION
};

const UP_ROTATIONS = [0, -Math.PI / 2, Math.PI / 2, Math.PI];

// ------------------------------------------------------------------ pin textures
const PIN_TEX = {};
function pinTexture(kind) {
  if (PIN_TEX[kind]) return PIN_TEX[kind];
  const s = 96;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const fill = kind === 'active' ? '#6ee7b7' : kind === 'unplaced' ? '#7c83ff' : '#e8e8f0';
  const ring = kind === 'active' ? '#07120d' : '#0a0a0f';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = s * 0.08;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  PIN_TEX[kind] = tex;
  return tex;
}

function makePin() {
  const mat = new THREE.SpriteMaterial({ map: pinTexture('idle'), depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const sc = Math.max(0.08, state.radius * 0.05);
  sprite.scale.set(sc, sc, sc);
  sprite.renderOrder = 10;
  return sprite;
}

function setPinKind(sprite, kind) {
  sprite.material.map = pinTexture(kind);
  sprite.material.needsUpdate = true;
}

// ------------------------------------------------------------------ load scan
const loader = new PLYLoader();
loader.load(
  SCAN_URL,
  (geometry) => {
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.boundingBox.getSize(size);
    geometry.translate(-center.x, -center.y, -center.z); // center at origin

    const hasColor = !!geometry.getAttribute('color');
    const material = new THREE.PointsMaterial({
      size: state.pointSize,
      sizeAttenuation: true,
      vertexColors: hasColor
    });
    if (!hasColor) material.color.set(0x9aa0b0);

    state.points = new THREE.Points(geometry, material);
    state.radius = Math.max(0.001, size.length() / 2);
    cloudGroup.add(state.points);

    applyUpFlip();
    resetView();
    el('loading').classList.add('hidden');
    initStock();
  },
  (evt) => {
    if (evt.lengthComputable) {
      const pct = Math.round((evt.loaded / evt.total) * 100);
      el('loading').querySelector('.loading-text').textContent = `Loading scanned room… ${pct}%`;
    }
  },
  (err) => {
    console.error('[scanroom] PLY load failed:', err);
    el('loading').querySelector('.loading-text').textContent = 'Could not load the scan file.';
  }
);

function applyUpFlip() {
  cloudGroup.rotation.set(UP_ROTATIONS[state.upFlip], 0, 0);
}

function resetView() {
  const r = state.radius;
  controls.minDistance = r * 0.05;
  controls.maxDistance = r * 8;
  camera.near = Math.max(0.001, r * 0.002);
  camera.far = r * 40;
  camera.updateProjectionMatrix();
  camera.position.set(0, r * 0.25, r * 2.4);
  controls.target.set(0, 0, 0);
  controls.update();
}

// ------------------------------------------------------------------ stock
async function initStock() {
  const { paintings, source } = await fetchAllPaintings({
    onProgress: (n) => (el('stock-count').textContent = `Loading stock… ${n}`)
  });
  state.all = paintings;
  el('stock-source').textContent = source === 'api' ? 'Live AHG36 stock' : 'Offline sample data (no API key)';

  // Build a location dropdown from real data; default to the requested room if
  // it exists, otherwise fall back to "All" so the page is never empty.
  const facets = buildFacets(paintings);
  const sel = el('loc-select');
  sel.innerHTML = '';
  const known = facets.location || ['All'];
  for (const loc of known) {
    const o = document.createElement('option');
    o.value = loc;
    o.textContent = loc;
    sel.appendChild(o);
  }
  state.location = known.includes(DEFAULT_LOCATION) ? DEFAULT_LOCATION : 'All';
  sel.value = state.location;
  sel.addEventListener('change', () => {
    state.location = sel.value;
    buildRoom();
  });

  buildRoom();
}

function currentRoomStock() {
  if (state.location === 'All') return state.all;
  return applyFilters(state.all, { location: state.location });
}

function buildRoom() {
  // Clear old pins
  for (const { sprite } of state.pins.values()) cloudGroup.remove(sprite);
  state.pins.clear();
  state.selectedId = null;
  hideInfo();

  state.roomStock = currentRoomStock();
  const saved = loadAnchors();

  // Auto-arrange the unplaced pins in a gentle arc so they are visible/clickable
  // before anyone anchors them precisely.
  const r = state.radius;
  let autoIdx = 0;
  const unplacedCount = state.roomStock.filter((p) => !saved[String(p.id)]).length;

  for (const p of state.roomStock) {
    const sprite = makePin();
    const key = String(p.id);
    const anchor = saved[key];
    if (anchor) {
      sprite.position.fromArray(anchor);
    } else {
      const t = unplacedCount > 1 ? autoIdx / (unplacedCount - 1) - 0.5 : 0;
      autoIdx += 1;
      sprite.position.set(t * r * 1.2, 0, -r * 0.35);
      sprite.userData.unplaced = true;
      setPinKind(sprite, 'unplaced');
    }
    sprite.userData.id = key;
    cloudGroup.add(sprite);
    state.pins.set(key, { painting: p, sprite, anchored: !!anchor });
  }

  renderList();
  updateCounts();
}

function updateCounts() {
  const n = state.roomStock.length;
  const placed = [...state.pins.values()].filter((x) => x.anchored).length;
  el('stock-count').textContent = `${n} work${n === 1 ? '' : 's'} in "${state.location}"`;
  el('anchor-count').textContent = `${placed}/${n} anchored`;
}

// ------------------------------------------------------------------ list panel
function renderList() {
  const list = el('paint-list');
  list.innerHTML = '';
  if (!state.roomStock.length) {
    list.innerHTML = '<div class="hint muted">No stock for this location yet.</div>';
    return;
  }
  for (const p of state.roomStock) {
    const item = document.createElement('div');
    item.className = 'paint-item';
    item.dataset.id = String(p.id);
    const anchored = state.pins.get(String(p.id))?.anchored;
    item.innerHTML = `
      <img loading="lazy" src="${imgProxy(p.photo)}" alt="" />
      <div class="pi-text">
        <div class="pi-title">${escapeHtml(p.title || '(untitled)')}</div>
        <div class="pi-sub">${escapeHtml(p.artist || '')} · #${p.id}</div>
      </div>
      <span class="pi-pin ${anchored ? 'set' : ''}">${anchored ? '\u25cf' : '\u25cb'}</span>`;
    item.addEventListener('click', () => selectPainting(String(p.id), true));
    list.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ------------------------------------------------------------------ selection
function selectPainting(id, focus) {
  state.selectedId = id;
  for (const [pid, { sprite, anchored }] of state.pins) {
    const active = pid === id;
    setPinKind(sprite, active ? 'active' : anchored ? 'idle' : 'unplaced');
    sprite.scale.setScalar((active ? 1.5 : 1) * Math.max(0.08, state.radius * 0.05));
  }
  for (const it of document.querySelectorAll('.paint-item')) {
    it.classList.toggle('active', it.dataset.id === id);
  }
  const entry = state.pins.get(id);
  if (entry) showInfo(entry.painting);
  if (focus && entry && entry.anchored) {
    const target = entry.sprite.getWorldPosition(new THREE.Vector3());
    tweenTarget(target);
  }
}

function showInfo(p) {
  el('info-card').classList.remove('hidden');
  el('info-img').src = imgProxy(p.photo);
  el('info-title').textContent = p.title || '(untitled)';
  el('info-artist').textContent = p.artist || '';
  const rows = [
    ['ID', p.id],
    ['Dimensions', p.widthCm && p.heightCm ? `${p.widthCm} × ${p.heightCm} cm` : ''],
    ['Technique', p.technique],
    ['Year', p.year],
    ['Collection', p.collection],
    ['Category', p.category],
    ['Location', p.location],
    ['Price', p.priceEur != null ? `€${p.priceEur}` : ''],
    ['Status', p.status]
  ].filter(([, v]) => v !== '' && v != null);
  el('info-meta').innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('');
}

function hideInfo() {
  el('info-card').classList.add('hidden');
}

// ------------------------------------------------------------------ anchors I/O
function anchorKey() {
  return `scanroom:anchors:${state.location}`;
}

function loadAnchors() {
  try {
    const raw = localStorage.getItem(anchorKey());
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { ...(externalAnchors[state.location] || externalAnchors.__all || {}) };
}

function saveAnchorsToStorage() {
  const out = {};
  for (const [id, { sprite, anchored }] of state.pins) {
    if (anchored) out[id] = sprite.position.toArray().map((n) => +n.toFixed(4));
  }
  try {
    localStorage.setItem(anchorKey(), JSON.stringify(out));
  } catch { /* ignore */ }
  return out;
}

let externalAnchors = {};
fetch(HOTSPOTS_URL)
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    if (j && j.anchors) externalAnchors = j.anchors;
  })
  .catch(() => { /* optional file */ });

function downloadAnchors() {
  const out = saveAnchorsToStorage();
  const payload = {
    location: state.location,
    scan: SCAN_URL,
    generator: 'scanroom-manual',
    updated: new Date().toISOString(),
    anchors: { [state.location]: out }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'room1.hotspots.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Import a splat_analyzer interactions.json: each detected object's box center
// becomes a snap target drawn as a wireframe box. In Place mode, click a box to
// anchor the currently selected painting to that detection.
function importDetections(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(String(reader.result));
    } catch {
      alert('Could not parse interactions.json');
      return;
    }
    const objects = data.objects || data;
    if (!Array.isArray(objects)) {
      alert('Unexpected interactions.json format (expected an "objects" array).');
      return;
    }
    for (const b of state.detectionBoxes) cloudGroup.remove(b.helper);
    state.detectionBoxes = [];
    for (const o of objects) {
      const pos = o.position || {};
      const sz = o.size || {};
      const center = new THREE.Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
      const size = new THREE.Vector3(sz.x || 0.3, sz.y || 0.3, sz.z || 0.3);
      const box = new THREE.Box3().setFromCenterAndSize(center, size);
      const helper = new THREE.Box3Helper(box, 0x6ee7b7);
      helper.userData.center = center.clone();
      helper.userData.label = o.label || 'object';
      cloudGroup.add(helper);
      state.detectionBoxes.push({ box, helper, center });
    }
    el('anchor-count').textContent = `${objects.length} detections imported - Place mode: click a box to assign`;
  };
  reader.readAsText(file);
}

// ------------------------------------------------------------------ picking
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPt = null;

function pinSprites() {
  return [...state.pins.values()].map((x) => x.sprite);
}

function pickPin(cx, cy) {
  pointer.x = (cx / innerWidth) * 2 - 1;
  pointer.y = -(cy / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pinSprites(), false);
  return hits.length ? hits[0].object.userData.id : null;
}

function pickScanPoint(cx, cy) {
  if (!state.points) return null;
  pointer.x = (cx / innerWidth) * 2 - 1;
  pointer.y = -(cy / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  raycaster.params.Points.threshold = Math.max(state.pointSize * 2, state.radius * 0.01);
  const hits = raycaster.intersectObject(state.points, false);
  return hits.length ? hits[0].point.clone() : null;
}

function pickDetectionCenter(cx, cy) {
  if (!state.detectionBoxes.length) return null;
  pointer.x = (cx / innerWidth) * 2 - 1;
  pointer.y = -(cy / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const helpers = state.detectionBoxes.map((d) => d.helper);
  const hits = raycaster.intersectObjects(helpers, false);
  if (!hits.length) return null;
  const center = hits[0].object.userData.center;
  return center ? center.clone() : null;
}

function anchorSelectedAt(localPoint) {
  if (!state.selectedId) {
    el('anchor-count').textContent = 'Select a painting first, then click to anchor it.';
    return;
  }
  const entry = state.pins.get(state.selectedId);
  if (!entry) return;
  entry.sprite.position.copy(localPoint);
  entry.sprite.userData.unplaced = false;
  entry.anchored = true;
  setPinKind(entry.sprite, 'active');
  saveAnchorsToStorage();
  renderList();
  updateCounts();
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPt) return;
  const moved = Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y);
  const dt = performance.now() - downPt.t;
  downPt = null;
  if (moved > 6 || dt > 400) return; // drag, not a click

  if (state.placeMode) {
    // Prefer snapping to an imported detection box; else use the raw scan point.
    const det = pickDetectionCenter(e.clientX, e.clientY);
    const local = det ? cloudGroup.worldToLocal(det.clone()) : worldClickToLocal(e.clientX, e.clientY);
    if (local) anchorSelectedAt(local);
    return;
  }

  const id = pickPin(e.clientX, e.clientY);
  if (id) selectPainting(id, false);
});

function worldClickToLocal(cx, cy) {
  const world = pickScanPoint(cx, cy);
  if (!world) return null;
  return cloudGroup.worldToLocal(world.clone());
}

// hover tooltip
const tooltip = el('tooltip');
renderer.domElement.addEventListener('pointermove', (e) => {
  if (state.placeMode) {
    tooltip.classList.add('hidden');
    return;
  }
  const id = pickPin(e.clientX, e.clientY);
  if (id) {
    const p = state.pins.get(id).painting;
    tooltip.textContent = `${p.title || '(untitled)'} - ${p.artist || ''}`;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove('hidden');
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.classList.add('hidden');
    canvas.style.cursor = '';
  }
});

// ------------------------------------------------------------------ camera focus tween
let tween = null;
function tweenTarget(toTarget) {
  const offset = camera.position.clone().sub(controls.target);
  tween = {
    fromT: controls.target.clone(),
    toT: toTarget.clone(),
    fromP: camera.position.clone(),
    toP: toTarget.clone().add(offset.multiplyScalar(0.6)),
    t: 0
  };
}

// ------------------------------------------------------------------ controls UI
el('panel-btn').addEventListener('click', () => el('panel').classList.toggle('hidden'));
el('info-close').addEventListener('click', hideInfo);

el('s-point').addEventListener('input', (e) => {
  state.pointSize = parseFloat(e.target.value);
  el('o-point').textContent = state.pointSize.toFixed(3);
  if (state.points) state.points.material.size = state.pointSize;
});

el('flip-up').addEventListener('click', () => {
  state.upFlip = (state.upFlip + 1) % UP_ROTATIONS.length;
  applyUpFlip();
});

el('reset-view').addEventListener('click', resetView);

el('place-mode').addEventListener('click', () => {
  state.placeMode = !state.placeMode;
  el('place-mode').textContent = `Place mode: ${state.placeMode ? 'On' : 'Off'}`;
  el('place-mode').classList.toggle('active', state.placeMode);
  canvas.classList.toggle('placing', state.placeMode);
});

el('save-anchors').addEventListener('click', downloadAnchors);

el('clear-anchors').addEventListener('click', () => {
  try {
    localStorage.removeItem(anchorKey());
  } catch { /* ignore */ }
  buildRoom();
});

el('import-detections').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) importDetections(f);
});

// keyboard fly (matches the gallery's WASD/Q-E feel)
const keys = new Set();
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
addEventListener('keydown', (e) => {
  if (!MOVE_KEYS.has(e.code)) return;
  const t = document.activeElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const _dir = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _strafe = new THREE.Vector3();
function applyMove(dt) {
  if (!keys.size || tween) return;
  const speed = state.radius * 0.8 * dt;
  _dir.set(0, 0, 0);
  camera.getWorldDirection(_flat);
  _flat.y = 0;
  if (_flat.lengthSq() > 1e-6) _flat.normalize();
  _strafe.crossVectors(_flat, THREE.Object3D.DEFAULT_UP).normalize();
  if (keys.has('KeyW')) _dir.add(_flat);
  if (keys.has('KeyS')) _dir.sub(_flat);
  if (keys.has('KeyD')) _dir.add(_strafe);
  if (keys.has('KeyA')) _dir.sub(_strafe);
  if (keys.has('KeyQ')) _dir.y += 1;
  if (keys.has('KeyE')) _dir.y -= 1;
  if (_dir.lengthSq() === 0) return;
  _dir.normalize().multiplyScalar(speed);
  camera.position.add(_dir);
  controls.target.add(_dir);
}

// ------------------------------------------------------------------ loop
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.7);
    const e = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2;
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.lerpVectors(tween.fromP, tween.toP, e);
    if (tween.t >= 1) tween = null;
  } else {
    applyMove(dt);
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();
