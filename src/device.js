// Mobile / tablet detection and runtime caps. Phones cannot hold hundreds of
// full-size textures plus Live mirror render targets — without caps WebGL often
// loses context and paintings disappear (dark placeholders on black void).
import { CONFIG } from './config.js';

export function isMobileDevice() {
  return (
    window.matchMedia('(max-width: 720px)').matches ||
    window.matchMedia('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

// Tune CONFIG + return profile flags before WebGLRenderer is created.
export function applyMobileProfile() {
  if (!isMobileDevice()) {
    return { active: false, antialias: true, pixelRatioMax: 2 };
  }

  CONFIG.TEX_CONCURRENCY = 2;
  CONFIG.TEX_MAX_DIM = 1536;
  CONFIG.TEX_PREVIEW_DIM = 768; // aspect-correct wall preview via contain shader
  CONFIG.TEXTURE_ANISOTROPY = 2;
  CONFIG.MOBILE_WALL_SINGLE = true;
  CONFIG.AUTO_UPGRADE = false;
  CONFIG.LAYOUT_DEFAULT = {
    perWall: 6,
    rows: 2,
    colPitch: 0.4,
    rowStep: 0.4,
    rowOrigin: 'top'
  };
  CONFIG.MIRROR.defaultQuality = 'performance';
  CONFIG.SPHERE.maxPaintings = 36;
  CONFIG.SPHERE.maxArtists = 16;

  return { active: true, antialias: false, pixelRatioMax: 1.5 };
}
