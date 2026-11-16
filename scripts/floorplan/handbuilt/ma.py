"""Hand-traced 管理一館 (MA) → assets-src/floorplans/管理一館/ma.source.json.

Usage: python3 scripts/floorplan/handbuilt/ma.py && npm run buildings:build

Traced by eye from the 總務處 handbook pages D1-1/3/5. Plan frame: metres, origin at the corner of
the building's bounding box where the classroom wing meets the 106 block, +X along the classroom
wing, +Y across the courtyards. The page's printed dimensions run ~11 % short of the mapped
outline, so lengths are scaled to the OSM footprint (1F page: 5.63 px/m from pixel (161.7, 405)).
"""
import json, math

ROOT = '/Users/allenhnn/Codes/YuntechFreshMan/'
FH = 3.6
CEIL = 3.3

def room(code, name, rects, furnish=None, kind='room', **extra):
    s = {'id': f'MA{code}' if code else name, 'name': name, 'kind': kind, 'ceiling': CEIL, 'rects': [list(map(float, r)) for r in rects]}
    if code: s['code'] = f'MA{code}'
    if furnish: s['furnish'] = furnish
    s.update(extra)
    return s

def circ(id, name, rects, kind='corridor'):
    return {'id': id, 'name': name, 'kind': kind, 'ceiling': CEIL, 'group': 'circ', 'rects': [list(map(float, r)) for r in rects]}

def door_h(x, y, w=1.0, kind='door', label=None):
    o = {'kind': kind, 'a': [x - w / 2, y], 'b': [x + w / 2, y]}
    if label: o['label'] = label
    return o

def door_v(x, y, w=1.0, kind='door', label=None):
    o = {'kind': kind, 'a': [x, y - w / 2], 'b': [x, y + w / 2]}
    if label: o['label'] = label
    return o

def arcade_h(x0, x1, y, bay=4.5, pier=0.6):
    """Open bays along a horizontal outside edge, leaving piers between them."""
    out, x = [], x0 + pier / 2
    while x < x1 - pier / 2 - 0.5:
        e = min(x + bay - pier, x1 - pier / 2)
        out.append({'kind': 'open', 'a': [round(x, 2), y], 'b': [round(e, 2), y]})
        x = e + pier
    return out

def arcade_v(x, y0, y1, bay=4.5, pier=0.6):
    out, y = [], y0 + pier / 2
    while y < y1 - pier / 2 - 0.5:
        e = min(y + bay - pier, y1 - pier / 2)
        out.append({'kind': 'open', 'a': [x, round(y, 2)], 'b': [x, round(e, 2)]})
        y = e + pier
    return out

# ---------------------------------------------------------------- stair cores (same place on every floor)
# x0, landing end (y of the edge that opens onto each floor), direction into the core (+1 / −1 along y).
CORES = {'A': (15, 14.5, 1), 'B': (30, 53, -1), 'C': (67.5, 6.5, 1)}
CORE_W, CORE_L, FLIGHT_W, LANDING = 4.5, 5.5, 2.1, 1.3
LEVELS = ['1F', '2F', '3F']

def core_rect(k):
    x0, y, sgn = CORES[k]
    return [x0, min(y, y + sgn * CORE_L), x0 + CORE_W, max(y, y + sgn * CORE_L)]

def core_space(k, top):
    s = {'id': f'stair-{k}', 'name': '樓梯', 'kind': 'stair', 'ceiling': CEIL, 'rects': [core_rect(k)]}
    if not top: s['noCeiling'] = True
    return s

def core_open(k):
    x0, y, _ = CORES[k]
    return {'kind': 'open', 'a': [x0 + 0.3, y], 'b': [x0 + CORE_W - 0.3, y]}

stairs, landings = [], []
for k, (x0, near, sgn) in CORES.items():
    far = near + sgn * CORE_L
    span = lambda a, b: (min(a, b), max(a, b))
    for i in range(len(LEVELS)):
        low = i * FH
        f0, f1 = span(near, near + sgn * LANDING)
        landings.append({'rect': [x0, f0, x0 + CORE_W, f1], 'elevation': low})
        if i == len(LEVELS) - 1: break
        r0, r1 = span(near + sgn * LANDING, far - sgn * LANDING)
        m0, m1 = span(far - sgn * LANDING, far)
        away, back = ('+', '-') if sgn > 0 else ('-', '+')
        stairs.append({'id': f'ma-{k}{i}a', 'name': '樓梯', 'rect': [x0, r0, x0 + FLIGHT_W, r1], 'axis': 'y', 'up': away, 'low': low, 'high': low + FH / 2})
        landings.append({'rect': [x0, m0, x0 + CORE_W, m1], 'elevation': low + FH / 2})
        stairs.append({'id': f'ma-{k}{i}b', 'name': '樓梯', 'rect': [x0 + CORE_W - FLIGHT_W, r0, x0 + CORE_W, r1], 'axis': 'y', 'up': back, 'low': low + FH / 2, 'high': low + FH})

# ---------------------------------------------------------------- 1F
f1_spaces = [
    # Classroom wing (page top; the south side on the ground).
    room('121', '專業教室(一)', [[7, 0, 21, 11.5]], 'classroom', legendArea=148),
    room('122', '駕駛行為模擬實驗室', [[24, 0, 31.5, 11.5]], 'office', legendArea=84),
    room('123', '專業教室(二)', [[31.5, 0, 39.5, 11.5]], 'classroom', legendArea=89),
    room('123-1', '品質管制與穩健設計實驗室', [[39.5, 0, 44.5, 11.5]], 'office', legendArea=60),
    room('124', '人員績效實驗室', [[44.5, 4, 51, 11.5]], 'office', legendArea=48),
    room(None, '實驗準備室', [[44.5, 0, 51, 4]]),
    room('126', '組織與人力資源學成專業教室', [[54, 0, 64.5, 11.5]], 'classroom', legendArea=126),
    room('128', '廁所(無障礙)', [[64.5, 0, 67.5, 4]], kind='toilet'),
    room('127', '廁所(男)', [[67.5, 0, 72, 5]], 'restroom', kind='toilet'),
    circ('wc-lobby', '走廊', [[64.5, 4, 67.5, 11.5], [67.5, 5, 72, 6.5]]),
    core_space('C', False),
    circ('east-hall', '東側門廳', [[72, 0, 80, 11.5]], 'lobby'),
    circ('breezeway-1', '穿堂', [[21, 0, 24, 11.5]]),
    circ('breezeway-2', '穿堂', [[51, 0, 54, 11.5]]),
    circ('arcade', '迴廊', [[7, 11.5, 67.5, 14], [67.5, 12, 72, 14], [72, 11.5, 80, 14], [15, 14, 19.5, 14.5]]),
    # Middle strip.
    room('111', '研討室', [[7, 14, 15, 19]], 'discussion', legendArea=11),
    core_space('A', False),
    circ('terrace', '迴廊', [[19.5, 14, 34.5, 19]]),
    room('112', '器材室', [[20.5, 19, 24.5, 25]], legendArea=18),
    room('113', '品質管理與統計分析諮詢中心', [[24.5, 19, 34.5, 25]], 'office', legendArea=71),
    room('114', 'EMBA及碩博班專業授課教室', [[41, 14, 54.5, 24.5]], 'classroom', legendArea=140),
    room('115', '永續金融講座教室', [[54.5, 14, 61.5, 21]], 'classroom', legendArea=49),
    room('116', '客座教授研究室', [[61.5, 14, 64.5, 18]], 'carrel', legendArea=13),
    # Spine between the two courtyards.
    circ('spine', '中央穿廊', [[34.5, 14, 41, 66.5]]),
    # 視聽 / 階梯教室 block.
    room('103', '器材室', [[7, 45.5, 14, 52.5]], legendArea=47),
    room('102', '視聽教室', [[14, 45.5, 26.5, 56]], 'theater', legendArea=120),
    room(None, '準備室', [[26.5, 45.5, 30, 53], [30, 45.5, 34.5, 47.5]]),
    core_space('B', False),
    circ('stair-b-lobby', '走廊', [[26.5, 53, 34.5, 56]]),
    room('106', '階梯教室', [[0, 52.5, 11, 64]], 'theater', legendArea=110),
    circ('hall-106', '門廳', [[11, 52.5, 14, 64]], 'lobby'),
    circ('corridor-s', '走廊', [[14, 56, 34.5, 58.5]]),
    room('105', '組織競能與人力資源管理研究室', [[14, 58.5, 17.5, 64]], 'carrel', legendArea=16),
    room('104', '商業類課程發展中心', [[17.5, 58.5, 24.5, 64]], 'office', legendArea=37),
    room('118', '廁所(女)', [[24.5, 58.5, 29, 64]], 'restroom', kind='toilet'),
    room('117', '廁所(男)', [[29, 58.5, 34.5, 62], [31, 62, 34.5, 64]], 'restroom', kind='toilet'),
    room('119', '廁所(無障礙)', [[29, 62, 31, 64]], kind='toilet'),
    circ('gallery-s', '南側迴廊', [[11, 64, 34.5, 66.5]]),
    # 智慧商務中心 with its curved end, stepped.
    room('101', '智慧商務中心', [[41, 48, 55, 64], [55, 49.5, 59, 63], [59, 51.5, 62, 61], [62, 53.5, 64, 59]], 'office', legendArea=347),
]

f1_open = [
    door_h(9.5, 11.5), door_h(18.5, 11.5), door_h(27, 11.5), door_h(33.5, 11.5), door_h(37.5, 11.5),
    door_h(42, 11.5), door_h(47.5, 11.5), door_h(49, 4), door_h(56, 11.5), door_h(62.5, 11.5),
    door_h(66, 4), door_h(69.75, 5),
    door_h(10.5, 14), door_h(22.5, 19), door_h(27.5, 19), door_h(32, 19),
    door_h(43.5, 14), door_h(51.5, 14), door_h(58, 14), door_h(63, 14),
    door_h(12.5, 52.5), door_h(16, 56), door_h(23, 56), door_v(26.5, 48),
    door_v(11, 55), door_v(11, 61.5),
    door_h(15.75, 58.5), door_h(21, 58.5), door_h(26.75, 58.5), door_h(32, 58.5), door_h(30, 62, 0.9),
    door_v(41, 52, 1.8), door_h(46, 48, 1.8),
    door_v(80, 6, 2.4, 'exit', '東側入口'),
    {'kind': 'exit', 'a': [35.5, 66.5], 'b': [40, 66.5], 'label': '南側入口'},
    {'kind': 'open', 'a': [7, 11.8], 'b': [7, 13.7]}, {'kind': 'open', 'a': [80, 11.8], 'b': [80, 13.7]},
    {'kind': 'open', 'a': [21.3, 0], 'b': [23.7, 0]}, {'kind': 'open', 'a': [51.3, 0], 'b': [53.7, 0]},
    {'kind': 'open', 'a': [11.3, 66.5], 'b': [13.7, 66.5]},
    core_open('A'), core_open('B'), core_open('C'),
]
f1_open += arcade_h(64.5, 80, 14)
f1_open += arcade_h(19.5, 20.5, 19, bay=1.0, pier=0.2)
f1_open += arcade_v(34.5, 25, 45.5)
f1_open += arcade_v(41, 24.5, 48)
f1_open += arcade_h(14, 34.5, 66.5)
f1_open += arcade_v(11, 64, 66.5, bay=2.5)

# ---------------------------------------------------------------- 2F (page D1-3: 8.0 px/m across, 8.5 down)
f2_spaces = [
    room('221', '資訊管理系教室', [[7, 0, 21.5, 11.5]], 'classroom'),
    room(None, '管道間', [[21.5, 0, 24.5, 3.5]]),
    room('222', '研究室', [[21.5, 3.5, 24.5, 11.5]], 'carrel'),
    room('223', '資訊管理系實驗室', [[24.5, 0, 34.5, 8.5], [24.5, 8.5, 30, 11.5]], 'office'),
    room('224', '研究室', [[30, 8.5, 34.5, 11.5]], 'carrel'),
    room('225', '資訊管理系實驗室', [[34.5, 0, 44.5, 11.5]], 'office'),
    room('226', '研究室', [[44.5, 0, 51, 4]], 'carrel'),
    room('227', '研究室', [[44.5, 4, 51, 8]], 'carrel'),
    room('228', '研究室', [[44.5, 8, 51, 11.5]], 'carrel'),
    room(None, '管道間 ', [[51, 0, 54, 3.5]]),
    room('229', '企業管理系教室', [[54, 0, 64.5, 11.5]], 'classroom'),
    room('231', '廁所', [[67.5, 0, 72, 5]], 'restroom', kind='toilet'),
    room('200', '財務金融系辦公室', [[72, 0, 76.5, 11.5]], 'office'),
    core_space('C', False),
    circ('corridor', '走廊', [[7, 11.5, 67.5, 14], [67.5, 12, 72, 14], [72, 11.5, 76.5, 14], [51, 3.5, 54, 11.5],
                              [64.5, 0, 67.5, 11.5], [67.5, 5, 72, 6.5], [15, 14, 19.5, 14.5]]),
    room('211', '研究室', [[7, 14, 15, 19.5]], 'office'),
    core_space('A', False),
    circ('hall', '交誼區', [[19.5, 14, 34.5, 19.5]], 'lobby'),
    room('212', '研究室', [[19.5, 19.5, 24.5, 25.5]], 'office'),
    room('213', '資訊管理系系辦公室', [[24.5, 19.5, 34.5, 25.5]], 'office'),
    room('214', '多功能教室', [[41, 14, 54.5, 24.5]], 'classroom'),
    circ('bridge', '空橋走廊', [[34.5, 14, 41, 66.5]]),
    room('204', '教室', [[7, 45.5, 14, 53]], 'classroom'),
    room('203', '研究室', [[14, 45.5, 19.5, 53]], 'office'),
    room('202', '教室', [[19.5, 45.5, 30, 53]], 'classroom'),
    room(None, '儲藏室', [[30, 45.5, 34.5, 47.5]]),
    core_space('B', False),
    circ('corridor-s', '走廊', [[11, 53, 34.5, 56], [11, 56, 14, 66.5]]),
    room('208', '階梯教室', [[0, 53, 11, 64]], 'theater'),
    room('207', '研究室', [[14, 56, 21.5, 60.5]], 'office'),
    room('206', '研究室', [[14, 60.5, 21.5, 66.5]], 'office'),
    room('205', '企業管理系研究室', [[21.5, 56, 27.5, 66.5]], 'office'),
    room('209-2', '研究室', [[27.5, 56, 31, 66.5]], 'carrel'),
    room('209-1', '研究室', [[31, 56, 34.5, 66.5]], 'carrel'),
    room('201', '公館辦公室', [[41, 48, 55, 64], [55, 49.5, 59, 63], [59, 51.5, 62, 61], [62, 53.5, 64, 59]], 'office'),
    circ('link', '往管理二館空橋', [[41, 45.5, 62, 48]]),
]
f2_open = [
    door_h(9.5, 11.5), door_h(19, 11.5), door_h(23, 11.5), door_h(27, 11.5), door_h(32.5, 11.5), door_h(36.5, 11.5), door_h(42.5, 11.5),
    door_h(48, 11.5), door_h(47.5, 4), door_v(51, 6), door_h(56, 11.5), door_h(62.5, 11.5),
    door_h(69.75, 5), door_v(72, 5.75, 0.9), door_h(74.25, 11.5),
    door_h(11, 14), door_h(22, 19.5), door_h(27.5, 19.5), door_h(32, 19.5),
    door_h(43.5, 14), door_h(51.5, 14), door_v(41, 20),
    door_h(12.5, 53), door_h(16.5, 53), door_h(22, 53), door_h(28, 53), door_v(30, 46.5, 0.9),
    door_v(11, 54.5), door_v(11, 61), door_h(17.5, 56), door_v(14, 63.5), door_h(24.5, 56), door_h(29.25, 56), door_h(32.75, 56),
    door_v(41, 52, 1.8), door_h(46, 48, 1.8),
    door_v(62, 46.75, 1.6, 'closed', '往管理二館空橋（建置中）'),
    core_open('A'), core_open('B'), core_open('C'),
]

# ---------------------------------------------------------------- 3F (page D1-5: 7.36 px/m across, 8.87 down)
north = [26.5, 30.5, 34.5, 38, 42, 46, 49.5, 53.5, 57]
f3_spaces = [
    room('314', '財務金融系專業教室', [[7, 0, 23, 12]], 'classroom'),
    room(None, '管道間', [[23, 0, 26.5, 3.5]]),
    *[room(str(331 + i), '研究室', [[north[i], 0, north[i + 1], 3.5]], 'carrel') for i in range(8)],
    room(None, '管道間 ', [[57, 0, 60.5, 3.5]]),
    room('339', '研究室', [[60.5, 0, 64.5, 3.5]], 'carrel'),
    room('340', '研究室', [[64.5, 0, 68, 3.5]], 'carrel'),
    room('341', '研究室', [[68, 0, 72, 3.5]], 'carrel'),
    room('343', '研究室', [[74.5, 0, 80, 3.5]], 'carrel'),
    room('342', '研究室', [[77.5, 3.5, 80, 8.5]], 'carrel'),
    circ('corridor', '走廊', [[23, 3.5, 77.5, 6.5], [72, 0, 74.5, 3.5], [76, 6.5, 77.5, 12], [77.5, 8.5, 80, 12]]),
    circ('lobby', '三樓大廳', [[23, 6.5, 38, 12], [14, 12, 46, 14.5], [19.5, 14.5, 46, 19], [14, 14.5, 15, 19.5]], 'lobby'),
    room('321', '財務金融系系辦公室', [[38, 6.5, 46, 12]], 'office'),
    room('322', '研究室', [[46, 6.5, 49.5, 12]], 'carrel'),
    room('323', '研究室', [[49.5, 6.5, 53.5, 12]], 'carrel'),
    room('324', '研究室', [[53.5, 6.5, 57.5, 12]], 'carrel'),
    room('325', '研究室', [[57.5, 6.5, 60.5, 12]], 'carrel'),
    room('326', '研究室', [[60.5, 6.5, 64.5, 12]], 'carrel'),
    room('327a', '研究室', [[64.5, 6.5, 67.5, 12]], 'carrel'),
    core_space('C', True),
    room('327b', '研究室', [[72, 6.5, 76, 12]], 'carrel'),
    room('313', '研討室', [[7, 12, 14, 19.5]], 'discussion'),
    core_space('A', True),
    room('312', '教室', [[23, 19, 34.5, 26]], 'classroom'),
    room('309a', '企業管理系研究室', [[38, 19, 46, 25.5]], 'office'),
    circ('spine', '走廊', [[34.5, 19, 38, 59.5], [38, 32.5, 45.5, 39.5]]),
    room('311', '教室', [[26.5, 26, 34.5, 35]], 'classroom'),
    room('310', '教室', [[26.5, 35, 34.5, 44.5]], 'classroom'),
    room('309', '研究室', [[38, 25.5, 45.5, 32.5]], 'office'),
    room('308', '企業管理系研究室', [[38, 39.5, 45.5, 46]], 'office'),
    room('303', '財務金融系教室', [[7, 46, 14.5, 53.5]], 'classroom'),
    room('302', '財務金融系研究室', [[14.5, 46, 21, 53.5]], 'office'),
    room('301', '財務金融系教室', [[21, 46, 30, 53.5]], 'classroom'),
    room(None, '儲藏室', [[30, 46, 34.5, 47.5]]),
    core_space('B', True),
    circ('corridor-s', '走廊', [[5.5, 53.5, 34.5, 57], [38, 53.5, 63.5, 57], [30, 53, 34.5, 53.5], [5.5, 64.5, 11, 66.5], [11, 63, 38, 66.5]]),
    room('307', '財務金融系教室', [[0, 53.5, 5.5, 65]], 'classroom'),
    room('306', '研究室', [[5.5, 57, 11, 64.5]], 'office'),
    room('305', '電腦教室', [[11, 57, 23, 63]], 'classroom'),
    room('304', '研究室', [[23, 57, 30, 63]], 'office'),
    room('300-1', '研究室', [[30, 57, 34.5, 63]], 'carrel'),
    room('300-2', '茶水間', [[34.5, 59.5, 38, 63]]),
    room('308-1', '研究室', [[38, 46, 45.5, 49.5]], 'carrel'),
    room('308-2', '研究室', [[38, 49.5, 45.5, 53.5]], 'carrel'),
    room('308-8', '研究室', [[45.5, 46, 51.5, 53.5]], 'office'),
    room('308-3', '研究室', [[51.5, 46, 63.5, 53.5]], 'office'),
    room('308-4', '資訊管理系研究室', [[63.5, 46, 73, 57]], 'office'),
    room('308-7', '研究室', [[38, 57, 42, 66]], 'carrel'),
    room('308-6', '研究室', [[42, 57, 46, 66]], 'carrel'),
    room('308-5', '研究生研究室', [[46, 57, 63.5, 66]], 'office'),
]
f3_open = [
    door_h(16, 12), door_h(21, 12), door_v(23, 5),
    *[door_h((north[i] + north[i + 1]) / 2, 3.5, 0.9) for i in range(8)],
    door_h(62.5, 3.5, 0.9), door_h(66.25, 3.5, 0.9), door_h(70, 3.5, 0.9), door_h(76.5, 3.5, 0.9), door_v(77.5, 6, 0.9),
    door_h(42, 6.5), door_h(47.75, 6.5, 0.9), door_h(51.5, 6.5, 0.9), door_h(55.5, 6.5, 0.9), door_h(59, 6.5, 0.9), door_h(62.5, 6.5, 0.9),
    door_h(66, 6.5, 0.9), door_h(74, 6.5, 0.9),
    door_v(14, 16.5), door_h(26, 19), door_h(32, 19), door_v(38, 22),
    door_v(34.5, 28), door_v(34.5, 33), door_v(34.5, 37), door_v(34.5, 43),
    door_v(38, 27), door_v(38, 31.5), door_v(38, 41), door_v(38, 45),
    door_h(10, 53.5), door_h(17.5, 53.5), door_h(23, 53.5), door_h(28, 53.5), door_v(30, 46.75, 0.9),
    door_v(5.5, 55.25), door_h(8.25, 57), door_h(14, 57), door_h(21, 57), door_h(26.5, 57), door_h(32.25, 57), door_h(36.25, 59.5),
    door_v(38, 47.75), door_v(38, 51.5), door_h(48.5, 53.5), door_h(54, 53.5), door_h(61, 53.5), door_v(63.5, 55.25),
    door_h(40, 57), door_h(44, 57), door_h(49, 57), door_h(60, 57),
    core_open('A'), core_open('B'), core_open('C'),
]

shell = {}
floors = {
    '1F': {'bandTop': FH, 'spaces': f1_spaces, 'openings': [o for o in f1_open if o['a'] != o['b']], 'signs': []},
    '2F': {'bandTop': FH, 'spaces': f2_spaces, 'openings': f2_open, 'signs': []},
    '3F': {'bandTop': FH, 'spaces': f3_spaces, 'openings': f3_open, 'signs': []},
}

# ---------------------------------------------------------------- placement
campus = json.load(open(ROOT + 'public/data/campus.json'))
ring = next(b for b in campus['buildings'] if b['id'] == 167826282)['outer']
n = len(ring) // 2
best = (0, 1, 0)
for i in range(n):
    j = (i + 1) % n
    ex, ez = ring[2 * j] - ring[2 * i], ring[2 * j + 1] - ring[2 * i + 1]
    L = math.hypot(ex, ez)
    if L > best[0]: best = (L, ex / L, ez / L)
_, dx, dz = best
us = [ring[2 * i] * dx + ring[2 * i + 1] * dz for i in range(n)]
vs = [-ring[2 * i] * dz + ring[2 * i + 1] * dx for i in range(n)]
u0, v0 = min(us), min(vs)
world0 = [round(u0 * dx - v0 * dz, 3), round(u0 * dz + v0 * dx, 3)]

source = {
    'id': 'ma',
    'name': '管理一館',
    'sources': '總務處校舍配置與面積手冊 D1-1 ~ D1-6（管理一館 1F-3F），對照現場照片手工重描；座標單位 m',
    'osmReplaces': ['管理一館'],
    'transform': {'angleDeg': round(math.degrees(math.atan2(dz, dx)), 2), 'planCentroid': [0, 0], 'worldCentroid': world0},
    'floorHeight': FH,
    'levels': [{'id': l, 'elevation': i * FH, 'built': True} for i, l in enumerate(LEVELS)],
    'shell': shell,
    'floors': floors,
    'directory': [{'level': '1F', 'items': ['智慧商務中心', '視聽教室', '階梯教室']}, {'level': '2F', 'items': ['資訊管理系', '公館辦公室', '往管理二館空橋']}, {'level': '3F', 'items': ['財務金融系', '企業管理系', '三樓大廳']}],
    'stairs': stairs,
    'landings': landings,
}
out = ROOT + 'assets-src/floorplans/管理一館/ma.source.json'
json.dump(source, open(out, 'w'), ensure_ascii=False, indent=1)
print('wrote', out, {k: (len(v['spaces']), len(v['openings'])) for k, v in floors.items()}, len(stairs), 'flights')
