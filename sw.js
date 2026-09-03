/* ═══════════════ NoteWell — service worker ═══════════════
   Precaches the whole app on first visit so NoteWell opens and runs with no
   network at all — on a plane, in a lecture theatre basement, anywhere. */
const VERSION = 'notewell-v1.3.0';
const SHELL = [
  './', './index.html',
  './css/app.css',
  './js/util.js', './js/qr.js', './js/templates.js', './js/shapes.js', './js/store.js',
  './js/pdfwriter.js', './js/zipwriter.js', './js/engine.js', './js/text.js',
  './js/tools.js', './js/pdfimport.js', './js/ai.js', './js/ui.js',
  './js/install.js', './js/updates.js', './js/sync.js', './js/backup.js', './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg',
  './icons/apple-touch-icon.png', './icons/icon-maskable-512.png',
  // only present if you ran setup/fetch-fonts.js — missing files are skipped
  './fonts/EBGaramond-Regular.woff2', './fonts/EBGaramond-Medium.woff2',
  './fonts/EBGaramond-SemiBold.woff2', './fonts/EBGaramond-Italic.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // add one at a time so a single 404 can't poison the whole install
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // never cache Claude or the sync server
  if (url.hostname === 'api.anthropic.com' || url.pathname.startsWith('/api/')) return;

  // the PDF engine: cache it hard, it's big and it rarely changes
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith((async () => {
      const c = await caches.open(VERSION + '-vendor');
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      // refresh in the background so updates land next launch
      fetch(req).then(res => { if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res)); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const c = await caches.open(VERSION); c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
