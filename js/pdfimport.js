/* ═══════════════ NoteWell — pdfimport.js ═══════════════
   PDF in  → every page becomes a real NoteWell page you can write on top of.
   PDF out → a notebook, a page range, or a whole folder (zipped, or merged
             into one bookmarked document).

   The PDF *renderer* (pdf.js) is the one piece NoteWell can't hand-roll. It is
   fetched once — from the bundled vendor/ folder if you ran setup, otherwise
   from the CDN the first time you import a PDF — and then cached inside the
   app's own database, so every import after that works with no network. */
(function (NW) {
  'use strict';
  const E = NW.Engine;

  const PDFJS_VER = '3.11.174';
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/';

  const In = NW.PDFIn = { lib: null, status: 'idle' };

  async function tryLocal(url) {
    try { const r = await fetch(url, { cache: 'force-cache' }); if (r.ok) return await r.text(); } catch { }
    return null;
  }

  /** find pdf.js: bundled → cached in IndexedDB → CDN (then cache it) */
  In.ensureEngine = async function (onStatus) {
    if (In.lib) return In.lib;
    const say = m => { In.status = m; if (onStatus) onStatus(m); };

    let main = await tryLocal('vendor/pdf.min.js');
    let worker = main ? await tryLocal('vendor/pdf.worker.min.js') : null;

    if (!main) {
      say('checking offline cache');
      const cached = await NW.Store.get('assets', 'vendor:pdfjs');
      if (cached && cached.main) { main = cached.main; worker = cached.worker; }
    }

    if (!main) {
      if (!navigator.onLine) throw new Error('PDF support needs to be downloaded once while you are online. Connect to the internet and try again — after that it works offline forever.');
      say('downloading the PDF engine (one time only)');
      const [m, w] = await Promise.all([
        fetch(CDN + 'pdf.min.js').then(r => { if (!r.ok) throw new Error('download failed'); return r.text(); }),
        fetch(CDN + 'pdf.worker.min.js').then(r => { if (!r.ok) throw new Error('download failed'); return r.text(); })
      ]);
      main = m; worker = w;
      try { await NW.Store.put('assets', { id: 'vendor:pdfjs', main, worker, ver: PDFJS_VER, at: Date.now() }); } catch { }
    }

    say('starting the PDF engine');
    if (!window.pdfjsLib) {
      const url = URL.createObjectURL(new Blob([main], { type: 'text/javascript' }));
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.onload = res; s.onerror = () => rej(new Error('Could not start the PDF engine.'));
        s.src = url; document.head.appendChild(s);
      });
    }
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('Could not start the PDF engine.');
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
    In.lib = lib; say('ready');
    return lib;
  };

  In.available = async function () {
    if (In.lib) return true;
    if (await NW.Store.get('assets', 'vendor:pdfjs')) return true;
    return navigator.onLine;
  };

  /**
   * Turn a PDF file into an annotatable notebook.
   * @returns {Promise<Object>} the new notebook
   */
  In.importFile = async function (file, opt) {
    opt = opt || {};
    const lib = await In.ensureEngine(opt.onStatus);
    const buf = await NW.readAsArrayBuffer(file);
    const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;

    const nb = {
      id: NW.uid('n_'),
      name: (opt.name || file.name || 'Imported PDF').replace(/\.pdf$/i, ''),
      folderId: opt.folderId || null,
      paper: 'a4', landscape: false, template: 'blank', paperColor: 'white',
      cover: null, pageIds: [], isPDF: true,
      createdAt: Date.now(), updatedAt: Date.now()
    };

    const TARGET = 1240;                       // long-edge target in page units
    const quality = opt.quality === 'high' ? 0.92 : 0.84;
    const pages = [];

    for (let i = 1; i <= doc.numPages; i++) {
      if (opt.onProgress) opt.onProgress(i, doc.numPages);
      const pg = await doc.getPage(i);
      const v1 = pg.getViewport({ scale: 1 });
      const long = Math.max(v1.width, v1.height);
      const scale = TARGET / long;
      const vp = pg.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;

      const page = {
        id: NW.uid('p_'), w: c.width, h: c.height,
        template: 'blank', paper: 'white', bg: '#ffffff', inkColor: '#c9d2e0',
        items: [], rev: 1,
        pdfImage: c.toDataURL('image/jpeg', quality),
        pdfPage: i
      };
      pages.push(page);
      nb.pageIds.push(page.id);
      NW.Lib.pageCache.set(page.id, page);
      await NW.Store.put('pages', page);
      await new Promise(r => setTimeout(r, 0));   // let the UI breathe
    }

    if (file.size && file.size < 26 * 1024 * 1024) {
      nb.pdfDocId = NW.uid('a_');
      try { await NW.Store.put('assets', { id: nb.pdfDocId, name: file.name, bytes: buf }); } catch { }
    }

    NW.Lib.notebooks.unshift(nb);
    await NW.Store.put('notebooks', nb);
    NW.emit('lib:changed');
    return nb;
  };

  /* ═══════════════ EXPORT ═══════════════ */

  const Ex = NW.Export = {};

  const PT_PER_UNIT = 72 / 150;    // page units are ~150 dpi

  /** collect typed text so the exported PDF stays searchable */
  function textLayer(page, sc) {
    const m = document.createElement('canvas').getContext('2d');
    const out = [];
    for (const it of page.items) {
      if (it.type !== 'text' || !it.text) continue;
      const lines = E.wrapText(m, it);
      const lh = it.size * (it.lineHeight || 1.35);
      lines.forEach((ln, i) => {
        if (!ln.trim()) return;
        out.push({
          x: (it.x + 3) * PT_PER_UNIT,
          y: (it.y + it.size + i * lh) * PT_PER_UNIT,
          size: it.size * PT_PER_UNIT,
          text: ln
        });
      });
    }
    return out;
  }

  /**
   * @param {Array} pages  NoteWell pages
   * @param {Object} opt   {title, dpi:150|300|72, quality, bookmarks:[{index,title}], onProgress}
   */
  /* Handwriting is the worst possible case for JPEG: thin dark strokes on
     white, which is exactly the high-contrast edge JPEG smears into grey
     ringing. Exports are lossless unless you deliberately ask for a smaller
     file, and 200 dpi is the point where an A4 page still looks like ink on a
     retina screen. */
  Ex.DEFAULT_DPI = 200;
  Ex.DEFAULT_QUALITY = 'lossless';

  Ex.pagesToPDF = async function (pages, opt) {
    opt = opt || {};
    const scale = (opt.dpi || Ex.DEFAULT_DPI) / 150;
    const bookmarks = opt.bookmarks || [];
    const built = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (opt.onProgress) opt.onProgress(i, pages.length, 'render');
      await E.preloadPage(page);
      const canvas = E.renderPageTo(page, scale);
      const bm = bookmarks.find(b => b.index === i);
      built.push({
        canvas,
        widthPt: page.w * PT_PER_UNIT,
        heightPt: page.h * PT_PER_UNIT,
        texts: textLayer(page, scale),
        bookmark: bm ? bm.title : null
      });
      await new Promise(r => setTimeout(r, 0));
    }
    return NW.PDF.create(built, {
      title: opt.title || 'NoteWell',
      quality: opt.quality || Ex.DEFAULT_QUALITY,
      onProgress: (i, n) => opt.onProgress && opt.onProgress(i, n, 'encode')
    });
  };

  Ex.notebookToPDF = async function (nb, opt) {
    opt = opt || {};
    const pages = [];
    for (const id of nb.pageIds) { const p = await NW.Lib.page(id); if (p) pages.push(p); }
    const chosen = opt.indices ? opt.indices.map(i => pages[i]).filter(Boolean) : pages;
    return Ex.pagesToPDF(chosen, Object.assign({ title: nb.name }, opt));
  };

  /** every notebook in a folder → one .zip, folder tree preserved */
  Ex.folderToZIP = async function (folderId, opt) {
    opt = opt || {};
    const root = folderId ? NW.Lib.folder(folderId) : null;
    const nbs = NW.Lib.descendants(folderId);
    if (!nbs.length) throw new Error('That folder has no notebooks in it yet.');
    const files = [];
    for (let i = 0; i < nbs.length; i++) {
      const nb = nbs[i];
      if (opt.onProgress) opt.onProgress(i, nbs.length, nb.name);
      const blob = await Ex.notebookToPDF(nb, { dpi: opt.dpi, quality: opt.quality });
      const trail = NW.Lib.path(nb.folderId).map(f => NW.ZIP.safeName(f.name));
      const base = root ? trail.slice(NW.Lib.path(root.id).length - 1) : trail;
      const dir = base.length ? base.join('/') + '/' : '';
      files.push({ name: dir + NW.ZIP.safeName(nb.name) + '.pdf', data: blob });
    }
    return NW.ZIP.create(files);
  };

  /** every notebook in a folder → one PDF, each notebook a bookmark */
  Ex.folderToMergedPDF = async function (folderId, opt) {
    opt = opt || {};
    const nbs = NW.Lib.descendants(folderId);
    if (!nbs.length) throw new Error('That folder has no notebooks in it yet.');
    const pages = [], bookmarks = [];
    for (const nb of nbs) {
      bookmarks.push({ index: pages.length, title: nb.name });
      for (const id of nb.pageIds) { const p = await NW.Lib.page(id); if (p) pages.push(p); }
    }
    const root = folderId ? NW.Lib.folder(folderId) : null;
    return Ex.pagesToPDF(pages, Object.assign({ title: root ? root.name : 'NoteWell library', bookmarks }, opt));
  };

  Ex.pageToPNG = async function (page, scale) {
    await E.preloadPage(page);
    const c = E.renderPageTo(page, scale || 2);
    return new Promise(res => c.toBlob(res, 'image/png'));
  };

  Ex.backup = async function (nbIds) {
    const data = await NW.Lib.exportAll(nbIds);
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  };

})(window.NW);
