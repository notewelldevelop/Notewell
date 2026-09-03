# NoteWell — notes for whoever works on this next

A handwriting app for university students. Plain JavaScript, no framework, no
bundler, no runtime dependencies. Thirteen-odd IIFE modules hanging off a global
`NW`, loaded as `<script>` tags in dependency order from `index.html`.

Run it: `npm start` → http://localhost:8787
Test it: `npm test`
Ship it: `npm run release`

---

## The release convention

Versions step by **0.1** — 1.5 → 1.6 → 1.7. `npm run release` bumps
`package.json`, rebuilds `dist-web`, and files a copy in
`~/Desktop/Notewell/Version 1.6`. Every published build stays on disk.

The built folder is what gets uploaded to GitHub Pages. Keep the address
stable: **notes are stored per web origin**, so renaming the repo or adding a
custom domain gives everyone an empty NoteWell and strands their work.

---

## Things that were painful to learn

Please don't undo these without a good reason. Each one came from a real bug.

**Gestures that reinterpret ink are off by default.** `scribbleWhileWriting`,
`holdToSnap`, and the browser `pencilDoubleTap` fallback. Writing produces a
constant stream of short strokes — i-dots, commas, the crossbar of a t — and
anything that second-guesses them will eventually eat a word. They are all one
checkbox away for people who want them.

**Changing a default is not enough on its own.** Saved settings are merged over
the defaults, so a default change never reaches anyone who has used the app
before. Bump `SETTINGS_VERSION` in `tools.js` and add a migration branch.

**Ink is drawn as discs joined by quadrangles, never as a traced outline.**
An outline that runs up one side and back down the other folds over itself on
tight curves, and the nonzero fill rule turns the fold into a hole — that was
the crescent-shaped bites out of letters. Every subpath must wind the same way
or the overlaps cancel; `tests/winding.py` proves it, so run it after touching
`fillVariableStroke` or `fillConstantStroke`.

**The centreline is splined before width is applied.** A stylus reports a point
every few millimetres; joining those with straight edges makes an `o` look like
a polygon.

**One drawing pointer at a time, and a new pen down always takes over.**
Ignoring a new `pointerdown` while another pointer was active dropped strokes
constantly when writing quickly, because lift-and-tap events arrive out of order
under load.

**Pointer ids are recycled, so an id match proves nothing.** iPadOS hands the
Pencil the *same* `pointerId` stroke after stroke. A `pointerdown` on the id
already drawing is therefore the next letter, not a repeat — treating it as a
duplicate threw the whole stroke away. And a `pointerup` on that id may be the
*previous* stroke's lift arriving late; acting on it tears the canvas away from
a stroke that has only just started, and its moves then fall through to nobody.
`ev.timeStamp` shares an origin with `performance.now()`, so anything stamped
before the current stroke began is a straggler. Between them these two were the
second stem of an H and the stem of an I going missing at speed. Any new test
here must reuse a pointer id — the older ones all take a fresh one per stroke,
which is why this hid for so long.

**Tilt is width, and width means the variable-width renderer.** Tilt is measured
per sample and stored on the points, so a stroke drawn with a laid-over nib has
to go through `fillVariableStroke` whether or not Pressure was ticked. It also
means toggling Tilt only ever affects the *next* stroke; ink already down keeps
the width it was drawn with.

**The live canvas cannot `multiply`.** It sits above the paper, so a multiply
composite inside it has nothing to multiply against and the highlighter came out
opaque until the pen lifted. The blend belongs on the layer
(`#live.blend-multiply`), not in the context.

**Exports are lossless.** Handwriting is the worst case for JPEG — thin dark
strokes on white are exactly the edge it smears.

**Scribble-erase counts reversals along the long axis only.** Counting the short
axis too catches every letter with an up-and-down stroke, which is most of them.
It needs four passes, and it deletes only what it genuinely crossed or ran over —
never what is merely nearby.

---

## Layout

```
index.html          shell + toolbar; script order matters
js/util.js          helpers, geometry, theme
js/qr.js            QR encoder, for the install screen
js/templates.js     paper sizes and rulings
js/shapes.js        shape correction + scribble detection
js/store.js         IndexedDB, library model, encrypted sync
js/engine.js        camera, layout, renderer, history
js/text.js          text boxes
js/tools.js         every gesture
js/pdfwriter.js     PDF writer, from scratch
js/zipwriter.js     ZIP writer, from scratch
js/pdfimport.js     PDF in, all export paths
js/ai.js            assistant (Gemini is present but hidden — see AI.MODES)
js/sync.js          save-as-you-go, offline queue
js/backup.js        file backup
js/ui.js            panels, dialogs, library
js/install.js       install screen
js/updates.js       new-version detection
js/app.js           boot, shortcuts, drag-and-drop
server/server.js    static host + accounts + optional Claude proxy
setup/              build and release scripts
tests/              node tests + two python verifiers
```

## Tests

```
node tests/selftest.mjs    pure logic: geometry, shapes, scribble, PDF, ZIP, QR
node tests/session.mjs     the whole app in a mock DOM, driven by fake stylus events
python3 tests/winding.py   proves the ink outline has no holes
python3 tests/qr-decode.py proves the QR codes actually scan
```

Run all four before a release. The session suite is where bugs get caught —
if a stroke ever vanishes again, reproduce it there first.

## Docs

- `PUBLISHING.md` — releasing to GitHub Pages
- `INSTALL-ON-IPAD.md` — hand this to students
- `README.md` — the feature tour
