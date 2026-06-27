import * as THREE from 'three';
import { CONFIG } from './config.js';

// A painting is a subdivided quad with a custom shader. The shader provides:
//  - depth displacement from image luminance (the "enter painting" / breathing
//    look referenced by ahg36 painting-3d-animation), toggled by Animation On/Off
//  - SD "look" uniforms (intensity/contrast/blend/hueShift) so Painting-mode
//    manipulation visibly changes the work even when the SD bridge is offline.

const vertexShader = /* glsl */ `
  precision mediump float;
  uniform float uDepth;      // displacement amount (metres), small
  uniform float uTime;
  uniform float uAnim;       // 0 = flat, 1 = animated
  varying vec2 vUv;
  // Gentle "breathing" depth: the centre eases toward the viewer and back while
  // the edges stay pinned, so the quad never tears at the corners. Flat when off.
  void main() {
    vUv = uv;
    vec3 pos = position;
    float edge = smoothstep(0.0, 0.5, 0.5 - distance(uv, vec2(0.5))); // 0 at edge, ~1 at centre
    float breathe = sin(uTime * 1.1) * 0.5 + 0.5;                     // 0..1
    pos.z += uAnim * uDepth * edge * breathe;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  uniform sampler2D uMap;
  uniform float uIntensity;  // SD intensity 0..1
  uniform float uContrast;   // 0..1
  uniform float uBlend;      // 0..1
  uniform float uHue;        // 0..1
  uniform float uMode;       // 1 = painting mode active (SD affects work)
  uniform float uDirectLift; // mirror mode: match direct view to reflection brightness
  varying vec2 vUv;

  vec3 hueShift(vec3 color, float h) {
    const vec3 k = vec3(0.57735);
    float c = cos(h * 6.2831853);
    return color * c + cross(k, color) * sin(h * 6.2831853) + k * dot(k, color) * (1.0 - c);
  }

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    vec3 col = tex.rgb;
    if (uMode > 0.5) {
      // contrast around mid grey
      col = mix(vec3(0.5), col, 1.0 + uContrast * 1.5);
      // hue rotation driven by seed
      col = hueShift(col, uHue * uBlend);
      // intensity boosts saturation-ish punch
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.0 + uIntensity);
    }
    col *= (1.0 + uDirectLift);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), tex.a);
  }
`;

const loader = new THREE.TextureLoader();

// Two-tier throttled texture queue (BR-028 faster load):
//  - `queue`        primary: -scaled photo downscaled to TEX_PREVIEW_DIM
//                   (correct aspect, fast first paint — never square crops).
//  - `upgradeQueue` low priority: full-res sharpen that runs only once every
//                   pending preview has started.
// Hundreds of full-size JPGs cannot all download at once; concurrency is capped.
let active = 0;
const queue = [];
const upgradeQueue = [];
function pump() {
  while (active < CONFIG.TEX_CONCURRENCY && (queue.length || upgradeQueue.length)) {
    // Drain all primary (thumbnail) jobs before any full-res upgrade.
    const job = queue.length ? queue.shift() : upgradeQueue.shift();
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}
export function enqueueTexture(p) {
  queue.push(() => p._doLoad());
  pump();
}

// Drop all pending (not-yet-started) texture jobs. Called on every gallery
// rebuild/page change so a new page's textures are not stuck behind hundreds of
// stale jobs from the page we just left (the cause of "next/prev doesn't load"
// at high paintings-per-wall counts). In-flight loads finish harmlessly because
// disposed paintings short-circuit in _doLoad.
export function resetTextureQueue() {
  queue.length = 0;
  upgradeQueue.length = 0;
}

// Route the image through the same-origin proxy to avoid cross-origin WebGL
// texture failures (the image host does not send CORS headers).
function proxiedImage(photo) {
  return `/img?url=${encodeURIComponent(photo)}`;
}

// Shrink oversized photos before uploading to GPU (critical on mobile Safari).
// Must never throw: a failure here previously stalled the whole texture queue
// (one bad big image -> some paintings load, the rest stay blank). On any
// error we fall back to the original texture, which the GPU can still upload.
function downscaleTexture(tex, maxDim) {
  try {
    if (!maxDim || maxDim <= 0) return tex;
    const img = tex.image;
    if (!img || !img.width || !img.height) return tex;
    const w = img.width;
    const h = img.height;
    if (w <= maxDim && h <= maxDim) return tex;
    const scale = maxDim / Math.max(w, h);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return tex;
    ctx.drawImage(img, 0, 0, cw, ch);
    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    tex.dispose();
    return out;
  } catch {
    return tex; // keep full-size texture rather than losing the painting
  }
}

export class Painting {
  constructor(data, { framed = true } = {}) {
    this.data = data;
    this.framed = framed;
    const w = Math.max(0.05, data.widthCm * CONFIG.CM_TO_UNIT);
    const h = Math.max(0.05, data.heightCm * CONFIG.CM_TO_UNIT);

    // Subdivision lets the vertex displacement read as depth without being heavy.
    const geo = new THREE.PlaneGeometry(w, h, 16, 16);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMap: { value: this._placeholder() },
        uDepth: { value: Math.min(0.05, Math.max(w, h) * 0.05) },
        uTime: { value: 0 },
        uAnim: { value: 0 },
        uIntensity: { value: 0 },
        uContrast: { value: 0 },
        uBlend: { value: 0 },
        uHue: { value: 0 },
        uMode: { value: 0 },
        uDirectLift: { value: 0 }
      },
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.userData.painting = this;
    // Forward offset keeps the canvas clearly in front of the frame plane.
    this.mesh.position.z = 0.01;
    this.mesh.renderOrder = 2;

    this.group = new THREE.Group();
    this.group.add(this.mesh);

    if (framed) {
      // Frame: a black backing box kept slightly SMALLER than the canvas so the
      // canvas always overhangs and fully occludes the frame's front face from
      // every angle. The front face is also recessed well behind the canvas and
      // the material uses polygon offset, so the two parallel planes can never
      // z-fight (the cause of the black edge flicker seen while the camera moved).
      const frameDepth = Math.max(0.02, data.depthCm * CONFIG.CM_TO_UNIT * 0.5);
      const frameInset = 0.985;
      const frameGeo = new THREE.BoxGeometry(w * frameInset, h * frameInset, frameDepth);
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0.8,
        metalness: 0.1,
        emissive: 0x000000,
        emissiveIntensity: 1,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
      });
      this.frame = new THREE.Mesh(frameGeo, frameMat);
      this.frame.renderOrder = 1;
      this.frame.position.z = -frameDepth / 2 - 0.004;
      this.group.add(this.frame);
      // Halo plate sits behind the frame box; the frame is inset and fully
      // occluded head-on, so the plate is what makes the neon visible directly.
      this._addNeonPlate(w, h, -(frameDepth + 0.012));
    } else {
      this.frame = null;
      // No frame on sphere tiles: the plate alone provides the neon halo.
      this._addNeonPlate(w, h, -0.008);
    }

    this._mirrorGlow = false;

    this.sizeM = { w, h };
    this.animated = false;
    this.loaded = false;
    // Texture is loaded via the throttled queue (enqueueTexture), not here.
  }

  // Flat neon backing, mirror mode only. Slightly larger than the canvas so a
  // thin halo is visible from the front; depth offset clears the frame box.
  _addNeonPlate(w, h, z = -0.008) {
    const rim = CONFIG.MIRROR.neonRim;
    this._neonZ = z;
    this.neonPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(w * rim, h * rim),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x000000,
        emissiveIntensity: 1,
        roughness: 0.35,
        metalness: 0.2,
        toneMapped: false,
        side: THREE.DoubleSide
      })
    );
    this.neonPlate.visible = false;
    this.neonPlate.renderOrder = 1;
    this.neonPlate.position.z = z;
    this.group.add(this.neonPlate);
  }

  // Match neon plate to the displayed tile size (sphere scales paintings down/up).
  syncNeonPlateSize(w, h) {
    this.sizeM = { w, h };
    if (!this.neonPlate) return;
    const rim = CONFIG.MIRROR.neonRim;
    this.neonPlate.geometry.dispose();
    this.neonPlate.geometry = new THREE.PlaneGeometry(w * rim, h * rim);
    this.neonPlate.position.z = this._neonZ ?? -0.008;
  }

  _glowMeshes() {
    return [this.frame, this.neonPlate].filter(Boolean);
  }

  setMirrorGlow(on, hue = CONFIG.MIRROR.neonHue) {
    // Mirror room: canvas only — no neon halo or black frame box in reflections.
    this._mirrorGlow = false;
    this.material.uniforms.uDirectLift.value = on ? (CONFIG.MIRROR.directLift ?? 0) : 0;
    if (this.frame) {
      this.frame.visible = !on;
      this.frame.material.emissive.setHex(0x000000);
      this.frame.material.emissiveIntensity = 1;
    }
    if (this.neonPlate) {
      this.neonPlate.visible = false;
      this.neonPlate.material.emissive.setHex(0x000000);
      this.neonPlate.material.emissiveIntensity = 1;
    }
  }

  _placeholder() {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d');
    // Slightly lighter than void so loading tiles are visible on mobile + mirror mode.
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(0, 0, 8, 8);
    return new THREE.CanvasTexture(c);
  }

  // Apply a freshly loaded texture to the quad. Guarded so any exception still
  // resolves the queue job (a throw here previously stalled the whole queue).
  _applyTexture(tex, { preview = false } = {}) {
    const maxDim = preview
      ? CONFIG.TEX_PREVIEW_DIM
      : CONFIG.TEX_MAX_DIM || 0;
    const ready = downscaleTexture(tex, maxDim);
    ready.colorSpace = THREE.SRGBColorSpace;
    ready.anisotropy = CONFIG.TEXTURE_ANISOTROPY ?? 8;
    const old = this.material.uniforms.uMap.value;
    this.material.uniforms.uMap.value = ready;
    this.loaded = true;
    if (!preview) this._fullLoaded = true;
    // Dispose the replaced texture (placeholder or thumb), never the new one.
    if (old && old.dispose && old !== ready) old.dispose();
  }

  // Returns a promise that resolves when the aspect-correct preview is loaded.
  // Full sharpen is queued at low priority on desktop (BR-028).
  _doLoad() {
    return new Promise((resolve) => {
      // Skip stale jobs for paintings removed on a page change/rebuild.
      if (this.disposed || !this.data.photo || this.loaded) {
        resolve();
        return;
      }
      const photo = this.data.photo;

      loader.load(
        proxiedImage(photo),
        (tex) => {
          try {
            if (this.disposed) {
              tex.dispose();
              return;
            }
            this._applyTexture(tex, { preview: true });
            if (CONFIG.AUTO_UPGRADE !== false) this.upgradeFullRes();
          } catch {
            /* keep placeholder; never block the queue */
          } finally {
            resolve();
          }
        },
        undefined,
        () => resolve()
      );
    });
  }

  // Queue a full-resolution load that swaps in when ready. Safe to call
  // repeatedly; runs after previews. Used for background sharpening and forced
  // on the selected/entered painting regardless of device.
  upgradeFullRes() {
    if (this.disposed || this._fullLoaded || this._upgrading || !this.data.photo) return;
    this._upgrading = true;
    upgradeQueue.push(
      () =>
        new Promise((resolve) => {
          if (this.disposed || this._fullLoaded) {
            resolve();
            return;
          }
          loader.load(
            proxiedImage(this.data.photo),
            (tex) => {
              try {
                if (this.disposed) {
                  tex.dispose();
                  return;
                }
                this._applyTexture(tex, { preview: false });
              } catch {
                /* keep preview */
              } finally {
                this._upgrading = false;
                resolve();
              }
            },
            undefined,
            () => {
              this._upgrading = false;
              resolve();
            }
          );
        })
    );
    pump();
  }

  setAnimated(on) {
    this.animated = on;
    this.material.uniforms.uAnim.value = on ? 1 : 0;
  }

  // Painting-mode look from SD controller.
  applyLook(look, active) {
    const u = this.material.uniforms;
    u.uMode.value = active ? 1 : 0;
    u.uIntensity.value = look.intensity;
    u.uContrast.value = look.contrast;
    u.uBlend.value = look.blend;
    u.uHue.value = look.hueShift;
  }

  update(dt) {
    this.material.uniforms.uTime.value += dt;
    if (this._mirrorGlow) {
      const pulse = 0.82 + 0.18 * Math.sin(this.material.uniforms.uTime.value * 2.4);
      const intensity = CONFIG.MIRROR.neonEmissive * pulse;
      for (const m of this._glowMeshes()) {
        m.material.emissiveIntensity = intensity;
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.frame) {
      this.frame.geometry.dispose();
      this.frame.material.dispose();
    }
    if (this.neonPlate) {
      this.neonPlate.geometry.dispose();
      this.neonPlate.material.dispose();
    }
    const t = this.material.uniforms.uMap.value;
    if (t && t.dispose) t.dispose();
  }
}
