import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CONFIG } from './config.js';

function mirrorTextureSize() {
  const m = CONFIG.MIRROR;
  if (m.textureWidth) return { w: m.textureWidth, h: m.textureHeight || m.textureWidth };
  // Auto: lighter targets on touch / low-DPR devices.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = coarse || devicePixelRatio < 1.5;
  const s = small ? 128 : 256;
  return { w: s, h: s };
}

// Planar reflectors forming a mirror box. Each Reflector renders the scene to a
// texture onBeforeRender — without guards that becomes 6× full-scene passes (and
// worse: nested mirror-on-mirror recursion). We hide all mirrors during each pass
// and stagger updates so only a subset refresh each frame.
export class MirrorRoom {
  constructor(parent) {
    this.root = new THREE.Group();
    this.root.name = 'mirrorRoom';
    this.root.visible = false;
    parent.add(this.root);
    this.reflectors = [];
    this.enabled = false;
    this._frame = 0;
  }

  tick() {
    if (this.enabled) this._frame++;
  }

  _shouldUpdate(index) {
    const stride = CONFIG.MIRROR.updateStride ?? 2;
    return (this._frame + index) % stride === 0;
  }

  _mkReflector(geometry, index) {
    const m = CONFIG.MIRROR;
    const { w, h } = mirrorTextureSize();
    const r = new Reflector(geometry, {
      clipBias: m.clipBias,
      color: m.color,
      textureWidth: w,
      textureHeight: h,
      multisample: m.multisample ?? 0
    });

    const orig = r.onBeforeRender.bind(r);
    r.onBeforeRender = (renderer, scene, camera) => {
      if (!this.enabled || !this._shouldUpdate(index)) return;

      // Stop mirror-in-mirror recursion: other reflectors must not run during this pass.
      for (const ref of this.reflectors) ref.visible = false;

      orig(renderer, scene, camera);

      for (const ref of this.reflectors) ref.visible = true;
    };

    this.root.add(r);
    this.reflectors.push(r);
    return r;
  }

  rebuild(wallLen, height) {
    this.dispose();
    const L = wallLen;
    const h = height;
    const half = L / 2;

    const floor = this._mkReflector(new THREE.PlaneGeometry(L, L), 0);
    floor.rotation.x = -Math.PI / 2;

    let idx = 1;
    if (CONFIG.MIRROR.includeCeiling) {
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
    if (this.enabled) this._frame = 0;
  }

  dispose() {
    for (const r of this.reflectors) {
      r.dispose();
      this.root.remove(r);
    }
    this.reflectors = [];
  }
}
