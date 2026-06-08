import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Painting, enqueueTexture, resetTextureQueue } from './painting.js';

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
    // Drop pending texture jobs first so the next page is not queued behind the
    // jobs of the page we are leaving, then dispose (marks paintings disposed so
    // any in-flight loads short-circuit).
    resetTextureQueue();
    for (const p of this.paintings) p.dispose();
    this.paintings = [];
    this.artRoot.clear();
    this.envRoot.clear();
  }

  // Lay paintings around a rectangular hall using live layout sliders (per wall,
  // rows, horizontal/vertical gap). Filters run over the full set upstream.
  //
  // Overlap-free placement: colPitch/rowStep are read as the GAP between
  // painting edges. The grid uses a uniform cell sized to the LARGEST painting
  // in the set, so works of different formats never overlap and keep a
  // consistent centre-to-centre distance. The room (length + height) auto-fits
  // the resulting grid.
  build(paintingData, layout) {
    this.clear();
    const minGap = CONFIG.LAYOUT_MIN_GAP;
    const rows = Math.max(1, Math.min(CONFIG.LAYOUT_MAX_ROWS, layout.rows));
    const perWall = Math.max(1, Math.min(CONFIG.LAYOUT_MAX_PER_WALL, layout.perWall));
    const hGap = Math.max(minGap, layout.colPitch);
    const vGap = Math.max(minGap, layout.rowStep);
    const cap = perWall * 4;
    const place = paintingData.slice(0, cap);

    // Largest painting in this set defines the uniform cell (prevents overlap).
    let maxW = 0.3;
    let maxH = 0.3;
    for (const d of place) {
      const w = Math.max(0.05, (d.widthCm || 40) * CONFIG.CM_TO_UNIT);
      const h = Math.max(0.05, (d.heightCm || 40) * CONFIG.CM_TO_UNIT);
      if (w > maxW) maxW = w;
      if (h > maxH) maxH = h;
    }
    const colPitch = maxW + hGap;
    const rowPitch = maxH + vGap;

    const cols = Math.max(1, Math.ceil(perWall / rows));
    const wallLen = cols * colPitch + CONFIG.ROOM_PADDING_M * 2;

    // Auto-fit wall height to the row stack; bottom row sits ~0.8 m off floor.
    const baseY = 0.8 + maxH / 2;
    const topY = baseY + (rows - 1) * rowPitch;
    const wallHeight = Math.max(CONFIG.WALL_HEIGHT_M, topY + maxH / 2 + 0.8);

    this.dims = { wallLen, height: wallHeight };
    this.layout = { ...layout, colPitch, rowPitch, perWall, rows, maxW, maxH };

    this._buildEnvironment(wallLen, wallHeight);

    // Distribute around 4 walls. Each wall is a line; paintings face inward.
    const walls = [
      { dir: new THREE.Vector3(1, 0, 0), pos: new THREE.Vector3(0, 0, -wallLen / 2), rot: 0 },
      { dir: new THREE.Vector3(-1, 0, 0), pos: new THREE.Vector3(0, 0, wallLen / 2), rot: Math.PI },
      { dir: new THREE.Vector3(0, 0, 1), pos: new THREE.Vector3(-wallLen / 2, 0, 0), rot: Math.PI / 2 },
      { dir: new THREE.Vector3(0, 0, -1), pos: new THREE.Vector3(wallLen / 2, 0, 0), rot: -Math.PI / 2 }
    ];

    const span = (cols - 1) * colPitch;
    let idx = 0;
    for (let w = 0; w < walls.length && idx < place.length; w++) {
      const wall = walls[w];
      const onThis = Math.min(perWall, place.length - idx);
      for (let i = 0; i < onThis; i++) {
        const col = Math.floor(i / rows);
        const row = i % rows;
        const p = new Painting(place[idx++]);
        const offset = -span / 2 + col * colPitch;
        const along = wall.dir.clone().multiplyScalar(offset);
        p.group.position.copy(wall.pos).add(along);
        p.group.position.y = baseY + row * rowPitch;
        p.group.rotation.y = wall.rot;
        this.artRoot.add(p.group);
        this.paintings.push(p);
        enqueueTexture(p);
      }
    }
    return this.paintings;
  }

  _buildEnvironment(wallLen, h = CONFIG.WALL_HEIGHT_M) {
    // Floor
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.9 });
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
        color: 0xffffff,
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

    // Corner columns removed per client request; room is left clear.
  }

  // Environment manipulation: base colors stay fixed (white walls, black floor).
  // Environment mode only adds a subtle emissive glow + fog so the defaults are
  // preserved, clearly distinct from Painting mode and WITHOUT waving the walls.
  applyEnvironmentLook(look, active) {
    if (!this.wallMeshes) return;
    const amt = active ? look.intensity : 0; // 0..1 energy
    const hue = look.hueShift;

    for (const w of this.wallMeshes) {
      w.material.emissive.setHSL(hue, 0.6, active ? look.blend * 0.08 : 0);
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
