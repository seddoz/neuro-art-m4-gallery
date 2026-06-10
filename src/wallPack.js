import { CONFIG } from './config.js';

export function paintingSizeM(data) {
  const w = Math.max(0.05, (data.widthCm || 40) * CONFIG.CM_TO_UNIT);
  const h = Math.max(0.05, (data.heightCm || 40) * CONFIG.CM_TO_UNIT);
  return { w, h };
}

function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Group identical sizes together (shuffled within group) so like formats sit side by side.
function orderPaintings(items) {
  const groups = new Map();
  for (const it of items) {
    const key = `${it.w.toFixed(3)}:${it.h.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const g of groups.values()) fisherYates(g);
  return [...groups.values()]
    .sort((a, b) => b[0].w * b[0].h - a[0].w * a[0].h)
    .flat();
}

function rectsOverlap(a, b, gap) {
  return !(
    a.r + gap <= b.l ||
    b.r + gap <= a.l ||
    a.t + gap <= b.b ||
    b.t + gap <= a.b
  );
}

// Column stack pack: up to `rows` paintings per column, bottom-aligned with real sizes.
// Matches the rows/perWall grid semantics (fill column 0 top-to-bottom, then column 1…)
// but uses each work's width/height so gaps are only the slider minimums.
export function packWallColumns(items, rows, hGap, vGap, floorBottom = 0.8) {
  if (!items.length) {
    return { placed: [], width: 4, topY: floorBottom + 1 };
  }

  const r = Math.max(1, rows);
  const ordered = orderPaintings(items);
  const numCols = Math.ceil(ordered.length / r);
  const columns = Array.from({ length: numCols }, () => []);

  for (let i = 0; i < ordered.length; i++) {
    columns[Math.floor(i / r)].push(ordered[i]);
  }

  const placed = [];
  const rects = [];
  let x = 0;
  let maxTop = floorBottom;

  for (const col of columns) {
    if (!col.length) continue;
    const colW = Math.max(...col.map((it) => it.w));
    let y = floorBottom;
    for (const item of col) {
      const l = x;
      const b = y;
      const rect = { l, r: l + colW, b, t: b + item.h };
      rects.push(rect);
      placed.push({
        data: item.data,
        cx: x + colW / 2,
        cy: y + item.h / 2,
        w: item.w,
        h: item.h
      });
      y += item.h + vGap;
    }
    maxTop = Math.max(maxTop, y - vGap);
    x += colW + hGap;
  }

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j], Math.min(hGap, vGap) * 0.5)) {
        console.warn('[wallPack] overlap', i, j);
      }
    }
  }

  const width = Math.max(0.5, x - hGap);
  const shiftX = -width / 2;
  for (const p of placed) p.cx += shiftX;

  return { placed, width, topY: maxTop };
}
