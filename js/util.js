/* ═══════════════ NoteWell — util.js ═══════════════
   Small helpers: ids, DOM, geometry, curve maths, colour, files.
   Everything hangs off the global `NW` namespace so the app works
   from file:// with no bundler and no network. */
window.NW = window.NW || {};
(function (NW) {
  'use strict';

  /* ── ids & misc ───────────────────────────────── */
  const B62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  NW.uid = function (p) {
    let s = '';
    const r = crypto.getRandomValues(new Uint8Array(12));
    for (let i = 0; i < 12; i++) s += B62[r[i] % 62];
    return (p || '') + Date.now().toString(36) + s;
  };
  NW.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  NW.lerp = (a, b, t) => a + (b - a) * t;
  NW.now = () => performance.now();
  NW.deepClone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  NW.debounce = function (fn, ms) {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  };
  NW.throttleRAF = function (fn) {
    let q = false, last;
    return function (...a) {
      last = a;
      if (q) return; q = true;
      requestAnimationFrame(() => { q = false; fn.apply(this, last); });
    };
  };

  /* ── DOM ──────────────────────────────────────── */
  NW.$ = (s, r) => (r || document).querySelector(s);
  NW.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  NW.el = function (tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(c => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  };
  NW.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── tiny event bus ───────────────────────────── */
  const bus = {};
  NW.on = (n, f) => ((bus[n] = bus[n] || []).push(f), f);
  NW.off = (n, f) => { if (bus[n]) bus[n] = bus[n].filter(x => x !== f); };
  NW.emit = (n, d) => { (bus[n] || []).forEach(f => { try { f(d); } catch (e) { console.error('[' + n + ']', e); } }); };

  /* ── geometry ─────────────────────────────────── */
  const G = NW.geom = {};
  G.dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  G.dist2 = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y; return dx * dx + dy * dy; };
  G.len = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += G.dist(pts[i - 1], pts[i]); return L; };
  G.centroid = pts => {
    let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  };
  G.bbox = function (pts, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    pad = pad || 0;
    return { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2, x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  G.rectsOverlap = (a, b) => !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
  G.rectHas = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

  /** distance from point p to segment ab */
  G.ptSeg = function (p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  };

  /** do segments p1p2 and p3p4 cross? */
  G.segCross = function (p1, p2, p3, p4) {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };

  /** point inside closed polygon (ray casting) */
  G.inPoly = function (pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  };

  /** Ramer–Douglas–Peucker polyline simplification */
  G.rdp = function (pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let idx = -1, max = 0;
      for (let i = s + 1; i < e; i++) {
        const d = G.ptSeg(pts[i], pts[s], pts[e]);
        if (d > max) { max = d; idx = i; }
      }
      if (max > eps && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  };

  /** resample a polyline to N evenly-spaced points (for shape/gesture matching) */
  G.resample = function (pts, n) {
    if (pts.length < 2) return pts.slice();
    const total = G.len(pts), step = total / (n - 1);
    if (step <= 0) return new Array(n).fill(pts[0]);
    const out = [pts[0]]; let d = 0;
    let src = pts.slice();
    for (let i = 1; i < src.length; i++) {
      const dd = G.dist(src[i - 1], src[i]);
      if (d + dd >= step) {
        const t = (step - d) / dd;
        const np = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y) };
        out.push(np); src.splice(i, 0, np); d = 0;
      } else d += dd;
    }
    while (out.length < n) out.push(src[src.length - 1]);
    return out.slice(0, n);
  };

  /** moving-average smoothing that keeps the endpoints put */
  G.smooth = function (pts, passes, w) {
    passes = passes == null ? 1 : passes; w = w == null ? 1 : w;
    let cur = pts;
    for (let k = 0; k < passes; k++) {
      const out = [cur[0]];
      for (let i = 1; i < cur.length - 1; i++) {
        let sx = 0, sy = 0, sp = 0, st = 0, n = 0;
        for (let j = -w; j <= w; j++) {
          const q = cur[NW.clamp(i + j, 0, cur.length - 1)];
          sx += q.x; sy += q.y; sp += (q.p == null ? .5 : q.p); st += (q.t == null ? 1 : q.t); n++;
        }
        out.push({ x: sx / n, y: sy / n, p: sp / n, t: st / n });
      }
      out.push(cur[cur.length - 1]);
      cur = out;
    }
    return cur;
  };

  /* ── colour ───────────────────────────────────── */
  NW.hexToRgb = function (h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  NW.rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => NW.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  NW.withAlpha = function (hex, a) { const c = NW.hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; };
  NW.luminance = function (hex) { const c = NW.hexToRgb(hex); return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255; };

  /* ── files ────────────────────────────────────── */
  NW.download = function (blobOrUrl, filename) {
    const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    const a = NW.el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  NW.pickFile = function (accept, multiple) {
    return new Promise(res => {
      const inp = NW.$('#filePick');
      inp.value = ''; inp.accept = accept || '*/*'; inp.multiple = !!multiple;
      const done = () => { inp.removeEventListener('change', done); res(multiple ? Array.from(inp.files) : inp.files[0] || null); };
      inp.addEventListener('change', done);
      inp.click();
    });
  };
  NW.readAsDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  NW.readAsArrayBuffer = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });
  NW.loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.crossOrigin = 'anonymous'; i.src = src; });

  /** Shrink a data-URL image so notebooks stay light. */
  NW.fitImage = async function (dataURL, maxPx) {
    maxPx = maxPx || 1800;
    const img = await NW.loadImage(dataURL);
    if (Math.max(img.width, img.height) <= maxPx) return { data: dataURL, w: img.width, h: img.height };
    const s = maxPx / Math.max(img.width, img.height);
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const isPng = /^data:image\/png/.test(dataURL);
    return { data: c.toDataURL(isPng ? 'image/png' : 'image/jpeg', .88), w, h };
  };

  NW.dataURLToBytes = function (d) {
    const i = d.indexOf(','), bin = atob(d.slice(i + 1));
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  };

  NW.bytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };
  NW.when = function (ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 604800) return Math.floor(d / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };

  /** the app's serif, for text drawn onto the canvas (page numbers, rulings) */
  NW.SERIF = "'NoteWell Garamond', Garamond, 'EB Garamond', 'Apple Garamond', Baskerville, " +
             "'Iowan Old Style', Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif";

  /* ── device ───────────────────────────────────── */
  NW.isTouch = matchMedia('(pointer:coarse)').matches;
  NW.isApple = /iPad|iPhone|Macintosh/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  NW.dpr = () => Math.min(window.devicePixelRatio || 1, 3);

  /* ── theme ────────────────────────────────────────
     Three settings: follow the system, always light, always dark.
     The choice is mirrored into localStorage so index.html can apply it
     before the first paint and you never see the wrong theme flash. */
  NW.Theme = {
    mode: 'system',
    isDark: false,

    init() {
      let saved = null;
      try { saved = localStorage.getItem('nw-theme'); } catch (e) { }
      NW.Theme.set(saved === 'light' || saved === 'dark' ? saved : 'system', true);
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onSys = () => { if (NW.Theme.mode === 'system') NW.Theme.apply(); };
      mq.addEventListener ? mq.addEventListener('change', onSys) : mq.addListener(onSys);
    },

    set(mode, quiet) {
      NW.Theme.mode = mode;
      try { mode === 'system' ? localStorage.removeItem('nw-theme') : localStorage.setItem('nw-theme', mode); } catch (e) { }
      if (mode === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', mode);
      NW.Theme.apply(quiet);
    },

    /** cycle for the toolbar button: light → dark → system */
    cycle() {
      NW.Theme.set(NW.Theme.mode === 'light' ? 'dark' : NW.Theme.mode === 'dark' ? 'system' : 'light');
      return NW.Theme.mode;
    },

    apply(quiet) {
      const cs = getComputedStyle(document.documentElement);
      const read = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
      NW.Theme.isDark = (NW.Theme.mode === 'dark') ||
        (NW.Theme.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      NW.theme = {
        fg: read('--fg', '#16150f'),
        bg: read('--bg', '#f4f4f2'),
        surface: read('--surface', '#ffffff'),
        line: read('--line-2', '#cbc9c3'),
        muted: read('--fg-3', '#8e8d85'),
        canvas: read('--canvas', '#dedcd6'),
        dark: NW.Theme.isDark
      };
      const meta = document.getElementById('metaTheme');
      if (meta) meta.setAttribute('content', NW.theme.surface);
      document.querySelectorAll('.theme-btn').forEach(b => {
        const sun = b.querySelector('.i-sun'), moon = b.querySelector('.i-moon');
        if (sun) sun.hidden = NW.Theme.isDark;
        if (moon) moon.hidden = !NW.Theme.isDark;
        b.title = 'Theme: ' + NW.Theme.mode + (NW.Theme.mode === 'system' ? ' (' + (NW.Theme.isDark ? 'dark' : 'light') + ')' : '');
      });
      if (!quiet) NW.emit('theme', NW.Theme.mode);
    }
  };
  /** neutral colours the canvas chrome draws with; refreshed by Theme.apply */
  NW.theme = { fg: '#16150f', bg: '#f4f4f2', surface: '#ffffff', line: '#cbc9c3', muted: '#8e8d85', canvas: '#dedcd6', dark: false };

  /* ── toast ────────────────────────────────────── */
  let toastT;
  NW.toast = function (msg, ms) {
    const t = NW.$('#toast'); if (!t) { console.log(msg); return; }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2100);
  };

  /* ── very small markdown → html (for chat) ────── */
  NW.md = function (src) {
    let s = NW.esc(src);
    s = s.replace(/```([\s\S]*?)```/g, (m, c) => '<pre><code>' + c.replace(/^\n/, '') + '</code></pre>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/^\s*[-•]\s+(.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, m => '<ul>' + m + '</ul>');
    return s;
  };

})(window.NW);
