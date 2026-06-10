import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Painting, enqueueTexture, resetTextureQueue } from './painting.js';
import { packWallColumns, paintingSizeM } from './wallPack.js';

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

  // Lay paintings around a rectangular hall. Rows per wall = max stack height per
  // column; paintings per wall sets count. Each column uses real painting sizes
  // with minimum edge gaps (no uniform oversized cells).
  build(paintingData, layout) {
    this.clear();
    const minGap = CONFIG.LAYOUT_MIN_GAP;
    const rows = Math.max(1, Math.min(CONFIG.LAYOUT_MAX_ROWS, layout.rows));
    const perWall = Math.max(1, Math.min(CONFIG.LAYOUT_MAX_PER_WALL, layout.perWall));
    const hGap = Math.max(minGap, layout.colPitch);
    const vGap = Math.max(minGap, layout.rowStep);
    const cap = Math.min(CONFIG.LAYOUT_MAX_TOTAL, perWall * 4);
    const place = paintingData.slice(0, cap);

    const wallChunks = [];
    let idx = 0;
    for (let w = 0; w < 4 && idx < place.length; w++) {
      const onThis = Math.min(perWall, place.length - idx);
      wallChunks.push(place.slice(idx, idx + onThis));
      idx += onThis;
    }
    while (wallChunks.length < 4) wallChunks.push([]);

    const packs = wallChunks.map((chunk) => {
      const items = chunk.map((data) => ({ data, ...paintingSizeM(data) }));
      return packWallColumns(items, rows, hGap, vGap);
    });

    let wallLen = 8;
    let wallHeight = CONFIG.WALL_HEIGHT_M;
    for (const pack of packs) {
      wallLen = Math.max(wallLen, pack.width + CONFIG.ROOM_PADDING_M * 2);
      wallHeight = Math.max(wallHeight, pack.topY + 0.8);
    }

    this.dims = { wallLen, height: wallHeight };
    this.layout = { ...layout, perWall, rows, hGap, vGap };

    this._buildEnvironment(wallLen, wallHeight);

    const half = wallLen / 2;
    const walls = [
      { dir: new THREE.Vector3(1, 0, 0), pos: new THREE.Vector3(0, 0, -half), rot: 0 },
      { dir: new THREE.Vector3(-1, 0, 0), pos: new THREE.Vector3(0, 0, half), rot: Math.PI },
      { dir: new THREE.Vector3(0, 0, 1), pos: new THREE.Vector3(-half, 0, 0), rot: Math.PI / 2 },
      { dir: new THREE.Vector3(0, 0, -1), pos: new THREE.Vector3(half, 0, 0), rot: -Math.PI / 2 }
    ];

    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w];
      for (const slot of packs[w].placed) {
        const p = new Painting(slot.data);
        const along = wall.dir.clone().multiplyScalar(slot.cx);
        p.group.position.copy(wall.pos).add(along);
        p.group.position.y = slot.cy;
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
