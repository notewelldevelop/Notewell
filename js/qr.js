/* ═══════════════ NoteWell — qr.js ═══════════════
   A small QR encoder, written here rather than pulled from npm so the install
   screen works with the network unplugged.

   Byte mode, versions 1–6, error correction level M — comfortably enough for
   any URL you'd host NoteWell at (up to 106 characters), and stopping at
   version 6 means no version-information blocks to place.

   NW.QR.encode(text)  → { size, get(x, y) }
   NW.QR.svg(text, px) → an <svg> string
   NW.QR.ascii(text)   → block characters, for a terminal
*/
(function (NW) {
  'use strict';
  const QR = NW.QR = {};

  /* ── GF(256), primitive polynomial 0x11D ───────── */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /** generator polynomial for `n` error-correction codewords */
  function rsPoly(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= mul(poly[j], 1);
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsPoly(ecLen);
    const res = new Uint8Array(data.length + ecLen);
    res.set(data, 0);
    for (let i = 0; i < data.length; i++) {
      const factor = res[i];
      if (!factor) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], factor);
    }
    return res.slice(data.length);
  }

  /* ── version tables, level M only ───────────────
     [ total codewords, ec codewords per block, block count ]  */
  const VER = {
    1: [26, 10, 1], 2: [44, 16, 1], 3: [70, 26, 1],
    4: [100, 18, 2], 5: [134, 24, 2], 6: [172, 16, 4]
  };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

  function capacity(v) {
    const [total, ec, blocks] = VER[v];
    const dataCw = total - ec * blocks;
    return dataCw - 2;                       // mode nibble + 8-bit length byte
  }

  /* ── bit stream ─────────────────────────────────── */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.put = function (val, len) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };

  /* ── the matrix ─────────────────────────────────── */
  function Matrix(size) {
    this.size = size;
    this.m = new Int8Array(size * size).fill(-1);   // -1 = free
    this.reserved = new Uint8Array(size * size);
  }
  Matrix.prototype.set = function (x, y, v, reserve) {
    this.m[y * this.size + x] = v ? 1 : 0;
    if (reserve) this.reserved[y * this.size + x] = 1;
  };
  Matrix.prototype.get = function (x, y) { return this.m[y * this.size + x] === 1; };
  Matrix.prototype.free = function (x, y) { return !this.reserved[y * this.size + x]; };

  function placeFinder(mx, x0, y0) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= mx.size || y >= mx.size) continue;
        const inRing = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
                       (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
        const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        mx.set(x, y, inRing || inCore, true);
      }
    }
  }

  function placeAlignment(mx, version) {
    const pos = ALIGN[version];
    for (const cy of pos) {
      for (const cx of pos) {
        // skip the three finder corners
        if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= mx.size - 9) || (cx >= mx.size - 9 && cy <= 8)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const on = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
            mx.set(cx + dx, cy + dy, on, true);
          }
        }
      }
    }
  }

  function placeTiming(mx) {
    for (let i = 8; i < mx.size - 8; i++) {
      const on = i % 2 === 0;
      mx.set(i, 6, on, true);
      mx.set(6, i, on, true);
    }
  }

  function reserveFormat(mx) {
    const n = mx.size;
    /* row 8 and column 8, skipping index 6 — that one belongs to the timing
       pattern and must not be touched, or the decoder loses the grid. */
    for (let i = 0; i < 9; i++) {
      if (i !== 6) { mx.set(i, 8, false, true); mx.set(8, i, false, true); }
    }
    for (let i = 0; i < 8; i++) {
      mx.set(n - 1 - i, 8, false, true);
      mx.set(8, n - 1 - i, false, true);
    }
    mx.set(8, n - 8, true, true);          // the always-dark module
  }

  /* format information: 2 bits level + 3 bits mask, BCH(15,5) */
  function formatBits(maskIdx) {
    const LEVEL_M = 0b00;
    let data = (LEVEL_M << 3) | maskIdx;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function placeFormat(mx, maskIdx) {
    const bits = formatBits(maskIdx), n = mx.size;
    for (let i = 0; i <= 5; i++) mx.set(8, i, (bits >> i) & 1, true);
    mx.set(8, 7, (bits >> 6) & 1, true);
    mx.set(8, 8, (bits >> 7) & 1, true);
    mx.set(7, 8, (bits >> 8) & 1, true);
    for (let i = 9; i < 15; i++) mx.set(14 - i, 8, (bits >> i) & 1, true);

    for (let i = 0; i < 8; i++) mx.set(n - 1 - i, 8, (bits >> i) & 1, true);
    for (let i = 8; i < 15; i++) mx.set(8, n - 15 + i, (bits >> i) & 1, true);
    mx.set(8, n - 8, true, true);
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];

  /** zig-zag placement, two columns at a time, skipping the timing column */
  function placeData(mx, bits, maskIdx) {
    const n = mx.size;
    let bit = 0, up = true;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                    // column 6 is timing
      for (let v = 0; v < n; v++) {
        const y = up ? n - 1 - v : v;
        for (let c = 0; c < 2; c++) {
          const x = right - c;
          if (!mx.free(x, y)) continue;
          let dark = bit < bits.length ? bits[bit++] === 1 : false;
          if (MASKS[maskIdx](x, y)) dark = !dark;
          mx.set(x, y, dark, false);
        }
      }
      up = !up;
    }
  }

  function penalty(mx) {
    const n = mx.size;
    let score = 0;

    // rule 1 — runs of five or more
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < n; a++) {
        let run = 1, prev = pass ? mx.get(a, 0) : mx.get(0, a);
        for (let b = 1; b < n; b++) {
          const cur = pass ? mx.get(a, b) : mx.get(b, a);
          if (cur === prev) { run++; }
          else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = cur; }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }
    // rule 2 — 2×2 blocks
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const v = mx.get(x, y);
        if (v === mx.get(x + 1, y) && v === mx.get(x, y + 1) && v === mx.get(x + 1, y + 1)) score += 3;
      }
    }
    // rule 3 — finder-like patterns
    const P1 = [true, false, true, true, true, false, true, false, false, false, false];
    const P2 = [false, false, false, false, true, false, true, true, true, false, true];
    const match = (get, a, b) => {
      for (let k = 0; k < 11; k++) if (get(a, b + k) !== P1[k]) return false;
      return true;
    };
    const match2 = (get, a, b) => {
      for (let k = 0; k < 11; k++) if (get(a, b + k) !== P2[k]) return false;
      return true;
    };
    for (let a = 0; a < n; a++) {
      for (let b = 0; b + 10 < n; b++) {
        const row = (i, j) => mx.get(j, i);
        const col = (i, j) => mx.get(i, j);
        if (match(row, a, b) || match2(row, a, b)) score += 40;
        if (match(col, a, b) || match2(col, a, b)) score += 40;
      }
    }
    // rule 4 — overall balance
    let dark = 0;
    for (let i = 0; i < n * n; i++) if (mx.m[i] === 1) dark++;
    const pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ── public ─────────────────────────────────────── */
  QR.encode = function (text) {
    const bytes = new TextEncoder().encode(String(text));

    let version = 0;
    for (let v = 1; v <= 6; v++) if (bytes.length <= capacity(v)) { version = v; break; }
    if (!version) throw new Error('That address is too long for this QR encoder (' + bytes.length + ' bytes, max ' + capacity(6) + ').');

    const [total, ecLen, blocks] = VER[version];
    const dataCw = total - ecLen * blocks;

    /* build the bit stream */
    const bb = new BitBuf();
    bb.put(0b0100, 4);                 // byte mode
    bb.put(bytes.length, 8);           // versions 1–9 use an 8-bit count
    for (const b of bytes) bb.put(b, 8);
    const cap = dataCw * 8;
    bb.put(0, Math.min(4, cap - bb.bits.length));        // terminator
    while (bb.bits.length % 8) bb.bits.push(0);
    const pad = [0xEC, 0x11];
    for (let i = 0; bb.bits.length < cap; i++) bb.put(pad[i % 2], 8);

    const data = new Uint8Array(dataCw);
    for (let i = 0; i < dataCw; i++) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i * 8 + j];
      data[i] = byte;
    }

    /* split into blocks, add error correction, interleave */
    const per = dataCw / blocks;
    const dBlocks = [], eBlocks = [];
    for (let i = 0; i < blocks; i++) {
      const chunk = data.slice(i * per, (i + 1) * per);
      dBlocks.push(chunk);
      eBlocks.push(rsEncode(chunk, ecLen));
    }
    const out = [];
    for (let i = 0; i < per; i++) for (const b of dBlocks) out.push(b[i]);
    for (let i = 0; i < ecLen; i++) for (const b of eBlocks) out.push(b[i]);

    const bits = [];
    for (const byte of out) for (let j = 7; j >= 0; j--) bits.push((byte >> j) & 1);

    /* lay it out, trying every mask */
    const size = 17 + version * 4;
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const mx = new Matrix(size);
      placeFinder(mx, 0, 0);
      placeFinder(mx, size - 7, 0);
      placeFinder(mx, 0, size - 7);
      placeAlignment(mx, version);
      placeTiming(mx);
      reserveFormat(mx);
      placeData(mx, bits, mask);
      placeFormat(mx, mask);
      const s = penalty(mx);
      if (s < bestScore) { bestScore = s; best = mx; }
    }

    return {
      version, size,
      get: (x, y) => best.get(x, y),
      matrix: best
    };
  };

  /** an <svg> string, `px` modules wide including a 4-module quiet zone */
  QR.svg = function (text, px, opt) {
    opt = opt || {};
    const qr = QR.encode(text);
    const quiet = opt.quiet == null ? 4 : opt.quiet;
    const n = qr.size + quiet * 2;
    const scale = (px || 200) / n;
    let path = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.get(x, y)) path += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n +
      '" width="' + (n * scale).toFixed(0) + '" height="' + (n * scale).toFixed(0) +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code for ' + String(text).replace(/[<>&"]/g, '') + '">' +
      '<rect width="' + n + '" height="' + n + '" fill="' + (opt.bg || '#ffffff') + '"/>' +
      '<path d="' + path + '" fill="' + (opt.fg || '#000000') + '"/></svg>';
  };

  /** two rows per line of block characters — readable in a terminal */
  QR.ascii = function (text, quiet) {
    const qr = QR.encode(text);
    const q = quiet == null ? 2 : quiet;
    const n = qr.size + q * 2;
    const on = (x, y) => (x >= q && y >= q && x < q + qr.size && y < q + qr.size) ? qr.get(x - q, y - q) : false;
    const lines = [];
    for (let y = 0; y < n; y += 2) {
      let line = '';
      for (let x = 0; x < n; x++) {
        const top = on(x, y), bot = y + 1 < n ? on(x, y + 1) : false;
        line += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
      }
      lines.push(line);
    }
    return lines.join('\n');
  };

})(typeof window !== 'undefined' ? (window.NW = window.NW || {}) : (module.exports = {}));
