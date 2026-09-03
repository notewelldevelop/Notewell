/* ═══════════════ NoteWell — backup.js ═══════════════
   Getting your notes out as a real file, so they exist somewhere other than
   inside a browser database.

   Two routes, because the platforms genuinely differ:

   • **A backup folder** (desktop Chrome, Edge, and the desktop app). You pick
     a folder once and NoteWell writes into it by itself from then on. Pick
     your iCloud Drive or Google Drive folder and the backup lands on your iPad
     without you doing anything — which is the closest thing to real automatic
     file backup that a web app is allowed to do.

   • **Save to Files** (iPad, iPhone, everywhere else). Safari deliberately
     doesn't let a page write to your file system unattended, so this is one
     tap: it hands the file to the iPadOS share sheet and you choose *Save to
     Files*. Nothing automatic, but nothing hidden either. */
(function (NW) {
  'use strict';

  const B = NW.Backup = {
    dirHandle: null,
    cfg: { auto: true, everyMin: 30, keep: 5, lastAt: 0, lastSize: 0, folderName: '' },
    _timer: 0,
    _busy: false
  };

  B.supportsFolder = () => typeof window.showDirectoryPicker === 'function';

  B.load = async function () {
    const c = await NW.Store.kv('backupCfg');
    if (c) Object.assign(B.cfg, c);
    try {
      const rec = await NW.Store.get('kv', 'backupDir');
      if (rec && rec.v) B.dirHandle = rec.v;
    } catch (e) { }
  };
  B.save = () => NW.Store.kv('backupCfg', NW.deepClone(B.cfg));

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const fileName = dated => 'NoteWell' + (dated ? '-' + stamp() : '-backup') + '.nwbak';

  /* ── the file itself ────────────────────────────── */
  B.build = async function () {
    await NW.Lib.flush();
    const data = await NW.Lib.exportAll();
    const json = JSON.stringify(data);
    return {
      blob: new Blob([json], { type: 'application/json' }),
      size: json.length,
      notebooks: (data.notebooks || []).length
    };
  };

  /* ── route 1: a folder we can write to ──────────── */

  B.chooseFolder = async function () {
    if (!B.supportsFolder()) throw new Error('This browser will not let a page write to a folder. Use “Save to Files” instead.');
    const handle = await window.showDirectoryPicker({ id: 'notewell-backups', mode: 'readwrite', startIn: 'documents' });
    B.dirHandle = handle;
    B.cfg.folderName = handle.name;
    try { await NW.Store.put('kv', { k: 'backupDir', v: handle }); } catch (e) { }
    await B.save();
    NW.emit('backup:changed');
    await B.writeToFolder();
    return handle.name;
  };

  B.forgetFolder = async function () {
    B.dirHandle = null;
    B.cfg.folderName = '';
    try { await NW.Store.del('kv', 'backupDir'); } catch (e) { }
    await B.save();
    NW.emit('backup:changed');
  };

  /** 'granted' | 'prompt' | 'denied' | 'none' */
  B.folderPermission = async function () {
    if (!B.dirHandle) return 'none';
    try { return await B.dirHandle.queryPermission({ mode: 'readwrite' }); }
    catch (e) { return 'denied'; }
  };
  B.reconnectFolder = async function () {
    if (!B.dirHandle) return false;
    try { return (await B.dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted'; }
    catch (e) { return false; }
  };

  B.writeToFolder = async function (opt) {
    opt = opt || {};
    if (!B.dirHandle) return { skipped: 'no folder' };
    if ((await B.folderPermission()) !== 'granted') {
      if (!opt.interactive) return { skipped: 'permission' };
      if (!(await B.reconnectFolder())) return { skipped: 'permission' };
    }

    const { blob, size, notebooks } = await B.build();

    // the current copy, always the same name so it's easy to find
    const cur = await B.dirHandle.getFileHandle(fileName(false), { create: true });
    const w = await cur.createWritable();
    await w.write(blob); await w.close();

    // plus a dated copy, keeping only the most recent few
    if (B.cfg.keep > 0) {
      const dated = await B.dirHandle.getFileHandle(fileName(true), { create: true });
      const w2 = await dated.createWritable();
      await w2.write(blob); await w2.close();
      await prune();
    }

    B.cfg.lastAt = Date.now(); B.cfg.lastSize = size;
    await B.save();
    NW.emit('backup:changed');
    return { ok: true, size, notebooks, where: B.cfg.folderName };
  };

  async function prune() {
    try {
      const names = [];
      for await (const [name, h] of B.dirHandle.entries()) {
        if (h.kind === 'file' && /^NoteWell-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.nwbak$/.test(name)) names.push(name);
      }
      names.sort();
      while (names.length > B.cfg.keep) {
        const old = names.shift();
        try { await B.dirHandle.removeEntry(old); } catch (e) { break; }
      }
    } catch (e) { /* listing isn't supported everywhere; the current copy is what matters */ }
  }

  /* ── route 2: hand it to the operating system ───── */

  B.saveToFiles = async function () {
    const { blob, size, notebooks } = await B.build();
    const name = fileName(true);

    /* On an iPad the share sheet is the nicest route — it offers Save to Files,
       iCloud Drive, AirDrop and Mail in one go. */
    if (navigator.canShare) {
      try {
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'NoteWell backup' });
          B.cfg.lastAt = Date.now(); B.cfg.lastSize = size;
          await B.save(); NW.emit('backup:changed');
          return { ok: true, via: 'share', size, notebooks };
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return { cancelled: true };
      }
    }

    NW.download(blob, name);
    B.cfg.lastAt = Date.now(); B.cfg.lastSize = size;
    await B.save(); NW.emit('backup:changed');
    return { ok: true, via: 'download', size, notebooks };
  };

  B.restoreFromFile = async function (file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('That file is not a NoteWell backup — it could not be read.'); }
    if (!data || data.app !== 'NoteWell') throw new Error('That is not a NoteWell backup.');
    return data;
  };

  /* ── how stale are we? ──────────────────────────── */
  B.ageDays = () => B.cfg.lastAt ? (Date.now() - B.cfg.lastAt) / 86400000 : Infinity;
  B.isStale = () => NW.Lib.notebooks.length > 0 && B.ageDays() > 7;

  B.summary = function () {
    if (!B.cfg.lastAt) return 'never backed up';
    return NW.when(B.cfg.lastAt) + (B.cfg.lastSize ? ' · ' + NW.bytes(B.cfg.lastSize) : '') +
      (B.cfg.folderName ? ' · ' + B.cfg.folderName : '');
  };

  /* ── the automatic loop ─────────────────────────── */
  B.init = async function () {
    await B.load();
    if (B.dirHandle && (await B.folderPermission()) === 'granted') {
      setTimeout(() => B.writeToFolder().catch(() => { }), 4000);
    }
    clearInterval(B._timer);
    B._timer = setInterval(async () => {
      if (!B.cfg.auto || !B.dirHandle || B._busy) return;
      if (Date.now() - B.cfg.lastAt < B.cfg.everyMin * 60000) return;
      B._busy = true;
      try { await B.writeToFolder(); } catch (e) { } finally { B._busy = false; }
    }, 60000);
    NW.emit('backup:changed');
  };

})(window.NW);
