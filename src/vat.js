// Houdini FX (Vertex Animation Texture) playback for the SELECTED painting.
//
// Concept ported from the Houdini -> three.js VAT workflow Bart shared:
//   https://github.com/arqtiq/houTHREEni
//   https://github.com/floating-world-lda/vat3-wgsl-ts
//
// A VAT asset bakes a simulation (cloth / flag / soft body) into a texture of
// per-vertex, per-frame position offsets. At runtime the GPU reconstructs the
// animation by sampling that texture in the vertex shader instead of running the
// simulation on the CPU. This module implements that runtime for our WebGL
// gallery (the vat3-wgsl repo is WebGPU/WGSL, which our WebGLRenderer can't run,
// so we use the same VAT texture technique in GLSL).
//
// Because we don't yet have a Houdini export from Bart, we ship ONE baked sample
// (a pinned flag/cloth wave) generated deterministically at load so he can "feel"
// the effect + sliders on staging. `loadBakedFrames()` is the seam where a real
// houTHREEni / VAT3 export would later be plugged in without touching the runtime.
//
// Design goals (match Marching Cubes for perf/quality parity):
//   - ONE shared mesh for the whole app; only the selected painting shows it.
//   - Built lazily on first enable; visitors who never use it pay nothing.
//   - Grid resolution + frame count capped on mobile (VAT texture size + vertex
//     work scale with them), same spirit as device.js / BR-028.
//   - Sub-frame interpolation (lerp between two baked frames) for smooth, low-
//     payload playback, exactly like the houTHREEni "runtime sub-frames" feature.
import * as THREE from 'three';

export const VAT_DEFAULTS = {
  enabled: true, // master switch (panel checkbox)
  playing: true, // play / pause the baked animation
  speed: 1.0, // playback speed multiplier
  scrub: 0.0, // 0..1 manual frame position, used only while paused
  amplitude: 1.0, // multiplies the baked displacement
  scale: 1.0, // cloth size as a multiple of the painting size
  offset: 0.05, // metres the cloth floats in front of the canvas
  opacity: 1.0,
  loop: true,
  material: 'artwork', // artwork | color | wire
  color: '#c0c7d0'
};

// Baked animation frames per second (the sample is authored at this rate).
const BAKE_FPS = 24;

// Grid / frame caps. VAT texture is (vertsPerFrame x frames); vertex work scales
// with the grid, so phones get a tighter ceiling to stay smooth.
const CAPS = {
  desktop: { seg: 48, frames: 48 },
  mobile: { seg: 24, frames: 24 }
};

export class VATEffect {
  constructor({ mobile = false } = {}) {
    this.caps = mobile ? CAPS.mobile : CAPS.desktop;
    this.params = { ...VAT_DEFAULTS };

    this._mesh = null; // created lazily
    this._material = null;
    this._vatTex = null;
    this._artworkTex = null;
    this._frames = this.caps.frames;
    this._vertCount = 0;
    this._frame = 0; // continuous frame cursor (fractional for sub-frame lerp)
    this._built = false;

    // Scratch objects reused every frame (no per-frame allocation).
    this._pos = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
  }

  // Bake ONE sample simulation: a flag pinned at its left edge waving in wind.
  // Returns { positions:Float32Array(vertCount*frames*4), vertCount }.
  // This is the seam a real Houdini/VAT export would replace.
  _bakeSampleVAT(basePositions, vertCount, frames) {
    const data = new Float32Array(vertCount * frames * 4);
    for (let f = 0; f < frames; f++) {
      const phase = (f / frames) * Math.PI * 2.0;
      const rowBase = f * vertCount * 4;
      for (let i = 0; i < vertCount; i++) {
        // Base plane coords are in [-0.5, 0.5].
        const x = basePositions[i * 3 + 0];
        const y = basePositions[i * 3 + 1];
        // Distance from the pinned (left) edge, 0 at pin -> 1 at free edge.
        const free = x + 0.5;
        // Primary travelling wave along the flag, amplitude grows toward the free
        // edge so the pinned side stays anchored (classic flag look).
        const wave =
          Math.sin(free * 6.0 - phase * 2.0) * 0.16 * free +
          Math.sin(free * 11.0 - phase * 3.0) * 0.05 * free;
        // Vertical ripple so it reads as cloth, not a 1D strip.
        const ripple = Math.sin(y * 5.0 + phase * 1.5) * 0.03 * free;
        const o = rowBase + i * 4;
        data[o + 0] = 0.0; // no in-plane x drift
        data[o + 1] = ripple * 0.4; // slight y billow
        data[o + 2] = wave + ripple; // z = out-of-plane displacement (metres, unit plane)
        data[o + 3] = 1.0;
      }
    }
    return data;
  }

  _buildVATTexture() {
    const seg = this.caps.seg;
    const geo = new THREE.PlaneGeometry(1, 1, seg, seg);
    const basePos = geo.attributes.position.array;
    const vertCount = geo.attributes.position.count;
    this._vertCount = vertCount;

    // Per-vertex column coordinate into the VAT texture (u = which vertex).
    const vatU = new Float32Array(vertCount);
    for (let i = 0; i < vertCount; i++) vatU[i] = (i + 0.5) / vertCount;
    geo.setAttribute('aVatU', new THREE.BufferAttribute(vatU, 1));

    const frames = this._frames;
    const baked = this._bakeSampleVAT(basePos, vertCount, frames);
    const tex = new THREE.DataTexture(baked, vertCount, frames, THREE.RGBAFormat, THREE.FloatType);
    // Nearest sampling + manual frame lerp in the shader avoids depending on the
    // OES_texture_float_linear extension (not universal on mobile).
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    this._vatTex = tex;
    return geo;
  }

  // The cloth samples the VAT texture in the vertex shader (two frames + lerp).
  // Fragment shows the painting (artwork mode) or a flat color, with a soft
  // depth-cue from the displacement so the folds read without real normals.
  _buildMaterial() {
    this._material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uVat: { value: this._vatTex },
        uFrames: { value: this._frames },
        uFrame: { value: 0 },
        uAmp: { value: this.params.amplitude },
        uMap: { value: this._artworkTex || this._placeholderTex() },
        uColor: { value: new THREE.Color(this.params.color) },
        uUseTex: { value: this.params.material === 'artwork' ? 1 : 0 },
        uOpacity: { value: this.params.opacity }
      },
      vertexShader: /* glsl */ `
        precision highp float;
        attribute float aVatU;
        uniform sampler2D uVat;
        uniform float uFrames;
        uniform float uFrame;
        uniform float uAmp;
        varying vec2 vUv;
        varying float vDisp;
        vec3 sampleFrame(float row) {
          float v = (row + 0.5) / uFrames;
          return texture2D(uVat, vec2(aVatU, v)).xyz;
        }
        void main() {
          vUv = uv;
          float f0 = floor(uFrame);
          float f1 = mod(f0 + 1.0, uFrames);
          float frac = uFrame - f0;
          vec3 o0 = sampleFrame(f0);
          vec3 o1 = sampleFrame(f1);
          vec3 offset = mix(o0, o1, frac) * uAmp;
          vDisp = offset.z;
          vec3 displaced = position + offset;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uUseTex;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vDisp;
        void main() {
          vec3 base = uUseTex > 0.5 ? texture2D(uMap, vUv).rgb : uColor;
          // Cheap fold shading: crests (positive displacement) brighten, troughs
          // darken, so the cloth reads three-dimensional without vertex normals.
          float shade = clamp(1.0 + vDisp * 1.6, 0.55, 1.4);
          gl_FragColor = vec4(base * shade, uOpacity);
        }
      `
    });
    this._material.wireframe = this.params.material === 'wire';
  }

  // 1x1 white fallback so the sampler is valid before a painting is assigned.
  _placeholderTex() {
    if (!this._placeholder) {
      this._placeholder = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
        THREE.RGBAFormat
      );
      this._placeholder.needsUpdate = true;
    }
    return this._placeholder;
  }

  // Lazily create the cloth mesh and add it to the scene (hidden).
  ensure(scene) {
    if (this._built) return;
    const geo = this._buildVATTexture();
    this._buildMaterial();
    this._mesh = new THREE.Mesh(geo, this._material);
    this._mesh.visible = false;
    this._mesh.frustumCulled = false; // it displaces beyond its rest bounds
    this._mesh.renderOrder = 3; // after paintings/frames
    scene.add(this._mesh);
    this._scene = scene;
    this._built = true;
  }

  get maxFrames() {
    return this.caps.frames;
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
    switch (key) {
      case 'amplitude':
        this._material.uniforms.uAmp.value = value;
        break;
      case 'opacity':
        this._material.uniforms.uOpacity.value = value;
        break;
      case 'color':
        this._material.uniforms.uColor.value.set(value);
        break;
      case 'material':
        this._material.uniforms.uUseTex.value = value === 'artwork' ? 1 : 0;
        this._material.wireframe = value === 'wire';
        break;
      default:
        break;
    }
  }

  // Position/scale/orient the cloth in front of the selected painting. Called
  // each visible frame with the painting's world transform and display size.
  place(group, sizeM) {
    if (!this._mesh) return;
    group.getWorldPosition(this._pos);
    group.getWorldQuaternion(this._quat);
    this._normal.set(0, 0, 1).applyQuaternion(this._quat).normalize();

    const w = (sizeM?.w || 1) * this.params.scale;
    const h = (sizeM?.h || 1) * this.params.scale;
    this._mesh.scale.set(w, h, Math.max(w, h)); // z-scale so folds keep depth
    this._mesh.quaternion.copy(this._quat);
    this._mesh.position.copy(this._pos).addScaledVector(this._normal, this.params.offset);
  }

  // Advance the baked playback cursor (with sub-frame interpolation) and push it
  // to the shader. When paused, the Frame slider (scrub) drives the position.
  update(dt) {
    if (!this._mesh || !this._mesh.visible) return;
    const frames = this._frames;
    if (this.params.playing) {
      this._frame += dt * this.params.speed * BAKE_FPS;
      if (this.params.loop) {
        this._frame %= frames;
        if (this._frame < 0) this._frame += frames;
      } else {
        this._frame = Math.min(this._frame, frames - 1);
      }
    } else {
      this._frame = this.params.scrub * (frames - 1);
    }
    this._material.uniforms.uFrame.value = this._frame;
  }

  dispose() {
    if (this._mesh) {
      this._scene?.remove(this._mesh);
      this._mesh.geometry.dispose();
    }
    this._material?.dispose();
    this._vatTex?.dispose();
    this._built = false;
  }
}
