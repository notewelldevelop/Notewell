/* ═══════════════ NoteWell — zipwriter.js ═══════════════
   Dependency-free ZIP writer, so "export this folder" can hand you one .zip
   containing a PDF per notebook — with the folder tree preserved inside.
   Uses raw deflate when the browser offers CompressionStream, else stores. */
(function (NW) {
  'use strict';

  const Z = NW.ZIP = {};
  const te = new TextEncoder();

  /* CRC-32 */
  const TBL = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = TBL[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function rawDeflate(u8) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { return null; }
  }

  function dosTime(d) {
    return { t: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
             d: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF };
  }

  function le(view, off, val, size) {
    if (size === 2) view.setUint16(off, val, true);
    else view.setUint32(off, val >>> 0, true);
  }

  /**
   * @param {Array<{name:string, data:Uint8Array|Blob|ArrayBuffer}>} files
   * @returns {Promise<Blob>}
   */
  Z.create = async function (files, opt) {
    opt = opt || {};
    const parts = [], central = [];
    let offset = 0;
    const now = dosTime(new Date());

    for (const f of files) {
      let data = f.data;
      if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
      else if (data instanceof ArrayBuffer) data = new Uint8Array(data);
      else if (typeof data === 'string') data = te.encode(data);

      const nameBytes = te.encode(f.name.replace(/^\/+/, ''));
      const crc = crc32(data);
      let method = 0, payload = data;
      if (opt.compress !== false && data.length > 128) {
        const def = await rawDeflate(data);
        if (def && def.length < data.length) { method = 8; payload = def; }
      }

      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      le(lv, 0, 0x04034b50, 4); le(lv, 4, 20, 2); le(lv, 6, 0x0800, 2);  // UTF-8 names
      le(lv, 8, method, 2); le(lv, 10, now.t, 2); le(lv, 12, now.d, 2);
      le(lv, 14, crc, 4); le(lv, 18, payload.length, 4); le(lv, 22, data.length, 4);
      le(lv, 26, nameBytes.length, 2); le(lv, 28, 0, 2);
      lh.set(nameBytes, 30);

      parts.push(lh, payload);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      le(cv, 0, 0x02014b50, 4); le(cv, 4, 20, 2); le(cv, 6, 20, 2); le(cv, 8, 0x0800, 2);
      le(cv, 10, method, 2); le(cv, 12, now.t, 2); le(cv, 14, now.d, 2);
      le(cv, 16, crc, 4); le(cv, 20, payload.length, 4); le(cv, 24, data.length, 4);
      le(cv, 28, nameBytes.length, 2); le(cv, 30, 0, 2); le(cv, 32, 0, 2);
      le(cv, 34, 0, 2); le(cv, 36, 0, 2); le(cv, 38, 0, 4);
      le(cv, 42, offset, 4);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + payload.length;
    }

    let cdSize = 0; for (const c of central) cdSize += c.length;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    le(ev, 0, 0x06054b50, 4); le(ev, 4, 0, 2); le(ev, 6, 0, 2);
    le(ev, 8, files.length, 2); le(ev, 10, files.length, 2);
    le(ev, 12, cdSize, 4); le(ev, 16, offset, 4); le(ev, 20, 0, 2);

    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  };

  Z.safeName = s => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Untitled';

})(window.NW);
