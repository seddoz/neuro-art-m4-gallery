import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Painting, enqueueTexture } from './painting.js';

// Builds the 3D exhibition space and lays paintings along its walls using
// real cm dimensions. Holds the "environment" that the Environment mode
// manipulates: the room geometry/structure where paintings sit (NOT
// atmosphere/light sliders, per Bart's clarification).
export class Gallery {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.envRoot = new THREE.Group();
    this.artRoot = new THREE.Group();
    this.root.add(this.envRoot, this.artRoot);
    this.scene.add(this.root);
    this.paintings = [];
    this._buildLights();
  }

  _buildLights() {
    // Neutral, fixed lighting. Lighting is intentionally NOT a user control in M4.
    this.scene.add(new THREE.HemisphereLight(0xbfc4d6, 0x14141c, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 10, 8);
    this.scene.add(key);
  }

  clear() {
    for (const p of this.paintings) p.dispose();
    this.paintings = [];
    this.artRoot.clear();
    this.envRoot.clear();
  }

  // Lay up to CONFIG.PAGE paintings around a rectangular hall in a grid of
  // ROWS_PER_WALL rows. Returns the placed paintings. Filters run over the
  // full set upstream; this only caps what is rendered at once.
  build(paintingData) {
    this.clear();
    const place = paintingData.slice(0, CONFIG.PAGE);
    const rows = CONFIG.ROWS_PER_WALL;
    const perWall = Math.max(1, Math.ceil(place.length / 4));
    const cols = Math.max(1, Math.ceil(perWall / rows));
    const pitch = CONFIG.COL_PITCH_M;
    const wallLen = cols * pitch + CONFIG.ROOM_PADDING_M * 2;
    this.dims = { wallLen, height: CONFIG.WALL_HEIGHT_M };

    this._buildEnvironment(wallLen);

    // Distribute around 4 walls. Each wall is a line; paintings face inward.
    const walls = [
      { dir: new THREE.Vector3(1, 0, 0), pos: new THREE.Vector3(0, 0, -wallLen / 2), rot: 0 },
      { dir: new THREE.Vector3(-1, 0, 0), pos: new THREE.Vector3(0, 0, wallLen / 2), rot: Math.PI },
      { dir: new THREE.Vector3(0, 0, 1), pos: new THREE.Vector3(-wallLen / 2, 0, 0), rot: Math.PI / 2 },
      { dir: new THREE.Vector3(0, 0, -1), pos: new THREE.Vector3(wallLen / 2, 0, 0), rot: -Math.PI / 2 }
    ];

    const span = (cols - 1) * pitch;
    let idx = 0;
    for (let w = 0; w < walls.length && idx < place.length; w++) {
      const wall = walls[w];
      const onThis = Math.min(perWall, place.length - idx);
      for (let i = 0; i < onThis; i++) {
        const col = Math.floor(i / rows);
        const row = i % rows;
        const p = new Painting(place[idx++]);
        const offset = -span / 2 + col * pitch;
        const along = wall.dir.clone().multiplyScalar(offset);
        p.group.position.copy(wall.pos).add(along);
        p.group.position.y = CONFIG.ROW_BASE_Y + row * CONFIG.ROW_STEP_Y;
        p.group.rotation.y = wall.rot;
        this.artRoot.add(p.group);
        this.paintings.push(p);
        enqueueTexture(p);
      }
    }
    return this.paintings;
  }

  _buildEnvironment(wallLen) {
    const h = CONFIG.WALL_HEIGHT_M;

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(wallLen, wallLen),
      new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.envRoot.add(floor);

    // Walls (4). Stored so Environment mode can morph them.
    this.wallMeshes = [];
    const wallMat = () =>
      new THREE.MeshStandardMaterial({ color: 0x15151d, roughness: 0.9, metalness: 0.05 });
    const mkWall = (x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, h, 24, 8), wallMat());
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      this.envRoot.add(m);
      this.wallMeshes.push(m);
    };
    mkWall(0, -wallLen / 2, 0);
    mkWall(0, wallLen / 2, Math.PI);
    mkWall(-wallLen / 2, 0, Math.PI / 2);
    mkWall(wallLen / 2, 0, -Math.PI / 2);

    // Structural element that Environment mode grows/morphs: a ring of pillars.
    this.structure = new THREE.Group();
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x222232, roughness: 0.6, emissive: 0x000000 });
    this._pillarMat = pillarMat;
    const r = wallLen * 0.28;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h * 0.9, 12), pillarMat);
      pillar.position.set(Math.cos(a) * r, (h * 0.9) / 2, Math.sin(a) * r);
      this.structure.add(pillar);
    }
    this.envRoot.add(this.structure);
  }

  // Environment manipulation: SD look reshapes the SPACE (wall displacement +
  // structure growth + surface tint), clearly distinct from Painting mode.
  applyEnvironmentLook(look, active) {
    if (!this.wallMeshes) return;
    const amt = active ? look.intensity : 0;
    for (const w of this.wallMeshes) {
      const pos = w.geometry.attributes.position;
      // displace wall vertices into a relief that grows with intensity
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const base = w.geometry.userData.base || (w.geometry.userData.base = pos.array.slice());
        const z = Math.sin(x * 1.5 + y * 1.5) * amt * 0.6;
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
      w.material.color.setHSL(0.6 + look.hueShift * 0.3 * (active ? 1 : 0), 0.2, 0.08 + amt * 0.15);
    }
    if (this.structure) {
      const s = active ? 0.5 + look.contrast * 2.5 : 1;
      this.structure.scale.set(1, s, 1);
      this._pillarMat.emissive.setHSL(look.hueShift, 0.6, active ? look.blend * 0.35 : 0);
    }
  }

  getPaintingMeshes() {
    return this.paintings.map((p) => p.mesh);
  }

  update(dt) {
    for (const p of this.paintings) p.update(dt);
  }
}
