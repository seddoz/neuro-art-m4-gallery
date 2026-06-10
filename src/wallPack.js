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

// Keep large works first for dense packing, shuffle within similar area tiers.
function orderForPacking(items) {
  const sorted = [...items].sort((a, b) => b.w * b.h - a.w * a.h);
  let i = 0;
  while (i < sorted.length) {
    const area0 = sorted[i].w * sorted[i].h;
    let j = i + 1;
    while (j < sorted.length && sorted[j].w * sorted[j].h >= area0 * 0.85) j++;
    const tier = sorted.slice(i, j);
    fisherYates(tier);
    sorted.splice(i, tier.length, ...tier);
    i = j;
  }
  return sorted;
}

function rectsOverlap(a, b, gap) {
  return !(
    a.r + gap <= b.l ||
    b.r + gap <= a.l ||
    a.t + gap <= b.b ||
    b.t + gap <= a.b
  );
}

// Salon-style 2D pack: each painting keeps its real size, edge gap is enforced.
export function packWall(items, hGap, vGap, floorBottom = 0.8) {
  if (!items.length) {
    return { placed: [], width: 4, topY: floorBottom + 1 };
  }

  const ordered = orderForPacking(items);
  const rects = [];
  const placed = [];

  for (const item of ordered) {
    const candX = new Set([0]);
    for (const r of rects) {
      candX.add(r.l);
      candX.add(r.r + hGap);
    }

    let best = null;
    for (const x of candX) {
      let y = floorBottom;
      for (const r of rects) {
        if (x < r.r + hGap && x + item.w + hGap > r.l) {
          y = Math.max(y, r.t + vGap);
        }
      }
      const rect = { l: x, r: x + item.w, b: y, t: y + item.h };
      const score = y * 1e6 + x;
      if (!best || score < best.score) best = { ...rect, score };
    }

    rects.push({ l: best.l, r: best.r, b: best.b, t: best.t });
    placed.push({
      data: item.data,
      w: item.w,
      h: item.h,
      cx: best.l + item.w / 2,
      cy: best.b + item.h / 2
    });
  }

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j], Math.min(hGap, vGap))) {
        console.warn('[wallPack] overlap detected', i, j);
      }
    }
  }

  const minL = Math.min(...rects.map((r) => r.l));
  const maxR = Math.max(...rects.map((r) => r.r));
  const maxT = Math.max(...rects.map((r) => r.t));
  const shiftX = -(minL + maxR) / 2;
  for (const p of placed) p.cx += shiftX;

  return {
    placed,
    width: maxR - minL,
    topY: maxT
  };
}
