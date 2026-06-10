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

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14141c);
scene.fog = new THREE.FogExp2(0x14141c, 0.004);

// Tight near/far range keeps depth-buffer precision high so distant paintings
// stay crisp and do not z-fight with their frames.
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.25, 160);
camera.layers.enable(MIRROR_LAYER);
camera.position.set(0, 1.7, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.6, 0);
controls.maxPolarAngle = Math.PI * 0.85;

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
  if (stateApp.view === 'sphere') return;
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
  clampCameraToRoom();
}

function clampCameraToRoom() {
  const dims = gallery.dims;
  if (!dims) return;
  const half = dims.wallLen / 2 - 0.6;
  const minY = 0.8;
  const maxY = (dims.height || CONFIG.WALL_HEIGHT_M) - 0.4;

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
  if (hit) select(hit);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const hit = pickAt(e.clientX, e.clientY);
  if (!hit) return;
  select(hit);
  if (hit.type === 'painting') enterPainting();
});

function select(hit) {
  if (!hit) {
    stateApp.selected = null;
    ui.setSelected(null);
    ui.setAnimationLabel(false);
    applyLook(sd.look());
    return;
  }
  if (hit.type === 'painting') {
    stateApp.selected = hit.painting;
    ui.setSelected(hit.data);
    ui.setAnimationLabel(hit.painting.animated);
  } else {
    stateApp.selected = null;
    ui.setSelected({ title: hit.data.title, artist: hit.data.artist, id: '', widthCm: 0, heightCm: 0 });
    ui.setAnimationLabel(false);
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
  const cy = CONFIG.SPHERE.centerY;
  camera.near = 0.1;
  camera.far = Math.max(200, r * 8);
  camera.updateProjectionMatrix();
  controls.minDistance = r * 0.55;
  controls.maxDistance = r * 2.8;
  controls.target.set(0, cy, 0);
}

function sphereView() {
  const r = sphere.radius || CONFIG.SPHERE.defaultRadius;
  const cy = CONFIG.SPHERE.centerY;
  return {
    pos: new THREE.Vector3(0, cy + r * 0.15, r * 1.35),
    target: new THREE.Vector3(0, cy, 0)
  };
}

// Default view: camera near the front wall but orbit target at room centre so
// the user can freely look at all four walls.
function galleryView() {
  const L = gallery.dims ? gallery.dims.wallLen : 16;
  const h = gallery.dims?.height ?? CONFIG.WALL_HEIGHT_M;
  const z = -L / 2; // front wall
  const dist = Math.min(8, L * 0.42);
  return {
    pos: new THREE.Vector3(0, 2.0, z + dist),
    target: new THREE.Vector3(0, h * 0.4, 0)
  };
}

// --- enter / exit camera moves ---
function enterPainting() {
  const p = stateApp.selected;
  if (!p) return;
  const worldPos = new THREE.Vector3();
  p.mesh.getWorldPosition(worldPos);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.group.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p.group.quaternion);
  // Frame so the whole painting fits the visible area; shift left so the right
  // control panel does not cover it.
  const dist = Math.max(p.sizeM.w, p.sizeM.h) * 1.7 + 0.5;
  const shift = right.multiplyScalar(p.sizeM.w * 0.35);
  const camTarget = worldPos.clone().add(normal.multiplyScalar(dist)).add(shift);
  tweenCamera(camTarget, worldPos.clone().add(shift));
  p.setAnimated(true);
  stateApp.animating = true;
  ui.setAnimationLabel(true);
}

function exitToGallery() {
  if (stateApp.view === 'sphere') {
    const v = sphereView();
    tweenCamera(v.pos, v.target);
    return;
  }
  const v = galleryView();
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
function applyLook(look) {
  ui.setSdStatus(sd.bridgeOnline);
  const painting = stateApp.mode === 'painting';
  gallery.applyEnvironmentLook(look, !painting);
  for (const p of gallery.paintings) {
    const active = painting && p === stateApp.selected;
    p.applyLook(look, active);
  }
  sphere.applyLook(look, painting, stateApp.selected);
}

function rebuildSphere(reframe = false) {
  sphere.build(stateApp.filtered, stateApp.authors, gallery.dims);
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
    if (!gallery.dims) renderPage(false);
    rebuildSphere(reframe);
  } else {
    renderPage(reframe);
    updateCameraForRoom(gallery.dims);
    if (reframe) {
      const v = galleryView();
      camera.position.copy(v.pos);
      controls.target.copy(v.target);
      stateApp.cameraTween = null;
    }
  }
}

// --- catalog + filters ---
async function loadCatalog() {
  ui.setLoadingText('Fetching stock...');
  const { paintings, source, error } = await fetchAllPaintings({
    onProgress: (n, total) => ui.setLoadingText(`Loading ${n}${total ? '/' + total : ''}...`)
  });
  stateApp.all = paintings;
  if (source === 'mock') {
    console.warn('[catalog] using mock data:', error);
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
  }
  ui.populateFilters(buildFacets(stateApp.all));
  stateApp.authors = await fetchAuthors();
  rebuild(stateApp.all, true);
  rebuildSphere(false);
  ui.hideLoading();
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
  rebuildSphere(false);
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
    const v = galleryView();
    camera.position.copy(v.pos);
    controls.target.copy(v.target);
    stateApp.cameraTween = null;
  }
}

// --- UI handlers ---
const ui = new UI({
  onView: (view) => applyView(view, true),
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
      rowStep: layout.rowStep
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
  onMirrorToggle: (on) => {
    stateApp.mirrorOn = on;
    gallery.setMirrorEnabled(on);
  },
  onMirrorQuality: (mode) => {
    stateApp.mirrorQuality = mode;
    gallery.setMirrorQuality(mode);
  },
  onEnter: enterPainting,
  onExit: exitToGallery
});

// Wire SD updates only after `ui` exists; onChange fires immediately and the
// async health check also emits, both of which call applyLook -> ui.
sd.onChange((look) => applyLook(look));

// --- render loop ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

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
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

ui._syncLayoutLabels();
loadCatalog();
animate();
