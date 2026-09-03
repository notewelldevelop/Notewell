/* ═══════════════ NoteWell — ui.js ═══════════════
   Toolbar, contextual options row, library shelf, modals, panels. */
(function (NW) {
  'use strict';
  const E = NW.Engine, T = NW.Tools, $ = NW.$, el = NW.el;

  const UI = NW.UI = { folderId: null, view: 'library', search: '', _esc: null, _place: null };

  /* ── colour ────────────────────────────────────────
     Five swatches live on the bar and no more. They are the five you reached
     for most recently, so the ones you actually use drift to the front on
     their own. Everything else — the full palette, a picker, a hex box — is
     one tap away behind the ⋯ button. */
  const PALETTE = {
    ink: [
      '#16150f', '#3d3b33', '#6b6960', '#9c9a90', '#ffffff',
      '#8c1d18', '#c0392b', '#e03131', '#f76707', '#f59f00',
      '#7a6a1f', '#5c8001', '#2f9e44', '#0ca678', '#0b7285',
      '#1864ab', '#1c7ed6', '#4263eb', '#5f3dc4', '#7048e8',
      '#a61e4d', '#c2255c', '#d6336c', '#846358', '#4d3b2f'
    ],
    highlight: [
      '#ffe14d', '#ffec99', '#ffd8a8', '#ffc078', '#fcc2d7',
      '#ffc9c9', '#eebefa', '#d0bfff', '#bac8ff', '#a5d8ff',
      '#99e9f2', '#96f2d7', '#b2f2bb', '#d8f5a2', '#e9ecef',
      '#ced4da'
    ],
    fill: [
      '#ffffff', '#f1f3f5', '#e9ecef', '#ced4da', '#868e96',
      '#495057', '#16150f', '#fff3bf', '#ffec99', '#ffd8a8',
      '#ffc9c9', '#fcc2d7', '#eebefa', '#d0bfff', '#bac8ff',
      '#a5d8ff', '#99e9f2', '#96f2d7', '#b2f2bb', '#d8f5a2'
    ]
  };

  /* what the five start out as, before you've used anything */
  const SEED_RECENT = {
    pen:           ['#16150f', '#e03131', '#1c7ed6', '#2f9e44', '#ffffff'],
    shape:         ['#16150f', '#6b6960', '#e03131', '#1c7ed6', '#ffffff'],
    text:          ['#16150f', '#6b6960', '#8c1d18', '#1864ab', '#ffffff'],
    highlighter:   ['#ffe14d', '#b2f2bb', '#a5d8ff', '#ffc9c9', '#d0bfff'],
    textHighlight: ['#ffe14d', '#b2f2bb', '#a5d8ff', '#ffc9c9', '#d0bfff'],
    fill:          ['#ffec99', '#e9ecef', '#b2f2bb', '#a5d8ff', '#ffc9c9'],
    shapeFill:     ['#f1f3f5', '#ffec99', '#b2f2bb', '#a5d8ff', '#ffc9c9']
  };

  function recentFor(key) {
    T.opts.recent = T.opts.recent || {};
    if (!Array.isArray(T.opts.recent[key]) || !T.opts.recent[key].length)
      T.opts.recent[key] = (SEED_RECENT[key] || SEED_RECENT.pen).slice();
    return T.opts.recent[key];
  }
  function rememberColour(key, colour) {
    const list = recentFor(key).filter(c => c.toLowerCase() !== String(colour).toLowerCase());
    list.unshift(colour);
    T.opts.recent[key] = list.slice(0, 5);
    T.saveOpts();
  }

  const PEN_SIZES = [1, 1.8, 3.2, 5, 8, 13];
  const HL_SIZES = [12, 20, 28, 40, 58];
  const ER_SIZES = [10, 20, 36, 64, 110];

  /* ══════════════ modal helper ══════════════ */
  UI.modal = function (build, opt) {
    opt = opt || {};
    const root = $('#modalRoot'), box = $('#modalBox');
    box.innerHTML = '';
    if (typeof build === 'string') box.innerHTML = build; else build(box);
    root.hidden = false;
    const onScrim = e => { if (e.target.classList.contains('scrim') && opt.dismissable !== false) UI.close(); };
    root.querySelector('.scrim').onclick = onScrim;
    UI._esc = e => { if (e.key === 'Escape' && opt.dismissable !== false) UI.close(); };
    document.addEventListener('keydown', UI._esc);
    return box;
  };
  UI.close = function () {
    $('#modalRoot').hidden = true; $('#modalBox').innerHTML = '';
    document.removeEventListener('keydown', UI._esc);
  };
  UI.confirm = function (title, msg, okLabel) {
    return new Promise(res => {
      UI.modal(box => {
        box.appendChild(el('h2', { text: title }));
        box.appendChild(el('p', { class: 'note', text: msg }));
        const acts = el('div', { class: 'actions' });
        acts.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: () => { UI.close(); res(false); } }));
        acts.appendChild(el('button', { class: 'btn primary', text: okLabel || 'OK', onclick: () => { UI.close(); res(true); } }));
        box.appendChild(acts);
      });
    });
  };
  UI.prompt = function (title, value, label) {
    return new Promise(res => {
      UI.modal(box => {
        box.appendChild(el('h2', { text: title }));
        box.appendChild(el('label', { text: label || 'Name' }));
        const inp = el('input', { type: 'text', value: value || '' });
        box.appendChild(inp);
        const acts = el('div', { class: 'actions' });
        acts.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: () => { UI.close(); res(null); } }));
        const ok = el('button', { class: 'btn primary', text: 'Save', onclick: () => { UI.close(); res(inp.value.trim() || null); } });
        acts.appendChild(ok); box.appendChild(acts);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); });
        setTimeout(() => { inp.focus(); inp.select(); }, 30);
      });
    });
  };
  UI.progress = function (title) {
    const box = UI.modal(b => {
      b.appendChild(el('h2', { text: title }));
      b.appendChild(el('p', { class: 'note', id: 'progMsg', text: 'Working…' }));
      const bar = el('div', { style: 'height:6px;background:var(--bg3);border-radius:99px;overflow:hidden;margin-top:8px' });
      bar.appendChild(el('div', { id: 'progBar', style: 'height:100%;width:0;background:var(--accent);transition:width .2s' }));
      b.appendChild(bar);
    }, { dismissable: false });
    return {
      set(pct, msg) {
        const bar = box.querySelector('#progBar'), m = box.querySelector('#progMsg');
        if (bar) bar.style.width = NW.clamp(pct * 100, 0, 100) + '%';
        if (m && msg) m.textContent = msg;
      },
      done() { UI.close(); }
    };
  };

  /* ══════════════ swatches & sizes ══════════════ */

  /** exactly five swatches, plus the ⋯ door to everything else */
  function swatchRow(key, paletteName, current, onPick, opt) {
    opt = opt || {};
    const g = el('div', { class: 'grp' });
    const pick = c => { rememberColour(key, c); onPick(c); };

    const paint = () => {
      g.innerHTML = '';
      if (opt.none) {
        g.appendChild(el('button', {
          class: 'sw more' + (!current ? ' active' : ''), title: 'No fill',
          html: '<svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M5 19L19 5" class="ln"/></svg>',
          onclick: () => onPick('')
        }));
      }
      recentFor(key).slice(0, 5).forEach(c => {
        g.appendChild(el('button', {
          class: 'sw' + (c.toLowerCase() === String(current || '').toLowerCase() ? ' on' : ''),
          style: 'background:' + c, title: c, onclick: () => pick(c)
        }));
      });
      const more = el('button', { class: 'sw more', title: 'All colours', text: '⋯' });
      more.addEventListener('click', () => {
        more.classList.add('active');
        UI.palettePopover(more, PALETTE[paletteName] || PALETTE.ink, current, c => { pick(c); },
          () => more.classList.remove('active'));
      });
      g.appendChild(more);
    };
    paint();
    return g;
  }

  /** the full palette, a system colour picker and a hex box */
  UI.palettePopover = function (anchor, colours, current, onPick, onClose) {
    const old = document.querySelector('.palette'); if (old) old.remove();
    const pop = el('div', { class: 'palette' });
    pop.appendChild(el('h4', { text: 'Colour' }));

    const rows = el('div', { class: 'rows' });
    colours.forEach(c => rows.appendChild(el('button', {
      class: 'sw' + (c.toLowerCase() === String(current || '').toLowerCase() ? ' on' : ''),
      style: 'background:' + c, title: c,
      onclick: () => { onPick(c); close(); }
    })));
    pop.appendChild(rows);

    const custom = el('div', { class: 'custom' });
    const lab = el('label', { title: 'Pick any colour' });
    const inp = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#16150f' });
    lab.appendChild(inp);
    const hex = el('input', { class: 'hexin', type: 'text', value: current || '', spellcheck: 'false', placeholder: '#000000' });
    inp.addEventListener('input', () => { hex.value = inp.value; onPick(inp.value); });
    hex.addEventListener('change', () => {
      let v = hex.value.trim(); if (v && v[0] !== '#') v = '#' + v;
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { onPick(v); close(); }
      else NW.toast('That is not a colour code — try something like #4a90d9');
    });
    custom.append(lab, hex);
    pop.appendChild(custom);

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = NW.clamp(r.left - 100, 8, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.min(r.bottom + 8, innerHeight - pop.offsetHeight - 8) + 'px';

    function close() {
      pop.remove();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
      if (onClose) onClose();
    }
    function outside(e) { if (!pop.contains(e.target) && e.target !== anchor) close(); }
    function esc(e) { if (e.key === 'Escape') close(); }
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', esc);
    }, 10);
    return pop;
  };
  function sizeRow(sizes, current, onPick, cap) {
    const g = el('div', { class: 'grp' });
    sizes.forEach(s => {
      const b = el('button', { class: 'sz' + (Math.abs(s - current) < 0.01 ? ' on' : ''), title: s + ' px', onclick: () => onPick(s) });
      const d = Math.max(2, Math.min(cap || 16, s));
      b.appendChild(el('i', { style: `width:${d}px;height:${d}px` }));
      g.appendChild(b);
    });
    return g;
  }
  /** a continuous size control, for when none of the presets is quite right */
  function sizeSlider(min, max, current, onPick, opt) {
    opt = opt || {};
    const g = el('div', { class: 'grp size-slider' });
    const out = el('span', { class: 'val', text: fmtSize(current) });
    const rng = el('input', {
      type: 'range', min: String(min), max: String(max),
      step: String(opt.step || 0.1), value: String(current), title: 'Drag for any size'
    });
    rng.addEventListener('input', () => {
      const v = Math.round(parseFloat(rng.value) * 10) / 10;
      out.textContent = fmtSize(v);
      onPick(v, true);                       // live: update without rebuilding the bar
    });
    rng.addEventListener('change', () => {
      onPick(Math.round(parseFloat(rng.value) * 10) / 10, false);
    });
    g.append(rng, out);
    return g;
  }
  const fmtSize = v => (v >= 10 ? Math.round(v) : (Math.round(v * 10) / 10)) + '';

  function seg(options, current, onPick) {
    const g = el('div', { class: 'seg' });
    options.forEach(o => g.appendChild(el('button', { class: o.v === current ? 'on' : '', text: o.t, title: o.d || '', onclick: () => onPick(o.v) })));
    return g;
  }
  function label(t) { return el('span', { class: 'lab', text: t }); }
  function hint(t) { return el('span', { class: 'hintline', text: t }); }

  /* ══════════════ contextual sub-bar ══════════════ */
  UI.buildSubbar = function () {
    const bar = $('#subbar'); bar.innerHTML = '';
    const o = T.opts;
    const rerender = () => { T.saveOpts(); UI.buildSubbar(); };

    switch (T.tool) {
      case 'pen': {
        bar.append(label('Ink'), swatchRow('pen', 'ink', o.pen.color, c => { o.pen.color = c; rerender(); }));
        bar.append(label('Size'), sizeRow(PEN_SIZES, o.pen.size, s => { o.pen.size = s; rerender(); }));
        bar.append(sizeSlider(0.5, 24, o.pen.size, (v, live) => { o.pen.size = v; T.saveOpts(); if (!live) UI.buildSubbar(); }));
        const chk = el('label', { class: 'chk', title: 'Line thickens as you press' });
        const cb = el('input', { type: 'checkbox' }); cb.checked = o.pen.pressure;
        cb.onchange = () => { o.pen.pressure = cb.checked; E.invalidateAll(); T.saveOpts(); };
        chk.append(cb, document.createTextNode('Pressure'));
        bar.append(chk);
        /* Unlike Pressure, this only ever affects the *next* stroke: the lean of
           the nib is measured as you write and stored on the samples, so ink
           already on the page keeps the width it was drawn with. */
        const chkT = el('label', { class: 'chk', title: 'Lay the pen over to shade with the side of the nib — applies to new strokes' });
        const cbT = el('input', { type: 'checkbox' }); cbT.checked = o.pen.tilt;
        cbT.onchange = () => { o.pen.tilt = cbT.checked; T.saveOpts(); };
        chkT.append(cbT, document.createTextNode('Tilt'));
        bar.append(chkT);
        const chk2 = el('label', { class: 'chk' });
        const cb2 = el('input', { type: 'checkbox' }); cb2.checked = T.settings.scribbleWhileWriting;
        cb2.onchange = () => { T.settings.scribbleWhileWriting = cb2.checked; T.saveOpts(); };
        chk2.append(cb2, document.createTextNode('Scribble to erase'));
        bar.append(chk2);
        const chk3 = el('label', { class: 'chk' });
        const cb3 = el('input', { type: 'checkbox' }); cb3.checked = T.settings.holdToSnap;
        cb3.onchange = () => { T.settings.holdToSnap = cb3.checked; T.saveOpts(); };
        chk3.append(cb3, document.createTextNode('Hold to snap shape'));
        bar.append(chk3);
        break;
      }
      case 'highlighter': {
        bar.append(label('Colour'), swatchRow('highlighter', 'highlight', o.highlighter.color, c => { o.highlighter.color = c; rerender(); }));
        bar.append(label('Width'), sizeRow(HL_SIZES, o.highlighter.size, s => { o.highlighter.size = s; rerender(); }, 18));
        bar.append(sizeSlider(6, 80, o.highlighter.size, (v, live) => { o.highlighter.size = v; T.saveOpts(); if (!live) UI.buildSubbar(); }, { step: 1 }));
        bar.append(seg([{ v: false, t: 'Freehand' }, { v: true, t: 'Straight' }], o.highlighter.straight, v => { o.highlighter.straight = v; rerender(); }));
        bar.append(seg([{ v: true, t: 'Chisel' }, { v: false, t: 'Round' }], o.highlighter.chisel, v => { o.highlighter.chisel = v; rerender(); }));
        bar.append(hint('Tints the page — your words stay readable underneath'));
        break;
      }
      case 'eraser': {
        bar.append(label('Mode'), seg([
          { v: 'area', t: 'Sweep', d: 'A grey trail — anything it touches is removed whole' },
          { v: 'scribble', t: 'Scribble', d: 'Scribble back and forth over something to delete it' }
        ], o.eraser.mode, v => { o.eraser.mode = v; rerender(); }));
        if (o.eraser.mode === 'area') {
          bar.append(label('Size'), sizeRow(ER_SIZES, o.eraser.size, s => { o.eraser.size = s; rerender(); }, 18));
          bar.append(sizeSlider(6, 160, o.eraser.size, (v, live) => { o.eraser.size = v; T.saveOpts(); if (!live) UI.buildSubbar(); }, { step: 1 }));
        }
        const chk = el('label', { class: 'chk' });
        const cb = el('input', { type: 'checkbox' }); cb.checked = o.eraser.inkOnly;
        cb.onchange = () => { o.eraser.inkOnly = cb.checked; T.saveOpts(); };
        chk.append(cb, document.createTextNode('Ink only'));
        bar.append(chk);
        const chk2 = el('label', { class: 'chk' });
        const cb2 = el('input', { type: 'checkbox' }); cb2.checked = !!o.eraser.highlighterOnly;
        cb2.onchange = () => { o.eraser.highlighterOnly = cb2.checked; T.saveOpts(); };
        chk2.append(cb2, document.createTextNode('Highlighter only'));
        bar.append(chk2);
        bar.append(el('button', { class: 'chip', text: 'Clear page', onclick: clearPage }));
        bar.append(hint(o.eraser.mode === 'area'
          ? 'Whatever the grey trail overlaps is deleted in full'
          : 'Scribble back and forth over a word a few times. One pass through something leaves it alone.'));
        break;
      }
      case 'lasso': {
        bar.append(label('Grab'), seg([
          { v: 'all', t: 'Everything' }, { v: 'ink', t: 'Ink' }, { v: 'image', t: 'Images' }, { v: 'text', t: 'Text' }
        ], o.lasso.filter, v => { o.lasso.filter = v; rerender(); }));
        bar.append(seg([{ v: 'contain', t: 'Fully inside' }, { v: 'touch', t: 'Touching' }], o.lasso.mode, v => { o.lasso.mode = v; rerender(); }));
        bar.append(el('button', { class: 'chip', text: 'Select all', onclick: () => T.selectAll() }));
        bar.append(hint('Circle some working, then drag it anywhere on the page'));
        break;
      }
      case 'shape': {
        bar.append(label('Shape'), seg([
          { v: 'auto', t: 'Auto' }, { v: 'line', t: 'Line' }, { v: 'arrow', t: 'Arrow' },
          { v: 'rect', t: 'Box' }, { v: 'ellipse', t: 'Oval' }, { v: 'triangle', t: 'Triangle' }
        ], o.shape.kind, v => { o.shape.kind = v; rerender(); }));
        bar.append(label('Line'), swatchRow('shape', 'ink', o.shape.color, c => { o.shape.color = c; rerender(); }));
        bar.append(sizeRow(PEN_SIZES, o.shape.size, s => { o.shape.size = s; rerender(); }));
        bar.append(sizeSlider(0.5, 24, o.shape.size, (v, live) => { o.shape.size = v; T.saveOpts(); if (!live) UI.buildSubbar(); }));
        bar.append(label('Fill'), swatchRow('shapeFill', 'fill', o.shape.fill,
          c => { o.shape.fill = c; rerender(); }, { none: true }));
        const chk = el('label', { class: 'chk' });
        const cb = el('input', { type: 'checkbox' }); cb.checked = o.shape.regular;
        cb.onchange = () => { o.shape.regular = cb.checked; T.saveOpts(); };
        chk.append(cb, document.createTextNode('Perfect square / circle'));
        bar.append(chk);
        break;
      }
      case 'fill': {
        bar.append(label('Colour'), swatchRow('fill', 'fill', o.fill.color, c => { o.fill.color = c; rerender(); }));
        bar.append(label('Tolerance'));
        const rng = el('input', { type: 'range', min: 4, max: 90, value: o.fill.tolerance, style: 'width:110px' });
        rng.oninput = () => { o.fill.tolerance = +rng.value; T.saveOpts(); };
        bar.append(rng);
        bar.append(label('Bleed'), seg([{ v: 0, t: '0' }, { v: 1, t: '1' }, { v: 2, t: '2' }, { v: 3, t: '3' }], o.fill.gap, v => { o.fill.gap = v; rerender(); }));
        bar.append(hint('Tap inside a closed outline. Fills tuck under your ink.'));
        break;
      }
      case 'text': {
        const fsel = el('select', { title: 'Font' });
        NW.FONTS.forEach(f => {
          const opt = el('option', { value: f.name, text: f.name });
          opt.style.fontFamily = f.css;
          if (f.name === o.text.fontName) opt.selected = true;
          fsel.appendChild(opt);
        });
        fsel.onchange = () => {
          const f = NW.FONTS.find(x => x.name === fsel.value);
          NW.Text.applyStyle({ font: f.css, fontName: f.name });
        };
        bar.append(label('Font'), fsel);

        const ssel = el('select', { title: 'Size (pt)' });
        NW.FONT_SIZES.forEach(pt => {
          const px = Math.round(pt * NW.PT);
          const opt = el('option', { value: px, text: pt });
          if (Math.abs(px - o.text.size) < 1.5) opt.selected = true;
          ssel.appendChild(opt);
        });
        ssel.onchange = () => NW.Text.applyStyle({ size: +ssel.value });
        bar.append(label('Size'), ssel);

        const style = el('div', { class: 'seg' });
        style.appendChild(el('button', { class: o.text.bold ? 'on' : '', html: '<b>B</b>', title: 'Bold', onclick: () => NW.Text.applyStyle({ bold: !o.text.bold }) }));
        style.appendChild(el('button', { class: o.text.italic ? 'on' : '', html: '<i>I</i>', title: 'Italic', onclick: () => NW.Text.applyStyle({ italic: !o.text.italic }) }));
        style.appendChild(el('button', { class: o.text.underline ? 'on' : '', html: '<u>U</u>', title: 'Underline', onclick: () => NW.Text.applyStyle({ underline: !o.text.underline }) }));
        bar.append(style);
        bar.append(seg([{ v: 'left', t: '⇤' }, { v: 'center', t: '↔' }, { v: 'right', t: '⇥' }], o.text.align, v => NW.Text.applyStyle({ align: v })));
        bar.append(label('Colour'), swatchRow('text', 'ink', o.text.color, c => NW.Text.applyStyle({ color: c })));
        bar.append(label('Marker'), swatchRow('textHighlight', 'highlight', o.text.highlight,
          c => NW.Text.applyStyle({ highlight: c }), { none: true }));
        break;
      }
      case 'hand':
        bar.append(hint('Drag to move around. Pinch or ⌘‑scroll to zoom. Two fingers work in any tool.'));
        bar.append(el('button', { class: 'chip', text: 'Fit width', onclick: () => { E.fitWidth(); NW.emit('cam'); } }));
        bar.append(el('button', { class: 'chip', text: '100%', onclick: () => E.setZoom(1) }));
        break;
    }
    publishSubbarHeight();
  };

  /* The side panels are absolutely positioned and used to start at a fixed
     --bar + --sub from the top. The options row can now wrap onto a second
     line when a tool has more options than fit across — the highlighter is the
     one that does — so that constant is no longer its real height, and the
     panels would sit over the controls beside them. Publish what the row
     actually measures and let the CSS use it. */
  let subbarRO = null;
  function publishSubbarHeight() {
    const bar = $('#subbar'), screen = $('#editor');
    if (!bar || !screen || !screen.style || typeof screen.style.setProperty !== 'function') return;
    const apply = () => {
      const h = bar.offsetHeight;
      if (h) screen.style.setProperty('--sub-h', h + 'px');
    };
    if (!subbarRO && typeof ResizeObserver !== 'undefined') {
      // rotation and window resizes change how much fits, so watch it too
      subbarRO = new ResizeObserver(apply);
      subbarRO.observe(bar);
    }
    apply();
  }

  async function clearPage() {
    const page = E.pages[E.active]; if (!page || !page.items.length) return;
    if (!await UI.confirm('Clear this page?', 'Everything you have drawn or typed on page ' + (E.active + 1) + ' will be removed. You can undo it.', 'Clear page')) return;
    E.removeItems(page, page.items.slice(), 'clear page');
  }

  /* ══════════════ toolbar ══════════════ */
  UI.initToolbar = function () {
    NW.$$('.tb.tool').forEach(b => b.addEventListener('click', () => T.setTool(b.dataset.tool)));
    $('#btnBack').onclick = () => UI.showLibrary();
    $('#btnUndo').onclick = () => E.History.stepBack();
    $('#btnRedo').onclick = () => E.History.stepFwd();
    $('#btnImage').onclick = pickImage;
    $('#btnAddPage').onclick = () => UI.pageStyleDialog(null, true);
    $('#btnAddPage2').onclick = () => UI.pageStyleDialog(null, true);
    $('#btnPages').onclick = () => { const p = $('#pagesPanel'); p.hidden = !p.hidden; if (!p.hidden) UI.renderThumbs(); };
    $('#closePages').onclick = () => { $('#pagesPanel').hidden = true; };
    $('#btnExport').onclick = () => UI.exportDialog();
    $('#btnAI').onclick = () => UI.toggleAI();
    $('#closeAI').onclick = () => UI.toggleAI(false);
    $('#btnTheme2').onclick = () => NW.toast('Theme: ' + NW.Theme.cycle(), 1100);
    $('#btnZoomIn').onclick = () => E.setZoom(E.cam.zoom * 1.25);
    $('#btnZoomOut').onclick = () => E.setZoom(E.cam.zoom / 1.25);
    $('#btnZoomReset').onclick = () => E.fitWidth();

    $('#docTitle').addEventListener('blur', () => {
      const t = $('#docTitle').textContent.trim() || 'Untitled';
      $('#docTitle').textContent = t;
      if (E.nb) { E.nb.name = t; NW.Lib.touch(E.nb); }
    });
    $('#docTitle').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

    NW.$$('#selbar button').forEach(b => b.addEventListener('click', () => T.selAction(b.dataset.act)));

    NW.on('tool:changed', () => {
      NW.$$('.tb.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === T.tool));
      UI.buildSubbar();
    });
    NW.on('history', () => {
      $('#btnUndo').disabled = !E.History.canUndo();
      $('#btnRedo').disabled = !E.History.canRedo();
    });
    NW.on('cam', () => { $('#btnZoomReset').textContent = Math.round(E.cam.zoom * 100) + '%'; UI.trackActivePage(); });
    NW.on('selection', UI.positionSelbar);
    NW.on('selection:drag', d => { $('#selbar').style.opacity = d ? '0' : '1'; });
    NW.on('rendered', UI.positionSelbar);
    NW.on('pages:changed', () => { if (!$('#pagesPanel').hidden) UI.renderThumbs(); });
    NW.on('page:changed', NW.debounce(() => { if (!$('#pagesPanel').hidden) UI.renderThumbs(); }, 900));
    NW.on('pen:detected', () => { NW.toast('Stylus detected — fingers now scroll instead of drawing', 2400); });
    NW.on('ui:recolor', items => UI.recolorDialog(items));

    NW.on('theme', () => { E.invalidateAll(); UI.buildSubbar(); if (UI.view === 'library') UI.renderLibrary(); });

    NW.on('pull:progress', p => {
      const h = $('#pageHint'), ring = h.querySelector('.prg');
      h.classList.toggle('show', p > 0.02);
      if (ring) ring.style.strokeDashoffset = String(94.2 * (1 - p));
    });
    NW.on('page:autoadd', async () => {
      const p = await T.addPage();
      NW.toast('Page ' + E.pages.length + ' added');
      E.scrollTo(E.pages.length - 1);
    });
  };

  UI.trackActivePage = NW.throttleRAF(function () {
    const mid = E.toWorld(E.vw / 2, E.vh / 2);
    let best = 0, bd = Infinity;
    E.layout.forEach((L, i) => { const d = Math.abs((L.y + L.h / 2) - mid.y); if (d < bd) { bd = d; best = i; } });
    if (best !== E.active) { E.active = best; NW.emit('page:active', best); if (!$('#pagesPanel').hidden) UI.markActiveThumb(); }
  });

  UI.positionSelbar = function () {
    const bar = $('#selbar'), s = E.selection;
    if (!s || !s.items.length) { bar.hidden = true; return; }
    const L = E.layout[s.pageIndex]; if (!L) { bar.hidden = true; return; }
    const b = s.bbox;
    const tl = E.toScreen(L.x + b.x0, L.y + b.y0);
    const br = E.toScreen(L.x + b.x1, L.y + b.y1);
    const stage = $('#stage').getBoundingClientRect();
    bar.hidden = false;
    const w = bar.offsetWidth || 250;
    let x = stage.left + (tl.x + br.x) / 2 - w / 2;
    let y = stage.top + tl.y - 48;
    if (y < stage.top + 6) y = stage.top + br.y + 12;
    bar.style.left = NW.clamp(x, stage.left + 6, stage.right - w - 6) + 'px';
    bar.style.top = NW.clamp(y, stage.top + 6, stage.bottom - 50) + 'px';
  };

  async function pickImage() {
    const f = await NW.pickFile('image/*');
    if (!f) return;
    const d = await NW.readAsDataURL(f);
    await T.insertImage(d);
  }

  UI.recolorDialog = function (items) {
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'Recolour selection' }));
      box.appendChild(el('p', { class: 'note', text: items.length + ' item' + (items.length === 1 ? '' : 's') + ' selected.' }));
      const rows = el('div', { class: 'rows', style: 'display:grid;grid-template-columns:repeat(10,1fr);gap:9px' });
      PALETTE.ink.concat(PALETTE.highlight.slice(0, 10)).forEach(c => rows.appendChild(el('button', {
        class: 'sw', style: 'background:' + c, title: c,
        onclick: () => { T.recolor(items, c); UI.close(); }
      })));
      box.appendChild(rows);
      const custom = el('div', { class: 'row', style: 'margin-top:16px' });
      const inp = el('input', { type: 'color', value: '#16150f', style: 'width:44px;height:34px;padding:0;border:1px solid var(--line-2);border-radius:6px;background:none' });
      custom.append(inp, el('span', { class: 'hintline', text: 'or pick any colour' }));
      inp.addEventListener('change', () => { T.recolor(items, inp.value); UI.close(); });
      box.appendChild(custom);
      const acts = el('div', { class: 'actions' });
      acts.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      box.appendChild(acts);
    });
  };

  /* ══════════════ page style / add page ══════════════ */
  UI.pageStyleDialog = function (pageIndex, isAdd) {
    const cur = pageIndex != null ? E.pages[pageIndex] : (E.pages[E.pages.length - 1] || {});
    let tpl = cur.template || 'lined';
    let paper = cur.paper || 'white';
    let landscape = cur.w > cur.h;
    let size = E.nb ? E.nb.paper : 'a4';

    UI.modal(box => {
      box.appendChild(el('h2', { text: isAdd ? 'Add a page' : 'Page ' + (pageIndex + 1) + ' layout' }));
      box.appendChild(el('p', { class: 'note', text: 'Tip: you can also just keep pulling past the bottom of the last page and hold — a page appears with the same layout.' }));

      box.appendChild(el('label', { text: 'Ruling' }));
      const grid = el('div', { class: 'tpl-grid' });
      const draw = () => {
        grid.innerHTML = '';
        NW.templateList().forEach(id => {
          const b = el('button', { class: 'tpl' + (id === tpl ? ' on' : ''), onclick: () => { tpl = id; draw(); } });
          b.appendChild(NW.templateThumb(id, paper, 96));
          b.appendChild(el('div', { class: 't', text: NW.templateName(id) }));
          grid.appendChild(b);
        });
      };
      draw(); box.appendChild(grid);

      box.appendChild(el('label', { text: 'Paper' }));
      const pr = el('div', { class: 'paper-row' });
      NW.PAPER_COLORS.forEach(c => {
        const b = el('button', { class: 'chip' + (c.id === paper ? ' on' : ''), onclick: () => { paper = c.id; pr.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); draw(); } });
        b.prepend(el('span', { style: `display:inline-block;width:11px;height:11px;border-radius:50%;background:${c.bg};border:1px solid rgba(128,128,128,.5);margin-right:6px;vertical-align:-1px` }));
        b.append(document.createTextNode(c.name));
        pr.appendChild(b);
      });
      box.appendChild(pr);

      box.appendChild(el('label', { text: 'Size & orientation' }));
      const sr = el('div', { class: 'paper-row' });
      Object.keys(NW.PAPER).forEach(k => {
        sr.appendChild(el('button', { class: 'chip' + (k === size ? ' on' : ''), text: NW.PAPER[k].name, onclick: e => { size = k; sr.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }));
      });
      box.appendChild(sr);
      const or = el('div', { class: 'paper-row' });
      ['Portrait', 'Landscape'].forEach((t, i) => {
        or.appendChild(el('button', { class: 'chip' + ((i === 1) === landscape ? ' on' : ''), text: t, onclick: e => { landscape = i === 1; or.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }));
      });
      box.appendChild(or);

      const acts = el('div', { class: 'actions' });
      acts.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      if (!isAdd) acts.appendChild(el('button', {
        class: 'btn', text: 'Apply to every page', onclick: () => {
          const before = E.pages.map(p => ({ p, t: p.template, pa: p.paper, bg: p.bg, ink: p.inkColor }));
          const pc = NW.paperColor(paper);
          E.mutate(E.pages[0],
            () => { E.pages.forEach(p => { p.template = tpl; p.paper = paper; p.bg = pc.bg; p.inkColor = pc.ink; NW.Lib.markPage(p); }); E.invalidateAll(); },
            () => { before.forEach(b => { b.p.template = b.t; b.p.paper = b.pa; b.p.bg = b.bg; b.p.inkColor = b.ink; NW.Lib.markPage(b.p); }); E.invalidateAll(); },
            'page style');
          UI.close();
        }
      }));
      acts.appendChild(el('button', {
        class: 'btn primary', text: isAdd ? 'Add page' : 'Apply', onclick: async () => {
          if (isAdd) {
            const at = pageIndex != null ? pageIndex + 1 : E.pages.length;
            await T.addPage({ template: tpl, paperColor: paper, size, landscape }, at);
            E.scrollTo(at);
          } else {
            T.setPageTemplate(pageIndex, tpl, paper);
            const pg = E.pages[pageIndex], P = NW.PAPER[size];
            if (pg && P) { pg.w = landscape ? P.h : P.w; pg.h = landscape ? P.w : P.h; E.relayout(); E.invalidate(pg.id); }
          }
          UI.close();
        }
      }));
      box.appendChild(acts);
    });
  };

  /* ══════════════ page thumbnails ══════════════ */
  UI.renderThumbs = NW.debounce(async function () {
    const wrap = $('#thumbs'); if (!wrap) return;
    wrap.innerHTML = '';
    for (let i = 0; i < E.pages.length; i++) {
      const p = E.pages[i];
      const d = el('div', { class: 'thumb' + (i === E.active ? ' on' : ''), onclick: () => { E.scrollTo(i); E.active = i; UI.markActiveThumb(); } });
      await E.preloadPage(p);
      // Raster at device resolution and let CSS size it back down; at 1x the
      // browser was stretching a 150px bitmap across a wider slot.
      const c = E.renderPageTo(p, (150 * NW.dpr()) / Math.max(p.w, p.h));
      c.style.width = '100%';
      d.appendChild(c);
      d.appendChild(el('span', { class: 'n', text: i + 1 }));
      d.appendChild(el('button', {
        class: 'del', text: '⋯', title: 'Page options',
        onclick: e => { e.stopPropagation(); pageMenu(e, i); }
      }));
      wrap.appendChild(d);
    }
  }, 120);

  UI.markActiveThumb = function () {
    NW.$$('#thumbs .thumb').forEach((t, i) => t.classList.toggle('on', i === E.active));
  };

  function pageMenu(ev, i) {
    UI.menu(ev, [
      { t: 'Change layout…', f: () => UI.pageStyleDialog(i) },
      { t: 'Insert page after', f: () => UI.pageStyleDialog(i, true) },
      { t: 'Duplicate page', f: () => T.duplicatePage(i) },
      { t: 'Export this page as PDF', f: () => exportOne(i) },
      { t: 'Export this page as PNG', f: async () => { const b = await NW.Export.pageToPNG(E.pages[i], 2); NW.download(b, NW.ZIP.safeName(E.nb.name) + '-p' + (i + 1) + '.png'); } },
      { sep: 1 },
      { t: 'Delete page', danger: 1, f: () => T.deletePage(i) }
    ]);
  }
  async function exportOne(i) {
    const pr = UI.progress('Exporting page ' + (i + 1));
    try {
      const blob = await NW.Export.pagesToPDF([E.pages[i]], { title: E.nb.name });
      NW.download(blob, NW.ZIP.safeName(E.nb.name) + '-p' + (i + 1) + '.pdf');
    } catch (e) { NW.toast(e.message); }
    pr.done();
  }

  UI.menu = function (ev, items) {
    const old = document.querySelector('.menu'); if (old) old.remove();
    const m = el('div', { class: 'menu' });
    items.forEach(it => {
      if (it.sep) { m.appendChild(el('hr')); return; }
      m.appendChild(el('button', { class: it.danger ? 'danger' : '', text: it.t, onclick: () => { m.remove(); it.f(); } }));
    });
    document.body.appendChild(m);
    const r = (ev.currentTarget || ev.target).getBoundingClientRect();
    m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 10) + 'px';
    m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 10) + 'px';
    setTimeout(() => {
      const close = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', close); } };
      document.addEventListener('pointerdown', close);
    }, 10);
  };

  /* ══════════════ export dialog ══════════════ */
  UI.exportDialog = function () {
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'Export “' + (E.nb ? E.nb.name : '') + '”' }));
      box.appendChild(el('p', { class: 'note', text: E.pages.length + ' page' + (E.pages.length === 1 ? '' : 's') + '. Typed text stays selectable and searchable in the PDF.' }));

      box.appendChild(el('label', { text: 'Pages' }));
      const rangeRow = el('div', { class: 'row' });
      const rangeInp = el('input', { type: 'text', placeholder: 'e.g. 1-4, 7, 10-  (blank = all)', style: 'flex:1' });
      rangeRow.appendChild(rangeInp); box.appendChild(rangeRow);

      box.appendChild(el('label', { text: 'Quality' }));
      let dpi = NW.Export.DEFAULT_DPI, q = 'lossless';
      const qr = el('div', { class: 'paper-row' });
      [['Standard · 200 dpi', 200, 'lossless'],
       ['Print · 300 dpi', 300, 'lossless'],
       ['Smaller file', 150, 'balanced']]
        .forEach(([t, d, qq], i) => {
          const b = el('button', { class: 'chip' + (i === 0 ? ' on' : ''), text: t, onclick: () => { dpi = d; q = qq; qr.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); } });
          qr.appendChild(b);
        });
      box.appendChild(qr);
      box.appendChild(el('p', { class: 'note', style: 'margin-top:8px',
        text: 'The first two keep your ink exactly as drawn. “Smaller file” compresses the page as a photo, which is lighter to email but softens thin handwriting.' }));

      const acts = el('div', { class: 'actions' });
      acts.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      acts.appendChild(el('button', {
        class: 'btn', text: 'Backup file (.nwbak)', onclick: async () => {
          UI.close();
          const b = await NW.Export.backup([E.nb.id]);
          NW.download(b, NW.ZIP.safeName(E.nb.name) + '.nwbak');
        }
      }));
      acts.appendChild(el('button', {
        class: 'btn primary', text: 'Export PDF', onclick: async () => {
          const idx = parseRange(rangeInp.value, E.pages.length);
          UI.close();
          const pr = UI.progress('Building PDF');
          try {
            const blob = await NW.Export.notebookToPDF(E.nb, {
              indices: idx, dpi, quality: q,
              onProgress: (i, n, phase) => pr.set(i / Math.max(n, 1), phase === 'encode' ? 'Writing page ' + (i + 1) + ' of ' + n : 'Rendering page ' + (i + 1) + ' of ' + n)
            });
            NW.download(blob, NW.ZIP.safeName(E.nb.name) + '.pdf');
            NW.toast('Saved ' + NW.bytes(blob.size));
          } catch (e) { NW.toast(e.message || 'Export failed'); }
          pr.done();
        }
      }));
      box.appendChild(acts);
    });
  };

  function parseRange(s, n) {
    s = (s || '').trim();
    if (!s) return null;
    const out = new Set();
    for (const part of s.split(',')) {
      const m = /^\s*(\d+)?\s*(-)?\s*(\d+)?\s*$/.exec(part);
      if (!m) continue;
      const a = m[1] ? +m[1] : 1, b = m[3] ? +m[3] : (m[2] ? n : a);
      for (let i = a; i <= Math.min(b, n); i++) if (i >= 1) out.add(i - 1);
    }
    return out.size ? Array.from(out).sort((x, y) => x - y) : null;
  }

  /* ══════════════ library shelf ══════════════ */
  UI.showLibrary = function () {
    NW.Text.commit();
    NW.Lib.flush();
    UI.view = 'library';
    $('#editor').hidden = true; $('#library').hidden = false;
    UI.renderLibrary();
  };
  UI.showEditor = function () {
    UI.view = 'editor';
    $('#library').hidden = true; $('#editor').hidden = false;
    requestAnimationFrame(() => E.resize());
  };

  UI.renderLibrary = NW.debounce(async function () {
    const grid = $('#libGrid'); grid.innerHTML = '';
    const q = UI.search.toLowerCase();

    const crumbs = $('#crumbs'); crumbs.innerHTML = '';
    crumbs.appendChild(el('button', { text: 'All notebooks', onclick: () => { UI.folderId = null; UI.renderLibrary(); } }));
    NW.Lib.path(UI.folderId).forEach(f => {
      crumbs.appendChild(el('span', { text: '›' }));
      crumbs.appendChild(el('button', { html: '<b>' + NW.esc(f.name) + '</b>', onclick: () => { UI.folderId = f.id; UI.renderLibrary(); } }));
    });

    let folders = NW.Lib.childFolders(UI.folderId);
    let books = NW.Lib.childNotebooks(UI.folderId);
    if (q) {
      folders = NW.Lib.folders.filter(f => f.name.toLowerCase().includes(q));
      books = NW.Lib.notebooks.filter(n => n.name.toLowerCase().includes(q));
    }

    for (const f of folders) {
      const card = el('div', { class: 'card folder', onclick: () => { UI.folderId = f.id; UI.search = ''; $('#libSearch').value = ''; UI.renderLibrary(); } });
      const art = el('div', { class: 'art', html: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" class="ln"/></svg>' });
      const n = NW.Lib.descendants(f.id).length;
      art.appendChild(el('span', { class: 'badge', text: n + (n === 1 ? ' notebook' : ' notebooks') }));
      card.append(art, el('div', { class: 'nm', text: f.name }), el('div', { class: 'sub', text: 'Folder' }));
      card.appendChild(el('button', { class: 'kebab', text: '⋯', onclick: e => { e.stopPropagation(); folderMenu(e, f); } }));
      grid.appendChild(card);
    }

    for (const nb of books) {
      const card = el('div', { class: 'card', onclick: () => UI.openNotebook(nb.id) });
      const art = el('div', { class: 'art' });
      art.appendChild(el('div', { class: 'spine' }));
      card.appendChild(art);
      card.append(el('div', { class: 'nm', text: nb.name }),
        el('div', { class: 'sub', text: nb.pageIds.length + (nb.pageIds.length === 1 ? ' page · ' : ' pages · ') + NW.when(nb.updatedAt) }));
      if (nb.isPDF) art.appendChild(el('span', { class: 'badge', text: 'PDF' }));
      card.appendChild(el('button', { class: 'kebab', text: '⋯', onclick: e => { e.stopPropagation(); notebookMenu(e, nb); } }));
      grid.appendChild(card);
      // lazily paint the cover
      (async () => {
        const p = await NW.Lib.page(nb.pageIds[0]);
        if (!p) return;
        await E.preloadPage(p);
        // Same again, and this one is the more visible of the two: a cover is
        // drawn into a card far wider than 260 CSS pixels.
        const c = E.renderPageTo(p, (260 * NW.dpr()) / Math.max(p.w, p.h));
        c.style.width = '100%'; c.style.height = '100%'; c.style.objectFit = 'cover';
        art.insertBefore(c, art.firstChild);
      })();
    }

    $('#libEmpty').hidden = !!(folders.length || books.length);

  }, 40);

  function folderMenu(ev, f) {
    UI.menu(ev, [
      { t: 'Open', f: () => { UI.folderId = f.id; UI.renderLibrary(); } },
      { t: 'Rename…', f: async () => { const n = await UI.prompt('Rename folder', f.name); if (n) { f.name = n; await NW.Store.put('folders', f); UI.renderLibrary(); } } },
      { t: 'Export as ZIP of PDFs', f: () => exportFolder(f.id, 'zip') },
      { t: 'Export as one merged PDF', f: () => exportFolder(f.id, 'merge') },
      { sep: 1 },
      {
        t: 'Delete folder only', danger: 1, f: async () => {
          if (await UI.confirm('Delete folder?', 'Notebooks inside will move to the top level.', 'Delete folder')) { await NW.Lib.deleteFolder(f.id, false); UI.renderLibrary(); }
        }
      },
      {
        t: 'Delete folder + contents', danger: 1, f: async () => {
          if (await UI.confirm('Delete everything?', 'This removes the folder and every notebook inside it. This cannot be undone.', 'Delete all')) { await NW.Lib.deleteFolder(f.id, true); UI.renderLibrary(); }
        }
      }
    ]);
  }

  function notebookMenu(ev, nb) {
    const moveTargets = [{ id: null, name: 'Top level' }].concat(NW.Lib.folders);
    UI.menu(ev, [
      { t: 'Open', f: () => UI.openNotebook(nb.id) },
      { t: 'Rename…', f: async () => { const n = await UI.prompt('Rename notebook', nb.name); if (n) { nb.name = n; NW.Lib.touch(nb); await NW.Store.put('notebooks', nb); UI.renderLibrary(); } } },
      { t: 'Duplicate', f: async () => { await NW.Lib.duplicateNotebook(nb.id); UI.renderLibrary(); } },
      {
        t: 'Move to folder…', f: () => {
          UI.modal(box => {
            box.appendChild(el('h2', { text: 'Move “' + nb.name + '”' }));
            const list = el('div', { class: 'paper-row' });
            moveTargets.forEach(t => list.appendChild(el('button', {
              class: 'chip' + ((nb.folderId || null) === (t.id || null) ? ' on' : ''), text: t.name,
              onclick: async () => { nb.folderId = t.id; NW.Lib.touch(nb); await NW.Store.put('notebooks', nb); UI.close(); UI.renderLibrary(); }
            })));
            box.appendChild(list);
            const a = el('div', { class: 'actions' }); a.appendChild(el('button', { class: 'btn', text: 'Close', onclick: UI.close })); box.appendChild(a);
          });
        }
      },
      {
        t: 'Export PDF', f: async () => {
          const pr = UI.progress('Building PDF');
          try {
            const blob = await NW.Export.notebookToPDF(nb, { onProgress: (i, n) => pr.set(i / Math.max(n, 1), 'Page ' + (i + 1) + ' of ' + n) });
            NW.download(blob, NW.ZIP.safeName(nb.name) + '.pdf');
          } catch (e) { NW.toast(e.message); }
          pr.done();
        }
      },
      { t: 'Backup file (.nwbak)', f: async () => { const b = await NW.Export.backup([nb.id]); NW.download(b, NW.ZIP.safeName(nb.name) + '.nwbak'); } },
      { sep: 1 },
      {
        t: 'Delete notebook', danger: 1, f: async () => {
          if (await UI.confirm('Delete “' + nb.name + '”?', 'All ' + nb.pageIds.length + ' pages go with it. This cannot be undone.', 'Delete')) { await NW.Lib.deleteNotebook(nb.id); UI.renderLibrary(); }
        }
      }
    ]);
  }

  async function exportFolder(folderId, how) {
    const pr = UI.progress(how === 'zip' ? 'Zipping notebooks' : 'Merging into one PDF');
    try {
      const blob = how === 'zip'
        ? await NW.Export.folderToZIP(folderId, { onProgress: (i, n, name) => pr.set(i / Math.max(n, 1), name) })
        : await NW.Export.folderToMergedPDF(folderId, { onProgress: (i, n) => pr.set(i / Math.max(n, 1), 'Page ' + (i + 1) + ' of ' + n) });
      const f = folderId ? NW.Lib.folder(folderId) : null;
      NW.download(blob, NW.ZIP.safeName(f ? f.name : 'NoteWell library') + (how === 'zip' ? '.zip' : '.pdf'));
      NW.toast('Saved ' + NW.bytes(blob.size));
    } catch (e) { NW.toast(e.message || 'Export failed'); }
    pr.done();
  }

  UI.openNotebook = async function (id) {
    const nb = NW.Lib.notebook(id); if (!nb) return;
    const pages = await NW.Lib.loadPages(nb);
    UI.showEditor();
    $('#docTitle').textContent = nb.name;
    E.open(nb, pages);
    E.active = 0;
    NW.AI.clear();
    NW.emit('tool:changed');
    for (const p of pages.slice(0, 3)) E.preloadPage(p);
  };

  /* ══════════════ new notebook ══════════════ */
  UI.newNotebookDialog = function () {
    let tpl = 'lined', paper = 'white', size = 'a4', landscape = false, name = '';
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'New notebook' }));
      box.appendChild(el('label', { text: 'Name' }));
      const nameInp = el('input', { type: 'text', placeholder: 'e.g. PHYS2001 — Lecture notes' });
      box.appendChild(nameInp);

      box.appendChild(el('label', { text: 'Ruling' }));
      const grid = el('div', { class: 'tpl-grid' });
      const draw = () => {
        grid.innerHTML = '';
        NW.templateList().forEach(id => {
          const b = el('button', { class: 'tpl' + (id === tpl ? ' on' : ''), onclick: () => { tpl = id; draw(); } });
          b.appendChild(NW.templateThumb(id, paper, 96));
          b.appendChild(el('div', { class: 't', text: NW.templateName(id) }));
          grid.appendChild(b);
        });
      };
      draw(); box.appendChild(grid);

      box.appendChild(el('label', { text: 'Paper' }));
      const pr = el('div', { class: 'paper-row' });
      NW.PAPER_COLORS.forEach(c => pr.appendChild(el('button', {
        class: 'chip' + (c.id === paper ? ' on' : ''), text: c.name,
        onclick: e => { paper = c.id; pr.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); draw(); }
      })));
      box.appendChild(pr);

      box.appendChild(el('label', { text: 'Size & orientation' }));
      const sr = el('div', { class: 'paper-row' });
      Object.keys(NW.PAPER).forEach(k => sr.appendChild(el('button', {
        class: 'chip' + (k === size ? ' on' : ''), text: NW.PAPER[k].name,
        onclick: e => { size = k; sr.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); }
      })));
      box.appendChild(sr);
      const or = el('div', { class: 'paper-row' });
      ['Portrait', 'Landscape'].forEach((t, i) => or.appendChild(el('button', {
        class: 'chip' + ((i === 1) === landscape ? ' on' : ''), text: t,
        onclick: e => { landscape = i === 1; or.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); }
      })));
      box.appendChild(or);

      const acts = el('div', { class: 'actions' });
      acts.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      acts.appendChild(el('button', {
        class: 'btn primary', text: 'Create', onclick: async () => {
          const nb = await NW.Lib.newNotebook({
            name: nameInp.value.trim() || 'Untitled notebook',
            folderId: UI.folderId, template: tpl, paperColor: paper, paper: size, landscape
          });
          UI.close(); UI.openNotebook(nb.id);
        }
      }));
      box.appendChild(acts);
      setTimeout(() => nameInp.focus(), 40);
    });
  };

  /* ══════════════ library chrome ══════════════ */
  UI.initLibrary = function () {
    $('#btnNewNotebook').onclick = () => UI.newNotebookDialog();
    $('#btnNewFolder').onclick = async () => {
      const n = await UI.prompt('New folder', '', 'Folder name');
      if (n) { await NW.Lib.newFolder(n, UI.folderId); UI.renderLibrary(); }
    };
    $('#btnImportPdf').onclick = async () => {
      const f = await NW.pickFile('application/pdf', true);
      if (f && f.length) UI.importPDFs(f);
    };
    $('#btnInstall').onclick = () => NW.Install.dialog();
    $('#btnTheme').onclick = () => NW.toast('Theme: ' + NW.Theme.cycle(), 1100);
    NW.on('install:changed', () => {
      const b = $('#btnInstall');
      if (b && NW.Install.env().standalone) b.hidden = true;
    });
    if (NW.Install.env().standalone) $('#btnInstall').hidden = true;
    $('#btnAccount').onclick = () => UI.accountDialog();
    $('#btnLibSettings').onclick = () => UI.settingsDialog();
    $('#btnExportFolder').onclick = () => {
      UI.modal(box => {
        box.appendChild(el('h2', { text: 'Export ' + (UI.folderId ? '“' + NW.Lib.folder(UI.folderId).name + '”' : 'everything') }));
        box.appendChild(el('p', { class: 'note', text: NW.Lib.descendants(UI.folderId).length + ' notebooks. Choose one file per notebook, or one document with bookmarks.' }));
        const a = el('div', { class: 'actions' });
        a.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
        a.appendChild(el('button', { class: 'btn', text: 'One merged PDF', onclick: () => { UI.close(); exportFolder(UI.folderId, 'merge'); } }));
        a.appendChild(el('button', { class: 'btn primary', text: 'ZIP of PDFs', onclick: () => { UI.close(); exportFolder(UI.folderId, 'zip'); } }));
        box.appendChild(a);
      });
    };
    $('#btnBackup').onclick = () => UI.backupDialog();
    $('#libSearch').addEventListener('input', e => { UI.search = e.target.value; UI.renderLibrary(); });
    NW.on('lib:changed', () => { if (UI.view === 'library') UI.renderLibrary(); });

    const netBadge = $('#netBadge');
    const setNet = () => {
      const S = NW.Sync;
      netBadge.textContent = NW.Account.signedIn
        ? (NW.Account.state.email + ' · ' + S.label().toLowerCase())
        : (navigator.onLine ? 'Offline‑ready' : 'Offline — all good');
      netBadge.title = NW.Account.signedIn ? S.tooltip() : 'Your notes live on this device. Nothing is uploaded unless you sign in.';
      netBadge.classList.toggle('on', NW.Account.signedIn && S.status === 'synced');
      netBadge.classList.toggle('warn', NW.Account.signedIn && (S.status === 'error' || S.status === 'waiting' || S.status === 'locked'));
    };
    addEventListener('online', setNet); addEventListener('offline', setNet);
    NW.on('account:changed', setNet);
    NW.on('sync:status', setNet);
    NW.on('backup:changed', () => { if (UI.view === 'library') UI.renderLibrary(); });
    setNet();
  };

  /* ══════════════ sync chip ══════════════ */
  UI.initSync = function () {
    const chip = $('#syncChip'), label = $('#syncLabel');
    if (!chip) return;

    const paint = () => {
      const S = NW.Sync;
      chip.hidden = !NW.Account.signedIn;
      if (chip.hidden) return;
      label.textContent = S.label();
      chip.title = S.tooltip() || 'Tap to save to your account now';
      chip.classList.toggle('busy', S.status === 'syncing');
      chip.classList.toggle('warn', S.status === 'error' || S.status === 'locked');
      chip.classList.toggle('off', S.status === 'waiting');
      chip.classList.toggle('ok', S.status === 'synced');
    };

    chip.onclick = async () => {
      if (!NW.Account.signedIn) { UI.accountDialog(); return; }
      if (!navigator.onLine) { UI.offlineDialog(); return; }
      await NW.Sync.now();
    };

    NW.on('sync:status', paint);
    NW.on('account:changed', paint);
    addEventListener('online', paint);
    addEventListener('offline', paint);
    NW.on('sync:needsPassword', () => UI.unlockDialog());
    paint();
  };

  /** What "no wifi" actually means here — said once, properly. */
  UI.offlineDialog = function () {
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'No connection right now' }));
      box.appendChild(el('p', { class: 'note',
        html: '<b>Nothing has been lost.</b> Every stroke you make is written to this device the moment you make it — the account is a copy, not the original. Keep writing.' }));
      box.appendChild(el('p', { class: 'note',
        text: 'As soon as you are back on wifi or data, NoteWell uploads the changes by itself. You do not have to remember to do anything.' }));
      const pend = NW.Sync.pending;
      box.appendChild(el('div', { class: 'kv', html: '<span>Waiting to upload</span><b>' + (pend ? 'yes — will go automatically' : 'nothing pending') + '</b>' }));
      box.appendChild(el('div', { class: 'kv', html: '<span>Last saved to account</span><b>' + (NW.Account.state.lastSync ? NW.when(NW.Account.state.lastSync) : 'not yet') + '</b>' }));
      box.appendChild(el('div', { class: 'kv', html: '<span>Last file backup</span><b>' + NW.Backup.summary() + '</b>' }));
      const a = el('div', { class: 'actions' });
      a.appendChild(el('button', { class: 'btn', text: 'Save a file backup instead', onclick: () => { UI.close(); UI.saveToFiles(); } }));
      a.appendChild(el('button', { class: 'btn primary', text: 'Got it', onclick: UI.close }));
      box.appendChild(a);
    });
  };

  /** the account key isn't on this device yet */
  UI.unlockDialog = function () {
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'Unlock syncing' }));
      box.appendChild(el('p', { class: 'note',
        text: 'Your notebooks are encrypted before they leave this device, so NoteWell needs your account password once to do it. It is not sent anywhere.' }));
      box.appendChild(el('label', { text: 'Password for ' + (NW.Account.state.email || 'your account') }));
      const pw = el('input', { type: 'password', placeholder: 'Your NoteWell password' });
      box.appendChild(pw);
      const go = async () => {
        if (!pw.value) return NW.toast('Enter your password');
        try {
          await NW.Account.unlock(pw.value);
          UI.close();
          const r = await NW.Sync.now();
          if (r && r.error) NW.toast(r.error);
        } catch (e) { NW.toast(e.message || 'That did not work'); }
      };
      pw.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      const a = el('div', { class: 'actions' });
      a.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      a.appendChild(el('button', { class: 'btn primary', text: 'Unlock', onclick: go }));
      box.appendChild(a);
      setTimeout(() => pw.focus(), 40);
    });
  };

  /* ══════════════ file backup ══════════════ */
  UI.saveToFiles = async function () {
    try {
      const r = await NW.Backup.saveToFiles();
      if (r.cancelled) return;
      NW.toast(r.via === 'share'
        ? 'Choose “Save to Files” to keep it on your iPad'
        : 'Backup saved — ' + NW.bytes(r.size));
    } catch (e) { NW.toast(e.message || 'Could not save the backup'); }
  };

  UI.importPDFs = async function (files) {
    const pr = UI.progress('Importing PDF');
    try {
      for (const f of files) {
        pr.set(0, 'Preparing ' + f.name);
        const nb = await NW.PDFIn.importFile(f, {
          folderId: UI.folderId,
          onStatus: s => pr.set(0.05, s),
          onProgress: (i, n) => pr.set(i / n, 'Page ' + i + ' of ' + n)
        });
        NW.toast('Imported ' + nb.name);
      }
      UI.renderLibrary();
    } catch (e) {
      pr.done();
      UI.modal(box => {
        box.appendChild(el('h2', { text: 'Could not import that PDF' }));
        box.appendChild(el('p', { class: 'note', text: e.message || String(e) }));
        const a = el('div', { class: 'actions' });
        a.appendChild(el('button', { class: 'btn primary', text: 'OK', onclick: UI.close }));
        box.appendChild(a);
      });
      return;
    }
    pr.done();
  };

  /* ══════════════ backup / restore ══════════════ */
  UI.backupDialog = function () {
    const B = NW.Backup;
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'Backup to a file' }));
      box.appendChild(el('p', { class: 'note',
        text: 'A .nwbak file holds every notebook, page and image. This is the copy that does not depend on a browser, an account or a web address — worth having one.' }));

      box.appendChild(el('div', { class: 'kv', html: '<span>Last backup</span><b>' + B.summary() + '</b>' }));
      if (B.isStale()) box.appendChild(el('p', { class: 'note', style: 'color:var(--danger)',
        text: 'It has been over a week. Worth doing one now.' }));

      /* the automatic option, where the platform allows it */
      box.appendChild(el('label', { text: 'Backup folder' }));
      if (B.supportsFolder()) {
        const state = el('div', { class: 'kv', html: '<span>Folder</span><b>' + (B.cfg.folderName || 'not chosen') + '</b>' });
        box.appendChild(state);
        box.appendChild(el('p', { class: 'note',
          html: 'Pick a folder once and NoteWell writes into it by itself, about every half hour. <b>Choose your iCloud Drive or Google Drive folder</b> and the backup reaches your iPad on its own — that is as close to automatic file backup as a browser is allowed to get.' }));
        const row = el('div', { class: 'row' });
        row.appendChild(el('button', {
          class: 'btn', text: B.cfg.folderName ? 'Choose a different folder…' : 'Choose a folder…',
          onclick: async () => {
            try { const n = await B.chooseFolder(); NW.toast('Backing up to ' + n); UI.close(); UI.backupDialog(); }
            catch (e) { if (e && e.name !== 'AbortError') NW.toast(e.message || 'Could not use that folder'); }
          }
        }));
        if (B.cfg.folderName) {
          row.appendChild(el('button', {
            class: 'btn', text: 'Back up now', onclick: async () => {
              try {
                const r = await B.writeToFolder({ interactive: true });
                NW.toast(r.ok ? 'Written to ' + r.where : 'Could not write — reconnect the folder');
                UI.close(); UI.backupDialog();
              } catch (e) { NW.toast(e.message); }
            }
          }));
          row.appendChild(el('button', { class: 'btn danger', text: 'Stop', onclick: async () => { await B.forgetFolder(); UI.close(); UI.backupDialog(); } }));
        }
        box.appendChild(row);
      } else {
        box.appendChild(el('p', { class: 'note',
          html: 'On an iPad, Safari will not let a page write files on its own — that is a deliberate iOS rule, not a NoteWell limitation. Use <b>Save to Files</b> below; it takes one tap and you choose where it goes.' }));
      }

      const a = el('div', { class: 'actions' });
      a.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      a.appendChild(el('button', {
        class: 'btn', text: 'Restore from file…', onclick: async () => {
          const f = await NW.pickFile('.nwbak,application/json');
          if (!f) return;
          try {
            const data = await NW.Backup.restoreFromFile(f);
            const replace = await UI.confirm('Restore backup',
              'Merge this into what is already here, or replace everything? Merging keeps whichever copy of each notebook was edited most recently.',
              'Replace everything');
            if (replace) await NW.Lib.importAll(data, { replace: true, overwrite: true });
            else await NW.Lib.merge(data);
            UI.close(); UI.renderLibrary();
            NW.toast('Restored ' + (data.notebooks || []).length + ' notebooks');
          } catch (e) { NW.toast(e.message || 'That file could not be read'); }
        }
      }));
      a.appendChild(el('button', {
        class: 'btn primary', text: NW.Install.env().iOS ? 'Save to Files' : 'Download backup',
        onclick: async () => { UI.close(); await UI.saveToFiles(); }
      }));
      box.appendChild(a);
    });
  };

  /* ══════════════ account ══════════════ */
  UI.accountDialog = function () {
    const A = NW.Account;
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'Account & sync' }));
      box.appendChild(el('p', { class: 'note', html: 'Your notebooks are encrypted on this device before they are uploaded — the server only ever holds an unreadable blob. Sign in on another iPad or laptop and pull them down.<br><span class="pill">Run <code>npm start</code> in the <code>server/</code> folder to host your own.</span>' }));

      if (A.signedIn) {
        const S = NW.Sync;
        const info = el('div');
        info.appendChild(el('div', { class: 'kv', html: '<span>Signed in as</span><b>' + NW.esc(A.state.email) + '</b>' }));
        info.appendChild(el('div', { class: 'kv', html: '<span>Server</span><b>' + NW.esc(A.state.server) + '</b>' }));
        info.appendChild(el('div', { class: 'kv', html: '<span>Status</span><b>' + NW.esc(S.label()) + '</b>' }));
        info.appendChild(el('div', { class: 'kv', html: '<span>Unlocked on this device</span><b>' + (A.unlocked ? 'yes' : 'no — password needed') + '</b>' }));
        box.appendChild(info);

        box.appendChild(el('label', { text: 'Saving as you go' }));
        const autoL = el('label', { class: 'chk', style: 'display:flex;margin:6px 0' });
        const autoC = el('input', { type: 'checkbox' }); autoC.checked = S.auto;
        autoC.onchange = () => { S.auto = autoC.checked; };
        autoL.append(autoC, document.createTextNode(' Save to my account automatically'));
        box.appendChild(autoL);
        box.appendChild(el('p', { class: 'note', style: 'margin-top:6px',
          text: 'NoteWell saves when you open a notebook, about twenty seconds after you stop writing, and when you close it. With no connection it simply waits — your work is on this device either way, and it uploads itself when you are back online.' }));

        const a = el('div', { class: 'actions' });
        a.appendChild(el('button', { class: 'btn danger', text: 'Sign out', onclick: async () => { await A.signOut(); UI.close(); } }));
        a.appendChild(el('button', { class: 'btn', text: 'Close', onclick: UI.close }));
        if (!A.unlocked) a.appendChild(el('button', { class: 'btn', text: 'Unlock…', onclick: () => { UI.close(); UI.unlockDialog(); } }));
        a.appendChild(el('button', {
          class: 'btn', text: 'Pull from account', onclick: async () => {
            if (!A.unlocked) { UI.close(); return UI.unlockDialog(); }
            const pr = UI.progress('Pulling your library');
            try { const r = await A.pull(); pr.done(); UI.renderLibrary(); NW.toast(r.empty ? 'Nothing stored yet' : 'Pulled ' + r.notebooks + ' notebooks'); }
            catch (e) { pr.done(); NW.toast(e.message); }
          }
        }));
        a.appendChild(el('button', {
          class: 'btn primary', text: 'Save now', onclick: async () => {
            UI.close();
            await NW.Sync.now();
          }
        }));
        box.appendChild(a);
        return;
      }

      box.appendChild(el('label', { text: 'Sync server' }));
      const srv = el('input', { type: 'url', value: A.state.server || 'http://localhost:8787', placeholder: 'https://your-notewell-server' });
      box.appendChild(srv);
      box.appendChild(el('label', { text: 'Email' }));
      const em = el('input', { type: 'email', value: A.state.email || '', placeholder: 'you@university.edu' });
      box.appendChild(em);
      box.appendChild(el('label', { text: 'Password' }));
      const pw = el('input', { type: 'password', placeholder: 'At least 8 characters' });
      box.appendChild(pw);

      const a = el('div', { class: 'actions' });
      a.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      a.appendChild(el('button', {
        class: 'btn', text: 'Create account', onclick: async () => {
          if (pw.value.length < 8) return NW.toast('Use at least 8 characters');
          try { await A.signUp(srv.value.trim(), em.value.trim(), pw.value); NW.toast('Account created'); UI.close(); UI.accountDialog(); }
          catch (e) { NW.toast(e.message); }
        }
      }));
      a.appendChild(el('button', {
        class: 'btn primary', text: 'Sign in', onclick: async () => {
          try {
            await A.signIn(srv.value.trim(), em.value.trim(), pw.value);
            const r = await A.pull(pw.value, false);
            UI.close(); UI.renderLibrary();
            NW.toast(r.empty ? 'Signed in' : 'Signed in — pulled ' + r.notebooks + ' notebooks');
          } catch (e) { NW.toast(e.message); }
        }
      }));
      box.appendChild(a);
    });
  };

  /* ══════════════ settings ══════════════ */
  UI.settingsDialog = function () {
    const S = T.settings, A = NW.AI;
    UI.modal(box => {
      box.appendChild(el('h2', { text: 'Settings' }));

      /* ── appearance ── */
      box.appendChild(el('label', { text: 'Appearance' }));
      const themeSeg = el('div', { class: 'theme-seg' });
      [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device']].forEach(([v, t]) =>
        themeSeg.appendChild(el('button', {
          class: NW.Theme.mode === v ? 'on' : '', text: t,
          onclick: e => { NW.Theme.set(v); themeSeg.querySelectorAll('button').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); }
        })));
      box.appendChild(themeSeg);

      box.appendChild(el('hr'));

      /* ── Claude ── */
      box.appendChild(el('label', { text: 'Claude assistant' }));
      const wraps = {};
      const modeRow = el('div', { style: 'display:grid;gap:8px' });
      const blurb = el('p', { class: 'note', style: 'margin:10px 0 0' });
      const showFor = m => {
        for (const k in wraps) wraps[k].hidden = k !== m;
        const info = A.MODES.find(x => x.id === m);
        blurb.textContent = info ? info.blurb : '';
      };
      A.MODES.filter(m => !m.hidden).forEach(m => {
        const b = el('button', {
          class: 'chip', style: 'text-align:left;border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:baseline;justify-content:space-between',
          onclick: e => {
            A.cfg.mode = m.id;
            modeRow.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
            e.currentTarget.classList.add('on');
            showFor(m.id);
          }
        });
        if (A.cfg.mode === m.id) b.classList.add('on');
        b.append(el('span', { text: m.name }), el('span', { style: 'font-size:12px;opacity:.7', text: m.cost }));
        modeRow.appendChild(b);
      });
      box.appendChild(modeRow);
      box.appendChild(blurb);

      /* handoff — nothing to configure */
      wraps.handoff = el('div');
      wraps.handoff.appendChild(el('p', { class: 'note', style: 'margin-top:14px',
        html: 'Nothing to set up. Ask a question and NoteWell copies your page and the question to the clipboard, then opens <b>claude.ai</b> so you can paste them in. Paste the answer back and it drops into your notes.' }));
      box.appendChild(wraps.handoff);

      /* local model */
      wraps.local = el('div');
      wraps.local.appendChild(el('label', { text: 'Server address' }));
      const lurl = el('input', { type: 'url', value: A.cfg.localUrl || 'http://localhost:11434/v1' });
      wraps.local.appendChild(lurl);
      wraps.local.appendChild(el('label', { text: 'Model name' }));
      const lmodel = el('input', { type: 'text', value: A.cfg.localModel || 'llama3.2-vision', placeholder: 'llama3.2-vision' });
      wraps.local.appendChild(lmodel);
      wraps.local.appendChild(el('p', { class: 'note',
        html: 'Works with Ollama (<code>http://localhost:11434/v1</code>), LM Studio (<code>:1234/v1</code>), Jan or llama.cpp. Pick a model that can see images — <code>llama3.2-vision</code>, <code>qwen2.5vl</code> or <code>gemma3</code> — or Claude will only get your typed question. From an iPad, use the computer’s address on your network rather than localhost.' }));
      box.appendChild(wraps.local);

      /* own API key */
      wraps.direct = el('div');
      wraps.direct.appendChild(el('label', { text: 'Anthropic API key (stored only on this device)' }));
      const key = el('input', { type: 'password', value: A.cfg.key || '', placeholder: 'sk-ant-…' });
      wraps.direct.appendChild(key);
      wraps.direct.appendChild(el('p', { class: 'note',
        html: 'Make one at <b>console.anthropic.com</b>. There is no free tier, but a new account comes with about $5 of credit and a page-plus-answer on Haiku costs roughly half a cent — so that is on the order of a thousand questions before you pay anything. The key never leaves this device except in requests to Anthropic.' }));
      box.appendChild(wraps.direct);

      /* server proxy */
      wraps.proxy = el('div');
      wraps.proxy.appendChild(el('label', { text: 'NoteWell server URL' }));
      const prox = el('input', { type: 'url', value: A.cfg.proxy || 'http://localhost:8787', placeholder: 'http://localhost:8787' });
      wraps.proxy.appendChild(prox);
      wraps.proxy.appendChild(el('p', { class: 'note', text: 'Start the server with ANTHROPIC_API_KEY set and it answers on the tablet’s behalf, so no key is stored on the tablet itself.' }));
      box.appendChild(wraps.proxy);

      showFor(A.cfg.mode);

      box.appendChild(el('label', { text: 'Claude model (for the two paid routes)' }));
      const msel = el('select');
      A.MODELS.forEach(m => { const o = el('option', { value: m.id, text: m.name + ' — ' + m.hint }); if (m.id === A.cfg.model) o.selected = true; msel.appendChild(o); });
      box.appendChild(msel);

      box.appendChild(el('hr'));
      box.appendChild(el('label', { text: 'Apple Pencil' }));
      const dtl = el('label', { class: 'chk' });
      const dtc = el('input', { type: 'checkbox' }); dtc.checked = S.pencilDoubleTap;
      dtl.append(dtc, document.createTextNode(' Double-tap the Pencil to switch tools'));
      box.appendChild(dtl);
      const actRow = el('div', { class: 'paper-row' });
      [['eraser', 'Pen ⇄ Eraser'], ['lasso', 'Pen ⇄ Lasso'], ['lastTwo', 'Last two tools']].forEach(([v, t]) =>
        actRow.appendChild(el('button', {
          class: 'chip' + (S.doubleTapAction === v ? ' on' : ''), text: t,
          onclick: e => { S.doubleTapAction = v; actRow.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); }
        })));
      box.appendChild(actRow);
      box.appendChild(el('p', { class: 'note', html: 'In the native tablet build this listens to the real hardware gesture and is always on. The checkbox above is only the <b>browser fallback</b>, which watches for two quick taps of the pen tip — off by default, because two quick taps is also how you write a colon.' }));

      box.appendChild(el('label', { text: 'Writing' }));
      const opts = [
        ['scribbleWhileWriting', 'Scribble over ink with the pen to erase it'],
        ['holdToSnap', 'Hold still at the end of a stroke to snap it to a shape'],
        ['pullToAddPage', 'Keep pulling past the last page to add one'],
        ['fingerDraws', 'Finger draws — turn this on only if you have no stylus']
      ];
      const boxes = {};
      opts.forEach(([k, t]) => {
        const l = el('label', { class: 'chk', style: 'display:flex;margin:6px 0' });
        const c = el('input', { type: 'checkbox' }); c.checked = S[k]; boxes[k] = c;
        l.append(c, document.createTextNode(' ' + t));
        box.appendChild(l);
      });
      box.appendChild(el('p', { class: 'note', style: 'margin-top:8px',
        text: 'A stylus always draws and fingers always scroll, so you can rest your hand on the screen. Turning “finger draws” on lets a fingertip write instead — it stands itself down again as soon as a stylus touches the screen.' }));
      box.appendChild(el('p', { class: 'note', style: 'margin-top:6px',
        text: 'The first two are off to begin with on purpose: both reinterpret ink you have just drawn, and normal handwriting — i-dots, commas, a paused pen at the end of a letter — can look enough like the gesture to trigger them. Turn them on if you want them; they are useful once you know they are there.' }));

      box.appendChild(el('hr'));
      box.appendChild(el('label', { text: 'This device' }));
      const dev = el('div');
      dev.appendChild(el('div', { class: 'kv', html: '<span>Version</span><b>' + NW.esc(NW.Updates.describe()) + '</b>' }));
      NW.Store.estimate().then(est => {
        if (est) dev.appendChild(el('div', { class: 'kv', html: '<span>Storage used</span><b>' + NW.bytes(est.usage || 0) + ' of ' + NW.bytes(est.quota || 0) + '</b>' }));
      });
      dev.appendChild(el('div', { class: 'kv', html: '<span>Install</span><b>' + (NW.Install.env().standalone ? 'Installed' : 'Running in a browser tab') + '</b>' }));
      dev.appendChild(el('div', { class: 'kv', html: '<span>File backup</span><b>' + NW.esc(NW.Backup.summary()) + '</b>' }));
      box.appendChild(dev);

      const upRow = el('div', { class: 'row', style: 'margin-top:12px' });
      const upBtn = el('button', {
        class: 'btn', text: 'Check for updates', onclick: async () => {
          upBtn.textContent = 'Checking…'; upBtn.disabled = true;
          await NW.Updates.check({ manual: true });
          upBtn.textContent = 'Check for updates'; upBtn.disabled = false;
        }
      });
      upRow.appendChild(upBtn);
      upRow.appendChild(el('button', { class: 'btn', text: 'Backup to a file…', onclick: () => { UI.close(); UI.backupDialog(); } }));
      box.appendChild(upRow);
      box.appendChild(el('p', { class: 'note', style: 'margin-top:8px',
        text: 'NoteWell looks for a new version by itself and offers it in a small bar at the bottom. Updating never touches your notes — they live in this device\'s database, not in the app files.' }));

      const a = el('div', { class: 'actions' });
      a.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: UI.close }));
      a.appendChild(el('button', {
        class: 'btn primary', text: 'Save', onclick: async () => {
          A.cfg.key = key.value.trim(); A.cfg.proxy = prox.value.trim(); A.cfg.model = msel.value;
          A.cfg.localUrl = lurl.value.trim(); A.cfg.localModel = lmodel.value.trim();
          await A.save();
          S.pencilDoubleTap = dtc.checked;
          for (const k in boxes) S[k] = boxes[k].checked;
          T.saveOpts();
          UI.close(); NW.toast('Saved');
        }
      }));
      box.appendChild(a);
    });
  };

  /* ══════════════ Claude panel ══════════════ */
  UI.toggleAI = function (force) {
    const p = $('#aiPanel');
    const show = force === undefined ? p.hidden : force;
    p.hidden = !show;
    if (show && !$('#chat').children.length) {
      const m = NW.AI.cfg.mode;
      pushMsg('sys',
        m === 'handoff' ? 'Ask a question and I will package this page for your claude.ai tab — no key, no billing. Change that in Settings if you would rather answers appeared here automatically.'
          : m === 'local' ? 'Pointed at your own model server. Ask anything about this page.'
            : NW.AI.configured() ? 'Ask me anything about this page — I can see it.'
              : 'Add your Anthropic API key in Settings, or switch to the free claude.ai route.');
    }
    const eng = $('#aiEngine');
    if (eng) eng.textContent = NW.AI.cfg.mode === 'handoff' ? '' : NW.AI.engineName();
    if (show) setTimeout(() => $('#aiInput').focus(), 60);
  };

  function pushMsg(role, text, shot) {
    const chat = $('#chat');
    const d = el('div', { class: 'msg ' + role });
    if (shot) d.appendChild(el('img', { class: 'shot', src: shot }));
    if (role === 'ai') d.insertAdjacentHTML('beforeend', NW.md(text));
    else d.appendChild(el('div', { text }));
    if (role === 'ai') {
      const bar = el('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' });
      bar.appendChild(el('button', { class: 'chip', text: 'Add to page', onclick: () => NW.AI.insertAnswer(text) }));
      bar.appendChild(el('button', { class: 'chip', text: 'Copy', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(text); NW.toast('Copied'); } }));
      d.appendChild(bar);
    }
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
    return d;
  }

  /** the free route: hand the page to a claude.ai tab, paste the answer back */
  function handoffCard(h) {
    const chat = $('#chat');
    const card = el('div', { class: 'msg sys', style: 'font-style:normal' });
    card.appendChild(el('div', { text: 'Take this to Claude — three taps, no account key needed.' }));

    const steps = el('div', { class: 'ai-steps' });
    const step = (n, label, ...btns) => {
      const row = el('div', { class: 'step' });
      row.appendChild(el('span', { class: 'num', text: n }));
      const body = el('div', { style: 'flex:1' });
      body.appendChild(el('div', { text: label }));
      if (btns.length) {
        const bar = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:5px' });
        btns.forEach(b => bar.appendChild(b));
        body.appendChild(bar);
      }
      row.appendChild(body);
      return row;
    };

    const bCopyQ = el('button', {
      class: 'chip', text: 'Copy question', onclick: async () => {
        try { await NW.AI.copyText(h.prompt); NW.toast('Question copied'); bCopyQ.textContent = 'Copied ✓'; }
        catch (e) { NW.toast(e.message); }
      }
    });
    const bCopyI = el('button', {
      class: 'chip', text: 'Copy page image', onclick: async () => {
        try { await NW.AI.copyImage(h.image); NW.toast('Page image copied'); bCopyI.textContent = 'Copied ✓'; }
        catch (e) { NW.toast(e.message); }
      }
    });
    const bSaveI = el('button', {
      class: 'chip', text: 'Save image', onclick: () => { NW.AI.saveImage(h.image, 'notewell-page'); }
    });
    const bOpen = el('button', { class: 'chip', text: 'Open claude.ai ↗', onclick: () => NW.AI.openClaude() });

    steps.appendChild(step('1', 'Copy the question, and the page as an image.', bCopyQ, bCopyI, bSaveI));
    steps.appendChild(step('2', 'Open Claude, paste the question, then attach or paste the image.', bOpen));
    steps.appendChild(step('3', 'Paste Claude’s answer back in here.'));
    card.appendChild(steps);

    const ta = el('textarea', { class: 'pastebox', placeholder: 'Paste Claude’s answer here…' });
    card.appendChild(ta);
    const acts = el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' });
    acts.appendChild(el('button', {
      class: 'chip', text: 'Keep answer', onclick: () => {
        const t = ta.value.trim();
        if (!t) return NW.toast('Nothing pasted yet');
        NW.AI.acceptReply(t);
        card.remove();
      }
    }));
    acts.appendChild(el('button', {
      class: 'chip', text: 'Straight onto the page', onclick: () => {
        const t = ta.value.trim();
        if (!t) return NW.toast('Nothing pasted yet');
        NW.AI.acceptReply(t); NW.AI.insertAnswer(t); card.remove();
      }
    }));
    acts.appendChild(el('button', { class: 'chip', text: 'Dismiss', onclick: () => card.remove() }));
    card.appendChild(acts);

    chat.appendChild(card);
    chat.scrollTop = chat.scrollHeight;
    setTimeout(() => { try { bCopyQ.click(); } catch (e) { } }, 0);
  }

  UI.initAI = function () {
    const input = $('#aiInput');
    const send = () => {
      const t = input.value.trim(); if (!t) return;
      input.value = ''; input.style.height = 'auto';
      NW.AI.ask(t, { look: $('#aiMode').value });
    };
    $('#aiSend').onclick = send;
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
    NW.$$('.quick button').forEach(b => b.addEventListener('click', () => { NW.AI.ask(b.dataset.q, { look: $('#aiMode').value }); }));

    let streamEl = null;
    NW.on('ai:message', m => pushMsg(m.role, m.text, m.shot));
    NW.on('ai:handoff', h => handoffCard(h));
    NW.on('ai:stream:start', () => {
      streamEl = el('div', { class: 'msg ai' });
      streamEl.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
      $('#chat').appendChild(streamEl); $('#chat').scrollTop = 1e9;
    });
    NW.on('ai:stream', d => {
      if (!streamEl) return;
      streamEl.innerHTML = NW.md(d.text);
      $('#chat').scrollTop = 1e9;
    });
    NW.on('ai:stream:end', d => {
      if (streamEl) streamEl.remove(); streamEl = null;
      if (d && d.text) pushMsg('ai', d.text);
    });
    NW.on('ai:cleared', () => { $('#chat').innerHTML = ''; });
    NW.on('ai:needsSetup', () => { UI.settingsDialog(); NW.toast('Add your Anthropic API key to use Claude'); });
    NW.on('ai:busy', b => { $('#aiSend').disabled = b; $('#aiSend').style.opacity = b ? .5 : 1; });
  };

})(window.NW);
