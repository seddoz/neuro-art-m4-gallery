// Marching Cubes (metaball) effect for the SELECTED painting only.
//
// Ported in spirit from the three.js example:
// https://threejs.org/examples/#webgl_marchingcubes
//
// Design goals (perf + quality):
//   - ONE shared MarchingCubes instance for the whole app. Only the currently
//     selected painting can show it, so we never pay for more than one blob
//     simulation at a time (the costly part is the O(resolution^3) field pass).
//   - Built lazily on first enable so visitors who never use it pay nothing.
//   - Updated only when visible (gated by the caller each frame).
//   - Resolution + poly budget are capped on mobile to protect the GPU/CPU the
//     same way the rest of the gallery is (see device.js / BR-028).
//   - Uses the scene's existing lights; no extra render targets or env maps.
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

export const MARCHING_CUBES_DEFAULTS = {
  enabled: true, // master switch (panel). Per-painting toggle decides which work.
  resolution: 48, // field grid size; mobile is capped lower in the constructor
  numBlobs: 10,
  speed: 1.0, // simulation speed multiplier
  isolation: 80, // surface threshold (lower = puffier/merged, higher = tighter)
  material: 'shiny', // shiny | matte | metal | glass | artwork
  color: '#3b82f6',
  opacity: 1.0,
  scale: 1.0, // blob size as a multiple of the painting height
  offset: 0.6, // metres the blob floats in front of the canvas
  spin: true // slow self-rotation for life
};

// Resolution / poly-count caps. Marching cubes cost grows with resolution^3, so
// phones get a tighter ceiling to stay smooth and avoid WebGL context loss.
const CAPS = {
  desktop: { maxResolution: 64, maxPolyCount: 80000, defaultResolution: 48 },
  mobile: { maxResolution: 32, maxPolyCount: 20000, defaultResolution: 28 }
};

export class MarchingCubesEffect {
  constructor({ mobile = false } = {}) {
    this.caps = mobile ? CAPS.mobile : CAPS.desktop;
    this.params = { ...MARCHING_CUBES_DEFAULTS };
    this.params.resolution = this.caps.defaultResolution;

    this._mc = null; // created lazily
    this._materials = null;
    this._artworkTex = null;
    this._time = 0;
    this._built = false;

    // Scratch objects reused every frame (no per-frame allocation).
    this._pos = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
  }

  get maxResolution() {
    return this.caps.maxResolution;
  }

  // Build the materials once. Kept simple and light: standard PBR under the
  // gallery's existing lights, plus an "artwork" preset that maps the painting
  // texture onto the blob, and a translucent "glass" preset.
  _buildMaterials() {
    const base = (extra) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.params.color),
        side: THREE.DoubleSide,
        ...extra
      });

    this._materials = {
      shiny: base({ roughness: 0.15, metalness: 0.0 }),
      matte: base({ roughness: 0.9, metalness: 0.0 }),
      metal: base({ roughness: 0.25, metalness: 0.95 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(this.params.color),
        roughness: 0.1,
        metalness: 0.0,
        transmission: 1.0,
        thickness: 0.5,
        transparent: true,
        side: THREE.DoubleSide
      }),
      artwork: base({ roughness: 0.5, metalness: 0.0, map: this._artworkTex || null })
    };
  }

  // Lazily create the MarchingCubes mesh and add it to the scene (hidden).
  ensure(scene) {
    if (this._built) return;
    this._buildMaterials();
    // enableUvs=true so the "artwork" material can map the painting texture;
    // enableColors=false (we drive color via the material, not per-vertex).
    this._mc = new MarchingCubes(
      this.params.resolution,
      this._materials[this.params.material],
      true,
      false,
      this.caps.maxPolyCount
    );
    this._mc.isolation = this.params.isolation;
    this._mc.visible = false;
    this._mc.frustumCulled = false; // geometry origin stays at mesh position
    this._mc.renderOrder = 3; // after paintings/frames
    scene.add(this._mc);
    this._scene = scene;
    this._built = true;
  }

  setVisible(on) {
    if (this._mc) this._mc.visible = !!on && this.params.enabled;
  }

  setEnabled(on) {
    this.params.enabled = !!on;
    if (this._mc && !on) this._mc.visible = false;
  }

  setArtworkTexture(tex) {
    this._artworkTex = tex || null;
    if (this._materials?.artwork) {
      this._materials.artwork.map = this._artworkTex;
      this._materials.artwork.needsUpdate = true;
    }
  }

  setParam(key, value) {
    this.params[key] = value;
    if (!this._mc) return;
    switch (key) {
      case 'resolution': {
        const r = Math.max(8, Math.min(this.caps.maxResolution, Math.round(value)));
        this.params.resolution = r;
        // init() reallocates the field buffers; isolation resets to its default
        // inside init(), so re-apply ours afterwards.
        this._mc.init(r);
        this._mc.isolation = this.params.isolation;
        break;
      }
      case 'isolation':
        this._mc.isolation = value;
        break;
      case 'material':
        this._mc.material = this._materials[value] || this._materials.shiny;
        this._applyColor();
        break;
      case 'color':
        this._applyColor();
        break;
      case 'opacity':
        this._applyOpacity();
        break;
      default:
        break;
    }
  }

  _applyColor() {
    const c = new THREE.Color(this.params.color);
    for (const m of Object.values(this._materials)) {
      // The artwork preset keeps white so the texture shows true colors.
      if (m === this._materials.artwork) m.color.set(0xffffff);
      else m.color.copy(c);
    }
  }

  _applyOpacity() {
    const o = this.params.opacity;
    for (const m of Object.values(this._materials)) {
      if (m === this._materials.glass) continue; // glass manages its own alpha
      m.opacity = o;
      m.transparent = o < 1;
      m.needsUpdate = true;
    }
  }

  // Position/scale/orient the blob in front of the selected painting. Called
  // each visible frame with the painting's world transform and display size.
  place(group, sizeM) {
    if (!this._mc) return;
    group.getWorldPosition(this._pos);
    group.getWorldQuaternion(this._quat);
    this._normal.set(0, 0, 1).applyQuaternion(this._quat).normalize();

    // World size of the blob box (local extent is -1..1 => 2 units).
    const target = Math.max(0.1, (sizeM?.h || 1) * this.params.scale);
    const s = target / 2;
    this._mc.scale.setScalar(s);

    // Float it in front of the canvas; keep at least half its size clear so it
    // never intersects the artwork plane.
    const dist = Math.max(this.params.offset, target * 0.55);
    this._mc.position.copy(this._pos).addScaledVector(this._normal, dist);
  }

  // Advance the metaball simulation and re-polygonize. Mirrors the three.js
  // example's field setup but keeps the cluster centred (no floor plane) so it
  // reads as a self-contained object hovering by the painting.
  update(dt) {
    if (!this._mc || !this._mc.visible) return;
    this._time += dt * this.params.speed;
    const t = this._time;
    const n = Math.max(1, Math.round(this.params.numBlobs));

    this._mc.reset();
    const subtract = 12;
    const strength = 1.2 / ((Math.sqrt(n) - 1) / 4 + 1);
    for (let i = 0; i < n; i++) {
      const x = Math.sin(i + 1.26 * t * (1.03 + 0.5 * Math.cos(0.21 * i))) * 0.27 + 0.5;
      const y = Math.cos(i + 1.12 * t * Math.cos(1.22 + 0.1424 * i)) * 0.27 + 0.5;
      const z = Math.cos(i + 1.32 * t * 0.1 * Math.sin(0.92 + 0.53 * i)) * 0.27 + 0.5;
      this._mc.addBall(x, y, z, strength, subtract);
    }
    this._mc.update();

    if (this.params.spin) this._mc.rotation.y = t * 0.3;
  }

  dispose() {
    if (this._mc) {
      this._scene?.remove(this._mc);
      this._mc.geometry.dispose();
    }
    if (this._materials) {
      for (const m of Object.values(this._materials)) m.dispose?.();
    }
    this._built = false;
  }
}
