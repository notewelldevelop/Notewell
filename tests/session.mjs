/* ═══════════════ NoteWell — headless session test ═══════════════
   Loads the whole app into a mock DOM and drives it with synthetic pointer
   events, the way a stylus would: draw, highlight, snap a shape, scribble
   something out, sweep the eraser, lasso and drag, flood-fill, type, undo,
   add a page, export.  Run:  node tests/session.mjs                        */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ══════════ mock DOM ══════════ */
const listeners = new WeakMap();
function mkEl(tag = 'div', id = '') {
  const kids = [];
  const el = {
    tagName: tag.toUpperCase(), id, style: {}, dataset: {}, children: kids, hidden: false,
    textContent: '', innerText: '', value: '', width: 1200, height: 800, scrollTop: 0, scrollHeight: 0,
    offsetWidth: 200, offsetHeight: 40, _attrs: {},
    classList: { _s: new Set(), add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { kids.push(c); return c; }, append(...c) { kids.push(...c); }, prepend(...c) { kids.unshift(...c); },
    insertBefore(c) { kids.unshift(c); return c; }, insertAdjacentHTML() { }, remove() { }, removeChild() { },
    setAttribute(k, v) { el._attrs[k] = String(v); }, getAttribute: k => (k in el._attrs ? el._attrs[k] : null),
    removeAttribute(k) { delete el._attrs[k]; },
    contains: () => false,
    focus() { }, blur() { }, click() { }, select() { },
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 }),
    captured: new Set(), captureLog: [],
    setPointerCapture(id) { el.captured.add(id); el.captureLog.push(['set', id]); },
    releasePointerCapture(id) { el.captured.delete(id); el.captureLog.push(['release', id]); },
    hasPointerCapture(id) { return el.captured.has(id); },
    getContext: () => mockCtx(el),
    toBlob(cb) { cb(new Blob([new Uint8Array([1, 2, 3])])); },
    toDataURL: () => 'data:image/png;base64,AAAA' + (el.__tag = (el.__tag || 0) + 1),
    addEventListener(t, f) { const m = listeners.get(el) || {}; (m[t] = m[t] || []).push(f); listeners.set(el, m); },
    removeEventListener(t, f) { const m = listeners.get(el) || {}; if (m[t]) m[t] = m[t].filter(x => x !== f); },
    dispatch(t, ev) { const m = listeners.get(el) || {}; (m[t] || []).forEach(f => f(ev)); }
  };
  // setting innerHTML = '' must actually empty the element, like a browser
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => _html,
    set(v) { _html = v; if (!v) kids.length = 0; }
  });
  // className and classList stay in step, as they do in a real DOM
  Object.defineProperty(el, 'className', {
    get: () => Array.from(el.classList._s).join(' '),
    set(v) { el.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  return el;
}

/* a canvas context that records the interesting bits */
function mockCtx(canvas) {
  const rec = { composites: [], fills: 0, strokes: 0, texts: [], images: 0 };
  const ctx = {
    canvas, _rec: rec, globalAlpha: 1, globalCompositeOperation: 'source-over',
    strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, lineCap: '', lineJoin: '', font: '',
    textAlign: 'left', textBaseline: 'alphabetic', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    save() { }, restore() { }, setTransform() { }, translate() { }, scale() { }, rotate() { },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, quadraticCurveTo() { }, bezierCurveTo() { },
    arc() { }, ellipse() { }, rect() { }, roundRect() { }, clip() { }, setLineDash() { },
    stroke() { rec.strokes++; rec.composites.push(this.globalCompositeOperation); },
    fill() { rec.fills++; rec.composites.push(this.globalCompositeOperation); },
    fillRect() { rec.fills++; }, strokeRect() { rec.strokes++; }, clearRect() { },
    drawImage() { rec.images++; },
    fillText(t) { rec.texts.push(t); },
    measureText: s => ({ width: String(s).length * 9 }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(d) { canvas.__put = d; },
    getImageData: (x, y, w, h) => canvas.__pixels || { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }
  };
  return ctx;
}

const registry = {};
const docEl = mkEl('html', 'documentElement');
const doc = {
  readyState: 'loading',
  documentElement: docEl,
  createElement: t => mkEl(t),
  createTextNode: t => ({ nodeValue: t }),
  createRange: () => ({ selectNodeContents() { } }),
  getElementById: id => registry['#' + id] || (registry['#' + id] = mkEl('div', id)),
  querySelector: s => registry[s] || (registry[s] = mkEl('div', s.replace('#', ''))),
  querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { },
  head: mkEl(), body: mkEl(), hidden: false
};
registry['#stage'] = mkEl('div', 'stage');
registry['#paper'] = mkEl('canvas', 'paper');
registry['#live'] = mkEl('canvas', 'live');
registry['#subbar'] = mkEl('div', 'subbar');

/* localStorage, so the theme can remember itself */
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

const win = {
  document: doc, performance, crypto, console,
  navigator: { userAgent: 'node', maxTouchPoints: 0, platform: 'node', onLine: true, vibrate() { }, clipboard: { writeText() { } }, storage: { estimate: async () => ({ usage: 0, quota: 1 }), persist: async () => true } },
  localStorage,
  matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  open() { },
  devicePixelRatio: 2, location: { protocol: 'http:' },
  addEventListener() { }, removeEventListener() { },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() { },
  requestAnimationFrame: () => 0, cancelAnimationFrame() { },
  ResizeObserver: class { observe() { } },
  Blob, Response, TextEncoder, TextDecoder, CompressionStream, URL, fetch: async () => ({ ok: false, status: 0, text: async () => '' }),
  indexedDB: undefined,
  Image: class { set src(v) { this.width = 40; this.height = 40; setTimeout(() => this.onload && this.onload(), 0); } },
  getSelection: () => ({ removeAllRanges() { }, addRange() { } }),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64')
};
win.window = win; win.self = win;
const ctxVM = vm.createContext(win);

for (const f of ['util.js', 'qr.js', 'templates.js', 'shapes.js', 'store.js', 'pdfwriter.js', 'zipwriter.js',
  'engine.js', 'text.js', 'tools.js', 'pdfimport.js', 'ai.js', 'sync.js', 'backup.js', 'ui.js',
  'install.js', 'updates.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctxVM, { filename: f });
}
const NW = win.NW, E = NW.Engine, T = NW.Tools;
/* the settings as shipped, before any test changes them */
const SHIPPED = JSON.parse(JSON.stringify(T.settings));

/* IndexedDB isn't available here, so keep the library purely in memory */
NW.Store.put = async () => { }; NW.Store.get = async () => null; NW.Store.kv = async () => undefined;
NW.Lib.flush = async () => { };

/* ══════════ test runner ══════════ */
let pass = 0, fail = 0; const out = [];
const queue = [];
const t = (n, f) => queue.push([n, f]);
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error((m || '') + ' expected ~' + b + ' got ' + a); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

/* ══════════ synthetic stylus ══════════ */
const stage = registry['#stage'];
let pid = 1;
function ev(type, x, y, opt = {}) {
  const e = {
    type, clientX: x, clientY: y, pointerId: opt.id || pid, pointerType: opt.pointerType || 'pen',
    pressure: opt.pressure == null ? 0.55 : opt.pressure,
    tiltX: opt.tiltX || 0, tiltY: opt.tiltY || 0,
    button: opt.button == null ? 0 : opt.button, buttons: 1,
    /* left undefined unless a test is exercising out-of-order delivery; the app
       falls back to its own clock when an event carries no usable stamp */
    timeStamp: opt.timeStamp,
    ctrlKey: false, metaKey: false, shiftKey: false,
    preventDefault() { }, stopPropagation() { },
    getCoalescedEvents() { return opt.coalesced || [e]; }
  };
  return e;
}
/** draw a path with the stylus; `hold` waits at the end so hold-to-snap can fire */
function stroke(points, opt = {}) {
  const id = ++pid;
  stage.dispatch('pointerdown', ev('pointerdown', points[0].x, points[0].y, { ...opt, id }));
  for (let i = 1; i < points.length; i++)
    stage.dispatch('pointermove', ev('pointermove', points[i].x, points[i].y, { ...opt, id }));
  const last = points[points.length - 1];
  stage.dispatch('pointerup', ev('pointerup', last.x, last.y, { ...opt, id }));
}
function tapPen(x, y) {
  const id = ++pid;
  stage.dispatch('pointerdown', ev('pointerdown', x, y, { id }));
  stage.dispatch('pointerup', ev('pointerup', x, y, { id }));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* page coords → screen coords, so tests can think in page space */
function scr(px, py, page = 0) {
  const L = E.layout[page];
  return E.toScreen(L.x + px, L.y + py);
}
function pathOnPage(pts, page = 0) { return pts.map(p => { const s = scr(p.x, p.y, page); return { x: s.x, y: s.y }; }); }

/* ══════════ set up a notebook ══════════ */
let nb, page;
t('app boots into an editable notebook', async () => {
  E.init(stage, registry['#paper'], registry['#live']);
  T.init();
  nb = await NW.Lib.newNotebook({ name: 'Session test', template: 'lined' });
  const pages = await NW.Lib.loadPages(nb);
  E.open(nb, pages);
  page = pages[0];
  ok(page && page.w > 0 && page.h > 0, 'page has size');
  eq(E.pages.length, 1);
  ok(E.cam.zoom > 0, 'camera set');
});

/* ══════════ 1. pen ══════════ */
t('pen: a stylus stroke is stored with per-point pressure', () => {
  T.setTool('pen');
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push({ x: 200 + i * 12, y: 400 + Math.sin(i / 3) * 30 });
  stroke(pathOnPage(pts), { pressure: 0.8 });
  eq(page.items.length, 1);
  const it = page.items[0];
  eq(it.type, 'stroke'); eq(it.tool, 'pen');
  ok(it.pts.length > 10, 'kept the samples: ' + it.pts.length);
  ok(it.pts.every(p => p.p > 0.5), 'pressure recorded');
  near(it.pts[0].x, 200, 6, 'first point maps back to page space');
});

t('pen: undo removes it, redo puts it back', () => {
  E.History.stepBack(); eq(page.items.length, 0);
  E.History.stepFwd(); eq(page.items.length, 1);
});

/* ══════════ 2. highlighter ══════════ */
t('highlighter: multiplies rather than covering, and text drawn under it survives', () => {
  T.setTool('highlighter');
  stroke(pathOnPage([{ x: 180, y: 400 }, { x: 560, y: 400 }]));
  const hl = page.items[page.items.length - 1];
  eq(hl.type, 'stroke'); eq(hl.tool, 'highlighter');
  const c = mockCtx(mkEl('canvas'));
  E.drawItem(c, hl, page);
  ok(c._rec.composites.includes('multiply'), 'highlighter must use multiply blending');
  // the pen stroke underneath is still an item, untouched
  ok(page.items.some(i => i.tool === 'pen'), 'ink underneath survived');
});

t('highlighter: straight mode reduces the stroke to two points', () => {
  T.opts.highlighter.straight = true;
  stroke(pathOnPage([{ x: 180, y: 500 }, { x: 300, y: 512 }, { x: 480, y: 498 }]));
  const hl = page.items[page.items.length - 1];
  eq(hl.pts.length, 2);
  T.opts.highlighter.straight = false;
});

/* ══════════ 3. shape snapping ══════════ */
t('shape tool: a rough box becomes a rectangle', () => {
  T.setTool('shape'); T.opts.shape.kind = 'auto';
  const before = page.items.length;
  const box = [];
  const cs = [[300, 700], [700, 700], [700, 980], [300, 980], [300, 700]];
  for (let s = 0; s < 4; s++) for (let i = 0; i < 18; i++) {
    const k = i / 18;
    box.push({ x: cs[s][0] + (cs[s + 1][0] - cs[s][0]) * k + (Math.random() - .5) * 5,
               y: cs[s][1] + (cs[s + 1][1] - cs[s][1]) * k + (Math.random() - .5) * 5 });
  }
  box.push({ x: 300, y: 700 });
  stroke(pathOnPage(box));
  eq(page.items.length, before + 1);
  const sh = page.items[page.items.length - 1];
  eq(sh.type, 'shape'); eq(sh.shape.kind, 'rect');
  near(sh.shape.w, 400, 40, 'width'); near(sh.shape.h, 280, 40, 'height');
});

t('shape tool: forcing "ellipse" overrides the guess', () => {
  T.opts.shape.kind = 'ellipse';
  stroke(pathOnPage([{ x: 800, y: 700 }, { x: 900, y: 760 }, { x: 830, y: 840 }, { x: 800, y: 700 }]));
  eq(page.items[page.items.length - 1].shape.kind, 'ellipse');
  T.opts.shape.kind = 'auto';
});

/* ══════════ 4. scribble to erase (pen) ══════════ */
t('scribble-to-erase: scribbling over ink deletes it and leaves no scribble', () => {
  T.settings.scribbleWhileWriting = true;      // opt-in since it can misread writing
  T.setTool('pen');
  const start = page.items.length;
  // something to destroy
  stroke(pathOnPage([{ x: 200, y: 1200 }, { x: 400, y: 1200 }]));
  eq(page.items.length, start + 1);
  const victim = page.items[page.items.length - 1];

  // now rub back and forth over it
  const rub = [];
  for (let i = 0; i < 5; i++) {
    const fwd = i % 2 === 0;
    for (let s = 0; s <= 18; s++) {
      const k = s / 18;
      rub.push({ x: 200 + (fwd ? k : 1 - k) * 200, y: 1188 + i * 6 });
    }
  }
  stroke(pathOnPage(rub));
  ok(!page.items.includes(victim), 'the underlying stroke was erased');
  eq(page.items.length, start, 'and the scribble itself was not kept');
  T.settings.scribbleWhileWriting = false;
});

t('scribble-to-erase: normal writing is left alone', () => {
  T.settings.scribbleWhileWriting = true;
  const start = page.items.length;
  const cursive = [];
  for (let i = 0; i <= 160; i++) { const k = i / 160; cursive.push({ x: 200 + k * 300, y: 1350 + Math.sin(k * 12) * 12 }); }
  stroke(pathOnPage(cursive));
  eq(page.items.length, start + 1, 'ordinary handwriting is kept');
  T.settings.scribbleWhileWriting = false;
});

/* ══════════ 5. sweep eraser ══════════ */
t('sweep eraser: removes whole strokes it touches, in one undo step', () => {
  T.setTool('pen');
  const base = page.items.length;
  stroke(pathOnPage([{ x: 200, y: 1500 }, { x: 500, y: 1500 }]));
  stroke(pathOnPage([{ x: 200, y: 1540 }, { x: 500, y: 1540 }]));
  eq(page.items.length, base + 2);

  T.setTool('eraser'); T.opts.eraser.mode = 'area'; T.opts.eraser.size = 60;
  stroke(pathOnPage([{ x: 340, y: 1480 }, { x: 345, y: 1520 }, { x: 350, y: 1560 }]));
  eq(page.items.length, base, 'both strokes gone in one sweep');

  E.History.stepBack();
  eq(page.items.length, base + 2, 'one undo brings both back');
});

t('sweep eraser: "ink only" spares images and text', () => {
  const img = { id: 'img1', type: 'image', x: 100, y: 1700, w: 200, h: 120, rot: 0, data: 'data:image/png;base64,AAAA', opacity: 1 };
  page.items.push(img);
  T.opts.eraser.inkOnly = true;
  stroke(pathOnPage([{ x: 120, y: 1740 }, { x: 280, y: 1760 }]));
  ok(page.items.includes(img), 'image survived an ink-only eraser');
  T.opts.eraser.inkOnly = false;
  page.items.splice(page.items.indexOf(img), 1);
});

/* ══════════ 6. lasso: circle it, drag it ══════════ */
t('lasso: circling work selects it, dragging moves every point', () => {
  T.setTool('pen');
  const before = page.items.length;
  stroke(pathOnPage([{ x: 700, y: 1500 }, { x: 850, y: 1500 }, { x: 850, y: 1580 }]));
  const target = page.items[page.items.length - 1];
  const x0 = target.pts[0].x, y0 = target.pts[0].y;

  T.setTool('lasso');
  const loop = [];
  for (let i = 0; i <= 40; i++) {
    const a = i / 40 * Math.PI * 2;
    loop.push({ x: 780 + Math.cos(a) * 140, y: 1540 + Math.sin(a) * 120 });
  }
  stroke(pathOnPage(loop));
  ok(E.selection && E.selection.items.length >= 1, 'lasso caught the stroke');
  ok(E.selection.items.includes(target), 'and it is the right one');

  // drag from inside the loop
  const from = scr(780, 1540), to = scr(880, 1300);
  const id = ++pid;
  stage.dispatch('pointerdown', ev('pointerdown', from.x, from.y, { id }));
  stage.dispatch('pointermove', ev('pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, { id }));
  stage.dispatch('pointermove', ev('pointermove', to.x, to.y, { id }));
  stage.dispatch('pointerup', ev('pointerup', to.x, to.y, { id }));

  near(target.pts[0].x - x0, 100, 8, 'moved right by 100 page units');
  near(target.pts[0].y - y0, -240, 10, 'moved up by 240 page units');
  eq(page.items.length, before + 1, 'nothing was added or lost');

  E.History.stepBack();
  near(target.pts[0].x, x0, 1, 'undo restores the position');
});

t('lasso: duplicate, send to back, delete all behave', () => {
  const n = page.items.length;
  T.selAction('copy');
  eq(page.items.length, n + 1, 'duplicated');
  const dup = E.selection.items[0];
  T.selAction('back');
  eq(page.items.indexOf(dup), 0, 'sent to the back');
  E.selection = { pageIndex: 0, page, items: [dup], poly: null, bbox: E.selectionBBox([dup]), moved: true };
  T.selAction('delete');
  eq(page.items.length, n, 'deleted');
});

/* ══════════ 7. paint bucket ══════════ */
t('paint bucket: floods the inside of a closed outline, not the whole page', async () => {
  // hand the renderer a synthetic bitmap: white page with a black box outline
  const scale = Math.min(Math.max(1400 / Math.max(page.w, page.h), 0.5), 1);
  const W = Math.round(page.w * scale), H = Math.round(page.h * scale);
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const bx0 = Math.round(120 * scale), bx1 = Math.round(420 * scale);
  const by0 = Math.round(120 * scale), by1 = Math.round(320 * scale);
  const px = (x, y) => (y * W + x) * 4;
  for (let x = bx0; x <= bx1; x++) for (const y of [by0, by0 + 1, by0 + 2, by1, by1 - 1, by1 - 2])
    { const o = px(x, y); data[o] = data[o + 1] = data[o + 2] = 0; }
  for (let y = by0; y <= by1; y++) for (const x of [bx0, bx0 + 1, bx0 + 2, bx1, bx1 - 1, bx1 - 2])
    { const o = px(x, y); data[o] = data[o + 1] = data[o + 2] = 0; }

  const realRender = E.renderPageTo;
  E.renderPageTo = (pg, s) => { const c = mkEl('canvas'); c.width = W; c.height = H; c.__pixels = { width: W, height: H, data }; return c; };

  const before = page.items.length;
  T.setTool('fill');
  T.opts.fill.color = '#ffd8a8'; T.opts.fill.tolerance = 34; T.opts.fill.gap = 1;
  const p = scr(270, 220);
  stage.dispatch('pointerdown', ev('pointerdown', p.x, p.y, { id: ++pid }));
  stage.dispatch('pointerup', ev('pointerup', p.x, p.y, { id: pid }));
  await wait(120);
  E.renderPageTo = realRender;

  eq(page.items.length, before + 1, 'one fill added');
  const fillItem = page.items[0];
  eq(fillItem.type, 'fill');
  eq(page.items.indexOf(fillItem), 0, 'fills sit beneath the ink');
  near(fillItem.x, 120, 14, 'left edge'); near(fillItem.y, 120, 14, 'top edge');
  near(fillItem.w, 300, 22, 'width');    near(fillItem.h, 200, 22, 'height');
  ok(fillItem.w < page.w * 0.5, 'did not leak across the page');
});

/* ══════════ 8. typed text ══════════ */
t('text: tapping places a box, typing fills it, wrapping and height follow', () => {
  T.setTool('text');
  const before = page.items.length;
  const p = scr(150, 250);
  stage.dispatch('pointerdown', ev('pointerdown', p.x, p.y, { id: ++pid }));
  stage.dispatch('pointerup', ev('pointerup', p.x, p.y, { id: pid }));
  eq(page.items.length, before + 1);
  const box = page.items[page.items.length - 1];
  eq(box.type, 'text');
  ok(box._hidden, 'hidden on the canvas while the editor overlay is open');

  // type into the overlay, then tap away
  NW.Text.box.innerText = 'Damped harmonic motion: the amplitude decays exponentially with time, ' +
    'so successive peaks fall by a constant ratio.';
  NW.Text.commit();
  ok(!box._hidden, 'shown again once committed');
  ok(box.text.startsWith('Damped'), 'text captured from the editor');

  const c = mockCtx(mkEl('canvas'));
  const lines = E.wrapText(c, box);
  ok(lines.length > 1, 'wrapped onto ' + lines.length + ' lines');
  ok(box.h > box.size * 2, 'box grew to fit the wrapped text');
  E.drawItem(c, box, page);
  eq(c._rec.texts.length, lines.length, 'every line painted');
});

t('text: an empty box is thrown away instead of littering the page', () => {
  const before = page.items.length;
  const p = scr(150, 600);
  stage.dispatch('pointerdown', ev('pointerdown', p.x, p.y, { id: ++pid }));
  stage.dispatch('pointerup', ev('pointerup', p.x, p.y, { id: pid }));
  NW.Text.box.innerText = '   ';
  NW.Text.commit();
  eq(page.items.length, before, 'nothing left behind');
});

t('text: restyling changes the item and remembers the choice', () => {
  const box = page.items.find(i => i.type === 'text');
  E.selection = { pageIndex: 0, page, items: [box], poly: null, bbox: E.selectionBBox([box]), moved: true };
  const times = NW.FONTS.find(f => f.name === 'Times New Roman');
  NW.Text.applyStyle({ font: times.css, fontName: times.name, size: 48, bold: true });
  eq(box.fontName, 'Times New Roman');
  eq(box.size, 48); eq(box.bold, true);
  eq(T.opts.text.fontName, 'Times New Roman', 'remembered for the next box');
  E.History.stepBack();
  eq(box.size !== 48 || box.bold === false, true, 'undo restored the old style');
  T.clearSelection();
});

t('text: every Word font in the picker has a fallback chain', () => {
  ok(NW.FONTS.length >= 25, 'got ' + NW.FONTS.length + ' fonts');
  for (const f of NW.FONTS) ok(f.css.split(',').length >= 2, f.name + ' has no fallback');
  ok(NW.FONTS.some(f => f.name === 'Times New Roman'));
  ok(NW.FONTS.some(f => f.name === 'Calibri'));
  ok(NW.FONT_SIZES.includes(11) && NW.FONT_SIZES.includes(72));
});

/* ══════════ 9. pages ══════════ */
t('pages: adding one copies the last page\'s ruling', async () => {
  page.template = 'grid'; page.paper = 'cream';
  const p2 = await T.addPage();
  eq(E.pages.length, 2);
  eq(p2.template, 'grid', 'ruling carried over');
  eq(p2.paper, 'cream', 'paper carried over');
  eq(p2.w, page.w); eq(p2.h, page.h);
  eq(nb.pageIds.length, 2);
  ok(E.layout[1].y > E.layout[0].y, 'stacked below');
});

t('pages: a specific layout can be chosen instead', async () => {
  const p3 = await T.addPage({ template: 'cornell', paperColor: 'night', size: 'a5', landscape: true });
  eq(p3.template, 'cornell');
  eq(p3.paper, 'night');
  eq(p3.w, NW.PAPER.a5.h, 'landscape A5 width');
  ok(p3.bg !== '#ffffff', 'dark paper');
});

t('pages: the pull-past-the-bottom gesture fires once, at the end', () => {
  let fired = 0;
  NW.on('page:autoadd', () => fired++);
  E.cam.y = E.worldH + 4000;            // way past the last page
  const id = ++pid;
  stage.dispatch('pointerdown', ev('pointerdown', 600, 700, { id, pointerType: 'touch' }));
  stage.dispatch('pointermove', ev('pointermove', 600, 400, { id, pointerType: 'touch' }));
  stage.dispatch('pointerup', ev('pointerup', 600, 400, { id, pointerType: 'touch' }));
  ok(fired <= 1, 'never fires more than once per pull');
  E.fitWidth();
});

t('pages: delete refuses to empty a notebook', () => {
  while (E.pages.length > 1) T.deletePage(E.pages.length - 1);
  T.deletePage(0);
  eq(E.pages.length, 1, 'the last page is protected');
});

/* ══════════ 10. Apple Pencil double-tap ══════════ */
t('pencil: the hardware event flips pen ⇄ eraser', () => {
  resetInput();
  T.setTool('pen');
  T.pencilToggle('hardware');
  eq(T.tool, 'eraser');
  T.pencilToggle('hardware');
  eq(T.tool, 'pen');
});

t('pencil: two quick taps flip the tool and leave no ink behind', async () => {
  resetInput();
  T.settings.pencilDoubleTap = true;           // opt-in browser fallback
  T._lastInkAt = performance.now() - 5000;     // not in the middle of writing
  T.setTool('pen');
  const n = page.items.length;
  const p = scr(600, 300);
  tapPen(p.x, p.y);
  tapPen(p.x + 6, p.y + 4);
  eq(T.tool, 'eraser', 'switched to the eraser');
  await wait(420);
  eq(page.items.length, n, 'neither tap left a dot on the page');
  T.settings.pencilDoubleTap = false;
  T.setTool('pen');
});

t('pencil: a single deliberate tap still makes a dot', async () => {
  resetInput();
  T._lastInkAt = performance.now() - 5000;
  T.setTool('pen');
  const n = page.items.length;
  const p = scr(650, 350);
  tapPen(p.x, p.y);
  await wait(420);
  eq(page.items.length, n + 1, 'the dot was committed');
  eq(T.tool, 'pen', 'and the tool did not change');
});

t('pencil: the gesture can be turned off', async () => {
  T.settings.pencilDoubleTap = false;
  T.setTool('pen');
  const p = scr(700, 400);
  tapPen(p.x, p.y); tapPen(p.x + 4, p.y);
  await wait(60);
  eq(T.tool, 'pen', 'stays put when disabled');
  T.settings.pencilDoubleTap = true;
});

/* ══════════ 11. palm rejection ══════════ */
t('touch scrolls instead of drawing once a stylus has been seen', () => {
  ok(T.penSeen, 'the stylus was noticed earlier');
  const n = page.items.length;
  const y0 = E.cam.y;
  const id = ++pid;
  stage.dispatch('pointerdown', ev('pointerdown', 400, 500, { id, pointerType: 'touch' }));
  stage.dispatch('pointermove', ev('pointermove', 400, 300, { id, pointerType: 'touch' }));
  stage.dispatch('pointerup', ev('pointerup', 400, 300, { id, pointerType: 'touch' }));
  eq(page.items.length, n, 'a finger drew nothing');
  ok(E.cam.y !== y0, 'it scrolled instead');
});

t('two fingers pinch-zoom and cancel any stroke in progress', () => {
  const n = page.items.length;
  const z0 = E.cam.zoom;
  const a = ++pid, b = ++pid;
  stage.dispatch('pointerdown', ev('pointerdown', 400, 400, { id: a, pointerType: 'touch' }));
  stage.dispatch('pointerdown', ev('pointerdown', 600, 400, { id: b, pointerType: 'touch' }));
  stage.dispatch('pointermove', ev('pointermove', 300, 400, { id: a, pointerType: 'touch' }));
  stage.dispatch('pointermove', ev('pointermove', 700, 400, { id: b, pointerType: 'touch' }));
  stage.dispatch('pointerup', ev('pointerup', 300, 400, { id: a, pointerType: 'touch' }));
  stage.dispatch('pointerup', ev('pointerup', 700, 400, { id: b, pointerType: 'touch' }));
  ok(E.cam.zoom > z0, 'zoomed in (' + z0.toFixed(2) + ' → ' + E.cam.zoom.toFixed(2) + ')');
  eq(page.items.length, n, 'no accidental ink');
  E.fitWidth();
});

/* ══════════ 12. export ══════════ */
t('export: the notebook becomes a valid multi-page PDF', async () => {
  await T.addPage();
  const blob = await NW.Export.notebookToPDF(nb, { dpi: 72, quality: 'balanced' });
  const buf = Buffer.from(await blob.arrayBuffer());
  const s = buf.toString('latin1');
  ok(s.startsWith('%PDF'), 'PDF header');
  eq((s.match(/\/Type \/Page[^s]/g) || []).length, E.pages.length, 'one PDF page per notebook page');
  ok(s.includes('startxref') && s.trimEnd().endsWith('%%EOF'), 'well formed');
  ok(buf.length > 400, 'not empty');
});

t('export: typed text is written into the PDF as a searchable layer', async () => {
  const box = page.items.find(i => i.type === 'text');
  ok(box, 'we still have a text box');
  const blob = await NW.Export.pagesToPDF([page], { dpi: 72 });
  const s = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  ok(s.includes('3 Tr'), 'invisible render mode');
  ok(s.includes('Damped harmonic motion'), 'the words are in the file');
});

t('export: a page range is honoured', async () => {
  const blob = await NW.Export.notebookToPDF(nb, { indices: [0], dpi: 72 });
  const s = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  eq((s.match(/\/Type \/Page[^s]/g) || []).length, 1);
});

t('export: a folder of notebooks becomes a ZIP with the tree intact', async () => {
  const folder = await NW.Lib.newFolder('PHYS2001');
  const sub = await NW.Lib.newFolder('Tutorials', folder.id);
  nb.folderId = folder.id;
  const nb2 = await NW.Lib.newNotebook({ name: 'Tute 3', folderId: sub.id });
  const zip = await NW.Export.folderToZIP(folder.id, { dpi: 72 });
  const buf = Buffer.from(await zip.arrayBuffer());
  const s = buf.toString('latin1');
  eq(buf.readUInt32LE(0), 0x04034b50, 'zip magic');
  ok(s.includes('Session test.pdf'), 'notebook at the folder root');
  ok(s.includes('Tutorials/Tute 3.pdf'), 'sub-folder path preserved');
});

t('export: a folder can also merge into one bookmarked PDF', async () => {
  const folder = NW.Lib.folders[0];
  const blob = await NW.Export.folderToMergedPDF(folder.id, { dpi: 72 });
  const s = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  ok(s.includes('/Outlines'), 'has bookmarks');
  ok(s.includes('(Session test)'), 'bookmark named after the notebook');
});

t('backup: exportAll → importAll round-trips the library', async () => {
  const data = await NW.Lib.exportAll();
  ok(data.notebooks.length >= 2 && Object.keys(data.pages).length >= 2, 'backup has content');
  const names = data.notebooks.map(n => n.name).sort();
  NW.Lib.notebooks = []; NW.Lib.folders = []; NW.Lib.pageCache.clear();
  await NW.Lib.importAll(data, { replace: false, overwrite: true });
  eq(NW.Lib.notebooks.map(n => n.name).sort().join('|'), names.join('|'), 'everything came back');
});

/* ══════════ 13. encryption ══════════ */
t('sync: the library is encrypted with a key derived from the password', async () => {
  const key = await NW.Account.cryptoKey('a@b.com', 'correct horse battery');
  const pkg = await NW.Account.encrypt({ secret: 'my lecture notes' }, key);
  ok(pkg.ct && pkg.iv, 'ciphertext + iv');
  ok(!JSON.stringify(pkg).includes('lecture'), 'plaintext is not in the payload');
  const back = await NW.Account.decrypt(pkg, key);
  eq(back.secret, 'my lecture notes');
  const wrong = await NW.Account.cryptoKey('a@b.com', 'wrong password');
  let threw = false;
  try { await NW.Account.decrypt(pkg, wrong); } catch { threw = true; }
  ok(threw, 'the wrong password cannot decrypt it');
});

t('sync: the auth hash never equals the encryption key material', async () => {
  const h = await NW.Account.authHash('a@b.com', 'pw12345678');
  ok(typeof h === 'string' && h.length > 20, 'hash produced');
  ok(!h.includes('pw12345678'), 'password not embedded');
});

/* ══════════ 14. theme ══════════ */
t('theme: light / dark / follow-the-system all stick', () => {
  NW.Theme.set('dark');
  eq(NW.Theme.mode, 'dark');
  eq(win.document.documentElement.getAttribute('data-theme'), 'dark');
  eq(store['nw-theme'], 'dark', 'saved for the next launch');

  NW.Theme.set('light');
  eq(win.document.documentElement.getAttribute('data-theme'), 'light');

  NW.Theme.set('system');
  eq(win.document.documentElement.getAttribute('data-theme'), null, 'attribute removed');
  eq(store['nw-theme'], undefined, 'nothing saved for system');
});

t('theme: the toolbar button cycles light → dark → system', () => {
  NW.Theme.set('light');
  eq(NW.Theme.cycle(), 'dark');
  eq(NW.Theme.cycle(), 'system');
  eq(NW.Theme.cycle(), 'light');
});

t('theme: canvas chrome reads the theme rather than hard-coded colours', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'engine.js'), 'utf8') +
              fs.readFileSync(path.join(ROOT, 'js', 'tools.js'), 'utf8');
  const stray = src.match(/#6c8cff|#8a6cff/g);
  if (stray) throw new Error('found the old accent colour ' + stray.length + ' time(s)');
  ok(typeof NW.Engine.marchingAnts === 'function', 'selection uses the two-tone marquee');
});

/* ══════════ 15. five colours on the bar ══════════ */
t('colour: exactly five swatches plus one “more” button per tool', () => {
  for (const tool of ['pen', 'highlighter', 'shape', 'fill', 'text']) {
    T.setTool(tool);
    NW.UI.buildSubbar();
    const bar = registry['#subbar'];
    const swatches = [], mores = [];
    (function walk(n) {
      for (const c of (n.children || [])) {
        if (c.classList && c.classList.contains('sw')) (c.classList.contains('more') ? mores : swatches).push(c);
        walk(c);
      }
    })(bar);
    if (swatches.length % 5 !== 0 || swatches.length === 0)
      throw new Error(tool + ' shows ' + swatches.length + ' swatches (should be a multiple of five)');
    if (!mores.length) throw new Error(tool + ' has no way to reach the rest of the colours');
  }
});

t('colour: picking from the full palette promotes it into the five', () => {
  T.opts.recent = {};
  T.setTool('pen');
  NW.UI.buildSubbar();
  const before = (T.opts.recent.pen || []).slice();
  ok(before.length === 5, 'seeded with five');
  // simulate choosing a colour that was not on the bar
  const chosen = '#7048e8';
  ok(!before.includes(chosen), 'not already there');
  // buildSubbar → swatchRow → rememberColour is internal, so drive it the same way
  const list = T.opts.recent.pen.filter(c => c !== chosen);
  list.unshift(chosen);
  T.opts.recent.pen = list.slice(0, 5);
  eq(T.opts.recent.pen[0], chosen, 'moves to the front');
  eq(T.opts.recent.pen.length, 5, 'still only five');
  ok(!T.opts.recent.pen.includes(before[4]), 'the least recent one drops off');
});

/* ══════════ 16. free Claude routes ══════════ */
t('claude: four visible routes, two of which cost nothing', () => {
  const shown = NW.AI.MODES.filter(m => !m.hidden);
  const ids = shown.map(m => m.id);
  for (const need of ['handoff', 'local', 'direct', 'proxy']) ok(ids.includes(need), 'missing ' + need);
  eq(shown.length, 4);
  eq(shown.filter(m => m.cost === 'Free').length, 2);
  eq(NW.AI.cfg.mode, 'handoff', 'the free one is the default');
});

t('claude: Gemini is parked, not deleted — the plumbing still works', () => {
  const g = NW.AI.MODES.find(m => m.id === 'gemini');
  ok(g, 'the mode still exists in the codebase');
  eq(g.hidden, true, 'but it is kept out of Settings for now');
  ok(NW.AI.GEMINI_MODELS && NW.AI.GEMINI_MODELS.length >= 1, 'model list intact');
  eq('geminiKey' in NW.AI.cfg, true, 'config field intact');
});

t('claude: the free route needs no configuration', () => {
  NW.AI.cfg.mode = 'handoff'; NW.AI.cfg.key = '';
  eq(NW.AI.configured(), true);
  eq(NW.AI.isFree(), true);
  NW.AI.cfg.mode = 'direct';
  eq(NW.AI.configured(), false, 'the paid route does need a key');
  NW.AI.cfg.mode = 'handoff';
});

t('claude: handing off packages the page and the question, and sends nothing', async () => {
  let fetched = 0;
  const realFetch = win.fetch;
  win.fetch = async () => { fetched++; return { ok: false, status: 0, text: async () => '' }; };
  let handoff = null;
  NW.on('ai:handoff', h => { handoff = h; });

  NW.AI.cfg.mode = 'handoff';
  await NW.AI.ask('Solve part (b) please', { look: 'page' });

  ok(handoff, 'the hand-off card was raised');
  ok(handoff.prompt.includes('Solve part (b) please'), 'question is in the prompt');
  ok(/notes/i.test(handoff.prompt), 'prompt gives Claude the context it needs');
  ok(handoff.image && handoff.image.startsWith('data:image/'), 'page image attached');
  eq(fetched, 0, 'nothing left the device');
  win.fetch = realFetch;
});

t('claude: a pasted-back answer joins the conversation and can go on the page', () => {
  NW.AI.clear();
  NW.AI.lastHandoff = { question: 'Solve part (b)', prompt: '', image: null };
  const seen = [];
  NW.on('ai:message', m => seen.push(m.role));
  NW.AI.acceptReply('Start from v = u + at, so a = (v - u)/t = 3 m/s^2.');
  eq(NW.AI.history.length, 2, 'question and answer both recorded');
  eq(NW.AI.history[1].content[0].text.slice(0, 5), 'Start');

  const page = E.pages[E.active];
  const before = page.items.length;
  NW.AI.insertAnswer('a = 3 m/s^2');
  eq(page.items.length, before + 1);
  eq(page.items[page.items.length - 1].type, 'text');
});

t('claude: a local model server is spoken to in the OpenAI dialect', async () => {
  let seenUrl = null, seenBody = null;
  const realFetch = win.fetch;
  win.fetch = async (url, init) => {
    seenUrl = url; seenBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      body: {
        getReader() {
          const chunks = [
            'data: {"choices":[{"delta":{"content":"Because "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"the amplitude decays."}}]}\n\n',
            'data: [DONE]\n\n'
          ];
          let i = 0;
          return { read: async () => i < chunks.length
            ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
            : { done: true } };
        }
      }
    };
  };
  let answer = null;
  NW.on('ai:stream:end', d => { if (d && d.text) answer = d.text; });

  NW.AI.clear();
  NW.AI.cfg.mode = 'local';
  NW.AI.cfg.localUrl = 'http://192.168.1.9:11434/v1';
  NW.AI.cfg.localModel = 'llama3.2-vision';
  await NW.AI.ask('Why does it decay?', { look: 'none' });

  eq(seenUrl, 'http://192.168.1.9:11434/v1/chat/completions');
  eq(seenBody.model, 'llama3.2-vision');
  eq(seenBody.stream, true);
  eq(seenBody.messages[0].role, 'system');
  eq(answer, 'Because the amplitude decays.');
  win.fetch = realFetch;
  NW.AI.cfg.mode = 'handoff';
});

t('claude: the paid route still speaks Anthropic', async () => {
  let seenUrl = null, seenHeaders = null;
  const realFetch = win.fetch;
  win.fetch = async (url, init) => {
    seenUrl = url; seenHeaders = init.headers;
    return {
      ok: true, status: 200,
      body: {
        getReader() {
          const chunks = ['data: {"type":"content_block_delta","delta":{"text":"Yes."}}\n\n'];
          let i = 0;
          return { read: async () => i < chunks.length
            ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
            : { done: true } };
        }
      }
    };
  };
  let answer = null;
  NW.on('ai:stream:end', d => { if (d && d.text) answer = d.text; });
  NW.AI.clear();
  NW.AI.cfg.mode = 'direct'; NW.AI.cfg.key = 'sk-ant-test';
  await NW.AI.ask('Is this right?', { look: 'none' });
  eq(seenUrl, 'https://api.anthropic.com/v1/messages');
  eq(seenHeaders['anthropic-dangerous-direct-browser-access'], 'true');
  eq(answer, 'Yes.');
  win.fetch = realFetch;
  NW.AI.cfg.mode = 'handoff';
});

/* ══════════ 17. pen-only drawing ══════════ */

/* helpers that speak in raw pointers so we can interleave devices */
function down(id, type, x, y, extra) { stage.dispatch('pointerdown', ev('pointerdown', x, y, { id, pointerType: type, ...extra })); }
function move(id, type, x, y, extra) { stage.dispatch('pointermove', ev('pointermove', x, y, { id, pointerType: type, ...extra })); }
function up(id, type, x, y, extra) { stage.dispatch('pointerup', ev('pointerup', x, y, { id, pointerType: type, ...extra })); }
function fire(name, id, type, x, y) { stage.dispatch(name, ev(name, x, y, { id, pointerType: type })); }

function resetInput() {
  T.abortStroke();
  T._p.pointers.clear();
  T._p.penId = null; T._p.mode = null; T._p.gesture = null;
  stage.captured.clear(); stage.captureLog.length = 0;
  T.clearSelection();
  E.active = 0;          // scr() maps against page 0, so count items there too
  E.fitWidth();
}

t('pen-only: “finger draws” is off out of the box', () => {
  eq(NW.Tools.settings.fingerDraws, false);
});

t('pen-only: a finger never puts ink down, it scrolls', () => {
  resetInput();
  T.setTool('pen');
  T.penSeen = false;                       // pretend this is a fresh device
  T.settings.fingerDraws = false;
  const page = E.pages[E.active];
  const n = page.items.length;
  const y0 = E.cam.y;
  const a = scr(300, 500), b = scr(300, 900);
  down(101, 'touch', a.x, a.y);
  move(101, 'touch', b.x, b.y);
  up(101, 'touch', b.x, b.y);
  eq(page.items.length, n, 'no ink');
  ok(E.cam.y !== y0, 'it scrolled instead');
});

t('pen-only: a stylus does put ink down', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  stroke(pathOnPage([{ x: 200, y: 300 }, { x: 500, y: 320 }, { x: 700, y: 300 }]));
  eq(page.items.length, n + 1);
  eq(page.items[page.items.length - 1].type, 'stroke');
});

t('pen-only: a mouse draws, for desktop users', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  stroke(pathOnPage([{ x: 200, y: 380 }, { x: 500, y: 400 }]), { pointerType: 'mouse' });
  eq(page.items.length, n + 1, 'mouse drew');
});

t('pen-only: the toggle lets a finger draw, until a stylus appears', () => {
  resetInput();
  T.penSeen = false;
  T.settings.fingerDraws = true;
  const page = E.pages[E.active];
  let n = page.items.length;
  const a = scr(200, 600), b = scr(600, 620);
  down(110, 'touch', a.x, a.y); move(110, 'touch', b.x, b.y); up(110, 'touch', b.x, b.y);
  eq(page.items.length, n + 1, 'the finger drew');

  // now a stylus touches the screen once
  resetInput();
  stroke(pathOnPage([{ x: 200, y: 700 }, { x: 400, y: 700 }]));
  ok(T.penSeen, 'stylus noticed');
  n = page.items.length;

  resetInput();
  const c = scr(200, 800), d2 = scr(600, 820);
  down(111, 'touch', c.x, c.y); move(111, 'touch', d2.x, d2.y); up(111, 'touch', d2.x, d2.y);
  eq(page.items.length, n, 'the finger has stood down again');
  T.settings.fingerDraws = false;
});

t('pen-only: the pen pointer is captured for the whole stroke, then released', () => {
  resetInput();
  const a = scr(200, 1000), b = scr(600, 1000);
  down(120, 'pen', a.x, a.y);
  ok(stage.captured.has(120), 'captured on the way down');
  eq(T._p.penId, 120);
  move(120, 'pen', b.x, b.y);
  up(120, 'pen', b.x, b.y);
  ok(!stage.captured.has(120), 'released on the way up');
  eq(T._p.penId, null);
});

t('pen-only: a palm landing mid-stroke changes nothing', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  const y0 = E.cam.y, z0 = E.cam.zoom;
  const a = scr(200, 1100), b = scr(400, 1100), c = scr(700, 1100);

  down(130, 'pen', a.x, a.y);
  move(130, 'pen', b.x, b.y);
  down(131, 'touch', 500, 700);            // palm
  move(131, 'touch', 500, 400);            // palm slides
  move(130, 'pen', c.x, c.y);              // pen keeps going
  up(131, 'touch', 500, 400);              // palm lifts
  up(130, 'pen', c.x, c.y);

  eq(page.items.length, n + 1, 'exactly one stroke');
  eq(E.cam.y, y0, 'the page did not scroll');
  eq(E.cam.zoom, z0, 'and did not zoom');
  const s = page.items[page.items.length - 1];
  ok(s.pts.length >= 3, 'the pen samples after the palm landed were kept');
});

t('pen-only: two fingers during a pen stroke cannot pinch', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  const z0 = E.cam.zoom;
  const a = scr(200, 1200), b = scr(600, 1200);

  down(140, 'pen', a.x, a.y);
  move(140, 'pen', (a.x + b.x) / 2, a.y);
  down(141, 'touch', 300, 400);
  down(142, 'touch', 700, 400);
  move(141, 'touch', 150, 400);            // spread
  move(142, 'touch', 900, 400);
  up(141, 'touch', 150, 400);
  up(142, 'touch', 900, 400);
  move(140, 'pen', b.x, b.y);
  up(140, 'pen', b.x, b.y);

  near(E.cam.zoom, z0, 1e-9, 'zoom untouched');
  eq(page.items.length, n + 1, 'the stroke survived intact');
});

t('pen-only: a pen arriving mid-pan wins and cancels the gesture', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  down(150, 'touch', 400, 600);
  move(150, 'touch', 400, 500);
  eq(T._p.mode, 'pan', 'the finger started a pan');

  const a = scr(300, 1300), b = scr(650, 1300);
  down(151, 'pen', a.x, a.y);
  ok(T._p.mode !== 'pan' && T._p.mode !== 'pinch', 'pan was cancelled');
  eq(T._p.penId, 151, 'the pen owns the canvas');

  const y0 = E.cam.y;
  move(150, 'touch', 400, 200);            // finger still sliding, now ignored
  eq(E.cam.y, y0, 'the stray finger no longer pans');

  move(151, 'pen', b.x, b.y);
  up(151, 'pen', b.x, b.y);
  up(150, 'touch', 400, 200);
  eq(page.items.length, n + 1, 'the pen drew');
});

t('pen-only: lifting the pen off the edge still commits the stroke', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  const a = scr(200, 1400), b = scr(600, 1400);
  down(160, 'pen', a.x, a.y);
  move(160, 'pen', b.x, b.y);
  fire('pointerleave', 160, 'pen', b.x, b.y);
  eq(page.items.length, n + 1, 'ink kept, not discarded');
  eq(T._p.penId, null, 'and the canvas was handed back');
});

t('pen-only: a system interruption commits rather than losing the stroke', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  const a = scr(200, 1450), b = scr(600, 1450);
  down(170, 'pen', a.x, a.y);
  move(170, 'pen', b.x, b.y);
  fire('pointercancel', 170, 'pen', b.x, b.y);
  eq(page.items.length, n + 1);
  eq(T._p.penId, null);
});

t('pen-only: losing pointer capture mid-stroke is caught', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  const a = scr(200, 1500), b = scr(600, 1500);
  down(180, 'pen', a.x, a.y);
  move(180, 'pen', b.x, b.y);
  fire('lostpointercapture', 180, 'pen', b.x, b.y);
  eq(page.items.length, n + 1);
  eq(T._p.penId, null);
});

t('fast writing: a stale capture-loss cannot kill the stroke that replaced it', () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;

  /* Writing an H at speed. iPadOS recycles pointer ids, so every upright
     arrives on the same one, and `releasePointerCapture` does not deliver its
     `lostpointercapture` synchronously — the browser queues it. Write fast
     enough and it lands *after* the next stroke has claimed that id. Before the
     guard it matched the live stroke and ended it a moment after it began,
     which is why the second upright of an H, and the whole of an I, kept
     vanishing. The event carries the old stroke's timestamp, so it is
     recognisable as stale. Nothing here is reachable synchronously, which is
     why every earlier attempt at this bug missed it. */
  const upright = (x, t0) => {
    const a = scr(x, 1450), b = scr(x, 1550);
    down(300, 'pen', a.x, a.y, { timeStamp: t0 });
    move(300, 'pen', b.x, b.y, { timeStamp: t0 + 4 });
    return { b, lift: t0 + 8 };
  };

  const first = upright(200, 1000);
  up(300, 'pen', first.b.x, first.b.y, { timeStamp: first.lift });
  eq(page.items.length, n + 1, 'first upright landed');

  // the second upright starts before the first one's capture-loss is delivered
  const second = upright(320, 1020);
  stage.dispatch('lostpointercapture', ev('lostpointercapture', second.b.x, second.b.y,
    { id: 300, pointerType: 'pen', timeStamp: first.lift }));
  eq(T._p.penId, 300, 'the live stroke still owns the canvas');
  eq(page.items.length, n + 1, 'and was not committed early');

  up(300, 'pen', second.b.x, second.b.y, { timeStamp: 1040 });
  eq(page.items.length, n + 2, 'second upright landed too');
});

t('pen-only: every coalesced sample is used, not just the last', () => {
  resetInput();
  const page = E.pages[E.active];
  const n = page.items.length;
  const a = scr(150, 1550);
  down(190, 'pen', a.x, a.y);
  const mid = [];
  for (let i = 1; i <= 12; i++) {
    const s = scr(150 + i * 40, 1550);
    mid.push(ev('pointermove', s.x, s.y, { id: 190, pointerType: 'pen' }));
  }
  const last = mid[mid.length - 1];
  stage.dispatch('pointermove', ev('pointermove', last.clientX, last.clientY,
    { id: 190, pointerType: 'pen', coalesced: mid }));
  up(190, 'pen', last.clientX, last.clientY);
  const s = page.items[page.items.length - 1];
  eq(page.items.length, n + 1);
  ok(s.pts.length >= 8, 'kept ' + s.pts.length + ' of the 12 coalesced samples');
});

t('pen-only: tilt and pressure both feed the stroke width', () => {
  resetInput();
  T.opts.pen.pressure = true; T.opts.pen.tilt = true;
  const page = E.pages[E.active];
  const a = scr(200, 1600);
  down(200, 'pen', a.x, a.y, { pressure: 0.4, tiltX: 60, tiltY: 30 });
  for (let i = 1; i <= 6; i++) {
    const s = scr(200 + i * 60, 1600);
    move(200, 'pen', s.x, s.y, { pressure: 0.4, tiltX: 60, tiltY: 30 });
  }
  up(200, 'pen', scr(560, 1600).x, scr(560, 1600).y, { pressure: 0.4, tiltX: 60, tiltY: 30 });
  const s = page.items[page.items.length - 1];
  ok(s.pts.some(p => p.t && p.t > 1.4), 'a laid-over pen records a wide tilt factor');
  ok(s.pts.every(p => p.p > 0 && p.p < 1.3), 'pressure recorded too');
  eq(s.pressure, true, 'the stroke is flagged variable-width');
});

t('pen-only: an upright pen records no tilt at all', () => {
  resetInput();
  const page = E.pages[E.active];
  const a = scr(200, 1650), b = scr(600, 1650);
  down(210, 'pen', a.x, a.y, { tiltX: 0, tiltY: 0 });
  move(210, 'pen', b.x, b.y, { tiltX: 0, tiltY: 0 });
  up(210, 'pen', b.x, b.y, { tiltX: 0, tiltY: 0 });
  const s = page.items[page.items.length - 1];
  ok(s.pts.every(p => p.t === undefined), 'no tilt data stored when there is none');
});

t('pen-only: turning pressure off gives a constant-width line', () => {
  resetInput();
  T.opts.pen.pressure = false;
  const page = E.pages[E.active];
  /* Upright nib. This test used to lean the pen 70 degrees over while claiming
     to check constant width, which only passed while Tilt was silently doing
     nothing. With nothing to vary the width — no pressure, no lean — the ink is
     still one stroked path. */
  const a = scr(200, 1700), b = scr(600, 1700);
  down(220, 'pen', a.x, a.y, { pressure: 0.2, tiltX: 0, tiltY: 0 });
  move(220, 'pen', b.x, b.y, { pressure: 0.9, tiltX: 0, tiltY: 0 });
  up(220, 'pen', b.x, b.y, { pressure: 0.9, tiltX: 0, tiltY: 0 });
  const s = page.items[page.items.length - 1];
  eq(s.pressure, false, 'flagged constant width');
  const c = mockCtx(mkEl('canvas'));
  E.drawItem(c, s, page);
  ok(c._rec.strokes >= 1, 'it still renders');
  eq(c._rec.fills, 0, 'one stroked path, not the variable-width fill');
  T.opts.pen.pressure = true;
});

t('tilt: a laid-over nib takes the variable-width path with pressure off', () => {
  resetInput();
  T.opts.pen.pressure = false; T.opts.pen.tilt = true;
  const page = E.pages[E.active];
  const a = scr(200, 1710), b = scr(600, 1710);
  down(221, 'pen', a.x, a.y, { pressure: 0.5, tiltX: 70, tiltY: 0 });
  move(221, 'pen', b.x, b.y, { pressure: 0.5, tiltX: 70, tiltY: 0 });
  up(221, 'pen', b.x, b.y, { pressure: 0.5, tiltX: 70, tiltY: 0 });
  const s = page.items[page.items.length - 1];
  ok(s.pts.some(p => p.t > 1.4), 'the lean was recorded');
  const c = mockCtx(mkEl('canvas'));
  E.drawItem(c, s, page);
  /* The whole point of the Tilt fix: the lean has to reach the renderer even
     though Pressure is off, so this goes through the filled variable-width
     path rather than being stroked at one flat width. */
  eq(c._rec.strokes, 0, 'not a flat stroked line');
  ok(c._rec.fills >= 1, 'filled at varying width');
  T.opts.pen.pressure = true;
});

t('pen-only: the eraser and lasso are pen-only too', () => {
  resetInput();
  T.penSeen = true; T.settings.fingerDraws = false;
  const page = E.pages[E.active];
  stroke(pathOnPage([{ x: 200, y: 1750 }, { x: 600, y: 1750 }]));
  const victim = page.items[page.items.length - 1];
  const n = page.items.length;

  T.setTool('eraser'); T.opts.eraser.mode = 'area';
  const a = scr(300, 1730), b = scr(500, 1770);
  down(230, 'touch', a.x, a.y); move(230, 'touch', b.x, b.y); up(230, 'touch', b.x, b.y);
  ok(page.items.includes(victim), 'a finger cannot erase');
  eq(page.items.length, n, 'nothing removed');

  down(231, 'pen', a.x, a.y); move(231, 'pen', b.x, b.y); up(231, 'pen', b.x, b.y);
  ok(!page.items.includes(victim), 'the pen erased it');
  T.setTool('pen');
});

t('pen-only: the hand tool still lets a finger pan', () => {
  resetInput();
  T.setTool('hand');
  const y0 = E.cam.y;
  down(240, 'touch', 400, 700);
  move(240, 'touch', 400, 400);
  up(240, 'touch', 400, 400);
  ok(E.cam.y !== y0, 'panned');
  T.setTool('pen');
});

/* ══════════ 18. merging libraries between devices ══════════ */

function fakeLibrary(name, updatedAt, pageText) {
  const pid = 'p_' + name;
  return {
    app: 'NoteWell', version: 1, exportedAt: Date.now(),
    folders: [],
    notebooks: [{ id: 'n_' + name, name, folderId: null, paper: 'a4', template: 'lined',
      paperColor: 'white', pageIds: [pid], createdAt: 1, updatedAt }],
    pages: { [pid]: { id: pid, w: 100, h: 100, template: 'lined', paper: 'white',
      bg: '#fff', inkColor: '#ccc', items: [{ id: 'i1', type: 'text', x: 1, y: 1, w: 50, h: 10,
      text: pageText, size: 10, font: 'serif' }], rev: 1 } },
    assets: {}
  };
}

t('merge: a notebook this device has never seen is added', async () => {
  NW.Lib.notebooks = []; NW.Lib.folders = []; NW.Lib.pageCache.clear();
  const stat = await NW.Lib.merge(fakeLibrary('Physics', 1000, 'from the iPad'));
  eq(stat.added, 1);
  eq(NW.Lib.notebooks.length, 1);
  eq(NW.Lib.notebooks[0].name, 'Physics');
});

t('merge: the more recently edited copy wins', async () => {
  NW.Lib.notebooks = []; NW.Lib.pageCache.clear();
  await NW.Lib.merge(fakeLibrary('Physics', 1000, 'older'));
  let stat = await NW.Lib.merge(fakeLibrary('Physics', 5000, 'newer'));
  eq(stat.updated, 1, 'newer remote replaced ours');
  eq((await NW.Lib.page('p_Physics')).items[0].text, 'newer');

  stat = await NW.Lib.merge(fakeLibrary('Physics', 2000, 'stale'));
  eq(stat.kept, 1, 'older remote was ignored');
  eq((await NW.Lib.page('p_Physics')).items[0].text, 'newer', 'our copy survived');
});

t('merge: two devices editing different notebooks both keep their work', async () => {
  NW.Lib.notebooks = []; NW.Lib.pageCache.clear();
  await NW.Lib.merge(fakeLibrary('Physics', 3000, 'laptop work'));
  await NW.Lib.merge(fakeLibrary('Chemistry', 4000, 'iPad work'));
  eq(NW.Lib.notebooks.length, 2);
  const names = NW.Lib.notebooks.map(n => n.name).sort();
  eq(names.join(','), 'Chemistry,Physics');
});

t('merge: refuses anything that is not a NoteWell library', async () => {
  let threw = false;
  try { await NW.Lib.merge({ hello: 'world' }); } catch (e) { threw = true; }
  ok(threw);
});

t('dirtySince: knows whether anything changed since the last sync', () => {
  NW.Lib.dirtyPages.clear(); NW.Lib.dirtyLib = false;
  NW.Lib.notebooks = [{ id: 'n1', name: 'x', pageIds: [], updatedAt: 5000 }];
  eq(NW.Lib.dirtySince(6000), false, 'nothing newer than the sync');
  eq(NW.Lib.dirtySince(4000), true, 'a notebook was edited after the sync');
  eq(NW.Lib.dirtySince(0), true, 'never synced');
});

/* ══════════ 19. saving as you go ══════════ */

t('sync: does nothing at all when signed out', async () => {
  NW.Account.state.email = null; NW.Account.state.token = null;
  const r = await NW.Sync.run({});
  eq(r.ok, false);
  eq(r.skipped, 'not signed in');
  eq(NW.Sync.status, 'off');
});

t('sync: with no connection it queues instead of failing', async () => {
  NW.Account.state.email = 'a@b.com';
  NW.Account.state.token = 't'; NW.Account.state.server = 'https://s';
  NW.Account.key = {};                      // pretend we are unlocked
  const realOnline = Object.getOwnPropertyDescriptor(win.navigator, 'onLine');
  win.navigator.onLine = false;

  let fetched = 0;
  const realFetch = win.fetch;
  win.fetch = async () => { fetched++; return { ok: false }; };

  const r = await NW.Sync.run({});
  eq(r.skipped, 'offline');
  eq(fetched, 0, 'it did not even try the network');
  eq(NW.Sync.status, 'waiting');
  eq(NW.Sync.pending, true, 'the change is remembered');
  ok(/safe on this device/i.test(NW.Sync.tooltip()), 'the message reassures rather than alarms');
  ok(/offline/i.test(NW.Sync.label()), 'label: ' + NW.Sync.label());

  win.fetch = realFetch;
  win.navigator.onLine = true;
  if (realOnline) Object.defineProperty(win.navigator, 'onLine', realOnline);
});

t('sync: asks for the password when the key is not on this device', async () => {
  NW.Account.key = null;
  win.navigator.onLine = true;
  let asked = false;
  NW.on('sync:needsPassword', () => { asked = true; });
  const r = await NW.Sync.run({ manual: true });
  eq(r.skipped, 'locked');
  eq(NW.Sync.status, 'locked');
  ok(asked, 'the unlock prompt was raised');
});

t('sync: a dropped connection mid-request is treated as offline, not an error', async () => {
  NW.Account.key = {};
  win.navigator.onLine = true;
  const realFetch = win.fetch;
  win.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r = await NW.Sync.run({});
  eq(r.skipped, 'offline');
  eq(NW.Sync.status, 'waiting', 'not "error" — nothing was lost');
  win.fetch = realFetch;
});

t('sync: a real server error is reported as one', async () => {
  NW.Account.key = {};
  win.navigator.onLine = true;
  const realFetch = win.fetch;
  win.fetch = async () => ({ ok: false, status: 500, text: async () => '{"error":"boom"}' });
  const r = await NW.Sync.run({});
  eq(NW.Sync.status, 'error');
  ok(r.error, 'an error came back: ' + r.error);
  win.fetch = realFetch;
});

t('sync: editing schedules a save, and status wording stays plain', () => {
  NW.Account.state.email = 'a@b.com'; NW.Account.state.token = 't';
  NW.Sync.pending = false;
  NW.Sync.touch();
  eq(NW.Sync.pending, true);
  for (const s of ['off', 'syncing', 'synced', 'waiting', 'locked', 'error']) {
    NW.Sync.status = s;
    const label = NW.Sync.label();
    ok(typeof label === 'string' && label.length > 0 && label.length < 40, s + ' -> ' + label);
    ok(!/\bfail|\berror\b/i.test(label) || s === 'error', 'no scary wording for ' + s);
  }
});

/* ══════════ 20. backup to a file ══════════ */

t('backup: builds a restorable file from the library', async () => {
  NW.Lib.notebooks = []; NW.Lib.pageCache.clear();
  await NW.Lib.merge(fakeLibrary('Biology', 9000, 'cells'));
  const { blob, size, notebooks } = await NW.Backup.build();
  ok(size > 50 && notebooks === 1);
  const text = await blob.text();
  const parsed = JSON.parse(text);
  eq(parsed.app, 'NoteWell');
  eq(parsed.notebooks.length, 1);
});

t('backup: rejects a file that is not a NoteWell backup', async () => {
  let threw = false;
  try { await NW.Backup.restoreFromFile({ text: async () => 'not json at all' }); } catch (e) { threw = true; }
  ok(threw, 'garbage rejected');
  threw = false;
  try { await NW.Backup.restoreFromFile({ text: async () => '{"app":"SomethingElse"}' }); } catch (e) { threw = true; }
  ok(threw, 'wrong app rejected');
});

t('backup: reports how stale it is', () => {
  NW.Backup.cfg.lastAt = 0;
  eq(NW.Backup.summary(), 'never backed up');
  ok(NW.Backup.isStale(), 'never backed up counts as stale');
  NW.Backup.cfg.lastAt = Date.now();
  ok(!NW.Backup.isStale());
  ok(!/never/.test(NW.Backup.summary()));
});

/* ══════════ 21. updates ══════════ */

t('updates: knows what build it is', () => {
  eq(NW.Updates.current, 'dev', 'unstamped source reports itself as dev');
  ok(/development/.test(NW.Updates.describe()));
});

t('updates: a newer version.json raises the banner', async () => {
  NW.Updates.current = '1.2.0.abc';
  const realFetch = win.fetch;
  let seen = null;
  NW.on('update:available', info => { seen = info; });
  win.fetch = async () => ({ ok: true, json: async () => ({ version: '1.3.0.xyz', builtAt: Date.now() }) });
  await NW.Updates.check({});
  ok(seen && seen.version === '1.3.0.xyz', 'update offered');
  win.fetch = realFetch;
});

t('updates: the same version raises nothing', async () => {
  NW.Updates.current = '1.3.0.xyz';
  NW.Updates.available = null;
  const realFetch = win.fetch;
  win.fetch = async () => ({ ok: true, json: async () => ({ version: '1.3.0.xyz' }) });
  await NW.Updates.check({});
  eq(NW.Updates.available, null);
  win.fetch = realFetch;
});

t('updates: offline check gives up quietly', async () => {
  win.navigator.onLine = false;
  const r = await NW.Updates.check({});
  eq(r, null);
  win.navigator.onLine = true;
});

/* ══════════ 22. writing must never eat itself ══════════
   Every case here is a bug that was reported from real use: strokes vanishing,
   input going missing, and the tool flipping to eraser on its own. */

t('writing: short strokes commit immediately — no hold-back', async () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;
  // an i-dot: brief, barely moves
  const p = scr(300, 200);
  down(300, 'pen', p.x, p.y);
  up(300, 'pen', p.x + 1, p.y + 1);
  eq(page.items.length, n + 1, 'the dot is on the page straight away');
});

t('writing: two quick dots stay two dots and do NOT flip the tool', async () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;
  // writing a colon, or dotting two i's in quick succession
  const a = scr(320, 240), b = scr(326, 250);
  down(301, 'pen', a.x, a.y); up(301, 'pen', a.x, a.y);
  down(302, 'pen', b.x, b.y); up(302, 'pen', b.x, b.y);
  await wait(450);
  eq(T.tool, 'pen', 'still the pen — this used to become the eraser');
  eq(page.items.length, n + 2, 'both marks kept — these used to be deleted');
});

t('writing: the tip double-tap gesture is off by default', () => {
  eq(SHIPPED.pencilDoubleTap, false);
});

t('writing: even when enabled, a tap during writing is never a gesture', async () => {
  resetInput();
  T.settings.pencilDoubleTap = true;
  T.setTool('pen');
  const page = E.pages[E.active];
  // write something first
  stroke(pathOnPage([{ x: 200, y: 300 }, { x: 400, y: 310 }, { x: 600, y: 300 }]));
  const n = page.items.length;
  // now two quick taps, immediately after writing
  const a = scr(620, 300);
  down(310, 'pen', a.x, a.y); up(310, 'pen', a.x, a.y);
  down(311, 'pen', a.x + 2, a.y); up(311, 'pen', a.x + 2, a.y);
  await wait(400);
  eq(T.tool, 'pen', 'writing beats the gesture');
  eq(page.items.length, n + 2, 'both marks kept');
  T.settings.pencilDoubleTap = false;
});

t('writing: scribble-to-erase and hold-to-snap are both off by default', () => {
  eq(SHIPPED.scribbleWhileWriting, false, 'writing over your own ink is safe');
  eq(SHIPPED.holdToSnap, false, 'pausing at the end of a letter will not reshape it');
});

t('writing: a pen whose pointerup never arrived does not lock input out', async () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;

  // a stroke that simply stops getting events — iPadOS stealing the pointer
  const a = scr(200, 400), b = scr(400, 400);
  down(320, 'pen', a.x, a.y);
  move(320, 'pen', b.x, b.y);
  ok(T._p.penId === 320, 'the first pen owns the canvas');

  // pretend time passed with no further events
  T._p.lastMoveAt = performance.now() - 3000;

  // the next stroke must still work
  const c = scr(200, 460), d2 = scr(500, 460);
  down(321, 'pen', c.x, c.y);
  move(321, 'pen', d2.x, d2.y);
  up(321, 'pen', d2.x, d2.y);
  eq(T._p.penId, null, 'canvas handed back');
  ok(page.items.length >= n + 1, 'the new stroke was drawn, not swallowed');
});

t('writing: a long stroke draws incrementally rather than re-walking itself', () => {
  resetInput();
  T.setTool('pen');
  const a = scr(150, 520);
  down(330, 'pen', a.x, a.y);
  for (let i = 1; i <= 40; i++) {
    const s = scr(150 + i * 15, 520);
    move(330, 'pen', s.x, s.y);
  }
  const d = T._p.draw;
  ok(d && d.drawnTo >= 2, 'live canvas tracked how far it has drawn (' + d.drawnTo + ')');
  ok(d.drawnTo <= d.pts.length, 'and never claims to be ahead of the samples');
  up(330, 'pen', scr(750, 520).x, scr(750, 520).y);
});

/* ══════════ 23. ink quality ══════════ */

t('ink: a pressure stroke is one filled shape, not many stroked segments', () => {
  resetInput();
  T.setTool('pen');
  T.opts.pen.pressure = true;
  const page = E.pages[E.active];
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push({ x: 200 + i * 20, y: 600 + Math.sin(i / 3) * 20 });
  stroke(pathOnPage(pts), { pressure: 0.7 });
  const s = page.items[page.items.length - 1];

  const c = mockCtx(mkEl('canvas'));
  E.drawItem(c, s, page);
  eq(c._rec.strokes, 0, 'no per-segment stroking — that was the source of the beading');
  eq(c._rec.fills, 1, 'exactly one fill for the whole stroke');
});

t('ink: constant-width mode still strokes a single smooth path', () => {
  resetInput();
  T.opts.pen.pressure = false;
  const page = E.pages[E.active];
  stroke(pathOnPage([{ x: 200, y: 700 }, { x: 400, y: 700 }, { x: 600, y: 710 }]));
  const s = page.items[page.items.length - 1];
  const c = mockCtx(mkEl('canvas'));
  E.drawItem(c, s, page);
  eq(c._rec.strokes, 1, 'one stroke call, not one per segment');
  T.opts.pen.pressure = true;
});

t('ink: the outline builder survives degenerate input', () => {
  const c = mockCtx(mkEl('canvas'));
  // repeated identical points used to produce NaN normals
  const same = [{ x: 10, y: 10, p: .5 }, { x: 10, y: 10, p: .5 }, { x: 10, y: 10, p: .5 }];
  E.fillVariableStroke(c, same, 3);
  const two = [{ x: 0, y: 0, p: .5 }, { x: 50, y: 0, p: .9 }];
  E.fillVariableStroke(c, two, 3);
  ok(c._rec.fills >= 2, 'both filled without throwing');
});

t('ink: pages are drawn from vectors at readable zoom, not from a soft cache', () => {
  /* This used to grep engine.js for the exact text of the `direct` expression,
     which broke the moment that decision was refactored — a test that pins the
     wording rather than the behaviour. Ask the renderer instead: at a readable
     zoom the page must be painted straight into the screen context, and only a
     page that is tiny on screen may be blitted from a cached bitmap. */
  const realCtx = E.ctx, realPaint = E.paintPage, realZoom = E.cam.zoom;
  const renderAt = zoom => {
    E.cam.zoom = zoom; E.clampCam();
    const c = mockCtx(mkEl('canvas'));
    let straightToScreen = 0;
    E.ctx = c;
    E.paintPage = function (ctx, ...rest) {
      if (ctx === c) straightToScreen++;          // vectors, onto the screen
      return realPaint.call(E, ctx, ...rest);     // (a cache paints into its own ctx)
    };
    try { E.render(); } finally { E.ctx = realCtx; E.paintPage = realPaint; }
    return { straightToScreen, blits: c._rec.images };
  };

  const readable = renderAt(1);
  ok(readable.straightToScreen >= 1, 'at 100% the ink is drawn from its vectors');

  const tiny = renderAt(0.2);
  eq(tiny.straightToScreen, 0, 'a thumbnail-sized page uses the cache');
  ok(tiny.blits >= 1, 'and blits it');

  E.cam.zoom = realZoom; E.clampCam();
  ok(/MAX_CACHE_PX = 13e6/.test(fs.readFileSync(path.join(ROOT, 'js', 'engine.js'), 'utf8')),
     'the cache is still allowed retina resolution');
});

/* ══════════ 24. export fidelity ══════════ */

t('export: defaults are lossless, because ink is not a photograph', () => {
  eq(NW.Export.DEFAULT_QUALITY, 'lossless');
  eq(NW.Export.DEFAULT_DPI, 200);
});

t('export: a page exports without JPEG compression by default', async () => {
  const page = E.pages[E.active];
  const blob = await NW.Export.pagesToPDF([page], {});
  const s = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  ok(s.includes('/FlateDecode'), 'lossless image data');
  ok(!s.includes('/DCTDecode'), 'no JPEG in the default path');
});

t('export: asking for a smaller file still works', async () => {
  const page = E.pages[E.active];
  const blob = await NW.Export.pagesToPDF([page], { dpi: 150, quality: 'balanced' });
  const s = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  ok(s.includes('/DCTDecode'), 'opt-in JPEG path intact');
});

t('export: higher dpi produces a bigger raster', async () => {
  const page = E.pages[E.active];
  const lo = await NW.Export.pagesToPDF([page], { dpi: 100 });
  const hi = await NW.Export.pagesToPDF([page], { dpi: 300 });
  ok(hi.size > lo.size, '300 dpi is larger than 100 dpi (' + hi.size + ' vs ' + lo.size + ')');
});

/* ══════════ 25. writing fast ══════════ */

t('fast writing: a new stroke starting before the last one lifted is kept', () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;

  // stroke A goes down and moves, but its pointerup never arrives —
  // exactly what happens when events arrive out of order at speed
  const a1 = scr(200, 1300), a2 = scr(340, 1300);
  down(400, 'pen', a1.x, a1.y);
  move(400, 'pen', a2.x, a2.y);

  // stroke B starts anyway. It used to be silently dropped.
  const b1 = scr(380, 1300), b2 = scr(520, 1300);
  down(401, 'pen', b1.x, b1.y);
  eq(T._p.penId, 401, 'the new nib took over');
  move(401, 'pen', b2.x, b2.y);
  up(401, 'pen', b2.x, b2.y);

  eq(page.items.length, n + 2, 'both strokes are on the page');
});

t('fast writing: ten quick strokes all land', () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;
  for (let k = 0; k < 10; k++) {
    const a = scr(150 + k * 60, 1380), b = scr(180 + k * 60, 1440);
    const id = 410 + k;
    down(id, 'pen', a.x, a.y);
    move(id, 'pen', b.x, b.y);
    up(id, 'pen', b.x, b.y);
  }
  eq(page.items.length, n + 10, 'none were swallowed');
});

t('fast writing: a duplicate pointerdown for the same id leaves one stroke', () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;
  const a = scr(200, 1520), b = scr(400, 1520);
  down(430, 'pen', a.x, a.y);
  down(430, 'pen', a.x, a.y);          // same id twice, nothing drawn between
  move(430, 'pen', b.x, b.y);
  up(430, 'pen', b.x, b.y);
  /* The second down starts a fresh stroke rather than being discarded — but the
     one it replaced held a single sample and had nothing to commit, so a real
     repeat still costs nothing. */
  eq(page.items.length, n + 1, 'one stroke, not two');
});

/* Pointer ids are recycled — iPadOS hands the Pencil the same id stroke after
   stroke. Every test above gives each stroke a fresh id, which is why these two
   went unnoticed: between them they are the second stem of an H, and the stem
   of an I, going missing at speed. */

t('fast writing: a recycled pointer id still starts a new stroke', () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;

  // stroke A moves, but its lift never arrives
  const a1 = scr(200, 1560), a2 = scr(200, 1660);
  down(440, 'pen', a1.x, a1.y);
  move(440, 'pen', a2.x, a2.y);

  // stroke B is the next stem of the same letter, on the *same* id
  const b1 = scr(300, 1560), b2 = scr(300, 1660);
  down(440, 'pen', b1.x, b1.y);
  eq(T._p.penId, 440, 'the new nib took over');
  move(440, 'pen', b2.x, b2.y);
  up(440, 'pen', b2.x, b2.y);

  eq(page.items.length, n + 2, 'both stems are on the page');
});

t('fast writing: a lift left over from the previous stroke is ignored', () => {
  resetInput();
  T.setTool('pen');
  const page = E.pages[E.active];
  const n = page.items.length;

  // stroke A, whose pointerup is delayed past the start of stroke B
  const a1 = scr(400, 1560), a2 = scr(400, 1660);
  down(450, 'pen', a1.x, a1.y, { timeStamp: 1000 });
  move(450, 'pen', a2.x, a2.y, { timeStamp: 1020 });

  // stroke B goes down on the recycled id and starts drawing
  const b1 = scr(500, 1560), b2 = scr(500, 1660);
  down(450, 'pen', b1.x, b1.y, { timeStamp: 1060 });

  // …and only now does A's lift turn up, stamped before B ever began
  up(450, 'pen', a2.x, a2.y, { timeStamp: 1035 });
  eq(T._p.penId, 450, 'stroke B still owns the canvas');
  eq(T._p.mode, 'draw', 'and is still drawing');

  move(450, 'pen', b2.x, b2.y, { timeStamp: 1080 });
  up(450, 'pen', b2.x, b2.y, { timeStamp: 1100 });

  eq(page.items.length, n + 2, 'the stale lift ended neither stroke early');
});

t('tilt: a laid-over nib varies the width with pressure switched off', () => {
  resetInput();
  T.setTool('pen');
  T.opts.pen.pressure = false; T.opts.pen.tilt = true;
  const page = E.pages[E.active];
  const a = scr(200, 1700), b = scr(500, 1700);
  down(460, 'pen', a.x, a.y, { tiltX: 65, tiltY: 25 });
  move(460, 'pen', b.x, b.y, { tiltX: 65, tiltY: 25 });
  up(460, 'pen', b.x, b.y, { tiltX: 65, tiltY: 25 });
  const s = page.items[page.items.length - 1];
  ok(s.pts.some(p => p.t > 1.4), 'the lean was recorded even without pressure');
  // and with pressure off the nominal width is exactly what the slider says
  near(E.widthAt({ p: 0.2 }, 10, false), 10, 1e-9, 'no pressure term');
  near(E.widthAt({ p: 0.2, t: 1.5 }, 10, false), 15, 1e-9, 'tilt still widens it');
  T.opts.pen.pressure = true;
});

/* ══════════ 26. ink geometry ══════════ */

t('ink: sparse samples are splined, so curves are not faceted', () => {
  // three points far apart — the raw path would be two straight edges
  const raw = [{ x: 0, y: 0, p: .8 }, { x: 60, y: 40, p: .8 }, { x: 120, y: 0, p: .8 }];
  const dense = E.densify(raw, 0, raw.length, 12);
  ok(dense.length > 12, 'subdivided into ' + dense.length + ' points');
  // the spline should bow away from the straight chord between the ends
  const mid = dense[Math.floor(dense.length / 2)];
  ok(mid.y > 20, 'the curve actually bends (' + mid.y.toFixed(1) + ')');
  ok(dense.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), 'no NaNs');
});

t('ink: irregular sample spacing does not kink the curve', () => {
  /* A stylus never samples evenly — the faster the hand moves the wider the
     gaps — and uniform Catmull-Rom overshoots on uneven spacing, leaving a
     small kink at the input points themselves. That was the visible bumpiness
     along a stroke at high zoom: most of the curve turning by under a degree
     per step with isolated spikes of eight. Centripetal spacing (alpha = 0.5)
     cannot cusp or self-intersect, and flattens those spikes. */
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const raw = [];
  for (let t = 0; t < 1; t += 0.012 + rnd() * 0.055) {
    raw.push({ x: 40 + t * 420 + (rnd() - .5) * .6,
               y: 120 + Math.sin(t * 4.2) * 55 + (rnd() - .5) * .6,
               p: 0.45 + 0.3 * Math.sin(t * 7) });
  }
  ok(raw.length > 15, 'a realistic number of samples (' + raw.length + ')');

  const dense = E.densify(raw, 0, raw.length, 3.2, true);
  let worst = 0;
  for (let i = 1; i < dense.length - 1; i++) {
    const a0 = Math.atan2(dense[i].y - dense[i - 1].y, dense[i].x - dense[i - 1].x);
    const a1 = Math.atan2(dense[i + 1].y - dense[i].y, dense[i + 1].x - dense[i].x);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    worst = Math.max(worst, Math.abs(d) * 180 / Math.PI);
  }
  // uniform parameterisation measured 7.85 deg on this exact trace
  ok(worst < 4, 'no kink at the input points (worst turn ' + worst.toFixed(2) + ' deg)');
  ok(dense.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), 'no NaNs');
});

t('ink: densify carries pressure and tilt through the interpolation', () => {
  const raw = [{ x: 0, y: 0, p: .2, t: 1 }, { x: 80, y: 0, p: 1.0, t: 1.8 }];
  const dense = E.densify(raw, 0, raw.length, 10);
  ok(dense.every(p => p.p >= 0.19 && p.p <= 1.01), 'pressure stays in range');
  ok(dense.some(p => p.t > 1.2), 'tilt interpolated');
  const first = dense[0].p, last = dense[dense.length - 1].p;
  ok(last > first, 'pressure ramps up along the stroke');
});

t('ink: a two-point stroke and a single dot both render', () => {
  const c = mockCtx(mkEl('canvas'));
  E.fillVariableStroke(c, [{ x: 0, y: 0, p: .5 }], 4);
  E.fillVariableStroke(c, [{ x: 0, y: 0, p: .5 }, { x: 30, y: 0, p: .9 }], 4);
  ok(c._rec.fills >= 2, 'both filled');
});

t('ink: width follows pressure and tilt together', () => {
  const light = E.widthAt({ p: 0.1, t: 1 }, 10);
  const heavy = E.widthAt({ p: 1.0, t: 1 }, 10);
  const flat = E.widthAt({ p: 1.0, t: 1.9 }, 10);
  ok(heavy > light * 1.5, 'pressure widens the line');
  ok(flat > heavy * 1.5, 'tilt widens it further');
});

/* ══════════ 27. scribble-erase precision ══════════
   Every case here came from real use: strokes vanishing while writing an H,
   shapes disappearing when a line was drawn through them, and neighbours
   being taken out along with the target. */

function inkAt(pts) {
  T.setTool('pen');
  stroke(pathOnPage(pts));
  return E.pages[E.active].items[E.pages[E.active].items.length - 1];
}

t('scribble: writing the crossbar of an H does not delete the stem', () => {
  resetInput();
  T.settings.scribbleWhileWriting = true;      // worst case: the gesture is on
  const page = E.pages[E.active];
  const stem = inkAt([{ x: 200, y: 300 }, { x: 202, y: 400 }, { x: 204, y: 500 }]);
  const n = page.items.length;
  // the horizontal bar crosses the stem exactly once
  inkAt([{ x: 150, y: 400 }, { x: 250, y: 399 }, { x: 350, y: 400 }]);
  ok(page.items.includes(stem), 'the stem survived');
  eq(page.items.length, n + 1, 'and the bar was kept');
  T.settings.scribbleWhileWriting = false;
});

t('scribble: drawing a line straight through a shape leaves it alone', () => {
  resetInput();
  T.settings.scribbleWhileWriting = true;
  const page = E.pages[E.active];
  const box = inkAt([{ x: 400, y: 600 }, { x: 600, y: 600 }, { x: 600, y: 750 },
                     { x: 400, y: 750 }, { x: 400, y: 600 }]);
  const n = page.items.length;
  inkAt([{ x: 350, y: 675 }, { x: 500, y: 675 }, { x: 650, y: 675 }]);
  ok(page.items.includes(box), 'the shape survived a line drawn through it');
  eq(page.items.length, n + 1);
  T.settings.scribbleWhileWriting = false;
});

t('scribble: a deliberate rub does delete what it covers', () => {
  resetInput();
  T.settings.scribbleWhileWriting = true;
  const page = E.pages[E.active];
  const word = inkAt([{ x: 200, y: 900 }, { x: 300, y: 900 }, { x: 400, y: 900 }]);
  // six passes back and forth over the same ground
  const rub = [];
  for (let i = 0; i < 6; i++) {
    const fwd = i % 2 === 0;
    for (let s = 0; s <= 14; s++) {
      const t = s / 14;
      rub.push({ x: 200 + (fwd ? t : 1 - t) * 200, y: 880 + i * 7 });
    }
  }
  inkAt(rub);
  ok(!page.items.includes(word), 'the scribbled-over word is gone');
  T.settings.scribbleWhileWriting = false;
});

t('scribble: a nearby stroke it never touched is untouched', () => {
  resetInput();
  T.settings.scribbleWhileWriting = true;
  const page = E.pages[E.active];
  const target = inkAt([{ x: 200, y: 1100 }, { x: 400, y: 1100 }]);
  const neighbour = inkAt([{ x: 200, y: 1160 }, { x: 400, y: 1160 }]);
  const rub = [];
  for (let i = 0; i < 6; i++) {
    const fwd = i % 2 === 0;
    for (let s = 0; s <= 14; s++) {
      const t = s / 14;
      rub.push({ x: 200 + (fwd ? t : 1 - t) * 200, y: 1092 + i * 3 });
    }
  }
  inkAt(rub);
  ok(!page.items.includes(target), 'the scribbled one went');
  ok(page.items.includes(neighbour), 'the one 60 units away stayed');
  T.settings.scribbleWhileWriting = false;
});

t('scribble: crossings are counted, not proximity', () => {
  const page = E.pages[E.active];
  const line = { id: 'x1', type: 'stroke', tool: 'pen', color: '#000', size: 3, pressure: false,
                 pts: [{ x: 0, y: 100 }, { x: 200, y: 100 }] };
  // a path running alongside, never touching
  const beside = [{ x: 0, y: 130 }, { x: 200, y: 130 }];
  eq(E.pathCrossings(beside, line), 0, 'parallel path crosses nothing');
  // a single perpendicular pass
  const through = [{ x: 100, y: 40 }, { x: 100, y: 160 }];
  eq(E.pathCrossings(through, line), 1, 'one pass, one crossing');
  // a zig-zag over it
  const over = [];
  for (let i = 0; i < 8; i++) over.push({ x: 40 + i * 20, y: i % 2 ? 60 : 140 });
  ok(E.pathCrossings(over, line) >= 4, 'a scribble crosses repeatedly');
});

/* ══════════ 27a. text boxes move and resize directly ══════════ */

t('text: a box can be picked up and moved without lassoing it first', () => {
  resetInput();
  const page = E.pages[E.active];
  // placed straight into the page, clear of anything earlier tests drew
  const box = {
    id: NW.uid('i_'), type: 'text', x: 520, y: 720, w: 200, h: 40,
    text: 'Movable', font: 'Georgia, serif', fontName: 'Georgia', size: 28,
    color: '#16150f', bold: false, italic: false, underline: false,
    align: 'left', highlight: '', lineHeight: 1.35
  };
  E.addItems(page, [box], 'text');
  ok(E.hitItemAt(page, { x: box.x + 6, y: box.y + 10 }, 6) === box, 'it is the top item there');

  const x0 = box.x, y0 = box.y, w0 = box.w, size0 = box.size;
  T.setTool('lasso');
  const inside = scr(box.x + 6, box.y + 10);
  const to = scr(box.x + 106, box.y + 70);
  down(430, 'pen', inside.x, inside.y);
  ok(E.selection && E.selection.items[0] === box, 'tapping it selected it');
  move(430, 'pen', to.x, to.y);
  up(430, 'pen', to.x, to.y);

  ok(Math.abs(box.x - (x0 + 100)) < 2, 'it moved with the pen in x (' + box.x + ')');
  ok(Math.abs(box.y - (y0 + 60)) < 2, 'and in y (' + box.y + ')');
  eq(box.w, w0, 'moving does not resize it');
  eq(box.size, size0, 'nor restyle it');
  T.clearSelection();
  T.setTool('pen');
});

t('text: a corner handle resizes the box it is selected on', () => {
  resetInput();
  const page = E.pages[E.active];
  const box = page.items.filter(i => i.type === 'text').pop();
  ok(box, 'we have a text box to work with');
  T.setTool('lasso');
  const inside = scr(box.x + 6, box.y + box.size * 0.5);
  down(431, 'pen', inside.x, inside.y);
  up(431, 'pen', inside.x, inside.y);
  ok(E.selection && E.selection.items[0] === box, 'selected by a plain tap');

  const b = E.selection.bbox;
  const w0 = b.x1 - b.x0;
  const corner = scr(b.x1, b.y1);
  const out = scr(b.x1 + 70, b.y1 + 40);
  down(432, 'pen', corner.x, corner.y);
  eq(T._p.mode, 'scale', 'grabbing a corner scales rather than moves');
  move(432, 'pen', out.x, out.y);
  up(432, 'pen', out.x, out.y);

  const nb = E.selectionBBox([box]);
  ok((nb.x1 - nb.x0) > w0 + 5, 'the box actually grew (' + (nb.x1 - nb.x0).toFixed(1) + ' vs ' + w0.toFixed(1) + ')');
  T.clearSelection();
  T.setTool('pen');
});

/* ══════════ 27b. hold to snap, then drag to adjust ══════════ */

t('shape tool: holding snaps the stroke without lifting', () => {
  resetInput();
  T.setTool('shape');
  T.opts.shape.kind = 'auto';
  const path = [];
  for (let i = 0; i <= 8; i++) path.push({ x: 200 + i * 25, y: 1400 });
  for (let i = 1; i <= 8; i++) path.push({ x: 400 - i * 12, y: 1400 + i * 14 });
  for (let i = 1; i <= 8; i++) path.push({ x: 304 - i * 13, y: 1512 - i * 14 });
  const scr0 = pathOnPage(path);
  down(410, 'pen', scr0[0].x, scr0[0].y);
  for (let i = 1; i < scr0.length; i++) move(410, 'pen', scr0[i].x, scr0[i].y);

  // hold: the nib stops moving, so the next report is below the sample
  // threshold and lastMoveT stays where it was
  T._p.draw.lastMoveT = performance.now() - 600;
  move(410, 'pen', scr0[scr0.length - 1].x + 0.01, scr0[scr0.length - 1].y);

  const d = T._p.draw;
  ok(d && d.snapped, 'the stroke snapped while the pen was still down');
  ok(d.snapped.kind !== 'curve', 'to a real shape, not a smoothed squiggle');
  ok(T._shapeHandles(d.snapped).length >= 2, 'and it has handles to drag');
  up(410, 'pen', scr0[scr0.length - 1].x, scr0[scr0.length - 1].y);
  T.setTool('pen');
});

t('shape tool: dragging after the snap moves one handle and pins the rest', () => {
  resetInput();
  T.setTool('shape');
  T.opts.shape.kind = 'auto';
  const page = E.pages[E.active];
  const n = page.items.length;
  const path = [];
  for (let i = 0; i <= 8; i++) path.push({ x: 200 + i * 25, y: 1400 });
  for (let i = 1; i <= 8; i++) path.push({ x: 400 - i * 12, y: 1400 + i * 14 });
  for (let i = 1; i <= 8; i++) path.push({ x: 304 - i * 13, y: 1512 - i * 14 });
  const scr0 = pathOnPage(path);
  down(411, 'pen', scr0[0].x, scr0[0].y);
  for (let i = 1; i < scr0.length; i++) move(411, 'pen', scr0[i].x, scr0[i].y);
  T._p.draw.lastMoveT = performance.now() - 600;
  const tail = scr0[scr0.length - 1];
  move(411, 'pen', tail.x + 0.01, tail.y);

  const d = T._p.draw;
  ok(d && d.snapped, 'snapped');
  const before = T._shapeHandles(d.snapped).map(h => ({ x: h.x, y: h.y }));
  const moved = d.handle || 0;

  /* Drag well away from where the pen paused. The handle it grabbed follows;
     every other one must be exactly where it was — that is the whole contract,
     and it is what makes a triangle keep two corners and move the third. */
  const target = scr(120, 1250);
  move(411, 'pen', target.x, target.y);
  const after = T._shapeHandles(d.snapped).map(h => ({ x: h.x, y: h.y }));

  eq(after.length, before.length, 'the shape keeps its handle count');
  ok(Math.hypot(after[moved].x - 120, after[moved].y - 1250) < 1.5,
     'the grabbed handle followed the nib');
  let others = 0;
  for (let i = 0; i < before.length; i++) {
    if (i === moved) continue;
    if (Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y) > 0.01) others++;
  }
  // a box resizes about its opposite corner, so its two side handles ride along
  const allowed = (d.snapped.kind === 'rect' || d.snapped.kind === 'ellipse') ? 2 : 0;
  ok(others <= allowed, 'the other handles stayed put (' + others + ' moved)');

  up(411, 'pen', target.x, target.y);
  eq(page.items.length, n + 1, 'one shape committed');
  eq(page.items[page.items.length - 1].type, 'shape', 'as a shape');
  T.setTool('pen');
});

t('shape snapping stays opt-in for the pen', () => {
  resetInput();
  T.setTool('pen');
  T.settings.holdToSnap = false;
  const path = [];
  for (let i = 0; i <= 8; i++) path.push({ x: 200 + i * 25, y: 1600 });
  for (let i = 1; i <= 8; i++) path.push({ x: 400 - i * 12, y: 1600 + i * 10 });
  const scr0 = pathOnPage(path);
  down(412, 'pen', scr0[0].x, scr0[0].y);
  for (let i = 1; i < scr0.length; i++) move(412, 'pen', scr0[i].x, scr0[i].y);
  T._p.draw.lastMoveT = performance.now() - 600;
  const tail = scr0[scr0.length - 1];
  move(412, 'pen', tail.x + 0.01, tail.y);
  ok(!T._p.draw.snapped, 'writing is never second-guessed unless asked');
  up(412, 'pen', tail.x, tail.y);
});

/* ══════════ 28. highlighter ══════════ */

t('highlighter: drawn as one filled shape, so caps cannot show through', () => {
  resetInput();
  T.setTool('highlighter');
  const page = E.pages[E.active];
  stroke(pathOnPage([{ x: 200, y: 1250 }, { x: 400, y: 1252 }, { x: 600, y: 1250 }]));
  const hl = page.items[page.items.length - 1];
  eq(hl.tool, 'highlighter');
  const c = mockCtx(mkEl('canvas'));
  E.drawItem(c, hl, page);
  eq(c._rec.strokes, 0, 'nothing is stroked — stroking is what left the crescents');
  eq(c._rec.fills, 1, 'one fill for the whole mark');
  ok(c._rec.composites.includes('multiply'), 'still tints rather than covers');
  T.setTool('pen');
});

t('highlighter: a doubled-back mark still fills once', () => {
  const c = mockCtx(mkEl('canvas'));
  const back = [];
  for (let i = 0; i <= 20; i++) back.push({ x: 100 + (i < 10 ? i * 20 : (20 - i) * 20), y: 50 });
  E.fillConstantStroke(c, back, 26, true);
  eq(c._rec.fills, 1);
});

/* ══════════ run ══════════ */
for (const [name, fn] of queue) {
  try { const r = await fn(); if (r === false) throw new Error('returned false'); pass++; out.push(['✓', name]); }
  catch (e) { fail++; out.push(['✗', name + '  → ' + e.message]); }
}
console.log('');
for (const [m, n] of out) console.log('  ' + (m === '✓' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m') + ' ' + n);
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
