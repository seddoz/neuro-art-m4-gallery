// "Machine Hallucination" effect for the SELECTED painting.
//
// A real-time, in-browser approximation of Refik Anadol's "Unsupervised —
// Machine Hallucinations — MoMA" data-pigment aesthetic:
//   https://refikanadol.com/works/unsupervised/
//
// Anadol's piece runs a StyleGAN2 model on a dedicated GPU rig, which cannot run
// live inside a browser. Instead of a GAN, this reconstructs the *look* — the
// artwork dissolving into a continuously flowing, morphing field of its own
// colours ("data pigments") — with a domain-warped fbm flow shader driven by the
// selected painting's texture. It runs on any device and needs no offline
// generation, so Bart can feel the effect + sliders on staging immediately.
//
// Same single-instance / selected-only pattern as Marching Cubes + Houdini FX:
//   - ONE shared plane for the whole app; only the selected painting shows it.
//   - Built lazily on first enable; visitors who never use it pay nothing.
//   - Pure fragment work (no geometry cost), so it is cheap even on mobile.
import * as THREE from 'three';

export const HALLUCINATION_DEFAULTS = {
  enabled: true, // master switch (panel checkbox)
  playing: true, // animate / freeze the flow
  speed: 0.5, // time multiplier for the churn
  flow: 0.35, // domain-warp strength (how much the image melts/flows)
  scale: 2.2, // pattern frequency (structure size of the flow)
  colorDrift: 0.25, // latent hue drift over time (the "data pigment" churn)
  mix: 0.85, // 0 = original artwork, 1 = fully hallucinated
  brightness: 1.0,
  size: 1.0, // plane size as a multiple of the painting size
  offset: 0.02, // metres the field floats in front of the canvas
  opacity: 1.0
};

export class HallucinationEffect {
  constructor({ mobile = false } = {}) {
    // Fewer fbm octaves on phones keeps the flow cheap without changing the look.
    this._octaves = mobile ? 4 : 6;
    this.params = { ...HALLUCINATION_DEFAULTS };

    this._mesh = null; // created lazily
    this._material = null;
    this._artworkTex = null;
    this._time = 0;
    this._built = false;

    this._pos = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
  }

  _placeholderTex() {
    if (!this._placeholder) {
      this._placeholder = new THREE.DataTexture(
        new Uint8Array([200, 200, 200, 255]),
        1,
        1,
        THREE.RGBAFormat
      );
      this._placeholder.needsUpdate = true;
    }
    return this._placeholder;
  }

  _buildMaterial() {
    this._material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: this._artworkTex || this._placeholderTex() },
        uTime: { value: 0 },
        uFlow: { value: this.params.flow },
        uScale: { value: this.params.scale },
        uDrift: { value: this.params.colorDrift },
        uMix: { value: this.params.mix },
        uBright: { value: this.params.brightness },
        uOpacity: { value: this.params.opacity }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uFlow;
        uniform float uScale;
        uniform float uDrift;
        uniform float uMix;
        uniform float uBright;
        uniform float uOpacity;
        varying vec2 vUv;

        float hash(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p){
          float v = 0.0;
          float amp = 0.5;
          for (int i = 0; i < ${this._octaves}; i++) {
            v += amp * noise(p);
            p = p * 2.02 + vec2(1.7, 9.2);
            amp *= 0.5;
          }
          return v;
        }
        // Rotate hue for the "latent" colour churn (data-pigment drift).
        vec3 hueShift(vec3 col, float a){
          const vec3 k = vec3(0.57735);
          float c = cos(a);
          return col * c + cross(k, col) * sin(a) + k * dot(k, col) * (1.0 - c);
        }

        void main(){
          vec2 uv = vUv;
          float t = uTime;

          // Domain warping: two nested fbm fields advected over time make the
          // artwork melt and flow like Anadol's fluid latent walk.
          vec2 q = vec2(
            fbm(uv * uScale + vec2(0.0, 0.0) + t * 0.10),
            fbm(uv * uScale + vec2(5.2, 1.3) + t * 0.13)
          );
          vec2 r = vec2(
            fbm(uv * uScale + 4.0 * q + vec2(1.7, 9.2) + t * 0.15),
            fbm(uv * uScale + 4.0 * q + vec2(8.3, 2.8) + t * 0.126)
          );
          vec2 warp = (mix(q, r, 0.5) - 0.5) * uFlow;

          vec3 a1 = texture2D(uMap, clamp(uv + warp, 0.0, 1.0)).rgb;
          vec3 a2 = texture2D(uMap, clamp(uv + warp * 1.8 + 0.015, 0.0, 1.0)).rgb;
          vec3 dream = mix(a1, a2, 0.5);

          float f = r.x * 0.6 + q.y * 0.4;
          dream = hueShift(dream, (f - 0.5) * 6.28318 * uDrift + t * 0.2 * uDrift);
          dream = pow(max(dream, 0.0), vec3(0.9)); // gentle contrast lift

          vec3 baseArt = texture2D(uMap, uv).rgb;
          vec3 col = mix(baseArt, dream, uMix) * uBright;
          gl_FragColor = vec4(col, uOpacity);
        }
      `
    });
  }

  ensure(scene) {
    if (this._built) return;
    this._buildMaterial();
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this._mesh = new THREE.Mesh(geo, this._material);
    this._mesh.visible = false;
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 3; // after paintings/frames
    scene.add(this._mesh);
    this._scene = scene;
    this._built = true;
  }

  setVisible(on) {
    if (this._mesh) this._mesh.visible = !!on && this.params.enabled;
  }

  setEnabled(on) {
    this.params.enabled = !!on;
    if (this._mesh && !on) this._mesh.visible = false;
  }

  setArtworkTexture(tex) {
    this._artworkTex = tex || null;
    if (this._material) {
      this._material.uniforms.uMap.value = this._artworkTex || this._placeholderTex();
    }
  }

  setParam(key, value) {
    this.params[key] = value;
    if (!this._material) return;
    const u = this._material.uniforms;
    switch (key) {
      case 'flow':
        u.uFlow.value = value;
        break;
      case 'scale':
        u.uScale.value = value;
        break;
      case 'colorDrift':
        u.uDrift.value = value;
        break;
      case 'mix':
        u.uMix.value = value;
        break;
      case 'brightness':
        u.uBright.value = value;
        break;
      case 'opacity':
        u.uOpacity.value = value;
        break;
      default:
        break;
    }
  }

  // Position/scale/orient the field over the selected painting. Called each
  // visible frame with the painting's world transform and display size.
  place(group, sizeM) {
    if (!this._mesh) return;
    group.getWorldPosition(this._pos);
    group.getWorldQuaternion(this._quat);
    this._normal.set(0, 0, 1).applyQuaternion(this._quat).normalize();

    const w = (sizeM?.w || 1) * this.params.size;
    const h = (sizeM?.h || 1) * this.params.size;
    this._mesh.scale.set(w, h, 1);
    this._mesh.quaternion.copy(this._quat);
    this._mesh.position.copy(this._pos).addScaledVector(this._normal, this.params.offset);
  }

  update(dt) {
    if (!this._mesh || !this._mesh.visible) return;
    if (this.params.playing) this._time += dt * this.params.speed;
    this._material.uniforms.uTime.value = this._time;
  }

  dispose() {
    if (this._mesh) {
      this._scene?.remove(this._mesh);
      this._mesh.geometry.dispose();
    }
    this._material?.dispose();
    this._built = false;
  }
}
