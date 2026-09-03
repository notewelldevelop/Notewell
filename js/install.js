/* ═══════════════ NoteWell — install.js ═══════════════
   Getting NoteWell onto a device, without the student having to read a manual.

   It works out where it's running, tells them the three taps that apply to
   *their* device, shows a QR code so an iPad camera can jump straight here
   from a laptop screen, and says plainly whether offline is actually going to
   work — because over plain http on a home network, it isn't. */
(function (NW) {
  'use strict';
  const el = NW.el, $ = NW.$;

  const I = NW.Install = { deferredPrompt: null, dismissedKey: 'nw-install-dismissed' };

  /* ── where are we? ─────────────────────────────── */
  I.env = function () {
    const ua = navigator.userAgent;
    const standalone = matchMedia('(display-mode: standalone)').matches ||
                       matchMedia('(display-mode: fullscreen)').matches ||
                       navigator.standalone === true;
    const iOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    // on iOS every browser is Safari underneath, but only real Safari can install
    const iOSChrome = iOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    const secure = window.isSecureContext;
    const local = location.protocol === 'file:';
    const localhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    return {
      standalone, iOS, android, iOSChrome, secure, local, localhost,
      canServiceWorker: 'serviceWorker' in navigator && secure && !local,
      canPrompt: !!I.deferredPrompt,
      url: location.href.replace(/#.*$/, ''),
      desktop: !iOS && !android
    };
  };

  /** true once the service worker has the app cached */
  I.offlineReady = async function () {
    if (!('serviceWorker' in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !(reg.active || reg.waiting)) return false;
      const keys = await caches.keys();
      for (const k of keys) {
        const c = await caches.open(k);
        if (await c.match('./index.html') || await c.match('index.html')) return true;
      }
      return false;
    } catch (e) { return false; }
  };

  /* ── the dialog ────────────────────────────────── */
  I.dialog = async function () {
    const e = I.env();
    const UI = NW.UI;

    UI.modal(box => {
      box.appendChild(el('h2', { text: e.standalone ? 'NoteWell is installed' : 'Put NoteWell on your device' }));

      if (e.standalone) {
        box.appendChild(el('p', { class: 'note', text: 'You are running the installed app. Notes are kept on this device and it opens without a connection.' }));
      }

      /* ── status strip ── */
      const status = el('div', { style: 'margin:4px 0 18px' });
      const row = (label, value, good) => {
        const d = el('div', { class: 'kv' });
        d.append(el('span', { text: label }), el('b', { text: value, style: good === false ? 'color:var(--danger)' : '' }));
        return d;
      };
      status.appendChild(row('Installed', e.standalone ? 'yes' : 'not yet', e.standalone));
      status.appendChild(row('Address', location.host || 'local file'));
      status.appendChild(row('Secure (https)', e.local ? 'local file' : e.secure ? 'yes' : 'no — needed for offline', e.secure));
      const offlineRow = row('Saved for offline', 'checking…');
      status.appendChild(offlineRow);
      box.appendChild(status);
      I.offlineReady().then(ok => {
        const b = offlineRow.querySelector('b');
        if (b) { b.textContent = ok ? 'yes' : (e.canServiceWorker ? 'not yet — open it once more' : 'no'); b.style.color = ok ? '' : 'var(--danger)'; }
      });

      /* ── the blocker, if there is one ── */
      if (!e.secure && !e.local) {
        const warn = el('div', { style: 'border-left:2px solid var(--danger);padding:2px 0 2px 14px;margin:0 0 18px' });
        warn.appendChild(el('p', { class: 'note', style: 'margin:0',
          html: 'This page is being served over plain <b>http</b>. You can use NoteWell, and your notes are saved, but iOS and Android will not let it install as a proper offline app from here — that needs <b>https</b>. Put the folder on a free host and open that address instead; <b>Copy the one-drag bundle</b> below explains it.' }));
        box.appendChild(warn);
      }
      if (e.local) {
        box.appendChild(el('p', { class: 'note',
          html: 'You opened NoteWell as a file on this computer. Everything works and your notes are saved, but a file has no address, so it can\'t be added to a home screen. Run <code>npm start</code>, or host the folder, to install it properly.' }));
      }

      /* ── steps for this device ── */
      if (!e.standalone) {
        box.appendChild(el('label', { text: 'On this device' }));
        const steps = el('div', { class: 'ai-steps' });
        const step = (n, text, btn) => {
          const r = el('div', { class: 'step' });
          r.appendChild(el('span', { class: 'num', text: n }));
          const body = el('div', { style: 'flex:1' });
          body.appendChild(el('div', { html: text }));
          if (btn) body.appendChild(el('div', { style: 'margin-top:6px' }, btn));
          r.appendChild(body);
          return r;
        };

        if (e.iOSChrome) {
          steps.appendChild(step('1', 'You are in Chrome. On an iPad only <b>Safari</b> can install an app — copy the address and open it there.',
            el('button', { class: 'chip', text: 'Copy address', onclick: () => copy(e.url) })));
        } else if (e.iOS) {
          steps.appendChild(step('1', 'Tap the <b>Share</b> button — the square with an arrow coming out of the top.'));
          steps.appendChild(step('2', 'Scroll down the list and tap <b>Add to Home Screen</b>.'));
          steps.appendChild(step('3', 'Tap <b>Add</b>, then open NoteWell from your home screen once while you still have a connection.'));
        } else if (e.canPrompt) {
          steps.appendChild(step('1', 'Install it in one tap.',
            el('button', { class: 'btn primary', text: 'Install NoteWell', onclick: () => I.prompt() })));
        } else if (e.android) {
          steps.appendChild(step('1', 'Open the <b>⋮</b> menu in Chrome.'));
          steps.appendChild(step('2', 'Tap <b>Add to Home screen</b>, or <b>Install app</b>.'));
        } else {
          steps.appendChild(step('1', 'In Chrome or Edge, click the install icon at the right-hand end of the address bar — a screen with a downward arrow.'));
          steps.appendChild(step('2', 'Or use the ⋮ menu → <b>Cast, save and share</b> → <b>Install page as app</b>.'));
          steps.appendChild(step('3', 'Safari on a Mac: <b>File → Add to Dock</b>.'));
        }
        box.appendChild(steps);
      }

      /* ── hop to another device ── */
      box.appendChild(el('label', { text: e.desktop ? 'Move it to your iPad' : 'Open on another device' }));
      const qrWrap = el('div', { class: 'row', style: 'align-items:flex-start;gap:18px' });
      const qrBox = el('div', {
        style: 'flex:0 0 auto;background:#fff;padding:10px;border-radius:8px;border:1px solid var(--line-2);line-height:0'
      });
      try {
        if (e.local) throw new Error('local file');
        qrBox.innerHTML = NW.QR.svg(e.url, 168, { fg: '#000000', bg: '#ffffff' });
      } catch (err) {
        qrBox.style.background = 'transparent'; qrBox.style.border = '0'; qrBox.style.padding = '0';
        qrBox.appendChild(el('p', { class: 'note', style: 'margin:0', text: 'No web address to share — NoteWell is running from a file on this computer.' }));
      }
      const qrSide = el('div', { style: 'flex:1;min-width:180px' });
      qrSide.appendChild(el('p', { class: 'note', style: 'margin:0 0 10px',
        text: e.local ? 'Run npm start, or host the folder, and this becomes a code you can point a camera at.'
                      : 'Point your iPad camera at this and tap the link that pops up. Then follow the Add to Home Screen steps on the iPad.' }));
      const addr = el('div', { style: 'font:13px var(--mono);color:var(--fg-2);word-break:break-all;margin-bottom:10px', text: e.url });
      qrSide.appendChild(addr);
      const btns = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
      if (!e.local) {
        btns.appendChild(el('button', { class: 'chip', text: 'Copy address', onclick: () => copy(e.url) }));
        if (navigator.share) btns.appendChild(el('button', {
          class: 'chip', text: 'Share…',
          onclick: () => navigator.share({ title: 'NoteWell', url: e.url }).catch(() => { })
        }));
      }
      btns.appendChild(el('button', { class: 'chip', text: 'How do I host it?', onclick: () => I.hostingHelp() }));
      qrSide.appendChild(btns);
      qrWrap.append(qrBox, qrSide);
      box.appendChild(qrWrap);

      const acts = el('div', { class: 'actions' });
      acts.appendChild(el('button', { class: 'btn', text: 'Close', onclick: UI.close }));
      box.appendChild(acts);
    });
  };

  function copy(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(() => NW.toast('Address copied'), () => NW.toast('Could not copy — select it by hand'));
    } else NW.toast('Could not copy — select it by hand');
  }

  I.hostingHelp = function () {
    NW.UI.modal(box => {
      box.appendChild(el('h2', { text: 'Putting NoteWell on the web, free' }));
      box.appendChild(el('p', { class: 'note',
        html: 'An iPad only lets a page install as a real offline app when it is served over <b>https</b>. Free hosts give you that in a couple of minutes, and you only do it once.' }));

      const steps = el('div', { class: 'ai-steps' });
      const step = (n, html) => {
        const r = el('div', { class: 'step' });
        r.appendChild(el('span', { class: 'num', text: n }));
        r.appendChild(el('div', { style: 'flex:1', html }));
        return r;
      };
      steps.appendChild(step('1', 'On a computer, find the <code>dist-web</code> folder that came with NoteWell — or run <code>npm run web</code> to build it. It is four small files.'));
      steps.appendChild(step('2', 'Go to <b>app.netlify.com/drop</b> and drag that folder onto the page. (GitHub Pages and Cloudflare Pages work the same way.)'));
      steps.appendChild(step('3', 'It hands you an address like <code>https://something.netlify.app</code>. Write it down — your notes are tied to it.'));
      steps.appendChild(step('4', 'Open that address in <b>Safari</b> on the iPad, then Share → <b>Add to Home Screen</b>.'));
      steps.appendChild(step('5', 'Open it once from the home screen with wifi on. After that it works with the wifi off, for good.'));
      box.appendChild(steps);

      const acts = el('div', { class: 'actions' });
      acts.appendChild(el('button', { class: 'btn', text: 'Back', onclick: () => I.dialog() }));
      acts.appendChild(el('button', { class: 'btn primary', text: 'Close', onclick: NW.UI.close }));
      box.appendChild(acts);
    });
  };

  I.prompt = async function () {
    if (!I.deferredPrompt) return;
    I.deferredPrompt.prompt();
    const r = await I.deferredPrompt.userChoice.catch(() => null);
    I.deferredPrompt = null;
    NW.emit('install:changed');
    if (r && r.outcome === 'accepted') { NW.UI.close(); NW.toast('Installed'); }
  };

  /* ── the one-time nudge on iOS ──────────────────
     iOS never offers to install a web app by itself, so a student who is
     handed a link has no idea the option exists. One quiet bar, once. */
  I.maybeNudge = function () {
    const e = I.env();
    if (e.standalone || !e.iOS || e.iOSChrome || !e.secure) return;
    try { if (localStorage.getItem(I.dismissedKey)) return; } catch (err) { }

    const bar = el('div', { class: 'install-nudge' });
    bar.appendChild(el('div', { class: 'txt', html: 'Add NoteWell to your home screen and it works offline, with its own icon.' }));
    const go = el('button', { class: 'chip', text: 'Show me how', onclick: () => { close(); I.dialog(); } });
    const x = el('button', { class: 'x', text: '×', title: 'Not now', onclick: () => close(true) });
    bar.append(go, x);
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('show'));

    function close(remember) {
      bar.classList.remove('show');
      setTimeout(() => bar.remove(), 260);
      if (remember) { try { localStorage.setItem(I.dismissedKey, '1'); } catch (err) { } }
    }
    setTimeout(() => { if (bar.isConnected) close(false); }, 14000);
  };

  I.init = function () {
    addEventListener('beforeinstallprompt', ev => {
      ev.preventDefault();
      I.deferredPrompt = ev;
      NW.emit('install:changed');
    });
    addEventListener('appinstalled', () => {
      I.deferredPrompt = null;
      NW.emit('install:changed');
      NW.toast('NoteWell installed — it opens like any other app now');
    });
    setTimeout(I.maybeNudge, 2500);
  };

})(window.NW);
