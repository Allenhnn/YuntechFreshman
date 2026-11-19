"""
Review image for a traced building: its OSM footprints (grey, with ids) and the traced rooms of
each floor (coloured, translucent) in world space, plus the plan's 1F page for comparison.

  python3 scripts/floorplan/overlay.py <building> [floor ...]
Writes assets-src/floorplans/<building>/.ocr/overlay.png (gitignored).
"""
import json
import math
import os
import sys

import cv2
import numpy as np

ROOT = "assets-src/floorplans"
PX = 4  # pixels per metre


def main() -> None:
    building = sys.argv[1]
    floors = sys.argv[2:] or ["1F"]
    path = f"{ROOT}/{building}/traced.source.json"
    if not os.path.exists(path):
        path = f"{ROOT}/{building}/traced.rejected.json"
    src = json.load(open(path, encoding="utf8"))
    campus = json.load(open("public/data/campus.json", encoding="utf8"))
    osm = [b for b in campus["buildings"] if b["id"] in src["osmIds"]]
    t = src["transform"]
    a = math.radians(t["angleDeg"])
    c, s = math.cos(a), math.sin(a)

    def to_world(x: float, y: float) -> tuple[float, float]:
        qx, qy = x - t["planCentroid"][0], y - t["planCentroid"][1]
        return qx * c - qy * s + t["worldCentroid"][0], qx * s + qy * c + t["worldCentroid"][1]

    pts = [(r[i], r[i + 1]) for b in osm for r in [b["outer"]] for i in range(0, len(r), 2)]
    for f in floors:
        for sp in src["floors"].get(f, {}).get("spaces", []):
            for x0, y0, x1, y1 in sp["rects"]:
                pts += [to_world(x0, y0), to_world(x1, y1)]
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    ox, oz = min(xs) - 10, min(zs) - 10
    W, H = int((max(xs) - ox + 10) * PX), int((max(zs) - oz + 10) * PX)
    img = np.full((H, W, 3), 255, np.uint8)
    P = lambda x, z: (int((x - ox) * PX), int((z - oz) * PX))
    for b in osm:
        r = b["outer"]
        poly = np.array([P(r[i], r[i + 1]) for i in range(0, len(r), 2)], np.int32)
        cv2.fillPoly(img, [poly], (215, 215, 215))
        cv2.polylines(img, [poly], True, (90, 90, 90), 2)
        cx, cz = np.mean(poly[:, 0]), np.mean(poly[:, 1])
        cv2.putText(img, str(b["id"])[-3:], (int(cx) - 20, int(cz)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    colours = [(230, 80, 60), (60, 120, 230), (60, 170, 60), (200, 120, 0), (150, 60, 200)]
    for k, f in enumerate(floors):
        layer = img.copy()
        for sp in src["floors"].get(f, {}).get("spaces", []):
            col = colours[k % len(colours)] if sp.get("group") != "circ" else (120, 120, 120)
            for x0, y0, x1, y1 in sp["rects"]:
                quad = np.array([P(*to_world(x0, y0)), P(*to_world(x1, y0)), P(*to_world(x1, y1)), P(*to_world(x0, y1))], np.int32)
                cv2.fillPoly(layer, [quad], col)
        img = cv2.addWeighted(layer, 0.45, img, 0.55, 0)
    # North up: world -z is north, which is up in this image already.
    cv2.putText(img, f"{building} {' '.join(floors)} angle {t['angleDeg']}", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.imwrite(f"{ROOT}/{building}/.ocr/overlay.png", img)
    print(f"{ROOT}/{building}/.ocr/overlay.png", img.shape)


if __name__ == "__main__":
    main()
