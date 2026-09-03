/* ═══════════════ NoteWell — ai.js ═══════════════
   The Claude panel. It can *see* your page: whatever you're looking at is
   flattened to an image and sent with your question, so "solve this" and
   "check my working" work on handwriting, diagrams and imported PDFs.

   Four ways to connect, two of which cost nothing:

     handoff  (free)  your own claude.ai account. NoteWell packages the page
                      and the question; you paste them into Claude in a browser
                      tab and paste the answer back. No key, no billing.
     local    (free)  any OpenAI-compatible server on your own machine —
                      Ollama, LM Studio, Jan, llama.cpp. Runs offline.
     direct   (paid)  your own Anthropic API key, kept on this device.
     proxy    (paid)  the bundled NoteWell server holds the key instead,
                      which is better for a shared or school-owned iPad.
*/
(function (NW) {
  'use strict';
  const E = NW.Engine;

  const AI = NW.AI = {
    cfg: {
      mode: 'handoff',
      key: '', proxy: '',
      model: 'claude-sonnet-5',
      localUrl: 'http://localhost:11434/v1',
      localModel: 'llama3.2-vision',
      geminiKey: '',
      geminiModel: 'gemini-2.5-flash',
      maxTokens: 2000
    },
    history: [],
    busy: false,
    lastHandoff: null
  };

  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

  AI.GEMINI_MODELS = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', hint: 'the free workhorse — reads handwriting well' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', hint: 'faster, a bit less careful' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', hint: 'strongest, but the tightest free limits' }
  ];

  /** what the panel calls itself, given the engine behind it */
  AI.engineName = function () {
    switch (AI.cfg.mode) {
      case 'gemini': return 'Gemini';
      case 'local': return AI.cfg.localModel || 'Local model';
      case 'handoff': return 'Claude';
      default: return 'Claude';
    }
  };

  AI.MODELS = [
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', hint: 'cheapest — about half a cent a question' },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', hint: 'best all-rounder for study help' },
    { id: 'claude-opus-5', name: 'Claude Opus 5', hint: 'deepest reasoning, costs more' }
  ];

  /* Gemini is plumbed in below and works, but it is kept out of the visible
     list for now — flip `hidden` to false (or delete the line) to switch it on. */
  AI.MODES = [
    { id: 'gemini', name: 'Google Gemini key', cost: 'Free', hidden: true,
      blurb: 'Answers appear right here. Gemini\'s free tier needs no card, reads images so it can see your handwriting, and allows roughly 15 questions a minute. Get a key at aistudio.google.com/apikey.' },
    { id: 'handoff', name: 'My claude.ai account', cost: 'Free',
      blurb: 'No key at all. NoteWell copies your page and question; you paste them into Claude in a browser tab and paste the answer back. Works with the free plan.' },
    { id: 'local', name: 'A model on my own computer', cost: 'Free',
      blurb: 'Point NoteWell at Ollama, LM Studio or anything else that speaks the OpenAI API. Runs on your machine, offline.' },
    { id: 'direct', name: 'My Anthropic API key', cost: 'Paid',
      blurb: 'Claude, streaming into the panel. New accounts get about $5 of credit, which is roughly a thousand questions on Haiku.' },
    { id: 'proxy', name: 'Through my NoteWell server', cost: 'Paid',
      blurb: 'Same as above, but the key lives on the server instead of on the tablet.' }
  ];

  const SYSTEM = `You are Claude, built into NoteWell — a note-taking app used by university students.

You are usually looking at a photo of the student's own page: handwriting, diagrams, equations, or an annotated PDF.

How to help:
• Read the page carefully before answering. If handwriting is ambiguous, say what you think it says and carry on.
• When you solve something, show the steps in the order a marker would want to see them. State the rule or theorem you're using by name.
• When you check work, find the *first* place it goes wrong and explain why, rather than listing everything. Be specific and kind — say what is right before what is wrong.
• Use plain text maths that reads well in a note (x^2, sqrt(), ∫, →). No LaTeX delimiters.
• Keep it tight. A student is reading this on a tablet next to their notes.
• If the page is blank or you can't make it out, say so plainly instead of guessing.
• Never invent a citation, a formula, or a number you can't see.`;

  AI.load = async function () {
    const c = await NW.Store.kv('aiConfig');
    if (c) Object.assign(AI.cfg, c);
  };
  AI.save = function () { return NW.Store.kv('aiConfig', NW.deepClone(AI.cfg)); };
  AI.configured = function () {
    switch (AI.cfg.mode) {
      case 'handoff': return true;                 // nothing to set up
      case 'gemini': return !!AI.cfg.geminiKey;
      case 'local': return !!AI.cfg.localUrl;
      case 'proxy': return !!AI.cfg.proxy;
      default: return !!AI.cfg.key;
    }
  };
  AI.isFree = () => ['handoff', 'local', 'gemini'].includes(AI.cfg.mode);
  /** modes that stream an answer straight into the panel */
  AI.isInline = () => ['gemini', 'local', 'direct', 'proxy'].includes(AI.cfg.mode);

  /* ── what Claude gets to look at ── */
  AI.snapshot = async function (mode, format) {
    if (mode === 'none') return null;
    const MAX = 1500;
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const q = format === 'png' ? undefined : 0.86;

    if (mode === 'selection' && E.selection && E.selection.items.length) {
      const sel = E.selection, b = sel.bbox, page = sel.page;
      await E.preloadPage(page);
      const pad = 26;
      const w = Math.max(24, b.x1 - b.x0 + pad * 2), h = Math.max(24, b.y1 - b.y0 + pad * 2);
      const s = Math.min(MAX / Math.max(w, h), 2);
      const c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      const ctx = c.getContext('2d');
      ctx.fillStyle = page.bg || '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(s, 0, 0, s, -(b.x0 - pad) * s, -(b.y0 - pad) * s);
      for (const it of sel.items) E.drawItem(ctx, it, page);
      return [{ label: 'selection', data: c.toDataURL(type, q) }];
    }

    if (mode === 'notebook') {
      const out = [];
      for (const p of E.pages.slice(0, 8)) {
        await E.preloadPage(p);
        const s = Math.min(MAX / Math.max(p.w, p.h), 1);
        out.push({ label: 'page ' + (E.pages.indexOf(p) + 1), data: E.renderPageTo(p, s).toDataURL(type, q) });
      }
      if (E.pages.length > 8) out.push({ label: 'note', text: 'Only the first 8 pages were sent.' });
      return out;
    }

    const page = E.pages[E.active]; if (!page) return null;
    await E.preloadPage(page);
    const s = Math.min(MAX / Math.max(page.w, page.h), 1.4);
    return [{ label: 'page ' + (E.active + 1), data: E.renderPageTo(page, s).toDataURL(type, q) }];
  };

  function splitDataURL(d) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(d);
    return m ? { media_type: m[1], data: m[2] } : null;
  }
  const dataURLToBlob = d => fetch(d).then(r => r.blob());

  /* ═══════════ free route 1: your own claude.ai account ═══════════ */

  AI.CLAUDE_URL = 'https://claude.ai/new';

  AI.handoff = async function (text, opts) {
    const look = (opts && opts.look) || 'page';
    const shots = await AI.snapshot(look, 'png');
    const image = shots && shots[0] && shots[0].data;

    /* the page is an image, so give Claude the same framing the API mode uses */
    const prompt = [
      "I'm a university student. The image is a page from my notes.",
      '',
      text,
      '',
      '(Show your steps clearly, name any rule or theorem you use, and tell me if you' +
      " can't read part of my handwriting rather than guessing.)"
    ].join('\n');

    AI.lastHandoff = { prompt, image, question: text };
    NW.emit('ai:message', { role: 'me', text, shot: image });
    NW.emit('ai:handoff', AI.lastHandoff);
    return AI.lastHandoff;
  };

  /** Safari needs the blob handed over as a promise inside the same gesture. */
  AI.copyImage = async function (dataURL) {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('This browser will not let a page copy images. Use “Save image” instead.');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': dataURLToBlob(dataURL) })]);
  };
  AI.copyText = async function (t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    throw new Error('Clipboard unavailable — select the text and copy it by hand.');
  };
  AI.saveImage = async function (dataURL, name) {
    NW.download(await dataURLToBlob(dataURL), (name || 'notewell-page') + '.png');
  };
  AI.openClaude = function () { window.open(AI.CLAUDE_URL, '_blank', 'noopener'); };

  /** the student pastes Claude's reply back in */
  AI.acceptReply = function (text) {
    if (!text || !text.trim()) return;
    AI.history.push({ role: 'user', content: [{ type: 'text', text: (AI.lastHandoff && AI.lastHandoff.question) || '' }] });
    AI.history.push({ role: 'assistant', content: [{ type: 'text', text }] });
    NW.emit('ai:message', { role: 'ai', text });
  };

  /* ═══════════ the automatic routes ═══════════ */

  AI.ask = async function (text, opts) {
    opts = opts || {};
    if (AI.busy) return;
    if (AI.cfg.mode === 'handoff') return AI.handoff(text, opts);
    if (!AI.configured()) { NW.emit('ai:needsSetup'); return; }

    const local = AI.cfg.mode === 'local';
    if (!navigator.onLine && !local) {
      NW.emit('ai:message', { role: 'sys', text: 'No connection, so ' + AI.engineName() + " can't be reached. Everything else in NoteWell keeps working, and your notes are safe on this device — or point the assistant at a model on your own computer in Settings." });
      return;
    }

    const shots = await AI.snapshot(opts.look || 'page');
    const content = [];
    if (shots) for (const s of shots) {
      if (s.data) {
        const img = splitDataURL(s.data);
        if (img) content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
      }
      if (s.text) content.push({ type: 'text', text: s.text });
    }
    content.push({ type: 'text', text: text });

    AI.history.push({ role: 'user', content });
    NW.emit('ai:message', { role: 'me', text, shot: shots && shots[0] && shots[0].data });
    if (AI.history.length > 16) AI.history.splice(0, AI.history.length - 16);

    AI.busy = true; NW.emit('ai:busy', true);
    const msgId = NW.uid('m_');
    NW.emit('ai:stream:start', msgId);

    const openaiStyle = local || AI.cfg.mode === 'gemini';
    try {
      const res = openaiStyle ? await callOpenAICompatible() : await callAnthropic();
      const full = await readStream(res, msgId, openaiStyle);
      AI.history.push({ role: 'assistant', content: [{ type: 'text', text: full }] });
      NW.emit('ai:stream:end', { id: msgId, text: full });
    } catch (err) {
      NW.emit('ai:stream:end', { id: msgId, text: null });
      NW.emit('ai:message', { role: 'sys', text: err.message || String(err) });
    } finally {
      AI.busy = false; NW.emit('ai:busy', false);
    }
  };

  async function callAnthropic() {
    const body = {
      model: AI.cfg.model, max_tokens: AI.cfg.maxTokens, system: SYSTEM,
      messages: AI.history.map(m => ({ role: m.role, content: m.content })), stream: true
    };
    const url = AI.cfg.mode === 'proxy'
      ? AI.cfg.proxy.replace(/\/$/, '') + '/api/claude'
      : 'https://api.anthropic.com/v1/messages';
    const headers = { 'content-type': 'application/json' };
    if (AI.cfg.mode === 'direct') {
      headers['x-api-key'] = AI.cfg.key;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      let msg = 'Claude returned ' + res.status;
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch { }
      if (res.status === 401) msg = 'That API key was rejected. Check it in Settings → Claude.';
      if (res.status === 429) msg = 'Rate limited — give it a moment and try again.';
      if (res.status === 400 && /credit/i.test(msg)) msg = 'Your Anthropic account is out of credit. You can switch to the free claude.ai route in Settings.';
      throw new Error(msg);
    }
    return res;
  }

  /** Gemini, Ollama, LM Studio, Jan, llama.cpp — all speak this dialect */
  async function callOpenAICompatible() {
    const gemini = AI.cfg.mode === 'gemini';
    const msgs = [{ role: 'system', content: SYSTEM }];
    for (const m of AI.history) {
      const parts = [];
      for (const c of m.content) {
        if (c.type === 'text') parts.push({ type: 'text', text: c.text });
        else if (c.type === 'image') parts.push({ type: 'image_url', image_url: { url: 'data:' + c.source.media_type + ';base64,' + c.source.data } });
      }
      msgs.push({ role: m.role, content: m.role === 'assistant' ? parts.map(p => p.text || '').join('') : parts });
    }

    const base = gemini ? GEMINI_URL : AI.cfg.localUrl.replace(/\/$/, '');
    const url = base + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (gemini) headers['authorization'] = 'Bearer ' + AI.cfg.geminiKey;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({
          model: gemini ? AI.cfg.geminiModel : AI.cfg.localModel,
          messages: msgs, max_tokens: AI.cfg.maxTokens, stream: true
        })
      });
    } catch (e) {
      throw new Error(gemini
        ? 'Could not reach Google. Check your connection, and that the key was pasted in full.'
        : 'Could not reach ' + AI.cfg.localUrl + '. Is the model server running? On a tablet it must be the computer\'s address on your network, not localhost.');
    }
    if (!res.ok) {
      let msg = (gemini ? 'Gemini returned ' : 'The local model server returned ') + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error.message || JSON.stringify(j.error); } catch { }
      if (gemini) {
        if (res.status === 400 && /api key/i.test(msg)) msg = 'That Gemini key was not accepted. Check it in Settings → Assistant.';
        if (res.status === 403) msg = 'Google refused that key. Make sure the Gemini API is enabled for it at aistudio.google.com/apikey.';
        if (res.status === 429) msg = 'You have hit Gemini\'s free limit for the moment — about 15 questions a minute. Wait a minute and ask again.';
      }
      throw new Error(msg);
    }
    return res;
  }

  /** one SSE reader for both wire formats */
  async function readStream(res, msgId, openaiStyle) {
    let full = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let ev; try { ev = JSON.parse(payload); } catch { continue; }
        if (openaiStyle) {
          const d = ev.choices && ev.choices[0] && (ev.choices[0].delta || ev.choices[0].message);
          if (d && d.content) { full += d.content; NW.emit('ai:stream', { id: msgId, text: full }); }
        } else {
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.text) {
            full += ev.delta.text; NW.emit('ai:stream', { id: msgId, text: full });
          } else if (ev.type === 'error') {
            throw new Error((ev.error && ev.error.message) || 'Stream error');
          }
        }
      }
    }
    return full || '(no reply)';
  }

  AI.clear = function () { AI.history = []; AI.lastHandoff = null; NW.emit('ai:cleared'); };

  /** Drop Claude's answer onto the page as a text box. */
  AI.insertAnswer = function (text) {
    const page = E.pages[E.active]; if (!page) return;
    const o = NW.Tools.opts.text;
    const item = {
      id: NW.uid('i_'), type: 'text',
      x: page.w * 0.08, y: page.h * 0.08,
      w: page.w * 0.84, h: 40,
      text, font: o.font, fontName: o.fontName, size: 24, color: o.color,
      bold: false, italic: false, underline: false, align: 'left', lineHeight: 1.4
    };
    const m = document.createElement('canvas').getContext('2d');
    item.h = E.textHeight(m, item);
    E.addItems(page, [item], 'insert answer');
    NW.toast('Added to page ' + (E.active + 1));
  };

})(window.NW);
