#!/usr/bin/env node
/* ═══════════════ NoteWell — one-time vendor fetch ═══════════════
   NoteWell writes its own PDF *exporter*, but reading an existing PDF needs a
   real renderer, and pdf.js is the only sane choice. Run this once with a
   connection and NoteWell never needs the internet again:

       node setup/fetch-vendor.js

   (If you skip it, NoteWell downloads the same files the first time you import
   a PDF and caches them in its own database — this script just gets it out of
   the way ahead of time, e.g. before a flight.)
*/
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const VER = '3.11.174';
const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + VER + '/';
const OUT = path.join(__dirname, '..', 'vendor');
const FILES = ['pdf.min.js', 'pdf.worker.min.js'];

fs.mkdirSync(OUT, { recursive: true });

function get(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(get(res.headers.location, dest));
      if (res.statusCode !== 200) return reject(new Error(url + ' → HTTP ' + res.statusCode));
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
    }).on('error', reject);
  });
}

(async () => {
  console.log('Fetching the PDF renderer (pdf.js ' + VER + ')…');
  for (const f of FILES) {
    const dest = path.join(OUT, f);
    process.stdout.write('  ' + f + ' … ');
    try {
      await get(BASE + f, dest);
      console.log((fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
    } catch (e) {
      console.log('failed — ' + e.message);
      console.log('\n  No harm done: NoteWell will fetch it automatically the first');
      console.log('  time you import a PDF while online, then cache it for good.\n');
      process.exit(0);
    }
  }
  console.log('\nDone. PDF import now works with no network at all.\n');
})();
