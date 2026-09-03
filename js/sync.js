/* ═══════════════ NoteWell — sync.js ═══════════════
   Keeping your account up to date without you thinking about it.

   The rule NoteWell follows: your notes are always safe on this device first.
   Syncing is a copy, never a move, and losing the connection is normal rather
   than an error — you keep writing, and it catches up when the signal comes
   back.

   It syncs when you open the app, a little while after you stop writing, and
   when you close it. */
(function (NW) {
  'use strict';
  const A = NW.Account, Lib = NW.Lib;

  const S = NW.Sync = {
    /* off | ready | syncing | synced | waiting | locked | error */
    status: 'off',
    detail: '',
    pending: false,          // local edits not yet on the server
    lastError: null,
    lastAt: 0,
    auto: true,
    idleMs: 20000,           // quiet time after the last edit before pushing
    _timer: 0,
    _busy: false
  };

  function set(status, detail) {
    S.status = status;
    S.detail = detail || '';
    NW.emit('sync:status', S);
  }

  /** what the status chip should say, in plain English */
  S.label = function () {
    switch (S.status) {
      case 'off': return 'Not signed in';
      case 'syncing': return 'Saving…';
      case 'synced': return 'Saved ' + (S.lastAt ? NW.when(S.lastAt) : '');
      case 'waiting': return navigator.onLine ? 'Waiting to save' : 'Offline — saved on this iPad';
      case 'locked': return 'Enter your password to sync';
      case 'error': return 'Could not save to your account';
      default: return S.pending ? 'Unsaved changes' : 'Up to date';
    }
  };
  S.tooltip = function () {
    if (S.status === 'error') return S.detail || 'Something went wrong syncing.';
    if (S.status === 'waiting' && !navigator.onLine) {
      return 'No connection. Your work is safe on this device and will go to your account automatically when you are back online.';
    }
    if (S.status === 'locked') return 'NoteWell needs your account password to encrypt this device\'s notes before uploading.';
    return S.detail || '';
  };

  /* ── the one place a sync happens ───────────────── */

  /**
   * @param opt {reason, manual, password}
   * @returns {Promise<{ok:boolean, skipped?:string, error?:string}>}
   */
  S.run = async function (opt) {
    opt = opt || {};
    if (!A.signedIn) { set('off'); return { ok: false, skipped: 'not signed in' }; }
    if (S._busy) return { ok: false, skipped: 'already running' };

    if (!navigator.onLine) {
      S.pending = true;
      set('waiting', 'No connection — nothing has been lost, it is all on this device.');
      if (opt.manual) NW.toast('No connection. Your work is safe here and will sync itself when you are back online.', 3200);
      return { ok: false, skipped: 'offline' };
    }

    if (!A.key && !opt.password) {
      set('locked');
      if (opt.manual) NW.emit('sync:needsPassword');
      return { ok: false, skipped: 'locked' };
    }

    S._busy = true;
    set('syncing');
    try {
      await Lib.flush();

      /* what does the server have, and has anything changed here? */
      const remote = await A.fetchRemote(opt.password);
      const localChanged = Lib.dirtySince(A.state.lastSync) || S.pending;
      const remoteChanged = !remote.empty && remote.rev > (A.state.lastRev || 0);

      let merged = null;
      if (remoteChanged) {
        merged = await Lib.merge(remote.payload);
        A.state.lastRev = remote.rev;
      }

      if (localChanged || merged) {
        await A.push(opt.password);           // push() refreshes lastSync + lastRev
      } else {
        A.state.lastSync = Date.now();
        await A.save();
      }

      S.pending = false;
      S.lastError = null;
      S.lastAt = A.state.lastSync;
      set('synced');
      NW.emit('sync:done', { merged });

      if (opt.manual) {
        NW.toast(merged && (merged.added || merged.updated)
          ? 'Saved. Brought in ' + (merged.added + merged.updated) + ' notebook' + ((merged.added + merged.updated) === 1 ? '' : 's') + ' from your other devices.'
          : 'Saved to your account');
      }
      return { ok: true, merged };

    } catch (err) {
      const msg = String(err && err.message || err);
      if (msg === 'NEED_PASSWORD') {
        set('locked');
        if (opt.manual) NW.emit('sync:needsPassword');
        return { ok: false, skipped: 'locked' };
      }
      /* a dropped connection mid-request looks like a TypeError — treat it as
         being offline rather than as a failure, because nothing is lost */
      if (/failed to fetch|networkerror|load failed|the internet connection/i.test(msg)) {
        S.pending = true;
        set('waiting', 'Lost the connection part-way. Your work is safe on this device.');
        if (opt.manual) NW.toast('Lost the connection. Nothing is lost — it will sync when you are back online.', 3200);
        return { ok: false, skipped: 'offline' };
      }
      S.lastError = msg;
      S.pending = true;
      set('error', msg);
      if (opt.manual) NW.toast(msg, 3600);
      return { ok: false, error: msg };

    } finally {
      S._busy = false;
    }
  };

  /* ── triggers ───────────────────────────────────── */

  /** something changed — queue a sync for once the writing stops */
  S.touch = function () {
    if (!A.signedIn) return;
    S.pending = true;
    if (S.status === 'synced' || S.status === 'ready') set('ready');
    if (!S.auto) return;
    clearTimeout(S._timer);
    S._timer = setTimeout(() => S.run({ reason: 'idle' }), S.idleMs);
  };

  S.now = function () { clearTimeout(S._timer); return S.run({ manual: true }); };

  S.init = function () {
    if (A.signedIn) set(A.key ? 'ready' : 'locked');

    /* every edit nudges the timer */
    NW.on('page:changed', S.touch);
    NW.on('pages:changed', S.touch);
    NW.on('lib:changed', S.touch);

    /* on the way in */
    if (A.signedIn) setTimeout(() => S.run({ reason: 'open' }), 1200);

    /* on the way out — keepalive so a closing tab still gets the push away */
    const leaving = () => {
      if (!A.signedIn || !S.pending || !navigator.onLine || !A.key) return;
      clearTimeout(S._timer);
      S.run({ reason: 'close' });
    };
    addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', () => { if (document.hidden) leaving(); });

    /* back on wifi — catch up straight away */
    addEventListener('online', () => {
      NW.emit('sync:status', S);
      if (A.signedIn && S.pending) setTimeout(() => S.run({ reason: 'reconnect' }), 800);
    });
    addEventListener('offline', () => {
      if (A.signedIn && S.pending) set('waiting', 'No connection — your work is safe on this device.');
      NW.emit('sync:status', S);
    });

    NW.on('account:changed', () => {
      if (!A.signedIn) { S.pending = false; set('off'); }
      else if (!A.key) set('locked');
      else if (S.status === 'off') set('ready');
    });
  };

})(window.NW);
