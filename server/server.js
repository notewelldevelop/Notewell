#!/usr/bin/env node
/* ═══════════════ NoteWell server ═══════════════
   Zero dependencies. Three jobs:

     1. Serve the app over http:// so it can install as a real offline PWA
        (service workers refuse to run from file://).
     2. Hold accounts so signing in on another device pulls your notebooks
        down. The library arrives already encrypted by the browser — this
        server stores an opaque blob and cannot read your notes.
     3. Optionally proxy Claude, so a shared or school-owned iPad never has
        an API key sitting on it.

   Run:   node server/server.js
   Then:  http://localhost:8787
   Claude proxy:  ANTHROPIC_API_KEY=sk-ant-... node server/server.js
*/
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.NOTEWELL_DATA || path.join(__dirname, 'data');
const USERS = path.join(DATA, 'users.json');
const LIBS = path.join(DATA, 'libraries');
const MAX_BODY = 220 * 1024 * 1024;           // a big library of scans

fs.mkdirSync(LIBS, { recursive: true });
if (!fs.existsSync(USERS)) fs.writeFileSync(USERS, '{}');

const readUsers = () => { try { return JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch { return {}; } };
const writeUsers = u => fs.writeFileSync(USERS, JSON.stringify(u, null, 2));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.map': 'application/json'
};

function send(res, code, body, headers) {
  const h = Object.assign({
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS'
  }, headers || {});
  if (typeof body === 'object' && !Buffer.isBuffer(body)) { body = JSON.stringify(body); h['content-type'] = 'application/json; charset=utf-8'; }
  res.writeHead(code, h);
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > (limit || MAX_BODY)) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const emailKey = e => crypto.createHash('sha256').update(String(e).toLowerCase()).digest('hex').slice(0, 32);

function auth(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return null;
  const users = readUsers();
  for (const email in users) {
    const u = users[email];
    if (u.tokens && u.tokens.some(x => x.t === t && x.exp > Date.now())) return { email, user: u, users };
  }
  return null;
}

/* ── static files ── */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (path.extname(file)) return send(res, 404, 'Not found');
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, b) => e2 ? send(res, 404, 'Not found') : send(res, 200, b, { 'content-type': MIME['.html'] }));
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'content-length': st.size
    };
    if (rel.endsWith('sw.js')) headers['service-worker-allowed'] = '/';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

/* ── Claude proxy (streaming) ── */
function proxyClaude(req, res, body) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 501, { error: 'This server has no ANTHROPIC_API_KEY set. Start it with ANTHROPIC_API_KEY=sk-ant-… node server/server.js, or use your own key in NoteWell → Settings.' });
  const up = https.request({
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-length': Buffer.byteLength(body)
    }
  }, r => {
    res.writeHead(r.statusCode, {
      'content-type': r.headers['content-type'] || 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache'
    });
    r.pipe(res);
  });
  up.on('error', e => send(res, 502, { error: 'Could not reach Claude: ' + e.message }));
  up.end(body);
}

/* ── API ── */
async function api(req, res, url) {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (url === '/api/health') return send(res, 200, { ok: true, name: 'NoteWell', claudeProxy: !!process.env.ANTHROPIC_API_KEY });

  if (url === '/api/claude' && req.method === 'POST') {
    const body = await readBody(req, 32 * 1024 * 1024);
    return proxyClaude(req, res, body);
  }

  if (url === '/api/signup' && req.method === 'POST') {
    const { email, hash } = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
    if (!email || !hash) return send(res, 400, { error: 'Email and password are both required.' });
    const users = readUsers();
    const key = String(email).toLowerCase();
    if (users[key]) return send(res, 409, { error: 'There is already an account with that email. Try signing in.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const token = newToken();
    users[key] = { salt, pw: hashPw(hash, salt), createdAt: Date.now(), tokens: [{ t: token, exp: Date.now() + 365 * 864e5 }] };
    writeUsers(users);
    console.log('[notewell] new account:', key);
    return send(res, 200, { token, email: key });
  }

  if (url === '/api/login' && req.method === 'POST') {
    const { email, hash } = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
    const users = readUsers();
    const key = String(email || '').toLowerCase();
    const u = users[key];
    if (!u) return send(res, 404, { error: 'No account with that email on this server.' });
    const ok = crypto.timingSafeEqual(Buffer.from(hashPw(hash, u.salt)), Buffer.from(u.pw));
    if (!ok) return send(res, 401, { error: 'That password does not match.' });
    const token = newToken();
    u.tokens = (u.tokens || []).filter(x => x.exp > Date.now()).slice(-9);
    u.tokens.push({ t: token, exp: Date.now() + 365 * 864e5 });
    writeUsers(users);
    return send(res, 200, { token, email: key });
  }

  if (url === '/api/library') {
    const a = auth(req);
    if (!a) return send(res, 401, { error: 'Sign in again.' });
    const file = path.join(LIBS, emailKey(a.email) + '.json');
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return send(res, 200, { blob: null, rev: 0 });
      return send(res, 200, fs.readFileSync(file), { 'content-type': 'application/json; charset=utf-8' });
    }
    if (req.method === 'PUT') {
      const body = (await readBody(req)).toString();
      let js; try { js = JSON.parse(body); } catch { return send(res, 400, { error: 'Bad payload' }); }
      if (!js.blob || !js.blob.ct) return send(res, 400, { error: 'Expected an encrypted blob' });
      const rev = Date.now();
      fs.writeFileSync(file, JSON.stringify({ blob: js.blob, rev, device: js.device || null, at: new Date().toISOString() }));
      console.log('[notewell] stored library for', a.email, '(' + (body.length / 1048576).toFixed(1) + ' MB, encrypted)');
      return send(res, 200, { ok: true, rev });
    }
  }

  return send(res, 404, { error: 'Unknown endpoint' });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/')) {
    api(req, res, url.split('?')[0]).catch(e => send(res, 500, { error: e.message }));
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const k in nets) for (const n of nets[k]) if (n.family === 'IPv4' && !n.internal) lan.push(n.address);

  const line = '  ' + '─'.repeat(58);
  console.log('\n  NoteWell is running.');
  console.log(line);
  console.log('   On this computer   http://localhost:' + PORT);
  lan.forEach(a => console.log('   On your tablet     http://' + a + ':' + PORT));

  /* A QR beats typing an IP address on a tablet keyboard. */
  if (lan.length) {
    const url = 'http://' + lan[0] + ':' + PORT;
    try {
      const { QR } = require(path.join(ROOT, 'js', 'qr.js'));
      console.log('\n   Point your tablet camera at this:\n');
      console.log(QR.ascii(url, 2).split('\n').map(r => '   ' + r).join('\n'));
    } catch (e) { /* no QR, the address above still works */ }
  }

  console.log('\n' + line);
  console.log('   Opening it this way is fine for using NoteWell, but a tablet will');
  console.log('   only install it as a proper offline app over https. When you want');
  console.log('   that, run  npm run web  and drag the dist-web folder onto');
  console.log('   app.netlify.com/drop — it takes about two minutes, once.');
  console.log(line);
  console.log('   Accounts + sync: on. Libraries are encrypted in the browser before');
  console.log('   upload, so this server cannot read your notes.');
  console.log('   Claude proxy: ' + (process.env.ANTHROPIC_API_KEY ? 'enabled' : 'off (set ANTHROPIC_API_KEY to enable)'));
  console.log('   Data folder: ' + DATA + '\n');
});
