// Central tunables. cm-to-scene scale mirrors the UE5 importer
// (scripts/ue5_painting_importer.py): 1 scene unit = 1 cm on the painting
// quad, so web sizes match UE5. We render in metres for sane camera math,
// hence CM_TO_UNIT = 0.01 (1 cm = 0.01 m).
export const CONFIG = {
  CM_TO_UNIT: 0.01,
  WALL_HEIGHT_M: 4.5,
  ROOM_PADDING_M: 2.0,
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
  // Planar mirror room — quality scales with visible painting count.
  MIRROR: {
    textureWidthMax: 512,
    textureWidthMin: 128,
    multisample: 0,
    clipBias: 0.003,
    color: 0x777777
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
