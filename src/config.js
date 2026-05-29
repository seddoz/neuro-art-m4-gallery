// Central tunables. cm-to-scene scale mirrors the UE5 importer
// (scripts/ue5_painting_importer.py): 1 scene unit = 1 cm on the painting
// quad, so web sizes match UE5. We render in metres for sane camera math,
// hence CM_TO_UNIT = 0.01 (1 cm = 0.01 m).
export const CONFIG = {
  CM_TO_UNIT: 0.01,
  WALL_HEIGHT_M: 4.0,
  PAINTING_EYE_M: 1.6, // hang center height
  GAP_M: 1.2, // spacing between paintings along a wall
  ROOM_PADDING_M: 3.0,
  MAX_PER_WALL: 8,
  ACCEPTANCE_IDS: [282910, 282953, 282966],
  SD_ADDR: {
    tlist: '/t_list',
    guidance: '/guidance_scale',
    delta: '/delta',
    seed: '/seed'
  }
};
