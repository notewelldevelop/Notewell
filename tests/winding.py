#!/usr/bin/env python3
"""
NoteWell — prove the ink outline has no holes.

Canvas fills with the nonzero winding rule: a point is inside if the subpaths
around it wind a non-zero number of times. If two overlapping subpaths wind in
*opposite* directions they cancel, and the overlap punches a hole in the
stroke. That is what put crescent-shaped bites in the letters.

This mirrors engine.js fillVariableStroke exactly — the same quads, the same
discs, the same directions — and computes the real winding number at a dense
grid of points, on stroke shapes chosen to be hostile: hairpin turns, sudden
width changes, near-duplicate samples.

    python3 tests/winding.py
"""
import math
import sys

TAU = math.pi * 2


def width_at(p, base):
    press = 0.35 + 0.85 * p.get("p", 0.5)
    tilt = p.get("t", 1.0)
    return max(0.4, base * press * tilt)


def build_subpaths(pts, base):
    """The same geometry engine.js emits, as explicit polygons."""
    subs = []
    n = len(pts)
    rad = lambda i: width_at(pts[i], base) / 2

    for i in range(n - 1):
        a, b = pts[i], pts[i + 1]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        ln = math.hypot(dx, dy)
        if ln < 1e-6:
            continue
        nx, ny = -dy / ln, dx / ln
        ra, rb = rad(i), rad(i + 1)
        subs.append([
            (a["x"] + nx * ra, a["y"] + ny * ra),
            (b["x"] + nx * rb, b["y"] + ny * rb),
            (b["x"] - nx * rb, b["y"] - ny * rb),
            (a["x"] - nx * ra, a["y"] - ny * ra),
        ])

    # discs, traversed anticlockwise=true  ->  decreasing angle
    SEG = 64
    for i in range(n):
        r = rad(i)
        cx, cy = pts[i]["x"], pts[i]["y"]
        subs.append([(cx + r * math.cos(-t * TAU / SEG),
                      cy + r * math.sin(-t * TAU / SEG)) for t in range(SEG)])
    return subs


def winding(subs, x, y):
    """Standard nonzero winding number of a point against every subpath."""
    w = 0
    for poly in subs:
        m = len(poly)
        for k in range(m):
            x1, y1 = poly[k]
            x2, y2 = poly[(k + 1) % m]
            if y1 <= y:
                if y2 > y and (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0:
                    w += 1
            else:
                if y2 <= y and (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0:
                    w -= 1
    return w


def inside_ribbon(pts, base, x, y):
    """Ground truth: is this point within half a width of the centreline?"""
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - a["x"]) * dx + (y - a["y"]) * dy) / L2))
        px, py = a["x"] + t * dx, a["y"] + t * dy
        r = (width_at(a, base) * (1 - t) + width_at(b, base) * t) / 2
        if math.hypot(x - px, y - py) <= r * 0.75:      # comfortably interior
            return True
    return False


def check(name, pts, base, step=1.0):
    subs = build_subpaths(pts, base)
    xs = [p["x"] for p in pts]
    ys = [p["y"] for p in pts]
    pad = base * 2
    holes = 0
    tested = 0
    x = min(xs) - pad
    while x <= max(xs) + pad:
        y = min(ys) - pad
        while y <= max(ys) + pad:
            if inside_ribbon(pts, base, x, y):
                tested += 1
                if winding(subs, x, y) == 0:
                    holes += 1
            y += step
        x += step
    ok = holes == 0
    print("  %-34s %5d interior points, %d holes  %s"
          % (name, tested, holes, "ok" if ok else "FAIL"))
    return ok


def main():
    cases = []

    # a hairpin — the case that broke the old outline
    hairpin = []
    for i in range(26):
        t = i / 25
        ang = math.pi * t
        hairpin.append({"x": 40 + 18 * math.cos(ang + math.pi), "y": 40 + 18 * math.sin(ang), "p": 0.9})
    cases.append(("hairpin turn", hairpin, 14.0))

    # a tight loop, like the bowl of an 'o' written small
    loop = [{"x": 40 + 12 * math.cos(i / 30 * TAU), "y": 40 + 12 * math.sin(i / 30 * TAU), "p": 0.8}
            for i in range(31)]
    cases.append(("small closed loop", loop, 12.0))

    # abrupt width change, as when pressure spikes
    spike = [{"x": 10 + i * 4, "y": 40, "p": 0.1 if i % 2 else 1.0} for i in range(20)]
    cases.append(("alternating pressure", spike, 12.0))

    # near-duplicate samples, as when the pen pauses
    dup = [{"x": 20 + (i // 3) * 5, "y": 40, "p": 0.7} for i in range(24)]
    cases.append(("repeated samples", dup, 10.0))

    # a sharp corner, like the apex of an 'A'
    corner = ([{"x": 15 + i * 3, "y": 60 - i * 3, "p": 0.8} for i in range(12)] +
              [{"x": 51 + i * 3, "y": 27 + i * 3, "p": 0.8} for i in range(1, 12)])
    cases.append(("sharp corner", corner, 13.0))

    # ordinary handwriting-ish wiggle
    wig = [{"x": 10 + i * 2.5, "y": 40 + 12 * math.sin(i / 4), "p": 0.4 + 0.5 * abs(math.sin(i / 6))}
           for i in range(40)]
    cases.append(("handwriting wiggle", wig, 9.0))

    print("\n  nonzero-winding check (a hole = the fill rule cancelling)\n")
    ok = all(check(n, p, b) for n, p, b in cases)
    print()
    if not ok:
        print("  Holes found — subpath directions disagree.\n")
        sys.exit(1)
    print("  No holes anywhere. Discs and quads wind the same way.\n")


if __name__ == "__main__":
    main()
