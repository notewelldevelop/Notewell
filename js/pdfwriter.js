/* ═══════════════ NoteWell — pdfwriter.js ═══════════════
   A small, dependency-free PDF writer.

   Why write our own: NoteWell has to work with the network unplugged, so we
   can't lean on a CDN library. This produces real PDF 1.4 files — one image
   XObject per page (lossless Flate, or DCT/JPEG when you want a smaller file),
   an optional invisible text layer so typed notes stay searchable and
   copy-pasteable, and bookmarks when several notebooks are merged into one
   document. */
(function (NW) {
  'use strict';

  const P = NW.PDF = {};
  const te = new TextEncoder();

  function bytes(str) { return te.encode(str); }
  function concat(chunks) {
    let n = 0; for (const c of chunks) n += c.length;
    const out = new Uint8Array(n); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /* zlib-wrapped deflate via CompressionStream, with a stored-block fallback */
  async function deflate(u8) {
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('deflate');
        const stream = new Blob([u8]).stream().pipeThrough(cs);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* fall through */ }
    }
    return storedZlib(u8);
  }
  /** valid zlib stream using uncompressed deflate blocks (always works) */
  function storedZlib(u8) {
    const chunks = [new Uint8Array([0x78, 0x01])];
    const MAX = 65535;
    for (let i = 0; i < u8.length || i === 0; i += MAX) {
      const part = u8.subarray(i, Math.min(i + MAX, u8.length));
      const last = (i + MAX >= u8.length) ? 1 : 0;
      const len = part.length, nlen = ~len & 0xffff;
      chunks.push(new Uint8Array([last, len & 255, len >> 8, nlen & 255, nlen >> 8]));
      chunks.push(part);
      if (last) break;
    }
    // adler32
    let a = 1, b = 0;
    for (let i = 0; i < u8.length; i++) { a = (a + u8[i]) % 65521; b = (b + a) % 65521; }
    chunks.push(new Uint8Array([(b >> 8) & 255, b & 255, (a >> 8) & 255, a & 255]));
    return concat(chunks);
  }

  function pdfStr(s) {
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (c < 32) out += ' ';
      else if (c > 255) out += '?';
      else out += ch;
    }
    return out;
  }

  /* ── document builder ─────────────────────────── */
  function Doc(title) {
    this.objs = [null];            // 1-based
    this.title = title || 'NoteWell';
  }
  Doc.prototype.alloc = function () { this.objs.push(null); return this.objs.length - 1; };
  Doc.prototype.set = function (id, chunks) { this.objs[id] = Array.isArray(chunks) ? chunks : [chunks]; };
  Doc.prototype.obj = function (chunks) { const id = this.alloc(); this.set(id, chunks); return id; };

  Doc.prototype.build = function (rootId, infoId) {
    const head = bytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const parts = [head];
    let off = head.length;
    const offsets = new Array(this.objs.length).fill(0);
    for (let i = 1; i < this.objs.length; i++) {
      offsets[i] = off;
      const pre = bytes(i + ' 0 obj\n');
      parts.push(pre); off += pre.length;
      for (const c of (this.objs[i] || [bytes('null')])) { parts.push(c); off += c.length; }
      const post = bytes('\nendobj\n');
      parts.push(post); off += post.length;
    }
    const xrefAt = off;
    let x = 'xref\n0 ' + this.objs.length + '\n0000000000 65535 f \n';
    for (let i = 1; i < this.objs.length; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    x += 'trailer\n<< /Size ' + this.objs.length + ' /Root ' + rootId + ' 0 R' +
      (infoId ? ' /Info ' + infoId + ' 0 R' : '') + ' >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
    parts.push(bytes(x));
    return new Blob(parts, { type: 'application/pdf' });
  };

  /* ── image encoding ───────────────────────────── */

  /** canvas → {filter, data, w, h, alphaMask?} */
  async function encodeImage(canvas, quality) {
    const w = canvas.width, h = canvas.height;
    if (quality === 'small' || quality === 'balanced') {
      const q = quality === 'small' ? 0.72 : 0.93;
      const durl = canvas.toDataURL('image/jpeg', q);
      return { filter: '/DCTDecode', data: NW.dataURLToBytes(durl), w, h, cs: '/DeviceRGB' };
    }
    // lossless
    const id = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < id.length; i += 4, j += 3) {
      const a = id[i + 3] / 255;
      // composite onto white — PDF page images are opaque
      rgb[j] = Math.round(id[i] * a + 255 * (1 - a));
      rgb[j + 1] = Math.round(id[i + 1] * a + 255 * (1 - a));
      rgb[j + 2] = Math.round(id[i + 2] * a + 255 * (1 - a));
    }
    return { filter: '/FlateDecode', data: await deflate(rgb), w, h, cs: '/DeviceRGB' };
  }

  /* ── public API ───────────────────────────────── */

  /**
   * Build a PDF.
   * @param {Array} pages  [{canvas, widthPt, heightPt, texts?:[{x,y,size,text,font}] , bookmark?:string}]
   * @param {Object} opt   {title, quality:'lossless'|'balanced'|'small', onProgress}
   * @returns {Promise<Blob>}
   */
  P.create = async function (pages, opt) {
    opt = opt || {};
    const doc = new Doc(opt.title);
    const quality = opt.quality || 'balanced';

    const pagesId = doc.alloc();
    const fontId = doc.obj(bytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    const kids = [];
    const outlineTargets = [];

    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      if (opt.onProgress) opt.onProgress(i, pages.length);
      const img = await encodeImage(pg.canvas, quality);

      const imgId = doc.obj([
        bytes('<< /Type /XObject /Subtype /Image /Width ' + img.w + ' /Height ' + img.h +
          ' /ColorSpace ' + img.cs + ' /BitsPerComponent 8 /Filter ' + img.filter +
          ' /Length ' + img.data.length + ' >>\nstream\n'),
        img.data,
        bytes('\nendstream')
      ]);

      const W = pg.widthPt, H = pg.heightPt;
      let content = 'q\n' + W.toFixed(2) + ' 0 0 ' + H.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';

      /* invisible text layer: typed notes stay searchable in the PDF */
      if (pg.texts && pg.texts.length) {
        content += 'BT\n3 Tr\n';
        for (const t of pg.texts) {
          const sz = Math.max(1, t.size);
          const y = H - t.y;
          content += '/F1 ' + sz.toFixed(2) + ' Tf\n1 0 0 1 ' + t.x.toFixed(2) + ' ' + y.toFixed(2) + ' Tm\n(' + pdfStr(t.text) + ') Tj\n';
        }
        content += 'ET\n';
      }

      const cdata = bytes(content);
      const contId = doc.obj([bytes('<< /Length ' + cdata.length + ' >>\nstream\n'), cdata, bytes('\nendstream')]);

      const pageId = doc.obj(bytes(
        '<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + W.toFixed(2) + ' ' + H.toFixed(2) + ']' +
        ' /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> /Font << /F1 ' + fontId + ' 0 R >> >>' +
        ' /Contents ' + contId + ' 0 R >>'));
      kids.push(pageId + ' 0 R');
      if (pg.bookmark) outlineTargets.push({ title: pg.bookmark, page: pageId });
    }

    doc.set(pagesId, bytes('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>'));

    /* bookmarks (used when a whole folder is merged into one PDF) */
    let outlinesId = 0;
    if (outlineTargets.length > 1) {
      outlinesId = doc.alloc();
      const itemIds = outlineTargets.map(() => doc.alloc());
      outlineTargets.forEach((t, i) => {
        const prev = i > 0 ? ' /Prev ' + itemIds[i - 1] + ' 0 R' : '';
        const next = i < itemIds.length - 1 ? ' /Next ' + itemIds[i + 1] + ' 0 R' : '';
        doc.set(itemIds[i], bytes('<< /Title (' + pdfStr(t.title) + ') /Parent ' + outlinesId + ' 0 R' + prev + next +
          ' /Dest [' + t.page + ' 0 R /Fit] >>'));
      });
      doc.set(outlinesId, bytes('<< /Type /Outlines /First ' + itemIds[0] + ' 0 R /Last ' +
        itemIds[itemIds.length - 1] + ' 0 R /Count ' + itemIds.length + ' >>'));
    }

    const rootId = doc.obj(bytes('<< /Type /Catalog /Pages ' + pagesId + ' 0 R' +
      (outlinesId ? ' /Outlines ' + outlinesId + ' 0 R /PageMode /UseOutlines' : '') + ' >>'));
    const infoId = doc.obj(bytes('<< /Title (' + pdfStr(opt.title || 'NoteWell') + ') /Producer (NoteWell) /Creator (NoteWell) >>'));

    return doc.build(rootId, infoId);
  };

})(window.NW);
