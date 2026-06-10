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

function disposeObject3D(obj) {
  obj.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
  });
}

// Artist tiles float outward + slightly above their paired painting on the sphere.
function artistAirPosition(paintPos, radius) {
  const dir = paintPos.clone().normalize();
  const hover = radius + CONFIG.SPHERE.artistHoverM;
  const pos = dir.multiplyScalar(hover);
  pos.y += CONFIG.SPHERE.artistLiftM;
  return pos;
}

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
  }

  clear() {
    for (const p of this.paintings) p.dispose();
    this.paintings = [];
    for (const g of this.artistMeshes) disposeObject3D(g);
    this.artistMeshes = [];
    this.spin.clear();
  }

  build(paintingData, authors, roomDims) {
    this.clear();

    const L = roomDims?.wallLen ?? 16;
    this.radius = Math.min(L, CONFIG.SPHERE.maxRoomLen) * CONFIG.SPHERE.radiusFactor;
    this.root.position.y = this.radius + CONFIG.SPHERE.floorClearance;

    const maxP = CONFIG.SPHERE.maxPaintings;
    const maxA = CONFIG.SPHERE.maxArtists;
    const paintings = paintingData.slice(0, maxP);

    const artistNames = new Set(paintings.map((p) => p.artist).filter(Boolean));
    const authorPool = authors.filter((a) => artistNames.has(a.name));
    const extras = authors.filter((a) => !artistNames.has(a.name));
    shuffle(extras);
    let artistList = [...authorPool, ...extras].slice(0, maxA);
    if (!artistList.length && artistNames.size) {
      artistList = [...artistNames].slice(0, maxA).map((name) => ({ name, photo: '' }));
    }

    const paintPoints = spherePoints(paintings.length, this.radius);
    shuffle(paintPoints);

    const slots = [];
    for (let i = 0; i < paintings.length; i++) {
      const data = paintings[i];
      const pos = paintPoints[i];
      const p = new Painting(data, { framed: false });
      const { w, h } = tileSize(data.widthCm, data.heightCm);
      p.mesh.scale.set(w / p.sizeM.w, h / p.sizeM.h, 1);
      p.sizeM = { w, h };
      p.group.position.copy(pos);
      this.spin.add(p.group);
      this.paintings.push(p);
      enqueueTexture(p);
      slots.push({ pos, data });
    }

    const usedSlots = new Set();
    for (const author of artistList) {
      let slotIdx = slots.findIndex((s, i) => s.data.artist === author.name && !usedSlots.has(i));
      if (slotIdx < 0) {
        slotIdx = slots.findIndex((_, i) => !usedSlots.has(i));
      }
      if (slotIdx < 0) slotIdx = Math.floor(Math.random() * slots.length);
      usedSlots.add(slotIdx);

      const airPos = artistAirPosition(slots[slotIdx].pos.clone(), this.radius);
      const group = this._mkArtistTile(author, airPos);
      this.spin.add(group);
      this.artistMeshes.push(group);
    }
  }

  _mkArtistTile(author, pos) {
    const s = CONFIG.SPHERE.artistTileM;
    const group = new THREE.Group();
    group.position.copy(pos);
    group.userData = { type: 'artist', name: author.name, photo: author.photo };
    group.renderOrder = 10;

    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(s * 1.15, s * 1.15),
      new THREE.MeshBasicMaterial({ color: 0x7c83ff, side: THREE.DoubleSide })
    );
    ring.position.z = -0.003;
    ring.renderOrder = 10;
    group.add(ring);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2e2c42';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#e8e8f0';
    ctx.font = '600 20px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let line = '';
    let y = 118;
    for (const w of author.name.split(/\s+/)) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > 220 && line) {
        ctx.fillText(line, 128, y);
        line = w;
        y += 24;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, 128, y);
    ctx.font = '500 11px Segoe UI, sans-serif';
    ctx.fillStyle = '#9a9ab0';
    ctx.fillText('ARTIST', 128, y + 28);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true })
    );
    face.renderOrder = 11;
    face.userData = group.userData;
    group.add(face);

    if (author.photo) {
      loader.load(
        proxiedImage(author.photo),
        (photoTex) => {
          photoTex.colorSpace = THREE.SRGBColorSpace;
          ctx.drawImage(photoTex.image, 0, 0, 256, 256);
          ctx.fillStyle = 'rgba(20,20,30,0.55)';
          ctx.fillRect(0, 200, 256, 56);
          ctx.fillStyle = '#fff';
          ctx.font = '600 18px Segoe UI, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(author.name, 128, 232);
          tex.needsUpdate = true;
        },
        undefined,
        () => { /* keep name placeholder */ }
      );
    }

    return group;
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
    const meshes = [...this.getPaintingMeshes()];
    for (const g of this.artistMeshes) {
      g.traverse((c) => {
        if (c.isMesh) meshes.push(c);
      });
    }
    return meshes;
  }

  pick(clientX, clientY, camera, raycaster, pointer) {
    pointer.x = (clientX / innerWidth) * 2 - 1;
    pointer.y = -(clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(this.getPickables(), false);
    if (!hits.length) return null;
    let obj = hits[0].object;
    if (obj.userData.painting) {
      return { type: 'painting', painting: obj.userData.painting, data: obj.userData.painting.data };
    }
    while (obj && obj.userData?.type !== 'artist') obj = obj.parent;
    if (obj?.userData?.type === 'artist') {
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

  applyEnvironmentLook(look, active) {
    this._rotateMul = active ? 0.4 + look.blend * 1.6 : 1;
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
    for (const g of this.artistMeshes) {
      g.lookAt(camPos);
    }
  }
}
