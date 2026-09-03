/* ═══════════════ NoteWell — tools.js ═══════════════
   Every input gesture lives here: pen, highlighter, the two erasers, lasso,
   shapes, paint bucket, text, pan/zoom, pull-to-add-page, and the Apple
   Pencil double-tap switch. */
(function (NW) {
  'use strict';
  const E = NW.Engine, G = NW.geom;

  const T = NW.Tools = {
    tool: 'pen',
    lastDrawTool: 'pen',
    penSeen: false,
    opts: {
      pen: { color: '#16150f', size: 3.2, pressure: true, tilt: true, smooth: true },
      highlighter: { color: '#ffe14d', size: 26, opacity: 1, straight: false, chisel: true },
      eraser: { mode: 'area', size: 26, inkOnly: false },
      lasso: { filter: 'all', mode: 'contain' },
      shape: { kind: 'auto', color: '#16150f', size: 3.2, fill: '', regular: false },
      fill: { color: '#ffec99', tolerance: 34, gap: 1 },
      text: { font: 'Garamond, "EB Garamond", "Adobe Garamond Pro", "Apple Garamond", Baskerville, "Iowan Old Style", Palatino, Georgia, serif',
              fontName: 'Garamond', size: 34, color: '#16150f',
              bold: false, italic: false, underline: false, align: 'left', highlight: '' },
      /* the five colours on the bar, per tool — most recently used first */
      recent: {}
    },
    settings: {
      /* All three of these are gestures that *change or remove* ink you just
         drew, so they are opt-in. Writing produces a constant stream of short
         strokes — i-dots, commas, ticks, the crossbar of a t — and any gesture
         that reinterprets those will eventually eat a word. Nothing here fires
         unless you asked for it. */
      scribbleWhileWriting: false,  // scribble over ink with the pen and it vanishes
      holdToSnap: false,            // pause at the end of a stroke and it snaps to a shape
      /* The hardware Pencil double-tap always works in the native build. This
         setting is only the browser fallback that watches for two quick taps
         of the tip, which cannot reliably be told apart from writing a colon. */
      pencilDoubleTap: false,
      doubleTapAction: 'eraser',    // eraser | lasso | lastTwo
      /* OFF by default: a stylus draws, fingers scroll. Students without a
         stylus turn this on; it stands itself down again the moment a pen
         is used on the device. */
      fingerDraws: false,
      pullToAddPage: true
    },
    clipboard: null
  };

  /* ── live pointer bookkeeping ─────────────────────
     Exactly one pointer may draw at a time — `P.penId`. While it is set, every
     finger on the glass is bookkeeping only: it cannot pan, pinch or draw. That
     single rule is what makes a resting palm harmless. */
  const P = {
    pointers: new Map(),  // every live pointer, drawing or not
    penId: null,          // the pointer currently drawing (pen, mouse, or a finger if allowed)
    captured: false,      // did setPointerCapture succeed for penId
    mode: null,           // draw | pan | pinch | move | scale | erase | lasso
    draw: null,
    gesture: null,
    pull: { active: false, t0: 0, prog: 0, raf: 0 }
  };
  T._p = P;               // exposed for the test suite

  let stage, lctx;

  T.init = function () {
    stage = NW.$('#stage'); lctx = E.lctx;

    /* The stage and both canvases are touch-action:none in CSS, so the browser
       never claims a gesture for scrolling — every one is handled here. */
    stage.addEventListener('pointerdown', onDown, { passive: false });
    stage.addEventListener('pointermove', onMove, { passive: false });
    stage.addEventListener('pointerup', onUp, { passive: false });
    stage.addEventListener('pointercancel', onCancel, { passive: false });
    stage.addEventListener('pointerleave', onLeave, { passive: false });
    stage.addEventListener('lostpointercapture', onLostCapture, { passive: false });
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', e => e.preventDefault());

    /* native wrapper (iPadOS/Android shell) forwards the real hardware gesture */
    window.addEventListener('pencildoubletap', () => T.pencilToggle('hardware'));
    window.addEventListener('pencilsqueeze', () => NW.emit('ui:quickpalette'));

    T.loadOpts();
  };

  /* Bump this when a default changes in a way that must reach people who have
     already used the app. Saved settings normally win — which is right — but
     it meant anyone who had used NoteWell before the destructive gestures were
     turned off kept them on, and never saw the fix. */
  const SETTINGS_VERSION = 2;

  T.loadOpts = async function () {
    const saved = await NW.Store.kv('toolOpts');
    if (saved) { for (const k in saved) if (T.opts[k]) Object.assign(T.opts[k], saved[k]); }

    const st = await NW.Store.kv('toolSettings');
    if (st) {
      const was = st._v || 1;
      Object.assign(T.settings, st);
      if (was < 2) {
        /* v2: writing must never rewrite or delete itself unless asked. */
        T.settings.scribbleWhileWriting = false;
        T.settings.holdToSnap = false;
        T.settings.pencilDoubleTap = false;
        NW.toast('Updated: scribble-to-erase and shape-snapping are now off until you turn them on', 4200);
      }
    }
    T.settings._v = SETTINGS_VERSION;
    T.saveOpts();
    NW.emit('tool:changed');
  };
  T.saveOpts = NW.debounce(() => {
    NW.Store.kv('toolOpts', NW.deepClone(T.opts));
    NW.Store.kv('toolSettings', NW.deepClone(T.settings));
  }, 500);

  T.setTool = function (t) {
    if (t === T.tool) return;
    if (['pen', 'highlighter', 'shape'].includes(T.tool)) T.lastDrawTool = T.tool;
    T.tool = t;
    if (t !== 'lasso') T.clearSelection();
    if (t !== 'text') NW.Text.commit();
    NW.emit('tool:changed');
  };

  /* ═══════════ Apple Pencil double-tap ═══════════
     On a real iPad the hardware gesture arrives as a `pencildoubletap` event
     from the native shell. In a plain browser Safari never exposes it, so we
     also watch for two very quick taps of the stylus tip: both dots are held
     back for 320 ms, and if a second tap lands they're discarded and the tool
     flips instead — so a mis-fire never leaves a mark on the page. */
  const tap = { pending: null, seen: false, timer: 0, lastAt: 0, lastPt: null };

  T.pencilToggle = function (source) {
    if (!T.settings.pencilDoubleTap && source !== 'hardware') return;
    const act = T.settings.doubleTapAction;
    if (act === 'lastTwo') {
      const a = T.lastDrawTool, b = T.tool;
      T.setTool(b === a ? 'eraser' : a);
    } else if (T.tool === act) {
      T.setTool(T.lastDrawTool || 'pen');
    } else {
      T.setTool(act);
    }
    NW.toast(T.tool === 'eraser' ? 'Eraser' : T.tool === 'lasso' ? 'Lasso' : 'Pen', 900);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch { }
  };

  /* A tap is only a candidate for the double-tap gesture if it could not
     plausibly be part of writing. Dots, commas and i-dots are short taps too,
     so we also refuse to look at anything within 700 ms of real ink — while
     you are writing, a tap is always a tap. */
  function penTapCandidate(ev, startPt, dur, moved) {
    if (!T.settings.pencilDoubleTap) return false;
    if (ev.pointerType !== 'pen') return false;
    if (performance.now() - T._lastInkAt < 700) return false;
    return dur < 120 && moved < 4;
  }
  T._lastInkAt = 0;

  /* ═══════════ pointer handlers ═══════════ */

  function local(ev) {
    const r = stage.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function pressureOf(ev) {
    if (ev.pointerType === 'pen') {
      let p = ev.pressure;
      if (p === 0 || p == null) p = 0.5;
      return NW.clamp(0.08 + p * 1.02, 0.05, 1.25);
    }
    if (ev.pointerType === 'touch' && ev.pressure && ev.pressure !== 0.5) return NW.clamp(ev.pressure * 1.1, .2, 1.2);
    return 0.62;
  }

  /** How far the pen is laid over, as a width multiplier.
      tiltX/tiltY are degrees from vertical; upright ≈ 1.0, flat on its side
      ≈ 1.9, which is what makes shading with the side of the nib work. */
  function tiltOf(ev) {
    if (ev.pointerType !== 'pen' || !T.opts.pen.tilt) return 1;
    const tx = ev.tiltX || 0, ty = ev.tiltY || 0;
    if (!tx && !ty) return 1;                       // device reports no tilt
    /* tiltX and tiltY are the pen's lean in two perpendicular planes, not two
       sides of a triangle: the angle it actually makes with the paper is
       atan(hypot(tan tiltX, tan tiltY)). Taking hypot of the degrees directly
       overstates it — 60/30 reads as 67° when the pen is really at 61° — so
       the range topped out while the nib was still well short of flat. */
    const rad = Math.atan(Math.hypot(Math.tan(tx * Math.PI / 180), Math.tan(ty * Math.PI / 180)));
    const deg = Math.min(90, Math.abs(rad) * 180 / Math.PI);
    return 1 + (deg / 90) * 0.9;
  }

  /** Would a finger be allowed to draw right now? */
  function drawsWithFinger() { return T.settings.fingerDraws && !T.penSeen; }

  /** What this pointer is for: 'draw' puts ink down, 'gesture' moves the page. */
  function roleOf(ev) {
    if (T.tool === 'hand') return 'gesture';
    switch (ev.pointerType) {
      case 'pen': return 'draw';
      case 'mouse': return (ev.button === 1 || ev.button === 2) ? 'gesture' : 'draw';
      case 'touch': return drawsWithFinger() ? 'draw' : 'gesture';
      default: return 'draw';                       // unknown device: treat as a stylus
    }
  }
  T._roleOf = roleOf;

  /** Hand the canvas to one pointer. Nothing else can take it until it lifts. */
  function claimDraw(ev) {
    P.penId = ev.pointerId;
    /* Anchored to the event's own timestamp, not to the moment we got round to
       handling it. Under load those are tens of milliseconds apart, and an
       i-dot can be pressed and lifted inside that gap — measuring from the
       handler would file its lift as a straggler and throw the dot away. */
    const ts = ev && ev.timeStamp;
    P.claimedAt = (typeof ts === 'number' && ts > 0) ? ts : performance.now();
    P.captured = false;
    try {
      if (stage.setPointerCapture) { stage.setPointerCapture(ev.pointerId); P.captured = true; }
    } catch (e) { /* some pointers can't be captured; the penId guard still holds */ }
  }
  function releaseDraw() {
    if (P.penId == null) return;
    try { if (P.captured && stage.releasePointerCapture) stage.releasePointerCapture(P.penId); } catch (e) { }
    P.penId = null; P.captured = false;
  }

  /** The owning pointer went away without telling us. Commit what it drew and
      hand the canvas back, rather than locking writing out until a reload. */
  function recoverStalePointer() {
    const d = P.draw;
    if (d && P.mode === 'draw' && d.pts && d.pts.length > 1) {
      try { commitStroke(d); } catch (e) { }
    }
    P.draw = null; P.mode = null;
    clearLive();
    releaseDraw();
  }

  /**
   * Is this lift about the stroke that is actually in progress?
   *
   * Pointer ids are recycled — iPadOS hands the Pencil the same id stroke after
   * stroke — so matching `penId` is not proof of anything on its own. Write
   * quickly and the lift of one letter arrives *after* the tap of the next, and
   * acting on it tears the canvas away from a stroke that has only just begun:
   * its moves then fall through to nobody and the stroke never appears at all.
   * That is the second stem of an H, and the stem of an I.
   *
   * A trusted event's `timeStamp` shares an origin with `performance.now()`, so
   * anything stamped before the current stroke began is a straggler from the
   * last one. Engines that stamp events some other way simply never look stale,
   * which leaves the old behaviour untouched.
   */
  function staleLift(ev) {
    const ts = ev && ev.timeStamp;
    if (typeof ts !== 'number' || !(ts > 0)) return false;
    return ts < P.claimedAt - 1;
  }

  /** A pen has arrived while fingers were moving the page — the pen wins. */
  function cancelGesture() {
    if (P.mode === 'pan' || P.mode === 'pinch') { P.mode = null; P.gesture = null; }
    stopPull();
  }

  function onDown(ev) {
    const pt = local(ev);
    P.pointers.set(ev.pointerId, {
      ...pt, type: ev.pointerType, t: performance.now(), x0: pt.x, y0: pt.y, moved: 0,
      role: roleOf(ev)
    });

    if (ev.pointerType === 'pen' && !T.penSeen) { T.penSeen = true; NW.emit('pen:detected'); }

    /* ── a finger, a thumb, a palm ─────────────────────────────────
       If a pen already owns the canvas we do nothing at all with it: no pan,
       no pinch, no ink. That covers a palm landing mid-word and a second hand
       arriving to pinch while the pen is still down. */
    if (P.pointers.get(ev.pointerId).role === 'gesture') {
      if (P.penId != null) { ev.preventDefault(); return; }
      const fingers = gesturePointers();
      if (fingers.length === 1) startPan(ev);
      else if (fingers.length === 2) startPinch();
      ev.preventDefault();
      return;
    }

    /* ── a pen (or a mouse, or a finger when the toggle is on) ─────
       A stylus has one tip. If a *new* drawing pointer arrives while another
       is still marked active, the previous stroke's pointerup was simply never
       delivered — which happens constantly when writing quickly, because
       lift-and-tap events can arrive out of order under load. The old code
       ignored the new stroke in that situation, which is why letters went
       missing at speed. The new nib always wins; the old stroke is committed
       rather than thrown away.

       This holds even when the id is the same one we are already drawing with.
       Pointer ids get recycled, so a Pencil writing quickly is handed the *same*
       id stroke after stroke — treating that as a repeat of the down we already
       have discarded the whole of the next stroke. `pointerdown` fires once per
       press, so there is no such thing as a repeat to protect against; and a
       stroke with nothing drawn in it yet commits nothing anyway. */
    if (P.penId != null) recoverStalePointer();
    cancelGesture();                                        // pen beats fingers
    claimDraw(ev);

    const hit = E.toPage(pt.x, pt.y);
    if (!hit) { releaseDraw(); return; }

    /* dragging an existing selection */
    if (E.selection && E.selection.pageIndex === hit.index) {
      const h = handleAt(hit);
      if (h) { startScale(ev, hit, h); ev.preventDefault(); return; }
      if (insideSelection(hit)) { startMove(ev, hit); ev.preventDefault(); return; }
      if (T.tool === 'lasso') T.clearSelection();
    }

    switch (T.tool) {
      case 'pen': case 'highlighter': case 'shape': startStroke(ev, hit); break;
      case 'eraser': startErase(ev, hit); break;
      case 'lasso': startLasso(ev, hit); break;
      case 'fill': doFill(hit); break;
      case 'text': NW.Text.tapAt(hit); break;
    }
    ev.preventDefault();
  }

  /** live pointers that are allowed to move the page */
  function gesturePointers() {
    const out = [];
    for (const r of P.pointers.values()) if (r.role === 'gesture') out.push(r);
    return out;
  }

  function onMove(ev) {
    const rec = P.pointers.get(ev.pointerId);
    const pt = local(ev);
    if (rec) {
      rec.moved += Math.hypot(pt.x - rec.x, pt.y - rec.y);
      rec.x = pt.x; rec.y = pt.y;
    }

    /* the drawing pointer */
    if (P.penId != null) {
      if (ev.pointerId !== P.penId) { ev.preventDefault(); return; }   // palm, ignored
      P.lastMoveAt = performance.now();
      switch (P.mode) {
        case 'draw': {
          // already snapped? the pen is now adjusting the shape, not drawing
          if (P.draw && P.draw.snapped) { dragSnapped(ev); break; }
          // coalesced events give buttery pen lines on iPad — every sample the
          // Pencil produced between frames, not just the last one
          const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
          for (const e2 of (evs && evs.length ? evs : [ev])) pushPoint(e2);
          scheduleLive();
          maybeHoldSnap();
          break;
        }
        case 'erase': { pushPoint(ev); eraseStep(); scheduleLive(); break; }
        case 'lasso': { pushPoint(ev); scheduleLive(); break; }
        case 'move': updateMove(pt); break;
        case 'scale': updateScale(pt); break;
      }
      ev.preventDefault();
      return;
    }

    if (P.mode === 'pinch') { updatePinch(); ev.preventDefault(); return; }
    if (P.mode === 'pan') { updatePan(ev, pt); ev.preventDefault(); return; }
  }

  /** the one place a stroke ends, however it ended */
  function finishDraw(ev, rec) {
    /* a quick stylus tap in any drawing-ish mode may be half of a double-tap */
    if (rec && P.draw && (P.mode === 'draw' || P.mode === 'erase' || P.mode === 'lasso')) {
      const dur = performance.now() - rec.t;
      if (penTapCandidate(ev, rec, dur, rec.moved)) { releaseDraw(); handlePenTap(rec, P.mode); return; }
    }
    switch (P.mode) {
      case 'draw': endStroke(); break;
      case 'erase': endErase(); break;
      case 'lasso': endLasso(); break;
      case 'move': endMove(); break;
      case 'scale': endScale(); break;
    }
    P.mode = null;
    releaseDraw();
  }

  function onUp(ev) {
    /* A lift left over from the previous stroke, arriving on a recycled id
       after the next stroke has already started. Leave the new stroke alone. */
    if (P.penId != null && ev.pointerId === P.penId && staleLift(ev)) return;

    const rec = P.pointers.get(ev.pointerId);
    P.pointers.delete(ev.pointerId);

    if (P.penId != null && ev.pointerId === P.penId) { finishDraw(ev, rec); return; }
    if (P.penId != null) return;                     // a finger lifting mid-stroke: nothing to do

    const fingers = gesturePointers();
    if (P.mode === 'pinch') {
      if (fingers.length === 1) { P.mode = 'pan'; P.gesture = { lastX: fingers[0].x, lastY: fingers[0].y }; }
      else { P.mode = null; P.gesture = null; stopPull(); }
      return;
    }
    if (P.mode === 'pan') { endPan(); return; }
    P.mode = null;
  }

  /** The system took the pointer away (a call came in, iPadOS switched apps).
      Commit what was drawn rather than throwing the student's ink away. */
  function onCancel(ev) {
    if (P.penId != null && ev.pointerId === P.penId && staleLift(ev)) return;
    const rec = P.pointers.get(ev.pointerId);
    P.pointers.delete(ev.pointerId);
    if (P.penId != null && ev.pointerId === P.penId) { finishDraw(ev, rec); return; }
    if (P.penId == null && (P.mode === 'pan' || P.mode === 'pinch')) { P.mode = null; P.gesture = null; stopPull(); }
  }

  /** The pen was lifted off the edge of the glass, or hovered away entirely.
      With pointer capture this rarely fires for the drawing pointer, but if it
      does the stroke is committed, not lost. */
  function onLeave(ev) {
    if (P.penId != null && ev.pointerId === P.penId && staleLift(ev)) return;
    if (P.penId != null && ev.pointerId === P.penId) {
      const rec = P.pointers.get(ev.pointerId);
      P.pointers.delete(ev.pointerId);
      finishDraw(ev, rec);
      return;
    }
    P.pointers.delete(ev.pointerId);
    if (P.penId == null && P.mode === 'pan' && !gesturePointers().length) endPan();
  }

  /** Last line of defence: capture lost for any reason while still drawing. */
  function onLostCapture(ev) {
    if (P.penId == null || ev.pointerId !== P.penId) return;
    /* The one stale-lift path that was still open, and the reason a quickly
       written H lost its second upright.
       `releasePointerCapture` does not fire `lostpointercapture` synchronously
       — the browser queues it. iPadOS also recycles pointer ids, so the next
       stroke is usually handed the same id. Write fast enough and the order
       becomes: stroke A lifts, we release, stroke B goes down and claims the
       same id, and only then does A's queued loss arrive. Without this guard it
       matches B's id, finds a live stroke, and ends B a millisecond after it
       started. The event carries A's timestamp, so it is recognisable. */
    if (staleLift(ev)) return;
    if (!P.mode) { releaseDraw(); return; }
    const rec = P.pointers.get(ev.pointerId);
    P.pointers.delete(ev.pointerId);
    P.captured = false;
    finishDraw(ev, rec);
  }

  /** A quick stylus tap: hold the dot back briefly in case a second tap
      follows. If it does, both dots are thrown away and the tool flips —
      so a false positive never leaves a mark on the page. */
  function handlePenTap(rec, mode) {
    const stroke = mode === 'draw' ? P.draw : null;
    P.draw = null; P.mode = null;
    clearLive();
    const nowT = performance.now();
    const near = tap.lastPt && Math.hypot(rec.x - tap.lastPt.x, rec.y - tap.lastPt.y) < 46;

    if (tap.seen && near && nowT - tap.lastAt < 420) {
      clearTimeout(tap.timer); tap.pending = null; tap.seen = false; tap.lastPt = null;
      T.pencilToggle('gesture');
      return;
    }
    tap.lastAt = nowT; tap.lastPt = { x: rec.x, y: rec.y };
    tap.pending = stroke; tap.seen = true;
    clearTimeout(tap.timer);
    tap.timer = setTimeout(() => {
      const s = tap.pending; tap.pending = null; tap.seen = false;
      if (s) commitStroke(s);
    }, T.settings.pencilDoubleTap ? 320 : 0);
  }

  /* ── pan / pinch ──────────────────────────────── */
  function startPan(ev) {
    P.mode = 'pan';
    const pt = local(ev);
    P.gesture = { lastX: pt.x, lastY: pt.y, vy: 0, lastT: performance.now() };
  }
  function updatePan(ev, pt) {
    const g = P.gesture; if (!g) return;
    const dx = (pt.x - g.lastX) / E.cam.zoom, dy = (pt.y - g.lastY) / E.cam.zoom;
    E.cam.x -= dx; E.cam.y -= dy;
    g.lastX = pt.x; g.lastY = pt.y;
    E.clampCam(); E.invalidate(); NW.emit('cam');
    checkPull();
  }
  function endPan() { P.mode = null; P.gesture = null; stopPull(); }

  function startPinch() {
    const [a, b] = gesturePointers();
    if (!a || !b) return;
    P.mode = 'pinch';
    P.gesture = {
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      z0: E.cam.zoom,
      mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam0: { x: E.cam.x, y: E.cam.y }
    };
    clearLive();
  }
  function updatePinch() {
    const [a, b] = gesturePointers();
    if (!a || !b) return;
    const g = P.gesture; if (!g) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = NW.clamp(g.z0 * (d / g.d0), 0.08, 8);
    // keep the world point under the initial midpoint pinned, then follow the fingers
    E.cam.zoom = z;
    E.cam.x = g.cam0.x + (g.mid0.x - E.vw / 2) / g.z0 - (mid.x - E.vw / 2) / z;
    E.cam.y = g.cam0.y + (g.mid0.y - E.vh / 2) / g.z0 - (mid.y - E.vh / 2) / z;
    E.clampCam(); E.invalidate(); NW.emit('cam');
    checkPull();
  }

  function onWheel(ev) {
    ev.preventDefault();
    const pt = local(ev);
    if (ev.ctrlKey || ev.metaKey) { E.zoomAt(pt.x, pt.y, Math.exp(-ev.deltaY * 0.0125)); return; }
    E.cam.x += ev.deltaX / E.cam.zoom;
    E.cam.y += ev.deltaY / E.cam.zoom;
    E.clampCam(); E.invalidate(); NW.emit('cam');
    checkPull(); clearTimeout(onWheel._t); onWheel._t = setTimeout(stopPull, 260);
  }

  /* ── requirement 12: keep pulling past the last page to add one ── */
  function overscroll() {
    const bottom = E.cam.y + (E.vh / 2) / E.cam.zoom;
    return bottom - (E.worldH + 30);
  }
  function checkPull() {
    if (!T.settings.pullToAddPage) return;
    const over = overscroll();
    const need = Math.max(90, 150 / E.cam.zoom);
    if (over <= need * 0.35) { stopPull(); return; }
    if (!P.pull.active) { P.pull.active = true; P.pull.t0 = performance.now(); tickPull(); }
  }
  function tickPull() {
    if (!P.pull.active) return;
    const held = performance.now() - P.pull.t0;
    const depth = NW.clamp(overscroll() / Math.max(120, 200 / E.cam.zoom), 0, 1);
    const prog = NW.clamp((held / 620) * 0.65 + depth * 0.45, 0, 1);
    NW.emit('pull:progress', prog);
    if (prog >= 1) { stopPull(); NW.emit('page:autoadd'); return; }
    P.pull.raf = requestAnimationFrame(tickPull);
  }
  function stopPull() {
    if (!P.pull.active) return;
    P.pull.active = false; cancelAnimationFrame(P.pull.raf);
    NW.emit('pull:progress', 0);
  }

  /* ═══════════ drawing ═══════════ */

  function startStroke(ev, hit) {
    P.mode = 'draw';
    const isHL = T.tool === 'highlighter';
    const o = isHL ? T.opts.highlighter : (T.tool === 'shape' ? T.opts.shape : T.opts.pen);
    const t0 = tiltOf(ev);
    P.draw = {
      tool: T.tool,
      pageIndex: hit.index, page: hit.page,
      pts: [{ x: hit.x, y: hit.y, p: pressureOf(ev), t: t0 }],
      color: o.color, size: o.size,
      opts: o,
      pointerType: ev.pointerType,
      /* does this stroke need the variable-width renderer? pressure always
         does; tilt only once the pen is actually leaning */
      varies: !!T.opts.pen.pressure || Math.abs(t0 - 1) > 0.02,
      startT: performance.now(), lastMoveT: performance.now(),
      snapped: null
    };
    setLiveBlend(isHL);
  }

  function pushPoint(ev) {
    const d = P.draw; if (!d) return;
    const pt = local(ev);
    const L = E.layout[d.pageIndex];
    const w = E.toWorld(pt.x, pt.y);
    const x = w.x - L.x, y = w.y - L.y;
    const last = d.pts[d.pts.length - 1];
    const md = Math.hypot(x - last.x, y - last.y);
    if (md < 0.55 / E.cam.zoom) return;
    const t = tiltOf(ev);
    if (!d.varies && Math.abs(t - 1) > 0.02) d.varies = true;
    d.pts.push({ x, y, p: pressureOf(ev), t });
    d.lastMoveT = performance.now();
    d.snapped = null;
  }

  /** "draw it, then hold still" → snap to a shape, like GoodNotes */
  /* ── hold to snap, then drag to adjust ─────────────
     The model the tablet apps have converged on — GoodNotes, Notability and
     Freeform all behave this way: draw, pause *without lifting* and the stroke
     snaps to the shape it recognised, then, still holding, drag to adjust it.
     The handle nearest where you paused follows the nib and every other one
     stays exactly where it is, so a triangle keeps two corners and moves the
     third. Lifting commits the adjusted shape. OneNote is the odd one out — it
     converts only after you lift and gives you nothing to adjust, which is the
     version people complain about, so it is not what we copy.

     For the pen this still sits behind `holdToSnap`, because a gesture that
     reinterprets writing has to be asked for. The shape tool is exempt: asking
     for a shape *is* the opt-in. */
  function maybeHoldSnap() {
    const d = P.draw;
    if (!d || d.tool === 'highlighter') return;
    if (d.tool !== 'shape' && !T.settings.holdToSnap) return;
    if (d.pts.length < 6) return;
    if (performance.now() - d.lastMoveT < 480) return;
    if (d.snapped) return;
    const forced = d.tool === 'shape' ? T.opts.shape.kind : 'auto';
    const sh = forced === 'auto'
      ? NW.shapes.recognize(d.pts, { smoothFallback: false, forceRegular: d.tool === 'shape' && T.opts.shape.regular })
      : forceShape(forced, d.pts, T.opts.shape.regular);
    if (sh && sh.kind !== 'curve') {
      d.snapped = sh;
      d.handle = nearestHandle(sh, d.pts[d.pts.length - 1]);
      drawLive();
      if (navigator.vibrate) try { navigator.vibrate(6); } catch { }
    }
  }

  /** the draggable points of a snapped shape, in page units */
  function boxCorners(cx, cy, hw, hh, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
      .map(([dx, dy]) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }));
  }
  function shapeHandles(sh) {
    if (!sh) return [];
    switch (sh.kind) {
      case 'line': case 'arrow': return [sh.a, sh.b];
      case 'poly': case 'curve': return sh.pts || [];
      case 'rect': return boxCorners(sh.x + sh.w / 2, sh.y + sh.h / 2, sh.w / 2, sh.h / 2, sh.rot || 0);
      case 'ellipse': return boxCorners(sh.cx, sh.cy, Math.abs(sh.rx), Math.abs(sh.ry), sh.rot || 0);
    }
    return [];
  }
  T._shapeHandles = shapeHandles;

  function nearestHandle(sh, pt) {
    const hs = shapeHandles(sh);
    let best = 0, bd = Infinity;
    for (let i = 0; i < hs.length; i++) {
      const dx = hs[i].x - pt.x, dy = hs[i].y - pt.y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  }

  /** Move one handle to `pt`; everything else about the shape holds still. */
  function dragHandle(sh, i, pt) {
    switch (sh.kind) {
      case 'line': case 'arrow':
        if (i === 0) sh.a = { x: pt.x, y: pt.y }; else sh.b = { x: pt.x, y: pt.y };
        return;
      case 'poly': case 'curve':
        if (sh.pts && sh.pts[i]) sh.pts[i] = { x: pt.x, y: pt.y };
        return;
      case 'rect': case 'ellipse': {
        /* A box has no vertex of its own to move — dragging a corner pins the
           opposite one and resizes about it, which is what a corner handle
           means everywhere else in the app. Measured along the shape's own
           axes so a rotated box stays rotated. */
        const rot = sh.rot || 0;
        const anchor = shapeHandles(sh)[(i + 2) % 4];
        if (!anchor) return;
        const c = Math.cos(rot), sn = Math.sin(rot);
        const dx = pt.x - anchor.x, dy = pt.y - anchor.y;
        const lu = dx * c + dy * sn, lv = -dx * sn + dy * c;
        const w = Math.abs(lu), h = Math.abs(lv);
        const ccx = anchor.x + (lu / 2) * c - (lv / 2) * sn;
        const ccy = anchor.y + (lu / 2) * sn + (lv / 2) * c;
        if (sh.kind === 'rect') { sh.w = w; sh.h = h; sh.x = ccx - w / 2; sh.y = ccy - h / 2; }
        else { sh.cx = ccx; sh.cy = ccy; sh.rx = w / 2; sh.ry = h / 2; }
        return;
      }
    }
  }

  /** pen still down after a snap: reshape rather than keep drawing */
  function dragSnapped(ev) {
    const d = P.draw; if (!d || !d.snapped) return;
    const L = E.layout[d.pageIndex]; if (!L) return;
    const pt = local(ev), w = E.toWorld(pt.x, pt.y);
    dragHandle(d.snapped, d.handle || 0, { x: w.x - L.x, y: w.y - L.y });
    d.adjusted = true;
    drawLive();
  }

  /* ── live ink ─────────────────────────────────────
     Redrawing the whole stroke on every pointer event is O(n²) over a long
     stroke, and it is what made writing feel like it was dragging behind the
     nib. Instead the pen appends only the new segments, and everything else
     redraws at most once per frame. */
  let liveQueued = false;
  function scheduleLive() {
    const d = P.draw;
    if (d && P.mode === 'draw' && d.tool === 'pen' && !d.snapped) { appendLive(); return; }
    if (liveQueued) return;
    liveQueued = true;
    requestAnimationFrame(() => { liveQueued = false; drawLive(); });
  }

  function liveTransform() {
    const d = P.draw; if (!d) return null;
    const L = E.layout[d.pageIndex]; if (!L) return null;
    const s = E.toScreen(L.x, L.y);
    lctx.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
    lctx.save();
    lctx.beginPath();
    lctx.rect(s.x, s.y, L.w * E.cam.zoom, L.h * E.cam.zoom);
    lctx.clip();
    lctx.translate(s.x, s.y); lctx.scale(E.cam.zoom, E.cam.zoom);
    E.renderScale = E.cam.zoom * E.dpr;   // live ink obeys the same width floor
    return L;
  }

  /** Draw only the samples added since last time.
      No array slicing and no throwaway item object — this runs on every
      pointer event, several times per frame with coalesced input, so it has to
      cost almost nothing. Because the renderer lays down a disc at every
      sample, successive appends overlap seamlessly; there is no join to hide. */
  function appendLive() {
    const d = P.draw; if (!d) return;
    const from = Math.max(0, (d.drawnTo || 1) - 1);
    if (d.pts.length - from < 2) return;
    if (!liveTransform()) return;
    lctx.fillStyle = d.color;
    lctx.strokeStyle = d.color;
    /* Tilt varies the width just as pressure does, so a laid-over pen needs the
       variable-width renderer even with pressure switched off — otherwise Tilt
       was a checkbox that did nothing unless Pressure happened to be on too. */
    if (d.varies) {
      E.fillVariableStroke(lctx, d.pts, d.size, from, null, !!T.opts.pen.pressure);
    } else {
      lctx.lineWidth = d.size; lctx.lineCap = 'round'; lctx.lineJoin = 'round';
      lctx.beginPath();
      lctx.moveTo(d.pts[from].x, d.pts[from].y);
      for (let i = from + 1; i < d.pts.length; i++) lctx.lineTo(d.pts[i].x, d.pts[i].y);
      lctx.stroke();
    }
    d.drawnTo = d.pts.length;
    lctx.restore();
  }

  function drawLive() {
    const d = P.draw; if (!d) { clearLive(); return; }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, E.live.width, E.live.height);
    if (!liveTransform()) return;
    d.drawnTo = d.pts.length;

    if (P.mode === 'erase') {
      // requirement 15a — a soft grey trail shows exactly what will go
      lctx.strokeStyle = 'rgba(140,146,158,.45)';
      lctx.lineWidth = T.opts.eraser.size;
      lctx.lineCap = 'round'; lctx.lineJoin = 'round';
      lctx.beginPath(); lctx.moveTo(d.pts[0].x, d.pts[0].y);
      for (const p of d.pts) lctx.lineTo(p.x, p.y);
      lctx.stroke();
      lctx.strokeStyle = 'rgba(90,96,110,.75)'; lctx.lineWidth = 1.2 / E.cam.zoom;
      lctx.setLineDash([5 / E.cam.zoom, 4 / E.cam.zoom]); lctx.stroke(); lctx.setLineDash([]);
    } else if (P.mode === 'lasso') {
      const path = () => {
        lctx.beginPath(); lctx.moveTo(d.pts[0].x, d.pts[0].y);
        for (const p of d.pts) lctx.lineTo(p.x, p.y);
      };
      path(); lctx.fillStyle = 'rgba(128,128,128,.09)'; lctx.fill();
      E.marchingAnts(lctx, path, E.cam.zoom);
    } else if (d.snapped) {
      E.drawItem(lctx, shapeItem(d, d.snapped), d.page);
    } else {
      E.drawItem(lctx, strokeItem(d, true), d.page);
    }
    lctx.restore();
  }
  function clearLive() {
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, E.live.width, E.live.height);
    setLiveBlend(false);
  }

  /**
   * The live canvas sits *above* the paper, so a `multiply` composite drawn
   * inside it has nothing underneath to multiply against — which is why a
   * highlighter buried the words while the stroke was being drawn and only
   * turned translucent on pen-up, once it was redrawn onto the page itself.
   * Blending the whole live layer instead multiplies it against the paper in
   * the compositor, so the stroke looks the same the whole way through.
   */
  function setLiveBlend(on) {
    if (E.live && E.live.classList) E.live.classList.toggle('blend-multiply', !!on);
  }

  function strokeItem(d, live, fromIndex) {
    const isHL = d.tool === 'highlighter';
    let pts = fromIndex ? d.pts.slice(fromIndex) : d.pts;
    if (!live && T.opts.pen.smooth && !isHL && pts.length > 3) pts = G.smooth(pts, 1, 1);
    if (isHL && d.opts.straight && pts.length > 1) pts = [pts[0], pts[pts.length - 1]];
    return {
      id: NW.uid('i_'), type: 'stroke', tool: isHL ? 'highlighter' : 'pen',
      color: d.color, size: d.size,
      pressure: isHL ? false : T.opts.pen.pressure,
      chisel: isHL ? d.opts.chisel : undefined,
      opacity: isHL ? d.opts.opacity : 1,
      straight: isHL ? d.opts.straight : false,
      pts: pts.map(p => {
        const q = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), p: +(p.p || .5).toFixed(3) };
        // only carry tilt when it actually varies the width — keeps files small
        if (p.t && Math.abs(p.t - 1) > 0.02) q.t = +p.t.toFixed(3);
        return q;
      })
    };
  }
  function shapeItem(d, sh) {
    const o = T.opts.shape;
    return {
      id: NW.uid('i_'), type: 'shape', shape: sh,
      color: d.tool === 'shape' ? o.color : d.color,
      size: d.tool === 'shape' ? o.size : d.size,
      fill: d.tool === 'shape' ? (o.fill || '') : '',
      tool: d.tool === 'highlighter' ? 'highlighter' : 'pen'
    };
  }

  /** Throw the in-progress stroke away without committing it. */
  function abortStroke() { P.draw = null; P.mode = null; clearLive(); releaseDraw(); }
  T.abortStroke = abortStroke;

  function endStroke() {
    const d = P.draw; P.draw = null;
    clearLive();
    if (!d || !d.pts.length) return;
    commitStroke(d);
  }

  function commitStroke(d) {
    const page = d.page;

    /* requirement 15b — scribble over your own ink with the pen and it goes */
    if (d.tool === 'pen' && T.settings.scribbleWhileWriting && !d.snapped) {
      const sc = NW.shapes.detectScribble(d.pts);
      if (sc.isScribble) {
        const victims = itemsCrossedBy(page, d.pts, d.size);
        if (victims.length) {
          E.removeItems(page, victims, 'scribble erase');
          if (navigator.vibrate) try { navigator.vibrate(10); } catch { }
          return;
        }
      }
    }

    /* An adjusted snap is the user's shape, not a guess — re-recognising the
       raw points here would throw the adjustment away. */
    if (d.snapped) { E.addItems(page, [shapeItem(d, d.snapped)], 'snap shape'); return; }

    if (d.tool === 'shape') {
      const forced = T.opts.shape.kind;
      let sh = forced === 'auto'
        ? NW.shapes.recognize(d.pts, { forceRegular: T.opts.shape.regular })
        : forceShape(forced, d.pts, T.opts.shape.regular);
      if (!sh) sh = { kind: 'curve', pts: G.smooth(d.pts, 2, 1).map(p => ({ x: p.x, y: p.y })), closed: false };
      E.addItems(page, [shapeItem(d, sh)], 'shape');
      return;
    }

    T._lastInkAt = performance.now();
    E.addItems(page, [strokeItem(d, false)], 'ink');
  }

  function forceShape(kind, pts, regular) {
    const bb = G.bbox(pts);
    const a = pts[0], b = pts[pts.length - 1];
    switch (kind) {
      case 'line': return { kind: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
      case 'arrow': return { kind: 'arrow', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
      case 'rect': {
        let w = bb.w, h = bb.h; if (regular) { const m = Math.max(w, h); w = h = m; }
        return { kind: 'rect', x: bb.x0, y: bb.y0, w, h, rot: 0 };
      }
      case 'ellipse': {
        let rx = bb.w / 2, ry = bb.h / 2; if (regular) { const m = Math.max(rx, ry); rx = ry = m; }
        return { kind: 'ellipse', cx: bb.x0 + bb.w / 2, cy: bb.y0 + bb.h / 2, rx, ry, rot: 0 };
      }
      case 'triangle':
        return { kind: 'poly', closed: true, sub: 'triangle',
          pts: [{ x: bb.x0 + bb.w / 2, y: bb.y0 }, { x: bb.x1, y: bb.y1 }, { x: bb.x0, y: bb.y1 }] };
      default: return NW.shapes.recognize(pts, { forceRegular: regular });
    }
  }

  /* ═══════════ erasers ═══════════ */

  function startErase(ev, hit) {
    P.mode = 'erase';
    P.draw = { tool: 'eraser', pageIndex: hit.index, page: hit.page, pts: [{ x: hit.x, y: hit.y }], removed: [], startT: performance.now() };
  }

  function passesFilter(it) {
    const o = T.opts.eraser;
    if (o.inkOnly && it.type !== 'stroke' && it.type !== 'shape') return false;
    if (o.highlighterOnly && !(it.type === 'stroke' && it.tool === 'highlighter')) return false;
    return true;
  }

  /** the sweep eraser: anything the grey trail touches */
  function itemsUnderPath(page, path, radius) {
    return page.items.filter(it => passesFilter(it) && E.pathHitsItem(path, radius, it));
  }

  /**
   * The scribble eraser: only what the scribble genuinely went over.
   *
   * Two crossings minimum, so a single line drawn *through* something leaves
   * it alone — that is a strike-through or a stem of a letter, not a delete.
   * Nearby items are untouched however close they are, because proximity
   * never enters into it.
   */
  function itemsCrossedBy(page, path, nibSize) {
    const box = G.bbox(path, 2);
    const reach = Math.max(7, (nibSize || 3) * 1.5);
    return page.items.filter(it => {
      if (!passesFilter(it)) return false;
      if (it.type === 'image' || it.type === 'text' || it.type === 'fill') {
        /* Either the scribble swallowed it, or the scribble ran across it.
           Only the first was checked, so a word scribbled through the middle
           kept its typed text and lost only the highlighter sitting on it. */
        if (E.itemCoverage(box, it) > 0.6) return true;
        return E.pathInsideItem(path, it) >= 0.25;
      }
      // crossed back and forth, or run over along its length
      if (E.pathCrossings(path, it, 2) >= 2) return true;
      return E.pathCoverage(path, it, reach) >= 0.7;
    });
  }

  /** area eraser deletes as it sweeps; every hit joins one undo step */
  function eraseStep() {
    if (T.opts.eraser.mode !== 'area') return;
    const d = P.draw; if (!d || d.pts.length < 2) return;
    const tail = d.pts.slice(-4);
    const r = T.opts.eraser.size / 2;
    const gone = itemsUnderPath(d.page, tail, r);
    if (!gone.length) return;
    for (const it of gone) {
      const i = d.page.items.indexOf(it);
      if (i >= 0) { d.removed.push({ it, i }); d.page.items.splice(i, 1); }
    }
    E.commitPage(d.page);
  }

  function endErase() {
    const d = P.draw; P.draw = null; clearLive();
    if (!d) return;
    const page = d.page;

    if (T.opts.eraser.mode === 'scribble') {
      /* A single line drawn through something is a strike-through — a mark
         people make on purpose — so it no longer deletes anything. Only a
         real scribble does. */
      const sc = NW.shapes.detectScribble(d.pts, { minLength: 40 });
      if (sc.isScribble) {
        const victims = itemsCrossedBy(page, d.pts, d.size);
        if (victims.length) E.removeItems(page, victims, 'scribble erase');
      }
      return;
    }

    /* area mode: fold every sweep deletion into one undoable step */
    const rec = d.removed;
    if (!rec.length) return;
    rec.sort((a, b) => a.i - b.i);
    E.History.push({
      label: 'erase',
      redo() { for (const r of rec) { const i = page.items.indexOf(r.it); if (i >= 0) page.items.splice(i, 1); } E.commitPage(page); },
      undo() { for (const r of rec) page.items.splice(Math.min(r.i, page.items.length), 0, r.it); E.commitPage(page); }
    });
    E.commitPage(page);
  }

  /* ═══════════ lasso: circle it, then move it ═══════════ */

  function startLasso(ev, hit) {
    /* Tapping straight onto something selects it, rather than making you draw
       a loop around it first. That is what makes a text box directly movable
       and resizable once it exists: tap it and drag to move, or take a corner
       handle to resize. Drawing a loop still works for picking up several
       things at once — this only short-circuits the single-item case. */
    const grabbed = E.hitItemAt(hit.page, { x: hit.x, y: hit.y }, 8 / E.cam.zoom);
    if (grabbed) {
      E.selection = {
        pageIndex: hit.index, page: hit.page, items: [grabbed],
        poly: null, bbox: E.selectionBBox([grabbed]), moved: true
      };
      E.invalidate(); NW.emit('selection');
      startMove(ev, hit);
      return;
    }
    P.mode = 'lasso';
    P.draw = { tool: 'lasso', pageIndex: hit.index, page: hit.page, pts: [{ x: hit.x, y: hit.y }] };
  }

  function endLasso() {
    const d = P.draw; P.draw = null; clearLive();
    if (!d || d.pts.length < 4) { T.clearSelection(); return; }
    const poly = G.rdp(d.pts, 1.5);
    const bb = G.bbox(poly);
    const f = T.opts.lasso.filter;
    const items = d.page.items.filter(it => {
      if (f === 'ink' && !(it.type === 'stroke' || it.type === 'shape')) return false;
      if (f === 'image' && it.type !== 'image') return false;
      if (f === 'text' && it.type !== 'text') return false;
      return E.itemInLasso(poly, bb, it, T.opts.lasso.mode === 'touch' ? 'touch' : 'contain');
    });
    if (!items.length) { T.clearSelection(); NW.toast('Nothing inside that loop', 1100); return; }
    E.selection = { pageIndex: d.page === E.pages[d.pageIndex] ? d.pageIndex : d.pageIndex, page: d.page, items, poly, bbox: E.selectionBBox(items), moved: false };
    E.invalidate(); NW.emit('selection');
  }

  T.clearSelection = function () { if (E.selection) { E.selection = null; E.invalidate(); NW.emit('selection'); } };

  function insideSelection(hit) {
    const s = E.selection; if (!s) return false;
    if (s.poly && !s.moved && G.inPoly({ x: hit.x, y: hit.y }, s.poly)) return true;
    const b = s.bbox;
    return hit.x >= b.x0 - 8 && hit.x <= b.x1 + 8 && hit.y >= b.y0 - 8 && hit.y <= b.y1 + 8;
  }
  function handleAt(hit) {
    const s = E.selection; if (!s) return null;
    const b = s.bbox, r = 12 / E.cam.zoom;
    const corners = { nw: [b.x0, b.y0], ne: [b.x1, b.y0], se: [b.x1, b.y1], sw: [b.x0, b.y1] };
    for (const k in corners) {
      const [x, y] = corners[k];
      if (Math.hypot(hit.x - x, hit.y - y) < r) return k;
    }
    return null;
  }

  function startMove(ev, hit) {
    P.mode = 'move';
    P.gesture = { start: { x: hit.x, y: hit.y }, dx: 0, dy: 0, sel: E.selection, screen0: local(ev) };
    NW.emit('selection:drag', true);
  }
  function updateMove(pt) {
    const g = P.gesture; if (!g) return;
    const dx = (pt.x - g.screen0.x) / E.cam.zoom, dy = (pt.y - g.screen0.y) / E.cam.zoom;
    applyTransform(g.sel, p => ({ x: p.x + (dx - g.dx), y: p.y + (dy - g.dy) }));
    g.dx = dx; g.dy = dy;
    g.sel.moved = true;
    g.sel.bbox = E.selectionBBox(g.sel.items);
    E.commitPage(g.sel.page);
    NW.emit('selection');
  }
  function endMove() {
    const g = P.gesture; P.gesture = null; P.mode = null;
    if (!g || (Math.abs(g.dx) < .4 && Math.abs(g.dy) < .4)) { NW.emit('selection:drag', false); return; }
    const sel = g.sel, dx = g.dx, dy = g.dy;
    E.History.push({
      label: 'move',
      redo() { applyTransform(sel, p => ({ x: p.x + dx, y: p.y + dy })); sel.bbox = E.selectionBBox(sel.items); E.commitPage(sel.page); },
      undo() { applyTransform(sel, p => ({ x: p.x - dx, y: p.y - dy })); sel.bbox = E.selectionBBox(sel.items); E.commitPage(sel.page); }
    });
    NW.emit('selection:drag', false);
  }

  function startScale(ev, hit, corner) {
    P.mode = 'scale';
    const s = E.selection, b = s.bbox;
    const anchor = { x: corner === 'nw' || corner === 'sw' ? b.x1 : b.x0, y: corner === 'nw' || corner === 'ne' ? b.y1 : b.y0 };
    P.gesture = { sel: s, anchor, b0: { ...b }, k: 1, corner, start: { x: hit.x, y: hit.y } };
  }
  function updateScale(pt) {
    const g = P.gesture; if (!g) return;
    const hit = E.toPage(pt.x, pt.y); if (!hit) return;
    const d0 = Math.hypot(g.start.x - g.anchor.x, g.start.y - g.anchor.y) || 1;
    const d1 = Math.hypot(hit.x - g.anchor.x, hit.y - g.anchor.y);
    const want = NW.clamp(d1 / d0, 0.1, 12);
    const k = want / g.k;
    scaleSel(g.sel, g.anchor, k);
    g.k = want;
    g.sel.bbox = E.selectionBBox(g.sel.items);
    E.commitPage(g.sel.page); NW.emit('selection');
  }
  function endScale() {
    const g = P.gesture; P.gesture = null; P.mode = null;
    if (!g || Math.abs(g.k - 1) < 0.01) return;
    const sel = g.sel, anchor = g.anchor, k = g.k;
    E.History.push({
      label: 'resize',
      redo() { scaleSel(sel, anchor, k); sel.bbox = E.selectionBBox(sel.items); E.commitPage(sel.page); },
      undo() { scaleSel(sel, anchor, 1 / k); sel.bbox = E.selectionBBox(sel.items); E.commitPage(sel.page); }
    });
  }
  function scaleSel(sel, anchor, k) {
    applyTransform(sel, p => ({ x: anchor.x + (p.x - anchor.x) * k, y: anchor.y + (p.y - anchor.y) * k }), k);
  }

  /** map every point of the selection through fn; `k` also scales stroke weight */
  function applyTransform(sel, fn, k) {
    for (const it of sel.items) {
      if (it.type === 'stroke') { for (const p of it.pts) { const q = fn(p); p.x = q.x; p.y = q.y; } if (k) it.size *= k; }
      else if (it.type === 'shape') {
        const sh = it.shape;
        if (sh.kind === 'line' || sh.kind === 'arrow') { sh.a = fn(sh.a); sh.b = fn(sh.b); }
        else if (sh.kind === 'rect') {
          const tl = fn({ x: sh.x, y: sh.y }), br = fn({ x: sh.x + sh.w, y: sh.y + sh.h });
          sh.x = Math.min(tl.x, br.x); sh.y = Math.min(tl.y, br.y);
          sh.w = Math.abs(br.x - tl.x); sh.h = Math.abs(br.y - tl.y);
        } else if (sh.kind === 'ellipse') {
          const c = fn({ x: sh.cx, y: sh.cy });
          const e = fn({ x: sh.cx + sh.rx, y: sh.cy + sh.ry });
          sh.cx = c.x; sh.cy = c.y; sh.rx = Math.abs(e.x - c.x) || sh.rx; sh.ry = Math.abs(e.y - c.y) || sh.ry;
        } else if (sh.pts) sh.pts = sh.pts.map(fn);
        if (k) it.size *= k;
      } else {
        const tl = fn({ x: it.x, y: it.y }), br = fn({ x: it.x + it.w, y: it.y + (it.h || 10) });
        it.x = Math.min(tl.x, br.x); it.y = Math.min(tl.y, br.y);
        it.w = Math.abs(br.x - tl.x); it.h = Math.abs(br.y - tl.y);
        if (it.type === 'text' && k) it.size = Math.max(6, it.size * k);
      }
      E.dirtyItem(it);
    }
  }
  T.applyTransform = applyTransform;

  /* selection actions used by the floating bubble */
  T.selAction = function (act) {
    const s = E.selection; if (!s || !s.items.length) return;
    const page = s.page, items = s.items.slice();
    switch (act) {
      case 'delete': E.removeItems(page, items, 'delete'); T.clearSelection(); break;
      case 'cut': T.clipboard = NW.deepClone(items); E.removeItems(page, items, 'cut'); T.clearSelection(); NW.toast('Cut'); break;
      case 'copy': {
        const clones = NW.deepClone(items).map(it => { it.id = NW.uid('i_'); delete it._bb; return it; });
        const sel = { items: clones, page };
        applyTransform(sel, p => ({ x: p.x + 26, y: p.y + 26 }));
        E.addItems(page, clones, 'duplicate');
        E.selection = { pageIndex: s.pageIndex, page, items: clones, poly: null, bbox: E.selectionBBox(clones), moved: true };
        NW.emit('selection'); break;
      }
      case 'front': {
        const before = page.items.slice();
        E.mutate(page, () => { for (const it of items) { const i = page.items.indexOf(it); if (i >= 0) { page.items.splice(i, 1); page.items.push(it); } } },
          () => { page.items.length = 0; page.items.push(...before); }, 'bring to front');
        break;
      }
      case 'back': {
        const before = page.items.slice();
        E.mutate(page, () => { for (let k = items.length - 1; k >= 0; k--) { const it = items[k], i = page.items.indexOf(it); if (i >= 0) { page.items.splice(i, 1); page.items.unshift(it); } } },
          () => { page.items.length = 0; page.items.push(...before); }, 'send to back');
        break;
      }
      case 'color': NW.emit('ui:recolor', items); break;
      case 'scale': NW.toast('Drag a corner handle to resize', 1600); break;
    }
  };

  T.recolor = function (items, color) {
    const page = E.selection ? E.selection.page : E.pages[E.active];
    const before = items.map(it => ({ it, c: it.color, f: it.fill }));
    E.mutate(page,
      () => { for (const it of items) { if (it.type === 'text') it.color = color; else { it.color = color; if (it.fill) it.fill = color; } } },
      () => { for (const r of before) { r.it.color = r.c; r.it.fill = r.f; } },
      'recolour');
  };

  T.paste = function () {
    if (!T.clipboard || !T.clipboard.length) return;
    const page = E.pages[E.active]; if (!page) return;
    const clones = NW.deepClone(T.clipboard).map(it => { it.id = NW.uid('i_'); delete it._bb; return it; });
    E.addItems(page, clones, 'paste');
    E.selection = { pageIndex: E.active, page, items: clones, poly: null, bbox: E.selectionBBox(clones), moved: true };
    NW.emit('selection');
  };

  T.selectAll = function () {
    const page = E.pages[E.active]; if (!page || !page.items.length) return;
    E.selection = { pageIndex: E.active, page, items: page.items.slice(), poly: null, bbox: E.selectionBBox(page.items), moved: true };
    T.setTool('lasso'); E.invalidate(); NW.emit('selection');
  };

  /* ═══════════ requirement 7: paint bucket ═══════════ */

  async function doFill(hit) {
    const page = hit.page;
    if (!hit.inside) return;
    await E.preloadPage(page);
    NW.toast('Filling…', 700);
    await new Promise(r => setTimeout(r, 0));

    const scale = NW.clamp(1400 / Math.max(page.w, page.h), 0.5, 1);
    /* Boundaries come from what you drew, not from the paper. Rendering the
       template too meant every rule and every dot of a grid was a colour
       mismatch the flood could not cross, so a shape drawn on lined paper
       filled in stripes and one on dotted paper came out pocked. Ink still
       stops the fill; the ruling no longer does. */
    const src = E.renderPageTo(page, scale, { background: false });
    const w = src.width, h = src.height;
    const ctx = src.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const sx = Math.round(hit.x * scale), sy = Math.round(hit.y * scale);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

    const si = (sy * w + sx) * 4;
    const tr = d[si], tg = d[si + 1], tb = d[si + 2];
    const tol = T.opts.fill.tolerance;
    const tol2 = tol * tol * 3;

    const mask = new Uint8Array(w * h);
    const stack = [sy * w + sx];
    let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;

    const match = i => {
      const o = i * 4;
      const dr = d[o] - tr, dg = d[o + 1] - tg, db = d[o + 2] - tb;
      return dr * dr + dg * dg + db * db <= tol2;
    };

    while (stack.length) {
      let i = stack.pop();
      if (mask[i]) continue;
      let y = (i / w) | 0, xl = i - y * w, xr = xl;
      while (xl > 0 && !mask[y * w + xl - 1] && match(y * w + xl - 1)) xl--;
      while (xr < w - 1 && !mask[y * w + xr + 1] && match(y * w + xr + 1)) xr++;
      for (let x = xl; x <= xr; x++) {
        const k = y * w + x;
        mask[k] = 1; count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (y > 0) { const u = k - w; if (!mask[u] && match(u)) stack.push(u); }
        if (y < h - 1) { const v = k + w; if (!mask[v] && match(v)) stack.push(v); }
      }
      if (stack.length > 4_000_000) break;
    }

    if (!count) { NW.toast('Nothing to fill there'); return; }
    if (count > w * h * 0.985) { NW.toast('That would flood the whole page — draw a boundary first', 2200); return; }

    /* grow by `gap` px so the fill tucks under the ink instead of leaving a halo */
    const grow = NW.clamp(T.opts.fill.gap | 0, 0, 3);
    let m2 = mask;
    for (let g = 0; g < grow; g++) {
      const nm = m2.slice();
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        if (m2[k]) continue;
        if (m2[k - 1] || m2[k + 1] || m2[k - w] || m2[k + w]) { nm[k] = 1; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      m2 = nm;
    }

    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const out = document.createElement('canvas'); out.width = bw; out.height = bh;
    const octx = out.getContext('2d');
    const odata = octx.createImageData(bw, bh);
    const c = NW.hexToRgb(T.opts.fill.color);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!m2[(y + minY) * w + (x + minX)]) continue;
      const o = (y * bw + x) * 4;
      odata.data[o] = c.r; odata.data[o + 1] = c.g; odata.data[o + 2] = c.b; odata.data[o + 3] = 255;
    }
    octx.putImageData(odata, 0, 0);

    const item = {
      id: NW.uid('i_'), type: 'fill',
      x: minX / scale, y: minY / scale, w: bw / scale, h: bh / scale,
      data: out.toDataURL('image/png'), opacity: T.opts.fill.opacity != null ? T.opts.fill.opacity : 1
    };
    await new Promise(res => { E.warmImage(item.data, page.id); NW.loadImage(item.data).then(i2 => { E.imgCache.set(item.data, i2); res(); }).catch(res); });

    /* Fills sit under the ink so your writing is never buried — but they must
       still stack above *each other*, or filling an already-filled region drops
       the new colour underneath the old one and nothing appears to happen.
       Land above the run of existing fills and below everything else, and drop
       any earlier fill this one completely repaints so they cannot pile up. */
    let at = 0;
    while (at < page.items.length && page.items[at].type === 'fill') at++;
    const nb2 = { x0: item.x, y0: item.y, x1: item.x + item.w, y1: item.y + item.h };
    const buried = page.items.slice(0, at).filter(f => {
      const b = E.itemBBox(f);
      return b.x0 >= nb2.x0 - 0.5 && b.y0 >= nb2.y0 - 0.5 && b.x1 <= nb2.x1 + 0.5 && b.y1 <= nb2.y1 + 0.5;
    });
    const where = buried.map(f => ({ f, i: page.items.indexOf(f) })).sort((a2, b3) => a2.i - b3.i);
    E.History.do({
      label: 'fill',
      redo() {
        for (let k = where.length - 1; k >= 0; k--) {
          const i = page.items.indexOf(where[k].f);
          if (i >= 0) page.items.splice(i, 1);
        }
        let a2 = 0;
        while (a2 < page.items.length && page.items[a2].type === 'fill') a2++;
        page.items.splice(a2, 0, item);
        E.commitPage(page);
      },
      undo() {
        const i = page.items.indexOf(item); if (i >= 0) page.items.splice(i, 1);
        for (const r of where) page.items.splice(Math.min(r.i, page.items.length), 0, r.f);
        E.commitPage(page);
      }
    });
  }
  T.doFill = doFill;

  /* ═══════════ images ═══════════ */
  T.insertImage = async function (dataURL, natW, natH, pageIndex) {
    const idx = pageIndex != null ? pageIndex : E.active;
    const page = E.pages[idx]; if (!page) return;
    const fitted = await NW.fitImage(dataURL, 1900);
    const maxW = page.w * 0.62;
    const s = Math.min(maxW / fitted.w, (page.h * 0.5) / fitted.h, 1.6);
    const w = fitted.w * s, h = fitted.h * s;
    const centre = E.toWorld(E.vw / 2, E.vh / 2);
    const L = E.layout[idx];
    const cx = NW.clamp(centre.x - L.x, w / 2 + 12, page.w - w / 2 - 12);
    const cy = NW.clamp(centre.y - L.y, h / 2 + 12, page.h - h / 2 - 12);
    const item = { id: NW.uid('i_'), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, rot: 0, data: fitted.data, opacity: 1 };
    try { E.imgCache.set(item.data, await NW.loadImage(item.data)); } catch { }
    E.addItems(page, [item], 'image');
    E.selection = { pageIndex: idx, page, items: [item], poly: null, bbox: E.selectionBBox([item]), moved: true };
    T.setTool('lasso'); NW.emit('selection');
  };

  /* ── page helper used by the pull gesture and the + button ── */
  /** New page. With no argument it copies the last page's look — which is what
      the pull-past-the-bottom gesture wants. */
  T.addPage = async function (over, atIndex) {
    const nb = E.nb; if (!nb) return;
    const from = E.pages[E.pages.length - 1];
    if (!over && from) {
      const sz = Object.keys(NW.PAPER).find(k => {
        const P = NW.PAPER[k];
        return (P.w === from.w && P.h === from.h) || (P.h === from.w && P.w === from.h);
      });
      over = { template: from.template, paperColor: from.paper, size: sz || nb.paper, landscape: from.w > from.h };
    }
    const page = NW.Lib.blankPage(nb, over || {});
    const at = atIndex == null ? E.pages.length : atIndex;
    E.pages.splice(at, 0, page);
    nb.pageIds.splice(at, 0, page.id);
    NW.Lib.pageCache.set(page.id, page);
    NW.Lib.markPage(page); NW.Lib.touch(nb);
    E.relayout(); E.invalidate();
    NW.emit('pages:changed');
    return page;
  };

  T.deletePage = function (index) {
    if (E.pages.length <= 1) { NW.toast('A notebook needs at least one page'); return; }
    const page = E.pages[index];
    E.pages.splice(index, 1);
    E.nb.pageIds.splice(index, 1);
    NW.Lib.touch(E.nb);
    E.relayout(); E.invalidate(); NW.emit('pages:changed');
    NW.toast('Page deleted');
  };

  T.duplicatePage = async function (index) {
    const src = E.pages[index];
    const copy = NW.deepClone(src); copy.id = NW.uid('p_'); copy.rev = 1;
    copy.items.forEach(it => { it.id = NW.uid('i_'); delete it._bb; });
    E.pages.splice(index + 1, 0, copy);
    E.nb.pageIds.splice(index + 1, 0, copy.id);
    NW.Lib.pageCache.set(copy.id, copy);
    NW.Lib.markPage(copy); NW.Lib.touch(E.nb);
    E.relayout(); E.invalidate(); NW.emit('pages:changed');
  };

  T.setPageTemplate = function (index, tpl, paper) {
    const page = E.pages[index]; if (!page) return;
    const before = { template: page.template, paper: page.paper, bg: page.bg, inkColor: page.inkColor };
    const pc = NW.paperColor(paper || page.paper);
    E.mutate(page,
      () => { page.template = tpl; page.paper = paper || page.paper; page.bg = pc.bg; page.inkColor = pc.ink; },
      () => { Object.assign(page, before); }, 'page style');
  };

})(window.NW);
