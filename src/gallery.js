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
    this.scene.add(new THREE.HemisphereLight(0xdfe3f0, 0x20202c, 1.15));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(6, 12, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9aa6c8, 0.5);
    fill.position.set(-8, 6, -6);
    this.scene.add(fill);
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
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x20202a, roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, wallLen), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.envRoot.add(floor);

    // Ceiling (keeps the room from reading as an open void).
    this.ceilingMat = new THREE.MeshStandardMaterial({ color: 0x191922, roughness: 1.0 });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, wallLen), this.ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = h;
    this.envRoot.add(ceiling);

    // Walls (4). Flat geometry. Stored so Environment mode can re-tint them.
    this.wallMeshes = [];
    const mkWall = (x, z, ry) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2c2c38,
        roughness: 0.92,
        metalness: 0.04,
        emissive: 0x000000
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, h), mat);
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      this.envRoot.add(m);
      this.wallMeshes.push(m);
    };
    mkWall(0, -wallLen / 2, 0);
    mkWall(0, wallLen / 2, Math.PI);
    mkWall(-wallLen / 2, 0, Math.PI / 2);
    mkWall(wallLen / 2, 0, -Math.PI / 2);

    // Architectural columns in the 4 corners (NOT the middle of the room).
    // Environment mode grows/illuminates these to reshape the space.
    this.structure = new THREE.Group();
    this._pillarMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a48,
      roughness: 0.6,
      metalness: 0.1,
      emissive: 0x000000
    });
    const inset = 0.5;
    const c = wallLen / 2 - inset;
    for (const [cx, cz] of [[-c, -c], [c, -c], [-c, c], [c, c]]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, h, 16), this._pillarMat);
      pillar.position.set(cx, h / 2, cz);
      this.structure.add(pillar);
    }
    this.envRoot.add(this.structure);
  }

  // Environment manipulation: SD look reshapes the SPACE via surface tint,
  // emissive glow, fog and corner-column growth - clearly distinct from
  // Painting mode and WITHOUT waving the walls.
  applyEnvironmentLook(look, active) {
    if (!this.wallMeshes) return;
    const amt = active ? look.intensity : 0; // 0..1 energy
    const hue = look.hueShift;

    for (const w of this.wallMeshes) {
      w.material.color.setHSL(0.62, active ? 0.12 : 0.04, 0.16 + amt * 0.06);
      w.material.emissive.setHSL(hue, 0.6, active ? look.blend * 0.12 : 0);
    }
    if (this.floorMat) this.floorMat.color.setHSL(0.62, active ? 0.1 : 0.02, 0.12 + amt * 0.04);

    if (this.structure) {
      const s = active ? 0.7 + look.contrast * 1.6 : 1;
      this.structure.scale.set(1, s, 1);
      this._pillarMat.emissive.setHSL(hue, 0.7, active ? 0.1 + look.intensity * 0.4 : 0.02);
    }

    if (this.scene.fog) {
      this.scene.fog.density = 0.004 + (active ? amt * 0.01 : 0);
    }
  }

  getPaintingMeshes() {
    return this.paintings.map((p) => p.mesh);
  }

  update(dt) {
    for (const p of this.paintings) p.update(dt);
  }
}
