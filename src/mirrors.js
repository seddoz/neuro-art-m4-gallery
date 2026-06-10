import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CONFIG } from './config.js';

const MIRROR_LAYER = 1;

// Scale mirror cost with visible painting count (each reflector re-renders the scene).
function qualityForCount(n) {
  const m = CONFIG.MIRROR;
  if (n <= 32) {
    return { tex: m.textureWidthMax ?? 512, stride: 1, ceiling: true };
  }
  if (n <= 72) {
    return { tex: 256, stride: 2, ceiling: true };
  }
  if (n <= 160) {
    return { tex: 256, stride: 2, ceiling: false };
  }
  return { tex: m.textureWidthMin ?? 128, stride: 3, ceiling: false };
}

// Planar reflectors (webgl_mirror). Reflectors live on layer 1; the reflection
// camera renders layer 0 only so mirrors never recurse into each other.
export class MirrorRoom {
  constructor(parent) {
    this.root = new THREE.Group();
    this.root.name = 'mirrorRoom';
    this.root.visible = false;
    parent.add(this.root);
    this.reflectors = [];
    this.enabled = false;
    this._frame = 0;
    this._warmup = 0;
    this._stride = 1;
  }

  tick() {
    if (!this.enabled) return;
    if (this._warmup > 0) this._warmup--;
    this._frame++;
  }

  _shouldUpdate(index) {
    if (this._warmup > 0) return true;
    return (this._frame + index) % this._stride === 0;
  }

  _mkReflector(geometry, index) {
    const m = CONFIG.MIRROR;
    const r = new Reflector(geometry, {
      clipBias: m.clipBias,
      color: m.color,
      textureWidth: this._tex,
      textureHeight: this._tex,
      multisample: m.multisample ?? 0
    });
    r.layers.set(MIRROR_LAYER);

    const orig = r.onBeforeRender.bind(r);
    r.onBeforeRender = (renderer, scene, camera) => {
      if (!this.enabled || !this._shouldUpdate(index)) return;

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

  rebuild(wallLen, height, paintingCount = 0) {
    this.dispose();
    const q = qualityForCount(paintingCount);
    this._tex = q.tex;
    this._stride = q.stride;
    this._frame = 0;
    this._warmup = this.enabled ? 10 : 0;

    const L = wallLen;
    const h = height;
    const half = L / 2;

    let idx = 0;
    const floor = this._mkReflector(new THREE.PlaneGeometry(L, L), idx++);
    floor.rotation.x = -Math.PI / 2;

    if (q.ceiling) {
      const ceiling = this._mkReflector(new THREE.PlaneGeometry(L, L), idx++);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = h;
    }

    const front = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++);
    front.position.set(0, h / 2, -half);

    const back = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++);
    back.position.set(0, h / 2, half);
    back.rotation.y = Math.PI;

    const left = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++);
    left.position.set(-half, h / 2, 0);
    left.rotation.y = Math.PI / 2;

    const right = this._mkReflector(new THREE.PlaneGeometry(L, h), idx++);
    right.position.set(half, h / 2, 0);
    right.rotation.y = -Math.PI / 2;
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.root.visible = this.enabled;
    if (this.enabled) {
      this._frame = 0;
      this._warmup = 10;
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
