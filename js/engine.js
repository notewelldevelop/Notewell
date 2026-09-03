/* ═══════════════ NoteWell — engine.js ═══════════════
   Camera, page layout, the item renderer, hit-testing and history.

   Pages are laid out in an infinite vertical "world"; one viewport-sized
   canvas draws whatever is on screen. Each page is cached to an offscreen
   canvas while you're zoomed out (fast panning) and drawn straight from the
   vectors once you zoom past 130% (crisp ink). */
(function (NW) {
  'use strict';
  const G = NW.geom;

  const PAGE_GAP = 46;
  const E = NW.Engine = {
    stage: null, paper: null, live: null, ctx: null, lctx: null,
    nb: null, pages: [], layout: [],
    cam: { x: 0, y: 0, zoom: 1 },
    vw: 0, vh: 0, dpr: 1,
    worldW: 0, worldH: 0,
    active: 0,
    selection: null,          // {ids:Set, poly:[], bbox:{}, moving:bool}
    caches: new Map(),
    imgCache: new Map(),
    needsRender: false,
    /* device pixels per page unit for whatever is being painted right now —
       the screen, an offscreen cache, or an export. widthAt needs it to know
       how thin is too thin. */
    renderScale: 1
  };

  /* ── setup ────────────────────────────────────── */
  E.init = function (stage, paper, live) {
    E.stage = stage; E.paper = paper; E.live = live;
    /* `desynchronized` lets the browser skip a compositing step and push the
       canvas closer to the display controller. On a stylus it is the single
       biggest latency win available to a web app — the difference between ink
       trailing the nib and keeping up with it. Ignored where unsupported. */
    E.ctx = paper.getContext('2d', { desynchronized: true, alpha: true });
    E.lctx = live.getContext('2d', { desynchronized: true, alpha: true });
    const ro = new ResizeObserver(() => E.resize());
    ro.observe(stage);
    E.resize();
  };

  E.resize = function () {
    const r = E.stage.getBoundingClientRect();
    E.dpr = NW.dpr();
    E.vw = r.width; E.vh = r.height;
    for (const c of [E.paper, E.live]) {
      c.width = Math.max(1, Math.round(r.width * E.dpr));
      c.height = Math.max(1, Math.round(r.height * E.dpr));
    }
    E.invalidate();
  };

  E.open = function (nb, pages) {
    E.nb = nb; E.pages = pages;
    E.caches.clear();
    E.selection = null;
    E.relayout();
    E.fitWidth();
    E.History.reset();
    E.invalidate();
  };

  E.relayout = function () {
    let y = 0; E.layout = [];
    for (const p of E.pages) { E.layout.push({ x: -p.w / 2, y, w: p.w, h: p.h }); y += p.h + PAGE_GAP; }
    E.worldH = Math.max(0, y - PAGE_GAP);
    E.worldW = E.pages.reduce((m, p) => Math.max(m, p.w), 800);
  };

  E.fitWidth = function () {
    const p = E.pages[0]; if (!p) return;
    E.cam.zoom = NW.clamp((E.vw - 48) / p.w, 0.12, 2.2);
    E.cam.x = 0;
    E.cam.y = p.h / 2 - (E.vh / 2) / E.cam.zoom + 24;
    E.clampCam();
  };

  /* ── coordinate maths ─────────────────────────── */
  E.toWorld = function (sx, sy) {
    return { x: (sx - E.vw / 2) / E.cam.zoom + E.cam.x, y: (sy - E.vh / 2) / E.cam.zoom + E.cam.y };
  };
  E.toScreen = function (wx, wy) {
    return { x: (wx - E.cam.x) * E.cam.zoom + E.vw / 2, y: (wy - E.cam.y) * E.cam.zoom + E.vh / 2 };
  };
  /** screen point → {index, page, x, y} in page-local units (clamped to nearest page) */
  E.toPage = function (sx, sy) {
    const w = E.toWorld(sx, sy);
    let idx = 0;
    for (let i = 0; i < E.layout.length; i++) {
      const L = E.layout[i];
      if (w.y >= L.y - PAGE_GAP / 2 && w.y <= L.y + L.h + PAGE_GAP / 2) { idx = i; break; }
      if (w.y > L.y) idx = i;
    }
    const L = E.layout[idx]; if (!L) return null;
    return { index: idx, page: E.pages[idx], x: w.x - L.x, y: w.y - L.y, world: w,
             inside: w.x >= L.x && w.x <= L.x + L.w && w.y >= L.y && w.y <= L.y + L.h };
  };
  E.pageOrigin = i => E.layout[i] || { x: 0, y: 0 };

  E.clampCam = function () {
    const over = 260 / E.cam.zoom;
    E.cam.x = NW.clamp(E.cam.x, -E.worldW / 2 - over, E.worldW / 2 + over);
    E.cam.y = NW.clamp(E.cam.y, -over - 80, E.worldH + over + 240);
    E.cam.zoom = NW.clamp(E.cam.zoom, 0.08, 8);
  };

  E.zoomAt = function (sx, sy, factor) {
    const before = E.toWorld(sx, sy);
    E.cam.zoom = NW.clamp(E.cam.zoom * factor, 0.08, 8);
    const after = E.toWorld(sx, sy);
    E.cam.x += before.x - after.x;
    E.cam.y += before.y - after.y;
    E.clampCam(); E.invalidate(); NW.emit('cam');
  };
  E.setZoom = function (z) {
    const c = E.toWorld(E.vw / 2, E.vh / 2);
    E.cam.zoom = NW.clamp(z, 0.08, 8);
    E.cam.x = c.x; E.cam.y = c.y;
    E.clampCam(); E.invalidate(); NW.emit('cam');
  };
  E.scrollTo = function (pageIndex, smooth) {
    const L = E.layout[pageIndex]; if (!L) return;
    E.cam.y = L.y + (E.vh / 2) / E.cam.zoom - 20;
    E.clampCam(); E.invalidate(); NW.emit('cam');
  };

  /* ── item geometry ────────────────────────────── */
  E.itemBBox = function (it) {
    if (it._bb) return it._bb;
    let bb;
    if (it.type === 'stroke') bb = G.bbox(it.pts, (it.size || 3) / 2 + 2);
    else if (it.type === 'shape') bb = G.bbox(NW.shapes.outline(it.shape), (it.size || 3) / 2 + 2);
    else if (it.type === 'text') bb = { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + (it.h || it.size * 1.4) };
    else bb = { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
    if (bb.x0 === undefined) bb = { x0: bb.x, y0: bb.y, x1: bb.x + bb.w, y1: bb.y + bb.h };
    bb.w = bb.x1 - bb.x0; bb.h = bb.y1 - bb.y0; bb.x = bb.x0; bb.y = bb.y0;
    it._bb = bb; return bb;
  };
  E.dirtyItem = it => { if (it) delete it._bb; };

  /** points that describe an item, for lasso / eraser tests */
  E.itemPoints = function (it) {
    if (it.type === 'stroke') return it.pts;
    if (it.type === 'shape') return NW.shapes.outline(it.shape);
    const b = E.itemBBox(it);
    return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  };

  /** does a swept eraser path touch this item? */
  E.pathHitsItem = function (path, radius, it) {
    const bb = E.itemBBox(it);
    const pb = G.bbox(path, radius);
    if (!G.rectsOverlap(bb, pb)) return false;
    const pts = E.itemPoints(it);
    const r2 = radius + ((it.size || 2) / 2);
    if (it.type === 'image' || it.type === 'fill' || it.type === 'text') {
      for (const q of path) if (q.x >= bb.x0 - radius && q.x <= bb.x1 + radius && q.y >= bb.y0 - radius && q.y <= bb.y1 + radius) return true;
      return false;
    }
    for (let i = 0; i < path.length; i++) {
      const q = path[i];
      for (let j = 0; j < pts.length - 1; j++) if (G.ptSeg(q, pts[j], pts[j + 1]) <= r2) return true;
      if (pts.length === 1 && G.dist(q, pts[0]) <= r2) return true;
    }
    // also catch fast strokes: test path segments against item segments
    for (let i = 0; i < path.length - 1; i++)
      for (let j = 0; j < pts.length - 1; j++)
        if (G.segCross(path[i], path[i + 1], pts[j], pts[j + 1])) return true;
    return false;
  };

  /**
   * How many times does a path genuinely cross this item?
   *
   * Proximity is not enough for scribble-erase: a stroke passing *near* a
   * letter, or a single line drawn straight through a shape, should leave it
   * alone. Counting real segment intersections separates "I scribbled this
   * out" (many crossings) from "I drew through it" (one), and from "I drew
   * beside it" (none).
   */
  E.pathCrossings = function (path, it, cap) {
    const bb = E.itemBBox(it);
    const pb = G.bbox(path, 2);
    if (!G.rectsOverlap(bb, pb)) return 0;
    const pts = E.itemPoints(it);
    let n = 0;
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = 0; j < pts.length - 1; j++) {
        if (G.segCross(path[i], path[i + 1], pts[j], pts[j + 1])) {
          n++;
          if (cap && n >= cap) return n;
        }
      }
    }
    return n;
  };

  /** what fraction of an item's points sit inside a bounding rect */
  E.itemCoverage = function (rect, it) {
    const pts = E.itemPoints(it);
    if (!pts.length) return 0;
    let inside = 0;
    for (const p of pts) if (G.rectHas(rect, p)) inside++;
    return inside / pts.length;
  };

  /**
   * What fraction of an item lies under a path.
   *
   * Crossings alone are not quite enough: scribble along a horizontal line and
   * you run *parallel* to it, crossing rarely, even though you have plainly
   * gone over it. This asks the other question — how much of the item did the
   * pen actually pass across — and the threshold is high enough that merely
   * being nearby never counts.
   */
  E.pathCoverage = function (path, it, radius) {
    const pts = E.itemPoints(it);
    if (!pts.length) return 0;
    let covered = 0;
    for (const p of pts) {
      for (let i = 0; i < path.length - 1; i++) {
        if (G.ptSeg(p, path[i], path[i + 1]) <= radius) { covered++; break; }
      }
    }
    return covered / pts.length;
  };

  /**
   * What fraction of a path's own samples land inside an item.
   *
   * itemCoverage asks the opposite question — how much of the item sits inside
   * the path's bounding box — and for a box-shaped item (typed text, an image,
   * a fill) that is the wrong way round. Scribbling across the middle of a
   * paragraph encloses none of its corners, so the paragraph survived while the
   * highlighter over it was removed. This asks whether the pen actually
   * travelled across the thing.
   */
  E.pathInsideItem = function (path, it) {
    if (!path || !path.length) return 0;
    const bb = E.itemBBox(it);
    let inside = 0;
    for (const p of path) if (G.rectHas(bb, p)) inside++;
    return inside / path.length;
  };

  E.itemInLasso = function (poly, polyBB, it, mode) {
    const bb = E.itemBBox(it);
    if (!G.rectsOverlap(bb, polyBB)) return false;
    const pts = E.itemPoints(it);
    let hit = 0;
    for (const p of pts) if (G.inPoly(p, poly)) hit++;
    if (mode === 'touch') return hit > 0;
    return hit >= Math.max(1, Math.floor(pts.length * 0.6));
  };

  E.hitItemAt = function (page, pt, tol) {
    tol = tol || 8;
    for (let i = page.items.length - 1; i >= 0; i--) {
      const it = page.items[i];
      const bb = E.itemBBox(it);
      if (pt.x < bb.x0 - tol || pt.x > bb.x1 + tol || pt.y < bb.y0 - tol || pt.y > bb.y1 + tol) continue;
      if (it.type === 'image' || it.type === 'text' || it.type === 'fill') return it;
      const pts = E.itemPoints(it);
      for (let j = 0; j < pts.length - 1; j++) if (G.ptSeg(pt, pts[j], pts[j + 1]) <= tol + (it.size || 2) / 2) return it;
    }
    return null;
  };

  /* ── rendering ────────────────────────────────── */
  E.invalidate = function (pageId) {
    if (pageId) E.caches.delete(pageId);
    if (E.needsRender) return;
    E.needsRender = true;
    requestAnimationFrame(() => { E.needsRender = false; E.render(); });
  };
  E.invalidateAll = function () { E.caches.clear(); E.invalidate(); };

  E.visiblePages = function () {
    const top = E.cam.y - (E.vh / 2) / E.cam.zoom, bot = E.cam.y + (E.vh / 2) / E.cam.zoom;
    const out = [];
    for (let i = 0; i < E.layout.length; i++) {
      const L = E.layout[i];
      if (L.y + L.h >= top - 40 && L.y <= bot + 40) out.push(i);
    }
    return out;
  };

  /* The cache used to be capped so low that at ordinary zoom levels the page
     was rendered below screen resolution and then scaled up — which is the
     other half of why ink looked grainy. The cap is now generous enough to
     hold a retina A4, and anything above it falls through to direct vector
     drawing rather than being blurred. */
  const MAX_CACHE_PX = 13e6;
  /* Rasterise the cache finer than the screen needs and let the blit scale it
     down. Ink is thin dark lines on white: at 1:1 a stroke covers a pixel and
     a half and the rasteriser has to guess, which is why the page turned
     gritty the moment it zoomed out far enough to stop drawing vectors.
     Supersampling averages that guess over several pixels — the same trick as
     MSAA. The area cap still applies, so a large page simply gets less of it
     and falls through to vectors sooner. */
  const CACHE_SUPERSAMPLE = 1.25;
  function cacheScaleFor(page) {
    let s = NW.clamp(E.cam.zoom * E.dpr, 0.3, 3) * CACHE_SUPERSAMPLE;
    const area = page.w * page.h * s * s;
    if (area > MAX_CACHE_PX) s = Math.sqrt(MAX_CACHE_PX / (page.w * page.h));
    return s;
  }

  /** how many items are on the pages we can currently see */
  function visibleItemCount(vis) {
    let n = 0;
    for (const i of vis) n += (E.pages[i] && E.pages[i].items.length) || 0;
    return n;
  }

  function getCache(page) {
    const want = cacheScaleFor(page);
    let c = E.caches.get(page.id);
    /* Reusing a cache finer than we need is free — drawing it down just
       supersamples. Reusing one that is coarser means stretching a bitmap past
       its own resolution, and that is exactly the grainy ink this cache was
       meant to avoid, so the tolerance in that direction is only a few percent.
       The old window was symmetrical and let the page be blown up by a quarter
       before it thought to rebuild. */
    if (c && c.rev === page.rev && c.scale >= want * 0.94 && c.scale <= want * 1.9) return c;
    const cv = (c && c.canvas) || document.createElement('canvas');
    cv.width = Math.max(1, Math.round(page.w * want));
    cv.height = Math.max(1, Math.round(page.h * want));
    const cx = cv.getContext('2d');
    cx.setTransform(want, 0, 0, want, 0, 0);
    E.renderScale = want;
    E.paintPage(cx, page, null);
    c = { canvas: cv, scale: want, rev: page.rev };
    E.caches.set(page.id, c);
    // keep memory sane
    if (E.caches.size > 12) { const k = E.caches.keys().next().value; E.caches.delete(k); }
    return c;
  }

  E.render = function () {
    const ctx = E.ctx; if (!ctx) return;
    ctx.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
    ctx.clearRect(0, 0, E.vw, E.vh);

    const vis = E.visiblePages();
    /* Vectors are always sharp; the cache is only a speed trick for pages that
       are heavy or small on screen. Prefer drawing directly whenever the page
       is anywhere near readable size and there isn't a huge amount on it. */
    const heavy = E.cam.zoom < 0.5 || visibleItemCount(vis) >= 2500;
    const needScale = E.cam.zoom * E.dpr;      // device pixels per page unit

    for (const i of vis) {
      const page = E.pages[i], L = E.layout[i];
      const s = E.toScreen(L.x, L.y);
      const w = L.w * E.cam.zoom, h = L.h * E.cam.zoom;
      /* Past a certain zoom no cache can be built fine enough — the area cap
         bites, and the bitmap would have to be blown up several-fold to cover
         the pixels it is drawn into. The comment on MAX_CACHE_PX always claimed
         those pages fall through to vectors; only the item count was actually
         checked, so a busy page stayed a stretched bitmap however far you
         zoomed in. Now it really does fall through. */
      const direct = !heavy || cacheScaleFor(page) < needScale * 0.94;

      // paper shadow
      ctx.save();
      ctx.shadowColor = NW.theme.dark ? 'rgba(0,0,0,.65)' : 'rgba(30,28,20,.22)';
      ctx.shadowBlur = 20; ctx.shadowOffsetY = 6;
      ctx.fillStyle = page.bg || '#fff';
      ctx.fillRect(s.x, s.y, w, h);
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.rect(s.x, s.y, w, h); ctx.clip();
      if (direct) {
        ctx.translate(s.x, s.y); ctx.scale(E.cam.zoom, E.cam.zoom);
        E.renderScale = E.cam.zoom * E.dpr;
        E.paintPage(ctx, page, E.visibleRectIn(i));
      } else {
        const c = getCache(page);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(c.canvas, s.x, s.y, w, h);
      }
      ctx.restore();

      // page edge + number
      ctx.save();
      ctx.strokeStyle = NW.theme.dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.13)';
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x + .5, s.y + .5, w - 1, h - 1);
      if (E.cam.zoom > 0.25) {
        ctx.fillStyle = NW.theme.muted;
        ctx.font = '12px ' + (NW.SERIF || 'Georgia, serif');
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), s.x + w / 2, s.y + h + 21);
      }
      ctx.restore();
    }

    // selection chrome
    if (E.selection) E.paintSelection(ctx);
    NW.emit('rendered');
  };

  E.visibleRectIn = function (i) {
    const L = E.layout[i];
    const a = E.toWorld(0, 0), b = E.toWorld(E.vw, E.vh);
    return { x0: a.x - L.x - 20, y0: a.y - L.y - 20, x1: b.x - L.x + 20, y1: b.y - L.y + 20 };
  };

  /** Draw page background + every item. `clipRect` (page units) culls off-screen items. */
  E.paintPage = function (ctx, page, clipRect) {
    NW.paintTemplate(ctx, page);
    if (page.pdfImage) {
      const img = E.imgCache.get(page.pdfImage);
      if (img) ctx.drawImage(img, 0, 0, page.w, page.h);
      else E.warmImage(page.pdfImage, page.id);
    }
    for (const it of page.items) {
      if (clipRect) { const bb = E.itemBBox(it); if (!G.rectsOverlap(bb, clipRect)) continue; }
      E.drawItem(ctx, it, page);
    }
  };

  E.warmImage = function (src, pageId) {
    if (!src || E.imgCache.has(src)) return;
    E.imgCache.set(src, null);
    NW.loadImage(src).then(img => { E.imgCache.set(src, img); E.invalidate(pageId); }).catch(() => { });
  };

  /* ── one item ─────────────────────────────────── */
  E.drawItem = function (ctx, it, page) {
    ctx.save();
    if (it.opacity != null) ctx.globalAlpha = it.opacity;
    switch (it.type) {
      case 'stroke': drawStroke(ctx, it); break;
      case 'shape': drawShape(ctx, it); break;
      case 'image': drawImageItem(ctx, it, page); break;
      case 'fill': drawFillItem(ctx, it, page); break;
      case 'text': E.drawText(ctx, it); break;
    }
    ctx.restore();
  };

  /** pressure-tapered ink; highlighter multiplies so words stay readable */
  function drawStroke(ctx, it) {
    const pts = it.pts;
    if (!pts || !pts.length) return;
    const hl = it.tool === 'highlighter';

    if (hl) {
      /* Filled outline, exactly like the pen. Stroking this path left pale
         crescents wherever the nib doubled back, because the round joins and
         flat caps of a stroked path show through at a reversal. A filled
         shape has no caps or joins to show. */
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = it.opacity != null ? it.opacity : 1;
      ctx.fillStyle = it.color;
      const line = it.straight && pts.length > 1 ? [pts[0], pts[pts.length - 1]] : pts;
      fillConstantStroke(ctx, line, it.size, it.chisel !== false);
      return;
    }

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const base = it.size;

    if (pts.length === 1) {
      ctx.fillStyle = it.color;
      const w0 = Math.max(base * (pts[0].p || .5), base * .3) * (pts[0].t || 1);
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, w0 / 2, 0, 6.284); ctx.fill();
      return;
    }

    /* Tilt varies the width just as pressure does, and it is carried on the
       samples themselves — so a stroke drawn with a laid-over nib has to go
       through the variable-width renderer whether or not Pressure was on when
       it was written. Without this, Tilt was a checkbox with no effect unless
       Pressure happened to be ticked as well. */
    const tilted = pts.some(p => p.t != null && Math.abs(p.t - 1) > 0.02);

    if (!it.pressure && !tilted) {
      /* constant width: one smooth path, stroked once */
      const sp = densify(pts, 0, pts.length, base, false);
      ctx.strokeStyle = it.color;
      ctx.lineWidth = base;
      ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y);
      for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
      ctx.stroke();
      return;
    }

    /* Variable width, drawn as a single filled shape.
       Stroking each segment separately with its own lineWidth — which is what
       this used to do — leaves a bead at every joint where the round caps of
       two different widths overlap, and that beading is what made the ink look
       grainy. Real ink is one outline: walk up the left of the centreline,
       round the tip, and come back down the right. One fill, no seams. */
    ctx.fillStyle = it.color;
    fillVariableStroke(ctx, pts, base, 0, null, !!it.pressure);
  }

  /** Width at a sample, from pen pressure and tilt.
      `usePressure === false` holds the pressure term at its nominal 1, so a
      tilt-only stroke is exactly the width the size slider promises and varies
      with the lean of the nib alone. */
  /* A stroke thinner than about one device pixel cannot be laid down solidly:
     the rasteriser spreads it over two pixels at partial coverage and the line
     turns patchy and grey. That is the whole of why ink held up zoomed in and
     fell apart zoomed out — at 30% a 3pt nib is well under a pixel. Every
     vector renderer answers this the same way, with a floor measured in device
     pixels rather than document units. Supersampling the cache only softened
     the symptom and cost three times the fill rate. */
  const MIN_DEVICE_PX = 0.85;
  function widthAt(p, base, usePressure) {
    const press = usePressure === false ? 1 : 0.35 + 0.85 * (p.p == null ? .5 : p.p);
    const tilt = p.t == null ? 1 : p.t;
    const floor = Math.max(0.4, MIN_DEVICE_PX / (E.renderScale || 1));
    return Math.max(floor, base * press * tilt);
  }

  const TAU = Math.PI * 2;

  /**
   * Centripetal Catmull-Rom through p1→p2, using p0 and p3 for the tangents.
   *
   * The uniform version this replaces gave every span the same parameter
   * length regardless of how far apart the samples actually were. A stylus
   * never samples evenly — the faster the hand moves the wider the gaps — and
   * on uneven spacing uniform Catmull-Rom overshoots, putting a small kink in
   * the curve at the input points themselves. Measured on simulated traces it
   * was leaving spikes of up to 7.9 degrees where the rest of the curve turned
   * by under 1.2, which is the "bumps like the pen is taking in individual
   * inputs" you can see when you zoom in. Spacing the knots by the square root
   * of the distance (alpha = 0.5) is the standard answer and provably cannot
   * cusp or self-intersect; the same three traces drop to 2.6 degrees worst
   * case, with nothing above 5 at all. Evenly-spaced input is barely changed,
   * which is why slow, careful strokes never showed the problem.
   */
  function knotGap(a, b) {
    return Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || 1e-4;   // alpha = 0.5
  }
  function catmull(p0, p1, p2, p3, u, t0, t1, t2, t3) {
    const tt = t1 + (t2 - t1) * u;
    const mix = (a, b, ta, tb) => {
      const inv = 1 / (tb - ta), w = (tb - tt) * inv, v = (tt - ta) * inv;
      return { x: a.x * w + b.x * v, y: a.y * w + b.y * v };
    };
    const A1 = mix(p0, p1, t0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
    const B1 = mix(A1, A2, t0, t2), B2 = mix(A2, A3, t1, t3);
    const C = mix(B1, B2, t1, t2);
    // pressure and tilt still run linearly along the span, as they always did
    C.p = (p1.p == null ? .5 : p1.p) + ((p2.p == null ? .5 : p2.p) - (p1.p == null ? .5 : p1.p)) * u;
    C.t = (p1.t == null ? 1 : p1.t) + ((p2.t == null ? 1 : p2.t) - (p1.t == null ? 1 : p1.t)) * u;
    return C;
  }

  /**
   * Put a smooth curve through the samples before we give them any width.
   *
   * A stylus reports maybe one point every few millimetres when you write
   * quickly, and joining those with straight edges is what made letters look
   * faceted — an 'o' came out as a polygon. Splining first, then applying
   * width, is the order real ink engines use.
   */
  function densify(pts, from, to, base, usePressure) {
    const out = [];
    if (to - from < 2) { for (let i = from; i < to; i++) out.push(pts[i]); return out; }
    /* The tangents deliberately reach outside the requested span. A live stroke
       is splined a few samples at a time, and clamping p0/p3 to the batch gave
       every batch the wrong tangent at its seam — a fresh kink in the curve at
       each boundary, several times a frame, which is what made ink look faceted
       and grainy while it was being written and then quietly change shape on
       pen-up. Reading the real neighbours makes an appended batch spline
       exactly as the finished stroke will. Identical when the whole stroke is
       drawn at once, which is every other caller. */
    const at = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = from; i < to - 1; i++) {
      const p1 = at(i), p2 = at(i + 1);
      const seg = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      // subdivide finely enough that the facets are smaller than the nib
      const target = Math.max(0.9, widthAt(p1, base, usePressure) * 0.3);
      const steps = Math.max(1, Math.min(16, Math.ceil(seg / target)));
      if (steps === 1) { out.push(p1); continue; }
      const p0 = at(i - 1), p3 = at(i + 2);
      const t0 = 0, t1 = t0 + knotGap(p0, p1), t2 = t1 + knotGap(p1, p2), t3 = t2 + knotGap(p2, p3);
      for (let s = 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps, t0, t1, t2, t3));
    }
    out.push(at(to - 1));
    return out;
  }
  E.densify = densify;

  /**
   * Variable-width ink, drawn the way ink engines actually do it: a disc at
   * every sample (the pen tip at that instant) and a quadrangle joining each
   * consecutive pair of discs.
   *
   * The previous version traced a single outline up one side and back down the
   * other. That looks right until the pen turns tightly — then the two offset
   * curves cross, the polygon folds back on itself, and with the nonzero fill
   * rule the folded region cancels to a hole. That is what the crescent-shaped
   * bites out of letters were.
   *
   * Discs-and-quads cannot fold, because every piece is convex. The one thing
   * that matters is that every subpath winds the same way — otherwise the
   * overlaps cancel and you get holes again — so the discs are drawn
   * anticlockwise to match the quads. tests/winding.py proves it.
   */
  function fillVariableStroke(ctx, raw, base, from, to, usePressure) {
    const lo = from || 0, hi = to == null ? raw.length : to;
    if (hi - lo < 1) return;
    const pts = densify(raw, lo, hi, base, usePressure);
    const n = pts.length;
    if (!n) return;
    /* The width profile, low-passed.
       Stylus pressure is a noisy signal — consecutive reports differ by a few
       percent for a perfectly steady hand — and an unfiltered radius turns
       that noise into scalloping along both edges. Two box passes make a
       triangular kernel: enough to settle the noise, not enough to flatten a
       genuine taper. The centreline is left alone; densify already splined it. */
    let rad = new Float64Array(n);
    for (let i = 0; i < n; i++) rad[i] = widthAt(pts[i], base, usePressure) / 2;
    if (n > 4) {
      // prefix sums keep each pass O(n); the naive window was O(n·W) and this
      // runs for every stroke on every repaint
      const W = 3;
      const pre = new Float64Array(n + 1);
      let src = rad, dst = new Float64Array(n);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
        for (let i = 0; i < n; i++) {
          const a = i - W < 0 ? 0 : i - W, b = i + W > n - 1 ? n - 1 : i + W;
          dst[i] = (pre[b + 1] - pre[a]) / (b - a + 1);
        }
        const t = src; src = dst; dst = t;
      }
      rad = src;
    }

    ctx.beginPath();

    // the tapered bands joining consecutive discs
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;                       // no width to span
      const ra = rad[i], rb = rad[i + 1];
      const dr = ra - rb;
      if (d <= Math.abs(dr)) continue;              // one disc swallows the other
      const ux = dx / d, uy = dy / d;               // along the centreline
      const nx = -uy, ny = ux;                      // across it
      /* sin is how far the tangent leans off the perpendicular as the nib
         swells or tapers; cos is what remains of the across-the-line reach.
         With ra === rb this collapses to the plain perpendicular offset. */
      const sin = dr / d, cos = Math.sqrt(1 - sin * sin);
      const ax = a.x + ra * sin * ux, ay = a.y + ra * sin * uy;
      const bx = b.x + rb * sin * ux, by = b.y + rb * sin * uy;
      ctx.moveTo(ax + ra * cos * nx, ay + ra * cos * ny);
      ctx.lineTo(bx + rb * cos * nx, by + rb * cos * ny);
      ctx.lineTo(bx - rb * cos * nx, by - rb * cos * ny);
      ctx.lineTo(ax - ra * cos * nx, ay - ra * cos * ny);
      ctx.closePath();
    }

    // the pen tip at each sample — this is what rounds the joins and the ends
    for (let i = 0; i < n; i++) {
      const r = rad[i];
      ctx.moveTo(pts[i].x + r, pts[i].y);
      ctx.arc(pts[i].x, pts[i].y, r, 0, TAU, true);
    }

    ctx.fill();
  }
  E.fillVariableStroke = fillVariableStroke;
  E.widthAt = widthAt;

  /**
   * The same geometry at a fixed width — used by the highlighter.
   * `roundEnds` false gives the flat chisel end of a real marker; the joins in
   * the middle stay round either way, which is what stops a doubled-back
   * stroke showing a notch.
   */
  function fillConstantStroke(ctx, pts, width, chisel) {
    const n = pts.length;
    if (!n) return;
    const r = Math.max(0.4, width) / 2;

    if (n === 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x + r, pts[0].y);
      ctx.arc(pts[0].x, pts[0].y, r, 0, TAU, true);
      ctx.fill();
      return;
    }

    const sp = densify(pts, 0, n, width);
    ctx.beginPath();
    for (let i = 0; i < sp.length - 1; i++) {
      const a = sp[i], b = sp[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = -dy / len, ny = dx / len;
      ctx.moveTo(a.x + nx * r, a.y + ny * r);
      ctx.lineTo(b.x + nx * r, b.y + ny * r);
      ctx.lineTo(b.x - nx * r, b.y - ny * r);
      ctx.lineTo(a.x - nx * r, a.y - ny * r);
      ctx.closePath();
    }
    // discs at the interior samples round the joins; the ends stay flat for a
    // chisel nib, or get a disc too for a rounded one
    const from = chisel ? 1 : 0, to = chisel ? sp.length - 1 : sp.length;
    for (let i = from; i < to; i++) {
      ctx.moveTo(sp[i].x + r, sp[i].y);
      ctx.arc(sp[i].x, sp[i].y, r, 0, TAU, true);
    }
    ctx.fill();
  }
  E.fillConstantStroke = fillConstantStroke;
  E.drawStroke = drawStroke;

  function shapePath(ctx, sh) {
    ctx.beginPath();
    switch (sh.kind) {
      case 'line': case 'arrow':
        ctx.moveTo(sh.a.x, sh.a.y); ctx.lineTo(sh.b.x, sh.b.y); break;
      case 'rect': {
        ctx.save();
        ctx.translate(sh.x + sh.w / 2, sh.y + sh.h / 2); ctx.rotate(sh.rot || 0);
        const r = Math.min(sh.r || 0, Math.min(sh.w, sh.h) / 2);
        if (r > 0 && ctx.roundRect) ctx.roundRect(-sh.w / 2, -sh.h / 2, sh.w, sh.h, r);
        else ctx.rect(-sh.w / 2, -sh.h / 2, sh.w, sh.h);
        ctx.restore(); break;
      }
      case 'ellipse':
        ctx.ellipse(sh.cx, sh.cy, Math.abs(sh.rx), Math.abs(sh.ry), sh.rot || 0, 0, 6.2832); break;
      case 'poly': case 'curve': {
        const p = sh.pts; if (!p || !p.length) break;
        ctx.moveTo(p[0].x, p[0].y);
        if (sh.kind === 'curve' && p.length > 2) {
          for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
          ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
        } else for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
        if (sh.closed) ctx.closePath();
        break;
      }
    }
  }
  E.shapePath = shapePath;

  function drawShape(ctx, it) {
    const sh = it.shape;
    if (it.tool === 'highlighter') ctx.globalCompositeOperation = 'multiply';
    if (it.fill) { ctx.fillStyle = it.fill; shapePath(ctx, sh); ctx.fill(); }
    if (it.size > 0) {
      ctx.strokeStyle = it.color; ctx.lineWidth = it.size;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (it.dash) ctx.setLineDash(it.dash.map(v => v * it.size));
      shapePath(ctx, sh); ctx.stroke();
      ctx.setLineDash([]);
      if (sh.kind === 'arrow') {
        const ang = Math.atan2(sh.b.y - sh.a.y, sh.b.x - sh.a.x);
        const L = NW.clamp(G.dist(sh.a, sh.b) * 0.22, it.size * 3, it.size * 9);
        ctx.beginPath();
        ctx.moveTo(sh.b.x, sh.b.y);
        ctx.lineTo(sh.b.x - Math.cos(ang - 0.42) * L, sh.b.y - Math.sin(ang - 0.42) * L);
        ctx.moveTo(sh.b.x, sh.b.y);
        ctx.lineTo(sh.b.x - Math.cos(ang + 0.42) * L, sh.b.y - Math.sin(ang + 0.42) * L);
        ctx.stroke();
      }
    }
  }

  function drawImageItem(ctx, it, page) {
    const img = E.imgCache.get(it.data);
    if (!img) { E.warmImage(it.data, page && page.id);
      ctx.fillStyle = 'rgba(128,128,128,.10)'; ctx.fillRect(it.x, it.y, it.w, it.h); return; }
    ctx.save();
    ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
    if (it.rot) ctx.rotate(it.rot);
    if (it.round) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-it.w / 2, -it.h / 2, it.w, it.h, it.round); else ctx.rect(-it.w / 2, -it.h / 2, it.w, it.h); ctx.clip(); }
    ctx.drawImage(img, -it.w / 2, -it.h / 2, it.w, it.h);
    ctx.restore();
  }

  function drawFillItem(ctx, it, page) {
    const img = E.imgCache.get(it.data);
    if (!img) { E.warmImage(it.data, page && page.id); return; }
    ctx.drawImage(img, it.x, it.y, it.w, it.h);
  }

  /* ── typed text ───────────────────────────────── */
  E.fontCSS = function (it) {
    return (it.italic ? 'italic ' : '') + (it.bold ? '700 ' : '400 ') + it.size + 'px ' + (it.font || 'Helvetica, Arial, sans-serif');
  };
  E.wrapText = function (ctx, it) {
    ctx.font = E.fontCSS(it);
    const maxW = Math.max(20, it.w - 6);
    const out = [];
    for (const para of String(it.text || '').split('\n')) {
      if (!para) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const t = line + word;
        if (ctx.measureText(t).width > maxW && line.trim()) { out.push(line.replace(/\s+$/, '')); line = word.replace(/^\s+/, ''); }
        else line = t;
      }
      out.push(line);
    }
    return out;
  };
  E.textHeight = function (ctx, it) {
    const lh = it.size * (it.lineHeight || 1.35);
    return E.wrapText(ctx, it).length * lh + 6;
  };
  E.drawText = function (ctx, it) {
    const lines = E.wrapText(ctx, it);
    const lh = it.size * (it.lineHeight || 1.35);
    ctx.fillStyle = it.color || '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = it.align || 'left';
    const x = it.align === 'center' ? it.x + it.w / 2 : it.align === 'right' ? it.x + it.w - 3 : it.x + 3;
    if (it.highlight) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = it.highlight;
      lines.forEach((ln, i) => {
        if (!ln) return;
        const wdt = ctx.measureText(ln).width;
        const lx = it.align === 'center' ? x - wdt / 2 : it.align === 'right' ? x - wdt : x;
        ctx.fillRect(lx - 2, it.y + 4 + i * lh + it.size * 0.12, wdt + 4, it.size * 1.02);
      });
      ctx.restore();
      ctx.fillStyle = it.color || '#000';
    }
    lines.forEach((ln, i) => {
      const y = it.y + it.size + i * lh;
      ctx.fillText(ln, x, y);
      if (it.underline && ln) {
        const wdt = ctx.measureText(ln).width;
        const lx = it.align === 'center' ? x - wdt / 2 : it.align === 'right' ? x - wdt : x;
        ctx.fillRect(lx, y + it.size * 0.16, wdt, Math.max(1, it.size / 16));
      }
    });
  };

  /* ── selection chrome ─────────────────────────────
     Classic marching ants: a white line laid down first, then a black dashed
     line over it. That reads on white paper, cream paper and blackboard paper
     alike, and needs no colour at all. */
  E.marchingAnts = function (ctx, drawPath, zoom) {
    const z = zoom || 1;
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    drawPath(); ctx.stroke();
    ctx.lineWidth = 1.3 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    drawPath(); ctx.stroke();
    ctx.setLineDash([]);
  };

  E.paintSelection = function (ctx) {
    const sel = E.selection; if (!sel || !sel.items || !sel.items.length) return;
    const L = E.layout[sel.pageIndex]; if (!L) return;
    ctx.save();
    const s = E.toScreen(L.x, L.y);
    ctx.translate(s.x, s.y); ctx.scale(E.cam.zoom, E.cam.zoom);
    const z = E.cam.zoom;

    if (sel.poly && sel.poly.length > 2 && !sel.moved) {
      const path = () => {
        ctx.beginPath(); ctx.moveTo(sel.poly[0].x, sel.poly[0].y);
        for (const p of sel.poly) ctx.lineTo(p.x, p.y);
        ctx.closePath();
      };
      path(); ctx.fillStyle = 'rgba(128,128,128,.10)'; ctx.fill();
      E.marchingAnts(ctx, path, z);
    } else {
      const b = sel.bbox;
      const path = () => { ctx.beginPath(); ctx.rect(b.x0 - 4, b.y0 - 4, (b.x1 - b.x0) + 8, (b.y1 - b.y0) + 8); };
      path(); ctx.fillStyle = 'rgba(128,128,128,.08)'; ctx.fill();
      E.marchingAnts(ctx, path, z);
    }

    if (sel.showHandles !== false) {
      const b = sel.bbox, r = 5 / z;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 1.4 / z;
      for (const [hx, hy] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) {
        ctx.beginPath(); ctx.arc(hx, hy, r, 0, 6.284); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  };

  E.selectionBBox = function (items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      const b = E.itemBBox(it);
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    return { x0, y0, x1, y1 };
  };

  /* ── mutations (all go through history) ───────── */
  E.History = {
    undo: [], redo: [], limit: 250,
    reset() { this.undo = []; this.redo = []; NW.emit('history'); },
    push(entry) {
      this.undo.push(entry);
      if (this.undo.length > this.limit) this.undo.shift();
      this.redo.length = 0; NW.emit('history');
    },
    do(entry) { entry.redo(); this.push(entry); },
    canUndo() { return this.undo.length > 0; },
    canRedo() { return this.redo.length > 0; },
    stepBack() { const e = this.undo.pop(); if (!e) return; e.undo(); this.redo.push(e); NW.emit('history'); },
    stepFwd() { const e = this.redo.pop(); if (!e) return; e.redo(); this.undo.push(e); NW.emit('history'); }
  };

  E.pageOf = function (item) {
    for (const p of E.pages) if (p.items.indexOf(item) >= 0) return p;
    return null;
  };
  E.commitPage = function (page) {
    NW.Lib.markPage(page); NW.Lib.touch(E.nb);
    E.invalidate(page.id); NW.emit('page:changed', page);
  };

  E.addItems = function (page, items, label) {
    E.History.do({
      label: label || 'add',
      redo() { page.items.push(...items); E.commitPage(page); },
      undo() { for (const it of items) { const i = page.items.indexOf(it); if (i >= 0) page.items.splice(i, 1); } E.commitPage(page); }
    });
  };
  E.removeItems = function (page, items, label) {
    const rec = items.map(it => ({ it, i: page.items.indexOf(it) })).filter(r => r.i >= 0).sort((a, b) => a.i - b.i);
    if (!rec.length) return;
    E.History.do({
      label: label || 'erase',
      redo() { for (let k = rec.length - 1; k >= 0; k--) page.items.splice(page.items.indexOf(rec[k].it), 1); E.commitPage(page); },
      undo() { for (const r of rec) page.items.splice(Math.min(r.i, page.items.length), 0, r.it); E.commitPage(page); }
    });
  };
  E.mutate = function (page, apply, revert, label) {
    E.History.do({ label: label || 'edit', redo() { apply(); E.commitPage(page); }, undo() { revert(); E.commitPage(page); } });
  };

  /* ── offscreen page render (thumbnails, export, AI) ── */
  E.renderPageTo = function (page, scale, opt) {
    opt = opt || {};
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(page.w * scale));
    c.height = Math.max(1, Math.round(page.h * scale));
    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (opt.background !== false) {
      NW.paintTemplate(ctx, page);
    } else { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, page.w, page.h); }
    if (page.pdfImage) {
      const img = E.imgCache.get(page.pdfImage);
      if (img) ctx.drawImage(img, 0, 0, page.w, page.h);
    }
    E.renderScale = scale;
    for (const it of page.items) E.drawItem(ctx, it, page);
    return c;
  };

  /** make sure every raster this page needs is decoded before we export */
  E.preloadPage = async function (page) {
    const srcs = [];
    if (page.pdfImage) srcs.push(page.pdfImage);
    for (const it of page.items) if ((it.type === 'image' || it.type === 'fill') && it.data) srcs.push(it.data);
    await Promise.all(srcs.map(async s => {
      if (E.imgCache.get(s)) return;
      try { E.imgCache.set(s, await NW.loadImage(s)); } catch { }
    }));
  };

})(window.NW);
