// Manual Stream Diffusion control plane.
// - Sends OSC values to TouchDesigner via the local bridge (POST /sd).
// - Mirrors the same values into a visual "look" object so the 3JS scene
//   visibly reacts to the sliders even when the SD bridge is offline
//   (graceful fallback required by M4).
import { CONFIG } from './config.js';

export class SDController {
  constructor() {
    this.params = { tlist: 4, guidance: 1.2, delta: 0.7, seed: 42 };
    this.bridgeOnline = false;
    this.listeners = new Set();
    this._checkHealth();
  }

  onChange(fn) {
    this.listeners.add(fn);
    fn(this.look());
    return () => this.listeners.delete(fn);
  }

  // Derived 0..1 "look" signals consumed by paintings / environment so the
  // scene reflects SD intensity locally.
  look() {
    const { tlist, guidance, delta, seed } = this.params;
    return {
      intensity: Math.min(1, tlist / 50),
      contrast: Math.min(1, guidance / 20),
      blend: delta,
      hueShift: (seed % 360) / 360
    };
  }

  _emit() {
    const l = this.look();
    for (const fn of this.listeners) fn(l);
  }

  async _checkHealth() {
    try {
      const r = await fetch('/sd/health');
      this.bridgeOnline = r.ok;
    } catch {
      this.bridgeOnline = false;
    }
    this._emit();
  }

  // address/type per M3 notes: t_list and seed are ints, guidance and delta floats.
  async _send(address, type, value) {
    try {
      const res = await fetch('/sd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, args: [{ type, value }] })
      });
      this.bridgeOnline = res.ok;
    } catch {
      this.bridgeOnline = false;
    }
    this._emit();
  }

  setTList(v) {
    this.params.tlist = Math.round(v);
    this._emit();
    this._send(CONFIG.SD_ADDR.tlist, 'i', this.params.tlist);
  }
  setGuidance(v) {
    this.params.guidance = Number(v);
    this._emit();
    this._send(CONFIG.SD_ADDR.guidance, 'f', this.params.guidance);
  }
  setDelta(v) {
    this.params.delta = Number(v);
    this._emit();
    this._send(CONFIG.SD_ADDR.delta, 'f', this.params.delta);
  }
  setSeed(v) {
    this.params.seed = Math.round(v);
    this._emit();
    this._send(CONFIG.SD_ADDR.seed, 'i', this.params.seed);
  }
}
