/* ═══════════════ NoteWell — templates.js ═══════════════
   Paper sizes + page rulings (lined, grid, dotted, blank, …).
   Every template is a pure painter: draw(ctx, w, h, opts). */
(function (NW) {
  'use strict';

  /* Logical page units ≈ 150 dpi so exported PDFs stay crisp. */
  NW.PAPER = {
    a4:      { name: 'A4',        w: 1240, h: 1754 },
    letter:  { name: 'US Letter', w: 1275, h: 1650 },
    a5:      { name: 'A5',        w: 874,  h: 1240 },
    square:  { name: 'Square',    w: 1400, h: 1400 },
    wide:    { name: 'Wide 16:9', w: 1920, h: 1080 },
    tablet:  { name: 'Tablet',    w: 1440, h: 1080 }
  };

  /* Neutral papers only — the interface is black and white, so the only
     colour anywhere on screen is the colour you put on the page yourself. */
  NW.PAPER_COLORS = [
    { id: 'white',  name: 'White',      bg: '#ffffff', ink: '#d3d2ce' },
    { id: 'cream',  name: 'Ivory',      bg: '#fbf8f1', ink: '#d9d2c2' },
    { id: 'grey',   name: 'Soft grey',  bg: '#f2f2f0', ink: '#cfcecb' },
    { id: 'mint',   name: 'Newsprint',  bg: '#eeeae1', ink: '#cdc7b9' },
    { id: 'night',  name: 'Graphite',   bg: '#22221f', ink: '#3b3b37' },
    { id: 'black',  name: 'Blackboard', bg: '#121210', ink: '#2b2b28' }
  ];
  NW.paperColor = id => NW.PAPER_COLORS.find(c => c.id === id) || NW.PAPER_COLORS[0];
  /* Ink colour that reads well on a given paper. */
  NW.defaultInkFor = id => (id === 'night' || id === 'black') ? '#f2f1ec' : '#16150f';

  const M = 0.055;  // page margin as a fraction of width

  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  NW.TEMPLATES = {
    blank: {
      name: 'Blank', draw() {}
    },

    lined: {
      name: 'Lined',
      draw(ctx, w, h, o) {
        const gap = h / 34, m = w * M;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 1;
        for (let y = gap * 2; y < h - gap * .6; y += gap) line(ctx, m, y, w - m, y);
      }
    },

    linedNarrow: {
      name: 'Narrow ruled',
      draw(ctx, w, h, o) {
        const gap = h / 48, m = w * M;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 1;
        for (let y = gap * 2; y < h - gap * .6; y += gap) line(ctx, m, y, w - m, y);
      }
    },

    margin: {
      name: 'Lined + margin',
      draw(ctx, w, h, o) {
        NW.TEMPLATES.lined.draw(ctx, w, h, o);
        ctx.strokeStyle = NW.withAlpha(o.ink, .95); ctx.lineWidth = 1.6;
        line(ctx, w * 0.155, 0, w * 0.155, h);
        line(ctx, 0, h / 34 * 2 - h / 34, w, h / 34 * 2 - h / 34);
      }
    },

    grid: {
      name: 'Grid',
      draw(ctx, w, h, o) {
        const g = w / 26;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 1;
        ctx.globalAlpha = .85;
        for (let x = g; x < w; x += g) line(ctx, x, 0, x, h);
        for (let y = g; y < h; y += g) line(ctx, 0, y, w, y);
        ctx.globalAlpha = 1;
      }
    },

    gridBold: {
      name: 'Graph 5 mm',
      draw(ctx, w, h, o) {
        const g = w / 50;
        ctx.strokeStyle = o.ink; ctx.lineWidth = .7; ctx.globalAlpha = .6;
        for (let x = g; x < w; x += g) line(ctx, x, 0, x, h);
        for (let y = g; y < h; y += g) line(ctx, 0, y, w, y);
        ctx.globalAlpha = 1; ctx.lineWidth = 1.3;
        for (let x = g * 5; x < w; x += g * 5) line(ctx, x, 0, x, h);
        for (let y = g * 5; y < h; y += g * 5) line(ctx, 0, y, w, y);
      }
    },

    dotted: {
      name: 'Dotted',
      draw(ctx, w, h, o) {
        const g = w / 26, r = Math.max(0.55, w / 1550);
        ctx.fillStyle = o.ink;
        for (let x = g; x < w; x += g)
          for (let y = g; y < h; y += g) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.fill(); }
      }
    },

    dottedWide: {
      name: 'Dotted wide',
      draw(ctx, w, h, o) {
        const g = w / 16, r = Math.max(0.6, w / 1400);
        ctx.fillStyle = o.ink;
        for (let x = g; x < w; x += g)
          for (let y = g; y < h; y += g) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.fill(); }
      }
    },

    cornell: {
      name: 'Cornell',
      draw(ctx, w, h, o) {
        const cue = w * 0.30, sum = h * 0.80, top = h * 0.075, gap = h / 34;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 1;
        for (let y = top + gap; y < sum - gap * .4; y += gap) line(ctx, cue + 14, y, w - w * M, y);
        ctx.lineWidth = 1.8; ctx.strokeStyle = NW.withAlpha(o.ink, .95);
        line(ctx, cue, top, cue, sum);
        line(ctx, w * M * .5, top, w - w * M * .5, top);
        line(ctx, w * M * .5, sum, w - w * M * .5, sum);
        ctx.fillStyle = NW.withAlpha(o.ink, .95);
        ctx.font = `600 ${Math.round(w / 58)}px ${NW.SERIF}`;
        ctx.fillText('Cues', w * M * .6, top - 10);
        ctx.fillText('Notes', cue + 14, top - 10);
        ctx.fillText('Summary', w * M * .6, sum + w / 44);
      }
    },

    todo: {
      name: 'Checklist',
      draw(ctx, w, h, o) {
        const gap = h / 26, m = w * M, box = gap * .46;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 1;
        for (let y = gap * 1.6; y < h - gap * .5; y += gap) {
          ctx.strokeRect(m, y - box, box, box);
          ctx.globalAlpha = .55; line(ctx, m + box + 14, y, w - m, y); ctx.globalAlpha = 1;
        }
      }
    },

    music: {
      name: 'Manuscript',
      draw(ctx, w, h, o) {
        const m = w * M, staves = 10, sh = h / (staves + 1), ls = sh / 9;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 1;
        for (let s = 0; s < staves; s++) {
          const y0 = sh * (s + .8);
          for (let i = 0; i < 5; i++) line(ctx, m, y0 + i * ls, w - m, y0 + i * ls);
          ctx.lineWidth = 1.6; line(ctx, m, y0, m, y0 + 4 * ls); line(ctx, w - m, y0, w - m, y0 + 4 * ls); ctx.lineWidth = 1;
        }
      }
    },

    iso: {
      name: 'Isometric',
      draw(ctx, w, h, o) {
        const g = w / 30, tan = Math.tan(Math.PI / 6);
        ctx.strokeStyle = o.ink; ctx.lineWidth = .8; ctx.globalAlpha = .9;
        for (let x = -h * tan; x < w + h * tan; x += g) { line(ctx, x, 0, x + h * tan, h); line(ctx, x, 0, x - h * tan, h); }
        for (let y = 0; y < h; y += g) line(ctx, 0, y, w, y);
        ctx.globalAlpha = 1;
      }
    },

    planner: {
      name: 'Day planner',
      draw(ctx, w, h, o) {
        const m = w * M, top = h * .1, rows = 14, rh = (h - top - h * .06) / rows;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 1;
        ctx.font = `500 ${Math.round(w / 62)}px ${NW.SERIF}`;
        ctx.fillStyle = NW.withAlpha(o.ink, 1);
        for (let i = 0; i <= rows; i++) {
          const y = top + i * rh;
          line(ctx, m, y, w - m, y);
          if (i < rows) ctx.fillText((7 + i) + ':00', m + 8, y + rh * .58);
        }
        line(ctx, m + w * .085, top, m + w * .085, h - h * .06);
      }
    },

    lab: {
      name: 'Lab / half grid',
      draw(ctx, w, h, o) {
        const half = h * .5, g = w / 26, gap = h / 34, m = w * M;
        ctx.strokeStyle = o.ink; ctx.lineWidth = .9; ctx.globalAlpha = .85;
        for (let x = g; x < w; x += g) line(ctx, x, 0, x, half);
        for (let y = g; y < half; y += g) line(ctx, 0, y, w, y);
        ctx.globalAlpha = 1; ctx.lineWidth = 1;
        for (let y = half + gap; y < h - gap * .5; y += gap) line(ctx, m, y, w - m, y);
        ctx.lineWidth = 1.6; line(ctx, 0, half, w, half);
      }
    }
  };

  NW.templateList = () => Object.keys(NW.TEMPLATES);
  NW.templateName = id => (NW.TEMPLATES[id] || NW.TEMPLATES.blank).name;

  /** Paint the page background (paper colour + ruling) into ctx at 0,0. */
  NW.paintTemplate = function (ctx, page) {
    const pc = NW.paperColor(page.paper || 'white');
    ctx.save();
    ctx.fillStyle = page.bg || pc.bg;
    ctx.fillRect(0, 0, page.w, page.h);
    const t = NW.TEMPLATES[page.template] || NW.TEMPLATES.blank;
    ctx.save();
    try { t.draw(ctx, page.w, page.h, { ink: page.inkColor || pc.ink }); } catch (e) { console.warn(e); }
    ctx.restore();
    ctx.restore();
  };

  /** Small preview canvas of a template (used in the picker). */
  NW.templateThumb = function (tplId, paperId, w) {
    w = w || 96; const h = Math.round(w * 1.414);
    const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
    const ctx = c.getContext('2d'); ctx.scale(2, 2);
    const pc = NW.paperColor(paperId);
    const fake = { w, h, template: tplId, paper: paperId, bg: pc.bg, inkColor: pc.ink };
    NW.paintTemplate(ctx, fake);
    c.style.width = '100%';
    return c;
  };

})(window.NW);
