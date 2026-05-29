import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Gallery } from './gallery.js';
import { SDController } from './sd.js';
import { UI } from './ui.js';
import { fetchAllPaintings, fetchPainting, buildFacets, applyFilters } from './api.js';
import { CONFIG } from './config.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0f);
scene.fog = new THREE.FogExp2(0x0a0a0f, 0.012);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 1.7, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.6, 0);
controls.maxPolarAngle = Math.PI * 0.85;

const gallery = new Gallery(scene);
const sd = new SDController();

const stateApp = {
  mode: 'environment',
  all: [],
  visible: [],
  selected: null,
  animating: false,
  cameraTween: null
};

// --- selection via raycast (click, not drag) ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const dt = performance.now() - down.t;
  down = null;
  if (moved > 6 || dt > 400) return; // it was a drag
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(gallery.getPaintingMeshes(), false);
  if (hits.length) select(hits[0].object.userData.painting);
});

function select(p) {
  stateApp.selected = p;
  ui.setSelected(p ? p.data : null);
  ui.setAnimationLabel(p ? p.animated : false);
  applyLook(sd.look());
}

// --- enter / exit camera moves ---
function enterPainting() {
  const p = stateApp.selected;
  if (!p) return;
  const worldPos = new THREE.Vector3();
  p.mesh.getWorldPosition(worldPos);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.group.quaternion);
  const dist = Math.max(p.sizeM.w, p.sizeM.h) * 1.4 + 0.6;
  const camTarget = worldPos.clone().add(normal.multiplyScalar(dist));
  tweenCamera(camTarget, worldPos);
  p.setAnimated(true);
  stateApp.animating = true;
  ui.setAnimationLabel(true);
}

function exitToGallery() {
  tweenCamera(new THREE.Vector3(0, 1.7, 8), new THREE.Vector3(0, 1.6, 0));
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
}
sd.onChange((look) => applyLook(look));

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
  rebuild(stateApp.all);
  ui.hideLoading();
}

function rebuild(list) {
  stateApp.visible = list;
  gallery.build(list);
  ui.setResultCount(list.length, stateApp.all.length);
  select(null);
  applyLook(sd.look());
}

// --- UI handlers ---
const ui = new UI({
  onMode: (mode) => {
    stateApp.mode = mode;
    applyLook(sd.look());
  },
  onApplyFilters: (filters) => {
    rebuild(applyFilters(stateApp.all, filters));
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
  onEnter: enterPainting,
  onExit: exitToGallery
});

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
  }

  gallery.update(dt);
  controls.update();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

loadCatalog();
animate();
