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
    room('128', '廁所(無障礙)', [[64.5, 0, 67, 4]], kind='toilet'),
    room('127', '廁所(男)', [[67, 0, 71.5, 6]], 'restroom', kind='toilet'),
    room(None, '東側樓梯間', [[67, 6, 71.5, 11.5]]),
    circ('wc-lobby', '走廊', [[64.5, 4, 67, 11.5]]),
    circ('east-hall', '東側門廳', [[71.5, 0, 80, 11.5]], 'lobby'),
    circ('breezeway-1', '穿堂', [[21, 0, 24, 11.5]]),
    circ('breezeway-2', '穿堂', [[51, 0, 54, 11.5]]),
    circ('arcade', '迴廊', [[7, 11.5, 80, 14]]),
    # Middle strip.
    room('111', '研討室', [[7, 14, 14, 19]], 'discussion', legendArea=11),
    room(None, '西側樓梯間', [[14, 14, 18.5, 19.5]]),
    circ('terrace', '迴廊', [[18.5, 14, 34.5, 19]]),
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
    room(None, '準備室', [[26.5, 45.5, 31, 50.5]]),
    room(None, '南側樓梯間', [[26.5, 50.5, 31, 56]]),
    circ('stair-b-lobby', '走廊', [[31, 45.5, 34.5, 56]]),
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
    # Classroom wing doors onto the arcade.
    door_h(9.5, 11.5), door_h(18.5, 11.5), door_h(27, 11.5), door_h(33.5, 11.5), door_h(37.5, 11.5),
    door_h(42, 11.5), door_h(47.5, 11.5), door_h(49, 4), door_h(56, 11.5), door_h(62.5, 11.5),
    door_h(65.75, 4), door_v(67, 5), door_h(69.25, 11.5, 1.4, 'closed', '樓梯（2F 建置中）'),
    # Middle strip.
    door_h(10.5, 14), door_h(16.25, 14, 1.4, 'closed', '樓梯（2F 建置中）'),
    door_h(22.5, 19), door_h(27.5, 19), door_h(32, 19),
    door_h(43.5, 14), door_h(51.5, 14), door_h(58, 14), door_h(63, 14),
    # 視聽 / 階梯教室 block.
    door_h(12.5, 52.5), door_h(16, 56), door_h(23, 56), door_v(26.5, 48),
    door_h(28.75, 56, 1.4, 'closed', '樓梯（2F 建置中）'),
    door_v(11, 55), door_v(11, 61.5),
    door_h(15.75, 58.5), door_h(21, 58.5), door_h(26.75, 58.5), door_h(32, 58.5), door_h(30, 62, 0.9),
    # 智慧商務中心.
    door_v(41, 52, 1.8), door_h(46, 48, 1.8),
    # Ways in: both ends of the arcade, the breezeways, the spine and the east hall.
    door_v(80, 6, 2.4, 'exit', '東側入口'),
    {'kind': 'exit', 'a': [35.5, 66.5], 'b': [40, 66.5], 'label': '南側入口'},
    {'kind': 'open', 'a': [7, 11.8], 'b': [7, 13.7]}, {'kind': 'open', 'a': [80, 11.8], 'b': [80, 13.7]},
    {'kind': 'open', 'a': [21.3, 0], 'b': [23.7, 0]}, {'kind': 'open', 'a': [51.3, 0], 'b': [53.7, 0]},
    {'kind': 'open', 'a': [11.3, 66.5], 'b': [13.7, 66.5]},
]
# Open arcades: bays between piers wherever a circulation edge faces a courtyard.
f1_open += arcade_h(64.5, 80, 14)            # arcade, east of 116
f1_open += arcade_h(18.5, 20.5, 19)          # terrace corner
f1_open += arcade_v(34.5, 25, 45.5)          # spine, west courtyard
f1_open += arcade_v(41, 24.5, 48)            # spine, east courtyard
f1_open += arcade_v(34.5, 58.5, 66.5)        # (none: rooms there) kept for the gallery end
f1_open += arcade_h(14, 34.5, 66.5)          # south gallery
f1_open += arcade_v(11, 64, 66.5, bay=2.5)   # gallery west end
f1_open += arcade_v(14, 45.5, 45.5)

# Upper storeys: massing only until their plans are traced.
shell = {
    '2F': [[7, 0, 80, 14], [7, 14, 18.5, 19.5], [20.5, 19, 34.5, 25], [41, 14, 54.5, 24.5], [34.5, 14, 41, 66.5],
           [0, 45.5, 34.5, 66.5], [41, 48, 55, 64], [55, 49.5, 59, 63], [59, 51.5, 62, 61]],
    '3F': [[7, 0, 80, 14], [7, 14, 18.5, 19.5], [26, 14, 47, 45.5], [0, 45.5, 64, 66.5]],
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
    'levels': [{'id': '1F', 'elevation': 0, 'built': True}, {'id': '2F', 'elevation': FH, 'built': False}, {'id': '3F', 'elevation': 2 * FH, 'built': False}],
    'shell': shell,
    'floors': {'1F': {'bandTop': FH, 'spaces': f1_spaces, 'openings': [o for o in f1_open if o['a'] != o['b']], 'signs': []}},
    'directory': [{'level': '1F', 'items': ['智慧商務中心', '視聽教室', '階梯教室', '專業教室']}],
    'stairs': [],
    'landings': [],
}
out = ROOT + 'assets-src/floorplans/管理一館/ma.source.json'
json.dump(source, open(out, 'w'), ensure_ascii=False, indent=1)
print('wrote', out, len(f1_spaces), 'spaces', len(source['floors']['1F']['openings']), 'openings', source['transform'])
