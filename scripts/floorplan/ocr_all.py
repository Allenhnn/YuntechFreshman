"""
OCR every downloaded floor-plan image (Apple Vision via scripts/floorplan/.ocr) and cache the
result next to it: assets-src/floorplans/<building>/.ocr/<image>.json (gitignored, derived).
Small scans are upscaled 3x first so room codes become legible; boxes are mapped back to the
original pixels.

  swiftc -O scripts/floorplan/ocr.swift -o scripts/floorplan/.ocr
  python3 scripts/floorplan/ocr_all.py [building ...]
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = "assets-src/floorplans"
OCR = "scripts/floorplan/.ocr"
UPSCALE_BELOW = 1200


def main() -> None:
    manifest = json.load(open(f"{ROOT}/manifest.json", encoding="utf8"))
    wanted = set(sys.argv[1:])
    tmp = tempfile.mkdtemp(prefix="ocr-")
    done = 0
    for building, floors in manifest.items():
        if wanted and building not in wanted:
            continue
        os.makedirs(f"{ROOT}/{building}/.ocr", exist_ok=True)
        for info in floors.values():
            for name in info["files"]:
                out = f"{ROOT}/{building}/.ocr/{name}.json"
                if os.path.exists(out):
                    continue
                src = f"{ROOT}/{building}/{name}"
                im = Image.open(src).convert("RGB")
                k = 3 if im.width < UPSCALE_BELOW else 1
                path = src
                if k > 1:
                    path = os.path.join(tmp, "up.png")
                    im.resize((im.width * k, im.height * k), Image.LANCZOS).save(path)
                line = subprocess.run([OCR, path], check=True, capture_output=True, text=True).stdout.strip()
                page = json.loads(line)
                for l in page["lines"]:
                    l["box"] = [round(v / k, 1) for v in l["box"]]
                page.update(file=name, width=im.width, height=im.height, upscale=k)
                json.dump(page, open(out, "w", encoding="utf8"), ensure_ascii=False)
                done += 1
                print(f"  {building} {name}: {len(page['lines'])} lines", flush=True)
    print(f"done, {done} images")


if __name__ == "__main__":
    main()
