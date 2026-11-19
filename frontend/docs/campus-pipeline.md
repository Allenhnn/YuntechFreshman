# 校園場景管線（OpenStreetMap → 遊戲）

## 資料來源與授權
- 建築輪廓、名稱、道路、步道、球場：OpenStreetMap（ODbL）。畫面上必須顯示「© OpenStreetMap contributors」（已放在小地圖下方、全螢幕地圖與主選單）。
- 範圍：OSM relation 9348317（國立雲林科技大學）外加 150 m 周邊街區。
- 座標：以校園中心（23.6924°N, 120.5341°E）為原點的局部公尺座標，+X 東、+Z 南、Y 向上。

## 指令

```bash
# 重新下載 OSM 資料並轉換（Overpass 忙碌時會自動退避重試、切換鏡像站）
npm run campus:fetch

# 只用已下載的 assets-src/campus/osm-raw.json 重新轉換（例如改了樓高設定後）
npm run campus:fetch -- --offline
```

輸出：`public/data/campus.json`（約 50 KB）。

## 樓高
OSM 幾乎沒有樓高資料，優先順序為：
1. OSM `height` 標籤
2. OSM `building:levels` 標籤
3. `assets-src/campus/height-overrides.json`（以建築名稱指定樓層數，例如 `{ "行政大樓": 5 }`）
4. 預設：教學館 / 大樓 5 層、宿舍 7 層、餐廳 / 活動中心 3 層、警衛室 1 層、校外透天 2–3 層；每層 3.6 m

知道實際樓層後，填進 overrides 再跑 `--offline` 即可。

## 執行期架構
- `src/campus/campusWorker.ts`：Web Worker（Comlink）依 256 m 區塊產生幾何，緩衝區以 Transferable 移交主線程（零拷貝）。
- `src/campus/campusWorld.ts`：依玩家位置串流區塊（600 m 載入、760 m 卸載並 dispose）；建築碰撞只在玩家 60 m 內建立。
- 碰撞（B2 簡化）：建築外牆 + 屋頂為靜態 trimesh；地面為平坦 heightfield（可日後填入真實 DEM）。樹木、球場、路緣不擋人。
- 樹木：OSM 無樹木資料，於綠地程序化散佈；220 m 外切換低模、關閉陰影。

## 之後替換地標（實景掃描）
1. 用手機（Polycam / RealityCapture）掃描地標建築，輸出 `.glb`。
2. `npm run assets:optimize -- assets-src/landmarks/圖書館.glb public/models/landmarks/圖書館.glb`
3. 在資料中把該建築標記為以模型取代（待實作：依名稱跳過程序化外牆、改載入 GLB 並沿用輪廓碰撞）。
