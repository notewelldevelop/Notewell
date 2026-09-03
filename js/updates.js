/* ═══════════════ NoteWell — updates.js ═══════════════
   Getting a new version onto everyone's iPad without chasing them.

   An installed web app is a cached copy, so a student can sit on a build from
   three weeks ago and never know. This watches for a newer one and offers it,
   rather than silently swapping code out from under someone mid-sentence —
   the update only lands when they tap, and their notes are untouched either
   way (notes live in the database, not in the cache).

   The version comes from build/version.json, which the build stamps. */
(function (NW) {
  'use strict';

  const U = NW.Updates = {
    current: (window.NW_BUILD && window.NW_BUILD.version) || 'dev',
    builtAt: (window.NW_BUILD && window.NW_BUILD.builtAt) || 0,
    available: null,        // { version, notes } once something newer is found
    waitingWorker: null,
    checking: false,
    lastCheck: 0
  };

  U.describe = function () {
    if (U.current === 'dev') return 'development build';
    const when = U.builtAt ? ' · ' + new Date(U.builtAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return 'v' + U.current + when;
  };

  /* ── watching the service worker ─────────────────
     A new build changes the service worker file, so the browser installs it
     and parks it in "waiting". That parked worker is the new version. */
  function watch(reg) {
    if (!reg) return;
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // "installed" with an existing controller means: this is an update,
        // not a first install
        if (sw.state === 'installed' && navigator.serviceWorker.controller) offer(sw);
      });
    });
  }

  function offer(worker) {
    U.waitingWorker = worker;
    U.available = U.available || { version: 'newer' };
    NW.emit('update:available', U.available);
    showBanner();
  }

  /** ask the parked worker to take over, then reload into it */
  U.apply = function () {
    const w = U.waitingWorker;
    if (!w) { location.reload(); return; }
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
    w.postMessage('skipWaiting');
    // if the worker doesn't hand over promptly, reload anyway
    setTimeout(() => { if (!reloaded) { reloaded = true; location.reload(); } }, 2500);
  };

  /* ── asking the server directly ──────────────────
     The service worker only notices an update when the browser re-checks it,
     which can be a while. A tiny version file is a cheap, obvious answer to
     "is there a newer one?" and works even if the worker is being lazy. */
  U.check = async function (opt) {
    opt = opt || {};
    if (U.checking) return null;
    if (!navigator.onLine) {
      if (opt.manual) NW.toast('No connection — cannot check for an update right now');
      return null;
    }
    U.checking = true;
    NW.emit('update:checking', true);
    try {
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json();
        if (info && info.version && info.version !== U.current && U.current !== 'dev') {
          U.available = info;
          NW.emit('update:available', info);
          showBanner();
          if (opt.manual) NW.toast('Version ' + info.version + ' is ready');
        } else if (opt.manual) {
          NW.toast('You are on the latest version');
        }
      } else if (opt.manual) {
        NW.toast('Could not reach the update file');
      }

      /* nudge the service worker to look too */
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) { try { await reg.update(); } catch (e) { } }
      }
      U.lastCheck = Date.now();
      return U.available;
    } catch (e) {
      if (opt.manual) NW.toast('Could not check for updates');
      return null;
    } finally {
      U.checking = false;
      NW.emit('update:checking', false);
    }
  };

  /* ── the banner ──────────────────────────────────
     Deliberately not a modal: nobody should be interrupted mid-sentence by a
     housekeeping message. */
  let banner = null;
  function showBanner() {
    if (banner && banner.isConnected) return;
    const v = U.available || {};
    banner = NW.el('div', { class: 'install-nudge update-nudge' });
    banner.appendChild(NW.el('div', { class: 'txt',
      html: 'A new version of NoteWell is ready' + (v.version && v.version !== 'newer' ? ' <b>(' + NW.esc(v.version) + ')</b>' : '') +
            '. Your notes are not affected.' }));
    banner.appendChild(NW.el('button', { class: 'chip', text: 'Update now', onclick: () => U.apply() }));
    banner.appendChild(NW.el('button', {
      class: 'x', text: '×', title: 'Later',
      onclick: () => { banner.classList.remove('show'); setTimeout(() => banner.remove(), 260); }
    }));
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));
  }
  U.showBanner = showBanner;

  U.init = function () {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(watch).catch(() => { });
    }
    /* look once shortly after launch, then every couple of hours, and again
       whenever the app comes back to the foreground */
    setTimeout(() => U.check(), 6000);
    setInterval(() => U.check(), 2 * 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - U.lastCheck > 30 * 60 * 1000) U.check();
    });
    addEventListener('online', () => { if (Date.now() - U.lastCheck > 60000) U.check(); });
  };

})(window.NW);
