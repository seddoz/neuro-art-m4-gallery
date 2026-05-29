// Central tunables. cm-to-scene scale mirrors the UE5 importer
// (scripts/ue5_painting_importer.py): 1 scene unit = 1 cm on the painting
// quad, so web sizes match UE5. We render in metres for sane camera math,
// hence CM_TO_UNIT = 0.01 (1 cm = 0.01 m).
export const CONFIG = {
  CM_TO_UNIT: 0.01,
  WALL_HEIGHT_M: 4.5,
  ROOM_PADDING_M: 3.0,
  // How many paintings are placed in the 3D hall at once (a page). Filters
  // still run over the full working set; this caps geometry + texture memory.
  PAGE: 48,
  ROWS_PER_WALL: 2,
  COL_PITCH_M: 2.2, // horizontal spacing between columns
  ROW_BASE_Y: 1.35, // bottom row center height
  ROW_STEP_Y: 1.5, // vertical spacing between rows
  TEX_CONCURRENCY: 6, // max simultaneous texture downloads
  ACCEPTANCE_IDS: [282910, 282953, 282966],
  SD_ADDR: {
    tlist: '/t_list',
    guidance: '/guidance_scale',
    delta: '/delta',
    seed: '/seed'
  }
};
