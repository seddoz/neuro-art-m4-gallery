import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Gallery } from './gallery.js';
import { MIRROR_LAYER } from './mirrors.js';
import { CollectionSphere } from './sphere.js';
import { SDController } from './sd.js';
import { UI } from './ui.js';
import { fetchAllPaintings, fetchPainting, fetchAuthors, buildFacets, applyFilters } from './api.js';
import { CONFIG, layoutPageSize } from './config.js';
import { applyMobileProfile } from './device.js';
import { LensFlareOverlay } from './lensflare.js';
import { MarchingCubesEffect } from './marchingcubes.js';

const mobile = applyMobileProfile();
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: mobile.antialias });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile.pixelRatioMax));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const SCENE_BG = CONFIG.SCENE_BG;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SCENE_BG);

// Screen-space lens flare overlay (drawn after the scene each frame). The flare
// shines from the selected painting (or the pointer in Follow Mouse mode).
const lensFlare = new LensFlareOverlay();
lensFlare.setResolution(renderer.domElement.width, renderer.domElement.height);

// Marching Cubes (metaball) effect for the selected painting. One shared
// instance; only the selected work with its toggle on ever shows it.
const marching = new MarchingCubesEffect({ mobile: mobile.active });
marching.ensure(scene);
// No fog — keeps the void pure black like the reference gallery view.

// Tight near/far range keeps depth-buffer precision high so distant paintings
// stay crisp and do not z-fight with their frames.
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.25, 160);
camera.layers.enable(MIRROR_LAYER);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// Full vertical orbit: look straight down from above and straight up at ceiling.
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI - 0.05;

controls.addEventListener('start', () => {
  if (stateApp.view === 'sphere') sphere.pauseAutoRotate();
});
controls.addEventListener('end', () => {
  if (stateApp.view === 'sphere') sphere.resumeAutoRotateAfter();
});

// WASD / arrows / Q-E fly (moves camera + orbit target together).
const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
]);
const keysDown = new Set();
const MOVE_SPEED = 4; // m/s
const _moveDir = new THREE.Vector3();
const _lookFlat = new THREE.Vector3();
const _strafe = new THREE.Vector3();

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

addEventListener('keydown', (e) => {
  if (!MOVE_KEYS.has(e.code) || isTypingTarget(document.activeElement)) return;
  keysDown.add(e.code);
  e.preventDefault();
});
addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});
addEventListener('blur', () => keysDown.clear(), true);

function applyKeyboardMove(dt) {
  if (keysDown.size === 0 || stateApp.cameraTween) return;

  const forward = keysDown.has('KeyW') || keysDown.has('ArrowUp');
  const back = keysDown.has('KeyS') || keysDown.has('ArrowDown');
  const right = keysDown.has('KeyD') || keysDown.has('ArrowRight');
  const left = keysDown.has('KeyA') || keysDown.has('ArrowLeft');
  const up = keysDown.has('KeyQ');
  const down = keysDown.has('KeyE');
  if (!(forward || back || right || left || up || down)) return;

  _moveDir.set(0, 0, 0);
  if (forward || back || right || left) {
    camera.getWorldDirection(_lookFlat);
    _lookFlat.y = 0;
    if (_lookFlat.lengthSq() > 1e-6) {
      _lookFlat.normalize();
      _strafe.crossVectors(_lookFlat, THREE.Object3D.DEFAULT_UP).normalize();
      if (forward) _moveDir.add(_lookFlat);
      if (back) _moveDir.sub(_lookFlat);
      if (right) _moveDir.add(_strafe);
      if (left) _moveDir.sub(_strafe);
      if (_moveDir.lengthSq() > 0) {
        _moveDir.normalize().multiplyScalar(MOVE_SPEED * dt);
      }
    }
  }
  if (up) _moveDir.y += MOVE_SPEED * dt;
  if (down) _moveDir.y -= MOVE_SPEED * dt;
  if (_moveDir.lengthSq() === 0) return;

  camera.position.add(_moveDir);
  controls.target.add(_moveDir);
  if (stateApp.view === 'sphere') clampCameraToSphere();
  else clampCameraToRoom();
}

function clampCameraToSphere() {
  const cy = sphere.centerY;
  const r = sphere.radius || CONFIG.SPHERE.defaultRadius;
  const half = r * 2.5;
  const minY = 0.2;
  const maxY = cy + r * 2;

  const ox = camera.position.x;
  const oy = camera.position.y;
  const oz = camera.position.z;
  const cx = THREE.MathUtils.clamp(ox, -half, half);
  const cyCam = THREE.MathUtils.clamp(oy, minY, maxY);
  const cz = THREE.MathUtils.clamp(oz, -half, half);
  const dx = cx - ox;
  const dy = cyCam - oy;
  const dz = cz - oz;
  if (dx === 0 && dy === 0 && dz === 0) return;
  camera.position.set(cx, cyCam, cz);
  controls.target.x += dx;
  controls.target.y += dy;
  controls.target.z += dz;
}

function clampCameraToRoom() {
  const dims = gallery.dims;
  if (!dims) return;
  const half = dims.wallLen / 2 - 0.6;
  const minY = 0.35;
  const maxY = (dims.height || CONFIG.WALL_HEIGHT_M) - 0.15;

  const ox = camera.position.x;
  const oy = camera.position.y;
  const oz = camera.position.z;
  const cx = THREE.MathUtils.clamp(ox, -half, half);
  const cy = THREE.MathUtils.clamp(oy, minY, maxY);
  const cz = THREE.MathUtils.clamp(oz, -half, half);
  const dx = cx - ox;
  const dy = cy - oy;
  const dz = cz - oz;
  if (dx === 0 && dy === 0 && dz === 0) return;
  camera.position.set(cx, cy, cz);
  controls.target.x += dx;
  controls.target.y += dy;
  controls.target.z += dz;
}

const gallery = new Gallery(scene);
const sphere = new CollectionSphere(scene);
const sd = new SDController();

const stateApp = {
  view: 'room',
  mode: 'environment',
  all: [],
  filtered: [],
  visible: [],
  authors: [],
  page: 0,
  selected: null,
  animating: false,
  cameraTween: null,
  layout: { ...CONFIG.LAYOUT_DEFAULT },
  mirrorOn: false,
  mirrorQuality: CONFIG.MIRROR.defaultQuality
};

// --- selection via raycast (click / double-click, not drag) ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
let lastTap = null;
const DBL_TAP_MS = 350;
const DBL_TAP_DIST = 28;

function tryEnterPainting(hit) {
  if (!hit || hit.type !== 'painting') return;
  select(hit);
  enterPainting();
}

function pickAt(clientX, clientY) {
  if (stateApp.view === 'sphere') {
    return sphere.pick(clientX, clientY, camera, raycaster, pointer);
  }
  pointer.x = (clientX / innerWidth) * 2 - 1;
  pointer.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(gallery.getPaintingMeshes(), false);
  return hits.length
    ? { type: 'painting', painting: hits[0].object.userData.painting, data: hits[0].object.userData.painting.data }
    : null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const dt = performance.now() - down.t;
  down = null;
  if (moved > 6 || dt > 400) return; // it was a drag

  const hit = pickAt(e.clientX, e.clientY);

  // Double-tap enter (touch / pen — desktop uses dblclick).
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    const now = performance.now();
    if (lastTap && now - lastTap.t < DBL_TAP_MS
        && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DBL_TAP_DIST) {
      lastTap = null;
      tryEnterPainting(hit);
      return;
    }
    lastTap = { x: e.clientX, y: e.clientY, t: now };
  }

  if (hit) select(hit);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  if (e.pointerType === 'touch') return; // handled by double-tap above
  tryEnterPainting(pickAt(e.clientX, e.clientY));
});

function select(hit) {
  if (!hit) {
    stateApp.selected = null;
    ui.setSelected(null);
    ui.setAnimationLabel(false);
    ui.setLensFlareLabel(false);
    ui.setMarchingCubesLabel(false);
    applyLook(sd.look());
    return;
  }
  if (hit.type === 'painting') {
    stateApp.selected = hit.painting;
    // Ensure the focused work is full resolution even when background
    // auto-upgrade is off (mobile) — selecting it should always sharpen it.
    hit.painting.upgradeFullRes?.();
    ui.setSelected(hit.data);
    ui.setAnimationLabel(hit.painting.animated);
    ui.setLensFlareLabel(!!hit.painting.lensFlareOn);
    ui.setMarchingCubesLabel(!!hit.painting.mcOn);
    // Feed the selected work's texture to the "artwork" MC material preset.
    marching.setArtworkTexture(hit.painting.material.uniforms.uMap.value);
  } else {
    stateApp.selected = null;
    ui.setSelected({ title: hit.data.title, artist: hit.data.artist, id: '', widthCm: 0, heightCm: 0 });
    ui.setAnimationLabel(false);
    ui.setMarchingCubesLabel(false);
  }
  applyLook(sd.look());
}

// Orbit limits and clip planes scale with the room so large layouts stay visible.
function updateCameraForRoom(dims) {
  if (!dims) return;
  const L = dims.wallLen;
  const h = dims.height || CONFIG.WALL_HEIGHT_M;
  camera.near = 0.1;
  camera.far = Math.max(300, L * 3 + h * 2);
  camera.updateProjectionMatrix();
  controls.minDistance = 0.5;
  controls.maxDistance = Math.max(L * 0.9, 10);
}

function updateCameraForSphere() {
  const r = sphere.radius || CONFIG.SPHERE.defaultRadius;
  const cy = sphere.centerY;
  camera.near = 0.05;
  camera.far = Math.max(200, r * 10);
  camera.updateProjectionMatrix();
  controls.minDistance = 0.15;
  controls.maxDistance = r * 3.5;
  controls.enableZoom = true;
  controls.target.set(0, cy, 0);
}

function sphereView() {
  const r = sphere.radius || CONFIG.SPHERE.defaultRadius;
  const cy = sphere.centerY;
  return {
    pos: new THREE.Vector3(0, cy + r * 0.1, r * 1.4),
    target: new THREE.Vector3(0, cy, 0)
  };
}

// Default room view: back of hall, centred on X, eye at painting height, facing front wall.
function galleryView(dims = gallery.dims) {
  const L = dims?.wallLen ?? 12;
  const h = dims?.height ?? CONFIG.WALL_HEIGHT_M;
  const half = L / 2;
  const rows = stateApp.layout?.rows ?? CONFIG.LAYOUT_DEFAULT.rows;
  const eyeY = Math.min(h * 0.55, CONFIG.ROW_BASE_Y + CONFIG.ROW_STEP_Y * Math.max(0, rows - 1) * 0.5);
  const target = new THREE.Vector3(0, eyeY, -half);
  const backMargin = Math.max(CONFIG.ROOM_VIEW.backMarginMin, L * CONFIG.ROOM_VIEW.backMarginFactor);
  const pos = new THREE.Vector3(0, eyeY, half - backMargin);
  return { pos, target };
}

function applyGalleryView(dims) {
  const v = galleryView(dims);
  camera.position.copy(v.pos);
  controls.target.copy(v.target);
  controls.update();
}

// --- enter / exit camera moves ---
function enterPainting() {
  const p = stateApp.selected;
  if (!p) return;
  p.upgradeFullRes?.(); // guarantee full detail when zooming into the work
  const worldPos = new THREE.Vector3();
  p.mesh.getWorldPosition(worldPos);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.group.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p.group.quaternion);
  // Frame so the whole painting fits the visible area; shift left so the right
  // control panel does not cover it.
  const dist = Math.max(p.sizeM.w, p.sizeM.h) * 1.7 + 0.5;
  const shift = right.multiplyScalar(p.sizeM.w * 0.35);
  const camTarget = worldPos.clone().add(normal.multiplyScalar(dist)).add(shift);
  controls.minDistance = 0.1;
  tweenCamera(camTarget, worldPos.clone().add(shift));
}

function exitToGallery() {
  const p = stateApp.selected;
  if (p) {
    p.setAnimated(false);
    stateApp.animating = false;
    ui.setAnimationLabel(false);
  }
  if (stateApp.view === 'sphere') {
    updateCameraForSphere();
    const v = sphereView();
    tweenCamera(v.pos, v.target);
    return;
  }
  updateCameraForRoom(gallery.dims);
  applyGalleryView(gallery.dims);
  const v = galleryView(gallery.dims);
  tweenCamera(v.pos, v.target);
}

function tweenCamera(toPos, toTarget) {
  stateApp.cameraTween = {
    fromPos: camera.position.clone(),
    toPos,
    fromTarget: controls.target.clone(),
    toTarget,
    t: 0,
    dur: 1.0
  };
}

// --- SD look routing by mode ---
function syncSpaceBackdrop() {
  scene.background.setHex(CONFIG.SCENE_BG);
}

function sphereRoomDims(base) {
  const r = sphere.radius || CONFIG.SPHERE.defaultRadius;
  const cy = sphere.centerY;
  const needH = cy + r + 0.8;
  const needL = Math.max(base?.wallLen ?? 12, (r + 1.2) * 2.5);
  return {
    wallLen: needL,
    height: Math.max(base?.height ?? CONFIG.WALL_HEIGHT_M, needH)
  };
}

function syncMirrorFrameGlow() {
  const on = stateApp.mirrorOn;
  for (const p of gallery.paintings) p.setMirrorGlow(on);
  for (const p of sphere.paintings) p.setMirrorGlow(on);
}

function applyLook(look) {
  ui.setSdStatus(sd.bridgeOnline);
  syncSpaceBackdrop();
  syncMirrorFrameGlow();

  const paintingMode = stateApp.mode === 'painting';
  const envActive = !paintingMode;
  const mirror = stateApp.mirrorOn;

  if (mirror) {
    // Mirror on: pure black void; paintings/sphere only (no matte wall tint).
    if (stateApp.view === 'sphere') {
      sphere.applyLook(look, paintingMode, stateApp.selected);
    } else {
      for (const p of gallery.paintings) {
        p.applyLook(look, paintingMode && p === stateApp.selected);
      }
    }
    return;
  }

  // Mirror off: white matte room shell + black floor/ceiling.
  if (stateApp.view === 'sphere') {
    sphere.applyEnvironmentLook(look, envActive);
    sphere.applyLook(look, paintingMode, stateApp.selected);
  }
  gallery.applyEnvironmentLook(look, envActive);
  if (stateApp.view === 'room') {
    for (const p of gallery.paintings) {
      p.applyLook(look, paintingMode && p === stateApp.selected);
    }
  }
}

function ensureGalleryRoom() {
  if (!gallery.dims) renderPage(false);
  else {
    gallery.setMirrorEnabled(stateApp.mirrorOn);
    gallery.setMirrorQuality(stateApp.mirrorQuality);
  }
}

function rebuildSphere(reframe = false) {
  sphere.build(stateApp.filtered, stateApp.authors, gallery.dims);
  const fit = sphereRoomDims(gallery.dims);
  if (!gallery.dims || gallery.dims.height < fit.height || gallery.dims.wallLen < fit.wallLen) {
    gallery.rebuildEnvironment(fit.wallLen, fit.height);
  }
  updateCameraForSphere();
  if (stateApp.view === 'sphere') {
    ui.setResultCount({
      from: stateApp.filtered.length ? 1 : 0,
      to: stateApp.filtered.length,
      total: stateApp.filtered.length,
      page: 1,
      pages: 1
    });
    select(null);
    applyLook(sd.look());
    if (reframe) {
      const v = sphereView();
      camera.position.copy(v.pos);
      controls.target.copy(v.target);
      stateApp.cameraTween = null;
    }
  }
}

function applyView(view, reframe = false) {
  stateApp.view = view;
  ui.setViewMode(view);
  const inSphere = view === 'sphere';
  gallery.setArtVisible(!inSphere);
  sphere.setVisible(inSphere);
  if (inSphere) {
    ensureGalleryRoom();
    rebuildSphere(reframe);
  } else {
    renderPage(reframe);
    updateCameraForRoom(gallery.dims);
    if (reframe) {
      applyGalleryView(gallery.dims);
      stateApp.cameraTween = null;
    }
  }
}

async function switchView(view, reframe = false) {
  if (view === 'sphere') {
    stateApp.authors = await fetchAuthors();
  }
  applyView(view, reframe);
}

// --- catalog + filters ---
// BR-028: render the gallery as soon as the first stock page arrives, then let
// the remaining pages stream in. Previously the loader awaited every page (20+)
// before painting anything, which is what produced the >2 minute blank wait.
async function loadCatalog() {
  ui.setLoadingText('Fetching stock...');
  let firstRendered = false;
  const result = await fetchAllPaintings({
    onPage: (cumulative, info) => {
      stateApp.all = cumulative; // same growing reference across pages
      if (!firstRendered) {
        firstRendered = true;
        ui.populateFilters(buildFacets(stateApp.all));
        rebuild(stateApp.all, true); // first paint — gallery is now interactive
        ui.hideLoading();
      } else {
        // filtered shares the same array, so just refresh counts/paging here;
        // rebuilding meshes would needlessly reload the on-screen textures.
        updatePager();
      }
      ui.setLoadingText(`Loading ${cumulative.length}${info.total ? '/' + info.total : ''}...`);
    }
  });

  if (result.source === 'mock') {
    console.warn('[catalog] using mock data:', result.error);
    // Best-effort: replace acceptance IDs with real public single-product data.
    await Promise.all(
      CONFIG.ACCEPTANCE_IDS.map(async (id) => {
        try {
          const real = await fetchPainting(id);
          const i = stateApp.all.findIndex((p) => String(p.id) === String(id));
          if (i >= 0) stateApp.all[i] = real;
        } catch { /* keep mock */ }
      })
    );
    rebuild(stateApp.all, true);
  }

  // Full stock is in: refresh filter options (active choice preserved) + counts.
  ui.populateFilters(buildFacets(stateApp.all));
  updatePager();
  // Authors load in the background for the lazily-built sphere view.
  fetchAuthors().then((a) => { stateApp.authors = a; }).catch(() => {});

  if (!firstRendered) { // safety net: no page was ever delivered
    rebuild(stateApp.all, true);
    ui.hideLoading();
  }
}

// A new filter result: reset to page 0 and render. reframe=true only on first load / ID lookup.
function rebuild(list, reframe = false) {
  stateApp.filtered = list;
  stateApp.page = 0;
  if (stateApp.view === 'sphere') {
    rebuildSphere(reframe);
    if (!gallery.dims) renderPage(false);
    return;
  }
  renderPage(reframe);
}

// Render the current page of the filtered set into the hall.
function renderPage(reframe) {
  const total = stateApp.filtered.length;
  const pageSize = layoutPageSize(stateApp.layout);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  stateApp.page = Math.min(Math.max(0, stateApp.page), pages - 1);
  const start = stateApp.page * pageSize;
  const slice = stateApp.filtered.slice(start, start + pageSize);
  stateApp.visible = slice;
  gallery.build(slice, stateApp.layout);
  updateCameraForRoom(gallery.dims);
  gallery.setMirrorEnabled(stateApp.mirrorOn);
  gallery.setMirrorQuality(stateApp.mirrorQuality);
  ui.setResultCount({
    from: total ? start + 1 : 0,
    to: start + slice.length,
    total,
    page: stateApp.page + 1,
    pages
  });
  ui.setPageNav(stateApp.page > 0, stateApp.page < pages - 1);
  select(null);
  applyLook(sd.look());
  if (reframe) {
    applyGalleryView(gallery.dims);
    stateApp.cameraTween = null;
  }
}

// Lightweight count/paging refresh without rebuilding meshes. Used while the
// rest of the stock streams in (BR-028) so background pages do not reload the
// textures of the page already on screen.
function updatePager() {
  if (stateApp.view === 'sphere') return;
  const total = stateApp.filtered.length;
  const pageSize = layoutPageSize(stateApp.layout);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  stateApp.page = Math.min(Math.max(0, stateApp.page), pages - 1);
  const start = stateApp.page * pageSize;
  const shown = Math.min(pageSize, Math.max(0, total - start));
  ui.setResultCount({
    from: total ? start + 1 : 0,
    to: start + shown,
    total,
    page: stateApp.page + 1,
    pages
  });
  ui.setPageNav(stateApp.page > 0, stateApp.page < pages - 1);
}

// --- UI handlers ---
const ui = new UI({
  onView: (view) => switchView(view, true),
  onMode: (mode) => {
    stateApp.mode = mode;
    applyLook(sd.look());
  },
  onApplyFilters: (filters) => {
    rebuild(applyFilters(stateApp.all, filters));
  },
  onFindById: async (id) => {
    if (!id) return;
    let p = stateApp.all.find((x) => String(x.id) === String(id));
    if (!p) {
      try {
        p = await fetchPainting(id);
        if (p && !stateApp.all.some((x) => String(x.id) === String(p.id))) stateApp.all.push(p);
      } catch {
        /* not found / not public */
      }
    }
    if (p) {
      if (stateApp.view === 'sphere') {
        stateApp.authors = await fetchAuthors();
        stateApp.filtered = [p];
        rebuildSphere(true);
      } else {
        rebuild([p], true);
      }
    } else {
      ui.setResultCount({ from: 0, to: 0, total: 0, page: 1, pages: 1 });
    }
  },
  onPrevPage: () => {
    stateApp.page -= 1;
    renderPage(false);
  },
  onNextPage: () => {
    stateApp.page += 1;
    renderPage(false);
  },
  onApplyLayout: (layout) => {
    stateApp.layout = {
      perWall: Math.min(CONFIG.LAYOUT_MAX_PER_WALL, Math.max(1, layout.perWall)),
      rows: Math.min(CONFIG.LAYOUT_MAX_ROWS, Math.max(1, layout.rows)),
      colPitch: layout.colPitch,
      rowStep: layout.rowStep,
      rowOrigin: layout.rowOrigin === 'bottom' ? 'bottom' : 'top'
    };
    // Re-clamp page index when room capacity changes.
    const pageSize = layoutPageSize(stateApp.layout);
    const pages = Math.max(1, Math.ceil(stateApp.filtered.length / pageSize));
    stateApp.page = Math.min(stateApp.page, pages - 1);
    renderPage(false);
  },
  onSD: (kind, v) => {
    if (kind === 'tlist') sd.setTList(v);
    else if (kind === 'guidance') sd.setGuidance(v);
    else if (kind === 'delta') sd.setDelta(v);
    else if (kind === 'seed') sd.setSeed(v);
  },
  onToggleAnimation: () => {
    const p = stateApp.selected;
    if (!p) return;
    p.setAnimated(!p.animated);
    ui.setAnimationLabel(p.animated);
  },
  onToggleLensFlare: () => {
    const p = stateApp.selected;
    if (!p) return;
    p.lensFlareOn = !p.lensFlareOn;
    ui.setLensFlareLabel(p.lensFlareOn);
  },
  onToggleMarchingCubes: () => {
    const p = stateApp.selected;
    if (!p) return;
    p.mcOn = !p.mcOn;
    ui.setMarchingCubesLabel(p.mcOn);
    if (p.mcOn) marching.setArtworkTexture(p.material.uniforms.uMap.value);
  },
  onMirrorToggle: (on) => {
    stateApp.mirrorOn = on;
    if (stateApp.view === 'sphere') ensureGalleryRoom();
    gallery.setMirrorEnabled(on);
    applyLook(sd.look());
  },
  onMirrorQuality: (mode) => {
    stateApp.mirrorQuality = mode;
    gallery.setMirrorQuality(mode);
  },
  onEnter: enterPainting,
  onExit: exitToGallery
});

applyGalleryView();
if (mobile.active) {
  stateApp.layout = { ...CONFIG.LAYOUT_DEFAULT };
  ui.setLayout(stateApp.layout);
}
if (ui.mirrorQuality) ui.mirrorQuality.value = stateApp.mirrorQuality;
gallery.setMirrorQuality(stateApp.mirrorQuality);

// Wire SD updates only after `ui` exists; onChange fires immediately and the
// async health check also emits, both of which call applyLook -> ui.
sd.onChange((look) => applyLook(look));

// --- render loop ---
const clock = new THREE.Clock();
let flareElapsed = 0;
const _flareSrc = new THREE.Vector3();

// Decide whether to draw the lens flare this frame and from where. Follow Mouse
// always shows it; otherwise it shines from the selected painting (if its
// per-painting Lens Flare toggle is on) projected to screen space.
function updateLensFlare() {
  if (!lensFlare.params.enabled) return false;
  if (lensFlare.followMouse) return true;
  const p = stateApp.selected;
  if (!p || !p.lensFlareOn) return false;
  p.mesh.getWorldPosition(_flareSrc);
  _flareSrc.project(camera);
  if (_flareSrc.z > 1) return false; // behind the camera
  lensFlare.setSourceNDC(_flareSrc.x, _flareSrc.y);
  return true;
}

// Marching cubes runs only for the selected painting in room view with its
// toggle on. It is a scene object, so it must be updated BEFORE renderer.render.
function updateMarchingCubes(dt) {
  const p = stateApp.selected;
  const show = !!(p && p.mcOn && stateApp.view === 'room');
  marching.setVisible(show);
  if (!show) return;
  marching.place(p.group, p.sizeM);
  marching.update(dt);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  flareElapsed += dt;

  if (stateApp.cameraTween) {
    const tw = stateApp.cameraTween;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = tw.t < 0.5 ? 2 * tw.t * tw.t : 1 - Math.pow(-2 * tw.t + 2, 2) / 2; // easeInOut
    camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (tw.t >= 1) stateApp.cameraTween = null;
  } else {
    applyKeyboardMove(dt);
  }

  gallery.update(dt);
  if (stateApp.view === 'sphere') sphere.update(dt, camera);
  controls.update();
  updateMarchingCubes(dt);
  renderer.render(scene, camera);

  if (updateLensFlare()) lensFlare.render(renderer, flareElapsed);
}

addEventListener('resize', handleViewportResize);
window.visualViewport?.addEventListener('resize', handleViewportResize);
window.visualViewport?.addEventListener('scroll', handleViewportResize);

function handleViewportResize() {
  const vv = window.visualViewport;
  const w = Math.floor(vv?.width ?? innerWidth);
  const h = Math.floor(vv?.height ?? innerHeight);
  if (w < 1 || h < 1) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  lensFlare.setResolution(renderer.domElement.width, renderer.domElement.height);
}

function restoreSceneAfterContextLoss() {
  gallery.setMirrorQuality(stateApp.mirrorQuality);
  if (stateApp.view === 'sphere') rebuildSphere(false);
  else renderPage(false);
  gallery.setMirrorEnabled(stateApp.mirrorOn);
  applyLook(sd.look());
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  ui?.setLoadingText('Restoring gallery…');
  document.getElementById('loading')?.classList.remove('hidden');
}, false);

canvas.addEventListener('webglcontextrestored', () => {
  restoreSceneAfterContextLoss();
  ui?.hideLoading();
}, false);

// BR-028 mobile tab-switch: when returning to a backgrounded tab (or a page
// restored from the back/forward cache) the catalog is already in memory, so
// just drop the long hidden time-gap and force one repaint. This avoids the
// blank/stale canvas that made it look like the page had reloaded. If the GPU
// context was dropped while hidden, the webglcontextrestored handler runs first.
function resumeRender() {
  clock.getDelta(); // discard the hidden gap so animation does not jump
  const gl = renderer.getContext();
  if (gl && !gl.isContextLost()) {
    controls.update();
    renderer.render(scene, camera);
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resumeRender();
});
addEventListener('pageshow', (e) => {
  if (e.persisted) resumeRender();
});

// --- Lens Flare control panel wiring (kept here so ui.js stays focused on the
// gallery's core controls). Sliders update a numeric uniform + its <output>;
// checkboxes update a boolean uniform / overlay flag live.
function wireLensFlareControls() {
  const slider = (id, outId, key, fixed) => {
    const input = document.getElementById(id);
    const out = document.getElementById(outId);
    if (!input) return;
    const apply = () => {
      const v = parseFloat(input.value);
      lensFlare.setParam(key, v);
      if (out) out.textContent = fixed != null ? v.toFixed(fixed) : String(v);
    };
    input.addEventListener('input', apply);
    apply();
  };
  const check = (id, fn) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('change', () => fn(input.checked));
    fn(input.checked);
  };

  check('lf-enabled', (on) => lensFlare.setEnabled(on));
  check('lf-follow', (on) => lensFlare.setFollowMouse(on));
  slider('lf-starpoints', 'o-lf-starpoints', 'starPoints', 0);
  slider('lf-glaresize', 'o-lf-glaresize', 'glareSize', 2);
  slider('lf-flaresize', 'o-lf-flaresize', 'flareSize', 3);
  slider('lf-flarespeed', 'o-lf-flarespeed', 'flareSpeed', 3);
  slider('lf-flareshape', 'o-lf-flareshape', 'flareShape', 2);
  slider('lf-haloscale', 'o-lf-haloscale', 'haloScale', 2);
  slider('lf-opacity', 'o-lf-opacity', 'opacity', 2);
  slider('lf-ghostscale', 'o-lf-ghostscale', 'ghostScale', 2);
  check('lf-animated', (on) => lensFlare.setParam('animated', on));
  check('lf-anamorphic', (on) => lensFlare.setParam('anamorphic', on));
  check('lf-secondaryghosts', (on) => lensFlare.setParam('secondaryGhosts', on));
  check('lf-starburst', (on) => lensFlare.setParam('starBurst', on));
  check('lf-streaks', (on) => lensFlare.setParam('aditionalStreaks', on));

  // Color picker: converts hex (#rrggbb) to the 0-255 scale the shader uses
  // (the shader divides colorGain by 256, so raw 0-255 byte values are correct).
  const colorInput = document.getElementById('lf-color');
  if (colorInput) {
    const applyColor = () => {
      const hex = colorInput.value;
      const u = lensFlare.material.uniforms.colorGain.value;
      u.r = parseInt(hex.slice(1, 3), 16);
      u.g = parseInt(hex.slice(3, 5), 16);
      u.b = parseInt(hex.slice(5, 7), 16);
    };
    colorInput.addEventListener('input', applyColor);
    applyColor();
  }
}

wireLensFlareControls();

// --- Marching Cubes control panel wiring. Same pattern as the lens flare:
// sliders push a numeric param + update their <output>; selects/checkboxes push
// the matching param live. The effect only renders for the selected painting.
function wireMarchingCubesControls() {
  const slider = (id, outId, key, fixed) => {
    const input = document.getElementById(id);
    const out = document.getElementById(outId);
    if (!input) return;
    const apply = () => {
      const v = parseFloat(input.value);
      marching.setParam(key, v);
      if (out) out.textContent = fixed != null ? v.toFixed(fixed) : String(v);
    };
    input.addEventListener('input', apply);
    apply();
  };
  const check = (id, key) => {
    const input = document.getElementById(id);
    if (!input) return;
    const apply = () => marching.setParam(key, input.checked);
    input.addEventListener('change', apply);
    apply();
  };

  // Clamp the resolution slider to this device's safe ceiling (mobile is lower).
  const resInput = document.getElementById('mc-resolution');
  if (resInput) {
    resInput.max = String(marching.maxResolution);
    if (parseFloat(resInput.value) > marching.maxResolution) {
      resInput.value = String(marching.params.resolution);
    }
  }

  const enabledInput = document.getElementById('mc-enabled');
  if (enabledInput) {
    const apply = () => marching.setEnabled(enabledInput.checked);
    enabledInput.addEventListener('change', apply);
    apply();
  }

  slider('mc-numblobs', 'o-mc-numblobs', 'numBlobs', 0);
  slider('mc-resolution', 'o-mc-resolution', 'resolution', 0);
  slider('mc-isolation', 'o-mc-isolation', 'isolation', 0);
  slider('mc-speed', 'o-mc-speed', 'speed', 2);
  slider('mc-scale', 'o-mc-scale', 'scale', 2);
  slider('mc-offset', 'o-mc-offset', 'offset', 2);
  slider('mc-opacity', 'o-mc-opacity', 'opacity', 2);
  check('mc-spin', 'spin');

  const matSelect = document.getElementById('mc-material');
  if (matSelect) {
    const apply = () => marching.setParam('material', matSelect.value);
    matSelect.addEventListener('change', apply);
    apply();
  }

  const colorInput = document.getElementById('mc-color');
  if (colorInput) {
    const apply = () => marching.setParam('color', colorInput.value);
    colorInput.addEventListener('input', apply);
    apply();
  }
}

wireMarchingCubesControls();
ui._syncLayoutLabels();
loadCatalog();
animate();
