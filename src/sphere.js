import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Painting, enqueueTexture } from './painting.js';

const loader = new THREE.TextureLoader();

function proxiedImage(url) {
  return `/img?url=${encodeURIComponent(url)}`;
}

function tileSize(wCm, hCm) {
  const aspect = Math.max(0.4, (wCm || 60) / (hCm || 60));
  const base = CONFIG.SPHERE.tileBaseM;
  if (aspect >= 1) return { w: base, h: base / aspect };
  return { w: base * aspect, h: base };
}

// Even distribution on a sphere (Fibonacci lattice).
function spherePoints(n, radius) {
  if (n <= 0) return [];
  if (n === 1) return [new THREE.Vector3(0, 0, radius)];
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push(new THREE.Vector3(
      Math.cos(theta) * r * radius,
      y * radius,
      Math.sin(theta) * r * radius
    ));
  }
  return pts;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Centre collection sphere: filtered paintings + artist tiles on a rotating
// cloud. Tiles billboard toward the camera; no black frames on sphere works.
export class CollectionSphere {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.position.set(0, CONFIG.SPHERE.defaultRadius + CONFIG.SPHERE.floorClearance, 0);
    this.root.visible = false;
    scene.add(this.root);

    this.spin = new THREE.Group();
    this.root.add(this.spin);

    this.paintings = [];
    this.artistMeshes = [];
    this.radius = CONFIG.SPHERE.defaultRadius;
    this.autoRotate = true;
    this._dragTimer = null;
    this._rotateMul = 1;
    this._envBg = new THREE.Color(CONFIG.SCENE_BG);
  }

  clear() {
    for (const p of this.paintings) p.dispose();
    this.paintings = [];
    for (const m of this.artistMeshes) {
      m.geometry?.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
      else m.material?.dispose();
    }
    this.artistMeshes = [];
    this.spin.clear();
  }

  build(paintingData, authors, roomDims) {
    this.clear();

    const L = roomDims?.wallLen ?? 16;
    this.radius = Math.min(L, CONFIG.SPHERE.maxRoomLen) * CONFIG.SPHERE.radiusFactor;
    // Lift sphere so its bottom sits above the floor (y = 0).
    this.root.position.y = this.radius + CONFIG.SPHERE.floorClearance;

    const maxP = CONFIG.SPHERE.maxPaintings;
    const maxA = CONFIG.SPHERE.maxArtists;
    const paintings = paintingData.slice(0, maxP);

    const artistNames = new Set(paintings.map((p) => p.artist).filter(Boolean));
    const authorPool = authors.filter((a) => artistNames.has(a.name));
    const extras = authors.filter((a) => !artistNames.has(a.name));
    shuffle(extras);
    const artistList = [...authorPool, ...extras].slice(0, maxA);

    const total = paintings.length + artistList.length;
    const points = spherePoints(total, this.radius);
    shuffle(points);

    let pi = 0;
    for (const data of paintings) {
      const pos = points[pi++];
      const p = new Painting(data, { framed: false });
      const { w, h } = tileSize(data.widthCm, data.heightCm);
      p.mesh.scale.set(w / p.sizeM.w, h / p.sizeM.h, 1);
      p.sizeM = { w, h };
      p.group.position.copy(pos);
      this.spin.add(p.group);
      this.paintings.push(p);
      enqueueTexture(p);
    }

    for (const author of artistList) {
      const pos = points[pi++];
      const mesh = this._mkArtistTile(author, pos);
      this.spin.add(mesh);
      this.artistMeshes.push(mesh);
    }
  }

  _mkArtistTile(author, pos) {
    const s = CONFIG.SPHERE.artistTileM;
    const geo = new THREE.PlaneGeometry(s, s);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2a2838,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData = { type: 'artist', name: author.name, photo: author.photo };

    if (author.photo) {
      loader.load(
        proxiedImage(author.photo),
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        },
        undefined,
        () => { /* keep placeholder */ }
      );
    }

    return mesh;
  }

  setVisible(on) {
    this.root.visible = !!on;
  }

  get centerY() {
    return this.root.position.y;
  }

  pauseAutoRotate() {
    this.autoRotate = false;
    if (this._dragTimer) clearTimeout(this._dragTimer);
  }

  resumeAutoRotateAfter(ms = CONFIG.SPHERE.resumeRotateMs) {
    if (this._dragTimer) clearTimeout(this._dragTimer);
    this._dragTimer = setTimeout(() => {
      this.autoRotate = true;
      this._dragTimer = null;
    }, ms);
  }

  getPaintingMeshes() {
    return this.paintings.map((p) => p.mesh);
  }

  getPickables() {
    return [...this.getPaintingMeshes(), ...this.artistMeshes];
  }

  pick(clientX, clientY, camera, raycaster, pointer) {
    pointer.x = (clientX / innerWidth) * 2 - 1;
    pointer.y = -(clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(this.getPickables(), false);
    if (!hits.length) return null;
    const obj = hits[0].object;
    if (obj.userData.painting) {
      return { type: 'painting', painting: obj.userData.painting, data: obj.userData.painting.data };
    }
    if (obj.userData.type === 'artist') {
      return { type: 'artist', data: { title: obj.userData.name, artist: obj.userData.name } };
    }
    return null;
  }

  applyLook(look, paintingMode, selectedPainting) {
    for (const p of this.paintings) {
      const active = paintingMode && p === selectedPainting;
      p.applyLook(look, active);
    }
  }

  // Environment mode in sphere view: fog, background, spin rate, artist tile tint.
  applyEnvironmentLook(look, active) {
    const baseFog = 0.0025;
    if (this.scene.fog) {
      this.scene.fog.density = baseFog + (active ? look.intensity * 0.014 : 0);
    }
    if (active) {
      this.scene.background.setHSL(look.hueShift, 0.18 + look.contrast * 0.12, 0.07 + look.blend * 0.04);
    } else {
      this.scene.background.copy(this._envBg);
    }
    this._rotateMul = active ? 0.4 + look.blend * 1.6 : 1;
    for (const m of this.artistMeshes) {
      const mat = m.material;
      if (!mat || mat.map) continue;
      mat.color.setHSL(look.hueShift, active ? 0.25 : 0, active ? 0.32 + look.intensity * 0.12 : 0.18);
    }
  }

  update(dt, camera) {
    if (this.autoRotate) {
      this.spin.rotation.y += CONFIG.SPHERE.autoRotateSpeed * this._rotateMul * dt;
    }
    const camPos = camera.position;
    for (const p of this.paintings) {
      p.group.lookAt(camPos);
      p.update(dt);
    }
    for (const m of this.artistMeshes) {
      m.lookAt(camPos);
    }
  }
}
