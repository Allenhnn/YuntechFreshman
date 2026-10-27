"""
Semi-automatic tracing of the 總務處 floor plans into building sources (same BuildingSource
format as the hand-traced library, rendered as interiors inside the OSM shells).

  python3 scripts/floorplan/trace.py <building> [...]   one or more names from manifest.json
  python3 scripts/floorplan/trace.py --all
  add --debug to write review images to assets-src/floorplans/<building>/.ocr/

Per floor page: building mask (door gaps closed) → scale from the overall dimension label (cm) →
walls (dark pixels minus OCR'd glyphs) → rooms (free space with door gaps closed, grown back) →
room codes from OCR → names / areas from the legend page. Floors are aligned to 1F by mask
cross-correlation; 1F is registered to the OSM footprint (rotation search, IoU). Output:
assets-src/floorplans/<building>/traced.source.json (+ traced.report.json), consumed by
npm run buildings:build and the interior streaming.

Needs: numpy, opencv-python, Pillow, the OCR caches from ocr_all.py.
"""
import json
import math
import os
import re
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = "assets-src/floorplans"
MIN_IOU = 0.6  # below this the registration is not trusted: the building keeps its generated interior
CELL = 0.5  # plan grid (m)
CODE_RE = re.compile(r"(?<![0-9])([0-9]{3,4}[a-z]?)(?![0-9])")
LEGEND_CODE_RE = re.compile(r"^([A-Z]{1,4})([0-9]{3,4}[a-z]?)")
FIXES = {"鱔": "繕", "厠": "廁", "曾議": "會議", "賢料": "資料", "車訓": "軍訓", "（": "(", "）": ")"}

campus = json.load(open("public/data/campus.json", encoding="utf8"))
osm_by_id = {b["id"]: b for b in campus["buildings"]}


# ---------------------------------------------------------------------------------------------
# OCR pages and legends

def load_page(building: str, name: str) -> dict:
    return json.load(open(f"{ROOT}/{building}/.ocr/{name}.json", encoding="utf8"))


def is_legend(page: dict) -> bool:
    texts = [l["text"] for l in page["lines"]]
    return any("空間代碼" in t or "空間名稱" in t for t in texts) or sum(bool(LEGEND_CODE_RE.match(t.replace(" ", ""))) for t in texts) >= 4


def clean_name(s: str) -> str:
    s = re.sub(r"\s*[0-9]{2}$", "", s.strip()).rstrip(". ")
    for a, b in FIXES.items():
        s = s.replace(a, b)
    return s


def parse_legend(page: dict) -> dict:
    """code number → {code, name, area, cat}; rows grouped by the y of their code token."""
    lines = page["lines"]
    rows = {}
    for l in lines:
        t = l["text"].replace(" ", "")
        m = LEGEND_CODE_RE.match(t)
        if not m:
            continue
        rest = l["text"].split(None, 1)[1] if " " in l["text"].strip() else t[len(m.group(0)):]
        rows[m.group(2)] = {"code": m.group(1) + m.group(2), "y": l["box"][1] + l["box"][3] / 2, "h": l["box"][3], "name": rest.strip(), "area": None, "cat": None}
    for row in rows.values():
        cells = []
        for l in lines:
            cy = l["box"][1] + l["box"][3] / 2
            if abs(cy - row["y"]) > row["h"] * 0.6 or LEGEND_CODE_RE.match(l["text"].replace(" ", "")):
                continue
            cells.append((l["box"][0], l["text"].strip()))
        nums = []
        for _, t in sorted(cells):
            for tok in t.split():
                if re.fullmatch(r"[0-9]+(\.[0-9]+)?", tok):
                    nums.append(tok)
                elif not row["name"] and re.search(r"[一-鿿]", tok):
                    row["name"] = tok
        if nums and re.fullmatch(r"[0-9]{2}", nums[0]):
            row["cat"] = nums.pop(0)
        if nums:
            row["area"] = float(nums[0])
        row["name"] = clean_name(row["name"])
    # "C3101 / ~104" rows cover a range of rooms: copy the row to every number in it.
    for l in lines:
        m = re.fullmatch(r"[~～]\s*([0-9]{3})", l["text"].strip())
        if not m:
            continue
        y = l["box"][1]
        above = min((r for r in rows.values() if 0 < y - r["y"] < r["h"] * 2.2), key=lambda r: y - r["y"], default=None)
        if not above:
            continue
        num = re.search(r"([0-9]{3})$", above["code"]).group(1)
        prefix = above["code"][: len(above["code"]) - 3]
        for n in range(int(num) + 1, int(m.group(1)) + 1):
            code = f"{prefix}{n:03d}"
            key = LEGEND_CODE_RE.match(code).group(2)
            rows.setdefault(key, {**above, "code": code})
    return {k: {kk: v[kk] for kk in ("code", "name", "area", "cat")} for k, v in rows.items()}


# ---------------------------------------------------------------------------------------------
# Page geometry

def dark_mask(path: str) -> np.ndarray:
    im = np.asarray(Image.open(path).convert("L"))
    return (im < 150).astype(np.uint8)


def fill_inside(walls: np.ndarray, close_px: int) -> np.ndarray:
    """Building mask: pixels not reachable from the border once gaps up to ~2·close_px are closed."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px * 2 + 1, close_px * 2 + 1))
    closed = cv2.dilate(walls, k)
    h, w = closed.shape
    flood = closed.copy()
    cv2.floodFill(flood, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 2)
    inside = (flood != 2).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inside, 8)
    if n <= 1:
        return inside
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return cv2.erode((lab == big).astype(np.uint8), k)


def plan_scale(page: dict, mask: np.ndarray) -> float | None:
    """px per metre: the largest horizontal overall dimension (cm) printed above / below the building."""
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    best = None
    for l in page["lines"]:
        t = l["text"].strip()
        if not re.fullmatch(r"[0-9]{4,5}", t):
            continue
        bx, by, bw, bh = l["box"]
        cy = by + bh / 2
        if bw < bh or y0 <= cy <= y1:
            continue
        if best is None or int(t) > best:
            best = int(t)
    if best is None or best < 500:
        return None
    return (x1 - x0) / (best / 100)


def erase_text(walls: np.ndarray, page: dict) -> None:
    """Glyphs: dark blobs entirely inside an OCR box and no bigger than its characters."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(walls, 8)
    erase = np.zeros(n, bool)
    sx, sy = stats[:, cv2.CC_STAT_LEFT], stats[:, cv2.CC_STAT_TOP]
    sw, sh = stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT]
    for l in page["lines"]:
        bx, by, bw, bh = l["box"]
        pad = max(2.0, bh * 0.25)
        char = max(bh, bw / max(1, len(l["text"])))
        erase |= (sx >= bx - pad) & (sy >= by - pad) & (sx + sw <= bx + bw + pad) & (sy + sh <= by + bh + pad) & (np.maximum(sw, sh) <= char * 1.3)
    erase[0] = False
    walls[erase[lab]] = 0


def segment_rooms(walls: np.ndarray, inside: np.ndarray, scale: float) -> np.ndarray:
    """Rooms = free space with door gaps closed (seeds), then grown back over free pixels."""
    gap = max(2, int(round(0.6 * scale)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (gap * 2 + 1, gap * 2 + 1))
    free = ((inside == 1) & (cv2.dilate(walls, k) == 0)).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(free, 4)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 0.5 * scale * scale
    lab[~keep[lab]] = 0
    open_px = (inside == 1) & (walls == 0)
    cross = np.ones((3, 3), np.uint8)
    for _ in range(int(4 * scale)):
        dil = cv2.dilate(lab.astype(np.float32), cross).astype(np.int32)
        fill = (lab == 0) & open_px & (dil > 0)
        if not fill.any():
            break
        lab[fill] = dil[fill]
    return lab


def stair_mask(walls: np.ndarray, inside: np.ndarray, scale: float) -> np.ndarray:
    """Stairs are drawn as dense parallel treads: high dark-pixel density over ~1.2 m windows."""
    win = max(3, int(round(1.2 * scale)))
    density = cv2.blur(walls.astype(np.float32), (win, win))
    m = ((density > 0.24) & (inside == 1)).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    out = np.zeros_like(m)
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if 5 <= a / scale / scale <= 60 and min(w, h) / scale >= 1.8:
            out[lab == i] = 1
    return out


class FloorTrace:
    """One floor page analysed in its own pixel frame."""

    def __init__(self, building: str, floor: str, name: str, page: dict, legend: dict, expect: float | None = None, osm_area: float | None = None):
        """`expect`: scale (px/m) implied by another floor; `osm_area`: footprint (m²) for a 1F estimate."""
        self.floor, self.name, self.legend = floor, name, legend
        walls = dark_mask(f"{ROOT}/{building}/{name}")
        self.page_width = walls.shape[1]
        rough = fill_inside(walls, max(3, walls.shape[1] // 150))
        scale = plan_scale(page, rough)
        if osm_area and rough.sum():
            # The printed dimension must agree with the OSM footprint area, else trust the area.
            by_area = math.sqrt(float(rough.sum()) / osm_area)
            if not scale or not 0.75 < scale / by_area < 1.33:
                scale = by_area
        elif expect and (not scale or not 0.8 < scale / expect < 1.25):
            scale = expect
        if not scale:
            raise ValueError("no overall dimension label")
        self.scale = scale
        erase_text(walls, page)
        self.inside = fill_inside(walls, max(2, int(round(0.9 * scale))))
        self.walls = walls * self.inside
        self.labels = segment_rooms(self.walls, self.inside, scale)
        self.stairs = stair_mask(self.walls, self.inside, scale)
        self.codes: dict[int, list[str]] = {}
        r = int(scale * 0.8)
        # Wing labels ("C1", "C2") disambiguate plans that print "101" for legend code "C1101".
        wings = [(l["text"].strip()[1:], l["box"][0] + l["box"][2] / 2, l["box"][1] + l["box"][3] / 2)
                 for l in page["lines"] if re.fullmatch(r"[A-Z][0-9]", l["text"].strip())]
        for l in page["lines"]:
            bx, by, bw, bh = l["box"]
            for m in CODE_RE.finditer(l["text"]):
                num = m.group(1)
                if num not in legend:
                    tail = [k for k in legend if k.endswith(num) and len(k) == len(num) + 1]
                    if len(tail) > 1 and wings:
                        cxw, cyw = bx + bw / 2, by + bh / 2
                        wing = min(wings, key=lambda w: math.hypot(w[1] - cxw, w[2] - cyw))[0]
                        tail = [k for k in tail if k.startswith(wing)] or tail
                    if not tail:
                        continue
                    num = tail[0]
                frac = (m.start() + m.end()) / 2 / max(1, len(l["text"]))
                cx, cy = int(bx + bw * frac), int(by + bh / 2)
                win = self.labels[max(0, cy - r):cy + r + 1, max(0, cx - r):cx + r + 1]
                vals, counts = np.unique(win[win > 0], return_counts=True)
                if len(vals):
                    lst = self.codes.setdefault(int(vals[np.argmax(counts)]), [])
                    if num not in lst:
                        lst.append(num)

    def grid(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Labels, stair flags and building mask resampled to CELL metres (page origin)."""
        k = CELL * self.scale
        H, W = self.labels.shape
        h, w = int(math.ceil(H / k)), int(math.ceil(W / k))
        lab = np.zeros((h, w), np.int32); st = np.zeros((h, w), np.uint8); ins = np.zeros((h, w), np.uint8)
        for r in range(h):
            y0, y1 = int(r * k), int(min(H, (r + 1) * k))
            for c in range(w):
                x0, x1 = int(c * k), int(min(W, (c + 1) * k))
                if y1 <= y0 or x1 <= x0 or self.inside[y0:y1, x0:x1].mean() <= 0.5:
                    continue
                ins[r, c] = 1
                v = self.labels[y0:y1, x0:x1]
                v = v[v > 0]
                if len(v):
                    vals, counts = np.unique(v, return_counts=True)
                    lab[r, c] = vals[np.argmax(counts)]
                st[r, c] = self.stairs[y0:y1, x0:x1].mean() > 0.4
        return lab, st, ins

    def wall_density(self, x0: float, y0: float, x1: float, y1: float) -> float:
        """Fraction of samples along a page-metre segment with a wall pixel within ±0.25 m."""
        n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 0.1))
        band = max(1, int(round(0.25 * self.scale)))
        H, W = self.walls.shape
        hit = 0
        for i in range(n):
            t = (i + 0.5) / n
            px = int((x0 + (x1 - x0) * t) * self.scale); py = int((y0 + (y1 - y0) * t) * self.scale)
            if not (0 <= px < W and 0 <= py < H):
                continue
            seg = self.walls[max(0, py - band):py + band + 1, px] if y0 == y1 else self.walls[py, max(0, px - band):px + band + 1]
            hit += int(seg.any())
        return hit / n


# ---------------------------------------------------------------------------------------------
# Alignment and registration

def align(ref: np.ndarray, mov: np.ndarray) -> tuple[int, int]:
    """Integer cell offset (dy, dx) that best overlays `mov` on `ref` (FFT cross-correlation)."""
    H = ref.shape[0] + mov.shape[0]; W = ref.shape[1] + mov.shape[1]
    a = np.zeros((H, W), np.float32); b = np.zeros((H, W), np.float32)
    a[:ref.shape[0], :ref.shape[1]] = ref; b[:mov.shape[0], :mov.shape[1]] = mov
    corr = np.fft.irfft2(np.fft.rfft2(a) * np.conj(np.fft.rfft2(b)), s=(H, W))
    dy, dx = np.unravel_index(int(np.argmax(corr)), corr.shape)
    if dy > H // 2: dy -= H
    if dx > W // 2: dx -= W
    return int(dy), int(dx)


def register(mask: np.ndarray, osm_ids: list[int]) -> dict:
    """Plan cells (y down) → world: rotation search + centroid alignment, best IoU with the OSM footprints."""
    rings = [osm_by_id[i]["outer"] for i in osm_ids if i in osm_by_id]
    xs = [v for r in rings for v in r[0::2]]; zs = [v for r in rings for v in r[1::2]]
    res, pad = CELL, 30
    origin = (min(xs) - pad, min(zs) - pad)
    shape = (int((max(zs) - min(zs) + 2 * pad) / res), int((max(xs) - min(xs) + 2 * pad) / res))
    world = np.zeros(shape, np.uint8)
    for r in rings:
        pts = np.array([[(r[i] - origin[0]) / res, (r[i + 1] - origin[1]) / res] for i in range(0, len(r), 2)], np.int32)
        cv2.fillPoly(world, [pts], 1)
    wy, wx = np.nonzero(world)
    wc = np.array([wx.mean(), wy.mean()])
    py, px = np.nonzero(mask)
    pc = np.array([px.mean(), py.mean()])
    pts = np.stack([px - pc[0], py - pc[1]], 1).astype(np.float32)
    best = {"iou": -1.0, "deg": 0, "off": (0, 0)}

    def score(deg: float, ox: float, oy: float) -> float:
        a = math.radians(deg)
        c, s = math.cos(a), math.sin(a)
        q = np.round(pts @ np.array([[c, s], [-s, c]], np.float32) + wc + (ox, oy)).astype(np.int32)
        ok = (q[:, 0] >= 0) & (q[:, 1] >= 0) & (q[:, 0] < shape[1]) & (q[:, 1] < shape[0])
        img = np.zeros(shape, np.uint8)
        img[q[ok, 1], q[ok, 0]] = 1
        img = cv2.morphologyEx(img, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        return int((img & world).sum()) / max(1, int((img | world).sum()))

    for deg in range(0, 360, 2):
        v = score(deg, 0, 0)
        if v > best["iou"]:
            best = {"iou": v, "deg": deg, "off": (0, 0)}
    for deg in np.arange(best["deg"] - 2, best["deg"] + 2.01, 0.5):
        for ox in range(-6, 7, 2):
            for oy in range(-6, 7, 2):
                v = score(float(deg), ox, oy)
                if v > best["iou"]:
                    best = {"iou": v, "deg": float(deg) % 360, "off": (ox, oy)}
    plan_c = (float(pc[0] * CELL), float(pc[1] * CELL))
    world_c = (origin[0] + (wc[0] + best["off"][0]) * res, origin[1] + (wc[1] + best["off"][1]) * res)
    return {"angleDeg": round(best["deg"], 2), "planCentroid": [round(plan_c[0], 3), round(plan_c[1], 3)], "worldCentroid": [round(float(world_c[0]), 3), round(float(world_c[1]), 3)], "iou": round(best["iou"], 3)}


# ---------------------------------------------------------------------------------------------
# Spaces, openings, stairs

def floor_number(label: str) -> list[int] | None:
    """'1F' → [1]; '1-9F' → 1..9; '2-1F' (part 1 of 2F) → [2]; basements and roofs → None."""
    m = re.fullmatch(r"([0-9]+)-([0-9]+)F", label)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return list(range(a, b + 1)) if b > a else [a]
    m = re.fullmatch(r"([0-9]+)F", label)
    return [int(m.group(1))] if m else None


def furnish_for(name: str) -> str | None:
    rules = [("寢室|宿舍|寢", "dorm"), ("教室|講堂|演講", "classroom"), ("會議|討論|研討", "discussion"), ("閱覽|自習|餐廳|用餐|交誼", "reading"),
             ("展|藝廊", "exhibit"), ("書庫", "stacks"), ("研究室|辦公|組|處|室長|主任|中心", "office")]
    for pat, kind in rules:
        if re.search(pat, name):
            return kind
    return None


def merge_cells(mask: np.ndarray) -> list[list[float]]:
    h, w = mask.shape
    used = np.zeros_like(mask, bool)
    out = []
    for r in range(h):
        for c in range(w):
            if used[r, c] or not mask[r, c]:
                continue
            c1 = c
            while c1 < w and mask[r, c1] and not used[r, c1]:
                c1 += 1
            r1 = r + 1
            while r1 < h and mask[r1, c:c1].all() and not used[r1, c:c1].any():
                r1 += 1
            used[r:r1, c:c1] = True
            out.append([c * CELL, r * CELL, c1 * CELL, r1 * CELL])
    return out


def point_in_ring(x: float, z: float, r: list[float]) -> bool:
    inside = False
    n = len(r) // 2
    j = n - 1
    for i in range(n):
        xi, zi, xj, zj = r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def trace_building(building: str, debug: bool) -> dict:
    mapping = json.load(open(f"{ROOT}/plan-buildings.json", encoding="utf8")).get(building, {})
    osm_ids = mapping.get("osm")
    if not osm_ids:
        return {"building": building, "skipped": mapping.get("note", "no OSM mapping")}
    manifest = json.load(open(f"{ROOT}/manifest.json", encoding="utf8"))[building]
    osm = [osm_by_id[i] for i in osm_ids if i in osm_by_id]
    fh = max(b["height"] for b in osm) / max(1, max(b["levels"] for b in osm))
    report: dict = {"building": building, "osm": osm_ids, "floors": {}}

    traces: dict[int, FloorTrace] = {}
    osm_area = sum(abs(sum(b["outer"][2 * i] * b["outer"][(2 * i + 3) % len(b["outer"])] - b["outer"][(2 * i + 2) % len(b["outer"])] * b["outer"][2 * i + 1]
                           for i in range(len(b["outer"]) // 2))) / 2 for b in osm)
    # 1F first: its scale (checked against the OSM area) is the fallback for the other floors.
    order = sorted(manifest.items(), key=lambda kv: 0 if kv[0] == "1F" else 1)
    first: FloorTrace | None = None
    for floor, info in order:
        nums = floor_number(floor)
        if not nums:
            continue
        pages = [(n, load_page(building, n)) for n in info["files"] if os.path.exists(f"{ROOT}/{building}/.ocr/{n}.json")]
        legend = {}
        for _, p in pages:
            if is_legend(p):
                legend.update(parse_legend(p))
        plans = [(n, p) for n, p in pages if not is_legend(p)]
        if not plans:
            report["floors"][floor] = {"error": "no plan page"}
            continue
        n, p = plans[0]
        try:
            if floor == "1F":
                t = FloorTrace(building, floor, n, p, legend, osm_area=osm_area)
                first = t
            else:
                w = Image.open(f"{ROOT}/{building}/{n}").width
                t = FloorTrace(building, floor, n, p, legend, expect=first.scale * w / first.page_width if first else None)
        except ValueError as e:
            report["floors"][floor] = {"error": str(e)}
            continue
        for k in nums:
            traces.setdefault(k, t)
    if 1 not in traces:
        report["error"] = "no usable 1F plan"
        return report

    grids = {k: t.grid() for k, t in traces.items()}
    base_ins = grids[1][2]
    offsets = {k: (0, 0) if k == 1 else align(base_ins.astype(np.float32), g[2].astype(np.float32)) for k, g in grids.items()}
    reg = register(base_ins, osm_ids)
    if mapping.get("transform"):  # manual fix: {angleDeg, planCentroid, worldCentroid} in 1F page cells·CELL
        reg = {**reg, **mapping["transform"], "iou": reg["iou"], "manual": True}
    report["registration"] = reg

    # Shared plan frame: 1F page cells shifted so every floor fits with a margin.
    sy = 2 + max(0, -min(o[0] for o in offsets.values()))
    sx = 2 + max(0, -min(o[1] for o in offsets.values()))
    H = max(g[0].shape[0] + offsets[k][0] for k, g in grids.items()) + sy + 2
    W = max(g[0].shape[1] + offsets[k][1] for k, g in grids.items()) + sx + 2

    def place(arr: np.ndarray, k: int) -> np.ndarray:
        out = np.zeros((H, W), arr.dtype)
        dy, dx = offsets[k][0] + sy, offsets[k][1] + sx
        out[dy:dy + arr.shape[0], dx:dx + arr.shape[1]] = arr
        return out

    ang = math.radians(reg["angleDeg"])
    ca, sa = math.cos(ang), math.sin(ang)
    pcx = reg["planCentroid"][0] + sx * CELL
    pcy = reg["planCentroid"][1] + sy * CELL
    rings = [b["outer"] for b in osm]
    clip = np.zeros((H, W), bool)
    for r in range(H):
        for c in range(W):
            qx, qy = (c + 0.5) * CELL - pcx, (r + 0.5) * CELL - pcy
            wx = qx * ca - qy * sa + reg["worldCentroid"][0]
            wz = qx * sa + qy * ca + reg["worldCentroid"][1]
            clip[r, c] = any(point_in_ring(wx, wz, ring) for ring in rings)

    floors, directory, stair_cells = {}, [], {}
    for k, t in sorted(traces.items()):
        lab = place(grids[k][0], k)
        st = place(grids[k][1], k)
        lab[~clip] = 0
        st[~clip] = 0
        stair_cells[k] = st
        dy, dx = offsets[k][0] + sy, offsets[k][1] + sx

        def to_page(x: float, y: float, dx: int = dx, dy: int = dy) -> tuple[float, float]:
            return x - dx * CELL, y - dy * CELL

        info = {}
        for i in (int(v) for v in np.unique(lab) if v):
            cells = lab == i
            area = float(cells.sum()) * CELL * CELL
            if area < 1.5:
                lab[cells] = 0
                continue
            ys, xs = np.nonzero(cells)
            w_, h_ = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
            info[i] = {"area": area, "codes": t.codes.get(i, []), "aspect": max(w_, h_) / max(1, min(w_, h_))}
        adj: dict[int, set] = {i: set() for i in info}
        for a, b in ((lab[:, :-1], lab[:, 1:]), (lab[:-1, :], lab[1:, :])):
            m = (a != b) & (a > 0) & (b > 0)
            for x, y in zip(a[m], b[m]):
                if int(x) in adj and int(y) in adj:
                    adj[int(x)].add(int(y)); adj[int(y)].add(int(x))
        circ = {i for i, f in info.items() if not f["codes"] and ((f["area"] > 25 and len(adj[i]) >= 3) or (f["aspect"] > 3.5 and f["area"] > 10))}
        spaces, named = [], []
        ceiling = round(fh - 0.3, 2)
        for i, f in sorted(info.items()):
            rects = merge_cells(lab == i)
            if i in circ:
                corridor = f["aspect"] > 3.5
                sp = {"id": f"{k}F-c{i}", "name": "走廊" if corridor else "大廳", "kind": "corridor" if corridor else "lobby", "ceiling": ceiling, "group": "circ", "rects": rects}
            else:
                code = f["codes"][0] if f["codes"] else None
                leg = t.legend.get(code) if code else None
                name = leg["name"] if leg and leg["name"] else ("儲藏室" if f["area"] < 12 else "空間")
                kind = "toilet" if "廁" in name else "room"
                sp = {"id": f"{k}F-{code or i}", "name": name, "kind": kind, "ceiling": ceiling, "rects": rects}
                if leg:
                    sp["code"] = leg["code"]
                    if leg.get("area"):
                        sp["legendArea"] = leg["area"]
                fk = furnish_for(name) if kind == "room" else None
                if fk:
                    sp["furnish"] = fk
                named.append(name)
            spaces.append(sp)

        # Openings: along every boundary between different spaces (or the outside), runs of cells
        # whose drawn wall is missing become doors / open passages / exits (ground floor only).
        openings = []
        for horizontal in (True, False):
            a = lab[:-1, :] if horizontal else lab[:, :-1]
            b = lab[1:, :] if horizontal else lab[:, 1:]
            runs: dict = {}
            for r, c in zip(*np.nonzero(a != b)):
                va, vb = int(a[r, c]), int(b[r, c])
                if (va in circ and vb in circ) or (va not in info and va) or (vb not in info and vb):
                    continue
                if horizontal:
                    at, pos = (r + 1) * CELL, c * CELL
                    seg = (pos, at, pos + CELL, at)
                else:
                    at, pos = (c + 1) * CELL, r * CELL
                    seg = (at, pos, at, pos + CELL)
                p0, p1 = to_page(seg[0], seg[1]), to_page(seg[2], seg[3])
                is_open = t.wall_density(p0[0], p0[1], p1[0], p1[1]) < 0.35
                runs.setdefault((at, min(va, vb), max(va, vb)), []).append((pos, is_open))
            for (at, va, vb), cells in runs.items():
                cells.sort()
                run: list[float] = []

                def flush() -> None:
                    if not run:
                        return
                    a0, a1 = run[0], run[-1] + CELL
                    outside = va == 0 or vb == 0
                    if a1 - a0 < 0.5 or (outside and k != 1):
                        return
                    kind = "exit" if outside else ("open" if a1 - a0 > 2.4 else "door")
                    if kind != "open" and a1 - a0 > 1.6:
                        mid = (a0 + a1) / 2
                        a0, a1 = mid - 0.8, mid + 0.8
                    pa, pb = ([a0, at], [a1, at]) if horizontal else ([at, a0], [at, a1])
                    openings.append({"kind": kind, "a": pa, "b": pb})

                prev = None
                for pos, op in cells:
                    if op and run and prev is not None and abs(pos - prev - CELL) < 1e-6:
                        run.append(pos)
                    else:
                        flush()
                        run = [pos] if op else []
                    prev = pos
                flush()

        floors[f"{k}F"] = {"bandTop": round(fh, 3), "spaces": spaces, "openings": openings, "signs": []}
        directory.append({"level": f"{k}F", "items": sorted(set(n for n in named if n not in ("空間", "儲藏室")))[:4]})
        report["floors"][f"{k}F"] = {"page": t.name, "scale": round(t.scale, 2), "offset": list(offsets[k]), "rooms": len(spaces) - len(circ),
                                     "coded": sum(1 for i in info if info[i]["codes"]), "legend": len(t.legend), "openings": len(openings)}
        if debug:
            write_debug(building, k, lab, st, openings)

    max_floor = max(traces)
    source = {
        "id": f"plan-{osm_ids[0]}",
        "name": building,
        "sources": "總務處校舍平面圖（自動描繪 scripts/floorplan/trace.py）",
        "osmReplaces": [],
        "osmIds": osm_ids,
        "transform": {"angleDeg": reg["angleDeg"], "planCentroid": [round(pcx, 3), round(pcy, 3)], "worldCentroid": reg["worldCentroid"]},
        "floorHeight": round(fh, 3),
        "levels": [{"id": f"{k}F", "elevation": round((k - 1) * fh, 3), "built": k in traces, "elevator": k in traces} for k in range(1, max_floor + 1)],
        "shell": {},
        "floors": floors,
        "directory": directory,
    }
    report["stairs"] = add_stairs(source, stair_cells, fh)
    add_elevators(source)
    accepted = reg.get("manual") or reg["iou"] >= MIN_IOU
    report["accepted"] = bool(accepted)
    out = f"{ROOT}/{building}/traced.source.json"
    rejected = f"{ROOT}/{building}/traced.rejected.json"
    for stale in (out, rejected):
        if os.path.exists(stale):
            os.remove(stale)
    json.dump(source, open(out if accepted else rejected, "w", encoding="utf8"), ensure_ascii=False)
    json.dump(report, open(f"{ROOT}/{building}/traced.report.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    return report


def add_stairs(source: dict, stair_cells: dict, fh: float) -> int:
    """Switchback flights inside stair regions that line up on consecutive floors."""
    stairs, landings = [], []
    floors = source["floors"]
    count = 0
    for k in sorted(stair_cells):
        if k + 1 not in stair_cells or f"{k}F" not in floors or f"{k + 1}F" not in floors:
            continue
        both = ((stair_cells[k] > 0) & (stair_cells[k + 1] > 0)).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(both, 4)
        for i in range(1, n):
            x, y, w, h, _a = stats[i]
            Wm, Hm = w * CELL, h * CELL
            if min(Wm, Hm) < 2.4 or max(Wm, Hm) < 4.4:
                continue
            x0, y0 = x * CELL, y * CELL
            along_x = Wm > Hm
            long, short = (Wm, Hm) if along_x else (Hm, Wm)
            landing = 1.2
            run = long - 2 * landing
            if run < 2.0 or math.degrees(math.atan2(fh / 2, run)) > 42:
                continue
            fw = min(1.6, short / 2 - 0.05)
            low = round((k - 1) * fh, 3)
            mid, high = round(low + fh / 2, 3), round(low + fh, 3)
            sid = f"s{k}-{i}"
            if along_x:
                stairs.append({"id": f"{sid}a", "name": "樓梯", "rect": [x0 + landing, y0, x0 + landing + run, y0 + fw], "axis": "x", "up": "+", "low": low, "high": mid})
                stairs.append({"id": f"{sid}b", "name": "樓梯", "rect": [x0 + landing, y0 + short - fw, x0 + landing + run, y0 + short], "axis": "x", "up": "-", "low": mid, "high": high})
                near, far = [x0, y0, x0 + landing, y0 + short], [x0 + landing + run, y0, x0 + long, y0 + short]
                core = [x0, y0, x0 + long, y0 + short]
            else:
                stairs.append({"id": f"{sid}a", "name": "樓梯", "rect": [x0, y0 + landing, x0 + fw, y0 + landing + run], "axis": "y", "up": "+", "low": low, "high": mid})
                stairs.append({"id": f"{sid}b", "name": "樓梯", "rect": [x0 + short - fw, y0 + landing, x0 + short, y0 + landing + run], "axis": "y", "up": "-", "low": mid, "high": high})
                near, far = [x0, y0, x0 + short, y0 + landing], [x0, y0 + landing + run, x0 + short, y0 + long]
                core = [x0, y0, x0 + short, y0 + long]
            landings += [{"rect": near, "elevation": low}, {"rect": far, "elevation": mid}, {"rect": near, "elevation": high}]
            carve(floors[f"{k}F"], core, sid, True)
            carve(floors[f"{k + 1}F"], core, sid, False)
            count += 1
    source["stairs"] = stairs
    source["landings"] = landings
    return count


def carve(floor: dict, rect: list[float], sid: str, open_above: bool) -> None:
    """Cut `rect` out of every space and add it as a stair space, open on all four sides."""
    x0, y0, x1, y1 = rect
    for sp in floor["spaces"]:
        out = []
        for a, b, c, d in sp["rects"]:
            if c <= x0 or a >= x1 or d <= y0 or b >= y1:
                out.append([a, b, c, d])
                continue
            if a < x0: out.append([a, b, x0, d])
            if c > x1: out.append([x1, b, c, d])
            ia, ic = max(a, x0), min(c, x1)
            if b < y0: out.append([ia, b, ic, y0])
            if d > y1: out.append([ia, y1, ic, d])
        sp["rects"] = out
    floor["spaces"] = [sp for sp in floor["spaces"] if sp["rects"]]
    name = f"stair-{sid}"
    existing = next((sp for sp in floor["spaces"] if sp["id"] == name), None)
    if existing:
        if open_above:
            existing["noCeiling"] = True
    else:
        sp = {"id": name, "name": "樓梯", "kind": "stair", "ceiling": 3, "rects": [rect]}
        if open_above:
            sp["noCeiling"] = True
        floor["spaces"].append(sp)
    floor["openings"] = [o for o in floor["openings"] if not (x0 - 0.01 <= (o["a"][0] + o["b"][0]) / 2 <= x1 + 0.01 and y0 - 0.01 <= (o["a"][1] + o["b"][1]) / 2 <= y1 + 0.01)]
    for a, b in (([x0, y0], [x1, y0]), ([x0, y1], [x1, y1]), ([x0, y0], [x0, y1]), ([x1, y0], [x1, y1])):
        floor["openings"].append({"kind": "open", "a": a, "b": b})


def add_elevators(source: dict) -> None:
    """Elevator call point on every floor: beside the first stair core (or in the largest
    circulation space), so every traced floor is reachable even where no stair was recognised."""
    stair = source["stairs"][0]["rect"] if source.get("stairs") else None
    for fid, fl in source["floors"].items():
        circ = [sp for sp in fl["spaces"] if sp.get("group") == "circ"]
        target = None
        if stair:
            cx, cy = (stair[0] + stair[2]) / 2, (stair[1] + stair[3]) / 2
            best = None
            for sp in circ:
                for r in sp["rects"]:
                    px, py = min(max(cx, r[0] + 0.6), r[2] - 0.6), min(max(cy, r[1] + 0.6), r[3] - 0.6)
                    d = math.hypot(px - cx, py - cy)
                    if r[2] - r[0] >= 1.2 and r[3] - r[1] >= 1.2 and (best is None or d < best[0]):
                        best = (d, px, py)
            if best:
                target = (best[1], best[2])
        if target is None:
            rects = [r for sp in circ for r in sp["rects"]] or [r for sp in fl["spaces"] if sp["kind"] != "stair" for r in sp["rects"]]
            if not rects:
                continue
            r = max(rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
            target = ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
        fl["elevator"] = {"landing": [round(target[0], 2), round(target[1], 2)], "facing": [0, 1]}


def write_debug(building: str, k: int, lab: np.ndarray, st: np.ndarray, openings: list) -> None:
    S = 12
    rng = np.random.default_rng(3)
    col = rng.integers(70, 240, (int(lab.max()) + 1, 3), dtype=np.uint8)
    col[0] = (255, 255, 255)
    img = np.ascontiguousarray(np.kron(col[lab], np.ones((S, S, 1), np.uint8)))
    img[np.kron(st, np.ones((S, S), np.uint8)) > 0] //= 2
    for o in openings:
        colr = {"door": (0, 90, 255), "open": (0, 170, 0), "exit": (230, 0, 0)}.get(o["kind"], (0, 0, 0))
        cv2.line(img, (int(o["a"][0] / CELL * S), int(o["a"][1] / CELL * S)), (int(o["b"][0] / CELL * S), int(o["b"][1] / CELL * S)), colr, 3)
    Image.fromarray(img).save(f"{ROOT}/{building}/.ocr/traced-{k}F.png")


def main() -> None:
    debug = "--debug" in sys.argv
    names = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--all" in sys.argv:
        names = list(json.load(open(f"{ROOT}/manifest.json", encoding="utf8")))
    for b in names:
        try:
            r = trace_building(b, debug)
        except Exception as e:  # keep going across buildings; the report says what failed
            import traceback
            traceback.print_exc()
            r = {"building": b, "error": f"{type(e).__name__}: {e}"}
        if r.get("skipped"):
            print(f"{b}: skipped ({r['skipped']})")
        elif r.get("error"):
            print(f"{b}: ERROR {r['error']}")
        else:
            fl = " ".join(f"{k}:{v.get('rooms', '!')}/{v.get('coded', '')}" for k, v in r["floors"].items())
            mark = "OK " if r.get("accepted") else "-- "
            print(f"{mark}{b}: IoU {r['registration']['iou']}, angle {r['registration']['angleDeg']}, stairs {r['stairs']}, floors {fl}")


if __name__ == "__main__":
    main()
