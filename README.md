# NoteWell

Handwritten notes, PDFs and Claude — built for university students. Black and
white, set in Garamond, light or dark. It runs on an iPad, an Android tablet, a
laptop, or all three at once, and it works with the wifi switched off.

**Installing on an iPad? → [INSTALL-ON-IPAD.md](INSTALL-ON-IPAD.md)** — that's
the detailed walkthrough.

---

## Start it in ten seconds

**Easiest — one file, no install**

Double-click **`NoteWell-standalone.html`**. That's it. The whole app is inside
that single file; your notes are saved in the browser's database and survive
closing it.

**Best — a real app with its own icon and offline cache**

| Your machine | Do this |
|---|---|
| Mac / Linux | double-click `START-mac-linux.command` |
| Windows | double-click `START-windows.bat` |
| Any (terminal) | `npm start` |

Then open **http://localhost:8787**. In Chrome or Edge click the install icon in
the address bar. It now launches in its own window, offline, like any other app.

**On an iPad or Android tablet — published on GitHub Pages**

```bash
npm run web        # builds dist-web/ and stamps it with a version
```

Upload the contents of `dist-web` to your repo. Students open the Pages address
in Safari and use Share → **Add to Home Screen**.

The hosting step isn't optional busywork: Add to Home Screen only becomes a
*real* offline app over **https**, which is a platform rule, so a
`http://192.168.x.x` address from a laptop can show NoteWell but can never
install it. The bundle is deliberately six files rather than twenty-odd,
because the usual way an upload goes wrong is a missing sub-folder.

**Updates take care of themselves.** Each build is stamped, installed copies
check for a newer one, and a small bar offers it — one tap, notes untouched.
Publishing checklist and the gotchas: **[PUBLISHING.md](PUBLISHING.md)**.
The guide to hand your classmates: **[INSTALL-ON-IPAD.md](INSTALL-ON-IPAD.md)**.

**As a downloadable desktop program** (.dmg / .exe / .AppImage)

```bash
npm install          # once — pulls Electron
npm run desktop      # try it
npm run dist         # build installers into dist/
```

**As a native iPad / Android app**

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap add ios && npx cap add android
npx cap sync && npx cap open ios
```

Add `mobile/ios/NoteWellPencilPlugin.swift` to the Xcode project for the real
Apple Pencil double-tap, and `mobile/android/StylusButtonBridge.kt` for the
S Pen button.

---

## How it looks

Black and white throughout — no accent colour anywhere in the interface, so the
only colour on screen is the colour you put on the page yourself. Set in
Garamond, with light and dark modes on the sun/moon button in the toolbar
(light → dark → match device).

iPadOS and macOS don't ship Garamond, so NoteWell falls back to Baskerville,
which is a close cousin; Windows has the real thing. For actual Garamond
everywhere, `node setup/fetch-fonts.js` pulls EB Garamond (open licence) into
`fonts/` once and it's bundled from then on.

**Colours are five at a time.** Each tool shows the five you reached for most
recently, so the ones you actually use drift to the front on their own. The ⋯
button opens the full palette, a system colour picker and a hex box. Papers are
neutral — white, ivory, soft grey, newsprint, graphite, blackboard.

---

## What's in it

### Writing

- **Pen** — pressure-sensitive, so the line thickens as you press. Six weights,
  any colour.
- **Highlighter** — blends with `multiply`, so it *tints* your words instead of
  painting over them. Chisel or round nib, freehand or ruler-straight.
- **Shapes** — draw a rough circle, box, triangle, line or arrow and it snaps.
  Two ways: pick the Shapes tool, or just draw with the pen and **hold still for
  half a second** — the wobble straightens under your hand, the way GoodNotes
  and Kilonotes do it.
- **Two erasers**
  - *Sweep* leaves a grey trail; anything it touches is removed **whole**, never
    half a letter. The entire sweep is one undo.
  - *Scribble* is the GoodNotes gesture: scribble back and forth over a mistake
    and the mistake **and the scribble** both vanish. It's also on by default
    while you're writing with the pen, so you never have to change tools.
  - Filters: ink only, or highlighter only.
- **Lasso** — circle any working, then drag the whole group anywhere. Corner
  handles resize it. Duplicate, recolour, reorder or delete from the floating
  bar. Filter to ink, images or text only.
- **Paint bucket** — tap inside any closed outline. Fills sit *under* your ink
  so your writing stays on top. Adjustable tolerance and edge bleed.
- **Text** — every font Word ships with, each with a fallback chain so a
  document written on a Mac still looks right on an Android tablet. 8–120 pt,
  bold/italic/underline, alignment, text highlighting.
- **Images** — insert, paste or drag-and-drop, then move and resize.

Every tool is a small icon along the top. Options for whatever you're holding
appear in the row underneath.

### Paper

Fourteen rulings — blank, lined, narrow, lined-with-margin, grid, 5 mm graph,
dotted, wide dots, Cornell, checklist, manuscript, isometric, day planner,
half-grid lab paper — on six neutral papers including two dark ones. A4, Letter,
A5, square, 16:9 and tablet sizes, portrait or landscape, mixed freely within
one notebook.

**Adding pages:** keep pulling past the bottom of the last page and hold — a
ring fills and a new page appears with the same ruling. For a *different*
layout, the `+` icon opens the picker.

### Files

Nested folders holding notebooks. Rename, move, duplicate, search.

**Getting things out:**

- a notebook → PDF (72 / 150 / 300 dpi), or just pages `1-4, 7, 10-`
- a single page → PDF or PNG
- **a folder → one `.zip` of PDFs with the folder tree preserved inside**
- **a folder → one merged PDF, each notebook a bookmark**
- anything → `.nwbak`, a complete backup you can restore anywhere

Typed text is written into exported PDFs as an invisible layer, so your notes
stay searchable and selectable in any PDF reader.

### PDFs in

Drop a slide deck or past paper anywhere in the app. Every page becomes a
NoteWell page you can write on, and it exports back out with your annotations.

### Claude — including two ways that cost nothing

Tap **Claude** (or ⌘K). It sends a picture of what you're looking at — this
page, just your lasso selection, or the whole notebook — so it can read
handwriting, diagrams and equations.

| Route | Cost | What happens |
|---|---|---|
| **My claude.ai account** *(default)* | Free | NoteWell copies your question and the page image and opens claude.ai. Paste them in, paste the answer back. Works on the free plan. |
| **A model on my own computer** | Free | Point it at Ollama, LM Studio, Jan or llama.cpp. Runs offline. Use a vision model so it can see the page. |
| **My Anthropic API key** | Paid | Answers stream into the panel. No free tier, but a new console account gets ~$5 credit and a page-plus-answer on Haiku is about half a cent — roughly a thousand questions. |
| **Through my NoteWell server** | Paid | Same, with the key on the server instead of the tablet. Better for a shared iPad. |

Either way: *Solve it*, *Check my work* (it finds the **first** thing that goes
wrong and says why), *Explain*, *Flashcards*, *Summarise* — and "Add to page"
drops the answer into your notes as text.

### Saving as you go

Signed in, NoteWell saves by itself: when you open a notebook, about twenty
seconds after you stop writing, and when you close it. Everything is encrypted
**in your browser** with a key derived from your password before it is
uploaded, so the server only ever holds a blob it cannot read.

**With no connection it queues rather than complains.** The chip in the toolbar
reads *"Offline — saved on this iPad"*, because that is the truth: every stroke
is written to the device the instant you make it, and the account is a copy.
It uploads itself when the signal comes back.

Two devices are merged **notebook by notebook** — whichever copy of each
notebook was edited most recently wins, so a laptop and an iPad working on
different subjects both keep their work.

Run your own server with `npm start` — accounts and sync are already in it.

### Backup to a real file

Because a browser database shouldn't be the only copy of a semester's notes.

- **Desktop** — pick a folder once and NoteWell writes into it roughly every
  half hour. Point it at iCloud Drive and the backup reaches your iPad on its
  own.
- **iPad** — **Save to Files**, one tap, via the iOS share sheet. Safari won't
  let a page write files unattended; that's an iOS rule, not a NoteWell one.

Either way it's a `.nwbak` holding every notebook, page and image, and NoteWell
tells you when the last one is over a week old.

---

## Apple Pencil double-tap

**In the native iPad build.** Safari deliberately never exposes the Pencil's
double-tap to web pages; only native code can see it, through
`UIPencilInteraction`. `mobile/ios/NoteWellPencilPlugin.swift` is a small
Capacitor plugin that attaches that interaction to the app's web view and
forwards it in as a normal event — including the Pencil Pro squeeze, and it
respects what you've set in Settings → Apple Pencil.

**In a browser or the standalone file.** NoteWell watches for two very quick
taps of the pen tip: both under 170 ms, barely any movement, less than 420 ms
apart. The first dot is held back for 320 ms — if a second tap lands, both dots
are thrown away and the tool flips instead, so a mis-fire never leaves a mark.
There's a test asserting exactly that.

Either way you choose what it does: pen ⇄ eraser, pen ⇄ lasso, or "last two
tools". On Android, `mobile/android/StylusButtonBridge.kt` maps the S Pen barrel
button and Air actions to the same thing. On a keyboard it's `E`.

---

## Keyboard

`1`–`9` tools · `E` swap pen/eraser · `⌘Z` / `⌘⇧Z` undo, redo · `⌘A` select all
on page · `⌘C` `⌘X` `⌘V` · `Delete` · `⌘K` Claude · `⌘S` export · `⌘0` fit width
· `⌘±` zoom · `⌘F` search the library

## Pen only, by default

A stylus draws. Fingers scroll. A mouse draws, so desktops still work. That's
the rule, and it holds from the first launch — rest your whole hand on the
screen and nothing happens.

The mechanism is one owner at a time: when a pen goes down it takes
`setPointerCapture` and every other pointer on the glass becomes bookkeeping
only, unable to draw, pan or pinch until the pen lifts. A pen arriving during a
two-finger pan cancels the gesture and wins. If the pen leaves the edge of the
screen, or iPadOS interrupts, the stroke is committed rather than lost.

Width comes from `pressure` and from `tiltX`/`tiltY` — lay the Pencil over and
it shades with the side of the nib. Both are toggles on the pen row; with
pressure off you get a clean constant-width line. Input is read through
`getCoalescedEvents()`, so every sample the Pencil produced between frames is
used, not just the last one.

**Finger draws** in Settings → Writing is off by default and is there for
students without a stylus. It stands itself down the moment a pen touches the
screen.

## Where your notes live

In your device's own IndexedDB; NoteWell asks for persistent storage on first
run. Nothing is transmitted anywhere unless you sign in to sync or ask Claude.
The desktop build keeps its data under the app's user-data folder (Help →
*Where are my notes stored?*). Keep a `.nwbak` somewhere safe anyway —
Library → *Backup / restore*.

## One thing that needs the internet, once

NoteWell writes its own PDF *exporter* from scratch, but *reading* an existing
PDF needs a real renderer, and pdf.js is the sensible choice. It's fetched once
and cached inside the app's own database, so every import after that is offline.
To get it out of the way ahead of time:

```bash
node setup/fetch-vendor.js
```

Everything else — writing, shapes, erasing, filling, text, images, PDF export,
ZIP export, backups — has zero dependencies and has never needed a network.

---

## Tests

```bash
npm test
# or individually:
node tests/selftest.mjs    # 41 — geometry, shape recognition, scribble
                           #      detection, contrast, QR, the PDF and ZIP writers
node tests/session.mjs     # 84 — the whole app in a mock DOM, driven by
                           #      synthetic stylus events end to end
python3 tests/qr-decode.py # renders the QR codes and reads them back with
                           # OpenCV — the only test that proves a camera
                           # can actually scan them
```

The session test draws with a fake Apple Pencil: it strokes, snaps a box,
scribbles something out, sweeps the eraser, lassos a group and drags it, floods
a closed shape, types into a text box, double-taps the pencil, pinches to zoom,
switches theme, checks the colour row really is five wide, exercises all four
Claude routes, and exports a PDF — then checks the results.

Exported PDFs have been verified against `qpdf --check`, `pdfinfo` and `pypdf`
(bookmarks and the searchable text layer both come through); exported ZIPs
against `unzip -t`.

---

## Layout

```
index.html                  the app shell and the toolbar
css/app.css                 the black-and-white theme, light and dark
js/util.js                  helpers, geometry, RDP, smoothing, the theme switch
js/qr.js                    a QR encoder, from scratch, for the install screen
js/templates.js             paper sizes and the rulings
js/shapes.js                shape correction + scribble-to-erase
js/store.js                 IndexedDB, the library model, encrypted sync
js/engine.js                camera, page layout, renderer, history
js/text.js                  text boxes and the Word font list
js/tools.js                 every gesture: pen, erasers, lasso, fill, Pencil
js/pdfwriter.js             a PDF writer, from scratch
js/zipwriter.js             a ZIP writer, from scratch
js/pdfimport.js             PDF in, and all the export paths
js/ai.js                    Claude — free hand-off, local model, API
js/ui.js                    panels, dialogs, the library shelf, the palette
js/install.js               the install screen, QR code and iOS nudge
js/sync.js                  saving to your account, and the offline queue
js/backup.js                folder auto-backup and Save to Files
js/updates.js               noticing a new version and offering it
js/app.js                   boot, shortcuts, drag-and-drop
sw.js                       offline cache
server/server.js            static host + accounts + optional Claude proxy
desktop/main.js             Electron wrapper
mobile/ios/…Pencil….swift   the real Apple Pencil double-tap
mobile/android/…Stylus….kt  S Pen button
setup/make-icons.py         the NW monogram, at every size
setup/fetch-fonts.js        real EB Garamond, once, for full offline
setup/fetch-vendor.js       pre-fetches pdf.js for offline PDF import
setup/build-web.js          the five-file bundle you drag onto a host
setup/build-standalone.js   squashes it all into one .html
tests/                      125 tests + a QR decode check
INSTALL-ON-IPAD.md          the iPad walkthrough, for students
PUBLISHING.md               shipping updates via GitHub Pages, for you
.github/workflows/          optional: build and publish on every push
```

MIT. The icons were drawn with URW Palladio; `setup/make-icons.py --font …`
regenerates them with a real Garamond if you have one.
