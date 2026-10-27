"""
Downloads the 總務處 floor-plan scans for every building listed on
https://ags.yuntech.edu.tw/index.php/2020-03-05-08-14-25/2021-07-28-06-30-36/item/681-1

  python3 scripts/floorplan/download_plans.py            # everything not yet on disk
  python3 scripts/floorplan/download_plans.py --list     # print the parsed index only

Files land in assets-src/floorplans/<building>/<floor>_<original name>.jpg (gitignored);
assets-src/floorplans/manifest.json records building → floors → files (committed).
Requests are spaced out so the university server is not hammered.
"""
import html
import json
import os
import re
import sys
import subprocess
import time

INDEX = "https://ags.yuntech.edu.tw/index.php/2020-03-05-08-14-25/2021-07-28-06-30-36/item/681-1"
HOST = "https://ags.yuntech.edu.tw"
OUT = "assets-src/floorplans"
SKIP = {"圖書館"}  # already traced by hand
DELAY = 0.4


def fetch(url: str) -> bytes:
    # curl rather than urllib: Python 3.14's stricter X.509 checks reject the school's certificate
    # (missing Subject Key Identifier) that the system trust store accepts. Verification stays on.
    return subprocess.run(
        ["curl", "-sSfL", "--max-time", "60", "-A", "YuntechFreshMan-dev/0.1 (floor-plan study)", url],
        check=True, capture_output=True,
    ).stdout


def text(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def parse_index(page: str) -> list[dict]:
    """Rows of the plan tables: first cell = building name, links in the other cells (title = floor)."""
    out = []
    for table in re.findall(r'<table class="table YSpecialTable".*?</table>', page, re.S):
        for row in re.findall(r"<tr>(.*?)</tr>", table, re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if len(cells) < 2:
                continue
            name = text(cells[0])
            # Some rows are "college | building | links": the building is the last plain-text cell.
            plain = [text(c) for c in cells if "item/" not in c and text(c)]
            if plain:
                name = plain[-1]
            links = []
            for cell in cells:
                # Floor = the link's title, else its text ("1-9", "屋頂"); some links have no title.
                for attrs, inner in re.findall(r"<a([^>]*href=\"[^\"]*item/[^\"]+\"[^>]*)>(.*?)</a>", cell, re.S):
                    href = re.search(r'href="([^"]+)"', attrs).group(1)
                    title = re.search(r'title="([^"]*)"', attrs)
                    label = (title.group(1) if title and title.group(1) not in ("", "下載") else text(inner)) or "plan"
                    links.append({"floor": label, "url": HOST + href if href.startswith("/") else href})
            if name and links:
                out.append({"building": name, "plans": links})
    return out


def floor_label(raw: str) -> str:
    """'1' → '1F', 'B1' → 'B1', '頂樓' stays, '下載' → 'plan'."""
    raw = raw.replace("下載", "plan").strip()
    if re.fullmatch(r"\d+(-\d+)?", raw):
        return raw + "F"
    return raw or "plan"


def main() -> None:
    page = fetch(INDEX).decode("utf-8", "replace")
    index = parse_index(page)
    if "--list" in sys.argv:
        for b in index:
            print(b["building"], [p["floor"] for p in b["plans"]])
        return
    manifest_path = f"{OUT}/manifest.json"
    manifest = json.load(open(manifest_path, encoding="utf8")) if os.path.exists(manifest_path) else {}
    total = 0
    for b in index:
        name = b["building"].replace("/", "／")
        if name in SKIP:
            continue
        os.makedirs(f"{OUT}/{name}", exist_ok=True)
        floors = manifest.setdefault(name, {})
        for p in b["plans"]:
            label = floor_label(p["floor"])
            if label in floors and all(os.path.exists(f"{OUT}/{name}/{f}") for f in floors[label]["files"]):
                continue
            time.sleep(DELAY)
            item = fetch(p["url"]).decode("utf-8", "replace")
            images = list(dict.fromkeys(re.findall(r'src="(/images/AGM/map/[^"]+\.(?:jpg|jpeg|png))"', item, re.I)))
            files = []
            for src in images:
                time.sleep(DELAY)
                data = fetch(HOST + src)
                if not data.startswith(b"\xff\xd8") and not data.startswith(b"\x89PNG"):
                    print(f"  ! {name} {label}: {src} is not an image, skipped")
                    continue
                fname = f"{label}_{os.path.basename(src)}"
                with open(f"{OUT}/{name}/{fname}", "wb") as f:
                    f.write(data)
                files.append(fname)
                total += len(data)
            floors[label] = {"page": p["url"], "files": files}
            print(f"  {name} {label}: {len(files)} image(s)")
        with open(manifest_path, "w", encoding="utf8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"done, {total / 1e6:.1f} MB downloaded")


if __name__ == "__main__":
    main()
