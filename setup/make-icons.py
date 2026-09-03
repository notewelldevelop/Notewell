#!/usr/bin/env python3
"""
NoteWell — app icon generator.

An overlapping NW monogram, black on white, set in an old-style serif.

The icons in icons/ were made with URW Palladio, a libre old-style face that is
the closest thing to Garamond available on a bare Linux box. If you have a real
Garamond — Adobe Garamond, EB Garamond, or the Garamond that ships with
Microsoft Office — point this at it and regenerate:

    python3 setup/make-icons.py --font "/Library/Fonts/EBGaramond-Regular.ttf"
    python3 setup/make-icons.py --font "C:/Windows/Fonts/GARA.TTF"

Options:
    --font PATH      any .ttf/.otf/.pfb
    --overlap 0.07   how much the W tucks under the N (0 = touching, 0.2 = merged)
    --out icons      output folder

Needs Pillow:  pip install pillow
"""
import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("This needs Pillow:  pip install pillow")

DEFAULT_FONTS = [
    # a real Garamond, if the machine has one
    "/System/Library/Fonts/Supplemental/EBGaramond-Regular.ttf",
    "/Library/Fonts/EBGaramond-Regular.ttf",
    "C:/Windows/Fonts/GARA.TTF",
    "/usr/share/fonts/truetype/ebgaramond/EBGaramond-Regular.ttf",
    # otherwise the closest old-style faces, in order of preference
    "/usr/share/fonts/opentype/urw-base35/P052-Roman.otf",       # Palatino
    "/System/Library/Fonts/Supplemental/Baskerville.ttc",
    "/usr/share/fonts/opentype/urw-base35/C059-Roman.otf",       # Century Schoolbook
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
]

BLACK = (13, 13, 13, 255)
WHITE = (255, 255, 255, 255)


def pick_font(explicit):
    if explicit:
        if not os.path.exists(explicit):
            sys.exit("No font at " + explicit)
        return explicit
    for p in DEFAULT_FONTS:
        if os.path.exists(p):
            return p
    sys.exit("Could not find a serif font. Pass one with --font")


def monogram(font_path, size, overlap=0.07, width_frac=0.84, maskable=False, invert=False):
    S = 2048
    bg, fg = (BLACK, WHITE) if invert else (WHITE, BLACK)
    im = Image.new("RGBA", (S, S), bg)
    d = ImageDraw.Draw(im)

    # maskable icons need a safe zone — Android crops to a circle
    box = S * (width_frac * 0.82 if maskable else width_frac)

    pt = int(box)
    f = ImageFont.truetype(font_path, pt)
    for _ in range(3):                       # converge on a size that fills the box
        nb = d.textbbox((0, 0), "N", font=f)
        wb = d.textbbox((0, 0), "W", font=f)
        total = (nb[2] - nb[0]) * (1 - overlap) + (wb[2] - wb[0])
        pt = max(8, int(pt * box / total))
        f = ImageFont.truetype(font_path, pt)

    nb = d.textbbox((0, 0), "N", font=f)
    wb = d.textbbox((0, 0), "W", font=f)
    nW, wW = nb[2] - nb[0], wb[2] - wb[0]
    total = nW * (1 - overlap) + wW
    h = max(nb[3] - nb[1], wb[3] - wb[1])
    x = (S - total) / 2
    y = (S - h) / 2 - nb[1]

    # W first, so where they cross the N's diagonal sits on top
    d.text((x + nW * (1 - overlap) - wb[0], y), "W", font=f, fill=fg)
    d.text((x - nb[0], y), "N", font=f, fill=fg)
    return im.resize((size, size), Image.LANCZOS)


SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#ffffff"/>
  <text x="256" y="256" fill="#0d0d0d" text-anchor="middle" dominant-baseline="central"
        font-size="250" letter-spacing="-30"
        font-family="Garamond, 'EB Garamond', 'Adobe Garamond Pro', 'Apple Garamond', Baskerville, 'Iowan Old Style', Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif">NW</text>
</svg>
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default=None)
    ap.add_argument("--overlap", type=float, default=0.07)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "icons"))
    a = ap.parse_args()

    font = pick_font(a.font)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    print("Font:", font)

    for s in (192, 512, 1024):
        monogram(font, s, a.overlap).save(os.path.join(out, "icon-%d.png" % s))
    monogram(font, 180, a.overlap).save(os.path.join(out, "apple-touch-icon.png"))
    monogram(font, 512, a.overlap, maskable=True).save(os.path.join(out, "icon-maskable-512.png"))
    monogram(font, 512, a.overlap, invert=True).save(os.path.join(out, "icon-dark-512.png"))
    with open(os.path.join(out, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(SVG)

    print("Wrote 6 icons + icon.svg to", out)


if __name__ == "__main__":
    main()
