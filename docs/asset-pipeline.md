# 角色資產管線（Character Asset Pipeline）

## 交付規格（給美術 / AI 生成後的清理）

| 項目 | 規格 |
|---|---|
| 格式 | `.glb` 單檔（或 `.gltf` + 資源），glTF 2.0 |
| 座標 | Y 軸朝上、**面向 +Z**、單位公尺 |
| 原點 | 腳底中心（最低點 y ≈ 0） |
| 身高 | 約 1.3 m（不含頭頂葉片），工具會在 0.8–2.5 m 之外發出警告 |
| 面數 | 3,000–6,000 三角面 |
| 骨骼 | ≤ 30 根；Mixamo 自動綁骨可直接用 |
| 貼圖 | 1 張 1024² Base Color（必要），Normal（選用）；臉部貼圖命名需含 `_hq` |
| 動畫片段（名稱需完全一致） | `Idle`、`Walk`、`Run`、`Jump_Start`、`Jump_Loop`、`Jump_Land` |
| 描邊 | 在節點 Custom Properties（glTF extras）加 `outline = true` 的網格會自動加卡通描邊 |
| 眨眼（選用） | 臉部網格命名 `face`，貼圖左右兩格：左 = 睜眼、右 = 閉眼，程式以 UV 位移切換 |

### 動畫製作注意
- `Walk` 以 **3.5 m/s**、`Run` 以 **7 m/s** 的步頻製作原地循環（in-place，不要 root motion）；
  執行時會依實際速度自動調整播放速度，並在 Walk ↔ Run 切換時對齊步伐相位。
- `Jump_Start`、`Jump_Land` 為單次播放（播完停在最後一格）；其他皆為循環。

## 指令

```bash
# 把美術給的模型壓成遊戲用格式（Draco 幾何 + KTX2 貼圖），並檢查上面的規格
npm run assets:optimize -- assets-src/mascot.glb public/models/mascot.glb

# 重新產生程序化替身模型（正式模型到位前使用）
npm run assets:placeholder
```

遊戲固定載入 `public/models/mascot.glb`；檔案不存在或載入失敗時，自動退回程序化替身並在主控台警告。

## 壓縮規則

| 貼圖用途 | 編碼 | 色彩空間 |
|---|---|---|
| Base Color / Emissive | ETC1S（體積小） | sRGB |
| 名稱含 `_hq` 的 Base Color（臉、徽章） | UASTC + Zstd（無方塊瑕疵） | sRGB |
| Normal | UASTC + Zstd，normal-map 模式 | Linear |
| Occlusion / MetallicRoughness | UASTC + Zstd | Linear |

幾何一律 Draco（edgebreaker，位置 14 bit、法線 10 bit、UV 12 bit）；動畫做無損關鍵影格精簡。
全部工具都是 npm 套件（`@gltf-transform`、`ktx2-encoder`、`draco3dgltf`、`sharp`），不需安裝 Blender 或 KTX-Software。

## 最快落地流程（照片 → 遊戲）

1. AI 圖轉 3D（Tripo / Meshy / Rodin）用參考照片生成模型。
2. Blender：減面至 6k 以下、確認面向 +Z 與原點在腳底、套用縮放。
3. Mixamo 自動綁骨，下載 6 個動作（勾選 In Place），在 Blender 合併並依上表命名。
4. 修正大頭的骨骼權重（頭部只受 Head 骨骼影響）。
5. 匯出 `.glb` 放到 `assets-src/`，執行 `npm run assets:optimize`。
