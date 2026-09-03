#!/usr/bin/env python3
"""
NoteWell — prove the QR encoder actually scans.

The JavaScript tests check the structure of a symbol; this renders symbols to
images and reads them back with a real decoder, which is the only test that
matters for something a camera has to read off a laptop screen.

    pip install opencv-python numpy
    node tests/qr-dump.mjs | python3 tests/qr-decode.py

or just:

    python3 tests/qr-decode.py          (it runs the dump for you)
"""
import json
import subprocess
import sys
import os

try:
    import numpy as np
    import cv2
except ImportError:
    sys.exit("This needs opencv-python and numpy:  pip install opencv-python numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DUMP = r"""
import fs from 'node:fs'; import vm from 'node:vm';
const win = { TextEncoder, console }; win.window = win;
const c = vm.createContext(win);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), c, { filename: 'qr.js' });
const QR = win.NW.QR;
const cases = [
  'https://notewell.netlify.app/',
  'http://192.168.1.14:8787',
  'http://localhost:8787',
  'https://jongrak.github.io/notewell/',
  'https://shiny-otter-1a2b3c.netlify.app/index.html',
  'https://a-fairly-long-subdomain-name.pages.dev/notewell/index.html',
  'https://notewell-' + 'x'.repeat(50) + '.app/'
];
const out = {};
for (const t of cases) {
  const qr = QR.encode(t);
  const rows = [];
  for (let y = 0; y < qr.size; y++) {
    let r = '';
    for (let x = 0; x < qr.size; x++) r += qr.get(x, y) ? '1' : '0';
    rows.push(r);
  }
  out[t] = { version: qr.version, size: qr.size, rows };
}
process.stdout.write(JSON.stringify(out));
"""


def render(info, quiet=4, scale=16):
    n = info["size"]
    side = (n + quiet * 2) * scale
    img = np.ones((side, side), dtype=np.uint8) * 255
    for y, row in enumerate(info["rows"]):
        for x, ch in enumerate(row):
            if ch == "1":
                y0 = (y + quiet) * scale
                x0 = (x + quiet) * scale
                img[y0:y0 + scale, x0:x0 + scale] = 0
    return img


def main():
    dump = os.path.join(HERE, "_qr_dump.mjs")
    with open(dump, "w") as f:
        f.write(DUMP)
    try:
        raw = subprocess.check_output(
            ["node", dump, os.path.join(ROOT, "js", "qr.js")], text=True)
    finally:
        os.remove(dump)

    data = json.loads(raw)
    det = cv2.QRCodeDetector()
    ok = fail = 0

    for text, info in data.items():
        # a couple of render sizes — OpenCV's detector is fussy at small scales,
        # so a symbol counts as good if it reads at any realistic size
        decoded = False
        for scale in (12, 16, 24):
            val, _, _ = det.detectAndDecode(render(info, scale=scale))
            if val == text:
                decoded = True
                break
        if decoded:
            ok += 1
            print("  ok   v%d  %s" % (info["version"], text[:58]))
        else:
            fail += 1
            print("  FAIL v%d  %s" % (info["version"], text[:58]))

    print("\n  %d decoded, %d failed\n" % (ok, fail))
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
