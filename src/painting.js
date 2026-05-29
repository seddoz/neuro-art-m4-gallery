import * as THREE from 'three';
import { CONFIG } from './config.js';

// A painting is a subdivided quad with a custom shader. The shader provides:
//  - depth displacement from image luminance (the "enter painting" / breathing
//    look referenced by ahg36 painting-3d-animation), toggled by Animation On/Off
//  - SD "look" uniforms (intensity/contrast/blend/hueShift) so Painting-mode
//    manipulation visibly changes the work even when the SD bridge is offline.

const vertexShader = /* glsl */ `
  uniform float uDepth;      // displacement amount (metres)
  uniform float uTime;
  uniform float uAnim;       // 0 = flat, 1 = animated
  varying vec2 vUv;
  // luminance sampled in vertex shader needs the texture; we approximate using
  // a second pass would be costly, so we displace by a smooth radial + uv wave
  // modulated later in fragment. Keep geometry displacement subtle and stable.
  void main() {
    vUv = uv;
    vec3 pos = position;
    float wave = sin((uv.x + uv.y) * 12.0 + uTime * 1.5) * 0.5 + 0.5;
    pos.z += uAnim * uDepth * wave;
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
loader.crossOrigin = 'anonymous';

export class Painting {
  constructor(data) {
    this.data = data;
    const w = Math.max(0.05, data.widthCm * CONFIG.CM_TO_UNIT);
    const h = Math.max(0.05, data.heightCm * CONFIG.CM_TO_UNIT);

    // Subdivision lets the vertex displacement read as depth without being heavy.
    const geo = new THREE.PlaneGeometry(w, h, 48, 48);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMap: { value: this._placeholder() },
        uDepth: { value: Math.min(0.25, Math.max(w, h) * 0.18) },
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

    // simple frame so backs are not invisible (Bart's earlier note)
    const frameGeo = new THREE.BoxGeometry(w * 1.06, h * 1.06, data.depthCm * CONFIG.CM_TO_UNIT + 0.02);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.8, metalness: 0.1 });
    this.frame = new THREE.Mesh(frameGeo, frameMat);
    this.frame.position.z = -0.02;

    this.group = new THREE.Group();
    this.group.add(this.frame);
    this.group.add(this.mesh);

    this.sizeM = { w, h };
    this.animated = false;
    this._loadTexture();
  }

  _placeholder() {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, 8, 8);
    return new THREE.CanvasTexture(c);
  }

  _loadTexture() {
    if (!this.data.photo) return;
    loader.load(
      this.data.photo,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this.material.uniforms.uMap.value = tex;
      },
      undefined,
      () => {
        /* keep placeholder on error */
      }
    );
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
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.frame.geometry.dispose();
    this.frame.material.dispose();
    const t = this.material.uniforms.uMap.value;
    if (t && t.dispose) t.dispose();
  }
}
