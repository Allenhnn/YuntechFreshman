"""Widen narrow corridors in a hand-traced floor (shared by ma.py / mb.py).

The handbook plans draw some corridors at 2.3–2.5 m; on site they read as 3 m and more. For every
corridor / lobby rect narrower than MIN_W (and clearly a corridor: long and thin), its long edges
move outward into the rooms that line them; those room rects shrink and the doors on that wall
move with it. An edge that meets a stair, lift, void or the outside (any part of it) stays put and
the other side gives the whole difference.
"""

MIN_W = 3.0
EPS = 0.06


def _touching(spaces, me, line, axis, lo, hi, side):
    """Rects of other spaces whose facing edge lies on `line` and overlaps [lo, hi]; also whether
    any part of [lo, hi] faces nothing (outside)."""
    hits, covered = [], []
    for s in spaces:
        for r in s['rects']:
            if r is me:
                continue
            if axis == 'x':  # corridor runs along x; edges are horizontal lines y = line
                edge = r[3] if side < 0 else r[1]
                a, b = r[0], r[2]
            else:
                edge = r[2] if side < 0 else r[0]
                a, b = r[1], r[3]
            if b <= lo + EPS or a >= hi - EPS:
                continue
            # A rect straddling the line (e.g. a hall the corridor runs into) covers that stretch too.
            c0, c1 = (r[1], r[3]) if axis == 'x' else (r[0], r[2])
            straddles = c0 < line - EPS and c1 > line + EPS
            if abs(edge - line) > EPS and not straddles:
                continue
            if straddles:
                if s['kind'] not in ('corridor', 'lobby'):
                    hits.append((s, None))  # a room across the line: this side can't move
                covered.append((max(a, lo), min(b, hi)))
                continue
            hits.append((s, r))
            covered.append((max(a, lo), min(b, hi)))
    covered.sort()
    gap, x = False, lo
    for a, b in covered:
        if a > x + 0.3:
            gap = True
        x = max(x, b)
    if x < hi - 0.3:
        gap = True
    return hits, gap


def widen(spaces, openings, min_w=MIN_W):
    moved = 0
    for s in spaces:
        if s['kind'] not in ('corridor', 'lobby'):
            continue
        for r in s['rects']:
            w, h = r[2] - r[0], r[3] - r[1]
            axis = 'x' if w >= h else 'y'
            narrow, long_ = (h, w) if axis == 'x' else (w, h)
            if narrow >= min_w - 0.05 or long_ < 2 * narrow:
                continue
            lo, hi = (r[0], r[2]) if axis == 'x' else (r[1], r[3])
            sides = {}
            for side in (-1, 1):
                line = (r[1] if side < 0 else r[3]) if axis == 'x' else (r[0] if side < 0 else r[2])
                hits, gap = _touching(spaces, r, line, axis, lo, hi, side)
                locked = gap or any(o['kind'] in ('stair', 'elevator', 'void') for o, _ in hits)
                # Only rooms that lie wholly along this corridor can give way without opening a hole.
                for o, q in hits:
                    if q is None:
                        locked = True
                        continue
                    if o['kind'] in ('corridor', 'lobby'):
                        continue
                    a, b = (q[0], q[2]) if axis == 'x' else (q[1], q[3])
                    if a < lo - EPS or b > hi + EPS:
                        locked = True
                sides[side] = (line, hits, locked)
            free = [sd for sd in (-1, 1) if not sides[sd][2]]
            if not free:
                continue
            need = min_w - narrow
            for sd in free:
                e = need / len(free)
                line, hits, _ = sides[sd]
                new = round(line + sd * e, 2)
                for o, q in hits:
                    if q is None or o['kind'] in ('corridor', 'lobby'):
                        continue
                    if axis == 'x':
                        q[3 if sd < 0 else 1] = new
                    else:
                        q[2 if sd < 0 else 0] = new
                for op in openings:
                    (ax, ay), (bx, by) = op['a'], op['b']
                    if axis == 'x' and abs(ay - line) < EPS and abs(by - line) < EPS and min(ax, bx) >= lo - EPS and max(ax, bx) <= hi + EPS:
                        op['a'] = [ax, new]; op['b'] = [bx, new]
                    if axis == 'y' and abs(ax - line) < EPS and abs(bx - line) < EPS and min(ay, by) >= lo - EPS and max(ay, by) <= hi + EPS:
                        op['a'] = [new, ay]; op['b'] = [new, by]
                if axis == 'x':
                    r[1 if sd < 0 else 3] = new
                else:
                    r[0 if sd < 0 else 2] = new
            moved += 1
    return moved
