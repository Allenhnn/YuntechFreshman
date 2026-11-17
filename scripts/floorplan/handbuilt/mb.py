"""Hand-traced 管理二館 (MB) → assets-src/floorplans/管理二館/mb.source.json.

Usage: python3 scripts/floorplan/handbuilt/mb.py && npm run buildings:build

Traced from the 總務處 handbook pages D2-3/5/7 (1F-3F), measured on the page images in pixels.
Each page is mapped to plan metres by its scale and one anchor, the building's south-east outer
corner (east face of the east wing, south face of the classroom bar):
  1F  8.67 px/m, anchor (672, 750)     2F  8.67 px/m, anchor (682.5, 797.5)
  3F 10.1 px/m, anchor (685, 805)      (the 3F page is drawn ~16 % larger)
Plan frame: +X along the classroom bar (west end of the 1F block = 0), +Y across it; the page is
drawn with north to the left, so +X runs south and +Y west on the ground.
"""
import json
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from widen import widen

ROOT = '/Users/allenhnn/Codes/YuntechFreshMan/'
FH = 3.6
CEIL = 3.3
ANCHOR = (63.9, 55.7)
PAGES = {'1F': (8.67, 672, 750), '2F': (8.67, 682.5, 797.5), '3F': (10.1, 685, 805)}

def snap(v): return round(v * 10) / 10

def R(fl, x0, y0, x1, y1):
    s, ex, sy = PAGES[fl]
    return [snap(ANCHOR[0] + (x0 - ex) / s), snap(ANCHOR[1] + (y0 - sy) / s), snap(ANCHOR[0] + (x1 - ex) / s), snap(ANCHOR[1] + (y1 - sy) / s)]

FURNISH = [('廁所', 'restroom'), ('祈禱室', None), ('教室', 'classroom'), ('研討', 'discussion'), ('實驗室', 'office'), ('研究室', 'office'), ('辦公室', 'office'), ('工坊', 'office'), ('空間', 'discussion'), ('中心', 'office'), ('器材室', None)]

def room(code, name, rects, area=None):
    s = {'id': f'MB{code}', 'code': f'MB{code}', 'name': name, 'kind': 'toilet' if '廁所' in name else 'room', 'ceiling': CEIL, 'rects': rects}
    for key, f in FURNISH:
        if key in name:
            if f: s['furnish'] = f
            break
    if '教師研究室' in name: s['furnish'] = 'carrel'
    if area: s['legendArea'] = area
    return s

def circ(id, name, rects, kind='corridor'):
    return {'id': id, 'name': name, 'kind': kind, 'ceiling': CEIL, 'group': 'circ', 'rects': rects}

# ---------------------------------------------------------------- stair cores (plan metres, all floors)
CORES = {'N': ([52.3, 0.5, 55.7, 5.5], 5.5, -1), 'W': ([3.7, 34.4, 7.3, 40.6], 40.6, -1)}
LEVELS = ['1F', '2F', '3F']
LANDING = 1.0

def core_space(k, top):
    s = {'id': f'stair-{k}', 'name': '樓梯', 'kind': 'stair', 'ceiling': CEIL, 'rects': [CORES[k][0]]}
    if not top: s['noCeiling'] = True
    return s

def core_open(k):
    (x0, _, x1, _), y, _ = CORES[k]
    return {'kind': 'open', 'a': [x0 + 0.3, y], 'b': [x1 - 0.3, y]}

stairs, landings = [], []
for k, ((x0, y0, x1, y1), near, sgn) in CORES.items():
    far = y0 if sgn < 0 else y1
    fw = (x1 - x0) / 2 - 0.05
    span = lambda a, b: (min(a, b), max(a, b))
    for i in range(len(LEVELS)):
        low = i * FH
        f0, f1 = span(near, near + sgn * LANDING)
        landings.append({'rect': [x0, f0, x1, f1], 'elevation': low})
        if i == len(LEVELS) - 1: break
        r0, r1 = span(near + sgn * LANDING, far - sgn * LANDING)
        m0, m1 = span(far - sgn * LANDING, far)
        away, back = ('+', '-') if sgn > 0 else ('-', '+')
        stairs.append({'id': f'mb-{k}{i}a', 'name': '樓梯', 'rect': [x0, r0, x0 + fw, r1], 'axis': 'y', 'up': away, 'low': low, 'high': low + FH / 2})
        landings.append({'rect': [x0, m0, x1, m1], 'elevation': low + FH / 2})
        stairs.append({'id': f'mb-{k}{i}b', 'name': '樓梯', 'rect': [x1 - fw, r0, x1, r1], 'axis': 'y', 'up': back, 'low': low + FH / 2, 'high': low + FH})

# ---------------------------------------------------------------- 1F
F = '1F'
f1 = [
    circ('corridor', '走廊', [R(F, 540, 300, 633, 359), R(F, 540, 359, 570, 633), R(F, 152, 633, 633, 653), R(F, 567, 653, 633, 700), R(F, 597, 700, 633, 750), R(F, 152, 567, 212, 687)]),
    circ('breezeway', '穿堂', [R(F, 478, 653, 567, 750)]),
    room('100-1', '廁所(男)', [R(F, 600, 267, 634, 300)]),
    room('100-2', '廁所(女)', [R(F, 634, 267, 671, 330)]),
    room('102', '普通教室', [R(F, 469, 359, 540, 450)], 109.2), room('101', '普通教室', [R(F, 570, 359, 644, 450)], 109.2),
    room('104', '普通教室', [R(F, 469, 450, 540, 541)], 109.2), room('103', '普通教室', [R(F, 570, 450, 644, 541)], 109.2),
    room('106', '普通教室', [R(F, 469, 541, 540, 632)], 109.2), room('105', '普通教室', [R(F, 570, 541, 644, 632)], 109.2),
    room('110', '普通教室', [R(F, 212, 653, 300, 725)], 109.2), room('109', '普通教室', [R(F, 300, 653, 388, 725)], 81.9),
    room('108', '普通教室', [R(F, 388, 653, 478, 725)], 81.9),
    room('107-1', '研討室', [R(F, 633, 658, 672, 700)], 13), room('107', '研究室', [R(F, 633, 700, 672, 750)], 39),
    room('111', '工商學程系學會暨院諮商輔導中心', [R(F, 118, 657, 152, 687)], 13.5),
    room('114', '廁所(無障礙)', [R(F, 152, 687, 178, 715)]),
    room('113', '廁所(女)', [R(F, 118, 687, 152, 750), R(F, 152, 715, 178, 750)]),
    room('112', '廁所(男)', [R(F, 178, 687, 212, 750)]),
    core_space('N', False), core_space('W', False),
]
f1_extra = [
    {'kind': 'exit', 'a': [R(F, 545, 0, 0, 0)[0], R(F, 0, 300, 0, 0)[1]], 'b': [R(F, 565, 0, 0, 0)[0], R(F, 0, 300, 0, 0)[1]], 'label': '北側入口'},
    {'kind': 'exit', 'a': [R(F, 152, 0, 0, 0)[0], R(F, 0, 630, 0, 0)[1]], 'b': [R(F, 152, 0, 0, 0)[0], R(F, 0, 650, 0, 0)[1]], 'label': '往管理三館'},
    {'kind': 'open', 'a': [R(F, 482, 0, 0, 0)[0], R(F, 0, 750, 0, 0)[1]], 'b': [R(F, 563, 0, 0, 0)[0], R(F, 0, 750, 0, 0)[1]]},
    core_open('N'), core_open('W'),
]

# ---------------------------------------------------------------- 2F
F = '2F'
f2 = [
    circ('corridor', '走廊', [R(F, 552, 295, 612, 402), R(F, 557, 402, 582, 675), R(F, 165, 675, 637, 702), R(F, 605, 702, 637, 797.5), R(F, 165, 610, 192, 675), R(F, 165, 702, 192, 732), R(F, 165, 732, 192, 760), R(F, 612, 370, 682.5, 402)]),
    circ('bridge-w', '往管理三館空橋', [R(F, 20, 675, 165, 697)]),
    room('200-1', '廁所(男)', [R(F, 612, 310, 647, 370)]), room('200-2', '廁所(女)', [R(F, 647, 310, 685, 370)]),
    room('204', '數位圖書館暨多媒體教學實驗室', [R(F, 465, 402, 557, 465)], 60.9),
    room('205', '網路視訊教學實驗室', [R(F, 465, 465, 557, 510)], 45.7),
    room('205a', '智慧型資料庫系統實驗室', [R(F, 465, 510, 557, 556)], 45.7),
    room('206', '電子商務暨群組軟體實驗室', [R(F, 465, 556, 557, 613.5)], 60.9),
    room('207', '系統模擬暨網際網路應用實驗室', [R(F, 465, 613.5, 557, 675)], 60.9),
    room('201', '應用資訊系統實驗室', [R(F, 582, 402, 682.5, 495)], 172.5),
    room('202', '研究生研究室', [R(F, 582, 495, 634, 555)], 39), room('202-1', '雲端農業實驗室', [R(F, 634, 495, 682.5, 555)], 70),
    room('203-1', '碩士在職專班研究室', [R(F, 582, 555, 682.5, 582.5)], 69.5),
    room('203', '專業教室(三)', [R(F, 582, 582.5, 682.5, 675)], 154),
    room('211', '團隊創新與學習教室', [R(F, 230, 702, 342, 787)], 154),
    room('210', '博士班研究室', [R(F, 342, 702, 402, 745)], 36.7),
    room('209c', '研究室', [R(F, 342, 745, 372, 787)]),
    room('209b', '博士班研究室', [R(F, 372, 745, 402, 787)], 20),
    room('209a', '企業個案研討室', [R(F, 402, 702, 492, 787)], 110.3),
    {'id': 'void-2F', 'name': '挑空', 'kind': 'void', 'ceiling': CEIL, 'rects': [R(F, 492, 702, 580, 787)]},
    room('208', '創思空間', [R(F, 637, 702, 682.5, 792)], 55.5),
    room('213', '實驗室', [R(F, 192, 610, 227, 675)], 24),
    room('212', '穆斯林祈禱室(男)', [R(F, 132, 702, 165, 732)], 12.3),
    room('216', '廁所(無障礙)', [R(F, 132, 732, 165, 757)]),
    room('215', '廁所(男)', [R(F, 132, 757, 180, 797.5)]),
    room('214-1', '穆斯林祈禱室(女)', [R(F, 192, 732, 227, 760)], 10.6),
    room('214', '廁所(女)', [R(F, 180, 760, 227, 797.5)]),
    room(None and '', '', []) if False else circ('hall-w', '走廊', [R(F, 192, 702, 230, 732)]),
    core_space('N', False), core_space('W', False),
]
f2_extra = [
    {'kind': 'open', 'a': [R(F, 560, 0, 0, 0)[0], R(F, 0, 295, 0, 0)[1]], 'b': [R(F, 580, 0, 0, 0)[0], R(F, 0, 295, 0, 0)[1]], 'label': '往管理一館空橋'},  # skyBridge.ts
    {'kind': 'closed', 'a': [R(F, 20, 0, 0, 0)[0], R(F, 0, 678, 0, 0)[1]], 'b': [R(F, 20, 0, 0, 0)[0], R(F, 0, 694, 0, 0)[1]], 'label': '往管理三館'},
    core_open('N'), core_open('W'),
]

# ---------------------------------------------------------------- 3F
F = '3F'
west_rows = [345, 379, 415, 451, 487.5, 520, 552.5, 587.5, 622.5, 660]
east_rows = [345, 379, 415, 451, 487.5, 520, 552.5, 587.5, 622.5, 660]
f3 = [
    circ('corridor', '走廊', [R(F, 550, 295, 625, 345), R(F, 602, 345, 625, 660), R(F, 75, 660, 607, 690), R(F, 575, 690, 607, 795), R(F, 75, 582, 107, 745), R(F, 102, 655, 145, 712)]),
    # Clear of the north stair core (X ≤ 55.7), which takes part of the drawn 300-1.
    room('300-1', '廁所(男)', [[55.7, 0.3, 59.6, 5.2]]), room('300-2', '廁所(女)', [[59.6, 0.0, 63.9, 7.0]]),
    *[room(str(302 + 2 * i), '教師研究室', [R(F, 550, west_rows[i], 602, west_rows[i + 1])], 19.5) for i in range(9)],
    *[room(str(301 + 2 * i), '教師研究室', [R(F, 625, east_rows[i], 685, east_rows[i + 1])], 20.5) for i in range(9)],
    room('319', '基本資料庫小組辦公室', [R(F, 607, 690, 667, 795)], 55.5),
    room('320', '研究生研究室', [R(F, 480, 690, 547.5, 787.5)], 75), room('321', '研究生研究室', [R(F, 412.5, 690, 480, 787.5)], 72.5),
    room('322', '實驗室', [R(F, 344, 690, 412.5, 787.5)], 74.5), room('323', '研究生研究室', [R(F, 276.5, 690, 344, 787.5)], 73.5),
    room('324', '研究生研究室', [R(F, 210, 690, 276.5, 787.5)], 73.5), room('325', '研究生研究室', [R(F, 142.5, 690, 210, 787.5)], 73.5),
    room('326', '創新創作與數位媒體工坊', [R(F, 102, 712, 140, 802)], 36.8),
    room('327', '教師研究室', [R(F, 40, 687, 75, 722)], 12.3),
    room('331', '廁所(無障礙)', [R(F, 40, 722, 75, 745)]),
    room('330', '廁所(女)', [R(F, 40, 745, 75, 805)]), room('329', '廁所(男)', [R(F, 75, 745, 102, 805)]),
    room('328', '器材室', [R(F, 107, 582, 145, 655)], 24),
    core_space('N', True), core_space('W', True),
]
f3_extra = [core_open('N'), core_open('W')]

# ---------------------------------------------------------------- doors: every room opens onto the circulation it touches most
def owner(spaces, x, y):
    for s in reversed(spaces):
        for r in s['rects']:
            if r[0] < x < r[2] and r[1] < y < r[3]: return s
    return None

def auto_doors(spaces):
    out = []
    for s in spaces:
        if s['kind'] not in ('room', 'toilet'): continue
        best = find_run(spaces, s, ('corridor', 'lobby')) or find_run(spaces, s, ('room', 'toilet'))
        if best:
            _, mx, my, vertical = best
            w = 1.6 if s.get('furnish') == 'classroom' else 1.0
            out.append({'kind': 'door', 'a': [round(mx, 2), round(my - w / 2, 2)], 'b': [round(mx, 2), round(my + w / 2, 2)]} if vertical
                       else {'kind': 'door', 'a': [round(mx - w / 2, 2), round(my, 2)], 'b': [round(mx + w / 2, 2), round(my, 2)]})
    return out

def find_run(spaces, s, kinds):
        best = None
        for r in s['rects']:
            x0, y0, x1, y1 = r
            for edge, (ax, ay, bx, by, nx, ny) in enumerate([(x0, y0, x1, y0, 0, -1), (x0, y1, x1, y1, 0, 1), (x0, y0, x0, y1, -1, 0), (x1, y0, x1, y1, 1, 0)]):
                L = abs(bx - ax) + abs(by - ay)
                run, runs, t = None, [], 0.25
                while t < L - 0.2:
                    px, py = ax + (bx - ax) * t / L, ay + (by - ay) * t / L
                    inside = owner(spaces, px - nx * 0.15, py - ny * 0.15) is s
                    o = owner(spaces, px + nx * 0.3, py + ny * 0.3)
                    ok = inside and o is not None and o is not s and o['kind'] in kinds
                    if ok and run is None: run = t
                    if not ok and run is not None: runs.append((run, t)); run = None
                    t += 0.1
                if run is not None: runs.append((run, t))
                for a, b in runs:
                    if b - a >= 1.2 and (best is None or b - a > best[0]):
                        m = (a + b) / 2
                        best = (b - a, ax + (bx - ax) * m / L, ay + (by - ay) * m / L, nx != 0)
        return best

floors = {}
for fl, spaces, extra in (('1F', f1, f1_extra), ('2F', f2, f2_extra), ('3F', f3, f3_extra)):
    print(fl, 'widened', widen(spaces, extra), 'corridor rects')  # before doors, so doors land on the final walls
    floors[fl] = {'bandTop': FH, 'spaces': spaces, 'openings': auto_doors(spaces) + extra, 'signs': []}

# Placement: the plan's south-east corner on the OSM corner (-231.1, -122.6); +X runs along the bar.
source = {
    'id': 'mb',
    'name': '管理二館',
    'sources': '總務處校舍配置與面積手冊 D2-3 ~ D2-8（管理二館 1F-3F），對照現場照片手工重描；座標單位 m',
    'osmReplaces': ['管理二館'],
    'transform': {'angleDeg': 81.0, 'planCentroid': list(ANCHOR), 'worldCentroid': [-231.1, -122.6]},
    'floorHeight': FH,
    'style': {'interior': 'mosaic', 'clerestory': True},
    'levels': [*({'id': l, 'elevation': i * FH, 'built': True} for i, l in enumerate(LEVELS)), {'id': '4F', 'elevation': 3 * FH, 'built': False}],
    'shell': {'4F': [R('3F', 550, 245, 685, 660), R('3F', 40, 660, 685, 805)]},
    'floors': floors,
    'directory': [{'level': '1F', 'items': ['普通教室', '研討室']}, {'level': '2F', 'items': ['資訊管理系實驗室', '企業管理系', '往管理一館空橋']}, {'level': '3F', 'items': ['教師研究室', '研究生研究室']}],
    'stairs': stairs,
    'landings': landings,
}
out = ROOT + 'assets-src/floorplans/管理二館/mb.source.json'
json.dump(source, open(out, 'w'), ensure_ascii=False, indent=1)
print('wrote', out, {k: (len(v['spaces']), len(v['openings'])) for k, v in floors.items()}, len(stairs), 'flights')
