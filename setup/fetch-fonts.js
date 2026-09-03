#!/usr/bin/env node
/* ═══════════════ NoteWell — fetch Garamond ═══════════════
   NoteWell is set in Garamond. Windows has a real Garamond, and iPadOS and
   macOS fall back to Baskerville, which is close enough that most people never
   notice. If you want the actual thing on every device, run this once:

       node setup/fetch-fonts.js

   It pulls EB Garamond (SIL Open Font Licence, free to redistribute) from
   Google Fonts into fonts/, where css/app.css is already looking for it.
   After that NoteWell uses it everywhere, offline, on every device you
   install it on.
*/
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'fonts');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap';
// a modern UA is what makes Google hand back woff2 rather than ttf
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const WANT = [
  { weight: '400', style: 'normal', file: 'EBGaramond-Regular.woff2' },
  { weight: '500', style: 'normal', file: 'EBGaramond-Medium.woff2' },
  { weight: '600', style: 'normal', file: 'EBGaramond-SemiBold.woff2' },
  { weight: '400', style: 'italic', file: 'EBGaramond-Italic.woff2' }
];

function get(url, binary) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': UA } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(get(res.headers.location, binary));
      if (res.statusCode !== 200) return reject(new Error(url.slice(0, 60) + '… → HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

/** pull the @font-face blocks apart into {style, weight, url} */
function parseFaces(css) {
  const out = [];
  const blocks = css.split('@font-face').slice(1);
  for (const b of blocks) {
    const style = (/font-style:\s*([a-z]+)/.exec(b) || [, 'normal'])[1];
    const weight = (/font-weight:\s*(\d+)/.exec(b) || [, '400'])[1];
    const url = (/src:[^;]*url\(([^)]+)\)/.exec(b) || [])[1];
    // Google splits each face across unicode-ranges; latin comes last and is
    // the one we want, so later matches overwrite earlier ones
    const latin = /unicode-range:[^;]*U\+0000-00FF/.test(b);
    if (url) out.push({ style, weight, url: url.replace(/['"]/g, ''), latin });
  }
  return out;
}

(async () => {
  console.log('\n  Fetching EB Garamond…\n');
  fs.mkdirSync(OUT, { recursive: true });
  let css;
  try {
    css = await get(CSS_URL, false);
  } catch (e) {
    console.log('  Could not reach Google Fonts: ' + e.message);
    console.log('\n  No harm done — NoteWell falls back to whatever old-style serif your');
    console.log('  device has (Baskerville on an iPad, Garamond itself on Windows).\n');
    process.exit(0);
  }

  const faces = parseFaces(css);
  let got = 0;
  for (const want of WANT) {
    const match = faces.filter(f => f.style === want.style && f.weight === want.weight);
    const face = match.find(f => f.latin) || match[match.length - 1];
    if (!face) { console.log('  ' + want.file + ' … not offered'); continue; }
    try {
      const buf = await get(face.url, true);
      fs.writeFileSync(path.join(OUT, want.file), buf);
      console.log('  ' + want.file.padEnd(30) + (buf.length / 1024).toFixed(0) + ' KB');
      got++;
    } catch (e) {
      console.log('  ' + want.file + ' … failed (' + e.message + ')');
    }
  }

  if (!got) {
    console.log('\n  Nothing downloaded. NoteWell will use the fallback serif.\n');
    process.exit(0);
  }
  fs.writeFileSync(path.join(OUT, 'LICENCE.txt'),
    'EB Garamond by Georg Duffner and Octavio Pardo.\n' +
    'Licensed under the SIL Open Font License 1.1 — https://scripts.sil.org/OFL\n' +
    'Free to use, embed and redistribute, including in this application.\n');

  console.log('\n  Done — ' + got + ' weights in fonts/. Reload NoteWell to see it.\n');
})();
