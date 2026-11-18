# 程式碼審查證據：雲泰表演廳外觀（`src/buildings/yuntayExterior.ts`）

| 項目 | 內容 |
| --- | --- |
| 審查的功能 | **雲泰表演廳外觀產生器**：遊戲載入時用程式把這棟建築的外觀蓋出來（弧形觀眾廳量體、舞台塔、柱廊與台階、路燈、A 門門框、立牌），並為柱廊、台階、立柱建立碰撞體。已在遊戲中執行（見 §3.6）。 |
| 修改前版本 | `b50ad27`（`git show b50ad27:src/buildings/yuntayExterior.ts`，314 行） |
| 修改後版本 | 分支 `refactor/yuntay-exterior-review`（429 行）；另改 `src/buildings/planTransform.ts` 一行型別 |
| 審查原則 | **只改可讀性與可維護性，不改輸出**：前後產生的網格、碰撞體、貼圖繪製呼叫必須完全相同（§3 逐項證明） |
| 證據檔案 | `docs/code-review/` 下的 `fingerprint-*.txt`、`branches-*.txt`、`metrics-*.txt`、`negative-controls.txt`；產生它們的腳本在 `scripts/` |

## 0. 結果摘要

| # | 審查意見（一句話） | 位置（修改前） | 修改後 |
| --- | --- | --- | --- |
| F1 | 一個 200 行的函式混了 5 個建築部位，區域變數同名異義 | `createYuntayExterior` L114–313 | 拆成 `createContext` + 5 個 `add…`，進入點只剩 8 行 |
| F2 | 台階高度在 3 個地方各寫一次，改一處就會讓視覺與碰撞脫節 | L195–200、L214 | 一張 `TIERS` 表，網格與碰撞都由它產生 |
| F3 | 134 個魔術數字；同一個數字代表不同東西 | 整個函式 | 具名常數表，48 個（多為畫布像素） |
| F4 | `as unknown as` 雙重轉型重複兩次，繞過型別檢查 | L106、L115 | 放寬 `createPlanTransform` 的參數型別，只剩一次普通 `as` |
| F5 | `solid(x, y, z, hw, hh, hd, yaw)` 七個位置參數，`y` 與 `hh` 必須人工保持一致 | L126 與 5 個呼叫點 | `solid(x, z, { y0, height, hw, hd, yaw })` |
| F6 | 沒人用的參數、重複的收尾程式碼、同一顏色寫兩次、無謂的 `!` | `ribbon`、`annulus`、材質區 | 各自合併或移除 |

量化對照（`scripts/code-metrics.ts`，詳見 §3.5）：最長函式 **200 → 71 行**；`as unknown as` **2 → 0**；`!` 非空斷言 **7 → 0**；函式內魔術數字 **134 → 48**；階梯高度的修改點 **6 行 8 處 → 1 個常數**。行為驗證：**59 個網格、220 個碰撞體、36 次畫布繪製呼叫的指紋前後完全相同**；刻意破壞 4 處時，指紋都會改變（§3.4）。

---

## 1. 審查意見

每一項都寫出：功能名稱、檔案／方法、審查者實際遇到的困難。行號是修改前版本（`b50ad27`）的行號。

### F1 一個函式做了五件事，區域變數同名異義

- **功能**：雲泰表演廳外觀產生器 → 組裝流程。
- **檔案／方法**：`src/buildings/yuntayExterior.ts` → `createYuntayExterior()`，L114–L313，共 **200 行**。
- **審查者遇到的困難**：
  1. 想確認「路燈每幾根柱子出現一次」，要從 L114 一路捲到 L235（`if (i % 3 !== 1) continue;`），中間經過觀眾廳、舞台塔、台階、雨遮四個無關區段，沒有任何函式名稱可以跳轉。
  2. 區塊 `{ … }` 之間重複使用同名變數，意思卻不同：`top` 在 L184 是舞台塔頂面的**材質**、在 L214 是台階的**頂面高度**、在 L253 是門框的**高度 6.8 m**；`x0, y0, x1, y1` 在 L181（舞台塔）與 L252（門框）各宣告一次；`cy` 是平面 y 座標（對應 3D 的 z），讀起來卻像「垂直中心」。
  3. 這個函式同時管理 Group、碰撞體、材質、貼圖與 5 個建築部位，任何一處修改都得在這 200 行裡確認沒有影響到其他區塊的局部變數。

### F2 台階高度重複定義三次

- **功能**：柱廊的抬高步道與兩級台階。
- **檔案／方法**：`createYuntayExterior()` 內 L195–L200（三個踏面 `annulus`、三個立面 `ribbon`）與 L214（碰撞體迴圈）。
- **審查者遇到的困難**：台階的三個高度 `FLOOR`、`FLOOR - 0.15`、`FLOOR - 0.3` 以字面值寫在 **6 行、8 處**。要把每級落差從 0.15 改成 0.2，必須同時找到這 8 處；漏掉碰撞體那一處，畫面上的台階與玩家實際踩到的高度就不一致（人會浮在台階上或陷進去），而且**不會有任何錯誤訊息**。審查者無法從程式碼直接看出「立面的下緣就是下一級的頂面」這個關係。

### F3 魔術數字：同一個數字代表不同東西

- **功能**：路燈、簷帶、舞台塔頂蓋、柱廊尺寸。
- **檔案／方法**：整個 `createYuntayExterior()`；`scripts/code-metrics.ts` 統計出函式內有 **134 個**非 0/1/2 的數字字面值（66 種不同的值）。
- **審查者遇到的困難**：
  - `0.3` 出現 **10 次、至少 5 種意思**（階梯落差、簷帶上緣、舞台塔頂蓋外伸、路燈台座半寬、發光材質粗糙度），改其中一個時無法用搜尋取代。
  - 路燈：`0.45` 同時是步道高度 `FLOOR`（L193）也是路燈台座高度（L238–L242：`0.225`、`0.45 + 1.8`、`0.45 + 3.6 + 0.22`），`0.225` 是它的一半，`1.8` 是 3.6 的一半，`0.22` 是球體「陷進燈柱」的量。這些關係只存在作者腦中；步道高度改了，審查者無從判斷路燈該不該跟著動。
  - `120.5`（鼓形量體後牆的平面 y，L166）寫死，實際上要和 Python 腳本 `yuntay.py` 的 `y < 120.5` 保持一致，但程式碼裡完全沒有註記。

### F4 重複的不安全轉型

- **功能**：外觀與室內共用的平面→世界座標轉換。
- **檔案／方法**：`yuntayTreeFree()` L106 與 `createYuntayExterior()` L115，兩處都是
  `createPlanTransform({ transform: frame.transform } as unknown as BuildingSource)`。
- **審查者遇到的困難**：`as unknown as` 會先把型別洗成 `unknown` 再硬轉，編譯器不會再檢查，之後 `yuntayFrame.json` 的欄位改名或少一個欄位，這兩處仍會通過 `tsc`，直到執行時才出錯。同一段轉型出現兩次，修一處容易忘另一處。另外整個檔案有 7 個 `!` 非空斷言（如 `front[0]!`、`pts[i - 1]![0]`、`panelMat.map!`），其中多數在專案的 `tsconfig` 下根本不需要。

### F5 `solid()` 七個位置參數

- **功能**：為台階、立柱、路燈、門框、立牌建立碰撞盒。
- **檔案／方法**：`createYuntayExterior()` 內的 `solid(x, y, z, hw, hh, hd, yaw)`（L126）及 5 個呼叫點（L216、L234、L247、L260、L304）。
- **審查者遇到的困難**：
  1. 七個連續數字，呼叫處完全看不出哪個是中心高度、哪個是半高。
  2. 放在地面的盒子，`y` 與 `hh` 永遠要相等，所以每個呼叫點都把同一個數字寫兩次：`solid(lx, 2.2, lz, 0.3, 2.2, 0.3)`、`solid(x, 2.3, z, 0.55, 2.3, 0.23)`、`solid(x, top / 2, z, …, top / 2, …)`。改了高度卻只改一處，碰撞盒就會懸空或穿地。
  3. 函式上方的註解寫「half extents along / across `yaw`」，但 `hh` 其實是**垂直**半高，註解與實作不符。
  4. 審查時順帶發現立牌碰撞盒的深度半寬是 `0.23`，而立牌網格是 `0.45 / 2 = 0.225`——差 5 mm，沒有任何說明是刻意還是筆誤。

### F6 無用參數、重複的收尾、同一顏色寫兩次

- **功能**：幾何輔助函式與材質。
- **檔案／方法**：`ribbon()`（L60 起）、`annulus()`（L81 起）、材質區（L140–L160）、門框與立牌貼圖。
- **審查者遇到的困難**：
  - `ribbon(pts, y0, y1, uScale = 1, vScale = 1)`：**沒有任何呼叫點傳入後兩個參數**，但每次閱讀都要確認它們是不是在別處被用到。
  - `ribbon` 與 `annulus` 結尾的 5 行（建立 `BufferGeometry`、`setAttribute` ×2、`setIndex`、`computeVertexNormals`）完全重複。
  - L167–L168：`cladding(1, 1)` 已經把貼圖重複數設成 `(1/1.2, 1/0.9)`，下一行 `panelMat.map!.repeat.set(1 / 1.2, 1 / 0.9)` 又設一次，還需要一個 `!`。
  - 屋頂灰 `0xa9aaa6` 在兩處各建立一份材質；門框色在材質寫 `0x6b6f72`、在畫布寫 `'#6b6f72'`，立牌色同理——4 行描述 2 個顏色，改色時容易只改一半。

> **審查中發現、但刻意不在這次修改的事**：門框貼圖的字型清單含 `"Microsoft JhengHei"`，立牌的字型清單沒有。統一它會改變 Windows 上的畫面，屬於行為變更，不是重構，所以只記錄、不處理（§4）。

---

## 2. 修改前後的程式碼

標記說明：`// ◀` 表示關鍵改動。

### F1 拆分巨大函式

**修改前**（`createYuntayExterior`，L114–L313，節錄結構）

```ts
export function createYuntayExterior(scene, physics, tracker): { dispose(): void } {
  const xf = createPlanTransform({ transform: frame.transform } as unknown as BuildingSource);
  const [ox, oz] = xf.toWorld(0, 0), [px, pz] = xf.toWorld(1, 0);
  /* … Group、colliders、solid、add、mat、材質、cladding：L115–L160 … */

  // --- Drum over the auditorium side …                L162–L177
  // --- Fly tower over the stage.      { const [x0,y0,x1,y1] …  top … }      L179–L189
  // --- Colonnade, raised walk and steps …              L191–L248
  // --- A門 portal with the name.      { const [x0,y0,x1,y1] …  top = 6.8 }  L250–L279
  // --- Sign pylon by the south walk.  { … }                                  L281–L305

  return { dispose() { … } };
}
```

**修改後**（進入點只負責「依序呼叫」；每個部位自成一個函式，用 `Ctx` 取得共用工具）

```ts
export function createYuntayExterior(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): { dispose(): void } {
  const ctx = createContext(scene, physics, tracker);   // ◀ Group、碰撞體、材質、貼圖集中在這裡
  addDrum(ctx);                                         // ◀ 每個部位一個函式
  addFlyTower(ctx);
  addColonnade(ctx);                                    //    └ addWalk / addCanopy / addPiersAndLamps
  addPortal(ctx);
  addPylon(ctx);
  return { dispose: ctx.dispose };
}
```

函式長度分布：修改前 **200 / 19 / 19**（最長三個），修改後 **71 / 26 / 23**。

### F2 一張表產生網格與碰撞

**修改前**

```ts
const WALK = 3.0, STEP = 0.4, FLOOR = 0.45, CANOPY0 = 4.6, CANOPY1 = 5.4;
add(annulus(t0, t1, 0, WALK, FLOOR, n), paving, false);
add(annulus(t0, t1, WALK, WALK + STEP, FLOOR - 0.15, n), paving, false);            // ① 0.15
add(annulus(t0, t1, WALK + STEP, WALK + 2 * STEP, FLOOR - 0.3, n), paving, false);  // ② 0.3
add(ribbon(arcPts(t0, t1, WALK, n), FLOOR - 0.15, FLOOR), paving, false);           // ③ 0.15
add(ribbon(arcPts(t0, t1, WALK + STEP, n), FLOOR - 0.3, FLOOR - 0.15), paving, false); // ④ 0.3, 0.15
add(ribbon(arcPts(t0, t1, WALK + 2 * STEP, n), 0, FLOOR - 0.3), paving, false);     // ⑤ 0.3
/* … */
for (const [d0, d1, top] of [[0, WALK, FLOOR], [WALK, WALK + STEP, FLOOR - 0.15],   // ⑥ 0.15
                             [WALK + STEP, WALK + 2 * STEP, FLOOR - 0.3]] as const) { // ⑦ 0.3
  const [x, z] = onArc(t, (d0 + d1) / 2);
  solid(x, top / 2, z, len / 2 + 0.03, top / 2, (d1 - d0) / 2, -t);
}
```

**修改後**

```ts
const RISE = 0.15; // riser height                                                   // ◀ 唯一的落差
const WALK_END = WALK + 2 * STEP;
const TIERS = [                                                                      // ◀ 一張表
  { from: 0, to: WALK, top: FLOOR },
  { from: WALK, to: WALK + STEP, top: FLOOR - RISE },
  { from: WALK + STEP, to: WALK_END, top: FLOOR - 2 * RISE },
] as const;
/* … */
for (const { from, to, top } of TIERS) add(annulus(t0, t1, from, to, top, COLONNADE_SEGMENTS), palette.paving, false);
TIERS.forEach(({ to, top }, k) => {
  const below = TIERS[k + 1]?.top ?? 0; // ◀ 立面下緣 = 下一級的頂面；最後一級落到地面
  add(ribbon(arcPts(t0, t1, to, COLONNADE_SEGMENTS), below, top), palette.paving, false);
});
/* … */
for (const { from, to, top } of TIERS) {                                              // ◀ 碰撞體用同一張表
  const [x, z] = onArc(t, (from + to) / 2);
  solid(x, z, { height: top, hw: len / 2 + 0.03, hd: (to - from) / 2, yaw: -t });
}
```

改動重點：修改前要同步 **6 行 8 處** `FLOOR - 0.x`；修改後只改 `RISE`（引用 2 行）。

### F3 魔術數字改為具名常數（以路燈為例）

**修改前**

```ts
const [lx, lz] = onArc(t, WALK + 2 * STEP + 0.8);
const base = new Mesh(baseGeo, pier);
base.position.set(lx, 0.225, lz);                // 0.225 = 0.45 / 2 ？
const pole = new Mesh(poleGeo, pier);
pole.position.set(lx, 0.45 + 1.8, lz);           // 1.8 = 3.6 / 2 ？
const globe = new Mesh(globeGeo, glow);
globe.position.set(lx, 0.45 + 3.6 + 0.22, lz);   // 0.22 ？（球半徑是 0.24）
```

**修改後**

```ts
const LAMP = {                                                     // ◀ 每個數字都有名字與註解
  every: 3, phase: 1, // a lamp in front of every 3rd pier, starting at the 2nd
  outset: 0.8, // beyond the lowest step
  base: 0.6, baseH: 0.45, poleH: 3.6, poleTop: 0.09, poleBottom: 0.12,
  globeR: 0.24, globeRest: 0.22, // the globe sits 0.02 m into the pole's top
  colliderH: 4.4,
};
/* … */
const [lx, lz] = onArc(t, WALK_END + LAMP.outset);
put(baseGeo, palette.pier, false).position.set(lx, LAMP.baseH / 2, lz);
put(poleGeo, palette.pier, false).position.set(lx, LAMP.baseH + LAMP.poleH / 2, lz);              // ◀ 由尺寸推導
put(globeGeo, palette.glow, false).position.set(lx, LAMP.baseH + LAMP.poleH + LAMP.globeRest, lz); // ◀ 不再手算
```

同樣把 `120.5` 命名為 `DRUM_BACK_Y`（註解指向 `yuntay.py`），把 `72 / 96 / 64` 命名為 `DRUM_SEGMENTS / COLONNADE_SEGMENTS / COLLIDER_SEGMENTS`，把樹木禁區的 `-0.5 / 7 / 48 / 3 / 4 / 2.5` 收進 `TREE_FREE`。

### F4 去掉雙重轉型

**修改前**（兩處）

```ts
export function yuntayTreeFree(): number[][] {
  const xf = createPlanTransform({ transform: frame.transform } as unknown as BuildingSource);   // 1
  /* … */
}
export function createYuntayExterior(…) {
  const xf = createPlanTransform({ transform: frame.transform } as unknown as BuildingSource);   // 2
```

**修改後**（`planTransform.ts` 一行 + 模組層級一次）

```ts
// planTransform.ts
export function createPlanTransform(src: Pick<BuildingSource, 'transform'>): {   // ◀ 只要求 transform 欄位
// yuntayExterior.ts
const PLAN = createPlanTransform({ transform: frame.transform as BuildingSource['transform'] }); // ◀ 一次、普通 as
```

`tsc` 現在會檢查 `transform` 的形狀；`as unknown as` 由 2 個降到 0，`!` 由 7 個降到 0。

### F5 `solid()` 改成具名欄位

**修改前**

```ts
/** Box collider: plan centre, height centre, half extents along / across `yaw` (local frame). */
const solid = (x: number, y: number, z: number, hw: number, hh: number, hd: number, yaw = 0): void => { … };

solid(lx, 2.2, lz, 0.3, 2.2, 0.3);                                            // 2.2 寫兩次
solid(x, 2.3, z, 0.55, 2.3, 0.23);                                            // 2.3 寫兩次；0.23 vs 網格 0.225？
solid(x, FLOOR + (CANOPY0 - FLOOR) / 2, z, 0.35, (CANOPY0 - FLOOR) / 2, 0.35, -t);
```

**修改後**

```ts
/** An axis-aligned box resting on `y0` (default ground), turned by `yaw` about its centre. */
interface SolidBox { y0?: number; height: number; hw: number; hd: number; yaw?: number }
solid(x, z, { y0 = 0, height, hw, hd, yaw = 0 }) {          // ◀ 中心高度與半高由 height 推導
  /* … */ RAPIER.ColliderDesc.cuboid(hw, height / 2, hd).setTranslation(wx, y0 + height / 2, wz) /* … */
}

solid(lx, lz, { height: LAMP.colliderH, hw: LAMP.base / 2, hd: LAMP.base / 2 });
solid(PYLON_X, PYLON_Y, { height: h, hw: w / 2, hd: d / 2 + colliderPad });          // ◀ 5 mm 差異現在有名字
solid(x, z, { y0: FLOOR, height: pierH, hw: PIER.size / 2, hd: PIER.size / 2, yaw: -t });
```

### F6 無用參數與重複

**修改前**

```ts
function ribbon(pts: [number, number][], y0: number, y1: number, uScale = 1, vScale = 1): BufferGeometry {
  /* … */ uv.push(u / uScale, 0, u / uScale, (y1 - y0) / vScale);          // 沒有任何呼叫點傳入 uScale / vScale
  const g = new BufferGeometry();                                          // ┐ ribbon 與 annulus
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));          // │ 各寫一遍
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));                 // │
  g.setIndex(idx); g.computeVertexNormals(); return g;                     // ┘
}
const panelMat = cladding(1, 1);
panelMat.map!.repeat.set(1 / 1.2, 1 / 0.9);                                // cladding 已設過一次，且需要 `!`
const top = mat(0xa9aaa6, { roughness: 0.95 });   // 舞台塔頂；屋頂又 mat(0xa9aaa6, …) 一次
c.fillStyle = '#6b6f72';  /* 畫布 */   …   const frameMat = mat(0x6b6f72);   /* 材質 */
```

**修改後**

```ts
function ribbon(pts: Pt[], y0: number, y1: number): BufferGeometry {      // ◀ 移除 uScale / vScale
  /* … */ uv.push(u, 0, u, y1 - y0);
  return meshData(pos, uv, idx);                                           // ◀ 共用收尾
}
const panels = cladding(1, 1); // ribbon uv is in metres: repeat per metre of wall   // ◀ 刪掉重複那行
const COLOUR = { dark: 0x5e6265, pier: 0xc9cbca, paving: 0xb8b5ae, roof: 0xa9aaa6, canopyUnder: 0x7a7e81, frame: 0x6b6f72, pylon: 0x5a5754 };
const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;       // ◀ 材質與畫布共用同一個值
c.fillStyle = css(COLOUR.frame);
```

---

## 3. 功能驗證

### 3.1 方法

這個模組需要 WebGL 與物理引擎才能「看見」結果，所以用三支不依賴瀏覽器的腳本，在 Node 裡以假的 `document`、假的物理世界與資源追蹤器直接執行**真正的模組**，再比對輸出：

| 腳本 | 做什麼 |
| --- | --- |
| `scripts/fingerprint-yuntay.ts` | 對**所有**網格（每個頂點、位置、旋轉、陰影旗標、材質顏色／粗糙度／自發光／雙面、貼圖重複數）、**所有**碰撞體（半尺寸、位置、旋轉）、樹木禁區、以及貼圖繪製的每一次畫布呼叫，各算一個雜湊。 |
| `scripts/verify-yuntay-branches.ts` | 把四個條件判斷各自拆開，印出「進入」與「不進入」時各產生了什麼。 |
| `scripts/code-metrics.ts` | 靜態指標（函式長度、轉型、魔術數字…）。 |

「修改前」用同一批腳本的 `--module=` 參數載入舊版本（`git show b50ad27:src/buildings/yuntayExterior.ts`），所以**輸入完全相同**：同一份 `yuntayFrame.json`、同一個假環境。重現方式：

```bash
git show b50ad27:src/buildings/yuntayExterior.ts > src/buildings/__before__.ts
npx tsx scripts/fingerprint-yuntay.ts --module=../src/buildings/__before__.ts        # 修改前
npx tsx scripts/fingerprint-yuntay.ts                                                # 修改後
npx tsx scripts/verify-yuntay-branches.ts --module=../src/buildings/__before__.ts    # 修改前
npx tsx scripts/verify-yuntay-branches.ts                                            # 修改後
rm src/buildings/__before__.ts
```

### 3.2 同一輸入、修改前後的整體輸出

輸入：`yuntayFrame.json`（弧形外牆圓、舞台塔、門框、立牌位置）；無 2D 畫布（headless）與有 2D 畫布（paint）兩種環境。

| 輸出項目 | 預期（前後必須相同） | 修改前實際 | 修改後實際 | 一致 |
| --- | --- | --- | --- | :-: |
| 網格數 / 頂點數 | 59 / 4729 | 59 / 4729 | 59 / 4729 | ✓ |
| 網格雜湊（含材質參數） | 相同 | `c0515de025375676` | `c0515de025375676` | ✓ |
| 幾何分布 | Box 31、Buffer 15、Cylinder 6、Shape 1、Sphere 6 | 同左 | 同左 | ✓ |
| 碰撞體數 / 雜湊 | 220 / 相同 | 220 / `7c3c6671066700ba` | 220 / `7c3c6671066700ba` | ✓ |
| 樹木禁區（3 個環，98 / 4 / 4 點） | 相同 | `d9cfebcdf12916a9` | `d9cfebcdf12916a9` | ✓ |
| 畫布繪製呼叫（paint 模式） | 36 次，內容相同 | 36 / `94045bfbb8d3b33f` | 36 / `94045bfbb8d3b33f` | ✓ |
| `tsc --noEmit` | 通過 | 通過 | 通過 | ✓ |

兩份輸出以 `diff docs/code-review/fingerprint-before.txt docs/code-review/fingerprint-after.txt` 比對，**沒有任何差異**。

### 3.3 條件判斷：進入與不進入各驗證一次

下表每一列都是同一個輸入跑兩個版本的結果（完整輸出在 `branches-before.txt` / `branches-after.txt`；兩檔只差標頭的模組名稱與 E 項的材質數）。

| 條件判斷 | 輸入情境 | 預期 | 修改前 | 修改後 |
| --- | --- | --- | --- | --- |
| **A** 路燈：`if (i % 3 !== 1) continue;`（修改後為 `i % LAMP.every !== LAMP.phase`） | **不進入**（跳過路燈）：柱 0、2、3、5、6、8、9、11、12、14、15、17、18 | 只有立柱，沒有燈 | 13 根 `no lamp` | 13 根 `no lamp` |
| | **進入**（建燈）：柱 1、4、7、10、13、16 | 台座 + 燈柱 + 球，共 6 組 | 6 組、Sphere 6 | 6 組、Sphere 6 |
| **B** 陰影旗標：`add(…, shadow = false)`（修改後 `cast = false`） | **false**：踏面、台階立面、雨遮、屋頂等 | 不投射陰影 | 11 個網格 | 11 個網格 |
| | **true**（預設）：牆面、立柱、門框等 | 投射陰影 | 48 個網格 | 48 個網格 |
| **C** 最後一級立面：`TIERS[k+1]?.top ?? 0` | **有下一級**（立面 1、2） | 立面下緣 = 下一級頂面 | y 0.30→0.45、0.15→0.30 | y 0.30→0.45、0.15→0.30 |
| | **沒有下一級**（立面 3，走到 `?? 0`） | 一路落到地面 | y 0.00→0.15 | y 0.00→0.15 |
| **D** 畫布存在：`if (g) paint(g)` | **不進入**（無 2D context） | 繪製函式不被呼叫 | 0 次 | 0 次 |
| | **進入**（有 2D context） | 三張貼圖（外牆板、門框名牌、立牌）被繪製 | 21 次呼叫 | 21 次呼叫 |

補充一項資源計數（不是條件判斷，但是修改的直接結果）：一次建置登記的材質數 **14 → 13**（兩份屋頂灰材質合併為一份），幾何體 26、貼圖 6 不變。

### 3.4 負向對照：證明「指紋相同」不是廢話

只看到「相同」不夠，還要證明這個檢查**會**在出錯時變成「不同」。以下在**修改後**的程式碼副本上刻意改壞，其餘不變（`negative-controls.txt`）：

| 刻意破壞 | 預期 | 結果 |
| --- | --- | --- |
| `PIER.spacing` 4.4 → 4.6（立柱少一根） | 網格與碰撞數量變少 | 網格 59 → 58、碰撞 220 → 219；`piers 19 → 18`；雜湊改變 ✓ |
| `LAMP.phase` 1 → 0（燈改在另一批柱子） | 條件的「進入」位置改變 | 燈從柱 1、4、7… 變成 0、3、…；網格 59 → 62、碰撞 220 → 221；雜湊改變 ✓ |
| 最後一級立面 `?? 0` → `?? 0.1` | 只有 `?? 0` 分支的結果改變 | 立面 3 變成 y 0.10→0.15；網格雜湊改變（碰撞不變，因為碰撞盒不用這個值）✓ |
| 踏面粗糙度 0.95 → 0.9（只動材質參數） | 頂點與碰撞不變，網格雜湊仍要改變 | 頂點數 4729、碰撞雜湊不變，網格雜湊 `c0515…` → `5101a…` ✓ |

四種破壞都被偵測到，包括只動材質參數的那一種，所以 §3.2 的「完全相同」是有鑑別力的。

### 3.5 靜態指標：改善在哪裡

`npx tsx scripts/code-metrics.ts <檔案>`（輸出在 `metrics-before.txt` / `metrics-after.txt`；腳本以遮蔽註解與字串後配對大括號的方式找函式，因專案安裝的是無 JS 編譯器 API 的 TypeScript 7）。

| 指標 | 修改前 | 修改後 | 說明 |
| --- | ---: | ---: | --- |
| 最長函式（行） | **200** `createYuntayExterior` | **71** `createContext` | 修改後最長的是一個包含材質表的物件字面值 |
| 最長三個函式 | 200 / 19 / 19 | 71 / 26 / 23 | |
| 區塊函式數 | 13 | 25 | 責任拆開 |
| `as unknown as` | 2 | **0** | F4 |
| `!` 非空斷言 | 7 | **0** | F4、F6 |
| 函式內魔術數字（種類） | 134（66） | **48（30）** | F3；剩下多為畫布像素與字型大小 |
| 同一個值寫 3 次以上 | 14 種（`0.3`×10、`0.15`×5、`0.45`×5、`2.3`×5…） | 3 種（`3`×6、`128`×3、`96`×3） | 剩下的是畫布尺寸 |
| 階梯落差的修改點 | 6 行、8 處 | **1 個常數** | F2 |
| 同色的重複字面值 | 4 行 | 1 行（`COLOUR`） | F6 |
| `createPlanTransform` 呼叫 | 2 | 1 | F4 |
| 幾何收尾重複 | 2 份 | 1 份（`meshData`） | F6 |
| 檔案行數 | 314 | 429 | 見 §4：變長是代價 |

### 3.6 遊戲中的檢查

用本工作階段自己啟動的開發伺服器載入修改後的版本，傳送到 A 門前（平面座標 117, 160，朝北看）：遊戲正常進入（約 41 FPS、場景 92 個物件），畫面上的門框「雲泰表演廳 Yun Tay Performance Hall」字樣、玻璃門、右側深灰立牌都正常出現，主控台沒有來自這個模組的錯誤。（主控台有 `toNonIndexed` 警告，來源是 `playground.ts`、`longtanRoad.ts`、`bikeSystem.ts`，本模組沒有呼叫它。）

因為瀏覽器窗格處於隱藏狀態，主畫布的截圖是黑的，所以這張畫面是用另一個離屏的 WebGL renderer 對同一個場景、同一個視角畫出來的；它只能證明「這份程式在真實遊戲裡能跑、畫面看起來對」，**精確的等價性證明是 §3.2–§3.4 的指紋**。

---

## 4. 取捨與沒做的事

- **檔案變長了**（314 → 429 行，+37%）。多出來的是常數表、型別、每個函式的註解與 `Ctx` 介面。換到的是：單一函式不再超過 71 行、數字都有名字、每個部位可獨立閱讀。若只看行數，這是退步；看維護成本，是進步。
- **`createContext` 仍有 71 行**，超過我自己設的 60 行線；它主要是材質表與 `Ctx` 物件字面值，沒有分支，暫不再拆。
- **字型清單不一致**（門框含 `Microsoft JhengHei`、立牌沒有）：會改變 Windows 上的畫面，屬行為變更，留待另開項目。
- **立牌碰撞盒比網格深 5 mm**：目前保留原值並以 `colliderPad` 具名，需要有人決定是刻意預留還是筆誤。
- **指紋的限制**：在 Node 裡以假環境執行，所以**沒有**真正繪出像素；貼圖內容以「畫布呼叫序列的雜湊」代替，材質只比對顏色、粗糙度、自發光、雙面與貼圖重複數。這涵蓋了這份重構能碰到的所有輸入，但不是影像比對。
- **指標腳本是啟發式的**：不是真正的語法樹分析，數字以腳本輸出為準，行為正確與否仍以 §3.2–§3.4 為準。

## 5. 這次改動的檔案

| 檔案 | 性質 |
| --- | --- |
| `src/buildings/yuntayExterior.ts` | 重構（F1–F6） |
| `src/buildings/planTransform.ts` | 一行：參數型別放寬為 `Pick<BuildingSource, 'transform'>`（F4） |
| `scripts/fingerprint-yuntay.ts`、`scripts/verify-yuntay-branches.ts`、`scripts/code-metrics.ts` | 驗證與量測工具（可重複執行） |
| `docs/code-review/*.txt`、本文件 | 證據 |
