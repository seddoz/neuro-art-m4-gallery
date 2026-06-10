import * as THREE from 'three';
import { CONFIG } from './config.js';

// A painting is a subdivided quad with a custom shader. The shader provides:
//  - depth displacement from image luminance (the "enter painting" / breathing
//    look referenced by ahg36 painting-3d-animation), toggled by Animation On/Off
//  - SD "look" uniforms (intensity/contrast/blend/hueShift) so Painting-mode
//    manipulation visibly changes the work even when the SD bridge is offline.

const vertexShader = /* glsl */ `
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
  uniform sampler2D uMap;
  uniform float uIntensity;  // SD intensity 0..1
  uniform float uContrast;   // 0..1
  uniform float uBlend;      // 0..1
  uniform float uHue;        // 0..1
  uniform float uMode;       // 1 = painting mode active (SD affects work)
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
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), tex.a);
  }
`;

const loader = new THREE.TextureLoader();

// Throttled texture-load queue. Hundreds of full-size JPGs cannot all download
// at once; this caps concurrency so the gallery stays responsive.
let active = 0;
const queue = [];
function pump() {
  while (active < CONFIG.TEX_CONCURRENCY && queue.length) {
    const job = queue.shift();
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
}

// Route the image through the same-origin proxy to avoid cross-origin WebGL
// texture failures (the image host does not send CORS headers).
function proxiedImage(photo) {
  return `/img?url=${encodeURIComponent(photo)}`;
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
        uMode: { value: 0 }
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
    } else {
      this.frame = null;
      this._addGlowShell(w, h);
    }

    this._mirrorGlow = false;
    this._glowHue = CONFIG.MIRROR.neonHue;

    this.sizeM = { w, h };
    this.animated = false;
    this.loaded = false;
    // Texture is loaded via the throttled queue (enqueueTexture), not here.
  }

  _addGlowShell(w, h) {
    const d = Math.max(0.02, 0.02);
    const geo = new THREE.BoxGeometry(w * 0.988, h * 0.988, d);
    this.glowShell = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x000000,
      emissiveIntensity: 1,
      roughness: 0.45,
      metalness: 0.25,
      toneMapped: false
    }));
    this.glowShell.visible = false;
    this.glowShell.renderOrder = 1;
    this.glowShell.position.z = -d / 2 - 0.004;
    this.group.add(this.glowShell);
  }

  _glowMeshes() {
    return [this.frame, this.glowShell].filter(Boolean);
  }

  setMirrorGlow(on, hue = CONFIG.MIRROR.neonHue) {
    this._mirrorGlow = !!on;
    this._glowHue = hue;
    const neon = new THREE.Color().setHSL(hue, 1, 0.52);
    const base = CONFIG.MIRROR.neonEmissive;

    if (this.frame) {
      if (on) {
        this.frame.material.emissive.copy(neon);
        this.frame.material.emissiveIntensity = base;
      } else {
        this.frame.material.emissive.setHex(0x000000);
        this.frame.material.emissiveIntensity = 1;
      }
    }
    if (this.glowShell) {
      this.glowShell.visible = on;
      if (on) {
        this.glowShell.material.emissive.copy(neon);
        this.glowShell.material.emissiveIntensity = base;
      } else {
        this.glowShell.material.emissive.setHex(0x000000);
        this.glowShell.material.emissiveIntensity = 1;
      }
    }
  }

  _placeholder() {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, 8, 8);
    return new THREE.CanvasTexture(c);
  }

  // Returns a promise that resolves when the texture is loaded (or failed).
  _doLoad() {
    return new Promise((resolve) => {
      // Skip stale jobs for paintings removed on a page change/rebuild.
      if (this.disposed || !this.data.photo || this.loaded) {
        resolve();
        return;
      }
      loader.load(
        proxiedImage(this.data.photo),
        (tex) => {
          if (this.disposed) {
            tex.dispose();
            resolve();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          this.material.uniforms.uMap.value = tex;
          this.loaded = true;
          resolve();
        },
        undefined,
        () => resolve() // keep placeholder on error
      );
    });
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
    if (this.glowShell) {
      this.glowShell.geometry.dispose();
      this.glowShell.material.dispose();
    }
    const t = this.material.uniforms.uMap.value;
    if (t && t.dispose) t.dispose();
  }
}
