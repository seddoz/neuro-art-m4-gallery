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
