"""Hand-traced 雲泰表演廳 (Yun Tay Performance Hall) → assets-src/floorplans/雲泰表演廳/traced.source.json.

Usage: python3 scripts/floorplan/handbuilt/yuntay.py && npm run buildings:build

Traced by eye from 「5-1.1 舞台暨場地平面圖」(113.11.04, 1F + 2F; kept out of git under
assets-src/reference/yuntay/). The plan frame is the one of the older 總務處 trace (metres, page
pixels / 4.88), so the registration (transform) carries over: the new sheet was matched onto the old
scan by image correlation (1F: 0.02935 m per pixel at 4×, 2F shifted by (-168, +52) px).

The hall is curved, so spaces are written as shapes (rects, circles, an ellipse for the seating) and
rasterised to 0.5 m cells; each cell goes to the first space that claims it.

Also writes the building outline in world coordinates to src/campus/buildingRings.json: the OSM
footprint is a rough quadrilateral, the shell is redrawn from the plan so it holds the interior.

Simplifications: the raked seating is laid flat (no risers); the stage is a 0.9 m platform with steps.
"""
import json, math

ROOT = '/Users/allenhnn/Codes/YuntechFreshMan/'
SRC = ROOT + 'assets-src/floorplans/雲泰表演廳/traced.source.json'
RINGS = ROOT + 'src/campus/buildingRings.json'
OSM_ID = 234786942
FH = 3.6
CEIL = 3.3
C = 0.5
GX0, GY0, GX1, GY1 = 54.0, 61.0, 136.0, 145.0
NI, NJ = int((GX1 - GX0) / C), int((GY1 - GY0) / C)

# ---------------------------------------------------------------- shapes
INNER = (66.08, 131.11, 51.84)    # 1F: wall round the auditorium and its side rooms (fitted to the sheet)
OUTER = (35.54, 161.56, 106.9)    # the curved facade
GALLERY = (66.08, 131.11, 57.5)   # 2F: wall between the outer corridor and the rear gallery
STAGE_C, STAGE_R = (76.25, 120.5), 12.0   # stage drum (turntable mark ◎ at its centre)
SEAT_C = (77.5, 121.5)            # seat rows: quarter ellipses round this point
ZONE_A, ZONE_B = 31.8, 33.9       # seating zone = back row + aisle


def R(x0, y0, x1, y1):
    return lambda x, y: x0 < x < x1 and y0 < y < y1


def circ(c, inside=True):
    cx, cy, r = c
    return lambda x, y: ((x - cx) ** 2 + (y - cy) ** 2 < r * r) == inside


def any_(*ps):
    return lambda x, y: any(p(x, y) for p in ps)


def all_(*ps):
    return lambda x, y: all(p(x, y) for p in ps)


def seat_zone(x, y):
    cx, cy = SEAT_C
    if x < cx:
        return y > cy - ZONE_B
    return ((x - cx) / ZONE_A) ** 2 + ((y - cy) / ZONE_B) ** 2 < 1


def stage_shape(x, y):
    return R(66, 108.5, 88.5, 130.5)(x, y) and (
        circ((*STAGE_C, STAGE_R))(x, y) or (x < STAGE_C[0] and y > 111.5) or (y > STAGE_C[1] and x < 85.5))


hall = all_(lambda x, y: x > 70 and y < 126, circ(INNER), seat_zone)            # 1F auditorium
band = all_(lambda x, y: x > 70 and y < 126 and y > 80.5, circ(INNER), lambda x, y: not seat_zone(x, y))
ring111 = all_(lambda x, y: 76.5 < x < 133.5 and y < 120.5, circ(OUTER), circ(INNER, False))
rear2 = all_(lambda x, y: 76.5 < x < 133.5 and y < 120.5, circ(OUTER), lambda x, y: not hall(x, y))

# ---------------------------------------------------------------- rasteriser


def raster(defs):
    """defs: [(space dict, predicate)] in priority order → spaces with merged rects."""
    owner = [[-1] * NI for _ in range(NJ)]
    for k, (_, pred) in enumerate(defs):
        for j in range(NJ):
            y = GY0 + (j + 0.5) * C
            for i in range(NI):
                if owner[j][i] < 0 and pred(GX0 + (i + 0.5) * C, y):
                    owner[j][i] = k
    out = []
    for k, (s, _) in enumerate(defs):
        runs = {}  # (i0, i1) -> list of [j0, j1]
        rects = []
        for j in range(NJ):
            i = 0
            row = []
            while i < NI:
                if owner[j][i] == k:
                    i0 = i
                    while i < NI and owner[j][i] == k:
                        i += 1
                    row.append((i0, i))
                else:
                    i += 1
            for r in row:
                lst = runs.setdefault(r, [])
                if lst and lst[-1][1] == j:
                    lst[-1][1] = j + 1
                else:
                    lst.append([j, j + 1])
        for (i0, i1), lst in runs.items():
            for j0, j1 in lst:
                rects.append([GX0 + i0 * C, GY0 + j0 * C, GX0 + i1 * C, GY0 + j1 * C])
        if not rects:
            raise SystemExit(f'{s["id"]} got no cells')
        rects.sort(key=lambda r: (r[1], r[0]))
        out.append({**s, 'rects': rects})
    return out, owner


def sp(id, name, kind='room', **extra):
    return {'id': id, 'name': name, 'kind': kind, 'ceiling': CEIL, **extra}


def door_h(x, y, w=1.0, kind='door', label=None):
    o = {'kind': kind, 'a': [round(x - w / 2, 2), y], 'b': [round(x + w / 2, 2), y]}
    if label: o['label'] = label
    return o


def door_v(x, y, w=1.0, kind='door', label=None):
    o = {'kind': kind, 'a': [x, round(y - w / 2, 2)], 'b': [x, round(y + w / 2, 2)]}
    if label: o['label'] = label
    return o


def door_between(owner, ids, a, b, near, w=1.0, kind='door', label=None):
    """A door on the straight run of wall between spaces a and b closest to `near`."""
    ka, kb = ids[a], ids[b]
    edges = []  # (axis, line, lo) unit edges
    for j in range(NJ):
        for i in range(NI):
            o = owner[j][i]
            if o not in (ka, kb):
                continue
            other = kb if o == ka else ka
            if i + 1 < NI and owner[j][i + 1] == other:
                edges.append(('v', GX0 + (i + 1) * C, GY0 + j * C))
            if j + 1 < NJ and owner[j + 1][i] == other:
                edges.append(('h', GY0 + (j + 1) * C, GX0 + i * C))
    runs = []
    for axis in 'hv':
        es = sorted({(l, lo) for ax, l, lo in edges if ax == axis})
        for l, lo in es:
            if runs and runs[-1][0] == axis and runs[-1][1] == l and abs(runs[-1][3] - lo) < 1e-6:
                runs[-1][3] = lo + C
            else:
                runs.append([axis, l, lo, lo + C])
    best = None
    for axis, l, lo, hi in runs:
        if hi - lo < w + 0.2:
            continue
        px, py = near
        along = px if axis == 'h' else py
        t = min(max(along, lo + w / 2 + 0.1), hi - w / 2 - 0.1)
        pt = (t, l) if axis == 'h' else (l, t)
        d = math.hypot(pt[0] - px, pt[1] - py)
        if best is None or d < best[0]:
            best = (d, axis, l, t)
    if best is None:
        raise SystemExit(f'no wall between {a} and {b} for a {w} m door')
    _, axis, l, t = best
    return door_h(t, l, w, kind, label) if axis == 'h' else door_v(l, t, w, kind, label)


# ---------------------------------------------------------------- stair cores (U-shaped, same rect on both floors)
LEVELS = ['1F', '2F']
CORES = {  # x0, landing edge y (opens onto each floor), direction into the core, width, length, flight width
    'N': (68.5, 73.0, -1, 8.0, 6.0, 2.2),
    'A': (104.5, 131.0, 1, 5.0, 9.0, 2.3),
}
LANDING = 1.3
stairs, landings = [], []
for k, (x0, near, sgn, W, L, FW) in CORES.items():
    far = near + sgn * L
    span = lambda a, b: (min(a, b), max(a, b))
    for i in range(len(LEVELS)):
        low = i * FH
        f0, f1 = span(near, near + sgn * LANDING)
        landings.append({'rect': [x0, f0, x0 + W, f1], 'elevation': low})
        if i == len(LEVELS) - 1:
            break
        r0, r1 = span(near + sgn * LANDING, far - sgn * LANDING)
        m0, m1 = span(far - sgn * LANDING, far)
        away, back = ('+', '-') if sgn > 0 else ('-', '+')
        stairs.append({'id': f'yt-{k}{i}a', 'name': '樓梯', 'rect': [x0, r0, x0 + FW, r1], 'axis': 'y', 'up': away, 'low': low, 'high': low + FH / 2})
        landings.append({'rect': [x0, m0, x0 + W, m1], 'elevation': low + FH / 2})
        stairs.append({'id': f'yt-{k}{i}b', 'name': '樓梯', 'rect': [x0 + W - FW, r0, x0 + W, r1], 'axis': 'y', 'up': back, 'low': low + FH / 2, 'high': low + FH})
# Straight flight in the west corridor, rising south to the 2F corridor by 206.
stairs.append({'id': 'yt-W', 'name': '樓梯', 'rect': [68.5, 85.5, 70.0, 94.0], 'axis': 'y', 'up': '+', 'low': 0, 'high': FH})


def core_rect(k):
    x0, near, sgn, W, L, _ = CORES[k]
    return R(x0, min(near, near + sgn * L), x0 + W, max(near, near + sgn * L))


def core_open(k, x0=None, x1=None):
    cx0, near, _, W, _, _ = CORES[k]
    return {'kind': 'open', 'a': [x0 if x0 is not None else cx0 + 0.3, near], 'b': [x1 if x1 is not None else cx0 + W - 0.3, near]}


# ---------------------------------------------------------------- 1F
f1_defs = [
    (sp('1F-110', '檔案室', code='YT110'), R(56.5, 65.5, 66, 73)),
    (sp('1F-stair-N', '樓梯', 'stair', noCeiling=True), core_rect('N')),
    (sp('1F-B-vest', 'B門 風除室', 'lobby'), R(55.5, 75, 60, 81.5)),
    (sp('1F-B', 'B門廳', 'lobby'), any_(R(60, 73, 70, 83.5), R(66, 67, 68.5, 73), R(70, 73, 76.5, 80.5), R(56.5, 81.5, 60, 83.5))),
    (sp('1F-109', 'EZ Plus', code='YT109', furnish='discussion'), R(57, 83.5, 66, 111.5)),
    (sp('1F-stair-W', '樓梯', 'stair', noCeiling=True), R(68.5, 85.5, 70, 94)),
    (sp('1F-west', '西側走廊', 'corridor'), any_(R(66, 83.5, 70, 108.5), R(66, 108.5, 68.5, 111.5))),
    (sp('1F-B0', 'B0 入口', 'corridor'), R(70, 105, 73, 108.5)),
    (sp('1F-lift-W', '舞台升降機', 'room'), R(68.5, 108.5, 73, 111.5)),
    (sp('1F-108', '鋼琴室', code='YT108'), R(60.5, 111.5, 66, 115.5)),
    (sp('1F-107', '演員準備室', code='YT107', furnish='office'), R(60.5, 115.5, 66, 118.5)),
    (sp('1F-106', '器材室', code='YT106'), R(60.5, 118.5, 66, 120.5)),
    (sp('1F-stair-BF', '樓梯間（往地下室）'), R(60.5, 120.5, 63.5, 126)),
    (sp('1F-BF', '維修孔', code='YTBF'), R(60.5, 126, 63.5, 129.5)),
    (sp('1F-back', '後台走道', 'corridor'), any_(R(63.5, 120.5, 66, 129.5), R(65.5, 129.5, 66, 130.5))),
    (sp('1F-105', '演員準備室', code='YT105', furnish='office'), R(60.5, 129.5, 65.5, 136.5)),
    (sp('1F-104', '演員準備室', code='YT104', furnish='office'), R(65.5, 130.5, 70, 136.5)),
    (sp('1F-dock', '後台卸貨口', 'lobby'), R(70, 130.5, 75.5, 136.5)),
    (sp('1F-stair-S', '後台樓梯', 'corridor'), R(75.5, 130.5, 77.5, 136.5)),
    (sp('1F-103', '管理室', code='YT103', furnish='office'), R(77.5, 130.5, 81, 136.5)),
    (sp('1F-102', '貴賓室', code='YT102', furnish='discussion'), R(81, 130.5, 85, 140)),
    (sp('1F-lift-E', '升降機', 'room'), R(85.5, 124, 88, 126)),
    (sp('1F-backE', '後台通道', 'corridor'), R(85.5, 126, 88, 130.5)),
    (sp('1F-plant', '設備間'), any_(R(85, 130.5, 89.5, 140), R(89.5, 134.5, 92, 140))),
    (sp('1F-elev', '電梯', 'elevator'), R(89.5, 131, 92, 134.5)),
    (sp('1F-101', '貴賓室', code='YT101', furnish='discussion'), R(92, 131, 104.5, 140)),
    (sp('1F-stair-A', '樓梯', 'stair', noCeiling=True), core_rect('A')),
    (sp('1F-south', '南側走廊', 'corridor'), R(88, 126, 109.5, 131)),
    (sp('1F-119', '哺集乳室', code='YT119'), R(127, 120.5, 130, 122.5)),
    (sp('1F-120', '無障礙廁所', 'toilet', code='YT120'), R(127, 123.5, 131, 126)),
    (sp('1F-A', 'A門廳', 'lobby'), any_(R(109.5, 126, 131, 140), R(117.5, 120.5, 129.5, 126), R(129.5, 122.5, 131, 123.5))),
    (sp('1F-A-vest', 'A門 風除室', 'lobby'), R(111.5, 140, 121.5, 143.5)),
    (sp('1F-stage', '舞台', noCeiling=True, group='theatre'), stage_shape),
    (sp('1F-112', '男廁', 'toilet', code='YT112', furnish='restroom'), all_(band, R(76, 82, 80, 87.5))),
    (sp('1F-113', '女廁', 'toilet', code='YT113', furnish='restroom'), all_(band, R(80.5, 81.5, 85, 88.5))),
    (sp('1F-114', '空調機房', code='YT114'), all_(band, R(86.5, 82, 93, 92))),
    (sp('1F-115', '檔案室', code='YT115'), all_(band, R(99, 91, 102.5, 99))),
    (sp('1F-116', '空調機房', code='YT116'), all_(band, R(103.5, 100.5, 111, 109))),
    (sp('1F-117', '女廁', 'toilet', code='YT117', furnish='restroom'), all_(band, R(108, 110.5, 114, 116))),
    (sp('1F-118', '男廁', 'toilet', code='YT118', furnish='restroom'), all_(band, R(109, 117, 114.5, 121))),
    (sp('1F-side', '觀眾席側廊', 'corridor'), band),
    (sp('1F-hall', '觀眾席', noCeiling=True, group='theatre'), hall),
    (sp('1F-111', '內迴廊', 'corridor', code='YT111'), ring111),
]
f1_spaces, f1_owner = raster(f1_defs)
f1_ids = {s['id']: k for k, s in enumerate(f1_spaces)}
db1 = lambda a, b, near, w=1.0, kind='door', label=None: door_between(f1_owner, f1_ids, a, b, near, w, kind, label)

f1_open = [
    door_v(66, 71), core_open('N', 68.8, 76.2),
    {'kind': 'open', 'a': [60, 75.5], 'b': [60, 81]},
    door_v(55.5, 78, 2.4, 'exit', 'B門'), door_v(56.5, 82.5, 1.2, 'exit', 'D'),
    door_h(62.5, 83.5), door_v(66, 97), door_v(57, 86.5, 1.2, 'exit'), door_v(57, 109.5, 1.2, 'exit'),
    {'kind': 'open', 'a': [68.7, 85.5], 'b': [69.8, 85.5]},
    door_v(70, 95.5, 1.6, label='B2'), door_v(70, 100.5, 1.6, label='B1'),
    door_v(70, 107, 1.2), door_v(73, 107, 1.6, label='B0'),
    db1('1F-side', '1F-hall', (75.5, 88), 1.6, label='B3'),
    door_h(67.2, 111.5),
    door_v(66, 113.5), door_v(66, 117), door_v(66, 119.5), door_v(66, 123, 1.6, 'open'),
    door_v(63.5, 123), door_v(63.5, 127.5), door_h(64.5, 129.5),
    door_h(68, 130.5), door_h(72.75, 130.5, 3.0), door_h(72.75, 136.5, 3.0, 'exit', '後台卸貨口'),
    door_h(76.5, 130.5), door_h(76.5, 136.5, 1.2, 'exit'), door_h(79.25, 130.5), door_h(83, 130.5),
    door_v(85.5, 128.25, 1.2), door_v(88, 128.25, 1.2), door_h(88.75, 130.5),
    {'kind': 'elevator', 'a': [89.8, 131.0], 'b': [91.7, 131.0], 'label': '電梯'},
    door_h(103, 131), core_open('A'),
    door_h(89.75, 126, 1.6, label='A0'), door_h(96.5, 126, 1.6, label='A1'), door_h(102, 126, 1.6, label='A2'), door_h(107, 126, 1.6, label='A3'),
    db1('1F-side', '1F-A', (113.5, 126), 2.5, 'open'),
    door_v(127, 121.5), door_v(127, 124.75),
    door_h(116.5, 140, 4.0, 'open'), door_h(116.5, 143.5, 4.0, 'exit', 'A門'),
    db1('1F-111', '1F-B', (76.5, 77), 1.6),
    db1('1F-111', '1F-A', (122, 120.5), 3.0, 'open'),
    db1('1F-111', '1F-side', (95.5, 88.5), 1.6), db1('1F-111', '1F-side', (108, 101), 1.6),
    db1('1F-side', '1F-B', (73, 80.5), 3.0, 'open'),
]
for room, near in [('1F-112', (78, 88)), ('1F-113', (82.5, 88.5)), ('1F-114', (90, 92)), ('1F-115', (100, 99)),
                   ('1F-116', (106, 109)), ('1F-117', (110, 116)), ('1F-118', (111, 121))]:
    f1_open.append(db1(room, '1F-side', near))

# ---------------------------------------------------------------- 2F
f2_defs = [
    (sp('2F-stair-N', '樓梯', 'stair'), core_rect('N')),
    (sp('2F-hall', '二樓大廳', 'lobby'), R(59, 73, 70, 83.5)),
    (sp('2F-207', '會議室', code='YT207', furnish='discussion'), R(70.5, 74, 74.5, 79)),
    (sp('2F-north', '二樓北廊', 'corridor'), R(70, 73, 76.5, 80.5)),
    (sp('2F-206', '排練室', code='YT206'), R(57, 83.5, 65.5, 111.5)),
    (sp('2F-stair-W', '樓梯', 'stair'), R(68.5, 85.5, 70, 94)),
    (sp('2F-west', '二樓西廊', 'corridor'), any_(R(65.5, 83.5, 68.5, 100.5), R(68.5, 83.5, 70, 85.5), R(68.5, 94, 70, 100.5))),
    (sp('2F-store', '儲藏室'), any_(R(65.5, 100.5, 68.5, 108.5), R(68.5, 105, 70, 108.5))),
    (sp('2F-205', '音響機房', code='YT205'), R(68.5, 100.5, 74.5, 105)),
    (sp('2F-204', '左燈光包廂', code='YT204'), R(70, 105, 74.5, 108.5)),
    (sp('2F-lift-W', '機房'), R(65.5, 108.5, 73, 111.5)),
    (sp('2F-side', '二樓側廊', 'corridor'), R(70, 80.5, 74.5, 100.5)),
    (sp('2F-lift-E', '升降機'), R(85.5, 124, 88, 128.5)),
    (sp('2F-203', '右燈光包廂', code='YT203'), R(88, 122.5, 92.5, 125.5)),
    (sp('2F-202', '燈光機房', code='YT202'), R(88, 125.5, 92.5, 128.5)),
    (sp('2F-access', '無障礙通道', 'corridor'), R(92.5, 122.5, 110, 126.5)),
    (sp('2F-south', '二樓南廊', 'corridor'), any_(R(85.5, 128.5, 109.5, 131), R(92.5, 126.5, 109.5, 128.5), R(109.5, 126.5, 124, 131))),
    (sp('2F-backS', '二樓後台走道', 'corridor'), R(65.5, 131, 81, 136.5)),
    (sp('2F-201a', '經管組檔案室', code='YT201a'), R(81, 131, 86, 140)),
    (sp('2F-lobbyS', '電梯廳', 'corridor'), R(86, 131, 89.5, 140)),
    (sp('2F-elev', '電梯', 'elevator'), R(89.5, 131, 92, 134.5)),
    (sp('2F-201', '經管組辦公室', code='YT201', furnish='office'), R(92, 131, 104.5, 140)),
    (sp('2F-stair-A', '樓梯', 'stair'), core_rect('A')),
    (sp('2F-stage', '舞台上空', 'void', group='theatre'), stage_shape),
    (sp('2F-hallvoid', '觀眾席上空', 'void', group='theatre'), hall),
    (sp('2F-east', '二樓東廊', 'corridor'), R(117.5, 120.5, 124, 126.5)),
    (sp('2F-208', '劇團辦公室', code='YT208', furnish='office'), all_(rear2, R(84.5, 71, 92, 81))),
    (sp('2F-209', '控制室', code='YT209', furnish='office'), all_(rear2, R(98.5, 87, 106, 96))),
    (sp('2F-210', '檔案室', code='YT210'), all_(rear2, circ(GALLERY, False), R(119.5, 103, 123.5, 107.5))),
    (sp('2F-211', '檔案室', code='YT211'), all_(rear2, circ(GALLERY, False), R(123, 114.5, 127, 119))),
    (sp('2F-rear', '二樓後排走道', 'corridor'), all_(rear2, circ(GALLERY))),
    (sp('2F-outer', '二樓外廊', 'corridor'), rear2),
]
f2_spaces, f2_owner = raster(f2_defs)
f2_ids = {s['id']: k for k, s in enumerate(f2_spaces)}
db2 = lambda a, b, near, w=1.0, kind='door', label=None: door_between(f2_owner, f2_ids, a, b, near, w, kind, label)

f2_open = [
    core_open('N', 70.3, 76.2), door_v(70, 77, 3.0, 'open'), door_v(74.5, 76.5),
    door_h(62, 83.5), door_h(67, 83.5, 2.5, 'open'), door_v(65.5, 97),
    {'kind': 'open', 'a': [68.7, 94.0], 'b': [69.8, 94.0]},
    door_v(70, 97, 1.2), door_h(72.25, 80.5, 3.5, 'open'), door_h(71.5, 100.5), door_h(72.25, 105), door_h(67, 100.5),
    db2('2F-north', '2F-rear', (76.5, 78), 1.6, 'open'),
    db2('2F-outer', '2F-rear', (79, 76.5), 1.6, label='D1'), db2('2F-outer', '2F-rear', (90, 79), 1.6, label='D2'),
    db2('2F-outer', '2F-rear', (116.5, 108), 1.6, label='C2'), db2('2F-outer', '2F-rear', (119, 114.5), 1.6, label='C1'),
    db2('2F-208', '2F-rear', (88, 81)), db2('2F-209', '2F-rear', (100, 96)),
    db2('2F-210', '2F-outer', (121, 104)), db2('2F-211', '2F-outer', (124, 115)),
    db2('2F-east', '2F-rear', (120, 120.5), 2.0, 'open'), db2('2F-east', '2F-outer', (123.5, 120.5), 1.0, 'open'),
    door_h(120.75, 126.5, 3.0, 'open'),
    door_h(100, 126.5, 6.0, 'open'), door_v(92.5, 124), door_h(90.25, 125.5),
    door_h(87.75, 131, 1.5, 'open'), {'kind': 'elevator', 'a': [89.8, 131.0], 'b': [91.7, 131.0], 'label': '電梯'},
    door_h(95, 131), core_open('A'), door_v(86, 133.5), door_v(81, 133.5),
]

# ---------------------------------------------------------------- seats and stage (1F extras)
items, colliders = [], []


def in_space(owner, ids, sid, x, y):
    i, j = int((x - GX0) / C), int((y - GY0) / C)
    return 0 <= i < NI and 0 <= j < NJ and owner[j][i] == ids[sid]


def yaw_toward(fx, fy):
    return math.atan2(-fx, -fy)


cx, cy = SEAT_C
rows = [(14.3 + 1.03 * k, 16.8 + 1.025 * k, True) for k in range(13)] + [(28.9, 31.1, False), (29.9, 32.1, False), (30.9, 33.0, False)]
AISLES = [(19.5, 23.5), (51.5, 55.5)]  # degrees from the top of the ellipse
PITCH = 0.56
seats = 0
for a, b, ext in rows:
    # Polyline: straight run from x = 75.2 (front block) to the ellipse top, then the quarter ellipse.
    pts = [(75.2, cy - b)] if ext else []
    for n in range(0, 401):
        t = math.pi / 2 * n / 400
        pts.append((cx + a * math.sin(t), cy - b * math.cos(t)))
    s = 0.3
    acc = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        while acc + seg >= s:
            f = (s - acc) / seg
            x, y = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
            s += PITCH
            phi = math.degrees(math.atan2(x - cx, cy - y))
            if any(lo <= phi <= hi for lo, hi in AISLES) or y > cy - 0.3:
                continue
            if not in_space(f1_owner, f1_ids, '1F-hall', x, y):
                continue
            ry = yaw_toward(STAGE_C[0] - x, STAGE_C[1] - y)
            items.append({'kind': 'chair', 'x': round(x, 3), 'y': 0, 'z': round(y, 3), 'ry': round(ry, 4), 'sx': 1.05, 'sy': 1.0, 'sz': 1.05, 'tint': 0.3})
            seats += 1
        acc += seg

# Stage platform (0.9 m), on a 0.25 m raster so the drum's front edge reads as a curve.
SH = 0.9
G = 0.25


def platform(x, y):
    if not stage_shape(x, y) or not in_space(f1_owner, f1_ids, '1F-stage', x, y):
        return False
    if x < 67.5 or y > 129.0 or (y < 113.0 and x < 74):
        return False
    return x < 84 or (circ((*STAGE_C, STAGE_R))(x, y) and y < 122.5)


def merge_cells(pred, x0, y0, x1, y1, g):
    ni, nj = int((x1 - x0) / g), int((y1 - y0) / g)
    on = [[pred(x0 + (i + 0.5) * g, y0 + (j + 0.5) * g) for i in range(ni)] for j in range(nj)]
    used = [[False] * ni for _ in range(nj)]
    out = []
    for j in range(nj):
        for i in range(ni):
            if not on[j][i] or used[j][i]:
                continue
            i1 = i
            while i1 < ni and on[j][i1] and not used[j][i1]:
                i1 += 1
            j1 = j + 1
            while j1 < nj and all(on[j1][q] and not used[j1][q] for q in range(i, i1)):
                j1 += 1
            for jj in range(j, j1):
                for q in range(i, i1):
                    used[jj][q] = True
            out.append((x0 + i * g, y0 + j * g, x0 + i1 * g, y0 + j1 * g))
    return out


def block(r, h):
    ax0, ay0, ax1, ay1 = r
    items.append({'kind': 'stage', 'x': (ax0 + ax1) / 2, 'y': 0, 'z': (ay0 + ay1) / 2, 'ry': 0, 'sx': ax1 - ax0, 'sy': h, 'sz': ay1 - ay0, 'tint': 0})
    colliders.append({'c': [(ax0 + ax1) / 2, h / 2, (ay0 + ay1) / 2], 'h': [(ax1 - ax0) / 2, h / 2, (ay1 - ay0) / 2]})


plat = merge_cells(platform, 66, 108.5, 88.5, 130.5, G)
for r in plat:
    block(r, SH)
# Steps up onto the stage: from the west wings (by 106 / 107), the loading-dock side and the east passage.
for n, h in enumerate([0.225, 0.45, 0.675]):
    block((66 + 0.5 * n, 118.5, 66.5 + 0.5 * n, 121.5), h)
    block((71, 130 - 0.5 * n, 74.5, 130.5 - 0.5 * n), h)
    block((85 - 0.5 * n, 126, 85.5 - 0.5 * n, 128.5), h)
print(f'{seats} seats, {len(plat)} stage blocks')

# ---------------------------------------------------------------- outline → shell ring
arc = []
x0a, x1a = 76.5, 133.5
for n in range(0, 49):
    x = x0a + (x1a - x0a) * n / 48
    arc.append((x, OUTER[1] - math.sqrt(OUTER[2] ** 2 - (x - OUTER[0]) ** 2)))
outline = ([(56.5, 65.5), (66, 65.5), (66, 67), (68.5, 67), (68.5, 66.5), (76.5, 66.5)] + arc +
           [(133.5, 120.5), (131, 120.5), (131, 140), (121.5, 140), (121.5, 143.5), (111.5, 143.5), (111.5, 140),
            (81, 140), (81, 136.5), (60.5, 136.5), (60.5, 111.5), (57, 111.5), (57, 83.5), (56.5, 83.5), (56.5, 81.5),
            (55.5, 81.5), (55.5, 75), (56.5, 75)])

old = json.load(open(SRC))
T = old['transform']
ang = math.radians(T['angleDeg'])
ca, sa = math.cos(ang), math.sin(ang)


def to_world(x, y):
    qx, qy = x - T['planCentroid'][0], y - T['planCentroid'][1]
    return (qx * ca - qy * sa + T['worldCentroid'][0], qx * sa + qy * ca + T['worldCentroid'][1])


campus = json.load(open(ROOT + 'public/data/campus.json'))
osm = next(b for b in campus['buildings'] if b['id'] == OSM_ID)['outer']


def signed(r):
    n = len(r) // 2
    return sum(r[2 * i] * r[2 * ((i + 1) % n) + 1] - r[2 * ((i + 1) % n)] * r[2 * i + 1] for i in range(n))


ring = [round(v, 3) for p in outline for v in to_world(*p)]
if (signed(ring) > 0) != (signed(osm) > 0):
    pts = [(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)][::-1]
    ring = [v for p in pts for v in p]
try:
    rings = json.load(open(RINGS))
except FileNotFoundError:
    rings = {}
rings[str(OSM_ID)] = ring
json.dump(rings, open(RINGS, 'w'))

# ---------------------------------------------------------------- write
floors = {
    '1F': {'bandTop': FH, 'spaces': f1_spaces, 'openings': f1_open, 'signs': [],
           'elevator': {'landing': [90.75, 129.7], 'facing': [0, 1]}, 'extras': {'items': items, 'colliders': colliders}},
    '2F': {'bandTop': FH, 'spaces': f2_spaces, 'openings': f2_open, 'signs': [],
           'elevator': {'landing': [90.75, 129.7], 'facing': [0, 1]}},
}
source = {
    'id': 'plan-234786942',
    'name': '雲泰表演廳',
    'sources': '雲泰表演廳「5-1.1 舞台暨場地平面圖」(113.11.04) 1F、2F，手工重描（scripts/floorplan/handbuilt/yuntay.py）；座標單位 m，沿用舊描圖的平面座標與定位',
    'osmReplaces': [],
    'osmIds': [OSM_ID],
    'transform': T,
    'floorHeight': FH,
    'levels': [{'id': l, 'elevation': i * FH, 'built': True, 'elevator': True} for i, l in enumerate(LEVELS)],
    'shell': {},
    'floors': floors,
    'directory': [{'level': '1F', 'items': ['觀眾席', '舞台', 'A門廳 / B門廳']}, {'level': '2F', 'items': ['控制室', '排練室', '經管組辦公室']}],
    'stairs': stairs,
    'landings': landings,
}
json.dump(source, open(SRC, 'w'), ensure_ascii=False)
open(SRC, 'a').write('\n')
print('wrote', SRC, {k: (len(v['spaces']), len(v['openings'])) for k, v in floors.items()})
