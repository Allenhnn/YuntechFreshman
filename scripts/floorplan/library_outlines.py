"""
Library floor outlines from the 總務處 scanned floor plans (assets-src/floorplans/圖書館/*.jpg).

Usage:  python3 scripts/floorplan/library_outlines.py
Needs:  Pillow, numpy
Writes: assets-src/floorplans/圖書館/outlines.json

Plan frame: metres, origin at the top-left of the 1F 79.45 x 51.75 m dimension extents,
+X right, +Y down (as drawn). The registration parameters below were found by matching each
floor's wall lines against 1F (3F-7F) or the already-registered 7F (8F, 9F) with an FFT
cross-correlation over scale; the plan->world transform by fitting the 1F silhouette to the OSM
footprints of 圖書館 + 藝術中心 (IoU 0.685). The printed dimension labels on these drawings do not
match the drawn geometry exactly, so geometry (not labels) is the source of truth.
"""
import json
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DIR = os.path.join(ROOT, 'assets-src', 'floorplans', '圖書館')
RES = 0.5  # outline raster resolution (m)

# plan->world: world = R(angle) * (P - planCentroid) + worldCentroid   (no mirror)
TRANSFORM = {'angleDeg': 168.0, 'planCentroid': [43.73, 25.114], 'worldCentroid': [-0.111, -144.457]}

# floor -> (image, crop [x0,y0,x1,y1] px, scale px/m, tx, ty): plan X = (px-x0)/scale + tx
REGISTRATION = {
    '3F': ('3F_a4-05.jpg', (45, 270, 650, 800), 6.942, -3.0, -2.0),
    '4F': ('4F_a4-07.jpg', (130, 940, 2010, 2200), 21.661, -3.75, -1.75),
    '5F': ('5F_a4-09.jpg', (130, 740, 2010, 1990), 21.797, -3.25, -1.75),
    '6F': ('6F_a4-11.jpg', (130, 620, 2010, 1850), 24.61, -3.25, 4.75),
    '7F': ('7F_a4-13.jpg', (130, 960, 2010, 2230), 24.271, -4.0, 3.5),
    '8F': ('8-9F_a4-15.jpg', (290, 480, 1840, 1040), 20.441, -1.25, 3.0),
    '9F': ('8-9F_a4-15.jpg', (300, 1700, 1850, 2250), 21.661, 2.25, 4.5),
}


def building_mask(path, crop):
    """Everything not reachable from the crop border through white pixels = inside the building."""
    im = np.asarray(Image.open(os.path.join(DIR, path)).convert('L'))
    x0, y0, x1, y1 = crop
    white = im[y0:y1, x0:x1] > 200
    h, w = white.shape
    outside = np.zeros_like(white)
    stack = [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]
    while stack:
        y, x = stack.pop()
        if 0 <= y < h and 0 <= x < w and white[y, x] and not outside[y, x]:
            outside[y, x] = True
            stack.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    return ~outside


def to_plan_grid(mask, crop, scale, tx, ty):
    ys, xs = np.nonzero(mask)
    X = xs / scale + tx
    Y = ys / scale + ty
    gx0, gy0 = np.floor(X.min()) - 2, np.floor(Y.min()) - 2
    gw = int((X.max() - gx0) / RES) + 4
    gh = int((Y.max() - gy0) / RES) + 4
    g = np.zeros((gh, gw), bool)
    g[((Y - gy0) / RES).astype(int), ((X - gx0) / RES).astype(int)] = True
    return g, gx0, gy0


def largest_component_filled(g):
    h, w = g.shape
    label = np.zeros((h, w), int)
    best, best_n, n = 0, 0, 0
    for sy in range(h):
        for sx in range(w):
            if g[sy, sx] and not label[sy, sx]:
                n += 1
                stack, count = [(sy, sx)], 0
                label[sy, sx] = n
                while stack:
                    y, x = stack.pop()
                    count += 1
                    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= ny < h and 0 <= nx < w and g[ny, nx] and not label[ny, nx]:
                            label[ny, nx] = n
                            stack.append((ny, nx))
                if count > best_n:
                    best, best_n = n, count
    comp = label == best
    # fill holes: flood the background from the border, everything else is inside
    bg = np.zeros_like(comp)
    stack = [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]
    while stack:
        y, x = stack.pop()
        if 0 <= y < h and 0 <= x < w and not comp[y, x] and not bg[y, x]:
            bg[y, x] = True
            stack.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    return ~bg


def trace(cells, gx0, gy0):
    """Outer boundary of a filled cell mask as a polygon (plan metres), collinear points removed."""
    h, w = cells.shape
    inside = lambda y, x: 0 <= y < h and 0 <= x < w and cells[y, x]
    edges = {}
    for y in range(h):
        for x in range(w):
            if not cells[y, x]:
                continue
            # directed edges with the cell on the left (counter-clockwise in screen coords flipped)
            if not inside(y - 1, x): edges[(x + 1, y)] = (x, y)
            if not inside(y + 1, x): edges[(x, y + 1)] = (x + 1, y + 1)
            if not inside(y, x - 1): edges[(x, y)] = (x, y + 1)
            if not inside(y, x + 1): edges[(x + 1, y + 1)] = (x + 1, y)
    loops = []
    while edges:
        start, nxt = next(iter(edges.items()))
        loop = [start]
        del edges[start]
        cur = nxt
        while cur != start and cur in edges:
            loop.append(cur)
            cur = edges.pop(cur)
        loops.append(loop)
    loop = max(loops, key=len)
    pts = []
    n = len(loop)
    for i in range(n):
        a, b, c = loop[i - 1], loop[i], loop[(i + 1) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            pts.append([round(gx0 + b[0] * RES, 2), round(gy0 + b[1] * RES, 2)])
    return pts


def main():
    out = {'transform': TRANSFORM, 'resolution': RES, 'floors': {}}
    for floor, (img, crop, scale, tx, ty) in REGISTRATION.items():
        mask = building_mask(img, crop)
        g, gx0, gy0 = to_plan_grid(mask, crop, scale, tx, ty)
        poly = trace(largest_component_filled(g), gx0, gy0)
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        area = abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2
        print(f'{floor}: {len(poly)} vertices, X {min(xs):.1f}..{max(xs):.1f}, Y {min(ys):.1f}..{max(ys):.1f}, area {area:.0f} m2')
        out['floors'][floor] = poly
    with open(os.path.join(DIR, 'outlines.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False)


if __name__ == '__main__':
    main()
