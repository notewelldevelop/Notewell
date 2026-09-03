/* ═══════════════ NoteWell — app.js ═══════════════
   Boot, keyboard shortcuts, drag-and-drop, install prompt, first run. */
(function (NW) {
  'use strict';
  const E = NW.Engine, T = NW.Tools, UI = NW.UI, $ = NW.$;

  async function boot() {
    NW.Theme.init();
    await NW.Store.ready();
    NW.Store.persist();
    await NW.Account.init();
    await NW.AI.load();
    await NW.Lib.load();

    await NW.Backup.load();

    E.init($('#stage'), $('#paper'), $('#live'));
    T.init();
    UI.initToolbar();
    UI.initLibrary();
    UI.initAI();
    UI.initSync();
    NW.emit('tool:changed');
    NW.emit('history');

    if (!NW.Lib.notebooks.length) await firstRun();
    UI.showLibrary();

    initKeys();
    initDrop();
    NW.Install.init();
    NW.Sync.init();
    NW.Backup.init();
    NW.Updates.init();
    registerSW();

    console.log('%cNoteWell', 'font:600 15px system-ui;color:#6c8cff', 'ready · ' + NW.Lib.notebooks.length + ' notebooks');
  }

  /* ── a starter notebook so the app is never an empty room ── */
  async function firstRun() {
    const nb = await NW.Lib.newNotebook({ name: 'Welcome to NoteWell', template: 'lined', paperColor: 'cream' });
    const page = await NW.Lib.page(nb.pageIds[0]);
    const F = NW.FONTS.find(f => f.name === 'Garamond') || NW.FONTS[0];
    const mk = (y, size, text, bold, color) => ({
      id: NW.uid('i_'), type: 'text', x: 110, y, w: page.w - 220, h: size * 1.5,
      text, font: F.css, fontName: F.name, size, color: color || '#1a1d23',
      bold: !!bold, italic: false, underline: false, align: 'left', lineHeight: 1.4
    });
    const m = document.createElement('canvas').getContext('2d');
    const items = [
      mk(150, 58, 'NoteWell', true),
      mk(232, 26, 'Everything here works with the wifi off.', false, '#5d5c55'),
      mk(330, 26,
        '• Write with a stylus — the line thickens with pressure.\n' +
        '• Highlighter tints the page instead of painting over it.\n' +
        '• Draw a rough circle or box and hold still — it snaps.\n' +
        '• Scribble back and forth over a mistake and it disappears.\n' +
        '• Circle some working with the lasso, then drag it anywhere.\n' +
        '• Double-tap an Apple Pencil to flip between pen and eraser.\n' +
        '• Keep pulling past the bottom of this page to add another.\n' +
        '• Five colours sit on the bar — the ⋯ opens all of them.\n' +
        '• The sun button switches between light and dark.\n' +
        '• Tap Claude, top right, and ask about anything on the page.\n' +
        '  It is set to the free route: it hands the page to your own\n' +
        '  claude.ai tab and you paste the answer back.'),
      mk(page.h - 250, 22, 'Tap the ‹ arrow to get back to your shelf. Make a notebook, make folders, drop a PDF in and write on it.', false, '#5d5c55')
    ];
    items.forEach(it => { it.h = E.textHeight(m, it); });
    items.push({
      id: NW.uid('i_'), type: 'stroke', tool: 'highlighter', color: '#ffe14d', size: 34,
      opacity: 1, straight: true, chisel: true, pressure: false,
      pts: [{ x: 108, y: 245, p: .6 }, { x: 640, y: 245, p: .6 }]
    });
    page.items = items;
    NW.Lib.markPage(page);
    await NW.Lib.flush();
  }

  /* ── keyboard ── */
  function initKeys() {
    const TOOLS = { '1': 'pen', '2': 'highlighter', '3': 'eraser', '4': 'lasso', '5': 'shape', '6': 'fill', '7': 'text', '9': 'hand' };
    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (UI.view === 'editor') UI.toggleAI(); return; }
      if (typing) return;

      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? E.History.stepFwd() : E.History.stepBack(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); E.History.stepFwd(); return; }
      if (UI.view !== 'editor') {
        if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#libSearch').focus(); }
        return;
      }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); UI.exportDialog(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); T.selectAll(); return; }
      if (mod && e.key.toLowerCase() === 'c') { if (E.selection) { T.clipboard = NW.deepClone(E.selection.items); NW.toast('Copied'); } return; }
      if (mod && e.key.toLowerCase() === 'x') { if (E.selection) T.selAction('cut'); return; }
      if (mod && e.key.toLowerCase() === 'v') { T.paste(); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); E.setZoom(E.cam.zoom * 1.25); return; }
      if (mod && e.key === '-') { e.preventDefault(); E.setZoom(E.cam.zoom / 1.25); return; }
      if (mod && e.key === '0') { e.preventDefault(); E.fitWidth(); NW.emit('cam'); return; }
      if (mod) return;

      if (TOOLS[e.key]) { T.setTool(TOOLS[e.key]); return; }
      if (e.key === '8') { $('#btnImage').click(); return; }
      if (e.key === 'e' || e.key === 'E') { T.pencilToggle('key'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (E.selection) { e.preventDefault(); T.selAction('delete'); } return; }
      if (e.key === 'Escape') { T.clearSelection(); NW.Text.commit(); return; }
      if (e.key === 'PageDown' || e.key === 'ArrowDown') { E.cam.y += 160 / E.cam.zoom; E.clampCam(); E.invalidate(); NW.emit('cam'); }
      if (e.key === 'PageUp' || e.key === 'ArrowUp') { E.cam.y -= 160 / E.cam.zoom; E.clampCam(); E.invalidate(); NW.emit('cam'); }
    });

    /* paste an image straight onto the page */
    document.addEventListener('paste', async e => {
      if (UI.view !== 'editor') return;
      if (NW.Text.editing) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          e.preventDefault();
          const f = it.getAsFile(); if (!f) continue;
          await T.insertImage(await NW.readAsDataURL(f));
          return;
        }
      }
    });
  }

  /* ── drag & drop PDFs / images ── */
  function initDrop() {
    const veil = $('#dropVeil');
    let depth = 0;
    addEventListener('dragenter', e => { e.preventDefault(); depth++; veil.hidden = false; });
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('dragleave', e => { depth--; if (depth <= 0) { depth = 0; veil.hidden = true; } });
    addEventListener('drop', async e => {
      e.preventDefault(); depth = 0; veil.hidden = true;
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const pdfs = files.filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
      const imgs = files.filter(f => /^image\//.test(f.type));
      const baks = files.filter(f => /\.nwbak$/i.test(f.name));

      for (const b of baks) {
        try {
          const data = JSON.parse(await b.text());
          await NW.Lib.importAll(data, { overwrite: true });
          NW.toast('Restored ' + (data.notebooks || []).length + ' notebooks');
          UI.renderLibrary();
        } catch (err) { NW.toast('That backup could not be read'); }
      }
      if (pdfs.length) await UI.importPDFs(pdfs);
      if (imgs.length && UI.view === 'editor') for (const f of imgs) await T.insertImage(await NW.readAsDataURL(f));
      else if (imgs.length) NW.toast('Open a notebook first to drop images in');
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') {
      console.info('NoteWell: opened from a file:// path — everything works, but for full offline install run the included start script.');
      return;
    }
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.NW);
