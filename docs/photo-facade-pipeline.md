# Campus exteriors from your own photos: capture guide and pipeline proposal

Status: **proposal, waiting for your decisions** (see "Decisions" at the end). Nothing here is implemented yet.

## 1. Capture guide

### Equipment and settings
- Any phone camera. Use the **main 1× lens**, not ultra-wide, because it has less distortion and makes rectification easier.
- Turn HDR off, or leave it on auto. Turn off portrait and beauty modes, and do not apply filters.
- Shoot at the highest resolution. JPG/HEIC is fine. Keep GPS location **on**, because the EXIF coordinates are used to match photos to buildings automatically.
- Weather: an **overcast day** or soft light is best, since it gives no hard shadows or blown highlights. Avoid early morning and evening, when the light is strongly coloured. If it is sunny, shoot facades while they are in shade.

### Shots per building (a typical 4-sided building)
| Shot | Count | How |
|---|---|---|
| Full facade, square-on | 1 per side (4) | Stand back until the whole side fits and **face the wall squarely**. Keep the phone level, without tilting up or down. Leave a little margin around the edges. |
| Facade in sections (long or tall buildings) | 2–6 per side | Move sideways and keep facing the wall. Neighbouring shots should **overlap by about 30%**. |
| Ground-floor detail | 1–3 | Entrance, signage, columns. Shoot square-on from 3–5 m. |
| Corner shots | 4 | Diagonal views showing two sides at once. Used to check the massing and roof edges. |
| Material close-ups | 2–4 | Tiles, paint, glass, railings. Shoot square-on from about 1 m. These become tileable materials. |

- Avoid people, cars and trees blocking the view where you can. If you cannot, take one extra shot from a slightly different position.
- About **12–20 shots per building** in total.

### Landmarks (optional, only if we choose photogrammetry)
- Walk a full circle around the object and take a shot every 10–15°, in two height rings: one at eye level and one held up high. That gives **60–120 shots**.
- Suitable for compact objects only: the school gate, the 司令台, sculptures, the 觀雲閣 tower top.

### Folder layout (create it, then drop the photos in)
```
assets-src/photos/
  圖書館/originals/        ← your original photos (gitignored)
  行政大樓/originals/
  …
```
Use the folder names from the list below; they match the OSM names. **Originals are not committed.** Only the processed, compressed textures go into Git.

### Suggested first batch (along the main walking route from the spawn point)
1. 校門 / 警衛室 (大學路 gate)
2. 行政大樓
3. 圖書館 (interior already done)
4. 國際會議廳 / 雲泰表演廳
5. 學生活動中心
6. 學生餐廳
7. 觀雲閣 (tallest, the visual landmark)
8. 工程一館 / 管理一館 / 設計一館 (one per college, used as a style reference for the others)

## 2. Pipeline options

### Option A: rectified facade textures on the existing OSM extrusions (recommended)
1. `npm run photos:ingest` reads EXIF GPS and compass heading, matches each photo to the nearest building and facade edge, and writes a `facades.json` stub for you to adjust.
2. A rectification tool runs in the browser at `/tools/facade.html`. You click the four corners of the wall in a photo. A homography rectifies it to the real wall size, taken from the OSM edge length and the floor count × floor height. Neighbouring sections are stitched.
3. Output: one texture atlas per building, encoded as KTX2/BasisU at **1024–2048 px per side** (about 5–10 cm per pixel). Each wall gets its UVs. The ground floor and the upper floors are kept separate so that tall buildings can use **repeated floor bands** and save texture memory.
4. Runtime: the chunk worker assigns UVs to the matching walls and the main thread loads the atlas per chunk, which is disposed together with the chunk. Untextured buildings keep the current procedural material.
- Effort: medium. Fidelity: high from a distance, flat up close (no relief).
- Memory estimate: 30 buildings × ~1.5 MB KTX2 ≈ 45 MB of downloads, streamed per chunk.

### Option B: photogrammetry (RealityScan / Polycam, free) for landmarks only
- You shoot 60–120 photos per object and process them in the app. I then clean up the GLB, reduce it to about 30k triangles, compress it with Draco and KTX2, and place it to replace the OSM block.
- Effort: high per object. Fidelity: best. Only suitable for a handful of objects.

### Option C: photo-sampled procedural facades
- Each building needs only 2–3 photos. I extract the wall colour, window grid (spacing, proportions), window colour and ground-floor style, then generate the facade procedurally in the shader.
- Effort: low, and covers all 100 buildings quickly. Fidelity: looks right in style but is not the real image.

**Recommendation:** use C as the baseline for all buildings, A for the buildings along the main route (first batch), and B for 1–3 landmarks.

## 3. Decisions needed
1. Which approach or combination: A / B / C / A+B+C.
2. Which buildings go in the first batch (the list above, or your own).
3. Whether to build the four-corner rectification tool in the browser (A), or rectify photos yourself in another app (Photoshop, Snapseed perspective) and upload finished, squared-up images.
