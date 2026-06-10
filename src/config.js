// Central tunables. cm-to-scene scale mirrors the UE5 importer
// (scripts/ue5_painting_importer.py): 1 scene unit = 1 cm on the painting
// quad, so web sizes match UE5. We render in metres for sane camera math,
// hence CM_TO_UNIT = 0.01 (1 cm = 0.01 m).
export const CONFIG = {
  CM_TO_UNIT: 0.01,
  SCENE_BG: 0x3a3844,
  WALL_HEIGHT_M: 4.5,
  ROOM_PADDING_M: 2.0,
  // Default room camera: back of hall, centred, looking at front wall (z = -L/2).
  ROOM_VIEW: {
    backMarginMin: 2.0,
    backMarginFactor: 0.1
  },
  // How many paintings are placed in the 3D hall at once (a page). Filters
  // still run over the full working set; this caps geometry + texture memory.
  PAGE: 48,
  ROWS_PER_WALL: 2,
  COL_PITCH_M: 2.2, // horizontal spacing between columns
  ROW_BASE_Y: 1.35, // bottom row center height
  ROW_STEP_Y: 1.5, // vertical spacing between rows
  TEX_CONCURRENCY: 6, // max simultaneous texture downloads
  ACCEPTANCE_IDS: [282910, 282953, 282966],
  // Default gallery layout (overridden live by Layout panel sliders).
  // colPitch/rowStep are now the GAP (in metres) added between painting edges;
  // the actual centre pitch is (largest painting size + gap), so works of
  // different formats never overlap and keep a consistent centre distance.
  LAYOUT_DEFAULT: {
    perWall: 12,
    rows: 2,
    colPitch: 0.4,
    rowStep: 0.4
  },
  LAYOUT_MAX_PER_WALL: 200,
  LAYOUT_MAX_ROWS: 20,
  LAYOUT_MAX_TOTAL: 800,
  LAYOUT_MIN_GAP: 0.02,
  // Planar mirror room. Textures sized by surface metres (sharp); per-frame cost
  // controlled by how many planes refresh per frame. Quality presets let the user
  // pick the tradeoff directly.
  MIRROR: {
    pixelsPerMeter: 128,
    multisample: 0,
    clipBias: 0.003,
    color: 0x808080,
    defaultQuality: 'live',
    quality: {
      live: { perFrame: 6, texMin: 512, texMax: 1024, ceiling: true },
      balanced: { perFrame: 2, texMin: 512, texMax: 1024, ceiling: true },
      performance: { perFrame: 1, texMin: 256, texMax: 512, ceiling: false }
    }
  },
  // Centre collection sphere (gallery-offers-3d style).
  SPHERE: {
    floorClearance: 0.6,
    defaultRadius: 5,
    maxRoomLen: 12,
    radiusFactor: 0.35,
    maxPaintings: 100,
    maxArtists: 40,
    tileBaseM: 0.45,
    artistTileM: 0.38,
    autoRotateSpeed: 0.22,
    resumeRotateMs: 3000
  },
  SD_ADDR: {
    tlist: '/t_list',
    guidance: '/guidance_scale',
    delta: '/delta',
    seed: '/seed'
  }
};

// Paintings placed in the hall at once = perWall × 4 walls.
export function layoutPageSize(layout) {
  return Math.min(CONFIG.LAYOUT_MAX_TOTAL, Math.max(4, layout.perWall * 4));
}
