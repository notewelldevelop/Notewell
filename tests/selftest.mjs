/* ═══════════════ NoteWell — self test ═══════════════
   Exercises the parts that are pure logic and easy to get subtly wrong:
   geometry, shape recognition, the scribble-to-erase classifier, the PDF
   writer and the ZIP writer.   Run:  node tests/selftest.mjs            */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/* minimal browser shims — enough for the pure modules */
const fakeCtx = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 8 }) : () => {}) });
const doc = {
  createElement(tag) {
    if (tag === 'canvas') {
      return {
        width: 8, height: 8, style: {},
        getContext: () => fakeCtx(),
        toDataURL: () => 'data:image/jpeg;base64,' + Buffer.from('jpegbytes').toString('base64')
      };
    }
    return { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } };
  },
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} }
};
const win = {
  document: doc, performance, crypto, navigator: { userAgent: 'node', maxTouchPoints: 0, platform: 'node' },
  matchMedia: () => ({ matches: false }), devicePixelRatio: 2,
  addEventListener() {}, setTimeout, clearTimeout, setInterval: () => 0, requestAnimationFrame: (f) => setTimeout(f, 0),
  Blob, Response, TextEncoder, TextDecoder, CompressionStream: globalThis.CompressionStream, URL,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  console, indexedDB: undefined
};
win.window = win;
const ctx = vm.createContext(win);

for (const f of ['js/util.js', 'js/qr.js', 'js/templates.js', 'js/shapes.js', 'js/pdfwriter.js', 'js/zipwriter.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const NW = win.NW;

/* ── tiny test runner ── */
let pass = 0, fail = 0;
const results = [];
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of queue) {
    try { const r = await fn(); if (r === false) throw new Error('returned false'); pass++; results.push(['ok  ', name]); }
    catch (e) { fail++; results.push(['FAIL', name + '  → ' + e.message]); }
  }
}
function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function near(a, b, tol, m) { if (Math.abs(a - b) > tol) throw new Error((m || '') + ' expected ~' + b + ', got ' + a); }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

/* ── point generators ── */
const jitter = (p, n = 1.6) => ({ x: p.x + (Math.random() - .5) * n, y: p.y + (Math.random() - .5) * n });
function circlePts(cx, cy, r, n = 60, wobble = 2.5) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; out.push(jitter({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }, wobble)); }
  return out;
}
function rectPts(x, y, w, h, wobble = 3) {
  const out = [], per = 22;
  const corner = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  for (let s = 0; s < 4; s++) for (let i = 0; i < per; i++) {
    const t = i / per;
    out.push(jitter({ x: corner[s][0] + (corner[s + 1][0] - corner[s][0]) * t, y: corner[s][1] + (corner[s + 1][1] - corner[s][1]) * t }, wobble));
  }
  out.push({ x, y });
  return out;
}
function linePts(x0, y0, x1, y1, n = 40, wobble = 1.5) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(jitter({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }, wobble)); }
  return out;
}
function trianglePts(cx, cy, r, wobble = 3) {
  const v = [0, 1, 2, 0].map(i => ({ x: cx + Math.cos(-Math.PI / 2 + i * 2.0944) * r, y: cy + Math.sin(-Math.PI / 2 + i * 2.0944) * r }));
  const out = [];
  for (let s = 0; s < 3; s++) for (let i = 0; i < 20; i++) {
    const t = i / 20;
    out.push(jitter({ x: v[s].x + (v[s + 1].x - v[s].x) * t, y: v[s].y + (v[s + 1].y - v[s].y) * t }, wobble));
  }
  out.push(v[0]);
  return out;
}
/** sawtooth zig-zag drawn left-to-right through a word */
function zigzagPts(x, y, w, h, teeth = 9) {
  const out = [];
  for (let i = 0; i < teeth; i++) {
    const up = i % 2 === 0;
    for (let s = 0; s <= 10; s++) {
      const t = s / 10;
      out.push({ x: x + (w * (i + t)) / teeth, y: y + (up ? t * h : h - t * h) });
    }
  }
  return out;
}
/** the classic: rub back and forth over the same word several times */
function rubOutPts(x, y, w, h, passes = 5) {
  const out = [];
  for (let i = 0; i < passes; i++) {
    const fwd = i % 2 === 0;
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      out.push({ x: x + (fwd ? t : 1 - t) * w, y: y + (i / (passes - 1)) * h + Math.sin(t * 9) * 2 });
    }
  }
  return out;
}
function handwritingPts() {
  // a plausible cursive "hello" — must NOT be read as a scribble
  const out = [];
  for (let i = 0; i <= 220; i++) {
    const t = i / 220;
    out.push({ x: 40 + t * 260, y: 100 + Math.sin(t * 14) * 11 - t * 4 });
  }
  return out;
}

/* ═════ geometry ═════ */
t('rdp keeps endpoints and drops collinear points', () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: .2 }, { x: 10, y: 0 }, { x: 15, y: .1 }, { x: 20, y: 0 }];
  const out = NW.geom.rdp(pts, 1);
  eq(out.length, 2); eq(out[0].x, 0); eq(out[1].x, 20);
});
t('rdp preserves a real corner', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 20 }];
  eq(NW.geom.rdp(pts, 1).length, 3);
});
t('resample returns exactly N points', () => eq(NW.geom.resample(circlePts(0, 0, 50, 37, 0), 64).length, 64));
t('inPoly: inside / outside', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  eq(NW.geom.inPoly({ x: 5, y: 5 }, sq), true);
  eq(NW.geom.inPoly({ x: 15, y: 5 }, sq), false);
});
t('segCross detects an X and ignores parallels', () => {
  eq(NW.geom.segCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), true);
  eq(NW.geom.segCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }), false);
});
t('ptSeg distance', () => near(NW.geom.ptSeg({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 4, 1e-9));
t('bbox is right', () => {
  const b = NW.geom.bbox([{ x: 1, y: 2 }, { x: 9, y: 20 }]);
  eq(b.x0, 1); eq(b.y1, 20); eq(b.w, 8); eq(b.h, 18);
});

/* ═════ shape recognition ═════ */
t('rough circle → ellipse with near-equal radii', () => {
  const s = NW.shapes.recognize(circlePts(200, 200, 90));
  eq(s.kind, 'ellipse');
  near(s.rx, 90, 14, 'rx'); near(s.ry, 90, 14, 'ry');
});
t('rough rectangle → axis-aligned rect', () => {
  const s = NW.shapes.recognize(rectPts(50, 60, 240, 130));
  eq(s.kind, 'rect');
  near(s.w, 240, 26, 'w'); near(s.h, 130, 26, 'h'); near(s.rot, 0, 0.2, 'rot');
});
t('near-square rectangle snaps to a true square', () => {
  const s = NW.shapes.recognize(rectPts(0, 0, 200, 208));
  eq(s.kind, 'rect'); near(s.w, s.h, 1, 'square');
});
t('rough line → line', () => {
  const s = NW.shapes.recognize(linePts(10, 10, 300, 40));
  eq(s.kind, 'line');
});
t('near-horizontal line snaps flat', () => {
  const s = NW.shapes.recognize(linePts(10, 100, 300, 103, 40, 0.6));
  eq(s.kind, 'line'); near(s.a.y, s.b.y, 1.5, 'levelled');
});
t('rough triangle → 3-point polygon', () => {
  const s = NW.shapes.recognize(trianglePts(200, 200, 120));
  eq(s.kind, 'poly'); eq(s.pts.length, 3);
});
t('outline() gives a usable polyline for every kind', () => {
  for (const sh of [{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
  { kind: 'rect', x: 0, y: 0, w: 10, h: 10, rot: 0.3 },
  { kind: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 3, rot: 0 },
  { kind: 'poly', pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: true }]) {
    const o = NW.shapes.outline(sh);
    if (!Array.isArray(o) || o.length < 2) throw new Error(sh.kind + ' gave ' + JSON.stringify(o));
    if (o.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error(sh.kind + ' produced NaN');
  }
});
t('a tiny dot is not a shape', () => eq(NW.shapes.recognize([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }]), null));

/* ═════ scribble-to-erase ═════ */
t('rubbing back and forth over a word IS recognised', () => {
  const r = NW.shapes.detectScribble(rubOutPts(20, 60, 150, 26, 6));
  if (!r.isScribble) throw new Error('missed it (rev=' + r.reversals + ' dens=' + r.density.toFixed(2) + ')');
});
t('a single sawtooth pass is NOT enough — too close to handwriting', () => {
  const r = NW.shapes.detectScribble(zigzagPts(20, 20, 180, 40, 9));
  if (r.isScribble) throw new Error('one pass should not delete anything (dens=' + r.density.toFixed(2) + ')');
});

/* the shapes that were actually eating people's notes */
t('writing the letter H is not a scribble', () => {
  const stem = linePts(40, 20, 42, 120, 30, .7);
  const bar = linePts(40, 70, 110, 69, 24, .7);
  const stem2 = linePts(110, 20, 112, 120, 30, .7);
  for (const [name, st] of [['stem', stem], ['crossbar', bar], ['second stem', stem2]]) {
    const r = NW.shapes.detectScribble(st);
    if (r.isScribble) throw new Error('the ' + name + ' of an H registered as a scribble');
  }
});
t('a word full of up-and-down strokes is not a scribble', () => {
  // "minimum" — the worst case for anything counting vertical reversals
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240;
    pts.push({ x: 20 + t * 300, y: 60 + Math.sin(t * 26) * 18 });
  }
  const r = NW.shapes.detectScribble(pts);
  if (r.isScribble) throw new Error('cursive registered as a scribble (rev=' + r.reversals + ' dens=' + r.density.toFixed(2) + ')');
});
t('one line drawn through something is not a scribble', () => {
  const r = NW.shapes.detectScribble(linePts(10, 50, 260, 54, 40, 1.2));
  if (r.isScribble) throw new Error('a strike-through should not delete');
});
t('two passes are still not enough, four are', () => {
  const two = NW.shapes.detectScribble(rubOutPts(20, 60, 150, 20, 2));
  if (two.isScribble) throw new Error('two passes should not delete');
  const four = NW.shapes.detectScribble(rubOutPts(20, 60, 150, 24, 5));
  if (!four.isScribble) throw new Error('a deliberate rub should delete (rev=' + four.reversals + ' dens=' + four.density.toFixed(2) + ')');
});
t('a dense back-and-forth knot IS recognised', () => {
  const pts = [];
  for (let i = 0; i < 90; i++) { const a = i * 0.9; pts.push({ x: 100 + Math.cos(a) * 40 * Math.cos(i * .3), y: 100 + Math.sin(a) * 26 }); }
  const r = NW.shapes.detectScribble(pts);
  if (!r.isScribble) throw new Error('missed it (rev=' + r.reversals + ' cross=' + r.crossings + ')');
});
t('ordinary handwriting is NOT mistaken for a scribble', () => {
  const r = NW.shapes.detectScribble(handwritingPts());
  if (r.isScribble) throw new Error('false positive (dens=' + r.density.toFixed(2) + ' rev=' + r.reversals + ')');
});
t('a straight line is NOT a scribble', () => eq(NW.shapes.detectScribble(linePts(0, 0, 300, 0, 60, 1)).isScribble, false));
t('a drawn circle is NOT a scribble', () => eq(NW.shapes.detectScribble(circlePts(0, 0, 80)).isScribble, false));
t('a short flick is ignored', () => eq(NW.shapes.detectScribble(linePts(0, 0, 12, 3, 14, .3)).isScribble, false));
t('strike-through is detected', () => eq(NW.shapes.isStrikeThrough(linePts(0, 0, 200, 4, 30, .8)), true));

/* ═════ templates ═════ */
t('every template draws without throwing', () => {
  const page = { w: 1240, h: 1754, template: 'blank', paper: 'white', bg: '#fff', inkColor: '#ccc' };
  for (const id of NW.templateList()) {
    page.template = id;
    NW.paintTemplate(fakeCtx(), page);
  }
  if (NW.templateList().length < 10) throw new Error('expected 10+ rulings, got ' + NW.templateList().length);
});
t('every paper gives a default ink you can actually read on it', () => {
  const lum = hex => {
    const c = NW.hexToRgb(hex);
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const p of NW.PAPER_COLORS) {
    const ink = NW.defaultInkFor(p.id);
    const ratio = contrast(ink, p.bg);
    if (ratio < 7) throw new Error(p.name + ': ink ' + ink + ' on ' + p.bg + ' is only ' + ratio.toFixed(1) + ':1');
    // the ruling should be visible but must not fight the handwriting
    const ruleRatio = contrast(p.ink, p.bg);
    if (ruleRatio < 1.04) throw new Error(p.name + ': ruling is invisible (' + ruleRatio.toFixed(2) + ':1)');
    if (ruleRatio > 3.2) throw new Error(p.name + ': ruling is too loud (' + ruleRatio.toFixed(2) + ':1)');
  }
});

t('the paper palette stays neutral — greys and warm off-whites, no colours', () => {
  for (const p of NW.PAPER_COLORS) {
    for (const hex of [p.bg, p.ink]) {
      const c = NW.hexToRgb(hex);
      const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      // warm-neutral means red ≥ green ≥ blue; anything else is a tint
      if (!(c.r >= c.g && c.g >= c.b)) throw new Error(p.name + ' ' + hex + ' is tinted, not neutral');
      if (spread > 30) throw new Error(p.name + ' ' + hex + ' is too saturated (spread ' + spread + ')');
    }
  }
});

/* ═════ PDF writer ═════ */
const fakeCanvas = (w, h) => ({
  width: w, height: h,
  getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }),
  toDataURL: () => 'data:image/jpeg;base64,' + Buffer.from(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4])).toString('base64')
});

let pdfBytes;
t('PDF writer produces a structurally valid file', async () => {
  const blob = await NW.PDF.create([
    { canvas: fakeCanvas(40, 56), widthPt: 595, heightPt: 842, texts: [{ x: 72, y: 100, size: 12, text: 'Hello (NoteWell) \\ test' }], bookmark: 'One' },
    { canvas: fakeCanvas(40, 56), widthPt: 595, heightPt: 842, texts: [], bookmark: 'Two' }
  ], { title: 'Test', quality: 'balanced' });
  pdfBytes = Buffer.from(await blob.arrayBuffer());
  const s = pdfBytes.toString('latin1');
  if (!s.startsWith('%PDF-1.4')) throw new Error('bad header');
  if (!s.includes('/Type /Catalog')) throw new Error('no catalog');
  if (!s.includes('/Type /Pages')) throw new Error('no page tree');
  if ((s.match(/\/Type \/Page[^s]/g) || []).length !== 2) throw new Error('expected 2 pages');
  if (!s.includes('/Outlines')) throw new Error('bookmarks missing');
  if (!s.includes('3 Tr')) throw new Error('invisible text layer missing');
  if (!s.includes('(Hello \\(NoteWell\\) \\\\ test)')) throw new Error('text not escaped properly');
  if (!s.includes('startxref')) throw new Error('no xref');
  if (!s.trimEnd().endsWith('%%EOF')) throw new Error('no EOF');
});
t('PDF xref offsets point at real objects', () => {
  const s = pdfBytes.toString('latin1');
  const m = /startxref\s+(\d+)/.exec(s);
  const xrefAt = Number(m[1]);
  if (s.slice(xrefAt, xrefAt + 4) !== 'xref') throw new Error('startxref does not point at the table');
  const table = s.slice(xrefAt).split("\n").slice(3);
  let checked = 0;
  for (const row of table) {
    const r = /^(\d{10}) 00000 n/.exec(row);
    if (!r) break;
    const off = Number(r[1]);
    if (!/^\d+ 0 obj/.test(s.slice(off, off + 20))) throw new Error('offset ' + off + ' is not an object');
    checked++;
  }
  if (checked < 4) throw new Error('only checked ' + checked + ' objects');
});
t('lossless PDF path also works', async () => {
  const blob = await NW.PDF.create([{ canvas: fakeCanvas(8, 8), widthPt: 100, heightPt: 100 }], { quality: 'lossless' });
  const s = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  if (!s.includes('/FlateDecode')) throw new Error('expected a Flate image');
});

/* ═════ ZIP writer ═════ */
let zipBytes;
t('ZIP writer produces a readable archive', async () => {
  const blob = await NW.ZIP.create([
    { name: 'Maths/Week 1.pdf', data: new Uint8Array(Buffer.from('%PDF-1.4 fake one')) },
    { name: 'Maths/Deeper/Week 2.pdf', data: new Uint8Array(Buffer.alloc(4000, 65)) },
    { name: 'notes.txt', data: 'hello from NoteWell' }
  ]);
  zipBytes = Buffer.from(await blob.arrayBuffer());
  if (zipBytes.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
  const eocd = zipBytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('no end-of-central-directory');
  eq(zipBytes.readUInt16LE(eocd + 10), 3, 'entry count');
  fs.writeFileSync('/tmp/notewell-test.zip', zipBytes);
});
t('safeName strips characters that break filesystems', () => {
  eq(NW.ZIP.safeName('PHYS/2001: waves?*'), 'PHYS-2001- waves-');
  eq(NW.ZIP.safeName(''), 'Untitled');
});

/* ═════ QR encoder ═════
   The structural invariants a scanner relies on. The real proof that these
   symbols decode is in tests/qr-decode.py, which runs them through OpenCV. */
t('QR: picks the smallest version that fits', () => {
  eq(NW.QR.encode('hi').version, 1);
  eq(NW.QR.encode('http://192.168.1.14:8787').version, 2);
  const long = 'https://' + 'a'.repeat(80) + '.app/';
  ok(NW.QR.encode(long).version >= 5, 'a long URL needs a bigger symbol');
});
t('QR: refuses politely when the text is too long', () => {
  let msg = '';
  try { NW.QR.encode('x'.repeat(400)); } catch (e) { msg = e.message; }
  ok(/too long/i.test(msg), 'got: ' + msg);
});
t('QR: finder patterns are in all three corners', () => {
  const q = NW.QR.encode('https://notewell.netlify.app/');
  const finder = (ox, oy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const ring = (x === 0 || x === 6 || y === 0 || y === 6);
      const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (q.get(ox + x, oy + y) !== (ring || core)) return false;
    }
    return true;
  };
  ok(finder(0, 0), 'top left');
  ok(finder(q.size - 7, 0), 'top right');
  ok(finder(0, q.size - 7), 'bottom left');
});
t('QR: timing patterns alternate and are not overwritten', () => {
  const q = NW.QR.encode('https://notewell.netlify.app/');
  for (let i = 8; i < q.size - 8; i++) {
    const want = i % 2 === 0;
    if (q.get(i, 6) !== want) throw new Error('horizontal timing broken at ' + i);
    if (q.get(6, i) !== want) throw new Error('vertical timing broken at ' + i);
  }
});
t('QR: the format area carries a valid BCH code word', () => {
  const q = NW.QR.encode('https://notewell.netlify.app/');
  // read copy 1 back out of the matrix
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= (q.get(8, i) ? 1 : 0) << i;
  bits |= (q.get(8, 7) ? 1 : 0) << 6;
  bits |= (q.get(8, 8) ? 1 : 0) << 7;
  bits |= (q.get(7, 8) ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) bits |= (q.get(14 - i, 8) ? 1 : 0) << i;

  const raw = bits ^ 0x5412;
  // a valid format word divides cleanly by the BCH generator
  let rem = raw;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  eq(rem, 0, 'BCH remainder should be zero');
  eq((raw >>> 13) & 0b11, 0b00, 'error correction level M');
});
t('QR: the dark module is set', () => {
  const q = NW.QR.encode('https://notewell.netlify.app/');
  eq(q.get(8, q.size - 8), true);
});
t('QR: svg and ascii renderers produce something sane', () => {
  const svg = NW.QR.svg('https://notewell.netlify.app/', 200);
  ok(svg.startsWith('<svg') && svg.includes('</svg>'), 'svg wrapper');
  ok(svg.includes('<path d="M'), 'has module path');
  const art = NW.QR.ascii('https://notewell.netlify.app/');
  const lines = art.split('\n');
  ok(lines.length > 8, 'ascii has rows');
  const w = lines[0].length;
  ok(lines.every(l => l.length === w), 'ascii rows are all the same width');
});

/* ═════ misc ═════ */
t('colour helpers round-trip', () => {
  eq(NW.rgbToHex(26, 29, 35), '#1a1d23');
  const c = NW.hexToRgb('#1a1d23'); eq(c.r, 26); eq(c.g, 29); eq(c.b, 35);
  eq(NW.hexToRgb('#abc').r, 170);
});
t('markdown → html is escaped', () => {
  const h = NW.md('**bold** <script>x</script> `code`');
  if (!h.includes('<strong>bold</strong>')) throw new Error('bold failed');
  if (h.includes('<script>')) throw new Error('html not escaped');
});
t('byte formatting', () => { eq(NW.bytes(1024), '1 KB'); eq(NW.bytes(1536 * 1024), '1.5 MB'); });

/* ── report ── */
await runAll();
console.log('');
for (const [tag, name] of results) console.log((tag === 'ok  ' ? '  \x1b[32m✓\x1b[0m ' : '  \x1b[31m✗\x1b[0m ') + name);
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
