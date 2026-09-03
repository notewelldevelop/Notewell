#!/usr/bin/env node
/* ═══════════════ NoteWell — web bundle ═══════════════
   Builds dist-web/ — the folder you drag onto a free host to get NoteWell
   onto an iPad.

       node setup/build-web.js       (or: npm run web)

   It is deliberately tiny: one HTML file with every script, style and icon
   inlined, plus a service worker, a manifest and two icon files. Five files
   instead of twenty-odd, which matters because the usual way a student's
   upload goes wrong is a missing sub-folder.

   The small file count also makes offline caching bulletproof — there is
   essentially one asset to cache, so there is nothing to half-cache.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-web');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const b64 = p => fs.readFileSync(path.join(ROOT, p)).toString('base64');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

/* ── index.html, everything inlined ── */
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="css\/app\.css">/,
  '<style>\n' + read('css/app.css') + '\n</style>');

html = html.replace(/<script src="(js\/[^"]+)"><\/script>\s*/g, (m, src) =>
  '<script>\n//<!-- ' + src + ' -->\n' + read(src) + '\n</script>\n');

/* the Apple touch icon has to be inlined too — iOS reads it before anything
   else exists, and a missing one gives you a screenshot as your app icon */
html = html.replace(/href="icons\/apple-touch-icon\.png"/,
  'href="data:image/png;base64,' + b64('icons/apple-touch-icon.png') + '"');
html = html.replace(/href="icons\/icon-192\.png"/,
  'href="data:image/png;base64,' + b64('icons/icon-192.png') + '"');

/* fonts, if they were fetched */
const fontDir = path.join(ROOT, 'fonts');
let fontsInlined = 0;
if (fs.existsSync(fontDir)) {
  for (const f of fs.readdirSync(fontDir)) {
    if (!f.endsWith('.woff2')) continue;
    const url = 'data:font/woff2;base64,' + fs.readFileSync(path.join(fontDir, f)).toString('base64');
    html = html.replace(new RegExp("url\\('\\.\\./fonts/" + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'\\)", 'g'),
      "url('" + url + "')");
    fontsInlined++;
  }
}

/* ── stamp the build, so the app can tell students there's a newer one ── */
const pkg = JSON.parse(read('package.json'));
const builtAt = Date.now();
const version = pkg.version + '.' + Math.floor(builtAt / 60000).toString(36);
html = html.replace('</head>',
  '<meta name="notewell-build" content="' + version + '">\n' +
  '<script>window.NW_BUILD={version:"' + version + '",builtAt:' + builtAt + '};</script>\n</head>');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

/* the file updates.js polls — small, uncached, and the fastest way for an
   installed app to notice a new release */
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({
  version,
  builtAt,
  builtOn: new Date(builtAt).toISOString(),
  notes: process.env.NOTEWELL_NOTES || ''
}, null, 2));

/* ── service worker: one asset, so nothing can half-cache ── */
const sw = `/* NoteWell — offline cache for the web bundle.  Build ${version}

   The whole app is a single HTML file here, so the offline story is simple.
   The page itself is fetched network-first with a short timeout: online, you
   always get the newest build straight away; offline, you get the cached one
   instantly and nothing is different. Everything else is cache-first.

   The cache name contains the build stamp, so publishing a new version
   installs a fresh worker and the old caches are dropped. */
const VERSION = 'notewell-${version}';
const SHELL = ['./', './index.html', './manifest.webmanifest', './version.json',
               './icons/icon-192.png', './icons/icon-512.png'];
const NET_TIMEOUT = 3500;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
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

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.anthropic.com' || url.pathname.startsWith('/api/')) return;

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

  // never cache the version file — it is the thing that reports new builds
  if (url.pathname.endsWith('version.json')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // the page itself: newest build when online, cached copy when not
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), NET_TIMEOUT))
        ]);
        if (res && res.ok) (await caches.open(VERSION)).put('./index.html', res.clone());
        return res;
      } catch (err) {
        return (await caches.match('./index.html')) || (await caches.match('./')) ||
               new Response('NoteWell is offline and no copy was cached yet.', { headers: { 'content-type': 'text/plain' } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetch(req).then(r => { if (r && r.ok) caches.open(VERSION).then(c => c.put(req, r)); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') (await caches.open(VERSION)).put(req, res.clone());
      return res;
    } catch (err) { throw err; }
  })());
});
`;
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

/* ── manifest + the two icons a home screen actually uses ── */
const man = JSON.parse(read('manifest.webmanifest'));
man.icons = man.icons.filter(i => /icon-(192|512)\.png$/.test(i.src));
man.icons.push({ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' });
delete man.shortcuts;
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(man, null, 2));

for (const f of ['icon-192.png', 'icon-512.png']) {
  fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(OUT, 'icons', f));
}

/* a note for whoever opens the folder */
fs.writeFileSync(path.join(OUT, 'READ-ME-FIRST.txt'),
  [
    'NoteWell ' + version + ' — ready to publish',
    '',
    'Upload EVERYTHING INSIDE this folder to your GitHub repo (not the folder',
    'itself). Repo -> Add file -> Upload files -> drag these in -> Commit.',
    'GitHub overwrites same-named files, so you do not need to delete first.',
    '',
    'Pages settings, once: Settings -> Pages -> Deploy from a branch ->',
    'main -> / (root).',
    '',
    'Usually live in 1-2 minutes. Up to ~20 in the worst case.',
    '',
    'Anyone who already has NoteWell installed is offered this version',
    'automatically within a few minutes, and updates with one tap. Their',
    'notes are not affected.',
    '',
    'Keep the address the same. Notes are stored against it, the way a',
    'website remembers you — a different URL is a different, empty NoteWell.',
    ''
  ].join('\n'));

/* ── zip it, if the system can ── */
let zipped = '';
try {
  execFileSync('zip', ['-r', '-q', path.join(ROOT, 'NoteWell-web.zip'), 'dist-web'], { cwd: ROOT });
  zipped = 'NoteWell-web.zip';
} catch (e) { /* zip isn't installed — the folder is what matters */ }

const size = p => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log('\n  Built version ' + version);
console.log('\n  dist-web/');
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'version.json']) console.log('    ' + f.padEnd(22) + size(path.join(OUT, f)));
console.log('    icons/                 2 files');
console.log('    READ-ME-FIRST.txt');
if (fontsInlined) console.log('\n  ' + fontsInlined + ' Garamond weights inlined.');
if (zipped) console.log('\n  ' + zipped + '  ' + size(path.join(ROOT, zipped)));
console.log('\n  To publish to GitHub Pages, copy everything inside dist-web into');
console.log('  your repo and commit. Anyone with it installed is told there is a');
console.log('  new version within a few minutes and updates with one tap.\n');
