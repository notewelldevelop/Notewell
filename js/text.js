/* ═══════════════ NoteWell — text.js ═══════════════
   Typed text boxes: tap to place, type, restyle. The full Word font list is
   offered with sensible cross-platform fallbacks so a document written on a
   Mac still looks right on an Android tablet. */
(function (NW) {
  'use strict';
  const E = NW.Engine;

  /* The fonts Microsoft Word ships with, each with a fallback chain that
     survives iPadOS / Android / Linux where the exact face may be missing. */
  NW.FONTS = [
    { name: 'Arial',              css: 'Arial, Helvetica, "Liberation Sans", sans-serif' },
    { name: 'Aptos',              css: 'Aptos, "Segoe UI", Inter, system-ui, sans-serif' },
    { name: 'Bahnschrift',        css: 'Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif' },
    { name: 'Book Antiqua',       css: '"Book Antiqua", Palatino, "Palatino Linotype", serif' },
    { name: 'Bookman Old Style',  css: '"Bookman Old Style", Bookman, Georgia, serif' },
    { name: 'Calibri',            css: 'Calibri, Carlito, "Segoe UI", system-ui, sans-serif' },
    { name: 'Cambria',            css: 'Cambria, Caladea, Georgia, serif' },
    { name: 'Candara',            css: 'Candara, Optima, "Segoe UI", sans-serif' },
    { name: 'Century Gothic',     css: '"Century Gothic", "Apple Gothic", "URW Gothic", sans-serif' },
    { name: 'Comic Sans MS',      css: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive' },
    { name: 'Consolas',           css: 'Consolas, Menlo, "SF Mono", "DejaVu Sans Mono", monospace' },
    { name: 'Constantia',         css: 'Constantia, "Book Antiqua", Georgia, serif' },
    { name: 'Corbel',             css: 'Corbel, "Lucida Grande", "Segoe UI", sans-serif' },
    { name: 'Courier New',        css: '"Courier New", Courier, "Liberation Mono", monospace' },
    { name: 'Franklin Gothic',    css: '"Franklin Gothic Medium", "Arial Narrow", Haettenschweiler, sans-serif' },
    { name: 'Garamond',           css: 'Garamond, "EB Garamond", "Adobe Garamond Pro", "Apple Garamond", Baskerville, "Iowan Old Style", Palatino, Georgia, serif' },
    { name: 'Georgia',            css: 'Georgia, "Times New Roman", serif' },
    { name: 'Helvetica',          css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
    { name: 'Impact',             css: 'Impact, Haettenschweiler, "Arial Black", sans-serif' },
    { name: 'Lucida Sans',        css: '"Lucida Sans Unicode", "Lucida Grande", "Lucida Sans", sans-serif' },
    { name: 'Palatino Linotype',  css: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
    { name: 'Rockwell',           css: 'Rockwell, "Courier Bold", Georgia, serif' },
    { name: 'Segoe UI',           css: '"Segoe UI", system-ui, -apple-system, sans-serif' },
    { name: 'Tahoma',             css: 'Tahoma, Geneva, Verdana, sans-serif' },
    { name: 'Times New Roman',    css: '"Times New Roman", Times, "Liberation Serif", serif' },
    { name: 'Trebuchet MS',       css: '"Trebuchet MS", "Lucida Grande", Tahoma, sans-serif' },
    { name: 'Verdana',            css: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
    { name: 'Wingdings',          css: 'Wingdings, "Zapf Dingbats", sans-serif' }
  ];
  NW.FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 120];
  /* page units are ~150 dpi, so a "12 pt" font is ~25 page units */
  NW.PT = 25 / 12;

  const Text = NW.Text = { editing: null, box: null, _read: null, _place: null };

  Text.tapAt = function (hit) {
    const page = hit.page;
    const existing = E.hitItemAt(page, { x: hit.x, y: hit.y }, 6);
    if (existing && existing.type === 'text') { Text.edit(page, hit.index, existing); return; }

    const o = NW.Tools.opts.text;
    const item = {
      id: NW.uid('i_'), type: 'text',
      x: NW.clamp(hit.x - 4, 8, page.w - 60), y: NW.clamp(hit.y - o.size * 0.6, 8, page.h - 40),
      w: Math.min(page.w * 0.8, page.w - hit.x + 4 + 40), h: o.size * 1.5,
      text: '', font: o.font, fontName: o.fontName, size: o.size, color: o.color,
      bold: o.bold, italic: o.italic, underline: o.underline, align: o.align,
      highlight: o.highlight || '', lineHeight: 1.35
    };
    item.w = Math.max(160, Math.min(page.w - item.x - 12, page.w * 0.8));
    E.addItems(page, [item], 'text');
    Text.edit(page, hit.index, item, true);
  };

  Text.edit = function (page, pageIndex, item, isNew) {
    Text.commit();
    Text.editing = { page, pageIndex, item, isNew, before: { text: item.text } };
    const ov = NW.$('#overlay');
    const box = NW.el('div', { class: 'tbox', contenteditable: 'plaintext-only', spellcheck: 'false' });
    box.textContent = item.text || '';
    ov.appendChild(box);
    Text.box = box;
    item._hidden = true;
    E.invalidate(page.id);
    place();

    /* contenteditable normally exposes innerText; fall back to textContent
       so a stray engine difference can never lose someone's typing. */
    const readBox = () => String(box.innerText != null ? box.innerText : (box.textContent || ''))
      .replace(/ /g, ' ');
    Text._read = readBox;
    box.addEventListener('input', () => { item.text = readBox(); autoHeight(); });
    box.addEventListener('blur', () => setTimeout(() => Text.commit(), 60));
    box.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); box.blur(); }
    });
    box.addEventListener('pointerdown', ev => ev.stopPropagation());
    NW.on('cam', place);
    NW.on('rendered', place);
    setTimeout(() => { box.focus(); if (!isNew) selectAllIn(box); }, 10);
    NW.emit('text:editing', true);

    function place() {
      if (Text.box !== box) return;
      const L = E.layout[pageIndex]; if (!L) return;
      const s = E.toScreen(L.x + item.x, L.y + item.y);
      box.style.left = s.x + 'px';
      box.style.top = s.y + 'px';
      box.style.width = (item.w * E.cam.zoom) + 'px';
      box.style.transform = 'scale(' + E.cam.zoom + ')';
      box.style.width = item.w + 'px';
      box.style.minHeight = (item.size * 1.4) + 'px';
      box.style.font = E.fontCSS(item);
      box.style.color = item.color;
      box.style.textAlign = item.align || 'left';
      box.style.lineHeight = (item.lineHeight || 1.35);
      box.style.textDecoration = item.underline ? 'underline' : 'none';
    }
    Text._place = place;

    function autoHeight() {
      const m = document.createElement('canvas').getContext('2d');
      item.h = E.textHeight(m, item);
      E.dirtyItem(item);
    }
  };

  function selectAllIn(node) {
    const r = document.createRange(); r.selectNodeContents(node);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  Text.commit = function () {
    const ed = Text.editing; if (!ed) return;
    const { page, item, isNew, before } = ed;
    const text = (Text.box && Text._read) ? Text._read() : item.text;
    if (Text.box) { Text.box.remove(); Text.box = null; }
    NW.off('cam', Text._place); NW.off('rendered', Text._place);
    Text.editing = null;
    delete item._hidden;

    item.text = text;
    const m = document.createElement('canvas').getContext('2d');
    item.h = E.textHeight(m, item);
    E.dirtyItem(item);

    if (!text.trim()) {
      const i = page.items.indexOf(item);
      if (i >= 0) { page.items.splice(i, 1); if (isNew) E.History.undo.pop(); }
      E.commitPage(page); NW.emit('text:editing', false);
      return;
    }
    if (!isNew && before.text !== text) {
      const after = text, prev = before.text;
      E.History.push({ label: 'edit text',
        redo() { item.text = after; E.dirtyItem(item); E.commitPage(page); },
        undo() { item.text = prev; E.dirtyItem(item); E.commitPage(page); } });
    }
    E.commitPage(page);
    NW.emit('text:editing', false);
  };

  /** restyle the box being edited, or every text item in the selection */
  Text.applyStyle = function (patch) {
    const targets = [];
    if (Text.editing) targets.push(Text.editing.item);
    else if (E.selection) for (const it of E.selection.items) if (it.type === 'text') targets.push(it);
    Object.assign(NW.Tools.opts.text, patch);
    NW.Tools.saveOpts();
    if (!targets.length) { NW.emit('tool:changed'); return; }
    const page = Text.editing ? Text.editing.page : E.selection.page;
    const before = targets.map(it => NW.deepClone({ font: it.font, fontName: it.fontName, size: it.size, color: it.color, bold: it.bold, italic: it.italic, underline: it.underline, align: it.align, highlight: it.highlight }));
    const m = document.createElement('canvas').getContext('2d');
    E.mutate(page,
      () => { targets.forEach(it => { Object.assign(it, patch); it.h = E.textHeight(m, it); E.dirtyItem(it); }); if (Text._place) Text._place(); },
      () => { targets.forEach((it, i) => { Object.assign(it, before[i]); it.h = E.textHeight(m, it); E.dirtyItem(it); }); if (Text._place) Text._place(); },
      'text style');
    NW.emit('tool:changed');
  };

  /* hide the item on the canvas while its overlay is open */
  const origDraw = E.drawItem;
  E.drawItem = function (ctx, it, page) {
    if (it._hidden) return;
    return origDraw.call(E, ctx, it, page);
  };

})(window.NW);
