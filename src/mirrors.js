import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CONFIG } from './config.js';

// Six planar reflectors (floor, ceiling, 4 walls) forming a mirror box at 90°.
// Port of the three.js webgl_mirror pattern — Reflector auto-renders onBeforeRender.
export class MirrorRoom {
  constructor(parent) {
    this.root = new THREE.Group();
    this.root.name = 'mirrorRoom';
    this.root.visible = false;
    parent.add(this.root);
    this.reflectors = [];
    this.enabled = false;
  }

  _mkReflector(geometry) {
    const m = CONFIG.MIRROR;
    const r = new Reflector(geometry, {
      clipBias: m.clipBias,
      color: m.color,
      textureWidth: m.textureWidth,
      textureHeight: m.textureHeight
    });
    this.root.add(r);
    this.reflectors.push(r);
    return r;
  }

  rebuild(wallLen, height) {
    this.dispose();
    const L = wallLen;
    const h = height;
    const half = L / 2;

    const floor = this._mkReflector(new THREE.PlaneGeometry(L, L));
    floor.rotation.x = -Math.PI / 2;

    const ceiling = this._mkReflector(new THREE.PlaneGeometry(L, L));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = h;

    const front = this._mkReflector(new THREE.PlaneGeometry(L, h));
    front.position.set(0, h / 2, -half);

    const back = this._mkReflector(new THREE.PlaneGeometry(L, h));
    back.position.set(0, h / 2, half);
    back.rotation.y = Math.PI;

    const left = this._mkReflector(new THREE.PlaneGeometry(L, h));
    left.position.set(-half, h / 2, 0);
    left.rotation.y = Math.PI / 2;

    const right = this._mkReflector(new THREE.PlaneGeometry(L, h));
    right.position.set(half, h / 2, 0);
    right.rotation.y = -Math.PI / 2;
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.root.visible = this.enabled;
  }

  dispose() {
    for (const r of this.reflectors) {
      r.dispose();
      this.root.remove(r);
    }
    this.reflectors = [];
  }
}
