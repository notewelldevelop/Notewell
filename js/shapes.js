/* ═══════════════ NoteWell — shapes.js ═══════════════
   Two gesture recognisers, both pure functions over a point list:

   1. recognize()      — "draw it roughly, it snaps"  (GoodNotes / Kilonotes
                         style shape correction: line, arrow, rectangle,
                         square, ellipse, circle, triangle, polygon, curve)
   2. detectScribble() — GoodNotes' scribble‑to‑erase gesture. Goodnotes runs
                         a small LSTM for this; we get the same behaviour from
                         the geometry the model was trained to notice:
                         a short stroke that doubles back on itself many times
                         inside a small box, crossing itself repeatedly.
*/
(function (NW) {
  'use strict';
  const G = NW.geom;
  const S = NW.shapes = {};

  /* ── helpers ──────────────────────────────────── */

  function angleAt(a, b, c) {
    const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (d < 1e-9) return Math.PI;
    return Math.acos(NW.clamp((v1x * v2x + v1y * v2y) / d, -1, 1));
  }

  /** principal axis (largest-variance direction) of a point cloud */
  function pca(pts) {
    const c = G.centroid(pts);
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const n = pts.length; sxx /= n; syy /= n; sxy /= n;
    const t = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { c, ax: Math.cos(t), ay: Math.sin(t), angle: t };
  }

  function selfIntersections(pts, cap) {
    const p = G.rdp(pts, 1.4);
    let n = 0;
    for (let i = 0; i < p.length - 1; i++) {
      for (let j = i + 2; j < p.length - 1; j++) {
        if (i === 0 && j === p.length - 2) continue;   // shared endpoints
        if (G.segCross(p[i], p[i + 1], p[j], p[j + 1])) { n++; if (cap && n >= cap) return n; }
      }
    }
    return n;
  }

  /* ═══════════════ 1. SHAPE CORRECTION ═══════════════ */

  /**
   * @param {Array<{x,y}>} raw   stroke points in page units
   * @param {Object} opt         {snapAngles:bool, forceRegular:bool}
   * @returns {Object|null}      a shape descriptor, or null to keep the ink
   */
  S.recognize = function (raw, opt) {
    opt = opt || {};
    if (!raw || raw.length < 4) return null;

    const pts = raw.map(p => ({ x: p.x, y: p.y }));
    const bb = G.bbox(pts);
    const diag = Math.hypot(bb.w, bb.h);
    if (diag < 12) return null;                       // a dot, not a shape
    const L = G.len(pts);
    if (L < 18) return null;

    const eps = NW.clamp(diag * 0.035, 2, 26);
    const simp = G.rdp(pts, eps);
    const first = pts[0], last = pts[pts.length - 1];
    const gap = G.dist(first, last);
    const closed = gap < Math.max(diag * 0.22, 16) && L > diag * 1.1;

    /* corner analysis up front — it tells the circle test to stand down */
    const ring = simp.slice();
    if (closed) while (ring.length > 3 && G.dist(ring[0], ring[ring.length - 1]) < diag * 0.07) ring.pop();
    const corners = findCorners(ring, closed, diag);
    const sharp = corners.filter(c => c.ang < 1.75).length;   // ≲100°: a real corner, not curvature

    /* ---- straight line / arrow ---- */
    if (!closed) {
      const chord = gap;
      const straightness = chord > 0 ? L / chord : 99;

      const arrow = detectArrow(pts, simp, diag);
      if (arrow) return arrow;

      if (straightness < 1.10 && simp.length <= 3) {
        let a = { x: first.x, y: first.y }, b = { x: last.x, y: last.y };
        if (opt.snapAngles !== false) { const s = snapLine(a, b); a = s.a; b = s.b; }
        return { kind: 'line', a, b };
      }
    }

    /* ---- circle / ellipse ----
       Skipped when the stroke has 3 or 4 genuinely sharp corners: a square's
       radius-from-centre wanders about as much as a lumpy circle's, so corner
       evidence has to win. */
    if (closed && !(sharp === 3 || sharp === 4)) {
      const loop = closeRing(pts);
      const c = G.centroid(loop);
      let mean = 0; for (const p of loop) mean += G.dist(p, c); mean /= loop.length;
      let dev = 0; for (const p of loop) { const d = G.dist(p, c) - mean; dev += d * d; }
      dev = Math.sqrt(dev / loop.length) / (mean || 1);

      // a hand-drawn circle sits near 0.02–0.05; a square is 0.11, a triangle 0.22
      if (dev < 0.075 && mean > 6) {
        return { kind: 'ellipse', cx: c.x, cy: c.y, rx: mean, ry: mean, rot: 0 };
      }

      // axis-aligned ellipse: normalise by the bounding box half-extents
      const cx = bb.x0 + bb.w / 2, cy = bb.y0 + bb.h / 2, rx = bb.w / 2, ry = bb.h / 2;
      if (rx > 4 && ry > 4 && !opt.forceRegular) {
        let e = 0;
        for (const p of loop) e += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1);
        e /= loop.length;
        if (e < 0.105) return { kind: 'ellipse', cx, cy, rx, ry, rot: 0 };
      }
    }

    /* ---- corner-based polygons ---- */
    if (closed && corners.length === 4) {
      const r = fitQuad(corners, opt);
      if (r) return r;
    }
    if (closed && corners.length === 3) {
      return { kind: 'poly', pts: corners.map(p => ({ x: p.x, y: p.y })), closed: true, sub: 'triangle' };
    }
    if (closed && corners.length >= 5 && corners.length <= 10) {
      return { kind: 'poly', pts: regularise(corners, opt), closed: true, sub: 'polygon' };
    }
    if (!closed && corners.length >= 2 && corners.length <= 6) {
      // an open run of straight segments — keep the corners, drop the wobble
      const straight = corners.every((p, i) => i < 2 || true);
      if (straight && isPiecewiseStraight(pts, corners, diag)) {
        return { kind: 'poly', pts: corners.map(p => ({ x: p.x, y: p.y })), closed: false, sub: 'polyline' };
      }
    }

    /* ---- smooth arc fallback: tidy the ink without changing its identity ---- */
    if (opt.smoothFallback !== false) {
      const s = G.smooth(G.rdp(pts, Math.max(1.2, diag * 0.006)), 3, 2);
      if (s.length >= 3) return { kind: 'curve', pts: s.map(p => ({ x: p.x, y: p.y })), closed };
    }
    return null;
  };

  function closeRing(pts) {
    const r = pts.slice();
    if (G.dist(r[0], r[r.length - 1]) > 1) r.push({ x: r[0].x, y: r[0].y });
    return r;
  }

  /** snap a line to 0/15/30/45/… degrees when it is already close */
  function snapLine(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let ang = Math.atan2(dy, dx);
    const step = Math.PI / 12;                 // 15°
    const snapped = Math.round(ang / step) * step;
    if (Math.abs(((ang - snapped + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.10) {
      // within ~5.7° of a nice angle → take it
      ang = snapped;
    } else {
      const near = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(ang - near) < 0.07) ang = near;
    }
    return { a, b: { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len } };
  }

  /** arrow = long shaft, then a short barbed tail that folds back */
  function detectArrow(pts, simp, diag) {
    if (simp.length < 4 || simp.length > 7) return null;
    const n = simp.length;
    const tail = simp.slice(n - 3);
    const shaft = simp.slice(0, n - 2);
    const shaftLen = G.len(shaft);
    const headLen = G.len(tail);
    if (shaftLen < diag * 0.45) return null;
    if (headLen > shaftLen * 0.75 || headLen < diag * 0.06) return null;

    const tip = simp[n - 3];
    const straight = G.dist(shaft[0], shaft[shaft.length - 1]);
    if (shaftLen / (straight || 1) > 1.22) return null;

    const back = simp[n - 1];
    const a1 = angleAt(shaft[0], tip, back);
    if (a1 > 1.15) return null;                       // barb must fold back
    return { kind: 'arrow', a: { x: simp[0].x, y: simp[0].y }, b: { x: tip.x, y: tip.y } };
  }

  /** dominant corners of a (possibly closed) simplified path, each with its angle */
  function findCorners(simp, closed, diag) {
    const p = simp.slice();
    while (closed && p.length > 3 && G.dist(p[0], p[p.length - 1]) < diag * 0.07) p.pop();
    if (p.length < 3) return p.map(q => ({ x: q.x, y: q.y, ang: Math.PI }));
    const out = [];
    const N = p.length;
    for (let i = 0; i < N; i++) {
      const prev = p[(i - 1 + N) % N], cur = p[i], next = p[(i + 1) % N];
      if (!closed && (i === 0 || i === N - 1)) { out.push({ x: cur.x, y: cur.y, ang: Math.PI }); continue; }
      const ang = angleAt(prev, cur, next);
      const armA = G.dist(prev, cur), armB = G.dist(cur, next);
      if (ang < 2.55 && Math.min(armA, armB) > diag * 0.10) out.push({ x: cur.x, y: cur.y, ang });
    }
    // merge corners that sit almost on top of each other
    const merged = [];
    for (const c of out) {
      const last = merged[merged.length - 1];
      if (last && G.dist(last, c) < diag * 0.09) { last.x = (last.x + c.x) / 2; last.y = (last.y + c.y) / 2; last.ang = Math.min(last.ang, c.ang); }
      else merged.push({ x: c.x, y: c.y, ang: c.ang });
    }
    if (closed && merged.length > 2 && G.dist(merged[0], merged[merged.length - 1]) < diag * 0.09) merged.pop();
    return merged;
  }

  /** four corners → rectangle (axis-aligned or rotated), square, or diamond */
  function fitQuad(corners, opt) {
    const [a, b, c, d] = corners;
    const sides = [G.dist(a, b), G.dist(b, c), G.dist(c, d), G.dist(d, a)];
    const angs = [angleAt(d, a, b), angleAt(a, b, c), angleAt(b, c, d), angleAt(c, d, a)];
    const rightish = angs.every(x => Math.abs(x - Math.PI / 2) < 0.42);
    if (!rightish) {
      return { kind: 'poly', pts: corners.map(p => ({ x: p.x, y: p.y })), closed: true, sub: 'quad' };
    }
    // orientation from the longest side
    let li = 0; for (let i = 1; i < 4; i++) if (sides[i] > sides[li]) li = i;
    const p0 = corners[li], p1 = corners[(li + 1) % 4];
    let rot = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    rot = ((rot % Math.PI) + Math.PI) % Math.PI;
    if (rot > Math.PI / 2) rot -= Math.PI;
    const axisAligned = Math.abs(rot) < 0.14;         // ≈8°

    const cx = (a.x + b.x + c.x + d.x) / 4, cy = (a.y + b.y + c.y + d.y) / 4;
    let w = (sides[0] + sides[2]) / 2, h = (sides[1] + sides[3]) / 2;
    if (li % 2 === 1) { const t = w; w = h; h = t; }

    if (opt && opt.forceRegular) { const m = (w + h) / 2; w = h = m; }
    else if (Math.abs(w - h) / Math.max(w, h) < 0.09) { const m = (w + h) / 2; w = h = m; }  // it's a square

    return { kind: 'rect', x: cx - w / 2, y: cy - h / 2, w, h, rot: axisAligned ? 0 : rot };
  }

  /** nudge an n-gon towards a regular polygon when it is nearly one */
  function regularise(corners, opt) {
    const c = G.centroid(corners);
    const rs = corners.map(p => G.dist(p, c));
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    const spread = Math.max(...rs) - Math.min(...rs);
    if (spread / mean > 0.24 && !(opt && opt.forceRegular)) return corners.map(p => ({ x: p.x, y: p.y }));
    const a0 = Math.atan2(corners[0].y - c.y, corners[0].x - c.x);
    const n = corners.length;
    // keep the drawn winding direction
    const a1 = Math.atan2(corners[1].y - c.y, corners[1].x - c.x);
    const dir = Math.sin(a1 - a0) >= 0 ? 1 : -1;
    return corners.map((_, i) => ({
      x: c.x + Math.cos(a0 + dir * i * 2 * Math.PI / n) * mean,
      y: c.y + Math.sin(a0 + dir * i * 2 * Math.PI / n) * mean
    }));
  }

  function isPiecewiseStraight(pts, corners, diag) {
    let worst = 0;
    for (const p of pts) {
      let best = Infinity;
      for (let i = 0; i < corners.length - 1; i++) best = Math.min(best, G.ptSeg(p, corners[i], corners[i + 1]));
      if (best > worst) worst = best;
    }
    return worst < diag * 0.075;
  }

  /** Turn a shape descriptor into a polyline (hit-testing, lasso, export). */
  S.outline = function (sh) {
    switch (sh.kind) {
      case 'line': case 'arrow': return [sh.a, sh.b];
      case 'rect': {
        const cx = sh.x + sh.w / 2, cy = sh.y + sh.h / 2, r = sh.rot || 0;
        const co = Math.cos(r), si = Math.sin(r);
        return [[-sh.w / 2, -sh.h / 2], [sh.w / 2, -sh.h / 2], [sh.w / 2, sh.h / 2], [-sh.w / 2, sh.h / 2], [-sh.w / 2, -sh.h / 2]]
          .map(([x, y]) => ({ x: cx + x * co - y * si, y: cy + x * si + y * co }));
      }
      case 'ellipse': {
        const out = [], r = sh.rot || 0, co = Math.cos(r), si = Math.sin(r);
        for (let i = 0; i <= 48; i++) {
          const t = i / 48 * Math.PI * 2, x = Math.cos(t) * sh.rx, y = Math.sin(t) * sh.ry;
          out.push({ x: sh.cx + x * co - y * si, y: sh.cy + x * si + y * co });
        }
        return out;
      }
      case 'poly': case 'curve': return sh.closed ? closeRing(sh.pts) : sh.pts.slice();
      default: return [];
    }
  };

  /* ═══════════════ 2. SCRIBBLE‑TO‑ERASE ═══════════════ */

  /**
   * Recognises the "cross it out and it's gone" gesture.
   * Returns {isScribble, score, reversals, density, crossings}.
   *
   * Heuristics chosen to mirror what the GoodNotes model reacts to:
   *  • the stroke must be long relative to the box it lives in (density)
   *  • it must reverse direction along its own long axis several times
   *  • it usually crosses itself
   *  • it must have enough sample points to be a deliberate gesture
   */
  S.detectScribble = function (pts, opt) {
    opt = opt || {};
    const fail = { isScribble: false, score: 0, reversals: 0, density: 0, crossings: 0 };
    if (!pts || pts.length < 12) return fail;

    const L = G.len(pts);
    const bb = G.bbox(pts);
    const diag = Math.hypot(bb.w, bb.h);
    if (diag < 14 || L < (opt.minLength || 55)) return fail;

    const density = L / diag;                              // scribbles pack length into a small box
    if (density < 2.8) return fail;

    /* Reversals along the dominant axis only.
       An earlier version also counted reversals across the *short* axis, on
       the theory that a sawtooth zig-zag reverses that way. It does — but so
       does every letter with an up-and-down stroke in it, which is most of
       them. Ordinary handwriting was being read as a scribble and deleted.
       Only the long axis counts now: a scribble is a pen going back over the
       same ground, and that is a long-axis motion. */
    const ax = pca(pts);
    let min = Infinity, max = -Infinity;
    const proj = pts.map(p => {
      const t = (p.x - ax.c.x) * ax.ax + (p.y - ax.c.y) * ax.ay;
      if (t < min) min = t; if (t > max) max = t; return t;
    });
    const span = Math.max(max - min, 1);
    const amp = span * 0.3;             // a reversal has to cross a third of the box
    let reversals = 0, dir = 0, anchor = proj[0];
    for (let i = 1; i < proj.length; i++) {
      const d = proj[i] - anchor;
      if (Math.abs(d) < amp) continue;
      const nd = d > 0 ? 1 : -1;
      if (dir !== 0 && nd !== dir) reversals++;
      dir = nd; anchor = proj[i];
    }

    const crossings = selfIntersections(pts, 20);

    /* A deliberate scribble is unmistakable: the pen sweeps back over the same
       ground at least four times, or three times while also crossing its own
       path repeatedly. Anything less is left alone — better to make someone
       scribble once more than to eat a word they meant to keep. */
    const clear = reversals >= 4 && density >= 3.2;
    const knot = reversals >= 3 && crossings >= 4 && density >= 3.5;

    const score = Math.min(1,
      (reversals / 6) * 0.5 + Math.min(density / 6, 1) * 0.3 + Math.min(crossings / 8, 1) * 0.2);

    return { isScribble: !!(clear || knot), score, reversals, density, crossings };
  };

  /* ═══════════════ 3. QUICK GESTURES ═══════════════ */

  /** A tight "V" struck through content — some users prefer this to a scribble. */
  S.isStrikeThrough = function (pts) {
    const bb = G.bbox(pts);
    if (bb.w < 40) return false;
    if (bb.h > bb.w * 0.18) return false;
    const simp = G.rdp(pts, 4);
    return simp.length <= 3 && G.len(pts) / Math.max(G.dist(pts[0], pts[pts.length - 1]), 1) < 1.15;
  };

})(window.NW);
