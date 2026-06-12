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

// Row pack: fill each row left-to-right, then next row (gallery-style reading order).
export function packWallRows(items, maxRows, hGap, vGap, options = {}) {
  const origin = options.origin === 'bottom' ? 'bottom' : 'top';
  const floorBottom = options.floorBottom ?? 0.8;

  if (!items.length) {
    return { placed: [], width: 4, topY: floorBottom + 1 };
  }

  const rows = Math.max(1, maxRows);
  const ordered = orderPaintings(items);
  const numCols = Math.ceil(ordered.length / rows);

  const grid = Array.from({ length: rows }, () => Array(numCols).fill(null));
  for (let i = 0; i < ordered.length; i++) {
    grid[Math.floor(i / numCols)][i % numCols] = ordered[i];
  }

  const colWidths = Array(numCols).fill(0);
  const rowHeights = Array(rows).fill(0);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < numCols; col++) {
      const it = grid[row][col];
      if (!it) continue;
      colWidths[col] = Math.max(colWidths[col], it.w);
      rowHeights[row] = Math.max(rowHeights[row], it.h);
    }
  }

  const placed = [];
  let maxTop = floorBottom;

  if (origin === 'top') {
    const totalH = rowHeights.reduce((s, h) => s + h, 0) + vGap * Math.max(0, rows - 1);
    let y = totalH;
    for (let row = 0; row < rows; row++) {
      const rh = rowHeights[row];
      y -= rh;
      let x = 0;
      for (let col = 0; col < numCols; col++) {
        const it = grid[row][col];
        if (it) {
          placed.push({
            data: it.data,
            cx: x + colWidths[col] / 2,
            cy: y + rh / 2,
            w: it.w,
            h: it.h
          });
        }
        x += colWidths[col] + hGap;
      }
      y -= vGap;
    }
    maxTop = totalH;
  } else {
    let y = floorBottom;
    for (let row = 0; row < rows; row++) {
      const rh = rowHeights[row];
      let x = 0;
      for (let col = 0; col < numCols; col++) {
        const it = grid[row][col];
        if (it) {
          placed.push({
            data: it.data,
            cx: x + colWidths[col] / 2,
            cy: y + rh / 2,
            w: it.w,
            h: it.h
          });
        }
        x += colWidths[col] + hGap;
      }
      maxTop = Math.max(maxTop, y + rh);
      y += rh + vGap;
    }
  }

  const width = Math.max(0.5, colWidths.reduce((s, w, i) => s + w + (i ? hGap : 0), 0));
  const shiftX = -width / 2;
  for (const p of placed) p.cx += shiftX;

  return { placed, width, topY: maxTop };
}

// Legacy column pack (kept for reference); gallery uses packWallRows.
export function packWallColumns(items, rows, hGap, vGap, floorBottom = 0.8) {
  return packWallRows(items, rows, hGap, vGap, { origin: 'bottom', floorBottom });
}
