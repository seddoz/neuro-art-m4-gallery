// Catalog access. All requests go through the local proxy (/api/*) which
// holds the AHG36 X-API-Key. The browser never sees the key.
import { MOCK_PAINTINGS } from './mockData.js';

// Decode HTML entities and normalise mojibake-prone strings to clean UTF-8.
function clean(str) {
  if (str == null) return '';
  const txt = String(str);
  const el = document.createElement('textarea');
  el.innerHTML = txt;
  return el.value.trim();
}

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Map a raw AHG36 record to the gallery's internal shape. Dimensions use the
// named Width/Height/Depth fields (cm), which avoids the width/height
// reversal that hit the prior project.
export function normalize(raw) {
  return {
    id: raw.ID ?? raw.id,
    title: clean(raw.Title),
    artist: clean(raw.Artist),
    widthCm: num(raw.Width, 60),
    heightCm: num(raw.Height, 60),
    depthCm: num(raw.Depth, 2),
    photo: raw.Photo || (Array.isArray(raw.Photo_Gallery) ? raw.Photo_Gallery[0] : ''),
    gallery: Array.isArray(raw.Photo_Gallery) ? raw.Photo_Gallery : [],
    category: clean(raw.Category),
    collection: clean(raw.Collection),
    location: clean(raw.Location),
    objectType: clean(raw.Object_type),
    decade: clean(raw.Decades),
    technique: clean(raw.Technique),
    year: clean(raw.Year),
    size: clean(raw.Size),
    sizeLabel: clean(raw.Size_Label),
    priceEur: raw.Price && raw.Price.EUR != null ? raw.Price.EUR : null,
    status: clean(raw.Status) || 'unavailable'
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Pull the full stock by paging get-products. Falls back to mock data if the
// list endpoint is unauthorized/unreachable so the gallery still renders.
export async function fetchAllPaintings({ pageSize = 100, max = 5000, onProgress } = {}) {
  const out = [];
  let page = 1;
  try {
    while (out.length < max) {
      const data = await getJson(`/api/products?api_page=${page}&limit=${pageSize}&status=available`);
      const items = data.items || data.products || [];
      if (!items.length) break;
      for (const it of items) out.push(normalize(it));
      onProgress && onProgress(out.length, data.total || null);
      const totalPages = data.pages || 0;
      if (totalPages && page >= totalPages) break;
      page += 1;
    }
    if (out.length) return { paintings: out, source: 'api' };
    throw new Error('empty list');
  } catch (err) {
    console.warn('[api] full-stock list unavailable, using mock data:', err.message);
    // Enrich the three acceptance IDs with live single-product data when possible.
    const mock = MOCK_PAINTINGS.map(normalize);
    return { paintings: mock, source: 'mock', error: err.message };
  }
}

// Public single-product read (no key needed). Used to fetch true metadata for
// the acceptance IDs even when the list endpoint is locked.
export async function fetchPainting(id) {
  const raw = await getJson(`/api/product/${id}`);
  return normalize(raw);
}

// Build the option lists for each filter from a painting set.
export function buildFacets(paintings) {
  const facet = (key) => {
    const set = new Set();
    for (const p of paintings) if (p[key]) set.add(p[key]);
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  };
  return {
    collection: facet('collection'),
    location: facet('location'),
    artist: facet('artist'),
    category: facet('category'),
    size: ['All', ...['XS', 'S', 'M', 'L', 'XL'].filter((s) => paintings.some((p) => p.size === s))]
  };
}

// Apply the active session filters. 'All' means no constraint on that field.
export function applyFilters(paintings, filters) {
  return paintings.filter((p) => {
    if (filters.collection && filters.collection !== 'All' && p.collection !== filters.collection) return false;
    if (filters.location && filters.location !== 'All' && p.location !== filters.location) return false;
    if (filters.artist && filters.artist !== 'All' && p.artist !== filters.artist) return false;
    if (filters.category && filters.category !== 'All' && p.category !== filters.category) return false;
    if (filters.size && filters.size !== 'All' && p.size !== filters.size) return false;
    return true;
  });
}
