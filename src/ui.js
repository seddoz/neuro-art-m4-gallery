import { CONFIG } from './config.js';

// DOM control panel wiring. Pure DOM (no framework) to keep the bundle small.
// Emits user intents via the handlers passed in the constructor.
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this._bind();
  }

  _bind() {
    // Mode toggle: Environment vs Painting
    this.modeButtons = Array.from(document.querySelectorAll('#mode-toggle button'));
    for (const b of this.modeButtons) {
      b.addEventListener('click', () => {
        this.modeButtons.forEach((x) => x.classList.toggle('active', x === b));
        this.h.onMode(b.dataset.mode);
      });
    }

    // Panel show/hide (mobile)
    document.getElementById('panel-btn').addEventListener('click', () => {
      document.getElementById('panel').classList.toggle('open');
    });

    // Filters
    this.selectors = {
      collection: document.getElementById('f-collection'),
      location: document.getElementById('f-location'),
      artist: document.getElementById('f-artist'),
      category: document.getElementById('f-category'),
      size: document.getElementById('f-size')
    };
    document.getElementById('apply-filters').addEventListener('click', () => this.h.onApplyFilters(this.readFilters()));
    document.getElementById('reset-filters').addEventListener('click', () => {
      for (const sel of Object.values(this.selectors)) sel.selectedIndex = 0;
      const idInput = document.getElementById('f-id');
      if (idInput) idInput.value = '';
      this.h.onApplyFilters(this.readFilters());
    });

    // Find a single painting by ID
    const idInput = document.getElementById('f-id');
    const goId = document.getElementById('go-id');
    if (goId) goId.addEventListener('click', () => this.h.onFindById(idInput.value.trim()));
    if (idInput) idInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.h.onFindById(idInput.value.trim());
    });

    // Paging through the filtered stock
    this.prevBtn = document.getElementById('prev-page');
    this.nextBtn = document.getElementById('next-page');
    this.prevBtn.addEventListener('click', () => this.h.onPrevPage());
    this.nextBtn.addEventListener('click', () => this.h.onNextPage());

    // Layout sliders (labels update live; gallery rebuild on Apply / presets).
    this.layoutInputs = {
      perWall: document.getElementById('s-per-wall'),
      rows: document.getElementById('s-rows'),
      colPitch: document.getElementById('s-col-pitch'),
      rowStep: document.getElementById('s-row-step')
    };
    this.layoutOutputs = {
      perWall: document.getElementById('o-per-wall'),
      rows: document.getElementById('o-rows'),
      colPitch: document.getElementById('o-col-pitch'),
      rowStep: document.getElementById('o-row-step')
    };
    this.layoutCap = document.getElementById('layout-cap');
    for (const [key, input] of Object.entries(this.layoutInputs)) {
      if (!input) continue;
      input.addEventListener('input', () => this._syncLayoutLabels());
    }
    document.getElementById('apply-layout')?.addEventListener('click', () => {
      this.h.onApplyLayout(this.readLayout());
    });
    document.getElementById('tight-layout')?.addEventListener('click', () => {
      this.setLayout({ perWall: 150, rows: 8, colPitch: 0.02, rowStep: 0.02 });
      this.h.onApplyLayout(this.readLayout());
    });
    document.getElementById('reset-layout')?.addEventListener('click', () => {
      this.setLayout({ ...CONFIG.LAYOUT_DEFAULT });
      this.h.onApplyLayout(this.readLayout());
    });

    this.mirrorBtn = document.getElementById('mirror-toggle');
    this.mirrorBtn?.addEventListener('click', () => {
      const on = this.mirrorBtn.classList.toggle('active');
      this.setMirrorLabel(on);
      this.h.onMirrorToggle(on);
    });

    this.mirrorQuality = document.getElementById('mirror-quality');
    this.mirrorQuality?.addEventListener('change', () => {
      this.h.onMirrorQuality(this.mirrorQuality.value);
    });

    // SD sliders
    this._slider('s-tlist', 'o-tlist', (v) => this.h.onSD('tlist', v));
    this._slider('s-guidance', 'o-guidance', (v) => this.h.onSD('guidance', v));
    this._slider('s-delta', 'o-delta', (v) => this.h.onSD('delta', v));
    this._slider('s-seed', 'o-seed', (v) => this.h.onSD('seed', v));

    // Painting actions
    this.animBtn = document.getElementById('anim-toggle');
    this.animBtn.addEventListener('click', () => this.h.onToggleAnimation());
    document.getElementById('enter-btn').addEventListener('click', () => this.h.onEnter());
    document.getElementById('exit-btn').addEventListener('click', () => this.h.onExit());
  }

  _slider(inputId, outId, cb) {
    const input = document.getElementById(inputId);
    const out = document.getElementById(outId);
    input.addEventListener('input', () => {
      out.textContent = input.value;
      cb(parseFloat(input.value));
    });
  }

  readFilters() {
    const f = {};
    for (const [k, sel] of Object.entries(this.selectors)) f[k] = sel.value;
    return f;
  }

  readLayout() {
    return {
      perWall: parseInt(this.layoutInputs.perWall?.value || '12', 10),
      rows: parseInt(this.layoutInputs.rows?.value || '2', 10),
      colPitch: parseFloat(this.layoutInputs.colPitch?.value || '2.2'),
      rowStep: parseFloat(this.layoutInputs.rowStep?.value || '1.5')
    };
  }

  setLayout(layout) {
    if (this.layoutInputs.perWall) this.layoutInputs.perWall.value = layout.perWall;
    if (this.layoutInputs.rows) this.layoutInputs.rows.value = layout.rows;
    if (this.layoutInputs.colPitch) this.layoutInputs.colPitch.value = layout.colPitch;
    if (this.layoutInputs.rowStep) this.layoutInputs.rowStep.value = layout.rowStep;
    this._syncLayoutLabels();
  }

  _syncLayoutLabels() {
    const L = this.readLayout();
    if (this.layoutOutputs.perWall) this.layoutOutputs.perWall.textContent = L.perWall;
    if (this.layoutOutputs.rows) this.layoutOutputs.rows.textContent = L.rows;
    if (this.layoutOutputs.colPitch) this.layoutOutputs.colPitch.textContent = L.colPitch.toFixed(2);
    if (this.layoutOutputs.rowStep) this.layoutOutputs.rowStep.textContent = L.rowStep.toFixed(2);
    if (this.layoutCap) {
      const total = Math.min(CONFIG.LAYOUT_MAX_TOTAL, L.perWall * 4);
      const cols = Math.ceil(L.perWall / Math.max(1, L.rows));
      this.layoutCap.textContent = `Up to ${total} in room (${L.perWall}/wall, ${L.rows} rows → ~${cols} cols)`;
    }
  }

  populateFilters(facets) {
    for (const [key, values] of Object.entries(facets)) {
      const sel = this.selectors[key];
      if (!sel) continue;
      sel.innerHTML = '';
      for (const v of values) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
    }
  }

  setResultCount({ from, to, total, page, pages }) {
    document.getElementById('result-count').textContent =
      total > 0 ? `Showing ${from}-${to} of ${total} paintings` : 'No paintings match these filters';
    const ind = document.getElementById('page-ind');
    if (ind) ind.textContent = `Page ${page}/${pages}`;
  }

  setPageNav(hasPrev, hasNext) {
    if (this.prevBtn) this.prevBtn.disabled = !hasPrev;
    if (this.nextBtn) this.nextBtn.disabled = !hasNext;
  }

  setSelected(p) {
    const el = document.getElementById('sel-meta');
    if (!p) {
      el.textContent = 'None selected. Click a painting.';
      return;
    }
    const price = p.priceEur != null ? ` - EUR ${p.priceEur}` : '';
    el.innerHTML = `<strong>${p.title || 'Untitled'}</strong><br>${p.artist || 'Unknown'}<br>${p.widthCm} x ${p.heightCm} cm${price}<br><span class="muted">#${p.id} - ${p.collection || ''} ${p.location ? '- ' + p.location : ''}</span>`;
  }

  setAnimationLabel(on) {
    this.animBtn.textContent = on ? 'Animation Off' : 'Animation On';
  }

  setMirrorLabel(on) {
    if (!this.mirrorBtn) return;
    this.mirrorBtn.textContent = on ? 'Mirror room: On' : 'Mirror room: Off';
    this.mirrorBtn.classList.toggle('active', on);
  }

  setSdStatus(online) {
    const dot = document.getElementById('sd-status');
    dot.classList.toggle('online', online);
    dot.title = online ? 'SD bridge online' : 'SD bridge offline (local look only)';
  }

  hideLoading() {
    const l = document.getElementById('loading');
    l.classList.add('hidden');
  }

  setLoadingText(t) {
    const el = document.querySelector('#loading .loading-text');
    if (el) el.textContent = t;
  }
}
