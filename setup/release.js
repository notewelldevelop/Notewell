#!/usr/bin/env node
/* ═══════════════ NoteWell — cut a release ═══════════════
   Bumps the version by 0.1, builds the web bundle, and drops a copy into a
   folder named after it — so every version you have ever published stays on
   disk and you can always go back to one.

       npm run release              → 1.5 becomes 1.6, saved as "Version 1.6"
       npm run release -- --same    → rebuild without bumping
       npm run release -- --notes "Fixed the highlighter"

   Where the copies go, in order of preference:
       $NOTEWELL_RELEASES
       ~/Desktop/Notewell
       ./releases
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const same = args.includes('--same');
const notesAt = args.indexOf('--notes');
const notes = notesAt >= 0 ? (args[notesAt + 1] || '') : '';

/* ── where the versioned folders live ── */
function shelf() {
  if (process.env.NOTEWELL_RELEASES) return process.env.NOTEWELL_RELEASES;
  const desktop = path.join(os.homedir(), 'Desktop', 'Notewell');
  if (fs.existsSync(desktop)) return desktop;
  return path.join(ROOT, 'releases');
}

/* ── bump 1.5.0 → 1.6.0 ── */
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [maj, min] = pkg.version.split('.').map(Number);

if (!same) {
  pkg.version = maj + '.' + (min + 1) + '.0';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
const label = pkg.version.split('.').slice(0, 2).join('.');   // "1.6"

/* ── build ── */
console.log('\n  Building NoteWell ' + label + '…');
execFileSync(process.execPath, [path.join(__dirname, 'build-web.js')], {
  cwd: ROOT, stdio: 'inherit',
  env: Object.assign({}, process.env, notes ? { NOTEWELL_NOTES: notes } : {})
});

/* ── file it away ── */
const dest = path.join(shelf(), 'Version ' + label);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'dist-web'), dest, { recursive: true });

const files = [];
(function walk(dir, rel) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, path.join(rel, f));
    else files.push(path.join(rel, f));
  }
})(dest, '');

console.log('  Saved to  ' + dest);
files.sort().forEach(f => console.log('    ' + f));
console.log('\n  Upload the contents of that folder to GitHub.');
console.log('  Anyone running an older build is offered this one automatically.\n');
