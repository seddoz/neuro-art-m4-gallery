import { CONFIG } from './config.js';

// DOM control panel wiring. Pure DOM (no framework) to keep the bundle small.
// Emits user intents via the handlers passed in the constructor.
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this._bind();
  }

  _bind() {
    // View toggle: Room vs Sphere
    this.viewButtons = Array.from(document.querySelectorAll('#view-toggle button'));
    for (const b of this.viewButtons) {
      b.addEventListener('click', () => {
        this.viewButtons.forEach((x) => x.classList.toggle('active', x === b));
        this.h.onView(b.dataset.view);
      });
    }

    // Mode toggle: Environment vs Painting
    this.modeButtons = Array.from(document.querySelectorAll('#mode-toggle button'));
    for (const b of this.modeButtons) {
      b.addEventListener('click', () => {
        this.modeButtons.forEach((x) => x.classList.toggle('active', x === b));
        this.h.onMode(b.dataset.mode);
      });
    }

    // Panel show/hide (all devices)
    this.panel = document.getElementById('panel');
    this.panelBtn = document.getElementById('panel-btn');
    this.panelBtn.addEventListener('click', () => {
      const hidden = this.panel.classList.toggle('hidden');
      if (window.matchMedia('(max-width: 720px)').matches) {
        this.panel.classList.toggle('open', !hidden);
      } else {
        this.panel.classList.remove('open');
      }
      this._syncPanelLabel();
    });
    if (window.matchMedia('(max-width: 720px)').matches) {
      this.panel.classList.add('hidden');
    }
    this._syncPanelLabel();

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
      rowStep: document.getElementById('s-row-step'),
      rowOrigin: document.getElementById('s-row-origin')
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
      this.setLayout({ perWall: 150, rows: 8, colPitch: 0.02, rowStep: 0.02, rowOrigin: 'top' });
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
    this.flareBtn = document.getElementById('flare-toggle');
    this.flareBtn?.addEventListener('click', () => this.h.onToggleLensFlare?.());
    this.mcBtn = document.getElementById('mc-toggle');
    this.mcBtn?.addEventListener('click', () => this.h.onToggleMarchingCubes?.());
    this.vatBtn = document.getElementById('vat-toggle');
    this.vatBtn?.addEventListener('click', () => this.h.onToggleVat?.());
    // Effect control panels are revealed only while that effect is on (see
    // setLensFlareLabel / setMarchingCubesLabel / setVatLabel), so the sidebar
    // isn't cluttered with sliders for effects that aren't running.
    this.flareGroup = document.getElementById('lensflare-group');
    this.mcGroup = document.getElementById('marchingcubes-group');
    this.vatGroup = document.getElementById('vat-group');
    if (this.flareGroup) this.flareGroup.hidden = true;
    if (this.mcGroup) this.mcGroup.hidden = true;
    if (this.vatGroup) this.vatGroup.hidden = true;

    // Per-painting audio guide (EN/PL). Hidden unless the selected work has audio.
    this.audioField = document.getElementById('audio-field');
    this.audioPlayer = document.getElementById('audio-player');
    this.audioEnBtn = document.getElementById('audio-en');
    this.audioPlBtn = document.getElementById('audio-pl');
    this._audio = { en: '', pl: '', lang: 'en' };
    this.audioEnBtn?.addEventListener('click', () => this._setAudioLang('en', true));
    this.audioPlBtn?.addEventListener('click', () => this._setAudioLang('pl', true));
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
      rowStep: parseFloat(this.layoutInputs.rowStep?.value || '1.5'),
      rowOrigin: this.layoutInputs.rowOrigin?.value || 'top'
    };
  }

  setLayout(layout) {
    if (this.layoutInputs.perWall) this.layoutInputs.perWall.value = layout.perWall;
    if (this.layoutInputs.rows) this.layoutInputs.rows.value = layout.rows;
    if (this.layoutInputs.colPitch) this.layoutInputs.colPitch.value = layout.colPitch;
    if (this.layoutInputs.rowStep) this.layoutInputs.rowStep.value = layout.rowStep;
    if (this.layoutInputs.rowOrigin) {
      this.layoutInputs.rowOrigin.value = layout.rowOrigin === 'bottom' ? 'bottom' : 'top';
    }
    this._syncLayoutLabels();
  }

  _syncPanelLabel() {
    if (!this.panelBtn || !this.panel) return;
    const hidden = this.panel.classList.contains('hidden');
    this.panelBtn.textContent = hidden ? 'Show controls' : 'Hide controls';
    this.panelBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
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
      const origin = L.rowOrigin === 'bottom' ? 'bottom-up' : 'top-down';
      this.layoutCap.textContent = `Up to ${total} in room (${L.perWall}/wall, ${L.rows} rows × ~${cols} across, L→R, ${origin})`;
    }
  }

  populateFilters(facets) {
    for (const [key, values] of Object.entries(facets)) {
      const sel = this.selectors[key];
      if (!sel) continue;
      // Preserve the user's current choice across re-population (the option list
      // is refreshed again when background stock pages finish loading, BR-028).
      const prev = sel.value;
      sel.innerHTML = '';
      for (const v of values) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
      if (prev && values.includes(prev)) sel.value = prev;
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

  // Show/hide the audio guide for the selected painting. Pass the normalized
  // painting data (with audioEn/audioPl) or null to hide + stop playback.
  setPaintingAudio(data) {
    const en = (data && data.audioEn) || '';
    const pl = (data && data.audioPl) || '';
    this._audio.en = en;
    this._audio.pl = pl;
    const has = !!(en || pl);
    if (this.audioField) this.audioField.hidden = !has;
    if (!has) {
      this._stopAudio();
      return;
    }
    if (this.audioEnBtn) this.audioEnBtn.disabled = !en;
    if (this.audioPlBtn) this.audioPlBtn.disabled = !pl;
    // Default to EN when available, otherwise PL. Load only (no autoplay) so the
    // browser doesn't block on selection; the user presses play or a lang button.
    this._setAudioLang(en ? 'en' : 'pl', false);
  }

  _setAudioLang(lang, autoplay) {
    const url = lang === 'pl' ? this._audio.pl : this._audio.en;
    if (!url || !this.audioPlayer) return;
    this._audio.lang = lang;
    if (this.audioEnBtn) this.audioEnBtn.classList.toggle('active', lang === 'en');
    if (this.audioPlBtn) this.audioPlBtn.classList.toggle('active', lang === 'pl');
    const abs = new URL(url, window.location.href).href;
    if (this.audioPlayer.src !== abs) this.audioPlayer.src = url;
    if (autoplay) this.audioPlayer.play().catch(() => {});
  }

  _stopAudio() {
    if (!this.audioPlayer) return;
    this.audioPlayer.pause();
    this.audioPlayer.removeAttribute('src');
    this.audioPlayer.load();
  }

  setAnimationLabel(on) {
    this.animBtn.textContent = on ? 'Animation Off' : 'Animation On';
  }

  setLensFlareLabel(on) {
    if (!this.flareBtn) return;
    this.flareBtn.textContent = on ? 'Lens Flare Off' : 'Lens Flare On';
    this.flareBtn.classList.toggle('active', !!on);
    if (this.flareGroup) this.flareGroup.hidden = !on;
  }

  setMarchingCubesLabel(on) {
    if (!this.mcBtn) return;
    this.mcBtn.textContent = on ? 'Marching Cubes Off' : 'Marching Cubes On';
    this.mcBtn.classList.toggle('active', !!on);
    if (this.mcGroup) this.mcGroup.hidden = !on;
  }

  setVatLabel(on) {
    if (!this.vatBtn) return;
    this.vatBtn.textContent = on ? 'Houdini FX Off' : 'Houdini FX On';
    this.vatBtn.classList.toggle('active', !!on);
    if (this.vatGroup) this.vatGroup.hidden = !on;
  }

  setMirrorLabel(on) {
    if (!this.mirrorBtn) return;
    this.mirrorBtn.textContent = on ? 'Mirror room: On' : 'Mirror room: Off';
    this.mirrorBtn.classList.toggle('active', on);
  }

  setViewMode(view) {
    this.viewButtons?.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const layout = document.getElementById('layout-group');
    const pageNav = document.getElementById('page-nav');
    const inSphere = view === 'sphere';
    if (layout) layout.style.display = inSphere ? 'none' : '';
    if (pageNav) pageNav.style.display = inSphere ? 'none' : '';
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
