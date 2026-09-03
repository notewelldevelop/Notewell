#!/usr/bin/env node
/* ═══════════════ NoteWell — single-file build ═══════════════
   Squashes the whole app — HTML, CSS, every script and the icons — into one
   self-contained .html file you can email to yourself, drop on a USB stick,
   or just double-click. No server, no install, no network.

       node setup/build-standalone.js

   Notes are still saved in the browser's own database, so they survive
   closing the file. (The installable version is nicer — it gets its own
   icon and window — but this one is the lowest-friction way to run NoteWell
   on a machine you don't control, like a library computer.)                */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'NoteWell-standalone.html');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const b64 = p => fs.readFileSync(path.join(ROOT, p)).toString('base64');

let html = read('index.html');

/* inline the stylesheet */
html = html.replace(/<link rel="stylesheet" href="css\/app\.css">/,
  '<style>\n' + read('css/app.css') + '\n</style>');

/* inline every script, in order */
html = html.replace(/<script src="(js\/[^"]+)"><\/script>\s*/g, (m, src) =>
  '<script>\n//<!-- ' + src + ' -->\n' + read(src) + '\n</script>\n');

/* icons as data URLs, and drop the things a single file can't use */
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');
for (const f of ['icon-192.png', 'apple-touch-icon.png']) {
  html = html.replace(new RegExp('href="icons/' + f.replace('.', '\\.') + '"', 'g'),
    'href="data:image/png;base64,' + b64('icons/' + f) + '"');
}

/* a small banner so it's obvious which build this is */
html = html.replace('</head>',
  '<meta name="notewell-build" content="standalone">\n' +
  '<script>window.NOTEWELL_STANDALONE = true;</script>\n</head>');

fs.writeFileSync(OUT, html);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('\n  Built ' + path.relative(process.cwd(), OUT) + '  (' + kb + ' KB)');
console.log('  Double-click it. That is the whole install.\n');
console.log('  Everything works offline. Two small caveats versus the installed build:');
console.log('   • importing a PDF still needs one online trip to fetch the renderer');
console.log('   • no home-screen icon or app window — run `npm start` for that\n');
