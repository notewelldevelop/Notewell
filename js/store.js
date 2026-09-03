/* ═══════════════ NoteWell — store.js ═══════════════
   Local-first storage (IndexedDB) + optional end-to-end-encrypted account sync.

   Everything works with no network at all. If you point NoteWell at a sync
   server (Settings → Account), your whole library is encrypted *in the browser*
   with a key derived from your password and only then uploaded — the server
   stores an opaque blob, so signing in from another iPad pulls your notebooks
   down without the server ever being able to read them. */
(function (NW) {
  'use strict';

  const DB_NAME = 'notewell', DB_VER = 1;
  const STORES = ['kv', 'folders', 'notebooks', 'pages', 'assets'];
  let db = null;

  /* ── IndexedDB plumbing ───────────────────────── */
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = e => {
        const d = e.target.result;
        STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' }); });
      };
      rq.onsuccess = () => { db = rq.result; res(db); };
      rq.onerror = () => rej(rq.error);
    });
  }
  function tx(store, mode) { return open().then(d => d.transaction(store, mode || 'readonly').objectStore(store)); }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  const Store = NW.Store = {
    ready: open,

    async get(store, id) { return req((await tx(store)).get(id)); },
    async all(store) { return req((await tx(store)).getAll()); },
    async put(store, val) { return req((await tx(store, 'readwrite')).put(val)); },
    async del(store, id) { return req((await tx(store, 'readwrite')).delete(id)); },
    async clear(store) { return req((await tx(store, 'readwrite')).clear()); },

    async kv(k, v) {
      if (v === undefined) { const r = await Store.get('kv', k); return r ? r.v : undefined; }
      await Store.put('kv', { k, v }); return v;
    },

    async estimate() {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      try { return await navigator.storage.estimate(); } catch { return null; }
    },
    async persist() {
      try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
      catch { return false; }
    }
  };

  /* ══════════════ Library model ══════════════ */

  const Lib = NW.Lib = {
    folders: [],      // {id, name, parentId, color, createdAt}
    notebooks: [],    // {id, name, folderId, paper, template, paperColor, cover, pageIds, createdAt, updatedAt, pdfDocId}
    pageCache: new Map(),
    dirtyPages: new Set(),
    dirtyLib: false,

    async load() {
      Lib.folders = (await Store.all('folders')) || [];
      Lib.notebooks = (await Store.all('notebooks')) || [];
      Lib.notebooks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    childFolders(parentId) {
      return Lib.folders.filter(f => (f.parentId || null) === (parentId || null))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    childNotebooks(folderId) {
      return Lib.notebooks.filter(n => (n.folderId || null) === (folderId || null))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    folder(id) { return Lib.folders.find(f => f.id === id) || null; },
    notebook(id) { return Lib.notebooks.find(n => n.id === id) || null; },
    path(folderId) {
      const out = []; let f = Lib.folder(folderId);
      while (f) { out.unshift(f); f = f.parentId ? Lib.folder(f.parentId) : null; }
      return out;
    },
    /** every notebook inside a folder, recursively */
    descendants(folderId) {
      const ids = new Set([folderId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of Lib.folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
      }
      return Lib.notebooks.filter(n => ids.has(n.folderId || null) || (folderId === null && !n.folderId));
    },

    async newFolder(name, parentId) {
      const f = { id: NW.uid('f_'), name: name || 'New folder', parentId: parentId || null, createdAt: Date.now() };
      Lib.folders.push(f); await Store.put('folders', f); NW.emit('lib:changed'); return f;
    },

    async newNotebook(opt) {
      opt = opt || {};
      const paper = NW.PAPER[opt.paper || 'a4'];
      const nb = {
        id: NW.uid('n_'),
        name: opt.name || 'Untitled notebook',
        folderId: opt.folderId || null,
        paper: opt.paper || 'a4',
        landscape: !!opt.landscape,
        template: opt.template || 'lined',
        paperColor: opt.paperColor || 'white',
        cover: opt.cover || null,
        pageIds: [],
        createdAt: Date.now(), updatedAt: Date.now()
      };
      const first = Lib.blankPage(nb);
      nb.pageIds.push(first.id);
      await Store.put('pages', first);
      Lib.pageCache.set(first.id, first);
      Lib.notebooks.unshift(nb);
      await Store.put('notebooks', nb);
      NW.emit('lib:changed');
      return nb;
    },

    /** @param over {size, template, paperColor, landscape, pdf} — `size` is a
     *  key of NW.PAPER (a4, letter…), `paperColor` is a key of NW.PAPER_COLORS */
    blankPage(nb, over) {
      over = over || {};
      const p = NW.PAPER[over.size || nb.paper] || NW.PAPER.a4;
      const land = over.landscape !== undefined ? over.landscape : nb.landscape;
      const paperColor = over.paperColor || nb.paperColor || 'white';
      const pc = NW.paperColor(paperColor);
      return {
        id: NW.uid('p_'),
        w: land ? p.h : p.w,
        h: land ? p.w : p.h,
        template: over.template || nb.template || 'lined',
        paper: paperColor,
        bg: pc.bg, inkColor: pc.ink,
        items: [],
        pdf: over.pdf || null,
        rev: 1
      };
    },

    async page(id) {
      if (Lib.pageCache.has(id)) return Lib.pageCache.get(id);
      const p = await Store.get('pages', id);
      if (p) Lib.pageCache.set(id, p);
      return p;
    },
    async loadPages(nb) {
      const out = [];
      for (const id of nb.pageIds) { const p = await Lib.page(id); if (p) out.push(p); }
      return out;
    },

    touch(nb) { if (nb) { nb.updatedAt = Date.now(); Lib.dirtyLib = true; } },
    markPage(p) { if (p) { p.rev = (p.rev || 0) + 1; Lib.dirtyPages.add(p.id); } },

    async flush() {
      const ids = Array.from(Lib.dirtyPages); Lib.dirtyPages.clear();
      for (const id of ids) { const p = Lib.pageCache.get(id); if (p) await Store.put('pages', p); }
      if (Lib.dirtyLib) {
        Lib.dirtyLib = false;
        for (const nb of Lib.notebooks) await Store.put('notebooks', nb);
        for (const f of Lib.folders) await Store.put('folders', f);
      }
      if (ids.length) NW.emit('saved');
    },

    async deleteNotebook(id) {
      const nb = Lib.notebook(id); if (!nb) return;
      for (const pid of nb.pageIds) { await Store.del('pages', pid); Lib.pageCache.delete(pid); }
      if (nb.pdfDocId) await Store.del('assets', nb.pdfDocId);
      Lib.notebooks = Lib.notebooks.filter(n => n.id !== id);
      await Store.del('notebooks', id);
      NW.emit('lib:changed');
    },
    async deleteFolder(id, withContents) {
      const kids = Lib.descendants(id);
      if (withContents) for (const nb of kids) await Lib.deleteNotebook(nb.id);
      else for (const nb of kids) { nb.folderId = null; await Store.put('notebooks', nb); }
      const sub = Lib.folders.filter(f => f.parentId === id);
      for (const f of sub) { if (withContents) await Lib.deleteFolder(f.id, true); else { f.parentId = null; await Store.put('folders', f); } }
      Lib.folders = Lib.folders.filter(f => f.id !== id);
      await Store.del('folders', id);
      NW.emit('lib:changed');
    },

    async duplicateNotebook(id) {
      const src = Lib.notebook(id); if (!src) return null;
      const nb = NW.deepClone(src);
      nb.id = NW.uid('n_'); nb.name = src.name + ' copy';
      nb.createdAt = nb.updatedAt = Date.now(); nb.pageIds = [];
      for (const pid of src.pageIds) {
        const p = await Lib.page(pid); if (!p) continue;
        const np = NW.deepClone(p); np.id = NW.uid('p_');
        nb.pageIds.push(np.id); Lib.pageCache.set(np.id, np); await Store.put('pages', np);
      }
      Lib.notebooks.unshift(nb); await Store.put('notebooks', nb);
      NW.emit('lib:changed'); return nb;
    },

    /* ── portable backup (also the sync payload) ── */
    async exportAll(nbIds) {
      const notebooks = nbIds ? Lib.notebooks.filter(n => nbIds.includes(n.id)) : Lib.notebooks;
      const pages = {}, assets = {};
      for (const nb of notebooks) {
        for (const pid of nb.pageIds) { const p = await Lib.page(pid); if (p) pages[pid] = p; }
        if (nb.pdfDocId) { const a = await Store.get('assets', nb.pdfDocId); if (a) assets[nb.pdfDocId] = a; }
      }
      return {
        app: 'NoteWell', version: 1, exportedAt: Date.now(),
        folders: Lib.folders, notebooks, pages, assets
      };
    },

    /** Has anything changed here since the last successful sync? */
    dirtySince(ts) {
      if (!ts) return true;
      if (Lib.dirtyPages.size || Lib.dirtyLib) return true;
      return Lib.notebooks.some(n => (n.updatedAt || 0) > ts);
    },

    /**
     * Fold a library from another device into this one.
     *
     * Whole-library last-write-wins would mean the newer device silently ate
     * the older one's work, so this decides notebook by notebook: whichever
     * copy was edited most recently wins, and anything the other device has
     * that this one has never seen is simply added. Two devices editing two
     * different notebooks both keep their work.
     *
     * @returns {{added:number, updated:number, kept:number}}
     */
    async merge(remote) {
      if (!remote || remote.app !== 'NoteWell') throw new Error('That is not a NoteWell library.');
      const stat = { added: 0, updated: 0, kept: 0 };

      for (const f of (remote.folders || [])) {
        if (!Lib.folder(f.id)) { Lib.folders.push(f); await Store.put('folders', f); }
      }
      for (const id in (remote.assets || {})) {
        if (!(await Store.get('assets', id))) await Store.put('assets', remote.assets[id]);
      }

      for (const rn of (remote.notebooks || [])) {
        const mine = Lib.notebook(rn.id);
        if (mine && (mine.updatedAt || 0) >= (rn.updatedAt || 0)) { stat.kept++; continue; }

        // take the remote copy, and the pages that belong to it
        for (const pid of (rn.pageIds || [])) {
          const p = (remote.pages || {})[pid];
          if (!p) continue;
          Lib.pageCache.set(p.id, p);
          await Store.put('pages', p);
        }
        if (mine) {
          // drop pages the remote copy no longer has
          const keep = new Set(rn.pageIds || []);
          for (const pid of (mine.pageIds || [])) {
            if (!keep.has(pid)) { Lib.pageCache.delete(pid); await Store.del('pages', pid); }
          }
          Object.assign(mine, rn);
          stat.updated++;
        } else {
          Lib.notebooks.push(rn);
          stat.added++;
        }
        await Store.put('notebooks', rn);
      }

      Lib.notebooks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      NW.emit('lib:changed');
      return stat;
    },

    async importAll(data, opt) {
      opt = opt || {};
      if (!data || data.app !== 'NoteWell') throw new Error('That file is not a NoteWell backup.');
      if (opt.replace) {
        await Store.clear('folders'); await Store.clear('notebooks'); await Store.clear('pages'); await Store.clear('assets');
        Lib.folders = []; Lib.notebooks = []; Lib.pageCache.clear();
      }
      const have = new Set(Lib.notebooks.map(n => n.id));
      for (const f of (data.folders || [])) if (!Lib.folder(f.id)) { Lib.folders.push(f); await Store.put('folders', f); }
      for (const id in (data.assets || {})) await Store.put('assets', data.assets[id]);
      for (const id in (data.pages || {})) { const p = data.pages[id]; Lib.pageCache.set(p.id, p); await Store.put('pages', p); }
      for (const nb of (data.notebooks || [])) {
        if (have.has(nb.id) && !opt.overwrite) continue;
        const i = Lib.notebooks.findIndex(x => x.id === nb.id);
        if (i >= 0) Lib.notebooks[i] = nb; else Lib.notebooks.push(nb);
        await Store.put('notebooks', nb);
      }
      Lib.notebooks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      NW.emit('lib:changed');
    }
  };

  /* ══════════════ Account + sync ══════════════ */

  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = {
    enc: buf => { let s = ''; const b = new Uint8Array(buf); const CH = 0x8000; for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH)); return btoa(s); },
    dec: str => { const bin = atob(str), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  };

  async function pbkdf2(pw, salt, iter, bits) {
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: iter, hash: 'SHA-256' }, key, bits);
  }

  const Account = NW.Account = {
    state: { email: null, server: null, token: null, lastSync: 0, lastRev: 0, deviceId: null, remember: true },
    key: null,               // the AES key, in memory for this session

    async init() {
      const s = await Store.kv('account');
      if (s) Object.assign(Account.state, s);
      if (!Account.state.deviceId) { Account.state.deviceId = NW.uid('d_'); await Account.save(); }
      if (Account.state.remember) await Account.loadKey();
    },
    save() { return Store.kv('account', Account.state); },
    get signedIn() { return !!(Account.state.email && Account.state.token && Account.state.server); },
    /** signed in *and* able to encrypt without asking for the password again */
    get unlocked() { return !!(Account.signedIn && Account.key); },

    /* ── keeping the key on the device ─────────────────
       The key is derived once and stored as a non-extractable CryptoKey, so
       background syncing works without asking for the password on every
       launch. Non-extractable means even code running on this page cannot
       read the key material back out — it can only ask the browser to use it.
       Signing out deletes it. */
    async rememberKey(key) {
      Account.key = key;
      if (!Account.state.remember) return;
      try { await Store.put('kv', { k: 'accountKey', v: key, email: Account.state.email }); } catch (e) { }
    },
    async loadKey() {
      try {
        const rec = await Store.get('kv', 'accountKey');
        if (rec && rec.v && rec.email === Account.state.email) { Account.key = rec.v; return true; }
      } catch (e) { }
      return false;
    },
    async forgetKey() {
      Account.key = null;
      try { await Store.del('kv', 'accountKey'); } catch (e) { }
    },
    /** derive the key from the password and hold on to it */
    async unlock(password) {
      const key = await Account.cryptoKey(Account.state.email, password);
      await Account.rememberKey(key);
      NW.emit('account:changed');
      return key;
    },

    /** what the server sees — never the password itself */
    async authHash(email, pw) { return b64.enc(await pbkdf2(pw, 'nw-auth|' + email.toLowerCase(), 210000, 256)); },
    /** what encrypts your notebooks — never leaves this device */
    async cryptoKey(email, pw) {
      const bits = await pbkdf2(pw, 'nw-enc|' + email.toLowerCase(), 250000, 256);
      return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
    },

    async encrypt(obj, key) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
      return { iv: b64.enc(iv), ct: b64.enc(ct), v: 1 };
    },
    async decrypt(pkg, key) {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(pkg.iv) }, key, b64.dec(pkg.ct));
      return JSON.parse(dec.decode(pt));
    },

    async api(server, path, method, body, token) {
      const r = await fetch(server.replace(/\/$/, '') + path, {
        method: method || 'GET',
        headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const txt = await r.text();
      let js = null; try { js = txt ? JSON.parse(txt) : null; } catch { }
      if (!r.ok) throw new Error((js && js.error) || ('Server said ' + r.status));
      return js;
    },

    async signUp(server, email, pw) {
      const hash = await Account.authHash(email, pw);
      const res = await Account.api(server, '/api/signup', 'POST', { email: email.toLowerCase(), hash });
      Object.assign(Account.state, { email: email.toLowerCase(), server, token: res.token });
      await Account.save();
      await Account.unlock(pw);
      return res;
    },
    async signIn(server, email, pw) {
      const hash = await Account.authHash(email, pw);
      const res = await Account.api(server, '/api/login', 'POST', { email: email.toLowerCase(), hash });
      Object.assign(Account.state, { email: email.toLowerCase(), server, token: res.token });
      await Account.save();
      await Account.unlock(pw);
      return res;
    },
    async signOut() {
      Object.assign(Account.state, { email: null, token: null, lastSync: 0, lastRev: 0 });
      await Account.forgetKey();
      await Account.save(); NW.emit('account:changed');
    },

    /** the key to use, given an optional password */
    async keyFor(pw) {
      if (pw) return Account.unlock(pw);
      if (Account.key) return Account.key;
      throw new Error('NEED_PASSWORD');
    },

    /** push local → server (encrypted) */
    async push(pw) {
      if (!Account.signedIn) throw new Error('Sign in first.');
      const key = await Account.keyFor(pw);
      await Lib.flush();
      const payload = await Lib.exportAll();
      const pkg = await Account.encrypt(payload, key);
      const res = await Account.api(Account.state.server, '/api/library', 'PUT',
        { blob: pkg, rev: Date.now(), device: Account.state.deviceId }, Account.state.token);
      Account.state.lastSync = Date.now();
      if (res && res.rev) Account.state.lastRev = res.rev;
      await Account.save();
      NW.emit('account:changed');
      return res;
    },

    /** what the server currently holds, without applying it */
    async fetchRemote(pw) {
      if (!Account.signedIn) throw new Error('Sign in first.');
      const res = await Account.api(Account.state.server, '/api/library', 'GET', null, Account.state.token);
      if (!res || !res.blob) return { empty: true, rev: 0 };
      const key = await Account.keyFor(pw);
      let payload;
      try { payload = await Account.decrypt(res.blob, key); }
      catch { throw new Error('Wrong password for this account — the data could not be decrypted.'); }
      return { payload, rev: res.rev || 0, device: res.device };
    },

    /** pull server → local. `mode` is 'merge' (default) or 'replace'. */
    async pull(pw, replace) {
      const r = await Account.fetchRemote(pw);
      if (r.empty) return { empty: true };
      if (replace) await Lib.importAll(r.payload, { replace: true, overwrite: true });
      else await Lib.merge(r.payload);
      Account.state.lastSync = Date.now();
      Account.state.lastRev = r.rev;
      await Account.save();
      NW.emit('account:changed');
      return { ok: true, notebooks: (r.payload.notebooks || []).length };
    }
  };

  /* ── autosave loop ────────────────────────────── */
  let saving = false;
  setInterval(async () => {
    if (saving) return;
    if (!Lib.dirtyPages.size && !Lib.dirtyLib) return;
    saving = true;
    try { await Lib.flush(); } catch (e) { console.error('autosave', e); }
    saving = false;
  }, 1400);

  window.addEventListener('pagehide', () => { Lib.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Lib.flush(); });

})(window.NW);
