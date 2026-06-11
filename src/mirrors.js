import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CONFIG } from './config.js';

const MIRROR_LAYER = 1;

// Nearest power-of-two within [min, max] (render targets prefer pow2).
function pow2Clamp(v, min, max) {
  let p = 1;
  while (p < v) p *= 2;
  return Math.max(min, Math.min(max, p));
}

// Planar reflectors (webgl_mirror). Reflectors live on layer 1; the reflection
// camera renders layer 0 only, so mirrors never recurse into each other.
export class MirrorRoom {
  constructor(parent) {
    this.root = new THREE.Group();
    this.root.name = 'mirrorRoom';
    this.root.visible = false;
    parent.add(this.root);
    this.reflectors = [];
    this.enabled = false;
    this._cursor = 0;
    this._warmup = 0;
    this._perFrame = 6;
    this._active = new Set();
    this._anisotropy = 1;
    this.quality = CONFIG.MIRROR.defaultQuality || 'balanced';
  }

  _preset() {
    return CONFIG.MIRROR.quality[this.quality] || CONFIG.MIRROR.quality.balanced;
  }

  // Texture size proportional to the surface's real metres so large walls stay
  // sharp instead of pixelated. Capped per quality preset.
  _texFor(wMeters, hMeters) {
    const p = this._preset();
    const ppm = CONFIG.MIRROR.pixelsPerMeter;
    return {
      w: pow2Clamp(wMeters * ppm, p.texMin, p.texMax),
      h: pow2Clamp(hMeters * ppm, p.texMin, p.texMax)
    };
  }

  // Choose which planes may refresh this frame (round-robin). During warmup all
  // refresh so nothing is ever shown black.
  tick() {
    if (!this.enabled || this.reflectors.length === 0) return;
    this._active.clear();
    if (this._warmup > 0) {
      this._warmup--;
      for (let i = 0; i < this.reflectors.length; i++) this._active.add(i);
      return;
    }
    const n = Math.min(this._perFrame, this.reflectors.length);
    for (let i = 0; i < n; i++) {
      this._active.add(this._cursor % this.reflectors.length);
      this._cursor++;
    }
  }

  _mkReflector(geometry, index, wMeters, hMeters) {
    const m = CONFIG.MIRROR;
    const { w, h } = this._texFor(wMeters, hMeters);
    const r = new Reflector(geometry, {
      clipBias: m.clipBias,
      color: m.color,
      textureWidth: w,
      textureHeight: h,
      multisample: m.multisample ?? 0
    });
    r.layers.set(MIRROR_LAYER);

    const orig = r.onBeforeRender.bind(r);
    r.onBeforeRender = (renderer, scene, camera) => {
      if (!this.enabled || !this._active.has(index)) return;

      // Sharpen grazing-angle reflections (floor especially) once we have a renderer.
      const tex = r.getRenderTarget().texture;
      if (this._anisotropy === 1) {
        this._anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
      if (tex.anisotropy !== this._anisotropy) {
        tex.anisotropy = this._anisotropy;
        tex.needsUpdate = true;
      }
      tex.colorSpace = THREE.SRGBColorSpace;

      // Render layer 0 only so reflectors do not reflect each other (no recursion).
      const vCam = r.camera;
      const savedMask = vCam.layers.mask;
      vCam.layers.disableAll();
      vCam.layers.enable(0);

      orig(renderer, scene, camera);

      vCam.layers.mask = savedMask;
    };

    this.root.add(r);
    this.reflectors.push(r);
    return r;
  }

  rebuild(wallLen, height) {
    this.dispose();
    this._lastDims = { wallLen, height };
    this._perFrame = this._preset().perFrame;
    this._cursor = 0;
    this._warmup = this.enabled ? 12 : 0;

    const L = wallLen;
    const h = height;
    const half = L / 2;

    let idx = 0;
    const floor = this._mkReflector(new THREE.PlaneGeometry(L, L), idx++, L, L);
    floor.rotation.x = -Math.PI / 2;

    if (this._preset().ceiling) {
      const ceiling = this._mkReflector(new THREE.PlaneGeometry(L, L), idx++, L, L);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = h;
    }

    const front = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++, L, h);
    front.position.set(0, h / 2, -half);

    const back = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++, L, h);
    back.position.set(0, h / 2, half);
    back.rotation.y = Math.PI;

    const left = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++, L, h);
    left.position.set(-half, h / 2, 0);
    left.rotation.y = Math.PI / 2;

    const right = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++, L, h);
    right.position.set(half, h / 2, 0);
    right.rotation.y = -Math.PI / 2;
  }

  // Switch quality preset; rebuild reflectors (texture size / ceiling change).
  setQuality(mode) {
    if (!CONFIG.MIRROR.quality[mode]) return;
    this.quality = mode;
    if (this._lastDims) {
      this.rebuild(this._lastDims.wallLen, this._lastDims.height);
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.root.visible = this.enabled;
    if (this.enabled) {
      this._cursor = 0;
      this._warmup = 12;
    }
  }

  dispose() {
    for (const r of this.reflectors) {
      r.dispose();
      this.root.remove(r);
    }
    this.reflectors = [];
  }
}

export { MIRROR_LAYER };
